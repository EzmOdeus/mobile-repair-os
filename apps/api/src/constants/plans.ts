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
  /** السعر الشهري بالجنيه (0 = مجاني/تجريبي) */
  monthlyPriceEgp: number;
}

export const PLANS: Record<PlanKey, PlanLimits> = {
  trial: {
    key: 'trial',
    nameAr: 'تجريبية',
    maxUsers: 2,
    maxBranches: 1,
    monthlyTicketLimit: 50,
    monthlyPriceEgp: 0,
  },
  starter: {
    key: 'starter',
    nameAr: 'المبتدئة',
    maxUsers: 5,
    maxBranches: 2,
    monthlyTicketLimit: 300,
    monthlyPriceEgp: 0,
  },
  growth: {
    key: 'growth',
    nameAr: 'النمو',
    maxUsers: 15,
    maxBranches: 4,
    monthlyTicketLimit: 1200,
    monthlyPriceEgp: 1500,
  },
  pro: {
    key: 'pro',
    nameAr: 'الاحترافية',
    maxUsers: 40,
    maxBranches: 10,
    monthlyTicketLimit: 5000,
    monthlyPriceEgp: 3500,
  },
  enterprise: {
    key: 'enterprise',
    nameAr: 'المؤسسية',
    maxUsers: 500,
    maxBranches: 100,
    monthlyTicketLimit: 100_000,
    monthlyPriceEgp: 0,
  },
};

/** الباقة التي يُمنحها المركز عند التسجيل الذاتي */
export const DEFAULT_SIGNUP_PLAN: PlanKey = 'starter';

export function planLimits(plan: string | undefined | null): PlanLimits {
  return PLANS[(plan ?? DEFAULT_SIGNUP_PLAN) as PlanKey] ?? PLANS[DEFAULT_SIGNUP_PLAN];
}

/** الأسماء العربية للموارد التي تُحدَّد بحدود الباقة */
export const RESOURCE_LABELS_AR: Record<'users' | 'branches' | 'monthlyTickets', string> = {
  users: 'المستخدمين',
  branches: 'الفروع',
  monthlyTickets: 'تذاكر الصيانة شهريًا',
};
