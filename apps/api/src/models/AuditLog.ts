import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { tenantPlugin } from './plugins/tenantPlugin.js';

export const AUDIT_ACTIONS = [
  'create',
  'update',
  'delete',
  'login',
  'logout',
  'login_failed',
  'password_change',
  'permission_change',
  'status_transition',
  'approve',
  'reject',
  'export',
  'import',
  'print',
  'file_upload',
  'file_download',
  'stock_adjust',
  'payment',
  'refund',
  'void',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * AuditLog: سجل تدقيق غير قابل للتعديل.
 * كل عملية حساسة تُسجَّل مع الفاعل والمورد والفرع وعنوان الـIP.
 */
const auditLogSchema = new Schema(
  {
    // --- عزل المستأجر (tenant isolation) - تُفرض في tenantPlugin ---
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true, immutable: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    action: { type: String, enum: AUDIT_ACTIONS, required: true, index: true },
    /** اسم المورد (Customer, RepairTicket, ...) */
    resource: { type: String, required: true, index: true },
    resourceId: { type: Schema.Types.ObjectId, default: null, index: true },
    /** وصف مقروء للعملية */
    summary: { type: String, default: '' },
    /** التغييرات: قبل/بعد للحقول المهمة */
    changes: {
      type: [
        new Schema(
          {
            field: { type: String, required: true },
            before: { type: Schema.Types.Mixed, default: null },
            after: { type: Schema.Types.Mixed, default: null },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    actorName: { type: String, default: '' },
    actorRole: { type: String, default: '' },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    requestId: { type: String, default: '', index: true },
    method: { type: String, default: '' },
    path: { type: String, default: '' },
    statusCode: { type: Number, default: 0 },
    severity: { type: String, enum: ['info', 'warning', 'critical'], default: 'info', index: true },
    occurredAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.plugin(tenantPlugin);
auditLogSchema.index({ organizationId: 1, occurredAt: -1 });
auditLogSchema.index({ organizationId: 1, resource: 1, resourceId: 1, occurredAt: -1 });
auditLogSchema.index({ organizationId: 1, actorId: 1, occurredAt: -1 });
auditLogSchema.index({ organizationId: 1, severity: 1, occurredAt: -1 });

export type AuditLog = InferSchemaType<typeof auditLogSchema>;
export type AuditLogDoc = HydratedDocument<AuditLog>;

export const AuditLogModel = model('AuditLog', auditLogSchema);
export default AuditLogModel;
