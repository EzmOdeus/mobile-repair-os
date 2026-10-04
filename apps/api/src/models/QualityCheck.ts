import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { tenantPlugin } from './plugins/tenantPlugin.js';

export const QC_RESULTS = ['pending', 'passed', 'failed', 'passed_with_notes'] as const;
export type QcResult = (typeof QC_RESULTS)[number];

export const QC_RESULT_LABELS_AR: Record<QcResult, string> = {
  pending: 'قيد التنفيذ',
  passed: 'اجتاز',
  failed: 'لم يجتز',
  passed_with_notes: 'اجتاز بملاحظات',
};

/** عناصر الفحص الافتراضية (Digital QC Checklist) - قابلة للتخصيص لكل موديل/فئة */
export const DEFAULT_QC_ITEMS: { key: string; labelAr: string; required: boolean }[] = [
  { key: 'display', labelAr: 'الشاشة والصورة', required: true },
  { key: 'touch', labelAr: 'اللمس', required: true },
  { key: 'front_camera', labelAr: 'الكاميرا الأمامية', required: true },
  { key: 'rear_camera', labelAr: 'الكاميرا الخلفية', required: true },
  { key: 'flash', labelAr: 'الفلاش', required: false },
  { key: 'microphone', labelAr: 'المايك (المتحدث)', required: true },
  { key: 'speaker', labelAr: 'السماعة (السبيكر)', required: true },
  { key: 'earpiece', labelAr: 'سماعة الأذن', required: true },
  { key: 'charging', labelAr: 'الشحن', required: true },
  { key: 'battery_health', labelAr: 'صحة البطارية', required: true },
  { key: 'wifi', labelAr: 'واي فاي', required: true },
  { key: 'bluetooth', labelAr: 'بلوتوث', required: false },
  { key: 'sim', labelAr: 'الشريحة والشبكة', required: true },
  { key: 'biometrics', labelAr: 'البصمة/التعرف على الوجه', required: false },
  { key: 'buttons', labelAr: 'الأزرار', required: true },
  { key: 'vibration', labelAr: 'الاهتزاز', required: false },
  { key: 'proximity_sensor', labelAr: 'حساس القرب', required: false },
  { key: 'gps', labelAr: 'GPS', required: false },
  { key: 'headphone_jack', labelAr: 'مدخل السماعة', required: false },
  { key: 'water_damage_check', labelAr: 'فحص آثار السوائل', required: false },
  { key: 'software_boot', labelAr: 'إقلاع النظام والبرمجة', required: true },
  { key: 'imei_match', labelAr: 'تطابق الـIMEI مع سجل الاستلام', required: true },
];

const qcItemSchema = new Schema(
  {
    key: { type: String, required: true },
    labelAr: { type: String, required: true },
    required: { type: Boolean, default: false },
    result: { type: String, enum: ['pending', 'pass', 'fail', 'not_applicable'], default: 'pending' },
    notes: { type: String, default: '' },
    evidenceFileId: { type: Schema.Types.ObjectId, ref: 'StoredFile', default: null },
    checkedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    checkedAt: { type: Date, default: null },
  },
  { _id: true },
);

/**
 * QualityCheck: فحص الجودة قبل تسليم الجهاز.
 * المركز يمكنه جعل بعض الفحوص إلزامية قبل الانتقال إلى Ready/Delivered،
 * والتحقق يُفرض في طبقة الخدمة (workflow) وليس في الواجهة فقط.
 */
const qualityCheckSchema = new Schema(
  {
    // --- عزل المستأجر (tenant isolation) - تُفرض في tenantPlugin ---
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true, immutable: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    ticketId: { type: Schema.Types.ObjectId, ref: 'RepairTicket', required: true, index: true },
    deviceId: { type: Schema.Types.ObjectId, ref: 'Device', default: null, index: true },
    technicianId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    inspectorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    attempt: { type: Number, default: 1, min: 1 },
    result: { type: String, enum: QC_RESULTS, default: 'pending', index: true },
    items: { type: [qcItemSchema], default: [] },
    /** البيانات المقاسة */
    measurements: {
      batteryHealthPct: { type: Number, default: null, min: 0, max: 100 },
      chargingCurrentA: { type: Number, default: null },
      bootTimeSeconds: { type: Number, default: null },
      screenTestResult: { type: String, default: '' },
      networkSignalDbm: { type: Number, default: null },
    },
    /** الاختبارات الإضافية */
    functionalTests: { type: [String], default: [] },
    failureReasons: { type: [String], default: [] },
    notes: { type: String, default: '' },
    evidenceFileIds: { type: [{ type: Schema.Types.ObjectId, ref: 'StoredFile' }], default: [] },
    signatureFileId: { type: Schema.Types.ObjectId, ref: 'StoredFile', default: null },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
    durationMinutes: { type: Number, default: 0, min: 0 },
    requiresReRepair: { type: Boolean, default: false },
    reRepairReason: { type: String, default: '' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

qualityCheckSchema.plugin(tenantPlugin);
qualityCheckSchema.index({ organizationId: 1, ticketId: 1, attempt: -1 });
qualityCheckSchema.index({ organizationId: 1, result: 1, createdAt: -1 });
qualityCheckSchema.index({ organizationId: 1, inspectorId: 1, createdAt: -1 });

qualityCheckSchema.virtual('passRatePct').get(function passRatePct(this: {
  items: { result: string; required: boolean }[];
}) {
  const applicable = (this.items ?? []).filter((i) => i.result !== 'not_applicable');
  if (!applicable.length) return 0;
  const passed = applicable.filter((i) => i.result === 'pass').length;
  return Number(((passed / applicable.length) * 100).toFixed(2));
});

export type QualityCheck = InferSchemaType<typeof qualityCheckSchema>;
export type QualityCheckDoc = HydratedDocument<QualityCheck>;

export const QualityCheckModel = model('QualityCheck', qualityCheckSchema);
export default QualityCheckModel;
