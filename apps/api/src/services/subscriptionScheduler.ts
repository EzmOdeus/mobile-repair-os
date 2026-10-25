import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { runAsSystem } from '../context/tenantContext.js';
import { expireOverdueOrganizations, sendSubscriptionReminders } from './subscriptionService.js';

/**
 * مهمة دورية لتحويل حالات الاشتراك المنتهية وإرسال تذكيرات ما قبل الانتهاء.
 *
 * المنع الفعلي لا يعتمد على هذه الدالة: getSubscriptionState يحسب مهلة السداد
 * ديناميكيًا، والمهمة مسؤولة عن تثبيت الحالة في القاعدة والإشعارات فقط.
 */
export async function runSubscriptionScanOnce(): Promise<number> {
  // قفل تشغيل: تداخل دورتين قد يُحوّل المؤسسات مرتين (إشعارات مكررة لتحول واحد)
  if (running) return 0;
  running = true;
  try {
    return await runSubscriptionScanInner();
  } finally {
    running = false;
  }
}

let running = false;

async function runSubscriptionScanInner(): Promise<number> {
  return runAsSystem(async () => {
    const transitioned = await expireOverdueOrganizations();
    const reminded = await sendSubscriptionReminders();
    if (transitioned > 0) {
      logger.warn({ transitionedOrganizations: transitioned }, 'مؤسسات تحوّلت حالة اشتراكها');
    }
    return transitioned + reminded;
  });
}

let timer: NodeJS.Timeout | null = null;

/** تشغيل الجدولة الدورية. تُرجع دالة إيقاف (تُستدعى عند إغلاق السيرفر). */
export function startSubscriptionScheduler(): () => void {
  if (timer) return stopSubscriptionScheduler;

  const intervalMs = env.SUBSCRIPTION_SCAN_INTERVAL_MINUTES * 60_000;

  // فحص أولي عند الإقلاع ثم فحص دوري
  void runSubscriptionScanOnce().catch((err) => logger.error({ err }, 'فشل فحص الاشتراكات الأولي'));

  timer = setInterval(() => {
    void runSubscriptionScanOnce().catch((err) => logger.error({ err }, 'فشل فحص الاشتراكات الدوري'));
  }, intervalMs);
  timer.unref();

  logger.info(
    { intervalMinutes: env.SUBSCRIPTION_SCAN_INTERVAL_MINUTES },
    `جدولة فحص الاشتراكات مفعّلة (كل ${env.SUBSCRIPTION_SCAN_INTERVAL_MINUTES} دقيقة)`,
  );

  return stopSubscriptionScheduler;
}

export function stopSubscriptionScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
