import { Types } from 'mongoose';
import { env } from '../config/env.js';
import { OrganizationModel } from '../models/Organization.js';
import { NotificationModel, type NotificationType } from '../models/Notification.js';
import { UserModel } from '../models/User.js';
import {
  SubscriptionPaymentModel,
  type SubscriptionPaymentMethod,
  type SubscriptionPaymentSource,
} from '../models/SubscriptionPayment.js';
import { SubscriptionRenewalRequestModel } from '../models/SubscriptionRenewalRequest.js';
import {
  TRIAL_PLAN_KEY,
  isPlatformPlan,
  isSelfServicePlan,
  planLimits,
  PLANS,
  type PlanKey,
  type PlanLimits,
} from '../constants/plans.js';
import { ApiError } from '../utils/ApiError.js';

export const SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'cancelled'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

interface SubscriptionShape {
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

export interface SubscriptionState {
  planKey: PlanKey;
  plan: PlanLimits;
  /** الحالة الفعلية المحسوبة (active منتهٍ يظهر past_due قبل أن يعالجه المجدول) */
  status: SubscriptionStatus;
  startedAt: Date | null;
  expiresAt: Date | null;
  /** نهاية مهلة السداد إن كنا فيها/انتهت */
  graceEndsAt: Date | null;
  /** أيام متبقية حتى الانتهاء (سالبة بعده). null يعني بلا تاريخ انتهاء */
  daysRemaining: number | null;
  /** أيام متبقية في مهلة السداد (سالبة بعد انتهائها) */
  graceDaysRemaining: number | null;
  /** السعر الشهري الفعلي المخزَّن (يشمل التسعير المخصص للمؤسسية) */
  priceEgp: number;
  /** انتهى فعليًا أو أُلغي — يمنع الإنشاء الجديد */
  blocked: boolean;
  /** في مهلة السداد بعد انتهاء فترة مدفوعة */
  inGrace: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysFromNow(target: Date, now: number): number {
  const raw = (target.getTime() - now) / DAY_MS;
  return raw >= 0 ? Math.ceil(raw) : Math.floor(raw);
}

export function getSubscriptionState(subscription: SubscriptionShape | null | undefined): SubscriptionState {
  const plan = planLimits(subscription?.plan);
  const rawStatus = (subscription?.status ?? 'trialing') as SubscriptionStatus;
  const storedStatus: SubscriptionStatus = SUBSCRIPTION_STATUSES.includes(rawStatus) ? rawStatus : 'trialing';
  const expiresAt = subscription?.expiresAt ? new Date(subscription.expiresAt) : null;
  const now = Date.now();
  const expiredByDate = expiresAt !== null && expiresAt.getTime() <= now;

  /**
   * الحالة الفعلية: لا ننتظر المجدول (كل ساعة) ليصحّ المنع.
   * - تجربة منتهية → ملغاة بلا مهلة.
   * - اشتراك مدفوع منتهٍ → مهلة سداد حتى graceEndsAt.
   */
  let status: SubscriptionStatus = storedStatus;
  if (storedStatus === 'trialing' && expiredByDate) status = 'cancelled';
  else if (storedStatus === 'active' && expiredByDate) status = 'past_due';

  /**
   * صف `active` منتهٍ لم يعالجه المجدول بعد: نحسب المهلة ديناميكيًا حتى لا يُحظر
   * المركز في الفترة بين الانتهاء وتشغيل المجدول.
   * صف `past_due` قديم بلا graceEndsAt كان المجدول يكتب نهاية المهلة في expiresAt،
   * فنستخدم expiresAt احتياطيًا بدل منحه مهلة إضافية بالخطأ.
   */
  const graceEndsAt =
    status === 'past_due'
      ? subscription?.graceEndsAt
        ? new Date(subscription.graceEndsAt)
        : expiresAt
          ? storedStatus === 'active'
            ? new Date(expiresAt.getTime() + env.SUBSCRIPTION_GRACE_DAYS * DAY_MS)
            : expiresAt
          : null
      : null;
  const graceExpired = graceEndsAt !== null && graceEndsAt.getTime() <= now;
  const blocked =
    status === 'cancelled' ||
    (status === 'past_due' && (graceEndsAt === null || graceExpired)) ||
    (storedStatus === 'trialing' && expiredByDate);

  return {
    planKey: plan.key,
    plan,
    status,
    startedAt: subscription?.startedAt ?? null,
    expiresAt,
    graceEndsAt,
    daysRemaining: expiresAt ? daysFromNow(expiresAt, now) : null,
    graceDaysRemaining: graceEndsAt ? daysFromNow(graceEndsAt, now) : null,
    priceEgp:
      typeof subscription?.priceEgp === 'number' && Number.isFinite(subscription.priceEgp)
        ? subscription.priceEgp
        : plan.monthlyPriceEgp,
    blocked,
    inGrace: status === 'past_due' && !blocked,
  };
}

/**
 * يمنع أي إنشاء جديد (مستخدم/فرع/تذكرة) لو الاشتراك منتهٍ أو ملغى.
 * يُنادى أولًا داخل دوال assert الخاصة بحدود الباقة في planService.
 */
export async function assertSubscriptionActive(organizationId: Types.ObjectId | string): Promise<SubscriptionState> {
  const organization = await OrganizationModel.findById(organizationId).select('subscription').lean();
  if (!organization) throw ApiError.notFound('المؤسسة غير موجودة');

  const state = getSubscriptionState(organization.subscription);

  if (state.blocked) {
    const reason =
      state.status === 'cancelled'
        ? 'اشتراك مركزك موقوف. فعّل اشتراكك من الإعدادات للمتابعة.'
        : 'انتهت مهلة سداد الاشتراك. جدّد باقتك من الإعدادات للمتابعة.';
    throw ApiError.businessRule(reason, {
      code: 'SUBSCRIPTION_EXPIRED',
      status: state.status,
      expiresAt: state.expiresAt,
      graceEndsAt: state.graceEndsAt,
      plan: state.planKey,
    });
  }

  return state;
}

/**
 * يبدأ الفترة التجريبية لمؤسسة جديدة. يُستدعى من التسجيل الذاتي.
 * حدود «المبتدئة» تُمنح لمدة TRIAL_DAYS فقط، وبعدها لا توجد باقة مجانية دائمة.
 */
export async function startTrial(
  organizationId: Types.ObjectId | string,
  planKey: PlanKey = TRIAL_PLAN_KEY,
): Promise<SubscriptionState> {
  const plan = PLANS[planKey] ?? planLimits(TRIAL_PLAN_KEY);
  const expiresAt = new Date(Date.now() + env.TRIAL_DAYS * DAY_MS);

  const organization = await OrganizationModel.findByIdAndUpdate(
    organizationId,
    {
      $set: {
        'subscription.plan': plan.key,
        'subscription.status': 'trialing',
        'subscription.startedAt': new Date(),
        'subscription.expiresAt': expiresAt,
        'subscription.graceEndsAt': null,
        'subscription.reminderKeys': [],
        'subscription.maxUsers': plan.maxUsers,
        'subscription.maxBranches': plan.maxBranches,
        'subscription.monthlyTicketLimit': plan.monthlyTicketLimit,
        'subscription.priceEgp': plan.monthlyPriceEgp,
      },
    },
    { new: true },
  ).select('subscription');
  if (!organization) throw ApiError.notFound('المؤسسة غير موجودة');

  return getSubscriptionState(organization.subscription);
}

export type SubscriptionPlanSource = SubscriptionPaymentSource;

export interface ChangePlanOptions {
  source?: SubscriptionPlanSource;
  /** سعر شهري مخصص — من إدارة المنصة فقط (المؤسسية/اتفاق خاص) */
  monthlyPriceEgp?: number;
}

/**
 * تغيير الباقة (ترقية أو تخفيض) دون تغيير حالة الاشتراك أو تواريخه.
 *
 * التفويض:
 * - self_service: الباقات القياسية فقط (growth/pro).
 * - platform: growth/pro/enterprise مع إمكانية تسعير مخصص للمؤسسية.
 */
export async function changePlan(
  organizationId: Types.ObjectId | string,
  planKey: PlanKey,
  options: ChangePlanOptions = {},
): Promise<SubscriptionState> {
  const plan = PLANS[planKey];
  if (!plan) throw ApiError.badRequest('باقة غير معروفة', { plan: planKey });

  const source = options.source ?? 'self_service';
  if (source === 'self_service' && !isSelfServicePlan(planKey)) {
    throw ApiError.businessRule('هذه الباقة غير متاحة للتفعيل الذاتي. اختر باقة النمو أو الاحترافية.', {
      code: 'PLAN_NOT_SELF_SERVICE',
      plan: planKey,
    });
  }
  if (source === 'platform' && !isPlatformPlan(planKey)) {
    throw ApiError.badRequest('الباقة المبتدئة والتجريبية لا تُفعّلان كاشتراك مدفوع', { plan: planKey });
  }

  let priceEgp = plan.monthlyPriceEgp;
  if (source === 'platform' && options.monthlyPriceEgp !== undefined) {
    if (!Number.isFinite(options.monthlyPriceEgp) || options.monthlyPriceEgp < 0) {
      throw ApiError.badRequest('السعر الشهري غير صحيح');
    }
    priceEgp = Math.round(options.monthlyPriceEgp);
  }

  const organization = await OrganizationModel.findByIdAndUpdate(
    organizationId,
    {
      $set: {
        'subscription.plan': plan.key,
        'subscription.maxUsers': plan.maxUsers,
        'subscription.maxBranches': plan.maxBranches,
        'subscription.monthlyTicketLimit': plan.monthlyTicketLimit,
        'subscription.priceEgp': priceEgp,
      },
    },
    { new: true },
  ).select('subscription');
  if (!organization) throw ApiError.notFound('المؤسسة غير موجودة');

  return getSubscriptionState(organization.subscription);
}

export interface SubscriptionPaymentInput {
  method: SubscriptionPaymentMethod;
  reference?: string;
  note?: string;
  /** إجمالي المدفوع — من إدارة المنصة فقط؛ التفعيل الذاتي يُحسب من الكتالوج */
  amountEgp?: number;
  paidAt?: Date;
}

export interface ActivateSubscriptionOptions {
  months?: number;
  source?: SubscriptionPlanSource;
  /** سعر شهري مخصص — من إدارة المنصة فقط */
  monthlyPriceEgp?: number;
  /** التفعيل الذاتي يتطلب بيانات دفع؛ تفعيل المنصة يجوز بدونه (منحة/تسوية) */
  payment?: SubscriptionPaymentInput | null;
  recordedBy?: Types.ObjectId | string | null;
  renewalRequestId?: Types.ObjectId | string | null;
}

export interface ActivationResult {
  state: SubscriptionState;
  paymentId: string | null;
}

/**
 * تفعيل/تجديد الاشتراك لمدة شهر أو أكثر.
 *
 * - التمديد يبدأ من نهاية التغطية الحالية إن كانت سارية، وإلا من الآن
 *   (أيام مهلة السداد ليست تغطية مدفوعة ولا تُحتسب).
 * - كل تفعيل ذاتي يُنشئ سجل دفع إلزاميًا؛ إدارة المنصة قد تفعّل دون دفعة.
 * - نقطة ربط Paymob مستقبلًا تستدعي نفس الدالة مع source='platform' بعد نجاح الـwebhook.
 */
export async function activateSubscription(
  organizationId: Types.ObjectId | string,
  planKey: PlanKey,
  options: ActivateSubscriptionOptions = {},
): Promise<ActivationResult> {
  const plan = PLANS[planKey];
  if (!plan) throw ApiError.badRequest('باقة غير معروفة', { plan: planKey });

  const months = options.months ?? 1;
  if (!Number.isInteger(months) || months < 1 || months > 36) {
    throw ApiError.badRequest('عدد الشهور يجب أن يكون بين 1 و 36');
  }

  const source = options.source ?? 'self_service';
  if (source === 'self_service') {
    if (!isSelfServicePlan(planKey)) {
      throw ApiError.businessRule('هذه الباقة غير متاحة للتفعيل الذاتي. اختر باقة النمو أو الاحترافية.', {
        code: 'PLAN_NOT_SELF_SERVICE',
        plan: planKey,
      });
    }
    if (!options.payment?.method) {
      throw ApiError.badRequest('طريقة الدفع مطلوبة لتفعيل الاشتراك');
    }
    if (!options.payment.reference?.trim()) {
      throw ApiError.badRequest('مرجع الدفع (رقم التحويل/الإيصال) مطلوب');
    }
  } else if (!isPlatformPlan(planKey)) {
    throw ApiError.badRequest('الباقة المبتدئة والتجريبية لا تُفعّلان كاشتراك مدفوع', { plan: planKey });
  }

  let monthlyPrice = plan.monthlyPriceEgp;
  if (source === 'platform' && options.monthlyPriceEgp !== undefined) {
    if (!Number.isFinite(options.monthlyPriceEgp) || options.monthlyPriceEgp < 0) {
      throw ApiError.badRequest('السعر الشهري غير صحيح');
    }
    monthlyPrice = Math.round(options.monthlyPriceEgp);
  }

  const amountEgp =
    source === 'self_service'
      ? monthlyPrice * months
      : (options.payment?.amountEgp ?? monthlyPrice * months);
  if (!Number.isFinite(amountEgp) || amountEgp < 0) {
    throw ApiError.badRequest('مبلغ الدفعة غير صحيح');
  }

  const current = await OrganizationModel.findById(organizationId).select('subscription').lean();
  if (!current) throw ApiError.notFound('المؤسسة غير موجودة');

  const state = getSubscriptionState(current.subscription);
  const now = new Date();
  const base =
    !state.blocked && state.expiresAt && state.expiresAt.getTime() > now.getTime()
      ? new Date(state.expiresAt)
      : now;
  const expiresAt = new Date(base.getTime() + months * 30 * DAY_MS);

  const organization = await OrganizationModel.findByIdAndUpdate(
    organizationId,
    {
      $set: {
        'subscription.plan': plan.key,
        'subscription.status': 'active',
        'subscription.startedAt': now,
        'subscription.expiresAt': expiresAt,
        'subscription.graceEndsAt': null,
        'subscription.reminderKeys': [],
        'subscription.maxUsers': plan.maxUsers,
        'subscription.maxBranches': plan.maxBranches,
        'subscription.monthlyTicketLimit': plan.monthlyTicketLimit,
        'subscription.priceEgp': monthlyPrice,
      },
    },
    { new: true },
  ).select('subscription');
  if (!organization) throw ApiError.notFound('المؤسسة غير موجودة');

  let paymentId: string | null = null;
  if (source === 'self_service' || options.payment) {
    const payment = await SubscriptionPaymentModel.create({
      organizationId,
      plan: plan.key,
      amountEgp,
      months,
      method: options.payment?.method ?? 'other',
      reference: options.payment?.reference?.trim() ?? '',
      note: options.payment?.note?.trim() ?? '',
      periodStart: base,
      periodEnd: expiresAt,
      paidAt: options.payment?.paidAt ?? now,
      source,
      recordedBy: options.recordedBy ?? null,
      renewalRequestId: options.renewalRequestId ?? null,
    });
    paymentId = String(payment._id);
  }

  // تفعيل ذاتي يلغي أي طلب تجديد معلّق حتى لا تعالجه المنصة لاحقًا بالخطأ
  if (source === 'self_service') {
    await SubscriptionRenewalRequestModel.updateMany(
      { organizationId, status: 'pending' },
      {
        $set: {
          status: 'cancelled',
          reviewedAt: now,
          reviewNote: 'أُلغي تلقائيًا بعد تفعيل الاشتراك ذاتيًا',
        },
      },
    );
  }

  await notifyOwners(organizationId, {
    type: 'subscription_activated',
    subject: 'تم تفعيل الاشتراك',
    body: `تم تفعيل باقة «${plan.nameAr}» حتى ${expiresAt.toLocaleDateString('ar-EG')}.`,
    templateKey: 'subscription_activated',
    variables: { plan: plan.key, planNameAr: plan.nameAr, expiresAt, amountEgp, months },
  });

  return { state: getSubscriptionState(organization.subscription), paymentId };
}

export interface NotifyOwnersPayload {
  type: NotificationType;
  subject: string;
  body: string;
  templateKey: string;
  variables: Record<string, unknown>;
}

/** إشعار داخلي لكل مالكي المؤسسة النشطين — متاح لخدمات أخرى (رفض طلب تجديد مثلًا) */
export async function notifyOrganizationOwners(
  organizationId: Types.ObjectId | string,
  payload: NotifyOwnersPayload,
): Promise<void> {
  const owners = await UserModel.find({ organizationId, role: 'owner', isActive: true }).select('_id').lean();
  if (!owners.length) return;

  await NotificationModel.insertMany(
    owners.map((owner) => ({
      organizationId,
      branchId: null,
      userId: owner._id,
      type: payload.type,
      channel: 'in_app' as const,
      status: 'sent' as const,
      subject: payload.subject,
      body: payload.body,
      templateKey: payload.templateKey,
      variables: payload.variables,
      provider: 'log',
      sentAt: new Date(),
    })),
  );
}

const notifyOwners = notifyOrganizationOwners;

/**
 * ينقل حالات الاشتراك المنتهية — يعمل عليه subscriptionScheduler دوريًا:
 * - تجريبي منتهٍ → cancelled (بلا مهلة سماح للتجربة).
 * - مدفوع منتهٍ → past_due مع graceEndsAt = نهاية التغطية + مهلة السداد (لا نمدّد expiresAt).
 * - past_due انتهت مهلته → cancelled.
 *
 * المنع الفعلي لا يعتمد على هذه الدالة: getSubscriptionState يحسب المهلة ديناميكيًا.
 * يعيد عدد المؤسسات التي تحوّلت حالتها.
 */
export async function expireOverdueOrganizations(now = new Date()): Promise<number> {
  const overdue = await OrganizationModel.find({
    'subscription.status': { $in: ['trialing', 'active', 'past_due'] },
    $or: [
      { 'subscription.expiresAt': { $ne: null, $lte: now } },
      { 'subscription.graceEndsAt': { $ne: null, $lte: now } },
    ],
  })
    .select('name subscription')
    .lean();

  let transitioned = 0;
  for (const org of overdue) {
    const subscription = org.subscription as SubscriptionShape | undefined;
    const storedStatus = subscription?.status;
    const organizationId = org._id as Types.ObjectId;
    const expiresAt = subscription?.expiresAt ? new Date(subscription.expiresAt) : null;

    if (storedStatus === 'trialing' && expiresAt && expiresAt.getTime() <= now.getTime()) {
      const result = await OrganizationModel.updateOne(
        { _id: organizationId, 'subscription.status': 'trialing' },
        { $set: { 'subscription.status': 'cancelled', 'subscription.graceEndsAt': null } },
      );
      if (!result.modifiedCount) continue;
      await notifyOwners(organizationId, {
        type: 'subscription_expired',
        subject: 'انتهت الفترة التجريبية',
        body: `انتهت الفترة التجريبية لمركز «${org.name}». فعّل باقة النمو أو الاحترافية من الإعدادات لاستئناف العمل.`,
        templateKey: 'subscription_expired',
        variables: { plan: subscription?.plan, status: 'cancelled' },
      });
      transitioned += 1;
      continue;
    }

    if (storedStatus === 'active' && expiresAt && expiresAt.getTime() <= now.getTime()) {
      const graceEndsAt = new Date(expiresAt.getTime() + env.SUBSCRIPTION_GRACE_DAYS * DAY_MS);
      if (graceEndsAt.getTime() <= now.getTime()) {
        const result = await OrganizationModel.updateOne(
          { _id: organizationId, 'subscription.status': 'active' },
          { $set: { 'subscription.status': 'cancelled', 'subscription.graceEndsAt': graceEndsAt } },
        );
        if (!result.modifiedCount) continue;
        await notifyOwners(organizationId, {
          type: 'subscription_expired',
          subject: 'تم إيقاف الاشتراك',
          body: `انتهت مهلة السداد لمركز «${org.name}» وتم إيقاف الاشتراك. فعّل باقة من الإعدادات أو أرسل طلب تجديد.`,
          templateKey: 'subscription_expired',
          variables: { plan: subscription?.plan, status: 'cancelled' },
        });
      } else {
        const result = await OrganizationModel.updateOne(
          { _id: organizationId, 'subscription.status': 'active' },
          { $set: { 'subscription.status': 'past_due', 'subscription.graceEndsAt': graceEndsAt } },
        );
        if (!result.modifiedCount) continue;
        await notifyOwners(organizationId, {
          type: 'subscription_expired',
          subject: 'انتهى اشتراك مركزك',
          body: `انتهت فترة اشتراك مركز «${org.name}». لديك ${env.SUBSCRIPTION_GRACE_DAYS} أيام مهلة سداد قبل الإيقاف الكامل.`,
          templateKey: 'subscription_expired',
          variables: {
            plan: subscription?.plan,
            status: 'past_due',
            graceDays: env.SUBSCRIPTION_GRACE_DAYS,
            graceEndsAt,
          },
        });
      }
      transitioned += 1;
      continue;
    }

    if (storedStatus === 'past_due') {
      const graceEndsAt = subscription?.graceEndsAt
        ? new Date(subscription.graceEndsAt)
        : expiresAt;
      if (!graceEndsAt || graceEndsAt.getTime() > now.getTime()) continue;

      const result = await OrganizationModel.updateOne(
        { _id: organizationId, 'subscription.status': 'past_due' },
        { $set: { 'subscription.status': 'cancelled' } },
      );
      if (!result.modifiedCount) continue;
      await notifyOwners(organizationId, {
        type: 'subscription_expired',
        subject: 'تم إيقاف الاشتراك',
        body: `انتهت مهلة السداد لمركز «${org.name}» وتم إيقاف الاشتراك. فعّل باقة من الإعدادات أو أرسل طلب تجديد.`,
        templateKey: 'subscription_expired',
        variables: { plan: subscription?.plan, status: 'cancelled' },
      });
      transitioned += 1;
    }
  }

  return transitioned;
}

/** أيام التذكير المفعّلة من الإعداد (مثال: 7,3,1) بترتيب تصاعدي */
export function subscriptionReminderThresholds(): number[] {
  return env.SUBSCRIPTION_REMINDER_DAYS.split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0 && value <= 90)
    .sort((a, b) => a - b);
}

/**
 * يرسل تذكيرًا واحدًا عند أقرب عتبة مستحقة (7/3/1 يومًا) لكل دورة اشتراك.
 * المفتاح يشمل تاريخ الانتهاء، فيُعاد التذكير تلقائيًا بعد التجديد.
 */
export async function sendSubscriptionReminders(now = new Date()): Promise<number> {
  const thresholds = subscriptionReminderThresholds();
  if (!thresholds.length) return 0;

  const maxDays = thresholds[thresholds.length - 1]!;
  const organizations = await OrganizationModel.find({
    'subscription.status': { $in: ['trialing', 'active'] },
    'subscription.expiresAt': {
      $ne: null,
      $gt: now,
      $lte: new Date(now.getTime() + maxDays * DAY_MS),
    },
  })
    .select('name subscription')
    .lean();

  let sent = 0;
  for (const org of organizations) {
    const subscription = org.subscription as SubscriptionShape | undefined;
    const state = getSubscriptionState(subscription);
    if (state.blocked || state.daysRemaining === null || !state.expiresAt) continue;

    const threshold = thresholds.find((days) => state.daysRemaining! <= days);
    if (threshold === undefined) continue;

    const key = `${threshold}:${state.expiresAt.toISOString()}`;
    const claimed = await OrganizationModel.findOneAndUpdate(
      {
        _id: org._id,
        'subscription.status': { $in: ['trialing', 'active'] },
        'subscription.reminderKeys': { $ne: key },
      },
      { $addToSet: { 'subscription.reminderKeys': key } },
      { new: true },
    )
      .select('_id')
      .lean();
    if (!claimed) continue;

    const days = state.daysRemaining;
    const isTrial = subscription?.status === 'trialing';
    await notifyOwners(org._id as Types.ObjectId, {
      type: 'subscription_expiring',
      subject: isTrial ? 'فترتك التجريبية تنتهي قريبًا' : 'اشتراكك ينتهي قريبًا',
      body: isTrial
        ? `تنتهي الفترة التجريبية لمركز «${org.name}» خلال ${days} يوم. اختر باقة مدفوعة لتفادي توقف العمل.`
        : `ينتهي اشتراك مركز «${org.name}» خلال ${days} يوم. جدّد الباقة الآن لتفادي الإيقاف.`,
      templateKey: 'subscription_expiring',
      variables: {
        plan: state.planKey,
        planNameAr: state.plan.nameAr,
        daysRemaining: days,
        expiresAt: state.expiresAt,
        status: state.status,
        threshold,
      },
    });
    sent += 1;
  }

  return sent;
}
