import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { Types } from 'mongoose';
import { verifyAccessToken } from '../services/tokenService.js';
import { ApiError } from '../utils/ApiError.js';
import { enterTenantContext, runAsSystem, type TenantContext } from '../context/tenantContext.js';
import { permissionsForRole, roleHasPermission, type Permission, type Role } from '../constants/roles.js';
import { UserModel } from '../models/User.js';
import { logger } from '../config/logger.js';

declare module 'express-serve-static-core' {
  interface Request {
    auth?: {
      userId: string;
      organizationId: string;
      branchId: string | null;
      role: Role;
      fullName: string;
      permissions: Permission[];
      /** true إذا كانت الصلاحيات مُشتقة من الدور فقط (تعذّر قراءة تجاوزات المستخدم) */
      permissionsFromRoleOnly?: boolean;
    };
    requestId?: string;
  }
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  const alt = req.headers['x-access-token'];
  if (typeof alt === 'string' && alt.trim()) return alt.trim();
  return null;
}

/** معرّف الطلب لكل عملية (للربط مع سجلات التدقيق) */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && incoming.trim() ? incoming.trim() : randomUUID();
  req.requestId = id;
  res.setHeader('x-request-id', id);
  next();
}

/** شكل الحد الأدنى من بيانات المستخدم اللازمة للصلاحيات */
export interface PermissionSourceUser {
  role: Role;
  isActive: boolean;
  extraPermissions?: string[] | null;
  deniedPermissions?: string[] | null;
}

/**
 * الصلاحيات الفعلية للمستخدم = صلاحيات الدور + الممنوحة له شخصيًا − المحجوبة عنه.
 *
 * السبب: كانت الصلاحيات تُشتق من الدور وحده، فيصبح حقلا `extraPermissions` و
 * `deniedPermissions` في الموديل بلا أي أثر — أي أن تقييد صلاحيات موظف بعينه
 * كان يظهر في الواجهة ولا يُفرض على الـAPI إطلاقًا.
 */
export function effectivePermissions(user: PermissionSourceUser): Permission[] {
  const base = new Set<string>(permissionsForRole(user.role));

  for (const extra of user.extraPermissions ?? []) base.add(extra);
  for (const denied of user.deniedPermissions ?? []) base.delete(denied);

  // لا يمكن حجب الصلاحيات الأساسية عن مالك أو مدير للنظام (حماية من قفل المركز)
  if (user.role === 'owner' || user.role === 'admin') return permissionsForRole(user.role);

  return [...base] as Permission[];
}

/**
 * مصادقة JWT + تعبئة سياق المستأجر.
 *
 * الصلاحيات تُقرأ من قاعدة البيانات لا من التوكن. السبب: التوكن يحمل الدور وقت
 * إصداره، فلو غيّر المالك دور موظف أو عطّله أو عدّل صلاحياته، كان الموظف يحتفظ
 * بصلاحياته القديمة حتى انتهاء صلاحية التوكن (15 دقيقة) — وهو ما يعني أن سحب
 * الصلاحيات لا ينفَّذ فعليًا.
 *
 * التكلفة استعلام واحد صغير (قراءة بمعرّف واحد مع فهرس فريد على _id).
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token) return next(ApiError.unauthorized('توكن الدخول مطلوب'));

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    return next(ApiError.unauthorized('انتهت صلاحية الجلسة، سجّل الدخول من جديد'));
  }

  if (payload.typ !== 'access') {
    return next(ApiError.unauthorized('نوع التوكن غير صحيح'));
  }

  if (!Types.ObjectId.isValid(payload.sub) || !Types.ObjectId.isValid(payload.org)) {
    return next(ApiError.unauthorized('توكن الدخول غير صحيح'));
  }

  const branchId = payload.br && Types.ObjectId.isValid(payload.br) ? payload.br : null;

  void (async () => {
    try {
      /**
       * نقرأ المستخدم من قاعدة البيانات للتحقق من:
       *  - الحساب ما زال موجودًا ونشطًا (تعطيل فوري)
       *  - الدور الحالي (تغيير فوري)
       *  - تجاوزات الصلاحيات الشخصية (mمنوحة/محجوبة)
       *  - أن التوكن يخص نفس المؤسسة
       */
      const user = await runAsSystem(async () =>
        UserModel.findOne({ _id: payload.sub, organizationId: payload.org })
          .select('role isActive fullName extraPermissions deniedPermissions')
          .lean(),
      );

      if (!user) return next(ApiError.unauthorized('الحساب غير موجود'));
      if (!user.isActive) return next(ApiError.forbidden('هذا الحساب معطّل، تواصل مع مالك المركز'));

      const role = user.role as Role;
      const permissions = effectivePermissions({
        role,
        isActive: true,
        extraPermissions: (user.extraPermissions ?? []) as string[],
        deniedPermissions: (user.deniedPermissions ?? []) as string[],
      });

      req.auth = {
        userId: String(user._id),
        organizationId: String(payload.org),
        branchId,
        role,
        fullName: user.fullName ?? payload.name ?? '',
        permissions,
      };

      const context: TenantContext = {
        actor: {
          userId: String(user._id),
          organizationId: new Types.ObjectId(payload.org),
          branchId: branchId ? new Types.ObjectId(branchId) : null,
          role,
          fullName: user.fullName ?? payload.name ?? '',
        },
        organizationId: new Types.ObjectId(payload.org),
        branchId: branchId ? new Types.ObjectId(branchId) : null,
        requestId: req.requestId ?? '',
        ip: req.ip,
        userAgent: req.headers['user-agent'] ?? '',
      };

      enterTenantContext(context);
      return next();
    } catch (error) {
      logger.error({ err: error }, 'فشل التحقق من صلاحيات المستخدم');
      return next(ApiError.unauthorized('تعذّر التحقق من الجلسة، حاول مرة أخرى'));
    }
  })();
}

/** مصادقة اختيارية: تُكمل السياق إن وُجد توكن صالح، وإلا تكمل بلا مصادقة */
export function optionalAuth(req: Request, res: Response, next: NextFunction): void {
  if (!extractToken(req)) return next();
  return authenticate(req, res, next);
}

/** يتطلب صلاحية معيّنة */
export function requirePermission(...required: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) return next(ApiError.unauthorized());
    const missing = required.filter((p) => !req.auth!.permissions.includes(p));
    if (missing.length) {
      return next(ApiError.forbidden(`لا تملك الصلاحية المطلوبة: ${missing.join(', ')}`));
    }
    return next();
  };
}

/** يتطلب أحد الأدوار المحددة */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) return next(ApiError.unauthorized());
    if (!roles.includes(req.auth.role)) {
      return next(ApiError.forbidden('الدور الحالي لا يسمح بهذه العملية'));
    }
    return next();
  };
}

export function getAuth(req: Request) {
  if (!req.auth) throw ApiError.unauthorized();
  return req.auth;
}

/** فحص صلاحية داخل الـcontroller دون middleware */
export function authHas(req: Request, permission: Permission | string): boolean {
  return req.auth?.permissions.includes(permission as Permission) ?? false;
}
