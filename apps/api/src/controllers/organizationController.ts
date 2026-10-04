import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { OrganizationModel } from '../models/Organization.js';
import { BranchModel } from '../models/Branch.js';
import { UserModel } from '../models/User.js';
import { RepairTicketModel } from '../models/RepairTicket.js';
import { QualityCheckModel } from '../models/QualityCheck.js';
import { WarrantyClaimModel } from '../models/WarrantyClaim.js';
import { InvoiceModel } from '../models/Invoice.js';
import { ACTIVE_REPAIR_STATUSES } from '../constants/repair.js';
import { assertBranchLimit, getPlanUsage } from '../services/planService.js';
import { ApiError } from '../utils/ApiError.js';
import { created, ok } from '../utils/asyncHandler.js';
import { getAuth } from '../middleware/auth.js';
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
  });
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
      { $match: { technicianId: { $ne: null }, ...(hasRange ? { createdAt: range } : {}) } },
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
      { $match: { originalTechnicianId: { $ne: null }, ...(hasRange ? { reportedAt: range } : {}) } },
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
export const availableTechnicians = async (_req: Request, res: Response) => {
  const technicians = await UserModel.find({
    isActive: true,
    $or: [{ role: 'technician' }, { 'technicianProfile.isTechnician': true }],
  })
    .select('fullName technicianProfile branchIds')
    .lean();

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
