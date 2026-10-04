import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodType } from 'zod';
import { ApiError } from '../utils/ApiError.js';

type RequestPart = 'body' | 'query' | 'params';

interface ValidateOptions {
  /** استبدال القيمة الأصلية بالقيمة المحلّلة (الافتراضي: نعم للـbody) */
  replace?: boolean;
}

/**
 * تحقق من الطلب بـ Zod وتحويل الأخطاء إلى ApiError بالعربية.
 * القيم المحلّلة تُخزَّن في req.validated لتفادي مشاكل query غير القابل للكتابة في Express 5.
 */
export function validate(
  schema: ZodType,
  part: RequestPart = 'body',
  options: ValidateOptions = {},
): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      return next(ApiError.badRequest('بيانات الطلب غير صحيحة', formatZodIssues(result.error)));
    }

    const replace = options.replace ?? part === 'body';
    if (replace) {
      // body قابل للكتابة؛ query/params في Express 5 للقراءة فقط
      (req as unknown as Record<string, unknown>)[part] = result.data;
    }

    const bag = ((req as unknown as { validated?: Record<string, unknown> }).validated ??= {});
    bag[part] = result.data;

    return next();
  };
}

/** قراءة القيمة المحلّلة أو الأصلية */
export function validated<T>(req: Request, part: RequestPart): T {
  const bag = (req as unknown as { validated?: Record<string, unknown> }).validated;
  return (bag?.[part] ?? req[part]) as T;
}

export function formatZodIssues(error: ZodError): { field: string; message: string }[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}
