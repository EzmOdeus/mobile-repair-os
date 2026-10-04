import type { CorsOptions } from 'cors';
import { env } from './env.js';
import { logger } from './logger.js';

/**
 * محلّل تخصيص الأصل (CORS origin).
 *
 * القواعد:
 * 1) الطلبات بدون Origin (curl، سكربتات، تطبيقات سطح المكتب) مسموح بها دائمًا.
 * 2) أي أصل موجود صراحةً في CORS_ORIGINS مسموح.
 * 3) في وضع التطوير فقط: يُسمح بأي منفذ على localhost/127.0.0.1/[::1].
 *    السبب العملي: Next.js ينتقل تلقائيًا إلى منفذ آخر (3001، 3002…) لو كان 3000
 *    مشغولًا، فينكسر تسجيل الدخول بخطأ CORS غير مفهوم. هذا التوسيع للتطوير فقط
 *    ولا يُطبَّق في الإنتاج حيث تبقى القائمة الصريحة هي المرجع الوحيد.
 * 4) في الإنتاج: أي أصل آخر يُرفض ويُسجَّل تحذير.
 */
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  if (env.corsOrigins.includes('*')) return true;
  if (env.corsOrigins.includes(origin)) return true;

  if (!env.isProd) {
    try {
      const url = new URL(origin);
      if (LOCAL_HOSTNAMES.has(url.hostname)) return true;
    } catch {
      // أصل غير صالح الشكل: نتركه للرفض
    }
  }

  return false;
}

export const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) return callback(null, true);
    logger.warn(
      { origin, allowed: env.corsOrigins },
      'طلب من أصل غير مسموح في CORS — أضفه إلى CORS_ORIGINS في apps/api/.env',
    );
    return callback(null, false);
  },
  credentials: true,
  exposedHeaders: ['x-request-id'],
  /** نسمح برؤوس الترويسة الشائعة حتى لا يفشل طلب preflight */
  allowedHeaders: ['Content-Type', 'Authorization', 'x-access-token', 'x-request-id'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  maxAge: 86_400,
};
