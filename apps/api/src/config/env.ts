import 'dotenv/config';
import { z } from 'zod';

/**
 * تهيئة وتحقق متغيرات البيئة.
 * أي قيمة ناقصة أو غير صحيحة توقف السيرفر فورًا بدل السلوك الصامت.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  API_PREFIX: z.string().default('/api/v1'),

  MONGODB_URI: z.string().min(1, 'MONGODB_URI مطلوب'),
  MONGODB_MAX_POOL_SIZE: z.coerce.number().int().positive().default(20),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET لازم 32 حرف على الأقل'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET لازم 32 حرف على الأقل'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  /** مفتاح مستقل لتشفير أسرار 2FA. إن تُرك فارغًا يُشتق من JWT_ACCESS_SECRET. */
  TWO_FACTOR_ENCRYPTION_KEY: z.string().min(32).optional().default(''),
  /** صلاحية توكن تحدّي التحقق بخطوتين بالدقائق */
  TWO_FACTOR_CHALLENGE_TTL_MINUTES: z.coerce.number().int().positive().default(5),

  UPLOAD_DIR: z.string().default('./uploads'),
  UPLOAD_MAX_FILE_MB: z.coerce.number().positive().default(8),
  PUBLIC_API_URL: z.string().default('http://localhost:4000'),
  /** سرّ توقيع روابط الملفات. إن تُرك فارغًا يُستخدم JWT_ACCESS_SECRET */
  UPLOAD_URL_SECRET: z.string().min(32, 'UPLOAD_URL_SECRET لازم 32 حرف على الأقل').optional().default(''),
  UPLOAD_URL_TTL_MINUTES: z.coerce.number().int().positive().default(120),

  /** محرك التخزين: قرص محلي أو S3 متوافق (AWS S3 / Cloudflare R2 / MinIO) */
  STORAGE_DRIVER: z.enum(['local', 's3', 'blob']).default('local'),
  /** Vercel Blob read/write token; injected when a store is connected to the project. */
  BLOB_READ_WRITE_TOKEN: z.string().optional().default(''),
  S3_ENDPOINT: z.string().optional().default(''),
  S3_REGION: z.string().optional().default('auto'),
  S3_BUCKET: z.string().optional().default(''),
  S3_ACCESS_KEY_ID: z.string().optional().default(''),
  S3_SECRET_ACCESS_KEY: z.string().optional().default(''),
  /** R2/MinIO يحتاجان مسارات بدل النمط الافتراضي (bucket في hostname) */
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .optional()
    .default('false')
    .transform((v) => v === 'true'),

  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:3001'),

  RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().positive().default(15),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),

  PUBLIC_WEB_URL: z.string().default('http://localhost:3000'),

  /** فاصل فحص تجاوزات SLA بالدقائق (مهمة دورية داخل الـAPI) */
  SLA_SCAN_INTERVAL_MINUTES: z.coerce.number().int().positive().default(5),

  /** مدة الفترة التجريبية للمراكز الجديدة بالأيام */
  TRIAL_DAYS: z.coerce.number().int().positive().default(14),
  /** فاصل فحص حالات انتهاء الاشتراك بالدقائق */
  SUBSCRIPTION_SCAN_INTERVAL_MINUTES: z.coerce.number().int().positive().default(60),
  /** مهلة السداد بعد انتهاء الاشتراك المدفوع (past_due) بالأيام قبل الإيقاف */
  SUBSCRIPTION_GRACE_DAYS: z.coerce.number().int().min(0).default(7),
  /** أيام إرسال تذكيرات قبل انتهاء الاشتراك، مفصولة بفواصل */
  SUBSCRIPTION_REMINDER_DAYS: z.string().default('7,3,1'),

  /** النسخ الاحتياطي المنطقي المجدول (JSON على القرص المحلي) */
  BACKUP_ENABLED: z.enum(['true', 'false']).optional().default('true').transform((v) => v === 'true'),
  BACKUP_INTERVAL_HOURS: z.coerce.number().positive().default(24),
  BACKUP_RETENTION_COUNT: z.coerce.number().int().positive().default(14),
  BACKUP_DIR: z.string().default('./backups'),
  /** نسخ مجلد uploads المحلي مع كل نسخة احتياطية (S3 يُنسخ من المزوّد) */
  BACKUP_INCLUDE_UPLOADS: z.enum(['true', 'false']).optional().default('true').transform((v) => v === 'true'),

  DEFAULT_CURRENCY: z.string().default('EGP'),
  DEFAULT_TIMEZONE: z.string().default('Africa/Cairo'),
  DEFAULT_LOCALE: z.string().default('ar-EG'),

  WHATSAPP_MODE: z.enum(['log', 'cloud-api']).default('log'),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional().default(''),
  WHATSAPP_ACCESS_TOKEN: z.string().optional().default(''),
  WHATSAPP_API_VERSION: z.string().optional().default('v21.0'),
  /** خريطة قوالب Meta المعتمدة: {"ready_for_pickup":{"name":"...","language":"ar","params":["customerName","device"]}} */
  WHATSAPP_TEMPLATE_MAP: z.string().optional().default('{}'),

  SMS_MODE: z.enum(['log', 'http']).default('log'),
  /** بوابة SMS عامة تستقبل POST JSON: { to, message, sender } */
  SMS_API_URL: z.string().optional().default(''),
  SMS_API_KEY: z.string().optional().default(''),
  SMS_SENDER: z.string().optional().default(''),
  SMS_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  NOTIFICATION_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(3),

  /** سرّ حماية مسارات Cron (Vercel يرسله في Authorization: Bearer) */
  CRON_SECRET: z.string().min(16, 'CRON_SECRET لازم 16 حرف على الأقل').optional().default(''),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  // eslint-disable-next-line no-console
  console.error(`\n[config] متغيرات البيئة غير صحيحة:\n${issues}\n`);
  process.exit(1);
}

const raw = parsed.data;
const isVercel = process.env.VERCEL === '1';

/**
 * فحوص إنتاج Vercel: نظام الملفات هناك للقراءة فقط، وأي كتابة محلية تُفقد
 * مع أول Cold Start. نرفض التشغيل بدل قبول رفع ملفات يبدو ناجحًا ثم يضيع.
 */
if (isVercel && raw.NODE_ENV === 'production') {
  const problems: string[] = [];
  if (!['s3', 'blob'].includes(raw.STORAGE_DRIVER)) {
    problems.push('STORAGE_DRIVER=s3 أو blob مطلوب على Vercel لتخزين الملفات بصورة دائمة');
  }
  if (raw.STORAGE_DRIVER === 'blob' && !raw.BLOB_READ_WRITE_TOKEN) {
    problems.push('BLOB_READ_WRITE_TOKEN مطلوب عند استخدام Vercel Blob');
  }
  if (/^mongodb(\+srv)?:\/\/(localhost|127\.0\.0\.1)/i.test(raw.MONGODB_URI)) {
    problems.push('MONGODB_URI يجب أن يشير إلى MongoDB Atlas وليس localhost على Vercel');
  }
  if (problems.length) {
    // eslint-disable-next-line no-console
    console.error(`\n[config] إعدادات غير صالحة للنشر على Vercel:\n${problems.map((p) => `  - ${p}`).join('\n')}\n`);
    process.exit(1);
  }
  if (!raw.CRON_SECRET) {
    // eslint-disable-next-line no-console
    console.warn('[config] CRON_SECRET غير مضبوط — مسارات Cron سترفض الطلبات على Vercel');
  }
}

export const env = {
  ...raw,
  isProd: raw.NODE_ENV === 'production',
  isDev: raw.NODE_ENV === 'development',
  isTest: raw.NODE_ENV === 'test',
  isVercel,
  corsOrigins: raw.CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
} as const;

export type Env = typeof env;
