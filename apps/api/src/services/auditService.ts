import type { NextFunction, Request, Response } from 'express';
import { Types } from 'mongoose';
import { AuditLogModel } from '../models/AuditLog.js';
import { getTenantContext, runAsSystem, type TenantContext } from '../context/tenantContext.js';
import { logger } from '../config/logger.js';
import type { AuditAction } from '../models/AuditLog.js';

export interface AuditInput {
  action: AuditAction;
  resource: string;
  resourceId?: string | null;
  summary?: string;
  changes?: { field: string; before?: unknown; after?: unknown }[];
  severity?: 'info' | 'warning' | 'critical';
  /**
   * سياق صريح يُستخدم بدل AsyncLocalStorage.
   *
   * ضروري في الحالات التي تُنفَّذ فيها الكتابة **بعد** انتهاء نطاق الطلب، مثل
   * `res.on('finish')` في `auditMiddleware` — فسياق AsyncLocalStorage لا يبقى
   * متاحًا عبر أحداث الاستجابة، وكان ذلك يجعل التسجيل التلقائي يُتخطّى بصمت.
   */
  context?: TenantContext | null;
}

const SENSITIVE_PATHS = [/password/i, /token/i, /secret/i, /lockCode/i, /signature/i];

function isSensitive(field: string): boolean {
  return SENSITIVE_PATHS.some((re) => re.test(field));
}

/**
 * تسجيل عملية في سجل التدقيق.
 * لا نُفشل العملية الأصلية إذا فشل التسجيل، لكننا نسجّل الخطأ بوضوح.
 */
export async function recordAudit(input: AuditInput, req?: Request): Promise<void> {
  try {
    const ctx = input.context ?? getTenantContext();
    if (!ctx) {
      logger.warn({ action: input.action, resource: input.resource }, 'تخطي سجل تدقيق بدون سياق مؤسسة');
      return;
    }

    const changes = (input.changes ?? [])
      .filter((c) => !isSensitive(c.field))
      .slice(0, 50)
      .map((c) => ({ field: c.field, before: c.before ?? null, after: c.after ?? null }));

    // نكتب السجل داخل علم النظام: عمليات إدارة المنصة تُسجّل في سجل مركز مستهدف
    // مختلف عن مؤسسة الفاعل، وكان guardDocument يرفض هذا التعارض (TENANT_MISMATCH)
    // رغم أن السياق الصريح أعلاه يحمل كل بيانات السجل الصحيحة (المؤسسة الهدف، الفاعل، IP).
    await runAsSystem(() =>
      AuditLogModel.create({
        organizationId: ctx.organizationId,
        branchId: ctx.branchId,
        action: input.action,
        resource: input.resource,
        resourceId: input.resourceId ?? null,
        summary: input.summary ?? '',
        changes,
        actorId: ctx.actor.userId,
        actorName: ctx.actor.fullName,
        actorRole: ctx.actor.role,
        ip: ctx.ip ?? '',
        userAgent: ctx.userAgent ?? '',
        requestId: ctx.requestId,
        method: req?.method ?? '',
        path: req?.originalUrl ?? '',
        statusCode: req?.res?.statusCode ?? 0,
        severity: input.severity ?? 'info',
        occurredAt: new Date(),
      }),
    );
  } catch (err) {
    logger.error({ err, action: input.action }, 'فشل كتابة سجل التدقيق');
  }
}

/**
 * تسجيل تلقائي لعمليات الكتابة (POST/PUT/PATCH/DELETE) — الناجحة والفاشلة.
 *
 * المحاولات الفاشلة (403 صلاحية/عزل، 409 قاعدة عمل، 5xx) تُسجَّل أيضًا:
 * بدونها لا يمكن تتبّع محاولات الوصول غير المصرّح بها أو التلاعب المرفوض.
 *
 * مهم: نلتقط السياق **بشكل متزامن** هنا (وقت مرور الطلب) لأن `res.on('finish')`
 * يُنفَّذ بعد انتهاء الطلب حيث لا يعود AsyncLocalStorage متاحًا. الاعتماد على
 * `getTenantContext()` داخل الـcallback كان يجعل كل السجلات التلقائية تُتخطّى.
 */
export function auditMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();

  // لقطة متزامنة من السياق الحالي — تبقى صالحة بعد انتهاء الطلب
  const capturedContext: TenantContext | null = getTenantContext() ?? null;
  const capturedAuth = req.auth ? { ...req.auth } : null;
  const method = req.method;
  const originalUrl = req.originalUrl;

  res.on('finish', () => {
    // نبني السياق من اللقطة؛ لو غير متاح نستعيده من بيانات المصادقة
    const context: TenantContext | null =
      capturedContext ??
      (capturedAuth
        ? {
            actor: {
              userId: capturedAuth.userId,
              organizationId: new Types.ObjectId(capturedAuth.organizationId),
              branchId: capturedAuth.branchId ? new Types.ObjectId(capturedAuth.branchId) : null,
              role: capturedAuth.role,
              fullName: capturedAuth.fullName,
            },
            organizationId: new Types.ObjectId(capturedAuth.organizationId),
            branchId: capturedAuth.branchId ? new Types.ObjectId(capturedAuth.branchId) : null,
            requestId: req.requestId ?? '',
            ip: req.ip,
            userAgent: req.headers['user-agent'] ?? '',
          }
        : null);

    if (!context) return;

    const failed = res.statusCode >= 400;
    const segments = originalUrl.split('?')[0]!.split('/').filter(Boolean);
    // /api/v1/<resource>/<id>/...
    const resource = segments[2] ?? 'unknown';
    const resourceId = segments[3] && /^[0-9a-fA-F]{24}$/.test(segments[3]) ? segments[3] : null;

    const action: AuditAction = method === 'POST' ? 'create' : method === 'DELETE' ? 'delete' : 'update';

    const severity: 'info' | 'warning' | 'critical' = failed
      ? res.statusCode >= 500
        ? 'critical'
        : 'warning'
      : method === 'DELETE'
        ? 'warning'
        : 'info';

    void recordAudit(
      {
        action,
        resource,
        resourceId,
        summary: failed ? `${method} ${originalUrl} → فشل (${res.statusCode})` : `${method} ${originalUrl}`,
        severity,
        context,
      },
      req,
    );
  });

  return next();
}
