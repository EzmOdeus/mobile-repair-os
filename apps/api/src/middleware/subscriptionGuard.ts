import type { NextFunction, Request, Response } from 'express';
import { OrganizationModel } from '../models/Organization.js';
import { ApiError } from '../utils/ApiError.js';
import { env } from '../config/env.js';
import { getSubscriptionState } from '../services/subscriptionService.js';

/**
 * حارس وضع القراءة فقط (Read-only mode) على مستوى المنصة.
 *
 * قبل هذا الوسيط كان حظر الاشتراك المنتهي مفروضًا فقط داخل حدود الباقة
 * (إنشاء مستخدم/فرع/تذكرة) — أي أن مركزًا منتهي الاشتراك كان يستطيع الاستمرار
 * في إضافة عملاء وفواتير ومصروفات وبيع POS بلا نهاية. الآن كل عملية كتابة
 * (POST/PATCH/PUT/DELETE) على مستوى المؤسسة تُرفض عند انتهاء الاشتراك أو
 * إيقاف المركز، مع بقاء القراءة والتقارير متاحة.
 *
 * الاستثناءات:
 *  - طرق القراءة (GET/HEAD/OPTIONS).
 *  - المسارات العامة والمصادقة ومسارات المنصة نفسها والفهرسة.
 *  - دور platform (إدارة المنصة تعمل دائمًا).
 *  - مسارات إدارة الاشتراك الذاتية (تفعيل/تغيير باقة/طلب تجديد): يجب أن تبقى
 *    متاحة للمركز المحظور وإلا تعذّر عليه الخروج من الحظر. إيقاف المنصة للمركز
 *    (isActive=false) لا يُستثنى منها.
 *
 * التكلفة: قراءة واحدة لمستند المؤسسة لكل طلب كتابة (فهرس _id)، مع محاولة
 * إعادة واحدة عند فشل القراءة. الحلقة: fail-closed لمسارات /finance فقط.
 */

const SKIPPED_PREFIXES = ['/auth', '/public', '/platform', '/meta', '/health'];

/** مسارات إدارة الاشتراك التي تعمل حتى في وضع القراءة فقط */
const BILLING_PREFIX = '/organizations/subscription';

/**
 * المسارات ذات الأثر المادي المباشر (فواتير/مدفوعات/مصروفات/POS): عند تعذر
 * فحص حالة الاشتراك بعد إعادة المحاولة نمنع الكتابة (fail-closed)، لأن السماح
 * هنا يعني بيعًا وتحصيلًا فعليًا على اشتراك موقوف. باقي الكتابات تبقى fail-open
 * (القرار الأصلي الموثق) لأن الضرر مؤجل والفحص الدقيق يبقى في خدمات الحدود.
 */
const CRITICAL_PREFIXES = ['/finance'];

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function subscriptionWriteGuard(req: Request, _res: Response, next: NextFunction): void {
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) return next();
  if (!req.auth) return next();
  if (req.auth.role === 'platform') return next();

  const rawPath = (req.originalUrl || req.url || '').split('?')[0] ?? '';
  const path = rawPath.startsWith(env.API_PREFIX) ? rawPath.slice(env.API_PREFIX.length) : rawPath;
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const isBillingPath = matchesPrefix(normalized, BILLING_PREFIX);
  if (SKIPPED_PREFIXES.some((prefix) => matchesPrefix(normalized, prefix))) {
    return next();
  }

  void (async () => {
    const isCritical = CRITICAL_PREFIXES.some((prefix) => matchesPrefix(normalized, prefix));

    /** undefined = تعذر الفحص بعد المحاولتين (خطأ DB)، وليس "مؤسسة غير موجودة" (null) */
    type OrgRow = { isActive?: boolean; subscription?: Record<string, unknown> | null } | null;
    let organization: OrgRow | undefined;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        organization = await OrganizationModel.findById(req.auth!.organizationId)
          .select('isActive subscription')
          .lean<NonNullable<OrgRow>>();
        break;
      } catch {
        if (attempt === 0) {
          await delay(150); // خطأ مؤقت شائع (انتخابات replica set، اهتزاز شبكة) — محاولة واحدة إضافية
          continue;
        }
        organization = undefined;
      }
    }

    if (organization === undefined) {
      if (isCritical) {
        return next(
          ApiError.businessRule('تعذر التحقق من حالة الاشتراك مؤقتًا. حاول مجددًا بعد لحظات.', {
            code: 'SUBSCRIPTION_CHECK_UNAVAILABLE',
          }),
        );
      }
      // عند فشل الفحص لا نمنع العملية — الفحص الدقيق يبقى داخل خدمات الحدود
      return next();
    }

    if (!organization) return next(ApiError.forbidden('المؤسسة غير موجودة'));

    if (!organization.isActive) {
      return next(
        ApiError.forbidden('حساب المركز موقوف من إدارة المنصة. تواصل مع الدعم لإعادة التفعيل.'),
      );
    }

    const state = getSubscriptionState(organization.subscription);
    if (state.blocked && !isBillingPath) {
      return next(
        ApiError.businessRule(
          state.status === 'cancelled'
            ? 'اشتراك مركزك موقوف. فعّل باقة من الإعدادات للمتابعة.'
            : 'انتهت مهلة سداد اشتراكك. جدّد الباقة من الإعدادات للمتابعة (القراءة متاحة، الإضافة متوقفة).',
          {
            code: 'SUBSCRIPTION_EXPIRED',
            status: state.status,
            expiresAt: state.expiresAt,
            graceEndsAt: state.graceEndsAt,
            plan: state.planKey,
          },
        ),
      );
    }

    return next();
  })();
}
