/**
 * كتالوج باقات الاشتراك — المصدر الوحيد لحدود كل باقة.
 *
 * قبل هذا الملف كانت الحدود مكتوبة كأرقام متفرقة في الـcontrollers، وكان حد
 * المستخدمين والتذاكر غير مفروض أصلًا. الآن كل الحدود تُقرأ من هنا وتُفرض في
 * `planService.assertWithinPlan`، فإضافة باقة جديدة لا تحتاج تعديل منطق التحقق.
 */

export type PlanKey = 'trial' | 'starter' | 'growth' | 'pro' | 'enterprise';

export interface PlanLimits {
  key: PlanKey;
  nameAr: string;
  /** الحد الأقصى للمستخدمين النشطين */
  maxUsers: number;
  /** الحد الأقصى للفروع النشطة */
  maxBranches: number;
  /** الحد الأقصى لتذاكر الصيانة المُنشأة في الشهر الميلادي */
  monthlyTicketLimit: number;
  /** السعر الشهري بالجنيه (0 = مجاني/تجريبي/تسعير مخصص) */
  monthlyPriceEgp: number;
  /** يمكن لمالك المركز تفعيلها بنفسه بعد الدفع خارج المنصة */
  selfService: boolean;
  /** تُستخدم كفترة تجريبية فقط ولا تُباع كاشتراك */
  trialOnly: boolean;
  /** سعرها يُتفق عليه مع إدارة المنصة (لا سعر ثابت في الكتالوج) */
  customPricing: boolean;
}

export const PLANS: Record<PlanKey, PlanLimits> = {
  trial: {
    key: 'trial',
    nameAr: 'تجريبية',
    maxUsers: 2,
    maxBranches: 1,
    monthlyTicketLimit: 50,
    monthlyPriceEgp: 0,
    selfService: false,
    trialOnly: true,
    customPricing: false,
  },
  starter: {
    key: 'starter',
    nameAr: 'المبتدئة',
    maxUsers: 5,
    maxBranches: 2,
    monthlyTicketLimit: 300,
    monthlyPriceEgp: 0,
    selfService: false,
    trialOnly: true,
    customPricing: false,
  },
  growth: {
    key: 'growth',
    nameAr: 'النمو',
    maxUsers: 15,
    maxBranches: 4,
    monthlyTicketLimit: 1200,
    monthlyPriceEgp: 1500,
    selfService: true,
    trialOnly: false,
    customPricing: false,
  },
  pro: {
    key: 'pro',
    nameAr: 'الاحترافية',
    maxUsers: 40,
    maxBranches: 10,
    monthlyTicketLimit: 5000,
    monthlyPriceEgp: 3500,
    selfService: true,
    trialOnly: false,
    customPricing: false,
  },
  enterprise: {
    key: 'enterprise',
    nameAr: 'المؤسسية',
    maxUsers: 500,
    maxBranches: 100,
    monthlyTicketLimit: 100_000,
    monthlyPriceEgp: 0,
    selfService: false,
    trialOnly: false,
    customPricing: true,
  },
};

/** باقة التسجيل: حدود «المبتدئة» لمدة التجربة فقط، ثم يلزم الانتقال لباقة مدفوعة */
export const DEFAULT_SIGNUP_PLAN: PlanKey = 'starter';
export const TRIAL_PLAN_KEY: PlanKey = DEFAULT_SIGNUP_PLAN;

/** الباقات المتاحة للتفعيل الذاتي بعد الدفع خارج المنصة */
export const SELF_SERVICE_PLAN_KEYS = ['growth', 'pro'] as const;
export type SelfServicePlanKey = (typeof SELF_SERVICE_PLAN_KEYS)[number];

/** الباقات التي تستطيع إدارة المنصة تفعيلها (المؤسسية بسعر مخصص) */
export const PLATFORM_PLAN_KEYS = ['growth', 'pro', 'enterprise'] as const;
export type PlatformPlanKey = (typeof PLATFORM_PLAN_KEYS)[number];

export function isSelfServicePlan(plan: string): plan is SelfServicePlanKey {
  return (SELF_SERVICE_PLAN_KEYS as readonly string[]).includes(plan);
}

export function isPlatformPlan(plan: string): plan is PlatformPlanKey {
  return (PLATFORM_PLAN_KEYS as readonly string[]).includes(plan);
}

/** مفاتيح الباقات المعتمدة حاليًا (تُستخدم في التحقق من مدخلات الواجهة) */
export const PLAN_KEYS = Object.keys(PLANS) as PlanKey[];

/**
 * مفاتيح باقات قديمة مخزّنة في بيانات قائمة (قبل توحيد الكتالوج).
 * «free» كانت تعادل التجريبية، و«business» كانت بين الاحترافية والمؤسسية فتُقرّب منها.
 */
const LEGACY_PLAN_MAP: Record<string, PlanKey> = { free: 'trial', business: 'pro' };

export function planLimits(plan: string | undefined | null): PlanLimits {
  const key = (plan ?? DEFAULT_SIGNUP_PLAN) as PlanKey;
  return PLANS[key] ?? PLANS[LEGACY_PLAN_MAP[plan ?? ''] ?? DEFAULT_SIGNUP_PLAN];
}

/** الأسماء العربية للموارد التي تُحدَّد بحدود الباقة */
export const RESOURCE_LABELS_AR: Record<'users' | 'branches' | 'monthlyTickets', string> = {
  users: 'المستخدمين',
  branches: 'الفروع',
  monthlyTickets: 'تذاكر الصيانة شهريًا',
};
