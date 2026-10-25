import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { InvoiceModel } from '../models/Invoice.js';
import { PaymentModel } from '../models/Payment.js';
import { ExpenseModel } from '../models/Expense.js';
import { PurchaseOrderModel } from '../models/PurchaseOrder.js';
import { StockMovementModel } from '../models/StockMovement.js';
import { CustomerModel } from '../models/Customer.js';
import { SupplierModel } from '../models/Supplier.js';
import { UserModel } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { ok } from '../utils/asyncHandler.js';
import { branchFilter } from '../middleware/auth.js';
import { money } from '../utils/money.js';

interface ReportPeriod {
  from: Date;
  to: Date;
  branchId: Types.ObjectId | null;
}

/** فترة التقرير: افتراضيًا من أول الشهر الحالي حتى الآن */
function reportPeriod(req: Request): ReportPeriod {
  const query = req.query as Record<string, unknown>;
  const to = query.to ? new Date(String(query.to)) : new Date();
  const from = query.from ? new Date(String(query.from)) : new Date(to.getFullYear(), to.getMonth(), 1);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw ApiError.badRequest('فترة التقرير غير صحيحة');
  }
  return { from, to, branchId: branchFilter(req) };
}

/**
 * قائمة الأرباح والخسائر.
 * الإيراد من التحصيلات الفعلية (وليس الفواتير) حتى يعكس النقد الداخل،
 * وتكلفة القطع من حركات الاستهلاك والبيع الفعلي.
 */
export const profitLossReport = async (req: Request, res: Response) => {
  const { from, to, branchId } = reportPeriod(req);
  const dateMatch = { $gte: from, $lte: to };
  const branchMatch = branchId ? { branchId: new Types.ObjectId(branchId) } : {};

  const [revenue, refunds, cogs, expenses, byCategory, byMethod] = await Promise.all([
    PaymentModel.aggregate<{ total: number; count: number }>([
      { $match: { ...branchMatch, direction: 'in', paidAt: dateMatch } },
      { $group: { _id: null, total: { $sum: '$amountEgp' }, count: { $sum: 1 } } },
    ]),
    PaymentModel.aggregate<{ total: number; count: number }>([
      { $match: { ...branchMatch, direction: 'out', isRefund: true, paidAt: dateMatch } },
      { $group: { _id: null, total: { $sum: '$amountEgp' }, count: { $sum: 1 } } },
    ]),
    StockMovementModel.aggregate<{ total: number; units: number }>([
      {
        $match: {
          ...branchMatch,
          type: { $in: ['repair_consume', 'sale_out'] },
          occurredAt: dateMatch,
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$totalCostEgp' },
          units: { $sum: { $abs: '$quantity' } },
        },
      },
    ]),
    ExpenseModel.aggregate<{ total: number }>([
      { $match: { ...branchMatch, incurredAt: dateMatch } },
      { $group: { _id: null, total: { $sum: '$amountEgp' } } },
    ]),
    ExpenseModel.aggregate<{ _id: string; total: number; count: number }>([
      { $match: { ...branchMatch, incurredAt: dateMatch } },
      { $group: { _id: '$category', total: { $sum: '$amountEgp' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
    ]),
    PaymentModel.aggregate<{ _id: string; total: number; count: number }>([
      { $match: { ...branchMatch, direction: 'in', paidAt: dateMatch } },
      { $group: { _id: '$method', total: { $sum: '$amountEgp' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
    ]),
  ]);

  const revenueEgp = money(revenue[0]?.total ?? 0);
  const refundsEgp = money(refunds[0]?.total ?? 0);
  const netRevenueEgp = money(revenueEgp - refundsEgp);
  const cogsEgp = money(cogs[0]?.total ?? 0);
  const grossProfitEgp = money(netRevenueEgp - cogsEgp);
  const expensesEgp = money(expenses[0]?.total ?? 0);
  const netProfitEgp = money(grossProfitEgp - expensesEgp);

  return ok(res, {
    period: { from, to },
    revenueEgp,
    receiptsCount: revenue[0]?.count ?? 0,
    refundsEgp,
    refundsCount: refunds[0]?.count ?? 0,
    netRevenueEgp,
    cogsEgp,
    partsConsumedUnits: cogs[0]?.units ?? 0,
    grossProfitEgp,
    grossMarginPct: netRevenueEgp ? money((grossProfitEgp / netRevenueEgp) * 100) : 0,
    expensesEgp,
    expensesByCategory: byCategory.map((c) => ({ category: c._id, count: c.count, totalEgp: money(c.total) })),
    netProfitEgp,
    netMarginPct: netRevenueEgp ? money((netProfitEgp / netRevenueEgp) * 100) : 0,
    revenueByMethod: byMethod.map((m) => ({ method: m._id, count: m.count, totalEgp: money(m.total) })),
  });
};

/** إقرار ضريبة القيمة المضافة: ضريبة المخرجات من الفواتير وضريبة المدخلات من أوامر الشراء */
export const vatReport = async (req: Request, res: Response) => {
  const { from, to, branchId } = reportPeriod(req);
  const dateMatch = { $gte: from, $lte: to };
  const branchMatch = branchId ? { branchId: new Types.ObjectId(branchId) } : {};

  const [outputAgg, purchaseOrders] = await Promise.all([
    InvoiceModel.aggregate<{ tax: number; total: number; net: number; count: number }>([
      {
        $match: {
          ...branchMatch,
          issuedAt: dateMatch,
          status: { $nin: ['void', 'draft'] },
        },
      },
      {
        $group: {
          _id: null,
          tax: { $sum: '$totals.taxEgp' },
          total: { $sum: '$totals.totalEgp' },
          net: { $sum: { $subtract: ['$totals.subtotalEgp', '$totals.discountEgp'] } },
          count: { $sum: 1 },
        },
      },
    ]),
    PurchaseOrderModel.find(
      {
        ...branchMatch,
        status: { $in: ['partially_received', 'received'] },
      },
      { lines: 1, totals: 1, supplierInvoiceDate: 1, receivedAt: 1, updatedAt: 1, poNumber: 1 },
    ).lean(),
  ]);

  let inputTaxEgp = 0;
  let inputNetEgp = 0;
  let purchaseDocsCount = 0;
  const purchaseDetails: { poNumber: string; date: Date | null; netEgp: number; taxEgp: number }[] = [];

  for (const po of purchaseOrders) {
    const receivedLines = po.lines.filter((l) => l.quantityReceived > 0);
    if (!receivedLines.length) continue;
    const receivedNet = receivedLines.reduce((acc, l) => acc + l.quantityReceived * l.unitCostEgp, 0);
    const grossNet = po.totals?.subtotalEgp || receivedNet;
    const discountRatio = grossNet > 0 ? Math.max(0, 1 - (po.totals?.discountEgp ?? 0) / grossNet) : 1;
    const net = money(receivedNet * discountRatio);
    const tax = money((net * (po.totals?.taxRatePct ?? 0)) / 100);
    const date = po.supplierInvoiceDate ?? po.receivedAt ?? po.updatedAt;
    if (!date || date < from || date > to) continue;
    inputNetEgp = money(inputNetEgp + net);
    inputTaxEgp = money(inputTaxEgp + tax);
    purchaseDocsCount += 1;
    purchaseDetails.push({ poNumber: po.poNumber, date, netEgp: net, taxEgp: tax });
  }

  const outputTaxEgp = money(outputAgg[0]?.tax ?? 0);

  return ok(res, {
    period: { from, to },
    output: {
      salesNetEgp: money(outputAgg[0]?.net ?? 0),
      salesGrossEgp: money(outputAgg[0]?.total ?? 0),
      taxEgp: outputTaxEgp,
      invoicesCount: outputAgg[0]?.count ?? 0,
    },
    input: {
      purchasesNetEgp: inputNetEgp,
      taxEgp: inputTaxEgp,
      purchaseOrdersCount: purchaseDocsCount,
      details: purchaseDetails.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0)),
    },
    netTaxDueEgp: money(outputTaxEgp - inputTaxEgp),
  });
};

/** أعمار الديون: الفواتير غير المسددة موزعة على فترات تأخر */
export const receivablesAging = async (req: Request, res: Response) => {
  const branchId = branchFilter(req);
  const filter: Record<string, unknown> = {
    'totals.dueEgp': { $gt: 0.009 },
    status: { $nin: ['void', 'draft'] },
  };
  if (branchId) filter.branchId = branchId;

  const invoices = await InvoiceModel.find(filter)
    .populate('customerId', 'fullName phone')
    .sort({ dueAt: 1, issuedAt: 1 })
    .limit(1000)
    .lean();

  const now = Date.now();
  const buckets = [
    { key: 'current', label: 'غير مستحقة بعد', minDays: -Infinity, maxDays: 0, count: 0, totalEgp: 0 },
    { key: 'd1_30', label: '1–30 يومًا', minDays: 1, maxDays: 30, count: 0, totalEgp: 0 },
    { key: 'd31_60', label: '31–60 يومًا', minDays: 31, maxDays: 60, count: 0, totalEgp: 0 },
    { key: 'd61_90', label: '61–90 يومًا', minDays: 61, maxDays: 90, count: 0, totalEgp: 0 },
    { key: 'd90_plus', label: 'أكثر من 90 يومًا', minDays: 91, maxDays: Infinity, count: 0, totalEgp: 0 },
  ];

  const items = invoices.map((invoice) => {
    const dueDate = invoice.dueAt ?? invoice.issuedAt ?? invoice.createdAt;
    const daysOverdue = Math.floor((now - new Date(dueDate).getTime()) / 86_400_000);
    const bucket = buckets.find((b) => daysOverdue >= b.minDays && daysOverdue <= b.maxDays) ?? buckets[4];
    bucket.count += 1;
    bucket.totalEgp = money(bucket.totalEgp + (invoice.totals?.dueEgp ?? 0));
    const customer = invoice.customerId as unknown as { fullName?: string; phone?: string } | null;
    return {
      invoiceId: String(invoice._id),
      invoiceNumber: invoice.invoiceNumber,
      customerName: customer?.fullName ?? 'عميل نقدي',
      customerPhone: customer?.phone ?? '',
      issueDate: invoice.issuedAt,
      dueDate,
      daysOverdue,
      bucket: bucket.key,
      totalEgp: money(invoice.totals?.totalEgp ?? 0),
      dueEgp: money(invoice.totals?.dueEgp ?? 0),
    };
  });

  return ok(res, {
    totalDueEgp: money(items.reduce((acc, i) => acc + i.dueEgp, 0)),
    invoicesCount: items.length,
    buckets,
    items,
  });
};

/** تقرير الكاشير: مجاميع التحصيل والاسترداد لكل موظف */
export const cashierReport = async (req: Request, res: Response) => {
  const { from, to, branchId } = reportPeriod(req);
  const branchMatch = branchId ? { branchId: new Types.ObjectId(branchId) } : {};

  const rows = await PaymentModel.aggregate<{
    _id: { userId: Types.ObjectId; direction: string };
    total: number;
    count: number;
  }>([
    { $match: { ...branchMatch, paidAt: { $gte: from, $lte: to } } },
    {
      $group: {
        _id: { userId: '$recordedBy', direction: '$direction' },
        total: { $sum: '$amountEgp' },
        count: { $sum: 1 },
      },
    },
  ]);

  const userIds = [...new Set(rows.map((r) => String(r._id.userId)))];
  const users = await UserModel.find({ _id: { $in: userIds } }).select('fullName username role').lean();
  const userMap = new Map(users.map((u) => [String(u._id), u]));

  const byUser = new Map<
    string,
    {
      userId: string;
      fullName: string;
      username: string;
      role: string;
      collectionsEgp: number;
      refundsEgp: number;
      transactions: number;
    }
  >();
  for (const row of rows) {
    const key = String(row._id.userId);
    const user = userMap.get(key);
    let entry = byUser.get(key);
    if (!entry) {
      entry = {
        userId: key,
        fullName: user?.fullName ?? '—',
        username: user?.username ?? '',
        role: String(user?.role ?? ''),
        collectionsEgp: 0,
        refundsEgp: 0,
        transactions: 0,
      };
      byUser.set(key, entry);
    }
    if (row._id.direction === 'in') entry.collectionsEgp = money(entry.collectionsEgp + row.total);
    else entry.refundsEgp = money(entry.refundsEgp + row.total);
    entry.transactions += row.count;
  }

  const items = [...byUser.values()].sort((a, b) => b.collectionsEgp - a.collectionsEgp);
  return ok(res, {
    period: { from, to },
    totalCollectionsEgp: money(items.reduce((acc, i) => acc + i.collectionsEgp, 0)),
    totalRefundsEgp: money(items.reduce((acc, i) => acc + i.refundsEgp, 0)),
    items,
  });
};

/** كشف حساب عميل مع رصيد افتتاحي ورصيد ختامي */
export const customerStatement = async (req: Request, res: Response) => {
  const { from, to, branchId } = reportPeriod(req);
  const branchMatch = branchId ? { branchId: new Types.ObjectId(branchId) } : {};
  const customer = await CustomerModel.findById(String(req.params.id)).select('fullName phone code').lean();
  if (!customer) throw ApiError.notFound('العميل غير موجود');

  const baseInvoice = { customerId: customer._id, status: { $nin: ['void', 'draft'] }, ...branchMatch };
  const basePayment = { customerId: customer._id, ...branchMatch };

  const [openingInvoices, openingPayments, periodInvoices, periodPayments] = await Promise.all([
    InvoiceModel.aggregate<{ total: number }>([
      { $match: { ...baseInvoice, issuedAt: { $lt: from } } },
      { $group: { _id: null, total: { $sum: '$totals.totalEgp' } } },
    ]),
    PaymentModel.aggregate<{ total: number }>([
      {
        $match: {
          ...basePayment,
          paidAt: { $lt: from },
          $or: [{ direction: 'in' }, { isRefund: true }],
        },
      },
      {
        $group: {
          _id: null,
          total: {
            $sum: { $cond: [{ $eq: ['$direction', 'in'] }, '$amountEgp', { $multiply: ['$amountEgp', -1] }] },
          },
        },
      },
    ]),
    InvoiceModel.find({ ...baseInvoice, issuedAt: { $gte: from, $lte: to } })
      .select('invoiceNumber issuedAt totals.totalEgp totals.dueEgp type status')
      .lean(),
    PaymentModel.find({
      ...basePayment,
      paidAt: { $gte: from, $lte: to },
      $or: [{ direction: 'in' }, { isRefund: true }],
    })
      .select('receiptNumber paidAt amountEgp method direction isRefund invoiceId')
      .populate('invoiceId', 'invoiceNumber')
      .lean(),
  ]);

  const openingBalanceEgp = money((openingInvoices[0]?.total ?? 0) - (openingPayments[0]?.total ?? 0));

  const entries = [
    ...periodInvoices.map((invoice) => ({
      date: invoice.issuedAt ?? invoice.createdAt,
      kind: 'invoice' as const,
      reference: invoice.invoiceNumber,
      description: `فاتورة ${invoice.type ?? ''}`.trim(),
      debitEgp: money(invoice.totals?.totalEgp ?? 0),
      creditEgp: 0,
    })),
    ...periodPayments.map((payment) => {
      const isRefund = payment.direction === 'out' || payment.isRefund;
      const invoiceNumber = (payment.invoiceId as unknown as { invoiceNumber?: string } | null)?.invoiceNumber;
      return {
        date: payment.paidAt,
        kind: isRefund ? ('refund' as const) : ('payment' as const),
        reference: payment.receiptNumber,
        description: `${isRefund ? 'استرداد' : 'تحصيل'}${invoiceNumber ? ` — ${invoiceNumber}` : ''} (${payment.method})`,
        debitEgp: isRefund ? money(payment.amountEgp) : 0,
        creditEgp: isRefund ? 0 : money(payment.amountEgp),
      };
    }),
  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  let running = openingBalanceEgp;
  const enriched = entries.map((entry) => {
    running = money(running + entry.debitEgp - entry.creditEgp);
    return { ...entry, balanceEgp: running };
  });

  return ok(res, {
    customer: { id: String(customer._id), fullName: customer.fullName, phone: customer.phone, code: customer.code },
    period: { from, to },
    openingBalanceEgp,
    closingBalanceEgp: running,
    totalDebitEgp: money(entries.reduce((acc, e) => acc + e.debitEgp, 0)),
    totalCreditEgp: money(entries.reduce((acc, e) => acc + e.creditEgp, 0)),
    entries: enriched,
  });
};

/** كشف حساب مورد: أوامر الشراء مقابل المدفوعات */
export const supplierStatement = async (req: Request, res: Response) => {
  const { from, to, branchId } = reportPeriod(req);
  const branchMatch = branchId ? { branchId: new Types.ObjectId(branchId) } : {};
  const supplierId = new Types.ObjectId(String(req.params.id));
  const supplier = await SupplierModel.findById(supplierId).select('name phone code paymentTerms').lean();
  if (!supplier) throw ApiError.notFound('المورد غير موجود');

  const poBase = { supplierId, status: { $nin: ['draft', 'cancelled'] }, ...branchMatch };
  const payBase = { supplierId, direction: 'out', ...branchMatch };

  const [openingOrders, openingPayments, periodOrders, periodPayments] = await Promise.all([
    PurchaseOrderModel.aggregate<{ total: number }>([
      { $match: { ...poBase, createdAt: { $lt: from } } },
      { $group: { _id: null, total: { $sum: '$totals.totalEgp' } } },
    ]),
    PaymentModel.aggregate<{ total: number }>([
      { $match: { ...payBase, paidAt: { $lt: from } } },
      { $group: { _id: null, total: { $sum: '$amountEgp' } } },
    ]),
    PurchaseOrderModel.find({ ...poBase, createdAt: { $gte: from, $lte: to } })
      .select('poNumber createdAt totals.totalEgp totals.paidEgp status')
      .lean(),
    PaymentModel.find({ ...payBase, paidAt: { $gte: from, $lte: to } })
      .select('receiptNumber paidAt amountEgp method purchaseOrderId')
      .populate('purchaseOrderId', 'poNumber')
      .lean(),
  ]);

  const openingBalanceEgp = money((openingOrders[0]?.total ?? 0) - (openingPayments[0]?.total ?? 0));

  const entries = [
    ...periodOrders.map((po) => ({
      date: po.createdAt,
      kind: 'purchase' as const,
      reference: po.poNumber,
      description: `أمر شراء (${po.status})`,
      debitEgp: money(po.totals?.totalEgp ?? 0),
      creditEgp: 0,
    })),
    ...periodPayments.map((payment) => {
      const poNumber = (payment.purchaseOrderId as unknown as { poNumber?: string } | null)?.poNumber;
      return {
        date: payment.paidAt,
        kind: 'payment' as const,
        reference: payment.receiptNumber,
        description: `سداد${poNumber ? ` — ${poNumber}` : ''} (${payment.method})`,
        debitEgp: 0,
        creditEgp: money(payment.amountEgp),
      };
    }),
  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  let running = openingBalanceEgp;
  const enriched = entries.map((entry) => {
    running = money(running + entry.debitEgp - entry.creditEgp);
    return { ...entry, balanceEgp: running };
  });

  return ok(res, {
    supplier: { id: String(supplier._id), name: supplier.name, phone: supplier.phone, code: supplier.code },
    period: { from, to },
    openingBalanceEgp,
    closingBalanceEgp: running,
    entries: enriched,
  });
};
