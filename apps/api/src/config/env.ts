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

  UPLOAD_DIR: z.string().default('./uploads'),
  UPLOAD_MAX_FILE_MB: z.coerce.number().positive().default(8),
  PUBLIC_API_URL: z.string().default('http://localhost:4000'),
  /** سرّ توقيع روابط الملفات. إن تُرك فارغًا يُستخدم JWT_ACCESS_SECRET */
  UPLOAD_URL_SECRET: z.string().min(32, 'UPLOAD_URL_SECRET لازم 32 حرف على الأقل').optional().default(''),
  UPLOAD_URL_TTL_MINUTES: z.coerce.number().int().positive().default(120),

  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:3001'),

  RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().positive().default(15),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),

  PUBLIC_WEB_URL: z.string().default('http://localhost:3000'),

  /** فاصل فحص تجاوزات SLA بالدقائق (مهمة دورية داخل الـAPI) */
  SLA_SCAN_INTERVAL_MINUTES: z.coerce.number().int().positive().default(5),

  DEFAULT_CURRENCY: z.string().default('EGP'),
  DEFAULT_TIMEZONE: z.string().default('Africa/Cairo'),
  DEFAULT_LOCALE: z.string().default('ar-EG'),

  WHATSAPP_MODE: z.enum(['log', 'cloud-api']).default('log'),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional().default(''),
  WHATSAPP_ACCESS_TOKEN: z.string().optional().default(''),
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

export const env = {
  ...raw,
  isProd: raw.NODE_ENV === 'production',
  isDev: raw.NODE_ENV === 'development',
  isTest: raw.NODE_ENV === 'test',
  corsOrigins: raw.CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
} as const;

export type Env = typeof env;
