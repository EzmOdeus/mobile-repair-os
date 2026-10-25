import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { PurchaseOrderModel } from '../models/PurchaseOrder.js';
import { SupplierModel } from '../models/Supplier.js';
import { PartModel } from '../models/Part.js';
import { BranchModel } from '../models/Branch.js';
import { OrganizationModel } from '../models/Organization.js';
import { PaymentModel } from '../models/Payment.js';
import { ApiError } from '../utils/ApiError.js';
import { created, ok, paginated } from '../utils/asyncHandler.js';
import { parseCsv, parseListQuery, parseSort, regexSearch } from '../utils/queryHelpers.js';
import { branchFilter, getAuth, requireBranchAccess } from '../middleware/auth.js';
import { getTenantContext } from '../context/tenantContext.js';
import { recordAudit } from '../services/auditService.js';
import { computeTotals, money } from '../utils/money.js';
import { nextPurchaseOrderNumber, nextReceiptNumber, withUniqueRetry } from '../services/numberingService.js';
import { applyStockMovement } from '../services/inventoryService.js';
import { resolveOpenShiftForDate } from '../services/shiftService.js';

interface PurchaseLineInput {
  partId: string;
  description?: string;
  quantityOrdered: number;
  unitCostEgp: number;
  warrantyDays?: number;
  notes?: string;
}

/** يحل فرع أمر الشراء: الممرر صراحةً أو الفرع النشط في الطلب */
async function resolveBranchId(input?: string | null): Promise<Types.ObjectId> {
  const ctx = getTenantContext();
  const candidate = input ?? (ctx?.branchId ? String(ctx.branchId) : null);
  if (!candidate) throw ApiError.badRequest('حدد الفرع الذي سيُستلم فيه أمر الشراء');

  const branch = await BranchModel.findOne({ _id: candidate, isActive: true }).select('_id').lean();
  if (!branch) throw ApiError.notFound('الفرع غير موجود أو موقوف');
  return branch._id as Types.ObjectId;
}

async function partsMapFor(partIds: string[]): Promise<Map<string, { name: string; sku: string }>> {
  const parts = await PartModel.find({ _id: { $in: partIds } })
    .select('name sku')
    .lean();
  const map = new Map(parts.map((p) => [String(p._id), { name: p.name, sku: p.sku }]));
  const missing = partIds.filter((id) => !map.has(id));
  if (missing.length) throw ApiError.notFound(`قطع غير موجودة: ${missing.join(', ')}`);
  return map;
}

function buildLines(
  rawLines: PurchaseLineInput[],
  parts: Map<string, { name: string; sku: string }>,
): {
  partId: Types.ObjectId;
  description: string;
  quantityOrdered: number;
  quantityReceived: number;
  unitCostEgp: number;
  totalEgp: number;
  warrantyDays: number;
  notes: string;
}[] {
  return rawLines.map((line) => {
    const part = parts.get(line.partId)!;
    const unitCostEgp = money(line.unitCostEgp);
    return {
      partId: new Types.ObjectId(line.partId),
      description: line.description?.trim() || `${part.name} (${part.sku})`,
      quantityOrdered: line.quantityOrdered,
      quantityReceived: 0,
      unitCostEgp,
      totalEgp: money(line.quantityOrdered * unitCostEgp),
      warrantyDays: line.warrantyDays ?? 0,
      notes: line.notes ?? '',
    };
  });
}

/** إعادة حساب إجماليات أمر شراء من بنوده الحالية */
function recalcTotals(po: {
  lines: { quantityOrdered: number; unitCostEgp: number }[];
  totals: { discountEgp: number; taxRatePct: number; paidEgp: number };
}) {
  const totals = computeTotals({
    lines: po.lines.map((l) => ({ quantity: l.quantityOrdered, unitPriceEgp: l.unitCostEgp })),
    discountEgp: po.totals.discountEgp,
    taxRatePct: po.totals.taxRatePct,
    taxInclusive: false,
    paidEgp: po.totals.paidEgp,
  });
  po.totals = {
    ...totals,
    taxRatePct: po.totals.taxRatePct,
  };
}

export const listPurchaseOrders = async (req: Request, res: Response) => {
  const { page, limit, skip } = parseListQuery(req.query as Record<string, unknown>, 30);
  const sort = parseSort(req.query as Record<string, unknown>, ['createdAt', 'expectedAt', 'totals.totalEgp'], { createdAt: -1 });
  const query = req.query as Record<string, unknown>;

  const filter: Record<string, unknown> = {};
  const search = regexSearch(query.q);
  if (search) filter.$or = [{ poNumber: search }, { supplierInvoiceNumber: search }];
  const statuses = parseCsv(query.status);
  if (statuses.length) filter.status = { $in: statuses };
  if (query.supplierId) filter.supplierId = query.supplierId;
  const scopedBranch = branchFilter(req);
  if (scopedBranch) filter.branchId = scopedBranch;
  if (query.payment === 'unpaid') filter['totals.dueEgp'] = { $gt: 0.009 };
  if (query.from || query.to) {
    const range: Record<string, Date> = {};
    if (query.from) range.$gte = new Date(String(query.from));
    if (query.to) range.$lte = new Date(String(query.to));
    filter.createdAt = range;
  }

  const aggregateMatch: Record<string, unknown> = { ...filter };
  if (typeof aggregateMatch.supplierId === 'string' && Types.ObjectId.isValid(aggregateMatch.supplierId)) {
    aggregateMatch.supplierId = new Types.ObjectId(aggregateMatch.supplierId);
  }

  const [items, total, totalsAgg] = await Promise.all([
    PurchaseOrderModel.find(filter)
      .populate('supplierId', 'name phone')
      .populate('branchId', 'name code')
      .populate('createdBy', 'fullName')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    PurchaseOrderModel.countDocuments(filter),
    PurchaseOrderModel.aggregate<{ _id: string; count: number; totalEgp: number; dueEgp: number }>([
      { $match: aggregateMatch },
      { $group: { _id: '$status', count: { $sum: 1 }, totalEgp: { $sum: '$totals.totalEgp' }, dueEgp: { $sum: '$totals.dueEgp' } } },
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
      byStatus: totalsAgg.map((a) => ({
        status: a._id,
        count: a.count,
        totalEgp: money(a.totalEgp),
        dueEgp: money(a.dueEgp),
      })),
      dueEgp: money(totalsAgg.reduce((acc, a) => acc + a.dueEgp, 0)),
    },
  });
};

export const getPurchaseOrder = async (req: Request, res: Response) => {
  const po = await PurchaseOrderModel.findById(req.params.id)
    .populate('supplierId', 'name phone email contactPerson paymentTerms')
    .populate('branchId', 'name code')
    .populate('lines.partId', 'name sku category grade')
    .populate('createdBy', 'fullName')
    .populate('orderedBy', 'fullName')
    .populate('receivedBy', 'fullName')
    .lean();
  if (!po) throw ApiError.notFound('أمر الشراء غير موجود');
  requireBranchAccess(req, po.branchId);

  const payments = await PaymentModel.find({ purchaseOrderId: po._id }).sort({ paidAt: -1 }).lean();
  return ok(res, { purchaseOrder: po, payments });
};

export const createPurchaseOrder = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const ctx = getTenantContext();
  const body = req.body as {
    branchId?: string;
    supplierId: string;
    expectedAt?: string | null;
    supplierInvoiceNumber: string;
    supplierInvoiceDate?: string | null;
    lines: PurchaseLineInput[];
    discountEgp: number;
    taxRatePct?: number;
    notes: string;
  };

  const supplier = await SupplierModel.findOne({ _id: body.supplierId, isActive: true }).select('name').lean();
  if (!supplier) throw ApiError.notFound('المورد غير موجود أو موقوف');

  const branchId = await resolveBranchId(body.branchId);
  requireBranchAccess(req, branchId);
  const parts = await partsMapFor(body.lines.map((l) => l.partId));
  const lines = buildLines(body.lines, parts);

  const organization = await OrganizationModel.findById(ctx!.organizationId).select('settings').lean();
  const taxRatePct = body.taxRatePct ?? organization?.settings?.taxRate ?? 14;

  const totals = computeTotals({
    lines: lines.map((l) => ({ quantity: l.quantityOrdered, unitPriceEgp: l.unitCostEgp })),
    discountEgp: body.discountEgp,
    taxRatePct,
    taxInclusive: false,
  });

  const po = await withUniqueRetry(nextPurchaseOrderNumber, (poNumber) =>
    PurchaseOrderModel.create({
      organizationId: ctx!.organizationId,
      branchId,
      poNumber,
      supplierId: new Types.ObjectId(body.supplierId),
      status: 'draft',
      supplierInvoiceNumber: body.supplierInvoiceNumber,
      supplierInvoiceDate: body.supplierInvoiceDate ? new Date(body.supplierInvoiceDate) : null,
      expectedAt: body.expectedAt ? new Date(body.expectedAt) : null,
      lines,
      totals: { ...totals, taxRatePct },
      notes: body.notes,
      createdBy: new Types.ObjectId(auth.userId),
    }),
  );

  await recordAudit(
    {
      action: 'create',
      resource: 'PurchaseOrder',
      resourceId: String(po._id),
      summary: `أمر شراء ${po.poNumber} من ${supplier.name} بمبلغ ${totals.totalEgp} جنيه`,
    },
    req,
  );

  return created(res, po.toObject());
};

export const updatePurchaseOrder = async (req: Request, res: Response) => {
  const ctx = getTenantContext();
  const body = req.body as Partial<{
    supplierId: string;
    expectedAt: string | null;
    supplierInvoiceNumber: string;
    supplierInvoiceDate: string | null;
    lines: PurchaseLineInput[];
    discountEgp: number;
    taxRatePct: number;
    notes: string;
  }>;

  const po = await PurchaseOrderModel.findById(req.params.id);
  if (!po) throw ApiError.notFound('أمر الشراء غير موجود');
  requireBranchAccess(req, po.branchId);
  if (po.status !== 'draft') throw ApiError.businessRule('لا يمكن تعديل أمر شراء بعد اعتماده');

  if (body.supplierId) {
    const supplier = await SupplierModel.findOne({ _id: body.supplierId, isActive: true }).select('_id').lean();
    if (!supplier) throw ApiError.notFound('المورد غير موجود أو موقوف');
    po.supplierId = new Types.ObjectId(body.supplierId) as unknown as typeof po.supplierId;
  }

  if (body.lines) {
    const parts = await partsMapFor(body.lines.map((l) => l.partId));
    po.lines = buildLines(body.lines, parts) as unknown as typeof po.lines;
  }

  if (body.expectedAt !== undefined) po.expectedAt = body.expectedAt ? new Date(body.expectedAt) : null;
  if (body.supplierInvoiceNumber !== undefined) po.supplierInvoiceNumber = body.supplierInvoiceNumber;
  if (body.supplierInvoiceDate !== undefined) {
    po.supplierInvoiceDate = body.supplierInvoiceDate ? new Date(body.supplierInvoiceDate) : null;
  }
  if (body.notes !== undefined) po.notes = body.notes;
  if (body.discountEgp !== undefined) po.totals.discountEgp = body.discountEgp;
  if (body.taxRatePct !== undefined) po.totals.taxRatePct = body.taxRatePct;

  if (body.lines || body.discountEgp !== undefined || body.taxRatePct !== undefined) {
    const organization = await OrganizationModel.findById(ctx!.organizationId).select('settings').lean();
    if (body.taxRatePct === undefined && !po.totals.taxRatePct) {
      po.totals.taxRatePct = organization?.settings?.taxRate ?? 14;
    }
    recalcTotals(po as unknown as Parameters<typeof recalcTotals>[0]);
  }

  await po.save();

  await recordAudit(
    { action: 'update', resource: 'PurchaseOrder', resourceId: String(po._id), summary: `تعديل أمر شراء ${po.poNumber}` },
    req,
  );

  return ok(res, po.toObject());
};

/** اعتماد أمر الشراء: ينتقل من مسودة إلى «تم الطلب» وتُحتسب الكميات كوارد متوقع */
export const orderPurchaseOrder = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const po = await PurchaseOrderModel.findById(req.params.id);
  if (!po) throw ApiError.notFound('أمر الشراء غير موجود');
  requireBranchAccess(req, po.branchId);
  if (po.status !== 'draft') throw ApiError.businessRule('أمر الشراء معتمد بالفعل');

  const supplier = await SupplierModel.findOne({ _id: po.supplierId, isActive: true }).select('name').lean();
  if (!supplier) throw ApiError.businessRule('المورد موقوف — لا يمكن اعتماد أمر شراء له');

  for (const line of po.lines) {
    await applyStockMovement({
      partId: line.partId,
      type: 'purchase_order',
      quantity: line.quantityOrdered,
      unitCostEgp: line.unitCostEgp,
      supplierId: po.supplierId,
      branchId: po.branchId,
      reason: `وارد متوقع — أمر شراء ${po.poNumber}`,
      reference: po.poNumber,
      actor: { userId: auth.userId, fullName: auth.fullName },
    });
  }

  po.status = 'ordered';
  po.orderedAt = new Date();
  po.orderedBy = new Types.ObjectId(auth.userId) as unknown as typeof po.orderedBy;
  await po.save();

  await SupplierModel.updateOne({ _id: po.supplierId }, { $set: { 'performance.lastOrderAt': new Date() } });

  await recordAudit(
    {
      action: 'order',
      resource: 'PurchaseOrder',
      resourceId: String(po._id),
      summary: `اعتماد أمر شراء ${po.poNumber} من ${supplier.name} — ${po.lines.length} بند`,
    },
    req,
  );

  return ok(res, po.toObject());
};

/**
 * استلام كميات (كليًا أو جزئيًا).
 * كل بند مستلم يُنشئ حركة `purchase_in` مع خصم الوارد المتوقع بنفس الكمية،
 * ويُنشئ دفعة توريد عند تمرير `batchCode` لتمكين تتبع المصدر والضمان.
 */
export const receivePurchaseOrder = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const body = req.body as {
    lines: { lineId: string; quantity: number; unitCostEgp?: number; batchCode: string; notes: string }[];
    supplierInvoiceNumber?: string;
    supplierInvoiceDate?: string | null;
    notes?: string;
  };

  const po = await PurchaseOrderModel.findById(req.params.id);
  if (!po) throw ApiError.notFound('أمر الشراء غير موجود');
  requireBranchAccess(req, po.branchId);
  if (!['ordered', 'partially_received'].includes(po.status)) {
    throw ApiError.businessRule('لا يمكن الاستلام إلا لأمر شراء معتمد وغير مكتمل');
  }

  const supplier = await SupplierModel.findById(po.supplierId).select('name').lean();
  if (!supplier) throw ApiError.notFound('المورد غير موجود');

  let receivedValue = 0;
  let receivedQty = 0;

  for (const input of body.lines) {
    const line = po.lines.find((l) => String(l._id) === input.lineId);
    if (!line) throw ApiError.notFound(`بند أمر الشراء غير موجود: ${input.lineId}`);

    const remaining = line.quantityOrdered - line.quantityReceived;
    if (input.quantity > remaining + 0.0001) {
      throw ApiError.businessRule(
        `الكمية المستلمة من «${line.description}» تتجاوز المتبقي (${remaining})`,
        { lineId: input.lineId, remaining },
      );
    }
    if (input.quantity <= 0) continue;

    const unitCost = money(input.unitCostEgp ?? line.unitCostEgp);
    if (input.unitCostEgp !== undefined) {
      line.unitCostEgp = unitCost;
      line.totalEgp = money(line.quantityOrdered * unitCost);
    }

    await applyStockMovement({
      partId: line.partId,
      type: 'purchase_in',
      quantity: input.quantity,
      incomingDelta: -input.quantity,
      unitCostEgp: unitCost,
      supplierId: po.supplierId,
      batchCode: input.batchCode?.trim() || `${po.poNumber}-${String(line._id).slice(-5)}`,
      branchId: po.branchId,
      reason: `توريد — أمر شراء ${po.poNumber}`,
      reference: po.poNumber,
      actor: { userId: auth.userId, fullName: auth.fullName },
    });

    line.quantityReceived = money(line.quantityReceived + input.quantity);
    receivedValue += input.quantity * unitCost;
    receivedQty += input.quantity;
  }

  if (receivedQty > 0) {
    if (body.supplierInvoiceNumber !== undefined) po.supplierInvoiceNumber = body.supplierInvoiceNumber;
    if (body.supplierInvoiceDate !== undefined) {
      po.supplierInvoiceDate = body.supplierInvoiceDate ? new Date(body.supplierInvoiceDate) : null;
    }
    if (body.notes !== undefined) po.notes = body.notes;

    recalcTotals(po as unknown as Parameters<typeof recalcTotals>[0]);

    const fullyReceived = po.lines.every((l) => l.quantityReceived >= l.quantityOrdered - 0.0001);
    po.status = fullyReceived ? 'received' : 'partially_received';
    if (fullyReceived) po.receivedAt = new Date();
    po.receivedBy = new Types.ObjectId(auth.userId) as unknown as typeof po.receivedBy;
    await po.save();

    await SupplierModel.updateOne(
      { _id: po.supplierId },
      {
        $inc: {
          'performance.totalSupplied': receivedQty,
          'performance.totalPurchasedEgp': money(receivedValue),
        },
      },
    );

    // آخر تكلفة شراء تُستخدم في تسعير القطع وتقييم المخزون
    for (const input of body.lines) {
      const line = po.lines.find((l) => String(l._id) === input.lineId);
      if (!line || input.quantity <= 0) continue;
      await PartModel.updateOne(
        { _id: line.partId },
        { $set: { 'pricing.lastCostEgp': line.unitCostEgp } },
      );
    }

    await recordAudit(
      {
        action: 'receive',
        resource: 'PurchaseOrder',
        resourceId: String(po._id),
        summary: `استلام ${money(receivedQty)} وحدة من أمر الشراء ${po.poNumber} بقيمة ${money(receivedValue)} جنيه`,
      },
      req,
    );
  } else {
    await po.save();
  }

  return ok(res, po.toObject());
};

/** إلغاء أمر شراء: يحجز الكميات غير المستلمة من الوارد المتوقع */
export const cancelPurchaseOrder = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const { reason } = req.body as { reason: string };

  const po = await PurchaseOrderModel.findById(req.params.id);
  if (!po) throw ApiError.notFound('أمر الشراء غير موجود');
  requireBranchAccess(req, po.branchId);
  if (po.status === 'cancelled') throw ApiError.businessRule('أمر الشراء ملغى بالفعل');
  if (po.status === 'received') throw ApiError.businessRule('لا يمكن إلغاء أمر شراء استُلم بالكامل');
  if ((po.totals.paidEgp ?? 0) > 0.009) {
    throw ApiError.businessRule('أمر الشراء عليه مدفوعات — سجّل استردادًا من المورد أولًا');
  }

  if (po.status !== 'draft') {
    for (const line of po.lines) {
      const remaining = line.quantityOrdered - line.quantityReceived;
      if (remaining <= 0.0001) continue;
      await applyStockMovement({
        partId: line.partId,
        type: 'purchase_cancel',
        quantity: remaining,
        supplierId: po.supplierId,
        branchId: po.branchId,
        reason: `إلغاء أمر شراء ${po.poNumber}: ${reason}`,
        reference: po.poNumber,
        actor: { userId: auth.userId, fullName: auth.fullName },
      });
    }
  }

  po.status = 'cancelled';
  po.cancelledAt = new Date();
  po.cancelReason = reason;
  await po.save();

  await recordAudit(
    {
      action: 'cancel',
      resource: 'PurchaseOrder',
      resourceId: String(po._id),
      summary: `إلغاء أمر شراء ${po.poNumber}: ${reason}`,
      severity: 'warning',
    },
    req,
  );

  return ok(res, po.toObject());
};

/* ======================= سداد الموردين وحساباتهم ======================= */

export const recordSupplierPayment = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const ctx = getTenantContext();
  const body = req.body as {
    supplierId: string;
    purchaseOrderId?: string | null;
    amountEgp: number;
    method: string;
    reference: string;
    bankName: string;
    notes: string;
    paidAt?: string;
  };

  const supplier = await SupplierModel.findById(body.supplierId).select('name').lean();
  if (!supplier) throw ApiError.notFound('المورد غير موجود');

  const po = body.purchaseOrderId ? await PurchaseOrderModel.findById(body.purchaseOrderId) : null;
  if (body.purchaseOrderId && !po) throw ApiError.notFound('أمر الشراء غير موجود');
  if (po) {
    requireBranchAccess(req, po.branchId);
    if (String(po.supplierId) !== body.supplierId) throw ApiError.badRequest('أمر الشراء لا يخص هذا المورد');
    if (po.status === 'draft') throw ApiError.businessRule('اعتمد أمر الشراء قبل سداده');
    if (po.status === 'cancelled') throw ApiError.businessRule('أمر الشراء ملغى');
    const due = po.totals.dueEgp ?? 0;
    if (body.amountEgp > due + 0.009) {
      throw ApiError.businessRule(`المبلغ أكبر من المتبقي على أمر الشراء (${due} جنيه)`, { dueEgp: due });
    }
    if (due <= 0.009) throw ApiError.businessRule('أمر الشراء مسدد بالكامل');
  }

  const paidAt = body.paidAt ? new Date(body.paidAt) : new Date();
  const shiftId = await resolveOpenShiftForDate(po?.branchId ?? ctx!.branchId, paidAt);

  const payment = await withUniqueRetry(nextReceiptNumber, (receiptNumber) =>
    PaymentModel.create({
      organizationId: ctx!.organizationId,
      branchId: po?.branchId ?? ctx!.branchId,
      receiptNumber,
      direction: 'out',
      method: body.method,
      amountEgp: money(body.amountEgp),
      supplierId: new Types.ObjectId(body.supplierId),
      purchaseOrderId: po?._id ?? null,
      shiftId,
      reference: body.reference,
      bankName: body.bankName,
      notes: body.notes,
      recordedBy: new Types.ObjectId(auth.userId),
      paidAt,
    }),
  );

  if (po) {
    po.totals.paidEgp = money((po.totals.paidEgp ?? 0) + body.amountEgp);
    po.totals.dueEgp = money(Math.max(0, (po.totals.totalEgp ?? 0) - po.totals.paidEgp));
    await po.save();
  }

  await recordAudit(
    {
      action: 'supplier_payment',
      resource: 'Supplier',
      resourceId: body.supplierId,
      summary: `سداد ${money(body.amountEgp)} جنيه لـ${supplier.name}${po ? ` على ${po.poNumber}` : ''}`,
    },
    req,
  );

  return created(res, {
    payment: payment.toObject(),
    purchaseOrder: po
      ? { id: String(po._id), poNumber: po.poNumber, totals: po.totals, status: po.status }
      : null,
  });
};

/** حسابات الموردين: المتبقي على أوامر الشراء مفتوحة/مستلمة لكل مورد */
export const payablesReport = async (_req: Request, res: Response) => {
  const rows = await PurchaseOrderModel.aggregate<{
    _id: Types.ObjectId;
    supplierName: string;
    dueEgp: number;
    totalEgp: number;
    paidEgp: number;
    orders: number;
    oldestOrderAt: Date | null;
    lastPaymentAt: Date | null;
  }>([
    {
      $match: {
        status: { $in: ['ordered', 'partially_received', 'received'] },
        'totals.dueEgp': { $gt: 0.009 },
      },
    },
    { $sort: { createdAt: 1 } },
    {
      $group: {
        _id: '$supplierId',
        dueEgp: { $sum: '$totals.dueEgp' },
        totalEgp: { $sum: '$totals.totalEgp' },
        paidEgp: { $sum: '$totals.paidEgp' },
        orders: { $sum: 1 },
        oldestOrderAt: { $first: '$createdAt' },
      },
    },
    { $sort: { dueEgp: -1 } },
  ]);

  const supplierIds = rows.map((r) => r._id);
  const [suppliers, lastPayments] = await Promise.all([
    SupplierModel.find({ _id: { $in: supplierIds } }).select('name phone').lean(),
    PaymentModel.aggregate<{ _id: Types.ObjectId; lastPaidAt: Date }>([
      { $match: { supplierId: { $in: supplierIds }, direction: 'out' } },
      { $group: { _id: '$supplierId', lastPaidAt: { $max: '$paidAt' } } },
    ]),
  ]);
  const supplierMap = new Map(suppliers.map((s) => [String(s._id), s]));
  const lastPaymentMap = new Map(lastPayments.map((p) => [String(p._id), p.lastPaidAt]));

  const items = rows.map((row) => ({
    supplierId: String(row._id),
    supplierName: supplierMap.get(String(row._id))?.name ?? 'مورد محذوف',
    supplierPhone: supplierMap.get(String(row._id))?.phone ?? '',
    dueEgp: money(row.dueEgp),
    totalEgp: money(row.totalEgp),
    paidEgp: money(row.paidEgp),
    orders: row.orders,
    oldestOrderAt: row.oldestOrderAt,
    lastPaymentAt: lastPaymentMap.get(String(row._id)) ?? null,
  }));

  return ok(res, {
    totalDueEgp: money(items.reduce((acc, i) => acc + i.dueEgp, 0)),
    suppliersCount: items.length,
    items,
  });
};
