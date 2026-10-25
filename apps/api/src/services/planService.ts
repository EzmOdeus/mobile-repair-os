import { Types } from 'mongoose';
import { OrganizationModel } from '../models/Organization.js';
import { UserModel } from '../models/User.js';
import { BranchModel } from '../models/Branch.js';
import { RepairTicketModel } from '../models/RepairTicket.js';
import { ApiError } from '../utils/ApiError.js';
import { planLimits, RESOURCE_LABELS_AR, type PlanLimits } from '../constants/plans.js';
import { assertSubscriptionActive } from './subscriptionService.js';
import { monthRange } from '../utils/dates.js';

export interface PlanUsage {
  plan: PlanLimits;
  users: { used: number; limit: number };
  branches: { used: number; limit: number };
  monthlyTickets: { used: number; limit: number };
}

interface SubscriptionRecord {
  plan?: string | null;
  maxUsers?: number | null;
  maxBranches?: number | null;
  monthlyTicketLimit?: number | null;
}

/**
 * الحدود الفعّالة للمؤسسة.
 *
 * الأولوية: القيمة المخزَّنة في `organization.subscription` إن وُجدت، وإلا قيمة كتالوج
 * الباقة. السبب: الكتالوج يعرّف ما تمنحه الباقة، لكن الاتفاقيات المخصّصة (عميل مؤسسي،
 * عرض ترويجي، أو تعديل إداري) تُخزَّن على مستوى المؤسسة ويجب أن تُحترم. الاعتماد على
 * الكتالوج وحده كان يجعل تعديل حدود مؤسسة بعينها بلا أي أثر فعلي.
 */
export function effectiveLimits(plan: string | undefined | null, subscription?: SubscriptionRecord | null): PlanLimits {
  const base = planLimits(plan);
  if (!subscription) return base;

  const pick = (stored: number | null | undefined, fallback: number): number =>
    typeof stored === 'number' && Number.isFinite(stored) && stored > 0 ? stored : fallback;

  return {
    ...base,
    maxUsers: pick(subscription.maxUsers, base.maxUsers),
    maxBranches: pick(subscription.maxBranches, base.maxBranches),
    monthlyTicketLimit: pick(subscription.monthlyTicketLimit, base.monthlyTicketLimit),
  };
}

/**
 * حدود الباقة.
 *
 * القاعدة: الحدود تُفرض في لحظة الإنشاء لا عند العرض. قبل هذا الملف كان حد الفروع
 * وحده مفروضًا، وكان أي مالك مركز يستطيع إنشاء مستخدمين وتذاكر بلا حد.
 *
 * ملاحظة تصميم: نحسب الاستخدام الفعلي لحظيًا من القاعدة بدل الاحتفاظ بعدّاد،
 * لأن العدّادات تحتاج مزامنة وتتعارض مع الحذف/التعطيل. التكلفة استعلام count واحد.
 */
export async function getPlanUsage(organizationId: Types.ObjectId | string): Promise<PlanUsage> {
  const organization = await OrganizationModel.findById(organizationId).select('subscription').lean();
  const plan = effectiveLimits(organization?.subscription?.plan, organization?.subscription);

  const { from, to } = monthRange();

  const [usersUsed, branchesUsed, ticketsUsed] = await Promise.all([
    UserModel.countDocuments({ organizationId, isActive: true }),
    BranchModel.countDocuments({ organizationId, isActive: true }),
    RepairTicketModel.countDocuments({ organizationId, createdAt: { $gte: from, $lte: to } }),
  ]);

  return {
    plan,
    users: { used: usersUsed, limit: plan.maxUsers },
    branches: { used: branchesUsed, limit: plan.maxBranches },
    monthlyTickets: { used: ticketsUsed, limit: plan.monthlyTicketLimit },
  };
}

/** خطأ موحّد عند تجاوز حد الباقة، برسالة عربية واضحة تفيد المستخدم بما يفعله */
function limitReached(resource: keyof typeof RESOURCE_LABELS_AR, used: number, limit: number, planNameAr: string): ApiError {
  return ApiError.businessRule(
    `وصلت للحد الأقصى لعدد ${RESOURCE_LABELS_AR[resource]} في باقة «${planNameAr}» (${limit}). قم بترقية الباقة للمتابعة.`,
    { resource, used, limit, plan: planNameAr, code: 'PLAN_LIMIT_REACHED' },
  );
}

/** يتحقق من حد المستخدمين — يُنادى قبل إنشاء أي مستخدم */
export async function assertUserLimit(organizationId: Types.ObjectId | string): Promise<void> {
  await assertSubscriptionActive(organizationId);
  const usage = await getPlanUsage(organizationId);
  if (usage.users.used >= usage.users.limit) {
    throw limitReached('users', usage.users.used, usage.users.limit, usage.plan.nameAr);
  }
}

/** يتحقق من حد الفروع — يُنادى قبل إنشاء أي فرع */
export async function assertBranchLimit(organizationId: Types.ObjectId | string): Promise<void> {
  await assertSubscriptionActive(organizationId);
  const usage = await getPlanUsage(organizationId);
  if (usage.branches.used >= usage.branches.limit) {
    throw limitReached('branches', usage.branches.used, usage.branches.limit, usage.plan.nameAr);
  }
}

/**
 * يتحقق من حد التذاكر الشهري — يُنادى قبل إنشاء أي تذكرة.
 * ملاحظة: نحسب التذاكر في الشهر الميلادي الجاري بتوقيت القاهرة.
 */
export async function assertTicketLimit(organizationId: Types.ObjectId | string): Promise<void> {
  await assertSubscriptionActive(organizationId);
  const usage = await getPlanUsage(organizationId);
  if (usage.monthlyTickets.used >= usage.monthlyTickets.limit) {
    throw limitReached(
      'monthlyTickets',
      usage.monthlyTickets.used,
      usage.monthlyTickets.limit,
      usage.plan.nameAr,
    );
  }
}
