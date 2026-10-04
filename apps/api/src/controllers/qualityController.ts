import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { QualityCheckModel, DEFAULT_QC_ITEMS } from '../models/QualityCheck.js';
import { RepairTicketModel } from '../models/RepairTicket.js';
import { RepairPartModel } from '../models/RepairPart.js';
import { UserModel } from '../models/User.js';
import { WarrantyClaimModel } from '../models/WarrantyClaim.js';
import { DeviceModel } from '../models/Device.js';
import { CustomerModel } from '../models/Customer.js';
import { PartModel } from '../models/Part.js';
import { SupplierModel } from '../models/Supplier.js';
import { OrganizationModel } from '../models/Organization.js';
import { ApiError } from '../utils/ApiError.js';
import { created, ok, paginated } from '../utils/asyncHandler.js';
import { parseListQuery } from '../utils/queryHelpers.js';
import { getAuth } from '../middleware/auth.js';
import { getTenantContext } from '../context/tenantContext.js';
import { recordAudit } from '../services/auditService.js';
import { money } from '../utils/money.js';
import { diffMinutes } from '../utils/dates.js';
import { getTicketOrFail, recordTimelineEvent, transitionTicket } from '../services/workflowService.js';
import { nextClaimNumber, nextTicketNumber, nextTrackingToken, withUniqueRetry } from '../services/numberingService.js';
import { refreshPartQualityStats } from '../services/inventoryService.js';

/* ============================ فحص الجودة ============================ */

export const listQualityChecks = async (req: Request, res: Response) => {
  const { page, limit, skip } = parseListQuery(req.query as Record<string, unknown>, 30);
  const query = req.query as Record<string, unknown>;
  const filter: Record<string, unknown> = {};
  if (query.ticketId) filter.ticketId = query.ticketId;
  if (query.result) filter.result = query.result;
  if (query.inspectorId) filter.inspectorId = query.inspectorId;

  const [items, total] = await Promise.all([
    QualityCheckModel.find(filter)
      .populate('ticketId', 'ticketNumber status')
      .populate('inspectorId', 'fullName')
      .populate('technicianId', 'fullName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    QualityCheckModel.countDocuments(filter),
  ]);

  return paginated(res, items, { page, limit, total });
};

export const getQualityCheck = async (req: Request, res: Response) => {
  const qc = await QualityCheckModel.findById(req.params.id)
    .populate('ticketId', 'ticketNumber status deviceId customerId intake.complaint')
    .populate('inspectorId', 'fullName')
    .lean();
  if (!qc) throw ApiError.notFound('سجل الفحص غير موجود');
  return ok(res, { ...qc, passRatePct: computePassRate(qc.items ?? []) });
};

function computePassRate(items: { result: string }[]): number {
  const applicable = items.filter((i) => i.result !== 'not_applicable' && i.result !== 'pending');
  if (!applicable.length) return 0;
  return money((applicable.filter((i) => i.result === 'pass').length / applicable.length) * 100);
}

/**
 * بدء فحص الجودة: يُنشئ سجل الفحص بقائمة بنود (مخصصة أو افتراضية).
 * يتم نقل التذكرة إلى testing_qc تلقائيًا إن كانت الحالة تسمح.
 */
export const createQualityCheck = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const ctx = getTenantContext();
  const body = req.body as {
    ticketId: string;
    items?: { key: string; labelAr: string; required: boolean; result: string; notes: string }[];
    useDefaultChecklist: boolean;
    measurements?: Record<string, unknown>;
    functionalTests: string[];
    notes: string;
  };

  const ticket = await getTicketOrFail(body.ticketId);

  const existingAttempts = await QualityCheckModel.countDocuments({ ticketId: ticket._id });
  const items =
    body.items?.length
      ? body.items
      : DEFAULT_QC_ITEMS.map((item) => ({
          key: item.key,
          labelAr: item.labelAr,
          required: item.required,
          result: 'pending' as const,
          notes: '',
        }));

  const qc = await QualityCheckModel.create({
    organizationId: ctx!.organizationId,
    branchId: ctx!.branchId,
    ticketId: ticket._id,
    deviceId: ticket.deviceId,
    technicianId: ticket.assignedTechnicianId,
    inspectorId: new Types.ObjectId(auth.userId),
    attempt: existingAttempts + 1,
    result: 'pending',
    items,
    measurements: body.measurements ?? {},
    functionalTests: body.functionalTests ?? [],
    notes: body.notes ?? '',
    startedAt: new Date(),
  });

  // نقل التذكرة لمرحلة الفحص إن كانت الحالة الحالية تسمح
  if (ticket.status === 'repairing') {
    try {
      await transitionTicket(ticket._id, 'testing_qc', { userId: auth.userId, fullName: auth.fullName, role: auth.role }, {
        note: `بدء فحص جودة (محاولة ${qc.attempt})`,
      });
    } catch {
      await recordTimelineEvent({
        ticket,
        eventType: 'note_added',
        note: `بدء فحص جودة (محاولة ${qc.attempt})`,
        actor: { userId: auth.userId, fullName: auth.fullName, role: auth.role },
      });
    }
  } else {
    await recordTimelineEvent({
      ticket,
      eventType: 'note_added',
      note: `بدء فحص جودة (محاولة ${qc.attempt})`,
      actor: { userId: auth.userId, fullName: auth.fullName, role: auth.role },
      metadata: { qualityCheckId: String(qc._id) },
    });
  }

  await recordAudit(
    { action: 'create', resource: 'QualityCheck', resourceId: String(qc._id), summary: `بدء فحص جودة للتذكرة ${ticket.ticketNumber}` },
    req,
  );

  return created(res, qc.toObject());
};

/**
 * تسجيل نتيجة الفحص.
 * قاعدة العمل: البنود الإلزامية يجب أن تُحدَّد، وأي بند إلزامي = fail يمنع الاجتياز.
 */
export const submitQualityCheck = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const qc = await QualityCheckModel.findById(req.params.id);
  if (!qc) throw ApiError.notFound('سجل الفحص غير موجود');
  if (qc.result !== 'pending') throw ApiError.businessRule('تم تسجيل نتيجة هذا الفحص بالفعل');

  const body = req.body as {
    items: { key: string; result: 'pending' | 'pass' | 'fail' | 'not_applicable'; notes: string }[];
    measurements?: Record<string, unknown>;
    functionalTests?: string[];
    notes?: string;
    requiresReRepair?: boolean;
    reRepairReason?: string;
    advanceTicket: boolean;
  };

  const incoming = new Map(body.items.map((i) => [i.key, i]));

  for (const item of qc.items) {
    const update = incoming.get(item.key);
    if (update) {
      item.result = update.result;
      item.notes = update.notes ?? '';
      item.checkedBy = new Types.ObjectId(auth.userId);
      item.checkedAt = new Date();
    }
  }

  // التحقق من البنود الإلزامية
  const missingRequired = qc.items.filter((i) => i.required && i.result === 'pending').map((i) => i.labelAr);
  if (missingRequired.length) {
    throw ApiError.businessRule('يجب تحديد نتيجة كل البنود الإلزامية قبل إتمام الفحص', { missingRequired });
  }

  const failedRequired = qc.items.filter((i) => i.required && i.result === 'fail').map((i) => i.labelAr);
  const failedOptional = qc.items.filter((i) => !i.required && i.result === 'fail').map((i) => i.labelAr);

  qc.result = failedRequired.length ? 'failed' : failedOptional.length ? 'passed_with_notes' : 'passed';
  qc.failureReasons = [...failedRequired, ...failedOptional];
  qc.requiresReRepair = failedRequired.length > 0 || (body.requiresReRepair ?? false);
  qc.reRepairReason = body.reRepairReason ?? '';
  qc.completedAt = new Date();
  qc.durationMinutes = diffMinutes(qc.startedAt, qc.completedAt);
  if (body.notes !== undefined) qc.notes = body.notes;
  if (body.functionalTests) qc.functionalTests = body.functionalTests;
  if (body.measurements) qc.measurements = { ...qc.measurements, ...body.measurements } as typeof qc.measurements;

  await qc.save();

  const ticket = await getTicketOrFail(qc.ticketId);

  // تحديث ملخص الأدلة على التذكرة
  ticket.evidence.hasQcEvidence = true;
  await ticket.save();

  const passed = qc.result === 'passed' || qc.result === 'passed_with_notes';

  await recordTimelineEvent({
    ticket,
    eventType: passed ? 'qc_passed' : 'qc_failed',
    note: passed
      ? `اجتاز فحص الجودة (${computePassRate(qc.items)}%)`
      : `لم يجتز فحص الجودة: ${qc.failureReasons.join('، ')}`,
    actor: { userId: auth.userId, fullName: auth.fullName, role: auth.role },
    metadata: {
      qualityCheckId: String(qc._id),
      result: qc.result,
      passRatePct: computePassRate(qc.items),
      failureReasons: qc.failureReasons,
    },
  });

  // نقل التذكرة حسب النتيجة
  if (body.advanceTicket) {
    if (passed && ticket.status === 'testing_qc') {
      try {
        await transitionTicket(ticket._id, 'ready', { userId: auth.userId, fullName: auth.fullName, role: auth.role }, {
          note: 'اجتياز فحص الجودة',
        });
      } catch (err) {
        // قد تُمنع الانتقال بسبب قواعد أخرى (مثلًا فاتورة غير مسددة عند delivered) - لا نُفشل العملية
        void err;
      }
    } else if (!passed && ticket.status === 'testing_qc') {
      try {
        await transitionTicket(ticket._id, 'repairing', { userId: auth.userId, fullName: auth.fullName, role: auth.role }, {
          note: `إعادة للإصلاح: ${qc.failureReasons.join('، ')}`,
        });
      } catch {
        void 0;
      }
    }
  }

  await recordAudit(
    {
      action: passed ? 'approve' : 'reject',
      resource: 'QualityCheck',
      resourceId: String(qc._id),
      summary: `نتيجة فحص جودة ${ticket.ticketNumber}: ${qc.result}`,
      severity: passed ? 'info' : 'warning',
    },
    req,
  );

  return ok(res, { ...qc.toObject(), passRatePct: computePassRate(qc.items) });
};

/** مؤشرات جودة الفحص: نسبة الاجتياز من أول مرة لكل فني */
export const qualityStats = async (req: Request, res: Response) => {
  const query = req.query as Record<string, unknown>;
  const match: Record<string, unknown> = {};
  if (query.from || query.to) {
    const range: Record<string, Date> = {};
    if (query.from) range.$gte = new Date(String(query.from));
    if (query.to) range.$lte = new Date(String(query.to));
    match.createdAt = range;
  }

  const [totals, firstTimePass, byInspector, failureReasons] = await Promise.all([
    QualityCheckModel.countDocuments(match),
    QualityCheckModel.countDocuments({ ...match, attempt: 1, result: { $in: ['passed', 'passed_with_notes'] } }),
    QualityCheckModel.aggregate<{ _id: Types.ObjectId; total: number; passed: number; avgAttempt: number }>([
      { $match: match },
      {
        $group: {
          _id: '$technicianId',
          total: { $sum: 1 },
          passed: { $sum: { $cond: [{ $in: ['$result', ['passed', 'passed_with_notes']] }, 1, 0] } },
          avgAttempt: { $avg: '$attempt' },
        },
      },
      { $sort: { total: -1 } },
      { $limit: 30 },
    ]),
    QualityCheckModel.aggregate<{ _id: string; count: number }>([
      { $match: { ...match, result: 'failed' } },
      { $unwind: '$failureReasons' },
      { $group: { _id: '$failureReasons', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 15 },
    ]),
  ]);

  const technicianIds = byInspector.map((i) => i._id).filter(Boolean);
  const technicians = await UserModel.find({ _id: { $in: technicianIds } }).select('fullName').lean();
  const nameMap = new Map(technicians.map((t) => [String(t._id), t.fullName]));

  const totalChecks = totals || 1;

  return ok(res, {
    totalChecks: totals,
    firstTimePassCount: firstTimePass,
    firstTimePassRatePct: money((firstTimePass / totalChecks) * 100),
    byTechnician: byInspector.map((i) => ({
      technicianId: i._id ? String(i._id) : null,
      name: i._id ? (nameMap.get(String(i._id)) ?? 'غير محدد') : 'غير محدد',
      totalChecks: i.total,
      passedChecks: i.passed,
      passRatePct: money((i.passed / (i.total || 1)) * 100),
      avgAttempts: Number((i.avgAttempt ?? 1).toFixed(2)),
    })),
    topFailureReasons: failureReasons.map((f) => ({ reason: f._id, count: f.count })),
  });
};

/* ============================== الضمان ============================== */

export const listWarrantyClaims = async (req: Request, res: Response) => {
  const { page, limit, skip } = parseListQuery(req.query as Record<string, unknown>, 30);
  const query = req.query as Record<string, unknown>;
  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;
  if (query.customerId) filter.customerId = query.customerId;
  if (query.technicianId) filter.originalTechnicianId = query.technicianId;
  if (query.deviceId) filter.deviceId = query.deviceId;
  if (query.sameFault !== undefined) filter.isSameFault = query.sameFault === 'true';

  const [items, total] = await Promise.all([
    WarrantyClaimModel.find(filter)
      .populate('customerId', 'fullName phone')
      .populate('deviceId', 'brand model imei')
      .populate('originalTicketId', 'ticketNumber deliveredAt warranty.policyDays')
      .populate('originalTechnicianId', 'fullName')
      .sort({ reportedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    WarrantyClaimModel.countDocuments(filter),
  ]);

  return paginated(res, items, { page, limit, total });
};

export const getWarrantyClaim = async (req: Request, res: Response) => {
  const claim = await WarrantyClaimModel.findById(req.params.id)
    .populate('customerId')
    .populate('deviceId')
    .populate('originalTicketId')
    .populate('newTicketId', 'ticketNumber status')
    .populate('originalRepairPartIds')
    .populate('originalTechnicianId', 'fullName')
    .lean();
  if (!claim) throw ApiError.notFound('claim الضمان غير موجود');
  return ok(res, claim);
};

/**
 * فتح claim ضمان: مرتبط بالإصلاح الأصلي والقطع والفني.
 * يمكن إنشاء تذكرة صيانة جديدة للعودة تلقائيًا.
 */
export const createWarrantyClaim = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const ctx = getTenantContext();
  const body = req.body as {
    originalTicketId: string;
    symptom: string;
    coverage: 'part' | 'labor' | 'both' | 'none';
    isSameFault: boolean;
    faultCategory: string;
    misuseSuspected: boolean;
    physicalDamageFound: boolean;
    liquidDamageFound: boolean;
    thirdPartyIntervention: boolean;
    createNewTicket: boolean;
    priority: 'low' | 'normal' | 'high' | 'urgent';
  };

  const originalTicket = await getTicketOrFail(body.originalTicketId);

  if (originalTicket.status !== 'delivered' && originalTicket.status !== 'warranty') {
    throw ApiError.businessRule('لا يمكن فتح claim ضمان على تذكرة لم تُسلَّم بعد');
  }

  const existingOpen = await WarrantyClaimModel.findOne({
    originalTicketId: originalTicket._id,
    status: { $in: ['open', 'under_review', 'approved', 'in_repair'] },
  }).lean();
  if (existingOpen) throw ApiError.conflict('يوجد claim ضمان مفتوح بالفعل على هذه التذكرة', { claimId: String(existingOpen._id) });

  const deliveredAt = originalTicket.deliveredAt ?? originalTicket.warranty.startsAt ?? originalTicket.updatedAt;
  const daysSinceDelivery = Math.max(0, Math.floor((Date.now() - new Date(deliveredAt as Date).getTime()) / 86_400_000));

  const warrantyActive =
    originalTicket.warranty.expiresAt && !originalTicket.warranty.isVoid
      ? originalTicket.warranty.expiresAt.getTime() > Date.now()
      : false;

  const parts = await RepairPartModel.find({ ticketId: originalTicket._id, status: { $in: ['installed', 'defective'] } })
    .select('_id partId supplierId')
    .lean();

  const claim = await withUniqueRetry(nextClaimNumber, (claimNumber) =>
    WarrantyClaimModel.create({
      organizationId: ctx!.organizationId,
      branchId: ctx!.branchId,
      claimNumber,
      customerId: originalTicket.customerId,
      deviceId: originalTicket.deviceId,
      originalTicketId: originalTicket._id,
      originalRepairPartIds: parts.map((p) => p._id),
      originalTechnicianId: originalTicket.assignedTechnicianId,
      status: 'open',
      coverage: body.coverage,
      reportedAt: new Date(),
      daysSinceDelivery,
      symptom: body.symptom,
      isSameFault: body.isSameFault,
      faultCategory: body.faultCategory ?? '',
      misuseSuspected: body.misuseSuspected,
      physicalDamageFound: body.physicalDamageFound,
      liquidDamageFound: body.liquidDamageFound,
      thirdPartyIntervention: body.thirdPartyIntervention,
      createdBy: new Types.ObjectId(auth.userId),
    }),
  );

  // إنشاء تذكرة عودة مرتبطة
  if (body.createNewTicket) {
    const newTicket = await withUniqueRetry(nextTicketNumber, (ticketNumber) =>
      RepairTicketModel.create({
        organizationId: ctx!.organizationId,
        branchId: ctx!.branchId,
        ticketNumber,
        trackingToken: nextTrackingToken(),
        customerId: originalTicket.customerId,
        deviceId: originalTicket.deviceId,
        status: 'received',
        priority: body.priority,
        source: 'return_warranty',
        intake: {
          receivedAt: new Date(),
          receivedBy: new Types.ObjectId(auth.userId),
          complaint: `عودة ضمان: ${body.symptom}`,
          complaintCategory: body.faultCategory ?? '',
          customerAcknowledged: true,
          acknowledgedAt: new Date(),
        },
        warranty: { policyDays: 0 },
        tags: ['warranty_return', `claim:${claim.claimNumber}`],
        internalNotes: `مرتبطة بـ claim ضمان ${claim.claimNumber} — التذكرة الأصلية ${originalTicket.ticketNumber}`,
        createdBy: new Types.ObjectId(auth.userId),
      }),
    );

    claim.newTicketId = newTicket._id as Types.ObjectId;
    await claim.save();

    await recordTimelineEvent({
      ticket: newTicket,
      eventType: 'warranty_claim',
      fromStatus: null,
      toStatus: 'received',
      note: `تذكرة عودة ضمان مرتبطة بـ ${originalTicket.ticketNumber}`,
      actor: { userId: auth.userId, fullName: auth.fullName, role: auth.role },
      metadata: { claimId: String(claim._id), originalTicketId: String(originalTicket._id), warrantyActive },
    });
  }

  // تحديث مؤشرات الجهاز والعميل
  await DeviceModel.updateOne({ _id: originalTicket.deviceId }, { $inc: { 'passport.warrantyClaims': 1 } });
  await CustomerModel.updateOne({ _id: originalTicket.customerId }, { $inc: { 'stats.warrantyClaims': 1 } });

  await recordTimelineEvent({
    ticket: originalTicket,
    eventType: 'warranty_claim',
    note: `فتح claim ضمان ${claim.claimNumber}: ${body.symptom}`,
    actor: { userId: auth.userId, fullName: auth.fullName, role: auth.role },
    metadata: { claimId: String(claim._id), daysSinceDelivery, warrantyActive },
  });

  await recordAudit(
    {
      action: 'create',
      resource: 'WarrantyClaim',
      resourceId: String(claim._id),
      summary: `claim ضمان جديد ${claim.claimNumber} على التذكرة ${originalTicket.ticketNumber}`,
      severity: 'warning',
    },
    req,
  );

  return created(res, { ...claim.toObject(), warrantyActive, daysSinceDelivery });
};

/** قرار الضمان: قبول/رفض مع تسجيل الأساس والتكلفة التعويضية */
export const decideWarrantyClaim = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const claim = await WarrantyClaimModel.findById(req.params.id);
  if (!claim) throw ApiError.notFound('claim الضمان غير موجود');

  const body = req.body as {
    status: string;
    coverage?: 'part' | 'labor' | 'both' | 'none';
    decisionNotes?: string;
    rejectedReason?: string;
    repairCostEgp: number;
    chargedToCustomerEgp: number;
    chargedToSupplierEgp: number;
    supplierId?: string | null;
    supplierClaimStatus?: 'not_applicable' | 'requested' | 'accepted' | 'rejected';
    replacementRepairPartId?: string | null;
    resolutionNotes?: string;
  };

  claim.status = body.status as typeof claim.status;
  if (body.coverage) claim.coverage = body.coverage;
  claim.decisionNotes = body.decisionNotes ?? claim.decisionNotes;
  claim.rejectedReason = body.rejectedReason ?? '';
  claim.repairCostEgp = money(body.repairCostEgp);
  claim.chargedToCustomerEgp = money(body.chargedToCustomerEgp);
  claim.chargedToSupplierEgp = money(body.chargedToSupplierEgp);
  if (body.supplierId !== undefined) claim.supplierId = body.supplierId ? new Types.ObjectId(body.supplierId) : null;
  if (body.supplierClaimStatus) claim.supplierClaimStatus = body.supplierClaimStatus;
  if (body.replacementRepairPartId) claim.replacementRepairPartId = new Types.ObjectId(body.replacementRepairPartId);
  if (body.resolutionNotes !== undefined) claim.resolutionNotes = body.resolutionNotes;

  claim.approvedBy = new Types.ObjectId(auth.userId);
  claim.decidedAt = new Date();
  if (body.status === 'resolved') claim.resolvedAt = new Date();

  await claim.save();

  // تحديث مؤشرات جودة القطعة عند وجود قطعة مستبدلة
  if (body.replacementRepairPartId) {
    await refreshPartQualityStats(body.replacementRepairPartId);
  }

  // تحديث مؤشر أداء المورد عند تحميله التكلفة
  if (claim.supplierId && body.chargedToSupplierEgp > 0) {
    await SupplierModel.updateOne(
      { _id: claim.supplierId },
      { $inc: { 'performance.totalDefective': 1, 'performance.totalPurchasedEgp': 0 } },
    );
  }

  const ticket = await RepairTicketModel.findById(claim.originalTicketId);
  if (ticket) {
    await recordTimelineEvent({
      ticket,
      eventType: 'warranty_resolved',
      note: `قرار claim الضمان ${claim.claimNumber}: ${body.status}`,
      actor: { userId: auth.userId, fullName: auth.fullName, role: auth.role },
      metadata: { claimId: String(claim._id), status: body.status, repairCostEgp: claim.repairCostEgp },
    });
  }

  await recordAudit(
    {
      action: body.status === 'rejected' ? 'reject' : 'approve',
      resource: 'WarrantyClaim',
      resourceId: String(claim._id),
      summary: `قرار claim ${claim.claimNumber}: ${body.status}`,
      severity: body.status === 'rejected' ? 'warning' : 'info',
    },
    req,
  );

  return ok(res, claim.toObject());
};

/**
 * Warranty Intelligence: معدلات العودة حسب نوع العطل، القطعة، الفني، والموديل.
 */
export const warrantyIntelligence = async (req: Request, res: Response) => {
  const query = req.query as Record<string, unknown>;
  const match: Record<string, unknown> = {};
  if (query.from || query.to) {
    const range: Record<string, Date> = {};
    if (query.from) range.$gte = new Date(String(query.from));
    if (query.to) range.$lte = new Date(String(query.to));
    match.reportedAt = range;
  }

  const [totalClaims, byFault, byTechnician, byModel, resolvedStats, totalDelivered] = await Promise.all([
    WarrantyClaimModel.countDocuments(match),
    WarrantyClaimModel.aggregate<{ _id: string; count: number; sameFault: number }>([
      { $match: match },
      {
        $group: {
          _id: '$faultCategory',
          count: { $sum: 1 },
          sameFault: { $sum: { $cond: ['$isSameFault', 1, 0] } },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 20 },
    ]),
    WarrantyClaimModel.aggregate<{ _id: Types.ObjectId; count: number; sameFault: number; avgDays: number }>([
      { $match: match },
      {
        $group: {
          _id: '$originalTechnicianId',
          count: { $sum: 1 },
          sameFault: { $sum: { $cond: ['$isSameFault', 1, 0] } },
          avgDays: { $avg: '$daysSinceDelivery' },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 30 },
    ]),
    WarrantyClaimModel.aggregate<{ _id: Types.ObjectId; count: number; sameFault: number }>([
      { $match: match },
      { $group: { _id: '$deviceId', count: { $sum: 1 }, sameFault: { $sum: { $cond: ['$isSameFault', 1, 0] } } } },
      { $sort: { count: -1 } },
      { $limit: 30 },
    ]),
    WarrantyClaimModel.aggregate<{ _id: string; count: number; cost: number; chargedCustomer: number; chargedSupplier: number }>([
      { $match: match },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          cost: { $sum: '$repairCostEgp' },
          chargedCustomer: { $sum: '$chargedToCustomerEgp' },
          chargedSupplier: { $sum: '$chargedToSupplierEgp' },
        },
      },
    ]),
    RepairTicketModel.countDocuments({ status: 'delivered' }),
  ]);

  const technicianIds = byTechnician.map((t) => t._id).filter(Boolean);
  const technicians = await UserModel.find({ _id: { $in: technicianIds } }).select('fullName').lean();
  const techMap = new Map(technicians.map((t) => [String(t._id), t.fullName]));

  const deviceIds = byModel.map((d) => d._id).filter(Boolean);
  const devices = await DeviceModel.find({ _id: { $in: deviceIds } }).select('brand model').lean();
  const devMap = new Map(devices.map((d) => [String(d._id), `${d.brand} ${d.model}`]));

  const totalCost = resolvedStats.reduce((acc, s) => acc + (s.cost ?? 0), 0);

  return ok(res, {
    totalClaims,
    totalDeliveredTickets: totalDelivered,
    /** نسبة العودة: claims لكل إصلاح مُسلَّم */
    returnRatePct: totalDelivered ? money((totalClaims / totalDelivered) * 100) : 0,
    totalWarrantyCostEgp: money(totalCost),
    byStatus: resolvedStats.map((s) => ({ status: s._id, count: s.count, costEgp: money(s.cost) })),
    byFaultCategory: byFault.map((f) => ({
      faultCategory: f._id || 'غير محدد',
      claims: f.count,
      sameFaultClaims: f.sameFault,
      sameFaultPct: f.count ? money((f.sameFault / f.count) * 100) : 0,
    })),
    byTechnician: byTechnician.map((t) => ({
      technicianId: t._id ? String(t._id) : null,
      name: t._id ? (techMap.get(String(t._id)) ?? 'غير محدد') : 'غير محدد',
      claims: t.count,
      sameFaultClaims: t.sameFault,
      avgDaysToReturn: Number((t.avgDays ?? 0).toFixed(1)),
      /** ملاحظة: هذا مؤشر سياقي وليس أداة عقابية */
      note: 'المؤشر يحتاج سياقًا: بعض الأعطال أكثر تعقيدًا من غيرها',
    })),
    topReturningDevices: byModel.map((d) => ({
      deviceId: d._id ? String(d._id) : null,
      device: d._id ? (devMap.get(String(d._id)) ?? 'غير معروف') : 'غير معروف',
      claims: d.count,
      sameFaultClaims: d.sameFault,
    })),
  });
};

/** القطع الأكثر فشلًا (Parts Quality Intelligence) */
export const failingPartsReport = async (req: Request, res: Response) => {
  const query = req.query as Record<string, unknown>;
  const match: Record<string, unknown> = { status: { $in: ['installed', 'defective'] } };
  if (query.from || query.to) {
    const range: Record<string, Date> = {};
    if (query.from) range.$gte = new Date(String(query.from));
    if (query.to) range.$lte = new Date(String(query.to));
    match.installedAt = range;
  }

  const results = await RepairPartModel.aggregate<{
    _id: Types.ObjectId;
    units: number;
    failures: number;
    suppliers: Types.ObjectId[];
  }>([
    { $match: match },
    {
      $group: {
        _id: '$partId',
        units: { $sum: '$quantity' },
        failures: { $sum: { $cond: [{ $eq: ['$status', 'defective'] }, 1, 0] } },
        suppliers: { $addToSet: '$supplierId' },
      },
    },
    { $match: { failures: { $gt: 0 } } },
    { $sort: { failures: -1 } },
    { $limit: 50 },
  ]);

  const parts = await PartModel.find({ _id: { $in: results.map((r) => r._id) } })
    .select('name sku category grade pricing')
    .lean();
  const partMap = new Map(parts.map((p) => [String(p._id), p]));

  return ok(
    res,
    results.map((r) => {
      const part = partMap.get(String(r._id));
      return {
        partId: String(r._id),
        name: part?.name ?? '—',
        sku: part?.sku ?? '',
        category: part?.category ?? '',
        grade: part?.grade ?? '',
        unitsUsed: r.units,
        failures: r.failures,
        failureRatePct: r.units ? money((r.failures / r.units) * 100) : 0,
        costEgp: part?.pricing?.costEgp ?? 0,
        estimatedLossEgp: money(r.failures * (part?.pricing?.costEgp ?? 0)),
      };
    }),
  );
};

/** أداء الموردين من ناحية العيوب */
export const supplierQualityReport = async (_req: Request, res: Response) => {
  const results = await SupplierModel.aggregate<{
    _id: Types.ObjectId;
    name: string;
    totalDefective: number;
    totalSupplied: number;
  }>([
    { $match: { isActive: true } },
    {
      $lookup: {
        from: 'stockbatches',
        localField: '_id',
        foreignField: 'supplierId',
        as: 'batches',
      },
    },
    {
      $project: {
        name: 1,
        totalDefective: { $sum: '$batches.quantityDefective' },
        totalSupplied: { $sum: '$batches.quantityReceived' },
      },
    },
    { $sort: { totalDefective: -1 } },
    { $limit: 50 },
  ]);

  return ok(
    res,
    results.map((r) => ({
      supplierId: String(r._id),
      name: r.name,
      totalSupplied: r.totalSupplied,
      totalDefective: r.totalDefective,
      defectRatePct: r.totalSupplied ? money((r.totalDefective / r.totalSupplied) * 100) : 0,
    })),
  );
};
