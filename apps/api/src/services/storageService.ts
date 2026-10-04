import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { StoredFileModel } from '../models/StoredFile.js';
import { ApiError } from '../utils/ApiError.js';
import { getTenantContext } from '../context/tenantContext.js';
import { logger } from '../config/logger.js';

/** المجلد المطلق لتخزين الملفات */
export function resolveUploadDir(): string {
  return path.isAbsolute(env.UPLOAD_DIR)
    ? env.UPLOAD_DIR
    : path.resolve(process.cwd(), env.UPLOAD_DIR);
}

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
  'video/mp4',
  'video/quicktime',
]);

export function isAllowedMime(mime: string): boolean {
  return ALLOWED_MIME.has(mime);
}

/**
 * امتداد الملف يُشتق من نوع MIME المُتحقق منه، لا من اسم الملف القادم من المستخدم.
 * السبب: الاسم الأصلي كان يحدد الامتداد، فيمكن رفع ملف نصي/HTML بامتداد `.html`
 * أو `.svg` والعرض المباشر (inline) يفتح باب XSS مخزَّن على أصل الـAPI.
 */
const MIME_EXTENSION: Readonly<Record<string, string>> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'application/pdf': '.pdf',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
};

/**
 * بناء مسار التخزين: <orgId>/<kind>/<yyyy>/<mm>/<unique>-<safeName><ext>
 * عزل الملفات لكل مؤسسة على مستوى نظام الملفات أيضًا، وليس فقط في قاعدة البيانات.
 */
export function buildStorageKey(params: {
  organizationId: string;
  originalName: string;
  kind: string;
  mimeType?: string;
}): string {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const ext = params.mimeType && MIME_EXTENSION[params.mimeType]
    ? MIME_EXTENSION[params.mimeType]!
    : path.extname(params.originalName).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 10);
  const base = path
    .basename(params.originalName, path.extname(params.originalName))
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .slice(0, 60);
  const unique = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return path.posix.join(params.organizationId, params.kind, yyyy, mm, `${unique}-${base}${ext}`);
}

export interface SaveFileInput {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  kind: string;
  sizeBytes: number;
  deviceId?: string | null;
  ticketId?: string | null;
  customerId?: string | null;
  qualityCheckId?: string | null;
  caption?: string;
  stage?: string;
  isSensitive?: boolean;
}

/** حفظ ملف على القرص وإنشاء سجل في قاعدة البيانات */
export async function saveFile(input: SaveFileInput) {
  const ctx = getTenantContext();
  if (!ctx) throw ApiError.forbidden('لا يمكن حفظ ملف بدون سياق مؤسسة');

  if (!isAllowedMime(input.mimeType)) {
    throw ApiError.badRequest(`نوع الملف غير مدعوم: ${input.mimeType}`);
  }

  const storageKey = buildStorageKey({
    organizationId: String(ctx.organizationId),
    originalName: input.originalName,
    kind: input.kind,
    mimeType: input.mimeType,
  });

  const absolute = path.join(resolveUploadDir(), storageKey);
  await fsp.mkdir(path.dirname(absolute), { recursive: true });
  await fsp.writeFile(absolute, input.buffer);

  const checksum = createHash('sha256').update(input.buffer).digest('hex');

  const doc = await StoredFileModel.create({
    organizationId: ctx.organizationId,
    branchId: ctx.branchId,
    storageKey,
    originalName: input.originalName,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    checksum,
    kind: input.kind,
    deviceId: input.deviceId ?? null,
    ticketId: input.ticketId ?? null,
    customerId: input.customerId ?? null,
    qualityCheckId: input.qualityCheckId ?? null,
    caption: input.caption ?? '',
    stage: input.stage ?? '',
    isSensitive: input.isSensitive ?? false,
    uploadedBy: ctx.actor.userId,
  });

  return doc;
}

/** حذف منطقي: يبقى السجل للتدقيق ويُخفى الملف من النتائج */
export async function softDeleteFile(fileId: string): Promise<void> {
  const file = await StoredFileModel.findById(fileId);
  if (!file) throw ApiError.notFound('الملف غير موجود');
  file.isDeleted = true;
  await file.save();
}

/** حذف فعلي من القرص (يُستخدم عند الحاجة القصوى فقط) */
export async function hardDeleteFile(storageKey: string): Promise<void> {
  try {
    await fsp.unlink(path.join(resolveUploadDir(), storageKey));
  } catch (err) {
    logger.warn({ err, storageKey }, 'تعذر حذف الملف من القرص');
  }
}

/** قراءة ملف للتحقق من الأذونات قبل التقديم */
export async function readFileStream(storageKey: string): Promise<fs.ReadStream> {
  const absolute = path.join(resolveUploadDir(), storageKey);
  if (!fs.existsSync(absolute)) throw ApiError.notFound('الملف غير موجود على القرص');
  return fs.createReadStream(absolute);
}

/**
 * روابط الملفات موقّعة (HMAC-SHA256) بصلاحية زمنية.
 *
 * السبب: `/uploads` كان يتطلب جلسة كاملة، بينما الوسوم `<img>` وصفحات تتبع
 * العملاء العامة لا ترسل رأس Authorization — فكانت كل الصور المضمّنة في
 * الاستجابات (أدلة الإصلاح، صور الفحص) مكسورة عمليًا، ودفع ذلك للتخفيف بإزالة
 * المصادقة عن `/uploads` (تسريب بين المؤسسات). الحل: الرابط نفسه يحمل توقيعًا
 * يثبت أن السيرفر أصدره لهذا الملف تحديدًا، مع انتهاء صلاحية.
 */
function uploadUrlSecret(): string {
  return env.UPLOAD_URL_SECRET || env.JWT_ACCESS_SECRET;
}

function normalizeStorageKey(storageKey: string): string {
  return storageKey.split(path.sep).join('/');
}

function signUploadKey(normalizedKey: string, expiresAt: number): string {
  return createHmac('sha256', uploadUrlSecret()).update(`${normalizedKey}:${expiresAt}`).digest('base64url');
}

/** رابط موقّع صالح لمدة محددة (افتراضيًا UPLOAD_URL_TTL_MINUTES) */
export function publicFileUrl(storageKey: string, ttlMinutes?: number): string {
  const normalized = normalizeStorageKey(storageKey);
  const ttlMs = (ttlMinutes ?? env.UPLOAD_URL_TTL_MINUTES) * 60_000;
  const expiresAt = Date.now() + ttlMs;
  const signature = signUploadKey(normalized, expiresAt);
  return `${env.PUBLIC_API_URL}/uploads/${normalized}?e=${expiresAt}&s=${signature}`;
}

/** التحقق من توقيع رابط ملف — يُستخدم في middleware تقديم الملفات */
export function verifyFileSignature(storageKey: string, expiresAtRaw: unknown, signatureRaw: unknown): boolean {
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
  if (typeof signatureRaw !== 'string' || !signatureRaw) return false;

  const expected = Buffer.from(signUploadKey(normalizeStorageKey(storageKey), expiresAt));
  const actual = Buffer.from(signatureRaw);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
