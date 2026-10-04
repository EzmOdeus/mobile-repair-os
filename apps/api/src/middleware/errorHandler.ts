import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import mongoose from 'mongoose';
import { ApiError, isApiError } from '../utils/ApiError.js';
import { logger } from '../config/logger.js';
import { formatZodIssues } from './validate.js';

interface MongoDuplicateKeyError extends Error {
  code: number;
  keyValue?: Record<string, unknown>;
}

interface MongoCastError extends Error {
  name: 'CastError';
  path?: string;
  value?: unknown;
}

function isDuplicateKeyError(err: unknown): err is MongoDuplicateKeyError {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

function isCastError(err: unknown): err is MongoCastError {
  return err instanceof mongoose.Error.CastError || (err as { name?: string })?.name === 'CastError';
}

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(ApiError.notFound(`المسار غير موجود: ${req.method} ${req.originalUrl}`));
}

/**
 * معالج الأخطاء المركزي. يوحّد شكل الاستجابة بالعربية:
 * { success: false, error: { code, message, details }, requestId }
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = (req as unknown as { requestId?: string }).requestId ?? '';

  if (res.headersSent) return;

  // 1) أخطاء التحقق من Zod
  if (err instanceof ZodError) {
    res.status(422).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'بيانات الطلب غير صحيحة',
        details: formatZodIssues(err),
      },
      requestId,
    });
    return;
  }

  // 2) أخطاء التحقق من Mongoose
  if (err instanceof mongoose.Error.ValidationError) {
    res.status(422).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'بيانات غير صحيحة في قاعدة البيانات',
        details: Object.values(err.errors).map((e) => ({ field: e.path, message: e.message })),
      },
      requestId,
    });
    return;
  }

  // 3) تكرار مفتاح فريد
  if (isDuplicateKeyError(err)) {
    /**
     * الفهرس الفريد قد يكون مركبًا (مثل `{organizationId, estimateNumber}`)،
     * والاكتفاء بأول حقل يعرض رسالة مضللة (تتهم `organizationId` دائمًا).
     * نعرض كل حقول الفهرس المكرر كما وردت في `err.keyValue`.
     */
    const fields = Object.keys(err.keyValue ?? {});
    const field = fields.length ? fields.join(' + ') : 'الحقل';
    res.status(409).json({
      success: false,
      error: {
        code: 'CONFLICT',
        message: `قيمة مكررة: ${field} مستخدم بالفعل`,
        details: err.keyValue ?? null,
      },
      requestId,
    });
    return;
  }

  // 4) معرّف غير صالح
  if (isCastError(err)) {
    res.status(422).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: `قيمة غير صحيحة للحقل ${err.path ?? ''}`.trim(),
      },
      requestId,
    });
    return;
  }

  // 5) أخطاء التطبيق المعروفة
  if (isApiError(err)) {
    if (err.status >= 500) logger.error({ err, requestId }, err.message);
    res.status(err.status).json({
      success: false,
      error: { code: err.code, message: err.message, details: err.details ?? null },
      requestId,
    });
    return;
  }

  // 6) Multer errors
  const multerCode = (err as { code?: string })?.code;
  if (multerCode === 'LIMIT_FILE_SIZE') {
    res.status(413).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'حجم الملف أكبر من الحد المسموح' },
      requestId,
    });
    return;
  }

  // 7) أي خطأ آخر
  logger.error({ err, requestId, path: req.originalUrl }, 'خطأ غير متوقع');
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'حدث خطأ غير متوقع، تم تسجيله للمراجعة',
    },
    requestId,
  });
}
