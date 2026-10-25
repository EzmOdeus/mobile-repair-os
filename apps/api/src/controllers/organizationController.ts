import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { OrganizationModel } from '../models/Organization.js';
import { BranchModel } from '../models/Branch.js';
import { UserModel } from '../models/User.js';
import { RepairTicketModel } from '../models/RepairTicket.js';
import { QualityCheckModel } from '../models/QualityCheck.js';
import { WarrantyClaimModel } from '../models/WarrantyClaim.js';
import { InvoiceModel } from '../models/Invoice.js';
import {
  SUBSCRIPTION_PAYMENT_METHOD_LABELS_AR,
  SubscriptionPaymentModel,
  type SubscriptionPaymentMethod,
} from '../models/SubscriptionPayment.js';
import { SubscriptionRenewalRequestModel } from '../models/SubscriptionRenewalRequest.js';
import { ACTIVE_REPAIR_STATUSES } from '../constants/repair.js';
import { assertBranchLimit, getPlanUsage } from '../services/planService.js';
import { PLANS, type PlanKey } from '../constants/plans.js';
import {
  activateSubscription,
  changePlan,
  getSubscriptionState,
} from '../services/subscriptionService.js';
import { ApiError } from '../utils/ApiError.js';
import { created, ok } from '../utils/asyncHandler.js';
import { branchFilter, getAuth } from '../middleware/auth.js';
import { getTenantContext } from '../context/tenantContext.js';
import { recordAudit } from '../services/auditService.js';
import { normalizeEgyptPhone } from '../validators/common.js';

/* ======================== المؤسسة والإعدادات ======================== */

export const getOrganization = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const organization = await OrganizationModel.findById(auth.organizationId).lean();
  if (!organization) throw ApiError.notFound('المؤسسة غير موجودة');

  const [branches, planUsage] = await Promise.all([
    BranchModel.find().sort({ isDefault: -1, name: 1 }).lean(),
    getPlanUsage(auth.organizationId),
  ]);

  return ok(res, {
    organization,
    branches,
    usage: {
      activeUsers: planUsage.users.used,
      activeBranches: planUsage.branches.used,
      monthlyTickets: planUsage.monthlyTickets.used,
      limits: organization.subscription,
      /** تفصيل مقروء للواجهة: المستخدَم مقابل الحد لكل مورد */
      plan: {
        key: planUsage.plan.key,
        nameAr: planUsage.plan.nameAr,
        priceEgp: planUsage.plan.monthlyPriceEgp,
        users: planUsage.users,
        branches: planUsage.branches,
        monthlyTickets: planUsage.monthlyTickets,
      },
    },
    /** حالة الاشتراك المحسوبة: الأيام المتبقية، المنع، مهلة السداد */
    subscription: getSubscriptionState(organization.subscription),
  });
};

/** كتالوج الباقات مع أعلام التفويض (ذاتي/تجربة/تسعير مخصص) لشاشة الاشتراك */
export const listPlanCatalog = (_req: Request, res: Response) => {
  return ok(res, Object.values(PLANS));
};

export const updateOrganization = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const organization = await OrganizationModel.findById(auth.organizationId);
  if (!organization) throw ApiError.notFound('المؤسسة غير موجودة');

  const body = req.body as Record<string, unknown>;

  const scalarFields = ['name', 'nameEn', 'legalName', 'taxId', 'commercialRegister', 'phone', 'email', 'website'] as const;
  for (const field of scalarFields) {
    if (body[field] !== undefined) (organization as unknown as Record<string, unknown>)[field] = body[field];
  }
  if (body.phone) organization.phone = normalizeEgyptPhone(String(body.phone));
  if (body.address) organization.address = { ...organization.address, ...(body.address as object) } as typeof organization.address;
  if (body.branding) organization.branding = { ...organization.branding, ...(body.branding as object) } as typeof organization.branding;
  if (body.settings) organization.settings = { ...organization.settings, ...(body.settings as object) } as typeof organization.settings;

  await organization.save();

  await recordAudit(
    { action: 'update', resource: 'Organization', resourceId: String(organization._id), summary: 'تحديث إعدادات المركز' },
    req,
  );

  return ok(res, organization.toObject());
};

/* ============================ الاشتراك والباقات ============================ */

/** تغيير الباقة (ترقية/تخفيض) — الحالة والتواريخ لا تتغير هنا */
export const changeSubscriptionPlan = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const { plan } = req.body as { plan: PlanKey };

  const state = await changePlan(auth.organizationId, plan, { source: 'self_service' });

  await recordAudit(
    {
      action: 'update',
      resource: 'Organization',
      resourceId: String(auth.organizationId),
      summary: `تغيير الباقة إلى «${state.plan.nameAr}»`,
    },
    req,
  );

  return ok(res, state);
};

/**
 * تفعيل/تجديد ذاتي بعد دفع خارج المنصة (نقدًا/تحويل).
 * طريقة الدفع ومرجع العملية إلزاميان ويُسجَّلان في سجل SubscriptionPayment.
 * عند ربط Paymob لاحقًا، نجاح الـwebhook يستدعي subscriptionService.activateSubscription
 * مع source='platform' دون المرور هنا.
 */
export const activateSubscriptionHandler = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const body = req.body as {
    plan: PlanKey;
    months?: number;
    paymentMethod: SubscriptionPaymentMethod;
    paymentReference: string;
    paymentNote?: string;
  };
  const months = body.months ?? 1;

  const result = await activateSubscription(auth.organizationId, body.plan, {
    months,
    source: 'self_service',
    recordedBy: auth.userId,
    payment: {
      method: body.paymentMethod,
      reference: body.paymentReference,
      note: body.paymentNote,
    },
  });

  await recordAudit(
    {
      action: 'update',
      resource: 'Organization',
      resourceId: String(auth.organizationId),
      summary: `تفعيل اشتراك باقة «${result.state.plan.nameAr}» حتى ${result.state.expiresAt?.toLocaleDateString('ar-EG') ?? '—'} (دفع: ${result.state.priceEgp * months} ج.م — مرجع ${body.paymentReference})`,
    },
    req,
  );

  return ok(res, { ...result.state, paymentId: result.paymentId });
};

/** سجل المدفوعات الخاص بالمركز (للمالك/الإدارة فقط) */
export const listSubscriptionPayments = async (req: Request, res: Response) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
  const payments = await SubscriptionPaymentModel.find().sort({ paidAt: -1 }).limit(limit).lean();

  return ok(
    res,
    payments.map((payment) => ({
      id: String(payment._id),
      plan: payment.plan,
      amountEgp: payment.amountEgp,
      months: payment.months,
      method: payment.method,
      methodLabelAr:
        SUBSCRIPTION_PAYMENT_METHOD_LABELS_AR[payment.method as SubscriptionPaymentMethod] ?? payment.method,
      reference: payment.reference,
      note: payment.note,
      periodStart: payment.periodStart,
      periodEnd: payment.periodEnd,
      paidAt: payment.paidAt,
      source: payment.source,
    })),
  );
};

/** طلبات التجديد السابقة/المعلّقة للمركز */
export const listRenewalRequests = async (_req: Request, res: Response) => {
  const requests = await SubscriptionRenewalRequestModel.find()
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();

  return ok(
    res,
    requests.map((request) => ({
      id: String(request._id),
      plan: request.plan,
      months: request.months,
      paymentMethod: request.paymentMethod,
      paymentMethodLabelAr:
        SUBSCRIPTION_PAYMENT_METHOD_LABELS_AR[request.paymentMethod as SubscriptionPaymentMethod] ??
        request.paymentMethod,
      paymentReference: request.paymentReference,
      note: request.note,
      status: request.status,
      reviewNote: request.reviewNote,
      reviewedAt: request.reviewedAt,
      createdAt: request.createdAt,
    })),
  );
};

/** إنشاء طلب تجديد/عرض سعر — متاح حتى أثناء وضع القراءة فقط */
export const createRenewalRequest = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const body = req.body as {
    plan: PlanKey;
    months?: number;
    paymentMethod?: SubscriptionPaymentMethod;
    paymentReference?: string;
    note?: string;
  };

  const existing = await SubscriptionRenewalRequestModel.findOne({ status: 'pending' }).lean();
  if (existing) {
    throw ApiError.conflict('يوجد طلب تجديد معلّق بالفعل لهذا المركز. انتظر مراجعة إدارة المنصة.', {
      requestId: String(existing._id),
    });
  }

  const request = await SubscriptionRenewalRequestModel.create({
    organizationId: auth.organizationId,
    requestedBy: auth.userId,
    plan: body.plan,
    months: body.months ?? 1,
    paymentMethod: body.paymentMethod ?? 'bank_transfer',
    paymentReference: body.paymentReference ?? '',
    note: body.note ?? '',
  });

  await recordAudit(
    {
      action: 'create',
      resource: 'SubscriptionRenewalRequest',
      resourceId: String(request._id),
      summary: `طلب تجديد باقة «${PLANS[body.plan]?.nameAr ?? body.plan}» لمدة ${body.months ?? 1} شهر`,
    },
    req,
  );

  return created(res, {
    id: String(request._id),
    status: request.status,
    plan: request.plan,
    months: request.months,
    createdAt: request.createdAt,
  });
};

/* ============================== الفروع ============================== */

export const listBranches = async (_req: Request, res: Response) => {
  const branches = await BranchModel.find().populate('managerId', 'fullName phone').sort({ isDefault: -1, name: 1 }).lean();
  return ok(res, branches);
};

export const createBranch = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const ctx = getTenantContext();
  const body = req.body as Record<string, unknown> & { code: string; isDefault?: boolean };

  // فرض حد الفروع من كتالوج الباقات (بدل منطق مكرر محليًا)
  await assertBranchLimit(ctx!.organizationId);
  const branchCount = await BranchModel.countDocuments({ isActive: true });

  const payload = { ...body };
  delete payload.isDefault;

  /**
   * نُهيّئ عدّاد الترقيم على الفرع الجديد بنسخة من العدّاد المشترك الحالي.
   * السبب: لو تعطّل الفرع الأقدم لاحقًا ينتقل العدّاد إلى الفرع النشط التالي،
   * ولو كان هذا الفرع بلا `counterSeq` يبدأ الترقيم من 1 ويصطدم بأرقام موجودة.
   */
  const counterSource = await BranchModel.findOne({ isActive: true })
    .sort({ createdAt: 1, _id: 1 })
    .select('counterSeq')
    .lean();

  const branch = await BranchModel.create({
    organizationId: ctx!.organizationId,
    ...payload,
    counterSeq: counterSource?.counterSeq ?? {},
    isDefault: branchCount === 0,
  });

  if (body.isDefault) {
    await BranchModel.updateMany({ _id: { $ne: branch._id } }, { $set: { isDefault: false } });
    branch.isDefault = true;
    await branch.save();
  }

  // ربط الفرع الجديد بالمستخدم المُنشئ
  await UserModel.updateOne({ _id: auth.userId }, { $addToSet: { branchIds: branch._id } });

  await recordAudit({ action: 'create', resource: 'Branch', resourceId: String(branch._id), summary: `فرع جديد: ${branch.name}` }, req);
  return created(res, branch.toObject());
};

export const updateBranch = async (req: Request, res: Response) => {
  const branch = await BranchModel.findById(String(req.params.id));
  if (!branch) throw ApiError.notFound('الفرع غير موجود');

  const body = req.body as Record<string, unknown>;
  const { isDefault, address, workingHours, ...rest } = body;

  Object.assign(branch, rest);
  if (address) branch.address = { ...branch.address, ...(address as object) } as typeof branch.address;
  if (workingHours) branch.workingHours = { ...branch.workingHours, ...(workingHours as object) } as typeof branch.workingHours;

  await branch.save();

  if (isDefault === true) {
    await BranchModel.updateMany({ _id: { $ne: branch._id } }, { $set: { isDefault: false } });
    branch.isDefault = true;
    await branch.save();
  }

  await recordAudit({ action: 'update', resource: 'Branch', resourceId: String(branch._id), summary: `تحديث فرع: ${branch.name}` }, req);
  return ok(res, branch.toObject());
};

export const deactivateBranch = async (req: Request, res: Response) => {
  const branch = await BranchModel.findById(String(req.params.id));
  if (!branch) throw ApiError.notFound('الفرع غير موجود');
  if (branch.isDefault) throw ApiError.businessRule('لا يمكن تعطيل الفرع الرئيسي');

  const activeCount = await BranchModel.countDocuments({ isActive: true });
  if (activeCount <= 1) throw ApiError.businessRule('لا يمكن تعطيل آخر فرع نشط');

  branch.isActive = false;
  await branch.save();

  await recordAudit(
    { action: 'delete', resource: 'Branch', resourceId: String(branch._id), summary: `تعطيل فرع: ${branch.name}`, severity: 'warning' },
    req,
  );
  return ok(res, { message: 'تم تعطيل الفرع' });
};

/* ====================== الفنيون وأدائهم ====================== */

export const listTechnicians = async (req: Request, res: Response) => {
  const query = req.query as Record<string, unknown>;
  const filter: Record<string, unknown> = {
    $or: [{ role: 'technician' }, { 'technicianProfile.isTechnician': true }],
  };
  if (query.isActive !== undefined) filter.isActive = query.isActive === 'true';

  // الأدوار التشغيلية ترى فنيي فرعها النشط فقط، لا دليل الفنيين لكل الفروع
  const scopedBranch = branchFilter(req);
  if (scopedBranch) filter.branchIds = scopedBranch;

  const technicians = await UserModel.find(filter)
    .select('fullName username phone role isActive technicianProfile branchIds')
    .sort({ fullName: 1 })
    .lean();

  const loaded = await RepairTicketModel.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { status: { $in: ACTIVE_REPAIR_STATUSES }, assignedTechnicianId: { $ne: null } } },
    { $group: { _id: '$assignedTechnicianId', count: { $sum: 1 } } },
  ]);
  const loadMap = new Map(loaded.map((l) => [String(l._id), l.count]));

  return ok(
    res,
    technicians.map((t) => ({
      id: String(t._id),
      fullName: t.fullName,
      username: t.username,
      phone: t.phone,
      role: t.role,
      isActive: t.isActive,
      specialities: t.technicianProfile?.specialities ?? [],
      skillLevel: t.technicianProfile?.skillLevel ?? 'mid',
      maxActiveJobs: t.technicianProfile?.maxActiveJobs ?? 5,
      activeJobs: loadMap.get(String(t._id)) ?? 0,
      isAvailable: (loadMap.get(String(t._id)) ?? 0) < (t.technicianProfile?.maxActiveJobs ?? 5),
      workbench: t.technicianProfile?.workbench ?? '',
    })),
  );
};

/**
 * أداء الفنيين: عدد الإصلاحات، متوسط الزمن، معدل اجتياز QC، وعوائد الضمان.
 * النتائج سياقية: لا تُستخدم كأداة عقابية بحد ذاتها.
 */
export const technicianPerformance = async (req: Request, res: Response) => {
  const query = req.query as Record<string, unknown>;

  const range: Record<string, Date> = {};
  if (query.from) range.$gte = new Date(String(query.from));
  if (query.to) range.$lte = new Date(String(query.to));
  const hasRange = Object.keys(range).length > 0;

  const ticketMatch: Record<string, unknown> = { assignedTechnicianId: { $ne: null } };
  if (hasRange) ticketMatch.createdAt = range;
  const scopedBranch = branchFilter(req);
  if (scopedBranch) ticketMatch.branchId = scopedBranch;

  const [tickets, qcStats, claims] = await Promise.all([
    RepairTicketModel.aggregate<{
      _id: Types.ObjectId;
      total: number;
      delivered: number;
      avgMinutes: number;
      revenue: number;
      partsCost: number;
    }>([
      { $match: ticketMatch },
      {
        $group: {
          _id: '$assignedTechnicianId',
          total: { $sum: 1 },
          delivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
          avgMinutes: {
            $avg: {
              $cond: [
                { $and: ['$deliveredAt', '$repairingStartedAt'] },
                { $divide: [{ $subtract: ['$deliveredAt', '$repairingStartedAt'] }, 60000] },
                null,
              ],
            },
          },
          revenue: { $sum: '$cost.totalFinalEgp' },
          partsCost: { $sum: '$cost.partsActualEgp' },
        },
      },
      { $sort: { total: -1 } },
      { $limit: 50 },
    ]),
    QualityCheckModel.aggregate<{ _id: Types.ObjectId; checks: number; passed: number; failed: number }>([
      { $match: { technicianId: { $ne: null }, ...(scopedBranch ? { branchId: scopedBranch } : {}), ...(hasRange ? { createdAt: range } : {}) } },
      {
        $group: {
          _id: '$technicianId',
          checks: { $sum: 1 },
          passed: { $sum: { $cond: [{ $in: ['$result', ['passed', 'passed_with_notes']] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ['$result', 'failed'] }, 1, 0] } },
        },
      },
    ]),
    WarrantyClaimModel.aggregate<{ _id: Types.ObjectId; claims: number; sameFault: number; cost: number }>([
      { $match: { originalTechnicianId: { $ne: null }, ...(scopedBranch ? { branchId: scopedBranch } : {}), ...(hasRange ? { reportedAt: range } : {}) } },
      {
        $group: {
          _id: '$originalTechnicianId',
          claims: { $sum: 1 },
          sameFault: { $sum: { $cond: ['$isSameFault', 1, 0] } },
          cost: { $sum: '$repairCostEgp' },
        },
      },
    ]),
  ]);

  const technicianIds = tickets.map((t) => t._id);
  const technicians = await UserModel.find({ _id: { $in: technicianIds } })
    .select('fullName username technicianProfile.skillLevel')
    .lean();
  const techMap = new Map(technicians.map((t) => [String(t._id), t]));

  const qcMap = new Map(qcStats.map((q) => [String(q._id), q]));
  const claimMap = new Map(claims.map((c) => [String(c._id), c]));

  return ok(
    res,
    tickets.map((t) => {
      const tech = techMap.get(String(t._id));
      const qc = qcMap.get(String(t._id));
      const claim = claimMap.get(String(t._id));
      const delivered = t.delivered ?? 0;

      return {
        technicianId: String(t._id),
        name: tech?.fullName ?? 'غير معروف',
        username: tech?.username ?? '',
        skillLevel: tech?.technicianProfile?.skillLevel ?? 'mid',
        totalTickets: t.total,
        deliveredTickets: delivered,
        avgRepairHours: t.avgMinutes ? Number((t.avgMinutes / 60).toFixed(1)) : null,
        revenueEgp: Number((t.revenue ?? 0).toFixed(2)),
        partsCostEgp: Number((t.partsCost ?? 0).toFixed(2)),
        laborValueEgp: Number(((t.revenue ?? 0) - (t.partsCost ?? 0)).toFixed(2)),
        qcChecks: qc?.checks ?? 0,
        qcPassRatePct: qc?.checks ? Number(((qc.passed / qc.checks) * 100).toFixed(2)) : null,
        warrantyReturns: claim?.claims ?? 0,
        warrantyReturnRatePct: delivered ? Number((((claim?.claims ?? 0) / delivered) * 100).toFixed(2)) : null,
        sameFaultReturns: claim?.sameFault ?? 0,
        warrantyCostEgp: Number((claim?.cost ?? 0).toFixed(2)),
        note: 'المؤشرات سياقية: تعقيد الأعطال يختلف، ولا تُستخدم للعقاب آليًا',
      };
    }),
  );
};

/** الفنيون الأقل تحميلًا الآن (لتوزيع المهام) */
export const availableTechnicians = async (req: Request, res: Response) => {
  const scopedBranch = branchFilter(req);

  const filter: Record<string, unknown> = {
    isActive: true,
    $or: [{ role: 'technician' }, { 'technicianProfile.isTechnician': true }],
  };
  // الفني لا يظهر لفرع لا يخدمه — العضوية في branchIds هي مصدر الحقيقة
  if (scopedBranch) filter.branchIds = new Types.ObjectId(scopedBranch);

  const technicians = await UserModel.find(filter)
    .select('fullName technicianProfile branchIds')
    .lean();

  /**
   * الحمل يُحسب عالميًا حتى لو كانت القائمة مقيدة بفرع: سقف maxActiveJobs
   * شخصي ويُفرض في assignTechnician عبر كل الفروع، فلو حسبناه لهذا الفرع وحده
   * لعرضنا مقاعد متاحة يرفضها الـAPI عند الإسناد.
   */
  const loads = await RepairTicketModel.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { status: { $in: ACTIVE_REPAIR_STATUSES }, assignedTechnicianId: { $ne: null } } },
    { $group: { _id: '$assignedTechnicianId', count: { $sum: 1 } } },
  ]);
  const loadMap = new Map(loads.map((l) => [String(l._id), l.count]));

  const result = technicians
    .map((t) => {
      const activeJobs = loadMap.get(String(t._id)) ?? 0;
      const maxJobs = t.technicianProfile?.maxActiveJobs ?? 5;
      return {
        id: String(t._id),
        fullName: t.fullName,
        activeJobs,
        maxActiveJobs: maxJobs,
        freeSlots: Math.max(0, maxJobs - activeJobs),
        isAvailable: activeJobs < maxJobs,
        skillLevel: t.technicianProfile?.skillLevel ?? 'mid',
        specialities: t.technicianProfile?.specialities ?? [],
      };
    })
    .sort((a, b) => b.freeSlots - a.freeSlots);

  return ok(res, result);
};

/** لوحة أداء الفروع */
export const branchPerformance = async (req: Request, res: Response) => {
  const query = req.query as Record<string, unknown>;

  const range: Record<string, Date> = {};
  if (query.from) range.$gte = new Date(String(query.from));
  if (query.to) range.$lte = new Date(String(query.to));
  const hasRange = Object.keys(range).length > 0;

  const [branches, ticketStats, revenueStats] = await Promise.all([
    BranchModel.find({ isActive: true }).select('name code isDefault').lean(),
    RepairTicketModel.aggregate<{
      _id: Types.ObjectId;
      total: number;
      open: number;
      delivered: number;
      overdue: number;
      revenue: number;
    }>([
      { $match: hasRange ? { createdAt: range } : {} },
      {
        $group: {
          _id: '$branchId',
          total: { $sum: 1 },
          open: { $sum: { $cond: [{ $in: ['$status', ['delivered', 'cancelled']] }, 0, 1] } },
          delivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
          overdue: { $sum: { $cond: ['$sla.breached', 1, 0] } },
          revenue: { $sum: '$cost.totalFinalEgp' },
        },
      },
    ]),
    InvoiceModel.aggregate<{ _id: Types.ObjectId; collected: number; due: number; invoices: number }>([
      { $match: { status: { $nin: ['void', 'draft'] }, ...(hasRange ? { issuedAt: range } : {}) } },
      {
        $group: {
          _id: '$branchId',
          collected: { $sum: '$totals.paidEgp' },
          due: { $sum: '$totals.dueEgp' },
          invoices: { $sum: 1 },
        },
      },
    ]),
  ]);

  const ticketMap = new Map(ticketStats.map((t) => [String(t._id), t]));
  const revenueMap = new Map(revenueStats.map((r) => [String(r._id), r]));

  return ok(
    res,
    branches.map((b) => {
      const tickets = ticketMap.get(String(b._id));
      const revenue = revenueMap.get(String(b._id));
      return {
        branchId: String(b._id),
        name: b.name,
        code: b.code,
        isDefault: b.isDefault,
        tickets: tickets?.total ?? 0,
        openTickets: tickets?.open ?? 0,
        deliveredTickets: tickets?.delivered ?? 0,
        overdueTickets: tickets?.overdue ?? 0,
        repairRevenueEgp: Number((tickets?.revenue ?? 0).toFixed(2)),
        collectedEgp: Number((revenue?.collected ?? 0).toFixed(2)),
        receivablesEgp: Number((revenue?.due ?? 0).toFixed(2)),
        invoicesCount: revenue?.invoices ?? 0,
      };
    }),
  );
};
