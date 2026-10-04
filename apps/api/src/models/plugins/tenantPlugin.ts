import { Schema, Types } from 'mongoose';
import { ApiError } from '../../utils/ApiError.js';
import { getTenantContext, isSystemContext } from '../../context/tenantContext.js';

export interface TenantScopedFields {
  organizationId: Types.ObjectId;
  branchId?: Types.ObjectId | null;
}

/**
 * إضافة عزل المستأجر (tenant isolation) على مستوى الاستعلام.
 *
 * بديل Row-Level Security في PostgreSQL/Supabase:
 * - كل مستند يحمل organizationId غير قابل للتعديل.
 * - pre-hooks تضيف شرط organizationId تلقائيًا لأي قراءة/تحديث/حذف،
 *   اعتمادًا على TenantContext الذي يعبّئه middleware المصادقة من التوكن.
 * - أي تعارض بين مرشّح الاستعلام والسياق يرفع TENANT_MISMATCH.
 *
 * ملاحظة: العمليات التي تعمل بدون سياق مستأجر (seed / مهام النظام المجدولة)
 * يجب أن تستدعي runWithTenantContext لتمرير المؤسسة صراحةً.
 */
export function tenantPlugin(schema: Schema): void {
  // الحقول تُضاف في تعريف الموديل نفسه لضمان أنواع TypeScript،
  // وهذا الاحتياط يغطي أي موديل نُسي فيه التعريف.
  if (!schema.path('organizationId')) {
    schema.add({
      organizationId: {
        type: Schema.Types.ObjectId,
        ref: 'Organization',
        required: true,
        index: true,
        immutable: true,
      },
      branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    });
  }

  const scope = (
    filter: Record<string, unknown> = {},
    hookName = '',
    collectionName = '',
  ): Record<string, unknown> => {
    const ctx = getTenantContext();

    if (!ctx) {
      // حالة «استعلام صريح النطاق»: المرشّح يحمل organizationId مُتحقَّقًا منه مسبقًا
      // (مثل جلب تذكرة من رمز التتبع العام). هذا ليس تجاوزًا للعزل لأن القيمة
      // نفسها هي ما يُقيّد الاستعلام.
      if (filter.organizationId) return filter;

      // عمليات النظام الصريحة (seed / ترحيل بيانات / مهام صيانة) بلا أي مرشّح.
      if (isSystemContext()) return filter;

      throw ApiError.forbidden(
        `لا يوجد سياق مؤسسة لهذه العملية (${collectionName}.${hookName}): استخدم runAsSystem() أو runWithTenantContext()`,
      );
    }

    const existing = filter.organizationId;
    if (existing && String(existing) !== String(ctx.organizationId)) {
      throw ApiError.tenantMismatch();
    }
    return { ...filter, organizationId: ctx.organizationId };
  };

  const guardDocument = function guardDocument(
    this: { organizationId?: Types.ObjectId; isNew?: boolean },
    next: (err?: Error) => void,
  ) {
    const ctx = getTenantContext();
    if (ctx) {
      if (!this.organizationId) {
        this.organizationId = ctx.organizationId;
      } else if (String(this.organizationId) !== String(ctx.organizationId)) {
        return next(ApiError.tenantMismatch());
      }
    }
    return next();
  };

  schema.pre('validate', guardDocument);
  schema.pre('save', guardDocument);

  const queryHooks = [
    'countDocuments',
    'find',
    'findOne',
    'findOneAndDelete',
    'findOneAndReplace',
    'findOneAndUpdate',
    'updateMany',
    'updateOne',
    'deleteMany',
    'deleteOne',
    'distinct',
  ] as const;

  for (const hook of queryHooks) {
    schema.pre(
      hook as never,
      function tenantScope(this: {
        getFilter(): Record<string, unknown>;
        setQuery(q: unknown): void;
        model?: { collection?: { name?: string } };
      }) {
        // لو الخدمة مرّرت مرشّحًا يحتوي already على organizationId نتحقق منه
        const collectionName = this.model?.collection?.name ?? schema.get('collection') ?? 'unknown';
        this.setQuery(scope(this.getFilter(), hook, String(collectionName)));
      } as never,
    );
  }

  schema.pre(
    // يُسجَّل الـhook على مستوى Aggregate في Mongoose
    'aggregate' as never,
    function tenantAggregate(this: {
      pipeline(): Record<string, unknown>[];
      pipeline(p: Record<string, unknown>[]): void;
    }) {
      const ctx = getTenantContext();
      if (!ctx) {
        if (isSystemContext()) return;
        throw ApiError.forbidden('تجميع بدون سياق مؤسسة مرفوض — استخدم runAsSystem() أو runWithTenantContext()');
      }

      const pipeline = this.pipeline();

      // وجود مفتاح organizationId في أي $match لا يكفي: يجب مطابقة قيمته للسياق
      let scopedOrganizationId: unknown;
      const hasOrgMatch = pipeline.some((stage) => {
        if (
          !('$match' in stage) ||
          typeof stage.$match !== 'object' ||
          stage.$match === null ||
          !('organizationId' in (stage.$match as Record<string, unknown>))
        ) {
          return false;
        }
        scopedOrganizationId = (stage.$match as Record<string, unknown>).organizationId;
        return true;
      });

      if (hasOrgMatch) {
        if (String(scopedOrganizationId) !== String(ctx.organizationId)) {
          throw ApiError.tenantMismatch();
        }
        return;
      }

      this.pipeline([{ $match: { organizationId: ctx.organizationId } }, ...pipeline]);
    } as never,
  );
}

export default tenantPlugin;
