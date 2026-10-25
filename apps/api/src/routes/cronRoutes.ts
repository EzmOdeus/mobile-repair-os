import { Router, type NextFunction, type Request, type Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler, ok } from '../utils/asyncHandler.js';
import { runSlaScanOnce } from '../services/slaScheduler.js';
import { runSubscriptionScanOnce } from '../services/subscriptionScheduler.js';

/**
 * مسارات تشغيل المهام الدورية من خارج العملية (Vercel Cron أو أي مجدول خارجي).
 *
 * السبب: `setInterval` لا يعمل على Serverless؛ العملية تُجمَّد بعد كل طلب.
 * Vercel Cron يستدعي هذه المسارات عبر HTTP مع `Authorization: Bearer <CRON_SECRET>`.
 * المسارات مركّبة قبل مصادقة المستخدمين في app.ts، ومحمية بالسرّ فقط.
 */
const cronRouter = Router();

function readBearer(req: Request): string {
  const header = req.get('authorization') ?? '';
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function requireCronSecret(req: Request, _res: Response, next: NextFunction): void {
  if (!env.CRON_SECRET) {
    if (env.isProd) {
      return next(ApiError.forbidden('CRON_SECRET غير مضبوط على الخادم'));
    }
    // في التطوير نسمح بالاستدعاء اليدوي دون سرّ
    return next();
  }
  if (!safeEqual(readBearer(req), env.CRON_SECRET)) {
    logger.warn({ ip: req.ip, path: req.path }, 'طلب Cron بمفتاح غير صحيح — مرفوض');
    return next(ApiError.unauthorized('طلب Cron غير مصرح'));
  }
  return next();
}

cronRouter.get(
  '/subscription',
  requireCronSecret,
  asyncHandler(async (_req, res) => {
    const processed = await runSubscriptionScanOnce();
    logger.info({ processed }, 'Cron: اكتمل فحص الاشتراكات والتذكيرات');
    return ok(res, { processed });
  }),
);

cronRouter.get(
  '/sla',
  requireCronSecret,
  asyncHandler(async (_req, res) => {
    const breached = await runSlaScanOnce();
    logger.info({ breached }, 'Cron: اكتمل فحص تجاوزات SLA');
    return ok(res, { breached });
  }),
);

export default cronRouter;
