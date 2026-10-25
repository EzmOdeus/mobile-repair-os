import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { Types } from 'mongoose';
import { ApiError } from '../utils/ApiError.js';
import { authenticate, getAuth } from './auth.js';
import { StoredFileModel } from '../models/StoredFile.js';
import { verifyFileSignature } from '../services/storageService.js';
import { getStorageDriver, resolveUploadDir } from '../services/storageDrivers.js';
import { env } from '../config/env.js';
import { runAsSystem } from '../context/tenantContext.js';
import { logger } from '../config/logger.js';

/** المسار النسبي للملف كما طلبه العميل (بعد /uploads) */
function requestedStorageKey(req: Request): string {
  return decodeURIComponent(String(req.path ?? '').replace(/^\/+/, ''));
}

/**
 * بوابة /uploads: إما رابط موقّع صالح (بدون جلسة) أو جلسة عادية.
 *
 * الوسوم `<img>` لا ترسل رأس Authorization، وروابط التتبع العامة تُفتح لعميل
 * لا يملك حسابًا. لذلك يُقبل الدخول برابط موقّع أصدره السيرفر لنفس الملف، وإلا
 * نُكمل بمسار المصادقة المعتاد (توكن Bearer).
 */
export function uploadAccessGate(req: Request, res: Response, next: NextFunction): void {
  const relative = requestedStorageKey(req);
  if (
    relative &&
    verifyFileSignature(relative, req.query.e, req.query.s)
  ) {
    res.locals.signedUpload = true;
    return next();
  }
  return authenticate(req, res, next);
}

/**
 * تخويل قراءة الملفات المرفوعة.
 *
 * **الثغرة التي يعالجها هذا الملف:** كان `/uploads` يُقدَّم بـ`express.static` بعد
 * `authenticate` فقط. أي مستخدم مُصادَق من مركز «أ» يعرف مسار ملف مركز «ب»
 * (المسار يبدأ بـ`<organizationId>/...` وهو ظاهر في `storageKey` لكل ملف) كان
 * يستطيع تنزيله. أي أن العزل كان مطبَّقًا على القرص وفي قاعدة البيانات، لكن **لا**
 * على التخويل بالقراءة.
 *
 * القاعدة الآن: يُقدَّم الملف فقط إذا كان معرّف المؤسسة في أول جزء من المسار
 * مطابقًا لمؤسسة الطالب، أو إذا كان الطلب يحمل توقيعًا صالحًا لنفس المسار
 * (رابط موقّع من السيرفر — أصدره عبر publicFileUrl). أي شيء آخر = 404 (وليس 403،
 * لتجنّب تأكيد وجود الملف).
 */
export function uploadAuthorization(requiredPermission = 'evidence:read') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const relative = requestedStorageKey(req);
      if (!relative) return next(ApiError.notFound('الملف غير موجود'));

      const segments = relative.split('/').filter(Boolean);
      if (segments.length < 2) return next(ApiError.notFound('الملف غير موجود'));

      const ownerOrgId = segments[0]!;
      const signed = res.locals.signedUpload === true;

      if (!signed) {
        const auth = getAuth(req);

        // 1) لا يمكن تقديم ملف مؤسسة أخرى مطلقًا
        if (!Types.ObjectId.isValid(ownerOrgId) || ownerOrgId !== auth.organizationId) {
          logger.warn(
            { requestedOrg: ownerOrgId, actorOrg: auth.organizationId, actor: auth.userId, path: relative },
            'محاولة قراءة ملف من مؤسسة أخرى — مرفوضة',
          );
          return next(ApiError.notFound('الملف غير موجود'));
        }

        // 2) الصلاحية العامة لقراءة الأدلة
        if (!auth.permissions.includes(requiredPermission as never)) {
          return next(ApiError.forbidden('لا تملك صلاحية قراءة الملفات'));
        }
      } else if (!Types.ObjectId.isValid(ownerOrgId)) {
        return next(ApiError.notFound('الملف غير موجود'));
      }

      // 3) منع الهروب من المجلد (path traversal) — خاص بالمحرك المحلي فقط؛
      // مفاتيح S3 لا تُفسَّر كمسارات نظام ملفات أصلًا
      if (env.STORAGE_DRIVER === 'local') {
        const uploadDir = resolveUploadDir();
        const absolute = path.resolve(uploadDir, relative);
        const normalizedRoot = path.resolve(uploadDir);
        if (absolute !== normalizedRoot && !absolute.startsWith(normalizedRoot + path.sep)) {
          logger.warn({ path: relative, absolute }, 'محاولة هروب من مجلد الملفات — مرفوضة');
          return next(ApiError.notFound('الملف غير موجود'));
        }
      }

      if (!(await getStorageDriver().exists(relative))) {
        return next(ApiError.notFound('الملف غير موجود'));
      }

      /**
       * 4) تحقق إضافي للملفات الحساسة: إن كان للملف سجل في قاعدة البيانات،
       * نمنع تقديمه إن كان محذوفًا منطقيًا. الملفات بلا سجل (نادرة) تُقدَّم ما دامت
       * داخل مجلد مؤسسة الطالب، وهو ما يكفي للعزل.
       */
      const fetchStored = () =>
        StoredFileModel.findOne({ organizationId: ownerOrgId, storageKey: relative })
          .select('isDeleted')
          .lean();
      // الرابط الموقّع لا يملك سياق مؤسسة، فنقرأ داخل سياق النظام بعد إثبات التوقيع
      const stored = signed ? await runAsSystem(fetchStored) : await fetchStored();

      if (stored?.isDeleted) return next(ApiError.notFound('الملف غير موجود'));

      return next();
    } catch (error) {
      if (error instanceof ApiError) return next(error);
      logger.error({ err: error }, 'فشل تخويل قراءة الملف');
      return next(ApiError.notFound('الملف غير موجود'));
    }
  };
}

/**
 * بعد اجتياز التخويل: نُقدّم الملف بأنفسنا بدل `express.static` حتى لا يفتح
 * أي احتمال لتقديم مسار لم يُفحص.
 */
export function serveUploadedFile(req: Request, res: Response, next: NextFunction): void {
  void (async () => {
    try {
      const relative = decodeURIComponent(String(req.path ?? '').replace(/^\/+/, ''));

      // نوع المحتوى من سجل قاعدة البيانات، لا من الامتداد — نفس سياسة الرفع
      const ownerOrgId = relative.split('/').filter(Boolean)[0] ?? '';
      const stored = Types.ObjectId.isValid(ownerOrgId)
        ? await runAsSystem(() =>
            StoredFileModel.findOne({ organizationId: ownerOrgId, storageKey: relative })
              .select('mimeType')
              .lean(),
          )
        : null;

      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.setHeader('Content-Disposition', 'inline');
      if (stored?.mimeType) res.setHeader('Content-Type', stored.mimeType);

      const stream = await getStorageDriver().getStream(relative);
      stream.on('error', (err: Error) => {
        if (!res.headersSent) return next(ApiError.notFound('الملف غير موجود'));
        logger.error({ err, path: relative }, 'فشل أثناء تدفق الملف');
        res.destroy();
      });
      stream.pipe(res);
    } catch (error) {
      if (error instanceof ApiError) return next(error);
      next(error);
    }
  })();
}
