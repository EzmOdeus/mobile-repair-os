import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { InvoiceModel } from '../models/Invoice.js';
import { PaymentModel } from '../models/Payment.js';
import { ExpenseModel } from '../models/Expense.js';
import { RepairTicketModel } from '../models/RepairTicket.js';
import { RepairPartModel } from '../models/RepairPart.js';
import { RepairLaborModel } from '../models/RepairLabor.js';
import { CustomerModel } from '../models/Customer.js';
import { PartModel } from '../models/Part.js';
import { OrganizationModel } from '../models/Organization.js';
import { ApiError } from '../utils/ApiError.js';
import { created, ok, paginated } from '../utils/asyncHandler.js';
import { parseCsv, parseListQuery, parseSort, regexSearch } from '../utils/queryHelpers.js';
import { getAuth } from '../middleware/auth.js';
import { getTenantContext } from '../context/tenantContext.js';
import { recordAudit } from '../services/auditService.js';
import { computeTotals, money } from '../utils/money.js';
import { nextInvoiceNumber, nextReceiptNumber, withUniqueRetry } from '../services/numberingService.js';
import { recordTimelineEvent, transitionTicket } from '../services/workflowService.js';
import { normalizeEgyptPhone } from '../validators/common.js';
import { addDays } from '../utils/dates.js';
import { sendNotification } from '../services/notificationService.js';
import { applyStockMovement } from '../services/inventoryService.js';

/* ============================ الفواتير ============================ */

export const listInvoices = async (req: Request, res: Response) => {
  const { page, limit, skip } = parseListQuery(req.query as Record<string, unknown>, 30);
  const sort = parseSort(req.query as Record<string, unknown>, ['createdAt', 'issuedAt', 'totals.totalEgp'], { createdAt: -1 });
  const query = req.query as Record<string, unknown>;

  const filter: Record<string, unknown> = {};
  const search = regexSearch(query.q);
  if (search) filter.invoiceNumber = search;
  const statuses = parseCsv(query.status);
  if (statuses.length) filter.status = { $in: statuses };
  const types = parseCsv(query.type);
  if (types.length) filter.type = { $in: types };
  if (query.customerId) filter.customerId = query.customerId;
  if (query.ticketId) filter.ticketId = query.ticketId;
  if (query.unpaid === 'true') filter['totals.dueEgp'] = { $gt: 0.009 };

  const [items, total] = await Promise.all([
    InvoiceModel.find(filter)
      .populate('customerId', 'fullName phone')
      .populate('ticketId', 'ticketNumber')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    InvoiceModel.countDocuments(filter),
  ]);

  return paginated(res, items, { page, limit, total });
};

export const getInvoice = async (req: Request, res: Response) => {
  const invoice = await InvoiceModel.findById(req.params.id)
    .populate('customerId')
    .populate('ticketId', 'ticketNumber deviceId status')
    .populate('createdBy', 'fullName')
    .lean();
  if (!invoice) throw ApiError.notFound('الفاتورة غير موجودة');

  const payments = await PaymentModel.find({ invoiceId: invoice._id }).sort({ paidAt: -1 }).lean();
  return ok(res, { invoice, payments });
};

/**
 * إنشاء فاتورة. إما ببنود يدوية (نقاط البيع)، أو مبنية تلقائيًا من قطع ومصنعية تذكرة.
 */
export const createInvoice = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const ctx = getTenantContext();
  const body = req.body as {
    type: string;
    customerId?: string | null;
    ticketId?: string | null;
    buildFromTicket: boolean;
    lines: { kind: string; refId?: string | null; description: string; quantity: number; unitPriceEgp: number; warrantyDays: number }[];
    discountEgp: number;
    taxRatePct?: number;
    notes?: string;
    customerNotes?: string;
    issueNow: boolean;
  };

  const organization = await OrganizationModel.findById(ctx!.organizationId).select('settings').lean();
  const taxRatePct = body.taxRatePct ?? organization?.settings?.taxRate ?? 14;

  let lines = body.lines ?? [];
  let customerId = body.customerId ? new Types.ObjectId(body.customerId) : null;
  let ticketId = body.ticketId ? new Types.ObjectId(body.ticketId) : null;
  let deviceId: Types.ObjectId | null = null;
  let warrantyDays = 0;

  // بناء الفاتورة من التذكرة
  if (body.buildFromTicket && ticketId) {
    const ticket = await RepairTicketModel.findById(ticketId);
    if (!ticket) throw ApiError.notFound('التذكرة غير موجودة');

    customerId = ticket.customerId as Types.ObjectId;
    deviceId = ticket.deviceId as Types.ObjectId;
    warrantyDays = ticket.warranty.policyDays ?? 0;

    const [parts, labor] = await Promise.all([
      RepairPartModel.find({ ticketId: ticket._id, status: { $in: ['reserved', 'installed'] } })
        .populate('partId', 'name sku')
        .lean(),
      RepairLaborModel.find({ ticketId: ticket._id }).lean(),
    ]);

    lines = [
      ...parts.map((p) => ({
        kind: 'part' as const,
        refId: String(p._id),
        description: `${(p.partId as unknown as { name?: string })?.name ?? 'قطعة غيار'} × ${p.quantity}`,
        quantity: p.quantity,
        unitPriceEgp: p.unitPriceEgp,
        warrantyDays: p.warrantyDays ?? warrantyDays,
      })),
      ...labor.map((l) => ({
        kind: 'labor' as const,
        refId: String(l._id),
        description: l.description,
        quantity: 1,
        unitPriceEgp: l.amountEgp,
        warrantyDays: 0,
      })),
    ];

    if (!lines.length) {
      throw ApiError.businessRule('لا توجد بنود على التذكرة لبناء الفاتورة (أضف قطعًا أو مصنعية)');
    }
  }

  if (!lines.length) throw ApiError.badRequest('أضف بندًا واحدًا على الأقل للفاتورة');

  const preparedLines = lines.map((l) => ({
    kind: l.kind,
    refId: l.refId ? new Types.ObjectId(l.refId) : null,
    description: l.description,
    quantity: l.quantity,
    unitPriceEgp: l.unitPriceEgp,
    totalEgp: money(l.quantity * l.unitPriceEgp),
    warrantyDays: l.warrantyDays ?? 0,
  }));

  const totals = computeTotals({
    lines: preparedLines,
    discountEgp: body.discountEgp,
    taxRatePct,
    taxInclusive: organization?.settings?.taxInclusive ?? true,
  });

  const invoice = await withUniqueRetry(nextInvoiceNumber, (invoiceNumber) =>
    InvoiceModel.create({
      organizationId: ctx!.organizationId,
      branchId: ctx!.branchId,
      invoiceNumber,
      type: body.type,
      status: body.issueNow ? 'issued' : 'draft',
      customerId,
      deviceId,
      ticketId,
      lines: preparedLines,
      totals: { ...totals, taxRatePct, changeEgp: 0 },
      issuedAt: body.issueNow ? new Date() : null,
      dueAt: body.issueNow ? addDays(new Date(), 0) : null,
      notes: body.notes ?? '',
      customerNotes: body.customerNotes ?? '',
      createdBy: new Types.ObjectId(auth.userId),
    }),
  );

  // ربط الفاتورة بالتذكرة وتحديث تكلفتها
  if (ticketId) {
    const ticket = await RepairTicketModel.findById(ticketId);
    if (ticket) {
      ticket.cost.totalFinalEgp = totals.totalEgp;
      ticket.cost.discountEgp = totals.discountEgp;
      ticket.cost.taxEgp = totals.taxEgp;
      ticket.cost.dueEgp = totals.dueEgp;
      await ticket.save();

      await recordTimelineEvent({
        ticket,
        eventType: 'invoice_created',
        note: `إصدار فاتورة ${invoice.invoiceNumber} بمبلغ ${totals.totalEgp} جنيه`,
        actor: { userId: auth.userId, fullName: auth.fullName, role: auth.role },
        metadata: { invoiceId: String(invoice._id), totalEgp: totals.totalEgp },
      });
    }
  }

  await recordAudit(
    {
      action: 'create',
      resource: 'Invoice',
      resourceId: String(invoice._id),
      summary: `فاتورة ${invoice.invoiceNumber} بمبلغ ${totals.totalEgp} جنيه`,
    },
    req,
  );

  return created(res, invoice.toObject());
};

export const voidInvoice = async (req: Request, res: Response) => {
  const invoice = await InvoiceModel.findById(req.params.id);
  if (!invoice) throw ApiError.notFound('الفاتورة غير موجودة');
  if (invoice.status === 'void') throw ApiError.businessRule('الفاتورة ملغاة بالفعل');

  const paid = invoice.totals.paidEgp ?? 0;
  if (paid > 0.009) {
    throw ApiError.businessRule('لا يمكن إلغاء فاتورة مدفوعة، سجّل استردادًا أولًا', { paidEgp: paid });
  }

  invoice.status = 'void';
  invoice.voidedAt = new Date();
  invoice.voidReason = (req.body as { reason: string }).reason;
  await invoice.save();

  await recordAudit(
    { action: 'void', resource: 'Invoice', resourceId: String(invoice._id), summary: `إلغاء فاتورة ${invoice.invoiceNumber}`, severity: 'warning' },
    req,
  );

  return ok(res, invoice.toObject());
};

/* ============================ المدفوعات ============================ */

export const listPayments = async (req: Request, res: Response) => {
  const { page, limit, skip } = parseListQuery(req.query as Record<string, unknown>, 40);
  const query = req.query as Record<string, unknown>;

  const filter: Record<string, unknown> = {};
  const methods = parseCsv(query.method);
  if (methods.length) filter.method = { $in: methods };
  if (query.invoiceId) filter.invoiceId = query.invoiceId;
  if (query.customerId) filter.customerId = query.customerId;
  if (query.ticketId) filter.ticketId = query.ticketId;
  if (query.direction) filter.direction = query.direction;
  if (query.from || query.to) {
    const range: Record<string, Date> = {};
    if (query.from) range.$gte = new Date(String(query.from));
    if (query.to) range.$lte = new Date(String(query.to));
    filter.paidAt = range;
  }

  const [items, total, aggregate] = await Promise.all([
    PaymentModel.find(filter)
      .populate('customerId', 'fullName phone')
      .populate('invoiceId', 'invoiceNumber')
      .populate('recordedBy', 'fullName')
      .sort({ paidAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    PaymentModel.countDocuments(filter),
    PaymentModel.aggregate<{ _id: string; total: number }>([
      { $match: filter },
      { $group: { _id: '$method', total: { $sum: '$amountEgp' } } },
    ]),
  ]);

  return res.status(200).json({
    success: true,
    data: items,
    meta: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
      totalsByMethod: aggregate.map((a) => ({ method: a._id, totalEgp: money(a.total) })),
    },
  });
};

/**
 * تسجيل دفعة: يحدّث الفاتورة والتذكرة، ويُنشئ حركة دفع في الـTimeline.
 * عند الدفع الكامل لتذكرة جاهزة، تُنقل حالتها إلى paid.
 */
export const recordPayment = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const ctx = getTenantContext();
  const body = req.body as {
    invoiceId?: string | null;
    ticketId?: string | null;
    customerId?: string | null;
    method: string;
    amountEgp: number;
    tenderedEgp: number;
    reference?: string;
    walletNumber?: string;
    cardLast4?: string;
    bankName?: string;
    notes?: string;
    isRefund: boolean;
    refundReason?: string;
  };

  if (body.amountEgp <= 0) throw ApiError.badRequest('قيمة الدفعة يجب أن تكون أكبر من صفر');

  let invoice = body.invoiceId ? await InvoiceModel.findById(body.invoiceId) : null;
  let ticketId = body.ticketId ? new Types.ObjectId(body.ticketId) : null;

  if (!invoice && ticketId) {
    invoice = await InvoiceModel.findOne({ ticketId, status: { $ne: 'void' } }).sort({ createdAt: -1 });
  }
  if (!invoice && !ticketId) {
    throw ApiError.badRequest('حدد فاتورة أو تذكرة لتسجيل الدفعة');
  }

  if (invoice) {
    ticketId = invoice.ticketId as Types.ObjectId | null;
  }

  const change = body.method === 'cash' && body.tenderedEgp > body.amountEgp ? money(body.tenderedEgp - body.amountEgp) : 0;

  const payment = await withUniqueRetry(nextReceiptNumber, (receiptNumber) =>
    PaymentModel.create({
      organizationId: ctx!.organizationId,
      branchId: ctx!.branchId,
      receiptNumber,
      direction: body.isRefund ? 'out' : 'in',
      method: body.method,
      amountEgp: money(body.amountEgp),
      invoiceId: invoice?._id ?? null,
      ticketId,
      customerId: invoice?.customerId ?? (body.customerId ? new Types.ObjectId(body.customerId) : null),
      reference: body.reference ?? '',
      walletNumber: body.walletNumber ?? '',
      cardLast4: body.cardLast4 ?? '',
      bankName: body.bankName ?? '',
      tenderedEgp: money(body.tenderedEgp),
      changeEgp: change,
      notes: body.notes ?? '',
      isRefund: body.isRefund,
      refundReason: body.refundReason ?? '',
      recordedBy: new Types.ObjectId(auth.userId),
      paidAt: new Date(),
    }),
  );

  // تحديث الفاتورة
  if (invoice) {
    const paidDelta = body.isRefund ? -body.amountEgp : body.amountEgp;
    const newPaid = money(Math.max(0, (invoice.totals.paidEgp ?? 0) + paidDelta));
    invoice.totals.paidEgp = newPaid;
    invoice.totals.dueEgp = money(Math.max(0, (invoice.totals.totalEgp ?? 0) - newPaid));
    invoice.totals.changeEgp = change;
    invoice.cashierId = new Types.ObjectId(auth.userId);

    if (invoice.totals.dueEgp <= 0.009 && !body.isRefund) {
      invoice.status = 'paid';
      invoice.paidAt = new Date();
    } else if (newPaid > 0 && !body.isRefund) {
      invoice.status = 'partially_paid';
    } else if (body.isRefund && newPaid < (invoice.totals.totalEgp ?? 0)) {
      invoice.status = 'refunded';
    }
    await invoice.save();
  }

  // تحديث التذكرة
  if (ticketId) {
    const ticket = await RepairTicketModel.findById(ticketId);
    if (ticket) {
      const paidDelta = body.isRefund ? -body.amountEgp : body.amountEgp;
      ticket.cost.paidEgp = money(Math.max(0, (ticket.cost.paidEgp ?? 0) + paidDelta));
      ticket.cost.dueEgp = money(Math.max(0, (ticket.cost.totalFinalEgp ?? 0) - (ticket.cost.paidEgp ?? 0)));

      await ticket.save();

      await recordTimelineEvent({
        ticket,
        eventType: 'payment_recorded',
        note: body.isRefund
          ? `استرداد ${body.amountEgp} جنيه (${body.refundReason ?? ''})`
          : `تحصيل ${body.amountEgp} جنيه بطريقة ${body.method}`,
        actor: { userId: auth.userId, fullName: auth.fullName, role: auth.role },
        metadata: { paymentId: String(payment._id), amountEgp: body.amountEgp, method: body.method, isRefund: body.isRefund },
      });

      // عند السداد الكامل لتذكرة في مرحلة paid-able، ننقلها إلى paid
      if (!body.isRefund && ticket.cost.dueEgp <= 0.009 && ['ready', 'customer_notified'].includes(ticket.status)) {
        try {
          await transitionTicket(ticket._id, 'paid', { userId: auth.userId, fullName: auth.fullName, role: auth.role }, {
            note: 'سداد كامل',
          });
        } catch {
          void 0;
        }
      }

      // إشعار العميل بالتحصيل
      const customer = await CustomerModel.findById(ticket.customerId).select('whatsapp phone fullName').lean();
      if (customer && !body.isRefund) {
        await sendNotification({
          type: 'payment_received',
          channel: 'whatsapp',
          customerId: ticket.customerId,
          ticketId: ticket._id,
          toPhone: customer.whatsapp ?? customer.phone ?? '',
          subject: 'تم التحصيل',
          body: `استلمنا مبلغ ${body.amountEgp} جنيه على تذكرة ${ticket.ticketNumber}. المتبقي ${ticket.cost.dueEgp} جنيه.`,
          templateKey: 'payment_received',
          variables: { amount: String(body.amountEgp), ticketNumber: ticket.ticketNumber },
        });
      }
    }
  }

  await recordAudit(
    {
      action: body.isRefund ? 'refund' : 'payment',
      resource: 'Payment',
      resourceId: String(payment._id),
      summary: `${body.isRefund ? 'استرداد' : 'تحصيل'} ${body.amountEgp} جنيه بطريقة ${body.method}`,
    },
    req,
  );

  return created(res, {
    payment: payment.toObject(),
    invoice: invoice
      ? { id: String(invoice._id), number: invoice.invoiceNumber, totals: invoice.totals, status: invoice.status }
      : null,
    changeEgp: change,
  });
};

/* ============================ المصروفات ============================ */

export const listExpenses = async (req: Request, res: Response) => {
  const { page, limit, skip } = parseListQuery(req.query as Record<string, unknown>, 40);
  const query = req.query as Record<string, unknown>;

  const filter: Record<string, unknown> = {};
  const categories = parseCsv(query.category);
  if (categories.length) filter.category = { $in: categories };
  if (query.from || query.to) {
    const range: Record<string, Date> = {};
    if (query.from) range.$gte = new Date(String(query.from));
    if (query.to) range.$lte = new Date(String(query.to));
    filter.incurredAt = range;
  }

  const [items, total, byCategory] = await Promise.all([
    ExpenseModel.find(filter)
      .populate('supplierId', 'name')
      .populate('createdBy', 'fullName')
      .sort({ incurredAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    ExpenseModel.countDocuments(filter),
    ExpenseModel.aggregate<{ _id: string; total: number; count: number }>([
      { $match: filter },
      { $group: { _id: '$category', total: { $sum: '$amountEgp' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
    ]),
  ]);

  return res.status(200).json({
    success: true,
    data: items,
    meta: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
      totalEgp: money(byCategory.reduce((a, c) => a + c.total, 0)),
      byCategory: byCategory.map((c) => ({ category: c._id, count: c.count, totalEgp: money(c.total) })),
    },
  });
};

export const createExpense = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const ctx = getTenantContext();
  const body = req.body as Record<string, unknown>;

  const expense = await ExpenseModel.create({
    organizationId: ctx!.organizationId,
    branchId: ctx!.branchId,
    ...body,
    createdBy: new Types.ObjectId(auth.userId),
  });

  await recordAudit(
    { action: 'create', resource: 'Expense', resourceId: String(expense._id), summary: `مصروف: ${expense.title} بمبلغ ${expense.amountEgp}` },
    req,
  );

  return created(res, expense.toObject());
};

export const updateExpense = async (req: Request, res: Response) => {
  const expense = await ExpenseModel.findById(req.params.id);
  if (!expense) throw ApiError.notFound('المصروف غير موجود');
  Object.assign(expense, req.body);
  await expense.save();
  await recordAudit({ action: 'update', resource: 'Expense', resourceId: String(expense._id), summary: `تحديث مصروف: ${expense.title}` }, req);
  return ok(res, expense.toObject());
};

export const deleteExpense = async (req: Request, res: Response) => {
  const expense = await ExpenseModel.findById(req.params.id);
  if (!expense) throw ApiError.notFound('المصروف غير موجود');
  await ExpenseModel.findByIdAndDelete(expense._id);
  await recordAudit(
    { action: 'delete', resource: 'Expense', resourceId: String(expense._id), summary: `حذف مصروف: ${expense.title}`, severity: 'warning' },
    req,
  );
  return ok(res, { message: 'تم حذف المصروف' });
};

/* ========================= نقاط البيع (POS) ========================= */

/**
 * بيع مباشر من نقاط البيع: ينشئ العميل إن لزم، يخصم المخزون، ويصدر فاتورة ودفعة.
 */
export const posSale = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const ctx = getTenantContext();
  const body = req.body as {
    customerId?: string | null;
    customerName?: string;
    customerPhone?: string;
    items: { partId?: string | null; description: string; quantity: number; unitPriceEgp: number }[];
    discountEgp: number;
    paymentMethod: string;
    amountPaidEgp: number;
    notes?: string;
  };

  if (!body.items?.length) throw ApiError.badRequest('أضف منتجًا واحدًا على الأقل');

  const organization = await OrganizationModel.findById(ctx!.organizationId).select('settings').lean();
  const taxRatePct = organization?.settings?.taxRate ?? 14;

  let customerId = body.customerId ? new Types.ObjectId(body.customerId) : null;

  // بيع نقدي بدون تسجيل عميل
  if (!customerId && body.customerPhone) {
    const phone = normalizeEgyptPhone(body.customerPhone);
    const existing = await CustomerModel.findOne({ phone }).select('_id').lean();
    if (existing) {
      customerId = existing._id as Types.ObjectId;
    } else {
      const count = await CustomerModel.countDocuments();
      const customer = await CustomerModel.create({
        organizationId: ctx!.organizationId,
        branchId: ctx!.branchId,
        code: `C${String(count + 1).padStart(5, '0')}`,
        fullName: body.customerName ?? 'عميل نقدي',
        phone,
        whatsapp: phone,
        createdBy: new Types.ObjectId(auth.userId),
      });
      customerId = customer._id as Types.ObjectId;
    }
  }

  const lines: {
    kind: 'accessory' | 'service';
    refId: Types.ObjectId | null;
    description: string;
    quantity: number;
    unitPriceEgp: number;
    totalEgp: number;
    warrantyDays: number;
  }[] = [];
  const stockOperations: { partId: string; quantity: number; description: string }[] = [];

  for (const item of body.items) {
    let unitPrice = item.unitPriceEgp;
    let description = item.description;

    if (item.partId) {
      const part = await PartModel.findById(item.partId).select('name sku pricing').lean();
      if (!part) throw ApiError.notFound(`القطعة غير موجودة: ${item.description}`);
      if (!unitPrice) unitPrice = part.pricing?.sellingPriceEgp ?? 0;
      description = description || part.name;
      stockOperations.push({ partId: String(part._id), quantity: item.quantity, description: part.name });
    }

    lines.push({
      kind: item.partId ? ('accessory' as const) : ('service' as const),
      refId: item.partId ? new Types.ObjectId(item.partId) : null,
      description,
      quantity: item.quantity,
      unitPriceEgp: unitPrice,
      totalEgp: money(item.quantity * unitPrice),
      warrantyDays: 0,
    });
  }

  const totals = computeTotals({
    lines,
    discountEgp: body.discountEgp,
    taxRatePct,
    taxInclusive: organization?.settings?.taxInclusive ?? true,
  });

  // خصم المخزون أولًا: إن فشل، لا تُصدر الفاتورة
  for (const op of stockOperations) {
    await applyStockMovement({
      partId: op.partId,
      type: 'sale_out',
      quantity: -op.quantity,
      ticketId: null,
      reason: 'بيع مباشر من نقاط البيع',
      actor: { userId: auth.userId, fullName: auth.fullName },
    });
  }

  const invoice = await withUniqueRetry(nextInvoiceNumber, (invoiceNumber) =>
    InvoiceModel.create({
      organizationId: ctx!.organizationId,
      branchId: ctx!.branchId,
      invoiceNumber,
      type: 'pos_sale',
      status: 'issued',
      customerId,
      lines,
      totals: { ...totals, taxRatePct, changeEgp: 0 },
      issuedAt: new Date(),
      notes: body.notes ?? '',
      createdBy: new Types.ObjectId(auth.userId),
      cashierId: new Types.ObjectId(auth.userId),
    }),
  );

  const tendered = body.amountPaidEgp || totals.totalEgp;
  const change = money(Math.max(0, tendered - totals.totalEgp));

  const payment = await withUniqueRetry(nextReceiptNumber, (receiptNumber) =>
    PaymentModel.create({
      organizationId: ctx!.organizationId,
      branchId: ctx!.branchId,
      receiptNumber,
      direction: 'in',
      method: body.paymentMethod,
      amountEgp: money(Math.min(tendered, totals.totalEgp)),
      invoiceId: invoice._id,
      customerId,
      tenderedEgp: money(tendered),
      changeEgp: change,
      recordedBy: new Types.ObjectId(auth.userId),
      paidAt: new Date(),
    }),
  );

  invoice.totals.paidEgp = payment.amountEgp;
  invoice.totals.dueEgp = money(Math.max(0, totals.totalEgp - payment.amountEgp));
  invoice.totals.changeEgp = change;
  invoice.status = invoice.totals.dueEgp <= 0.009 ? 'paid' : 'partially_paid';
  if (invoice.status === 'paid') invoice.paidAt = new Date();
  await invoice.save();

  await recordAudit(
    {
      action: 'payment',
      resource: 'Invoice',
      resourceId: String(invoice._id),
      summary: `بيع نقاط بيع ${invoice.invoiceNumber} بمبلغ ${totals.totalEgp} جنيه`,
    },
    req,
  );

  return created(res, {
    invoice: invoice.toObject(),
    payment: payment.toObject(),
    changeEgp: change,
    totals: invoice.totals,
  });
};

/* ======================= التقارير المالية ======================= */

/** ملخص مالي للفترة: إيراد، مصروفات، صافي، وتوزيع طرق الدفع */
export const financeSummary = async (req: Request, res: Response) => {
  const query = req.query as Record<string, unknown>;
  const range: Record<string, Date> = {};
  if (query.from) range.$gte = new Date(String(query.from));
  if (query.to) range.$lte = new Date(String(query.to));
  const hasRange = Object.keys(range).length > 0;

  const match = hasRange ? { paidAt: range } : {};

  const [revenue, refunds, expenses, byMethod, unpaid, invoicedTotal] = await Promise.all([
    PaymentModel.aggregate<{ total: number }>([
      { $match: { ...match, direction: 'in' } },
      { $group: { _id: null, total: { $sum: '$amountEgp' } } },
    ]),
    PaymentModel.aggregate<{ total: number }>([
      { $match: { ...match, direction: 'out' } },
      { $group: { _id: null, total: { $sum: '$amountEgp' } } },
    ]),
    ExpenseModel.aggregate<{ total: number }>([
      { $match: hasRange ? { incurredAt: range } : {} },
      { $group: { _id: null, total: { $sum: '$amountEgp' } } },
    ]),
    PaymentModel.aggregate<{ _id: string; total: number; count: number }>([
      { $match: match },
      { $group: { _id: '$method', total: { $sum: '$amountEgp' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
    ]),
    InvoiceModel.aggregate<{ due: number; count: number }>([
      { $match: { 'totals.dueEgp': { $gt: 0.009 }, status: { $nin: ['void', 'draft'] } } },
      { $group: { _id: null, due: { $sum: '$totals.dueEgp' }, count: { $sum: 1 } } },
    ]),
    InvoiceModel.aggregate<{ total: number }>([
      { $match: { ...(hasRange ? { issuedAt: range } : {}), status: { $nin: ['void', 'draft'] } } },
      { $group: { _id: null, total: { $sum: '$totals.totalEgp' } } },
    ]),
  ]);

  const revenueTotal = money(revenue[0]?.total ?? 0);
  const refundTotal = money(refunds[0]?.total ?? 0);
  const expenseTotal = money(expenses[0]?.total ?? 0);

  return ok(res, {
    period: { from: range.$gte ?? null, to: range.$lte ?? null },
    revenueEgp: revenueTotal,
    refundsEgp: refundTotal,
    netRevenueEgp: money(revenueTotal - refundTotal),
    expensesEgp: expenseTotal,
    profitEgp: money(revenueTotal - refundTotal - expenseTotal),
    invoicedTotalEgp: money(invoicedTotal[0]?.total ?? 0),
    receivablesEgp: money(unpaid[0]?.due ?? 0),
    unpaidInvoicesCount: unpaid[0]?.count ?? 0,
    byPaymentMethod: byMethod.map((m) => ({ method: m._id, count: m.count, totalEgp: money(m.total) })),
  });
};
