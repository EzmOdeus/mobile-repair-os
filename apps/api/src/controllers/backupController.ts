import type { Request, Response } from 'express';
import { getAuth } from '../middleware/auth.js';
import { ok } from '../utils/asyncHandler.js';
import { env } from '../config/env.js';
import {
  backupFileLocation,
  buildOrganizationBackup,
  listBackupFiles,
  listUploadSnapshots,
  readBackupFile,
  restoreBackup,
  runScheduledBackup,
} from '../services/backupService.js';

/**
 * تنزيل نسخة احتياطية JSON لبيانات مركز الطالب بالكامل.
 * محصورة بـorg:update (مالك/مدير نظام المركز فقط) لأنها تتضمن
 * passwordHash لكل المستخدمين.
 */
export const exportOrganizationBackup = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const { backup, filename } = await buildOrganizationBackup(auth.organizationId);

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(JSON.stringify(backup));
};

/* ---------------- إدارة نسخ المنصة (مدير المنصة فقط) ---------------- */

export const listBackups = async (_req: Request, res: Response) => {
  const files = await listBackupFiles();
  const uploadSnapshots = await listUploadSnapshots();
  return ok(res, {
    enabled: env.BACKUP_ENABLED,
    intervalHours: env.BACKUP_INTERVAL_HOURS,
    retentionCount: env.BACKUP_RETENTION_COUNT,
    dir: env.BACKUP_DIR,
    includeUploads: env.BACKUP_INCLUDE_UPLOADS,
    storageDriver: env.STORAGE_DRIVER,
    files,
    uploadSnapshots,
  });
};

export const runBackupNow = async (_req: Request, res: Response) => {
  const result = await runScheduledBackup();
  return ok(res, result);
};

export const downloadBackup = (req: Request, res: Response) => {
  const filename = String(req.params.file ?? '');
  const absolute = backupFileLocation(filename);
  return res.download(absolute, filename);
};

/**
 * استعادة نسخة من ملف محفوظ محليًا في مجلد النسخ الاحتياطية.
 * تُرفض فوق بيانات قائمة — انظر restoreBackup في backupService.
 */
export const restoreBackupFromFile = async (req: Request, res: Response) => {
  const backup = await readBackupFile(String(req.params.file ?? ''));
  const result = await restoreBackup(backup);
  return ok(res, result);
};
