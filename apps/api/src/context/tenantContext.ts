import { AsyncLocalStorage } from 'node:async_hooks';
import { Types } from 'mongoose';

export interface RequestActor {
  userId: string;
  organizationId: Types.ObjectId;
  branchId: Types.ObjectId | null;
  role: string;
  fullName: string;
}

export interface TenantContext {
  actor: RequestActor;
  organizationId: Types.ObjectId;
  branchId: Types.ObjectId | null;
  requestId: string;
  ip?: string;
  userAgent?: string;
}

interface Store {
  tenant?: TenantContext;
  system?: boolean;
}

/**
 * سياق الطلب (Tenant Context) عبر AsyncLocalStorage.
 *
 * يتيح لطبقة الموديل معرفة المستأجر الحالي بدون تمرير organizationId يدويًا
 * في كل استعلام، وهو ما يمنع تسرب البيانات بين المراكز.
 *
 * runAsSystem: للعمليات الإدارية فقط (seed، ترحيل، مهام صيانة دورية).
 * أي استعلام بدون سياق مستأجر وبدون علم النظام مرفوض.
 *
 * ⚠️ مهم: دوال Mongoose الاستعلامية (find/findOne/updateMany...) "thenable" وليست
 * Promise حقيقيًا. إرجاعها مباشرة من callback يجعل التنفيذ يحدث *خارج* السياق
 * بعد خروج storage.run. لذلك نُغلّف الناتج في Promise.resolve داخل السياق نفسه.
 */
const storage = new AsyncLocalStorage<Store>();

/**
 * دخول السياق بشكل متزامن (بدون Promise).
 * يُستخدم في middleware حيث نريد أن يستمر السياق عبر بقية سلسلة الطلب،
 * ولأن إرجاع Promise من `storage.run` يُنهي السياق قبل تنفيذ استعلامات
 * Mongoose الكسولة (microtask) فيرفضها tenantPlugin بلا سياق.
 */
export function enterTenantContext(context: TenantContext): void {
  storage.enterWith({ tenant: context });
}

/**
 * تشغيل دالة داخل سياق محدّد مع ضمان بقاء السياق فعّالًا حتى تنفيذ الاستعلام فعلًا.
 * `await` داخل storage.run هو ما يُبقي السياق حيًّا أثناء تنفيذ استعلامات Mongoose.
 */
async function runInStore<T>(store: Store, fn: () => T): Promise<Awaited<T>> {
  return storage.run(store, async () => await fn()) as Promise<Awaited<T>>;
}

export function runWithTenantContext<T>(context: TenantContext, fn: () => T): Promise<Awaited<T>> {
  return runInStore({ tenant: context }, fn);
}

/** تشغيل عملية إدارية بدون عزل مستأجر (يُستخدم بحذر) */
export function runAsSystem<T>(fn: () => T): Promise<Awaited<T>> {
  return runInStore({ system: true }, fn);
}

export function getTenantContext(): TenantContext | undefined {
  return storage.getStore()?.tenant;
}

export function isSystemContext(): boolean {
  return storage.getStore()?.system === true;
}

export function requireTenantContext(): TenantContext {
  const ctx = storage.getStore()?.tenant;
  if (!ctx) {
    throw new Error('TenantContext غير متاح: تأكد من تشغيل العملية داخل سياق طلب مصادق عليه');
  }
  return ctx;
}

export function currentOrganizationId(): Types.ObjectId {
  return requireTenantContext().organizationId;
}

export function currentActor(): RequestActor {
  return requireTenantContext().actor;
}
