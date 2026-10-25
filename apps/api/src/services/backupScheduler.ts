import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { listBackupFiles, runScheduledBackup } from './backupService.js';

/**
 * جدولة النسخ الاحتياطي الدوري (نسخة كاملة للمنصة على القرص).
 *
 * صممنها بفحص دوري كل ساعة بدل `setInterval` بطول الفترة نفسها: الخادم الذي
 * يُعاد تشغيله أسرع من فترة النسخ (تطوير/نشر متكرر) لن يصل مؤقته أبدًا.
 * الفحص يقارن أحدث ملف نسخة بالفترة المطلوبة ويشغّل نسخة جديدة فقط عند
 * الاستحقاق — فإعادة التشغيل لا تُنتج نسخًا مكررة.
 */

export async function runBackupScanOnce(): Promise<boolean> {
  const files = await listBackupFiles();
  const newest = files[0];
  const intervalMs = env.BACKUP_INTERVAL_HOURS * 3_600_000;
  if (newest && Date.now() - new Date(newest.createdAt).getTime() < intervalMs) return false;
  await runScheduledBackup();
  return true;
}

let timer: NodeJS.Timeout | null = null;

/** تشغيل الجدولة. تُرجع دالة إيقاف (تُستدعى عند إغلاق السيرفر). */
export function startBackupScheduler(): () => void {
  if (timer) return stopBackupScheduler;
  if (!env.BACKUP_ENABLED) {
    logger.info('النسخ الاحتياطي المجدول معطّل (BACKUP_ENABLED=false)');
    return () => undefined;
  }

  const checkEveryMs = Math.min(env.BACKUP_INTERVAL_HOURS * 3_600_000, 3_600_000);

  // فحص أولي عند الإقلاع (يتخطى نفسه إن وُجدت نسخة حديثة) ثم فحص دوري
  void runBackupScanOnce().catch((err) => logger.error({ err }, 'فشل فحص النسخ الاحتياطي الأولي'));

  timer = setInterval(() => {
    void runBackupScanOnce().catch((err) => logger.error({ err }, 'فشل الفحص الدوري للنسخ الاحتياطي'));
  }, checkEveryMs);
  timer.unref();

  logger.info(
    { intervalHours: env.BACKUP_INTERVAL_HOURS, retention: env.BACKUP_RETENTION_COUNT, dir: env.BACKUP_DIR },
    `جدولة النسخ الاحتياطي مفعّلة (كل ${env.BACKUP_INTERVAL_HOURS} ساعة، تُحفظ ${env.BACKUP_RETENTION_COUNT} نسخة)`,
  );

  return stopBackupScheduler;
}

export function stopBackupScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
