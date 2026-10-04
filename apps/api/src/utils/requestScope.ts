import { Types } from 'mongoose';
import { ApiError } from './ApiError.js';
import { getTenantContext } from '../context/tenantContext.js';

export interface RequestScope {
  organizationId: Types.ObjectId;
  branchId: Types.ObjectId | null;
  actorUserId: Types.ObjectId;
}

/**
 * استخراج نطاق المؤسسة من سياق الطلب.
 *
 * نستخدم هذا في المسارات المصادق عليها لتمرير `organizationId` **صراحةً** في كل
 * استعلام، بدلًا من الاعتماد فقط على الـpre-hooks التي تضيفه من السياق الجاري.
 * السبب: استعلامات Mongoose الكسولة قد تُنفَّذ في microtask بعد انتهاء نطاق السياق،
 * فتفشل. تمريره صراحةً يجعل العزل مضمونًا حتى في هذه الحالة، ويجعل الكود أوضح:
 * كل دالة تُظهر أنها مُقيَّدة بمؤسسة بعينها.
 */
export function requestScope(): RequestScope {
  const ctx = getTenantContext();
  if (!ctx) throw ApiError.unauthorized('لا يوجد سياق مؤسسة لهذا الطلب');
  return {
    organizationId: ctx.organizationId,
    branchId: ctx.branchId,
    actorUserId: new Types.ObjectId(ctx.actor.userId),
  };
}

/** المعرّف النصي للمؤسسة (للتحقق من تطابق المستندات المُقرأة) */
export function currentOrgIdString(): string {
  return String(requestScope().organizationId);
}
