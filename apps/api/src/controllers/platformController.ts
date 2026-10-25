import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { OrganizationModel } from '../models/Organization.js';
import { BranchModel } from '../models/Branch.js';
import { UserModel } from '../models/User.js';
import { RepairTicketModel } from '../models/RepairTicket.js';
import {
  SUBSCRIPTION_PAYMENT_METHOD_LABELS_AR,
  SubscriptionPaymentModel,
  type SubscriptionPaymentMethod,
} from '../models/SubscriptionPayment.js';
import { SubscriptionRenewalRequestModel } from '../models/SubscriptionRenewalRequest.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler, created, ok } from '../utils/asyncHandler.js';
import { getAuth } from '../middleware/auth.js';
import { recordAudit } from '../services/auditService.js';
import { runAsSystem, type TenantContext } from '../context/tenantContext.js';
import { monthRange } from '../utils/dates.js';
import { PLANS, type PlanKey } from '../constants/plans.js';
import {
  getSubscriptionState,
  changePlan,
  activateSubscription,
  notifyOrganizationOwners,
  type SubscriptionState,
} from '../services/subscriptionService.js';

/* ------------------------------------------------------------------ */
/* أدوات مشتركة                                                        */
/* ------------------------------------------------------------------ */

/** سياق تدقيق لمسارات المنصة: الفاعل = مدير المنصة، والمؤسسة = المؤسسة الهدف (يظهر في سجلها) */
function platformAuditContext(req: Request, targetOrgId: Types.ObjectId): TenantContext {
  const auth = getAuth(req);
  const userAgent = req.headers['user-agent'];
  return {
    actor: {
      userId: auth.userId,
      organizationId: new Types.ObjectId(auth.organizationId),
      branchId: null,
      role: auth.role,
      fullName: auth.fullName,
    },
    organizationId: targetOrgId,
    branchId: null,
    requestId: req.requestId ?? '',
    ip: typeof req.ip === 'string' ? req.ip : '',
    userAgent: typeof userAgent === 'string' ? userAgent : '',
  };
}

function targetObjectId(req: Request): Types.ObjectId {
  const raw = req.params.id;
  const id = Array.isArray(raw) ? String(raw[0] ?? '') : String(raw ?? '');
  if (!id || !Types.ObjectId.isValid(id)) throw ApiError.badRequest('معرّف مؤسسة غير صحيح');
  return new Types.ObjectId(id);
}

interface OrgSubscriptionShape {
  plan?: string | null;
  status?: string | null;
  startedAt?: Date | null;
  expiresAt?: Date | null;
  graceEndsAt?: Date | null;
  reminderKeys?: string[] | null;
  maxUsers?: number | null;
  maxBranches?: number | null;
  monthlyTicketLimit?: number | null;
  priceEgp?: number | null;
}

function serializeOrgSummary(
  org: { _id: unknown; name: string; slug: string; phone?: string; email?: string; isActive?: boolean; subscription?: OrgSubscriptionShape; createdAt?: Date },
  usersCount: number,
  ticketsThisMonth: number,
) {
  const state: SubscriptionState = getSubscriptionState(org.subscription);
  return {
    id: String(org._id),
    name: org.name,
    slug: org.slug,
    phone: org.phone ?? '',
    email: org.email ?? '',
    isActive: org.isActive ?? true,
    createdAt: org.createdAt ?? null,
    usersCount,
    ticketsThisMonth,
    subscription: {
      plan: state.planKey,
      planNameAr: state.plan.nameAr,
      status: state.status,
      startedAt: state.startedAt,
      expiresAt: state.expiresAt,
      graceEndsAt: state.graceEndsAt,
      daysRemaining: state.daysRemaining,
      graceDaysRemaining: state.graceDaysRemaining,
      blocked: state.blocked,
      inGrace: state.inGrace,
      monthlyPriceEgp: state.priceEgp,
      customPricing: state.plan.customPricing,
      limits: {
        maxUsers: state.plan.maxUsers,
        maxBranches: state.plan.maxBranches,
        monthlyTicketLimit: state.plan.monthlyTicketLimit,
      },
    },
  };
}

/* ------------------------------------------------------------------ */
/* المسارات                                                            */
/* ------------------------------------------------------------------ */

interface PaymentRow {
  _id: unknown;
  organizationId?: unknown;
  plan: string;
  amountEgp: number;
  months: number;
  method: string;
  reference?: string;
  note?: string;
  periodStart?: Date;
  periodEnd?: Date;
  paidAt?: Date;
  source: string;
}

function serializePayment(payment: PaymentRow, organizationName?: string) {
  return {
    id: String(payment._id),
    organizationId: payment.organizationId ? String(payment.organizationId) : null,
    organizationName: organizationName ?? '',
    plan: payment.plan,
    amountEgp: payment.amountEgp,
    months: payment.months,
    method: payment.method,
    methodLabelAr:
      SUBSCRIPTION_PAYMENT_METHOD_LABELS_AR[payment.method as SubscriptionPaymentMethod] ?? payment.method,
    reference: payment.reference ?? '',
    note: payment.note ?? '',
    periodStart: payment.periodStart ?? null,
    periodEnd: payment.periodEnd ?? null,
    paidAt: payment.paidAt ?? null,
    source: payment.source,
  };
}

interface RenewalRequestRow {
  _id: unknown;
  organizationId?: unknown;
  plan: string;
  months: number;
  paymentMethod: string;
  paymentReference?: string;
  note?: string;
  status: string;
  reviewNote?: string;
  reviewedAt?: Date | null;
  createdAt?: Date;
}

function serializeRenewalRequest(request: RenewalRequestRow, organizationName?: string) {
  return {
    id: String(request._id),
    organizationId: request.organizationId ? String(request.organizationId) : null,
    organizationName: organizationName ?? '',
    plan: request.plan,
    planNameAr: PLANS[request.plan as PlanKey]?.nameAr ?? request.plan,
    months: request.months,
    paymentMethod: request.paymentMethod,
    paymentMethodLabelAr:
      SUBSCRIPTION_PAYMENT_METHOD_LABELS_AR[request.paymentMethod as SubscriptionPaymentMethod] ??
      request.paymentMethod,
    paymentReference: request.paymentReference ?? '',
    note: request.note ?? '',
    status: request.status,
    reviewNote: request.reviewNote ?? '',
    reviewedAt: request.reviewedAt ?? null,
    createdAt: request.createdAt ?? null,
  };
}

/** قائمة مراكز المنصة مع حالة الاشتراك والاستخدام */
export const listOrganizations = asyncHandler(async (req: Request, res: Response) => {
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const statusFilter = typeof req.query.status === 'string' ? req.query.status.trim() : '';
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200);

  const orgs = await runAsSystem(() =>
    OrganizationModel.find(
      search
        ? {
            $or: [
              { name: { $regex: search, $options: 'i' } },
              { slug: { $regex: search, $options: 'i' } },
            ],
          }
        : {},
    )
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean(),
  );

  const { from, to } = monthRange();
  const items = await Promise.all(
    orgs.map(async (org) => {
      const orgId = org._id as Types.ObjectId;
      const [usersCount, ticketsThisMonth] = await Promise.all([
        runAsSystem(() => UserModel.countDocuments({ organizationId: orgId, isActive: true })),
        runAsSystem(() => RepairTicketModel.countDocuments({ organizationId: orgId, createdAt: { $gte: from, $lte: to } })),
      ]);
      return serializeOrgSummary(org as never, usersCount, ticketsThisMonth);
    }),
  );

  // الفلترة بالحالة الفعلية المحسوبة (قد تختلف عن الحالة المخزنة قبل دورة المجدول)
  const filtered = statusFilter
    ? items.filter((item) => item.subscription.status === statusFilter)
    : items;

  return ok(res, { items: filtered, count: filtered.length });
});

/** إحصاءات المنصة: المراكز والمستخدمون والتذاكر والإيراد المحصّل والمتوقع */
export const platformStats = asyncHandler(async (_req: Request, res: Response) => {
  const stats = await runAsSystem(async () => {
    const { from, to } = monthRange();
    const [orgs, usersTotal, ticketsThisMonth, collections] = await Promise.all([
      OrganizationModel.find().select('isActive subscription').lean(),
      UserModel.countDocuments({ isActive: true }),
      RepairTicketModel.countDocuments({ createdAt: { $gte: from, $lte: to } }),
      SubscriptionPaymentModel.aggregate<{ collectedEgp: number; paymentsCount: number }>([
        { $match: { paidAt: { $gte: from, $lte: to } } },
        {
          $group: {
            _id: null,
            collectedEgp: { $sum: '$amountEgp' },
            paymentsCount: { $sum: 1 },
          },
        },
      ]),
    ]);

    const byStatus: Record<string, number> = { trialing: 0, active: 0, past_due: 0, cancelled: 0 };
    let mrrEgp = 0;
    let activeSubscriptions = 0;
    let suspended = 0;
    for (const org of orgs) {
      if (org.isActive === false) suspended += 1;
      const state = getSubscriptionState(org.subscription as OrgSubscriptionShape);
      byStatus[state.status] = (byStatus[state.status] ?? 0) + 1;
      if (state.status === 'active' && !state.blocked) {
        activeSubscriptions += 1;
        // السعر المخزَّن يعكس الاتفاق الفعلي (خاصة المؤسسية) بدل سعر الكتالوج
        mrrEgp += state.priceEgp;
      }
    }

    const collected = collections[0] ?? { collectedEgp: 0, paymentsCount: 0 };

    return {
      organizationsTotal: orgs.length,
      organizationsByStatus: byStatus,
      organizationsSuspended: suspended,
      activeSubscriptions,
      usersTotal,
      ticketsThisMonth,
      /** الإيراد الشهري المتوقع من الاشتراكات السارية بسعرها الفعلي */
      mrrEgp,
      /** المحصّل فعليًا هذا الشهر من سجل المدفوعات */
      collectedThisMonthEgp: collected.collectedEgp,
      paymentsThisMonth: collected.paymentsCount,
    };
  });

  return ok(res, stats);
});

/* ------------------------------------------------------------------ */
/* تفاصيل وتدبير مركز واحد (مدير المنصة)                                */
/* ------------------------------------------------------------------ */

/** تفاصيل مركز واحد: الاشتراك، الاستخدام، آخر الفروع والمستخدمين */
export const getOrganizationDetail = asyncHandler(async (req: Request, res: Response) => {
  const orgId = targetObjectId(req);

  const org = await runAsSystem(() => OrganizationModel.findById(orgId).lean());
  if (!org) throw ApiError.notFound('المركز غير موجود');

  const state = getSubscriptionState(org.subscription);
  const { from, to } = monthRange();

  const [usersCount, ticketsThisMonth, branches, users, payments, renewalRequests] = await Promise.all([
    runAsSystem(() => UserModel.countDocuments({ organizationId: orgId, isActive: true })),
    runAsSystem(() => RepairTicketModel.countDocuments({ organizationId: orgId, createdAt: { $gte: from, $lte: to } })),
    runAsSystem(() => BranchModel.find({ organizationId: orgId }).select('name code isActive isDefault').lean()),
    runAsSystem(() =>
      UserModel.find({ organizationId: orgId })
        .select('fullName username role isActive lastLoginAt')
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
    ),
    runAsSystem(() =>
      SubscriptionPaymentModel.find({ organizationId: orgId }).sort({ paidAt: -1 }).limit(10).lean(),
    ),
    runAsSystem(() =>
      SubscriptionRenewalRequestModel.find({ organizationId: orgId }).sort({ createdAt: -1 }).limit(5).lean(),
    ),
  ]);

  const summary = serializeOrgSummary(org as never, usersCount, ticketsThisMonth);

  return ok(res, {
    ...summary,
    subscription: {
      ...summary.subscription,
      statusLabel:
        state.status === 'active'
          ? 'ساري'
          : state.status === 'trialing'
            ? 'تجريبي'
            : state.status === 'past_due'
              ? 'مهلة سداد'
              : 'موقوف',
    },
    branches: branches.map((b) => ({
      id: String(b._id),
      name: b.name,
      code: b.code,
      isDefault: b.isDefault ?? false,
      isActive: b.isActive ?? true,
    })),
    users: users.map((u) => ({
      id: String(u._id),
      fullName: u.fullName,
      username: u.username,
      role: u.role,
      isActive: u.isActive,
      lastLoginAt: u.lastLoginAt ?? null,
    })),
    payments: payments.map((payment) => serializePayment(payment as unknown as PaymentRow)),
    renewalRequests: renewalRequests.map((request) =>
      serializeRenewalRequest(request as unknown as RenewalRequestRow),
    ),
  });
});

/** إيقاف مركز أو إعادة تفعيله — إجراء إداري من إدارة المنصة */
export const setOrganizationActive = asyncHandler(async (req: Request, res: Response) => {
  const orgId = targetObjectId(req);
  const { isActive } = req.body as { isActive: boolean };

  const org = await runAsSystem(() =>
    OrganizationModel.findByIdAndUpdate(
      orgId,
      { $set: { isActive: Boolean(isActive) } },
      { new: true },
    ).lean(),
  );
  if (!org) throw ApiError.notFound('المركز غير موجود');

  await recordAudit(
    {
      action: 'update',
      resource: 'Organization',
      resourceId: String(orgId),
      summary: isActive
        ? `إعادة تفعيل مركز «${org.name}» من إدارة المنصة`
        : `إيقاف مركز «${org.name}» من إدارة المنصة`,
      severity: isActive ? 'info' : 'warning',
      context: platformAuditContext(req, orgId),
    },
    req,
  );

  const state = getSubscriptionState(org.subscription);
  return ok(res, {
    id: String(org._id),
    name: org.name,
    isActive: org.isActive ?? true,
    subscriptionStatus: state.status,
    subscriptionBlocked: state.blocked,
  });
});

/** تفعيل اشتراك مركز يدويًا (بعد الدفع النقدي/التحويل أو بسعر مخصص) — يفوّض خدمة الاشتراكات */
export const activateOrgSubscription = asyncHandler(async (req: Request, res: Response) => {
  const orgId = targetObjectId(req);
  const auth = getAuth(req);
  const body = req.body as {
    plan: PlanKey;
    months?: number;
    monthlyPriceEgp?: number;
    amountEgp?: number;
    paymentMethod?: SubscriptionPaymentMethod;
    paymentReference?: string;
    paymentNote?: string;
  };
  const months = body.months ?? 1;
  const hasPayment = Boolean(body.paymentMethod || body.amountEgp !== undefined || body.paymentReference);

  const result = await runAsSystem(() =>
    activateSubscription(orgId, body.plan, {
      months,
      source: 'platform',
      monthlyPriceEgp: body.monthlyPriceEgp,
      recordedBy: auth.userId,
      payment: hasPayment
        ? {
            method: body.paymentMethod ?? 'other',
            reference: body.paymentReference,
            note: body.paymentNote,
            amountEgp: body.amountEgp,
          }
        : null,
    }),
  );

  await recordAudit(
    {
      action: 'update',
      resource: 'Organization',
      resourceId: String(orgId),
      summary: `تفعيل اشتراك باقة «${result.state.plan.nameAr}» من إدارة المنصة حتى ${result.state.expiresAt?.toLocaleDateString('ar-EG') ?? '—'}`,
      context: platformAuditContext(req, orgId),
    },
    req,
  );

  return ok(res, { ...result.state, paymentId: result.paymentId });
});

/** تغيير باقة مركز من إدارة المنصة — مع إمكانية تسعير مخصص للمؤسسية */
export const changeOrgPlan = asyncHandler(async (req: Request, res: Response) => {
  const orgId = targetObjectId(req);
  const { plan, monthlyPriceEgp } = req.body as { plan: PlanKey; monthlyPriceEgp?: number };

  const state = await runAsSystem(() =>
    changePlan(orgId, plan, { source: 'platform', monthlyPriceEgp }),
  );

  await recordAudit(
    {
      action: 'update',
      resource: 'Organization',
      resourceId: String(orgId),
      summary: `تغيير الباقة إلى «${state.plan.nameAr}» من إدارة المنصة`,
      context: platformAuditContext(req, orgId),
    },
    req,
  );

  return ok(res, state);
});

/* ------------------------------------------------------------------ */
/* كتالوج الباقات وتقرير الإيرادات                                      */
/* ------------------------------------------------------------------ */

/** كتالوج الباقات الكامل لمدير المنصة (يشمل المؤسسية غير المتاحة ذاتيًا) */
export const platformPlanCatalog = (_req: Request, res: Response) => {
  return ok(res, Object.values(PLANS));
};

function parseRangeDate(value: unknown, fallback: Date, endOfDay = false): Date {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw ApiError.badRequest('تاريخ غير صحيح', { value });
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    parsed.setHours(23, 59, 59, 999);
  }
  return parsed;
}

/** تقرير إيرادات الاشتراكات: المحصّل حسب الفترة/الباقة/الطريقة + السعر المتوقع */
export const platformRevenue = asyncHandler(async (req: Request, res: Response) => {
  const { from: monthFrom, to: monthTo } = monthRange();
  const from = parseRangeDate(req.query.from, monthFrom);
  const to = parseRangeDate(req.query.to, monthTo, true);
  if (to.getTime() < from.getTime()) throw ApiError.badRequest('نطاق التاريخ غير صحيح');

  const planFilter = typeof req.query.plan === 'string' ? req.query.plan.trim() : '';
  const methodFilter = typeof req.query.method === 'string' ? req.query.method.trim() : '';

  const result = await runAsSystem(async () => {
    const payments = await SubscriptionPaymentModel.find({
      paidAt: { $gte: from, $lte: to },
      ...(planFilter ? { plan: planFilter } : {}),
      ...(methodFilter ? { method: methodFilter } : {}),
    })
      .sort({ paidAt: -1 })
      .limit(500)
      .lean();

    const organizations = await OrganizationModel.find().select('name slug subscription isActive').lean();
    const orgMap = new Map(organizations.map((org) => [String(org._id), org]));

    const byPlanMap = new Map<string, { plan: string; planNameAr: string; count: number; collectedEgp: number }>();
    const byMethodMap = new Map<string, { method: string; methodLabelAr: string; count: number; collectedEgp: number }>();
    let collectedEgp = 0;

    for (const payment of payments) {
      collectedEgp += payment.amountEgp;

      const planRow = byPlanMap.get(payment.plan) ?? {
        plan: payment.plan,
        planNameAr: PLANS[payment.plan as PlanKey]?.nameAr ?? payment.plan,
        count: 0,
        collectedEgp: 0,
      };
      planRow.count += 1;
      planRow.collectedEgp += payment.amountEgp;
      byPlanMap.set(payment.plan, planRow);

      const methodRow = byMethodMap.get(payment.method) ?? {
        method: payment.method,
        methodLabelAr:
          SUBSCRIPTION_PAYMENT_METHOD_LABELS_AR[payment.method as SubscriptionPaymentMethod] ?? payment.method,
        count: 0,
        collectedEgp: 0,
      };
      methodRow.count += 1;
      methodRow.collectedEgp += payment.amountEgp;
      byMethodMap.set(payment.method, methodRow);
    }

    let expectedMrrEgp = 0;
    let activeSubscriptions = 0;
    for (const org of organizations) {
      const state = getSubscriptionState(org.subscription as OrgSubscriptionShape);
      if (state.status === 'active' && !state.blocked) {
        activeSubscriptions += 1;
        expectedMrrEgp += state.priceEgp;
      }
    }

    return {
      range: { from, to },
      totals: {
        collectedEgp,
        paymentsCount: payments.length,
        expectedMrrEgp,
        activeSubscriptions,
      },
      byPlan: [...byPlanMap.values()].sort((a, b) => b.collectedEgp - a.collectedEgp),
      byMethod: [...byMethodMap.values()].sort((a, b) => b.collectedEgp - a.collectedEgp),
      recent: payments.slice(0, 10).map((payment) =>
        serializePayment(
          payment as PaymentRow,
          orgMap.get(String(payment.organizationId))?.name ?? '',
        ),
      ),
    };
  });

  return ok(res, result);
});

/* ------------------------------------------------------------------ */
/* طلبات التجديد                                                        */
/* ------------------------------------------------------------------ */

/** قائمة طلبات التجديد (افتراضيًا المعلّقة) مع حالة المركز الحالية */
export const platformListRenewalRequests = asyncHandler(async (req: Request, res: Response) => {
  const statusFilter = typeof req.query.status === 'string' ? req.query.status.trim() : 'pending';
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200);

  const result = await runAsSystem(async () => {
    const requests = await SubscriptionRenewalRequestModel.find(statusFilter ? { status: statusFilter } : {})
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const orgIds = [...new Set(requests.map((request) => String(request.organizationId)))];
    const organizations = await OrganizationModel.find({ _id: { $in: orgIds } })
      .select('name slug subscription isActive')
      .lean();
    const orgMap = new Map(organizations.map((org) => [String(org._id), org]));

    return {
      items: requests.map((request) => {
        const org = orgMap.get(String(request.organizationId));
        const state = getSubscriptionState(org?.subscription as OrgSubscriptionShape);
        return {
          ...serializeRenewalRequest(request as RenewalRequestRow, org?.name ?? ''),
          organizationSlug: org?.slug ?? '',
          organizationIsActive: org?.isActive ?? true,
          subscriptionStatus: state.status,
          subscriptionBlocked: state.blocked,
          daysRemaining: state.daysRemaining,
        };
      }),
      count: requests.length,
    };
  });

  return ok(res, result);
});

function targetRequestId(req: Request): Types.ObjectId {
  const raw = req.params.id;
  const id = Array.isArray(raw) ? String(raw[0] ?? '') : String(raw ?? '');
  if (!id || !Types.ObjectId.isValid(id)) throw ApiError.badRequest('معرّف طلب غير صحيح');
  return new Types.ObjectId(id);
}

/** اعتماد طلب تجديد: تفعيل الاشتراك وتسجيل الدفعة وربطها بالطلب */
export const platformApproveRenewalRequest = asyncHandler(async (req: Request, res: Response) => {
  const requestId = targetRequestId(req);
  const auth = getAuth(req);
  const body = req.body as {
    months?: number;
    monthlyPriceEgp?: number;
    amountEgp?: number;
    paymentMethod?: SubscriptionPaymentMethod;
    paymentReference?: string;
    note?: string;
  };

  const request = await runAsSystem(() => SubscriptionRenewalRequestModel.findById(requestId).lean());
  if (!request) throw ApiError.notFound('طلب التجديد غير موجود');
  if (request.status !== 'pending') {
    throw ApiError.conflict('تمت معالجة هذا الطلب بالفعل', { status: request.status });
  }

  const months = body.months ?? request.months;
  const result = await runAsSystem(() =>
    activateSubscription(request.organizationId, request.plan as PlanKey, {
      months,
      source: 'platform',
      monthlyPriceEgp: body.monthlyPriceEgp,
      recordedBy: auth.userId,
      renewalRequestId: requestId,
      payment: {
        method: body.paymentMethod ?? (request.paymentMethod as SubscriptionPaymentMethod),
        reference: body.paymentReference ?? request.paymentReference,
        note: body.note || request.note,
        amountEgp: body.amountEgp,
      },
    }),
  );

  await runAsSystem(() =>
    SubscriptionRenewalRequestModel.updateOne(
      { _id: requestId, status: 'pending' },
      {
        $set: {
          status: 'approved',
          reviewedBy: auth.userId,
          reviewedAt: new Date(),
          reviewNote: body.note ?? 'تم اعتماد الطلب وتفعيل الاشتراك',
          resultingPaymentId: result.paymentId,
        },
      },
    ),
  );

  await recordAudit(
    {
      action: 'approve',
      resource: 'SubscriptionRenewalRequest',
      resourceId: String(requestId),
      summary: `اعتماد طلب تجديد حتى ${result.state.expiresAt?.toLocaleDateString('ar-EG') ?? '—'}`,
      context: platformAuditContext(req, request.organizationId as Types.ObjectId),
    },
    req,
  );

  return ok(res, {
    requestId: String(requestId),
    status: 'approved',
    subscription: result.state,
    paymentId: result.paymentId,
  });
});

/** رفض طلب تجديد مع إشعار مالكي المركز */
export const platformRejectRenewalRequest = asyncHandler(async (req: Request, res: Response) => {
  const requestId = targetRequestId(req);
  const auth = getAuth(req);
  const { note } = req.body as { note: string };

  const request = await runAsSystem(() => SubscriptionRenewalRequestModel.findById(requestId).lean());
  if (!request) throw ApiError.notFound('طلب التجديد غير موجود');
  if (request.status !== 'pending') {
    throw ApiError.conflict('تمت معالجة هذا الطلب بالفعل', { status: request.status });
  }

  const updated = await runAsSystem(() =>
    SubscriptionRenewalRequestModel.findOneAndUpdate(
      { _id: requestId, status: 'pending' },
      {
        $set: {
          status: 'rejected',
          reviewedBy: auth.userId,
          reviewedAt: new Date(),
          reviewNote: note,
        },
      },
      { new: true },
    ).lean(),
  );

  await runAsSystem(() =>
    notifyOrganizationOwners(request.organizationId, {
      type: 'subscription_renewal_rejected',
      subject: 'تم رفض طلب التجديد',
      body: `لم يتم اعتماد طلب تجديد باقة «${PLANS[request.plan as PlanKey]?.nameAr ?? request.plan}». السبب: ${note}`,
      templateKey: 'subscription_renewal_rejected',
      variables: { plan: request.plan, reason: note },
    }),
  );

  await recordAudit(
    {
      action: 'update',
      resource: 'SubscriptionRenewalRequest',
      resourceId: String(requestId),
      summary: `رفض طلب تجديد: ${note}`,
      severity: 'warning',
      context: platformAuditContext(req, request.organizationId as Types.ObjectId),
    },
    req,
  );

  return ok(res, {
    requestId: String(requestId),
    status: updated?.status ?? 'rejected',
    reviewNote: note,
  });
});
