import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { RepairTicketModel } from '../models/RepairTicket.js';
import { CustomerModel } from '../models/Customer.js';
import { DeviceModel } from '../models/Device.js';
import { PartModel } from '../models/Part.js';
import { PaymentModel } from '../models/Payment.js';
import { InvoiceModel } from '../models/Invoice.js';
import { ExpenseModel } from '../models/Expense.js';
import { QualityCheckModel } from '../models/QualityCheck.js';
import { WarrantyClaimModel } from '../models/WarrantyClaim.js';
import { RepairPartModel } from '../models/RepairPart.js';
import { RepairStatusHistoryModel } from '../models/RepairStatusHistory.js';
import { UserModel } from '../models/User.js';
import { ApprovalModel } from '../models/Approval.js';
import { InventoryItemModel } from '../models/InventoryItem.js';
import { ok } from '../utils/asyncHandler.js';
import { money } from '../utils/money.js';
import { dayKey, periodRange } from '../utils/dates.js';
import { ACTIVE_REPAIR_STATUSES, REPAIR_STATUS_LABELS_AR, type RepairStatus } from '../constants/repair.js';
import { env } from '../config/env.js';
import { requestScope } from '../utils/requestScope.js';

function resolveRange(req: Request): { from: Date; to: Date } {
  const query = req.query as Record<string, unknown>;
  if (query.from || query.to) {
    return {
      from: query.from ? new Date(String(query.from)) : new Date(0),
      to: query.to ? new Date(String(query.to)) : new Date(),
    };
  }
  const period = String(query.period ?? 'last30') as 'today' | 'week' | 'month' | 'quarter' | 'year' | 'last30';
  return periodRange(period);
}

/**
 * لوحة التحكم الرئيسية (Dashboard):
 * مؤشرات تشغيلية فورية + اتجاه آخر 30 يومًا.
 */
export const dashboard = async (req: Request, res: Response) => {
  const { from, to } = resolveRange(req);
  const now = new Date();
  const { organizationId } = requestScope();

  const [
    openTickets,
    overdueTickets,
    readyForPickup,
    waitingApproval,
    waitingParts,
    inRepair,
    deliveredInRange,
    newTicketsInRange,
    customers,
    devices,
    revenueInRange,
    receivables,
    lowStockCount,
    qcFirstTime,
    qcTotal,
    warrantyClaimsInRange,
    activeTechnicians,
    pendingInvoices,
  ] = await Promise.all([
    RepairTicketModel.countDocuments({ organizationId, status: { $in: ACTIVE_REPAIR_STATUSES } }),
    RepairTicketModel.countDocuments({
      organizationId,
      status: { $in: ACTIVE_REPAIR_STATUSES },
      'sla.dueAt': { $lt: now },
    }),
    RepairTicketModel.countDocuments({ organizationId, status: { $in: ['ready', 'customer_notified', 'paid'] } }),
    RepairTicketModel.countDocuments({ organizationId, status: 'waiting_approval' }),
    RepairTicketModel.countDocuments({ organizationId, status: 'waiting_part' }),
    RepairTicketModel.countDocuments({ organizationId, status: 'repairing' }),
    RepairTicketModel.countDocuments({ organizationId, status: 'delivered', deliveredAt: { $gte: from, $lte: to } }),
    RepairTicketModel.countDocuments({ organizationId, createdAt: { $gte: from, $lte: to } }),
    CustomerModel.countDocuments({ organizationId, isActive: true }),
    DeviceModel.countDocuments({ organizationId, isActive: true }),
    PaymentModel.aggregate<{ total: number }>([
      { $match: { organizationId, direction: 'in', paidAt: { $gte: from, $lte: to } } },
      { $group: { _id: null, total: { $sum: '$amountEgp' } } },
    ]),
    InvoiceModel.aggregate<{ due: number }>([
      { $match: { organizationId, 'totals.dueEgp': { $gt: 0.009 }, status: { $nin: ['void', 'draft'] } } },
      { $group: { _id: null, due: { $sum: '$totals.dueEgp' } } },
    ]),
    PartModel.countDocuments({
      organizationId,
      isActive: true,
      $expr: { $lte: [{ $subtract: ['$stock.onHand', '$stock.reserved'] }, '$stock.reorderLevel'] },
    }),
    QualityCheckModel.countDocuments({
      organizationId,
      attempt: 1,
      result: { $in: ['passed', 'passed_with_notes'] },
      createdAt: { $gte: from, $lte: to },
    }),
    QualityCheckModel.countDocuments({ organizationId, createdAt: { $gte: from, $lte: to } }),
    WarrantyClaimModel.countDocuments({ organizationId, reportedAt: { $gte: from, $lte: to } }),
    UserModel.countDocuments({
      organizationId,
      isActive: true,
      $or: [{ role: 'technician' }, { 'technicianProfile.isTechnician': true }],
    }),
    InvoiceModel.countDocuments({ organizationId, status: { $in: ['issued', 'partially_paid'] } }),
  ]);

  return ok(res, {
    currency: env.DEFAULT_CURRENCY,
    period: { from, to },
    operations: {
      openTickets,
      overdueTickets,
      readyForPickup,
      waitingApproval,
      waitingParts,
      inRepair,
      newTicketsInRange,
      deliveredInRange,
      /** متوسط زمن الإصلاح بالساعات في الفترة */
    },
    customers: { total: customers },
    devices: { total: devices },
    finance: {
      revenueEgp: money(revenueInRange[0]?.total ?? 0),
      receivablesEgp: money(receivables[0]?.due ?? 0),
      pendingInvoices,
    },
    inventory: { lowStockCount },
    quality: {
      checksInRange: qcTotal,
      firstTimePassInRange: qcFirstTime,
      firstTimePassRatePct: qcTotal ? money((qcFirstTime / qcTotal) * 100) : 0,
      warrantyClaimsInRange,
    },
    team: { activeTechnicians },
  });
};

/** اتجاه الأداء اليومي: تذاكر جديدة، تسليمات، وإيراد */
export const trends = async (req: Request, res: Response) => {
  const { from, to } = resolveRange(req);
  const { organizationId } = requestScope();
  const days = Math.min(180, Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86_400_000)));

  const [createdTickets, deliveredTickets, payments, expenses] = await Promise.all([
    RepairTicketModel.aggregate<{ _id: string; count: number }>([
      { $match: { organizationId, createdAt: { $gte: from, $lte: to } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Africa/Cairo' } }, count: { $sum: 1 } } },
    ]),
    RepairTicketModel.aggregate<{ _id: string; count: number; revenue: number }>([
      { $match: { organizationId, status: 'delivered', deliveredAt: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$deliveredAt', timezone: 'Africa/Cairo' } },
          count: { $sum: 1 },
          revenue: { $sum: '$cost.totalFinalEgp' },
        },
      },
    ]),
    PaymentModel.aggregate<{ _id: string; total: number }>([
      { $match: { organizationId, direction: 'in', paidAt: { $gte: from, $lte: to } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$paidAt', timezone: 'Africa/Cairo' } }, total: { $sum: '$amountEgp' } } },
    ]),
    ExpenseModel.aggregate<{ _id: string; total: number }>([
      { $match: { organizationId, incurredAt: { $gte: from, $lte: to } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$incurredAt', timezone: 'Africa/Cairo' } }, total: { $sum: '$amountEgp' } } },
    ]),
  ]);

  const createdMap = new Map(createdTickets.map((d) => [d._id, d.count]));
  const deliveredMap = new Map(deliveredTickets.map((d) => [d._id, d]));
  const payMap = new Map(payments.map((d) => [d._id, d.total]));
  const expenseMap = new Map(expenses.map((d) => [d._id, d.total]));

  const series: { date: string; newTickets: number; delivered: number; revenueEgp: number; expensesEgp: number; profitEgp: number }[] = [];
  for (let i = 0; i < days; i += 1) {
    const date = new Date(from.getTime() + i * 86_400_000);
    const key = dayKey(date);
    const revenue = payMap.get(key) ?? 0;
    const expense = expenseMap.get(key) ?? 0;
    series.push({
      date: key,
      newTickets: createdMap.get(key) ?? 0,
      delivered: deliveredMap.get(key)?.count ?? 0,
      revenueEgp: money(revenue),
      expensesEgp: money(expense),
      profitEgp: money(revenue - expense),
    });
  }

  // منحنى شهري للإيراد والتذاكر
  const monthly = await RepairTicketModel.aggregate<{ _id: string; tickets: number; revenue: number }>([
    { $match: { organizationId, createdAt: { $gte: new Date(Date.now() - 365 * 86_400_000) } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: 'Africa/Cairo' } },
        tickets: { $sum: 1 },
        revenue: { $sum: '$cost.totalFinalEgp' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return ok(res, {
    period: { from, to },
    daily: series,
    monthly: monthly.map((m) => ({ month: m._id, tickets: m.tickets, revenueEgp: money(m.revenue) })),
  });
};

/** توزيع التذاكر على الحالات (لوحة الأعمدة) */
export const statusDistribution = async (req: Request, res: Response) => {
  const { from, to } = resolveRange(req);
  const { organizationId } = requestScope();
  const distribution = await RepairTicketModel.aggregate<{ _id: string; count: number; revenue: number }>([
    { $match: { organizationId, createdAt: { $gte: from, $lte: to } } },
    { $group: { _id: '$status', count: { $sum: 1 }, revenue: { $sum: '$cost.totalFinalEgp' } } },
    { $sort: { count: -1 } },
  ]);

  return ok(
    res,
    distribution.map((d) => ({
      status: d._id,
      label: REPAIR_STATUS_LABELS_AR[d._id as RepairStatus] ?? d._id,
      count: d.count,
      revenueEgp: money(d.revenue),
    })),
  );
};

/** أكثر الأعطال شيوعًا (fault categories) */
export const faultAnalysis = async (req: Request, res: Response) => {
  const { from, to } = resolveRange(req);
  const { organizationId } = requestScope();
  const [byCategory, byModel, bySeverity] = await Promise.all([
    RepairTicketModel.aggregate<{ _id: string; count: number; avgCost: number; warrantyReturns: number }>([
      { $match: { organizationId, createdAt: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: '$diagnosis.faultCategory',
          count: { $sum: 1 },
          avgCost: { $avg: '$cost.totalFinalEgp' },
          warrantyReturns: { $sum: { $cond: [{ $ne: ['$outcome', 'pending'] }, 0, 0] } },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 25 },
    ]),
    RepairTicketModel.aggregate<{ _id: Types.ObjectId; count: number; avgCost: number }>([
      { $match: { organizationId, createdAt: { $gte: from, $lte: to } } },
      { $group: { _id: '$deviceId', count: { $sum: 1 }, avgCost: { $avg: '$cost.totalFinalEgp' } } },
      { $sort: { count: -1 } },
      { $limit: 20 },
    ]),
    RepairTicketModel.aggregate<{ _id: string; count: number }>([
      { $match: { organizationId, createdAt: { $gte: from, $lte: to } } },
      { $group: { _id: '$diagnosis.faultSeverity', count: { $sum: 1 } } },
    ]),
  ]);

  const deviceIds = byModel.map((m) => m._id).filter(Boolean);
  const devices = await DeviceModel.find({ _id: { $in: deviceIds } }).select('brand model').lean();
  const deviceMap = new Map(devices.map((d) => [String(d._id), `${d.brand} ${d.model}`]));

  return ok(res, {
    byFaultCategory: byCategory.map((c) => ({
      faultCategory: c._id || 'غير محدد',
      tickets: c.count,
      avgCostEgp: money(c.avgCost ?? 0),
    })),
    byDeviceModel: byModel.map((m) => ({
      deviceId: m._id ? String(m._id) : null,
      device: m._id ? (deviceMap.get(String(m._id)) ?? 'غير معروف') : 'غير معروف',
      tickets: m.count,
      avgCostEgp: money(m.avgCost ?? 0),
    })),
    bySeverity: bySeverity.map((s) => ({ severity: s._id || 'غير محدد', tickets: s.count })),
  });
};

/**
 * أزمنة التشغيل: متوسط الزمن لكل مرحلة من الـTimeline، ومتوسط زمن الإصلاح الكلي.
 */
export const turnaroundTimes = async (req: Request, res: Response) => {
  const { from, to } = resolveRange(req);
  const { organizationId } = requestScope();

  const [stageDurations, totalTurnaround, slaStats] = await Promise.all([
    RepairStatusHistoryModel.aggregate<{ _id: string; avgMinutes: number; samples: number }>([
      { $match: { organizationId, createdAt: { $gte: from, $lte: to }, durationMinutes: { $gt: 0 } } },
      { $group: { _id: '$fromStatus', avgMinutes: { $avg: '$durationMinutes' }, samples: { $sum: 1 } } },
      { $sort: { avgMinutes: -1 } },
    ]),
    RepairTicketModel.aggregate<{ avgHours: number; count: number }>([
      {
        $match: {
          status: 'delivered',
          deliveredAt: { $gte: from, $lte: to },
        },
      },
      {
        $project: {
          hours: { $divide: [{ $subtract: ['$deliveredAt', '$createdAt'] }, 3_600_000] },
        },
      },
      { $group: { _id: null, avgHours: { $avg: '$hours' }, count: { $sum: 1 } } },
    ]),
    RepairTicketModel.aggregate<{ _id: boolean; count: number }>([
      { $match: { organizationId, createdAt: { $gte: from, $lte: to } } },
      { $group: { _id: '$sla.breached', count: { $sum: 1 } } },
    ]),
  ]);

  const total = slaStats.reduce((a, s) => a + s.count, 0) || 1;
  const breached = slaStats.find((s) => s._id === true)?.count ?? 0;

  return ok(res, {
    avgTotalRepairHours: Number((totalTurnaround[0]?.avgHours ?? 0).toFixed(1)),
    deliveredCount: totalTurnaround[0]?.count ?? 0,
    byStage: stageDurations
      .filter((s) => s._id)
      .map((s) => ({
        stage: s._id,
        stageLabel: REPAIR_STATUS_LABELS_AR[s._id as RepairStatus] ?? s._id,
        avgHours: Number((s.avgMinutes / 60).toFixed(1)),
        samples: s.samples,
      })),
    sla: {
      breached,
      onTime: total - breached,
      breachRatePct: money((breached / total) * 100),
    },
  });
};

/**
 * مؤشرات Pilot: النسب المطلوبة لتقييم نجاح التجربة (قسم 33 في الدراسة).
 *
 * ملاحظة منهجية مهمة: بعض المؤشرات نسبية (مثل معدل عودة الضمان ونسبة الموافقة)
 * وتحتاج مقامًا من نفس الفترة الزمنية، وإلا خرجت النسبة مضللة (قد تتجاوز 100%).
 * لذلك نحسب هنا relativeExpansion للتذاكر المُسلَّمة: التذاكر المُسلَّمة داخل الفترة
 * أو التي أُصلحت داخل الفترة حتى لو كانت تذكرتها أُنشئت قبلها.
 */
export const pilotKpis = async (req: Request, res: Response) => {
  const { from, to } = resolveRange(req);
  const { organizationId } = requestScope();

  const [
    ticketsInRange,
    ticketsWithIntakePhotos,
    ticketsWithSignature,
    delivered,
    approvals,
    approvedEstimates,
    warrantyClaims,
    qcChecks,
    qcFirstTimePass,
    openTicketAge,
  ] = await Promise.all([
    RepairTicketModel.countDocuments({ organizationId, createdAt: { $gte: from, $lte: to } }),
    RepairTicketModel.countDocuments({
      organizationId,
      createdAt: { $gte: from, $lte: to },
      'evidence.intakePhotoCount': { $gt: 0 },
    }),
    RepairTicketModel.countDocuments({
      organizationId,
      createdAt: { $gte: from, $lte: to },
      'evidence.hasSignature': true,
    }),
    // مقام معدل عودة الضمان: الإصلاحات المُسلَّمة في آخر 12 شهرًا.
    // السبب: claim قد يُفتح على إصلاح قديم، واستخدام تسليمات الفترة وحدها يُنتج نسبًا
    // مضللة (قد تتجاوز 100%). نافذة 12 شهرًا هي أساس مستقر ومتعارف عليه لهذا المؤشر.
    RepairTicketModel.countDocuments({
      organizationId,
      status: 'delivered',
      deliveredAt: { $gte: new Date(Date.now() - 365 * 86_400_000) },
    }),
    ApprovalModel.countDocuments({ organizationId, decidedAt: { $gte: from, $lte: to } }),
    ApprovalModel.countDocuments({
      organizationId,
      decidedAt: { $gte: from, $lte: to },
      decision: { $in: ['approved', 'partially_approved'] },
    }),
    WarrantyClaimModel.countDocuments({ organizationId, reportedAt: { $gte: from, $lte: to } }),
    QualityCheckModel.countDocuments({ organizationId, createdAt: { $gte: from, $lte: to } }),
    QualityCheckModel.countDocuments({
      organizationId,
      attempt: 1,
      result: { $in: ['passed', 'passed_with_notes'] },
      createdAt: { $gte: from, $lte: to },
    }),
    // متوسط عمر التذاكر المفتوحة *الآن* (مؤشر لحظي وليس مرتبطًا بالفترة)
    RepairTicketModel.aggregate<{ avgHours: number; count: number }>([
      { $match: { organizationId, status: { $in: ACTIVE_REPAIR_STATUSES } } },
      { $project: { hours: { $divide: [{ $subtract: [new Date(), '$createdAt'] }, 3_600_000] } } },
      { $group: { _id: null, avgHours: { $avg: '$hours' }, count: { $sum: 1 } } },
    ]),
  ]);

  // دقة المخزون: نسبة القطع التي رصيدها مطابق لآخر جرد
  const counted = await InventoryItemModel.countDocuments({ lastCountedAt: { $ne: null } });
  const totalItems = await InventoryItemModel.countDocuments({ isActive: true });

  return ok(res, {
    period: { from, to },
    kpis: [
      {
        key: 'intake_evidence_rate',
        label: 'نسبة الأجهزة الموثقة بصور استلام',
        value: ticketsInRange ? money((ticketsWithIntakePhotos / ticketsInRange) * 100) : 0,
        unit: '%',
        target: 90,
        samples: ticketsInRange,
      },
      {
        key: 'signature_rate',
        label: 'نسبة الأجهزة بإقرار/توقيع العميل',
        value: ticketsInRange ? money((ticketsWithSignature / ticketsInRange) * 100) : 0,
        unit: '%',
        target: 80,
        samples: ticketsInRange,
      },
      {
        key: 'approval_rate',
        label: 'نسبة الموافقة على عروض الإصلاح',
        value: approvals ? money((approvedEstimates / approvals) * 100) : 0,
        unit: '%',
        target: 65,
        samples: approvals,
      },
      {
        key: 'warranty_return_rate',
        label: 'معدل عودة الضمان',
        value: delivered ? money(Math.min(100, (warrantyClaims / delivered) * 100)) : 0,
        unit: '%',
        target: 5,
        samples: delivered,
        inverted: true,
        /** المقام: الإصلاحات المُسلَّمة في آخر 12 شهرًا (وليس تسليمات الفترة فقط) */
        basisNote: 'claims الفترة ÷ الإصلاحات المُسلَّمة في آخر 12 شهرًا',
      },
      {
        key: 'first_time_qc_pass',
        label: 'نسبة اجتياز QC من أول مرة',
        value: qcChecks ? money((qcFirstTimePass / qcChecks) * 100) : 0,
        unit: '%',
        target: 85,
        samples: qcChecks,
      },
      {
        key: 'inventory_accuracy',
        label: 'دقة المخزون (قطع تم جردها)',
        value: totalItems ? money((counted / totalItems) * 100) : 0,
        unit: '%',
        target: 95,
        samples: totalItems,
      },
      {
        key: 'avg_open_age_hours',
        label: 'متوسط عمر التذاكر المفتوحة الآن (ساعات)',
        value: Number((openTicketAge[0]?.avgHours ?? 0).toFixed(1)),
        unit: 'ساعة',
        target: 48,
        samples: openTicketAge[0]?.count ?? 0,
        inverted: true,
        /** مؤشر لحظي: يقيس التذاكر المفتوحة حاليًا وليس مرتبطًا بالفترة المختارة */
        instantaneous: true,
      },
    ],
    /** توضيح منهجي يُعرض في الواجهة لتفادي قراءة خاطئة للنسب */
    notes: [
      'معدل عودة الضمان = claims الفترة ÷ الإصلاحات المُسلَّمة في آخر 12 شهرًا (نافذة مستقرة، لأن claim قد يُفتح على إصلاح قديم).',
      'نسبة الموافقة = قرارات الموافقة ÷ كل قرارات العملاء في الفترة.',
      'متوسط عمر التذاكر المفتوحة مؤشر لحظي لا يتأثر بالفترة المختارة.',
      'الأهداف المذكورة إطار مبدئي ويجب معايرتها بعد قياس خط الأساس في المراكز التجريبية.',
    ],
  });
};

/** ملخص التذاكر حسب مصدرها */
export const sourceAnalysis = async (req: Request, res: Response) => {
  const { from, to } = resolveRange(req);
  const { organizationId } = requestScope();
  const result = await RepairTicketModel.aggregate<{ _id: string; count: number; revenue: number; avgCost: number }>([
    { $match: { organizationId, createdAt: { $gte: from, $lte: to } } },
    {
      $group: {
        _id: '$source',
        count: { $sum: 1 },
        revenue: { $sum: '$cost.totalFinalEgp' },
        avgCost: { $avg: '$cost.totalFinalEgp' },
      },
    },
    { $sort: { count: -1 } },
  ]);

  return ok(
    res,
    result.map((r) => ({
      source: r._id,
      tickets: r.count,
      revenueEgp: money(r.revenue),
      avgTicketEgp: money(r.avgCost ?? 0),
    })),
  );
};
