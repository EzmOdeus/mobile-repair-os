import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { tenantPlugin } from './plugins/tenantPlugin.js';

/**
 * ملف مخزّن محليًا (بديل Supabase Storage).
 * الملفات الفعلية على القرص داخل UPLOAD_DIR، وهذا المستند يحمل الوصف والصلاحيات.
 */
const storedFileSchema = new Schema(
  {
    // --- عزل المستأجر (tenant isolation) - تُفرض في tenantPlugin ---
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true, immutable: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    storageKey: { type: String, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    checksum: { type: String, default: '' },
    kind: {
      type: String,
      enum: [
        'intake_photo',
        'repair_photo',
        'qrc_result',
        'customer_signature',
        'receipt',
        'invoice_pdf',
        'device_document',
        'evidence_video',
        'avatar',
        'org_logo',
        'attachment',
      ],
      default: 'attachment',
      index: true,
    },
    /** ربط اختياري بالكيانات */
    deviceId: { type: Schema.Types.ObjectId, ref: 'Device', default: null, index: true },
    ticketId: { type: Schema.Types.ObjectId, ref: 'RepairTicket', default: null, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', default: null, index: true },
    qualityCheckId: { type: Schema.Types.ObjectId, ref: 'QualityCheck', default: null },
    caption: { type: String, default: '' },
    /** before_repair, during_repair, after_repair, delivery */
    stage: { type: String, default: '' },
    /** الصور الحساسة (توقيع العميل، مستندات) تُقيَّد صلاحيتها */
    isSensitive: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false, index: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

storedFileSchema.plugin(tenantPlugin);

storedFileSchema.index({ organizationId: 1, ticketId: 1, kind: 1 });
storedFileSchema.index({ organizationId: 1, deviceId: 1, createdAt: -1 });

export type StoredFile = InferSchemaType<typeof storedFileSchema>;
export type StoredFileDoc = HydratedDocument<StoredFile>;

export const StoredFileModel = model('StoredFile', storedFileSchema);
export default StoredFileModel;
