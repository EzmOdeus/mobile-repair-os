import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { runAsSystem } from '../context/tenantContext.js';
import { ApiError } from '../utils/ApiError.js';
import {
  ApprovalModel,
  AuditLogModel,
  BranchModel,
  CustomerModel,
  DeviceModel,
  EstimateModel,
  ExpenseModel,
  InventoryItemModel,
  InvoiceModel,
  KnowledgeArticleModel,
  NotificationModel,
  OrganizationModel,
  PartModel,
  PaymentModel,
  QualityCheckModel,
  RepairLaborModel,
  RepairNoteModel,
  RepairPartModel,
  RepairStatusHistoryModel,
  RepairTicketModel,
  ShiftModel,
  StockBatchModel,
  StockMovementModel,
  StockTransferModel,
  StoredFileModel,
  SubscriptionPaymentModel,
  SubscriptionRenewalRequestModel,
  SupplierModel,
  UserModel,
  WarrantyClaimModel,
} from '../models/index.js';
import { syncNumberCounters } from './numberingService.js';
import { resolveUploadDir } from './storageDrivers.js';

/**
 * النسخ الاحتياطي المنطقي (JSON) — بديل mongodump لا يحتاج أدوات خارجية
 * ويعمل على أي بيئة (بما فيها Serverless) لأنه يمر عبر Mongoose نفسه.
 *
 * ما الذي يغطيه وما الذي لا يغطيه:
 * - يغطي: كل مستندات قاعدة البيانات لمؤسسة واحدة أو للمنصة كلها، بمعرّفاتها
 *   الأصلية وطوابعها الزمنية، بما فيها passwordHash للمستخدمين (select:false
 *   في الموديل — نضمّنه صراحة هنا وإلا لكانت الاستعادة تُنتج مستخدمين لا
 *   يستطيعون تسجيل الدخول).
 * - لا يغطي: الملفات الثنائية (صور الأدلة/التواقيع) — تُنسخ بعمل نسخة من
 *   مجلد uploads أو bucket الـS3؛ سجل StoredFiles داخل النسخة يعمل كفهرس
 *   تحقق لملء ما فُقد.
 *
 * الاستعادة مقصودة أن تكون على قاعدة فارغة فقط (أو مؤسسة غير موجودة):
 * الاستعادة فوق بيانات قائمة تنطوي على دمج وتعارضات لا تُحل بأمان، وهذه
 * مسؤولية عمد المنصة لا قرار تلقائي من السيرفر.
 */

export const BACKUP_FORMAT = 'mobile-repair-os-backup';
export const BACKUP_VERSION = 1;

export interface BackupMeta {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  kind: 'organization' | 'platform';
  generatedAt: string;
  organization?: { _id: string; name: string; slug: string };
  counts: Record<string, number>;
}

export interface BackupDocument {
  meta: BackupMeta;
  data: Record<string, Record<string, unknown>[]>;
}

export interface BackupFileSummary {
  filename: string;
  sizeBytes: number;
  createdAt: string;
}

export interface UploadSnapshotSummary {
  directory: string;
  files: number;
  sizeBytes: number;
  createdAt: string;
}

interface BackupCollectionEntry {
  key: string;
  model: Model<Record<string, unknown>>;
  select?: string;
}

/** تحويل موحّد لأنواع الموديلات المختلفة لا تتفق بنيويًا مع Model<Record> */
function entry(key: string, model: unknown, select?: string): BackupCollectionEntry {
  return { key, model: model as Model<Record<string, unknown>>, select };
}

/**
 * كل المجموعات المرتبطة بالمؤسسة، بالترتيب المنطقي للاستعادة:
 * الفروع ثم المستخدمون (يُشار إليهما من كل شيء بعدهما) ثم باقي البيانات.
 */
const TENANT_COLLECTIONS: BackupCollectionEntry[] = [
  entry('branches', BranchModel),
  entry('users', UserModel, '+passwordHash'),
  entry('customers', CustomerModel),
  entry('devices', DeviceModel),
  entry('storedFiles', StoredFileModel),
  entry('repairTickets', RepairTicketModel),
  entry('repairStatusHistory', RepairStatusHistoryModel),
  entry('repairNotes', RepairNoteModel),
  entry('suppliers', SupplierModel),
  entry('parts', PartModel),
  entry('inventoryItems', InventoryItemModel),
  entry('stockMovements', StockMovementModel),
  entry('stockBatches', StockBatchModel),
  entry('stockTransfers', StockTransferModel),
  entry('repairParts', RepairPartModel),
  entry('repairLabors', RepairLaborModel),
  entry('estimates', EstimateModel),
  entry('approvals', ApprovalModel),
  entry('qualityChecks', QualityCheckModel),
  entry('warrantyClaims', WarrantyClaimModel),
  entry('invoices', InvoiceModel),
  entry('shifts', ShiftModel),
  entry('payments', PaymentModel),
  entry('expenses', ExpenseModel),
  entry('subscriptionPayments', SubscriptionPaymentModel),
  entry('subscriptionRenewalRequests', SubscriptionRenewalRequestModel),
  entry('notifications', NotificationModel),
  entry('knowledgeArticles', KnowledgeArticleModel),
  entry('auditLogs', AuditLogModel),
];

async function dumpCollection(model: Model<Record<string, unknown>>, filter: Record<string, unknown>, select?: string) {
  let query = model.find(filter);
  if (select) query = query.select(select);
  return ((await query.lean()) as Record<string, unknown>[]) ?? [];
}

function timestampSlug(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/* ============================ بناء النسخ ============================ */

export async function buildOrganizationBackup(organizationId: string): Promise<{ backup: BackupDocument; filename: string }> {
  if (!Types.ObjectId.isValid(organizationId)) throw ApiError.badRequest('معرّف مؤسسة غير صالح');

  return runAsSystem(async () => {
    const organization = await OrganizationModel.findById(organizationId).lean();
    if (!organization) throw ApiError.notFound('المؤسسة غير موجودة');

    const filter = { organizationId: organization._id };
    const data: Record<string, Record<string, unknown>[]> = {
      organizations: [organization as unknown as Record<string, unknown>],
    };
    const counts: Record<string, number> = { organizations: 1 };

    for (const { key, model, select } of TENANT_COLLECTIONS) {
      const docs = await dumpCollection(model, filter, select);
      data[key] = docs;
      counts[key] = docs.length;
    }

    const backup: BackupDocument = {
      meta: {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        kind: 'organization',
        generatedAt: new Date().toISOString(),
        organization: {
          _id: String(organization._id),
          name: organization.name,
          slug: organization.slug,
        },
        counts,
      },
      data,
    };

    const filename = `backup-org-${organization.slug}-${timestampSlug()}.json`;
    return { backup, filename };
  });
}

export async function buildPlatformBackup(): Promise<{ backup: BackupDocument; filename: string }> {
  return runAsSystem(async () => {
    const organizations = ((await OrganizationModel.find().lean()) as Record<string, unknown>[]) ?? [];
    const data: Record<string, Record<string, unknown>[]> = { organizations };
    const counts: Record<string, number> = { organizations: organizations.length };

    for (const { key, model, select } of TENANT_COLLECTIONS) {
      const docs = await dumpCollection(model, {}, select);
      data[key] = docs;
      counts[key] = docs.length;
    }

    const backup: BackupDocument = {
      meta: {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        kind: 'platform',
        generatedAt: new Date().toISOString(),
        counts,
      },
      data,
    };

    return { backup, filename: `backup-platform-${timestampSlug()}.json` };
  });
}

/* ========================= الاستعادة ========================= */

export interface RestoreResult {
  organization: { _id: string; name: string; slug: string };
  restored: Record<string, number>;
}

function assertValidBackup(backup: unknown): asserts backup is BackupDocument {
  if (!backup || typeof backup !== 'object') throw ApiError.badRequest('ملف النسخة الاحتياطية غير صالح');
  const doc = backup as Partial<BackupDocument>;
  const meta = doc.meta;
  if (!meta || meta.format !== BACKUP_FORMAT || meta.version !== BACKUP_VERSION) {
    throw ApiError.badRequest('الملف ليس نسخة احتياطية معتمدة من هذا النظام');
  }
  if (meta.kind !== 'organization' && meta.kind !== 'platform') {
    throw ApiError.badRequest('نوع النسخة الاحتياطية غير معروف');
  }
  if (!doc.data || !Array.isArray(doc.data.organizations)) {
    throw ApiError.badRequest('النسخة الاحتياطية لا تحتوي بيانات مؤسسات');
  }
}

/** استعادة نسخة على القاعدة الحالية — قاعدة فارغة فقط (أو مؤسسة غير موجودة). */
export async function restoreBackup(backup: unknown): Promise<RestoreResult> {
  assertValidBackup(backup);
  const { meta, data } = backup;

  return runAsSystem(async () => {
    if (meta.kind === 'platform') {
      const anyOrg = await OrganizationModel.exists({});
      if (anyOrg) {
        throw ApiError.conflict('استعادة نسخة المنصة ممكنة فقط على قاعدة بيانات فارغة — لا يمكن الدمج فوق بيانات قائمة');
      }
    } else {
      const org = data.organizations[0] as { _id?: unknown; slug?: unknown } | undefined;
      if (!org || !org._id || !org.slug) throw ApiError.badRequest('النسخة الاحتياطية لا تحتوي مستند مؤسسة سليمًا');
      const clash = await OrganizationModel.exists({
        $or: [{ _id: org._id as string }, { slug: org.slug as string }],
      });
      if (clash) {
        throw ApiError.conflict(
          'توجد مؤسسة بنفس المعرّف أو المعرّف النصي (slug) بالفعل — الاستعادة تعمل على قاعدة فارغة فقط',
        );
      }
    }

    const restored: Record<string, number> = {};

    for (const orgDoc of data.organizations) {
      await OrganizationModel.insertMany([orgDoc] as never[]);
      restored.organizations = (restored.organizations ?? 0) + 1;
    }

    // الفروع والمستخدمون أولًا (يُشار إليهما من باقي المستندات)، ثم الباقي
    for (const { key, model } of TENANT_COLLECTIONS) {
      const docs = data[key];
      if (!Array.isArray(docs) || docs.length === 0) {
        restored[key] = 0;
        continue;
      }
      await model.insertMany(docs as never[]);
      restored[key] = docs.length;
    }

    // إعادة حساب عدّادات الترقيم من المستندات المستعادة — الدالة عالمية
    // وتفصل لكل مؤسسة داخليًا، ولا تُنقص أي عدّاد قائم أبدًا
    await syncNumberCounters();

    const firstOrg = data.organizations[0] as unknown as { _id: string; name: string; slug: string };
    return {
      organization: { _id: String(firstOrg._id), name: String(firstOrg.name), slug: String(firstOrg.slug) },
      restored,
    };
  });
}

/* ==================== ملفات النسخ المجدولة ==================== */

const FILENAME_PATTERN = /^backup-[A-Za-z0-9._-]+\.json$/;

export function resolveBackupDir(): string {
  return path.resolve(process.cwd(), env.BACKUP_DIR);
}

export async function listBackupFiles(): Promise<BackupFileSummary[]> {
  const dir = resolveBackupDir();
  if (!fs.existsSync(dir)) return [];
  const names = await fsp.readdir(dir);
  const summaries: BackupFileSummary[] = [];
  for (const name of names) {
    if (!FILENAME_PATTERN.test(name)) continue;
    const stat = await fsp.stat(path.join(dir, name));
    if (!stat.isFile()) continue;
    summaries.push({ filename: name, sizeBytes: stat.size, createdAt: stat.mtime.toISOString() });
  }
  return summaries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

const UPLOAD_SNAPSHOT_PATTERN = /^uploads-\d{8}-\d{6}$/;

async function directoryUsage(dir: string): Promise<{ files: number; sizeBytes: number }> {
  let files = 0;
  let sizeBytes = 0;

  const walk = async (current: string): Promise<void> => {
    const entries = await fsp.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        const stat = await fsp.stat(absolute);
        files += 1;
        sizeBytes += stat.size;
      }
    }
  };

  await walk(dir);
  return { files, sizeBytes };
}

export async function listUploadSnapshots(): Promise<UploadSnapshotSummary[]> {
  const dir = resolveBackupDir();
  if (!fs.existsSync(dir)) return [];
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const snapshots: UploadSnapshotSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !UPLOAD_SNAPSHOT_PATTERN.test(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    const stat = await fsp.stat(absolute);
    const usage = await directoryUsage(absolute);
    snapshots.push({ directory: entry.name, ...usage, createdAt: stat.mtime.toISOString() });
  }
  return snapshots.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/**
 * نسخ ملفات uploads بجانب نسخة JSON.
 *
 * S3/R2 مسؤولية النسخ فيه على المزوّد (Versioning/Lifecycle) — النسخ المحلي
 * سيكون ناقصًا وصامتًا، لذلك نسجّل سبب التخطي بدل الادعاء بوجود نسخة كاملة.
 */
export async function snapshotUploads(timestamp: string): Promise<UploadSnapshotSummary | null> {
  if (!env.BACKUP_INCLUDE_UPLOADS) return null;
  if (env.STORAGE_DRIVER !== 'local') {
    logger.info({ driver: env.STORAGE_DRIVER }, 'تخطي نسخ ملفات uploads: التخزين سحابي');
    return null;
  }

  const source = resolveUploadDir();
  if (!fs.existsSync(source)) return null;

  const dir = resolveBackupDir();
  const dest = path.join(dir, `uploads-${timestamp}`);
  await fsp.rm(dest, { recursive: true, force: true });
  await fsp.mkdir(dest, { recursive: true });

  // نسخ كل مجلد مؤسسة على حدة (لا نعتمد على دلالات cp مع مجلد موجود)
  const entries = await fsp.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    await fsp.cp(path.join(source, entry.name), path.join(dest, entry.name), {
      recursive: true,
      force: true,
    });
  }

  const usage = await directoryUsage(dest);
  const stat = await fsp.stat(dest);
  logger.info({ directory: `uploads-${timestamp}`, ...usage }, 'نُسخت ملفات uploads مع النسخة الاحتياطية');
  return { directory: `uploads-${timestamp}`, ...usage, createdAt: stat.mtime.toISOString() };
}

/** مسار ملف نسخة محقق منه (اسم بسيط بلا مسارات — منع path traversal) */
function backupFilePath(filename: string): string {
  if (!FILENAME_PATTERN.test(filename)) throw ApiError.notFound('ملف النسخة غير موجود');
  const absolute = path.resolve(resolveBackupDir(), filename);
  if (!absolute.startsWith(resolveBackupDir() + path.sep)) throw ApiError.notFound('ملف النسخة غير موجود');
  if (!fs.existsSync(absolute)) throw ApiError.notFound('ملف النسخة غير موجود');
  return absolute;
}

export async function readBackupFile(filename: string): Promise<BackupDocument> {
  const absolute = backupFilePath(filename);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fsp.readFile(absolute, 'utf8'));
  } catch {
    throw ApiError.badRequest('تعذر قراءة ملف النسخة الاحتياطية — الملف تالف أو غير مكتمل');
  }
  assertValidBackup(parsed);
  return parsed;
}

export function backupFileLocation(filename: string): string {
  return backupFilePath(filename);
}

export interface BackupRunResult {
  filename: string;
  sizeBytes: number;
  kind: 'platform';
  counts: Record<string, number>;
  uploads: UploadSnapshotSummary | null;
}

export async function runScheduledBackup(): Promise<BackupRunResult> {
  // Vercel يمنح نظام ملفات للقراءة فقط (عدا /tmp غير الدائم)؛ نسخة تُكتب هناك
  // تضيع مع أول Cold Start. نطلب نسخ المزوّد/Atlas بدل الإيهام بنسخة ناجحة.
  if (env.isVercel) {
    throw ApiError.businessRule(
      'النسخ الاحتياطي المحلي غير متاح على Vercel. استخدم النسخ التلقائي من MongoDB Atlas أو شغّل النسخ على خادم دائم، مع STORAGE_DRIVER=s3 للملفات.',
    );
  }

  const { backup, filename } = await buildPlatformBackup();

  const dir = resolveBackupDir();
  await fsp.mkdir(dir, { recursive: true });
  const absolute = path.join(dir, filename);
  await fsp.writeFile(absolute, JSON.stringify(backup), 'utf8');

  const timestamp = filename.replace(/^backup-platform-/, '').replace(/\.json$/, '');
  let uploads: UploadSnapshotSummary | null = null;
  try {
    uploads = await snapshotUploads(timestamp);
  } catch (err) {
    // فشل نسخ الملفات لا يُسقط نسخة قاعدة البيانات — لكنه يظل ظاهرًا في السجل
    logger.error({ err, filename }, 'فشل نسخ ملفات uploads مع النسخة الاحتياطية');
  }

  // تنقيح النسخ القديمة: نُبقي أحدث BACKUP_RETENTION_COUNT ملفًا فقط
  const files = await listBackupFiles();
  for (const stale of files.slice(env.BACKUP_RETENTION_COUNT)) {
    try {
      await fsp.unlink(path.join(dir, stale.filename));
      const stamp = stale.filename.replace(/^backup-platform-/, '').replace(/\.json$/, '');
      await fsp.rm(path.join(dir, `uploads-${stamp}`), { recursive: true, force: true });
    } catch (err) {
      logger.warn({ err, file: stale.filename }, 'تعذر حذف نسخة احتياطية قديمة');
    }
  }

  // تنقيح لقطات الملفات اليتيمة أيضًا (لو حُذف ملف JSON يدويًا)
  const snapshots = await listUploadSnapshots();
  for (const stale of snapshots.slice(env.BACKUP_RETENTION_COUNT)) {
    try {
      await fsp.rm(path.join(dir, stale.directory), { recursive: true, force: true });
    } catch (err) {
      logger.warn({ err, directory: stale.directory }, 'تعذر حذف لقطة ملفات قديمة');
    }
  }

  const sizeBytes = (await fsp.stat(absolute)).size;
  logger.info(
    {
      filename,
      sizeBytes,
      organizations: backup.meta.counts.organizations,
      uploadFiles: uploads?.files ?? 0,
    },
    'أُنشئت نسخة احتياطية كاملة',
  );
  return { filename, sizeBytes, kind: 'platform', counts: backup.meta.counts, uploads };
}
