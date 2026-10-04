import type { NextFunction, Request, RequestHandler, Response } from 'express';

export type AsyncHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<unknown> | unknown;

/**
 * يلتف حول معالج المسار ليمرر أي rejection إلى middleware الأخطاء.
 * (Express 5 يمرر الأخطاء غير المتزامنة تلقائيًا، لكن هذا يوحّد السلوك.)
 */
export function asyncHandler(fn: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function ok<T>(res: Response, data: T, meta?: Record<string, unknown>) {
  return res.status(200).json({ success: true, data, ...(meta ? { meta } : {}) });
}

export function created<T>(res: Response, data: T, meta?: Record<string, unknown>) {
  return res.status(201).json({ success: true, data, ...(meta ? { meta } : {}) });
}

export function noContent(res: Response) {
  return res.status(204).send();
}

export function paginated<T>(
  res: Response,
  items: T[],
  pagination: { page: number; limit: number; total: number },
) {
  const { page, limit, total } = pagination;
  const pages = limit > 0 ? Math.ceil(total / limit) : 0;
  return res.status(200).json({
    success: true,
    data: items,
    meta: {
      page,
      limit,
      total,
      pages,
      hasNext: page < pages,
      hasPrev: page > 1,
    },
  });
}
