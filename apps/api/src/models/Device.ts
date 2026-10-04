import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { tenantPlugin } from './plugins/tenantPlugin.js';

const DEVICE_CATEGORIES = [
  'smartphone',
  'tablet',
  'smartwatch',
  'laptop',
  'accessory',
  'other',
] as const;

const DEVICE_CONDITIONS = [
  'new',
  'excellent',
  'good',
  'fair',
  'poor',
  'damaged',
] as const;

const deviceSchema = new Schema(
  {
    // --- عزل المستأجر (tenant isolation) - تُفرض في tenantPlugin ---
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true, immutable: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    category: { type: String, enum: DEVICE_CATEGORIES, default: 'smartphone', index: true },
    brand: { type: String, required: true, trim: true, index: true },
    model: { type: String, required: true, trim: true, index: true },
    modelNumber: { type: String, trim: true, default: '' },
    /** IMEI أو الرقم التسلسلي - يُخزَّن كاملًا لكن يُقنَّع في العروض العامة */
    imei: { type: String, trim: true, default: '' },
    imei2: { type: String, trim: true, default: '' },
    serial: { type: String, trim: true, default: '' },
    color: { type: String, trim: true, default: '' },
    storage: { type: String, trim: true, default: '' },
    ram: { type: String, trim: true, default: '' },
    /** لا تُخزَّن كلمة مرور/نمط قفل الجهاز بصيغة مكشوفة: نحفظ إشارة فقط */
    hasLockCode: { type: Boolean, default: false },
    lockType: {
      type: String,
      enum: ['none', 'pin', 'pattern', 'password', 'face', 'fingerprint', 'icloud', 'google'],
      default: 'none',
    },
    lockProvidedByCustomer: { type: Boolean, default: false },
    /** الجهاز مقفول بـ iCloud/Google Account - يؤثر على إمكانية الإصلاح */
    isAccountLocked: { type: Boolean, default: false },
    conditionOnIntake: { type: String, enum: DEVICE_CONDITIONS, default: 'good' },
    /** Passport: لقطة تراكمية لتاريخ الجهاز */
    passport: {
      type: new Schema(
        {
          firstSeenAt: { type: Date, default: Date.now },
          totalRepairs: { type: Number, default: 0 },
          totalSpentEgp: { type: Number, default: 0 },
          openTickets: { type: Number, default: 0 },
          warrantyClaims: { type: Number, default: 0 },
          replacedParts: { type: [String], default: [] },
          lastServiceAt: { type: Date, default: null },
          lastTechnicianId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
          /** liquid_damage, previous_repair, board_level, ... */
          riskFlags: { type: [String], default: [] },
        },
        { _id: false },
      ),
      default: () => ({}),
    },
    purchase: {
      purchasedFrom: { type: String, trim: true, default: '' },
      purchaseDate: { type: Date, default: null },
      invoiceNumber: { type: String, trim: true, default: '' },
      warrantyStatus: {
        type: String,
        enum: ['unknown', 'in_warranty', 'out_of_warranty', 'shop_warranty'],
        default: 'unknown',
      },
      warrantyExpiresAt: { type: Date, default: null },
    },
    notes: { type: String, default: '' },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

deviceSchema.plugin(tenantPlugin);

deviceSchema.index({ organizationId: 1, imei: 1 });
deviceSchema.index({ organizationId: 1, serial: 1 });
deviceSchema.index({ organizationId: 1, customerId: 1, isActive: 1 });
deviceSchema.index({ organizationId: 1, brand: 1, model: 1 });
deviceSchema.index({ brand: 'text', model: 'text', imei: 'text', serial: 'text' });

deviceSchema.virtual('displayName').get(function displayName(this: { brand: string; model: string }) {
  return `${this.brand} ${this.model}`.trim();
});

/** إخفاء جزء من الـIMEI في العروض العامة (بوابة العميل) */
deviceSchema.methods.maskedImei = function maskedImei(this: { imei?: string }) {
  const imei = this.imei ?? '';
  if (imei.length < 6) return imei ? '****' : '';
  return `${imei.slice(0, 4)}${'*'.repeat(Math.max(0, imei.length - 7))}${imei.slice(-3)}`;
};

export const DEVICE_CATEGORY_LABELS_AR: Record<(typeof DEVICE_CATEGORIES)[number], string> = {
  smartphone: 'هاتف',
  tablet: 'تابلت',
  smartwatch: 'ساعة ذكية',
  laptop: 'لابتوب',
  accessory: 'ملحق',
  other: 'أخرى',
};

export const DEVICE_CONDITION_LABELS_AR: Record<(typeof DEVICE_CONDITIONS)[number], string> = {
  new: 'جديد',
  excellent: 'ممتاز',
  good: 'جيد',
  fair: 'مقبول',
  poor: 'ضعيف',
  damaged: 'تالف',
};

export type Device = InferSchemaType<typeof deviceSchema>;
export type DeviceDoc = HydratedDocument<Device> & { maskedImei(): string };

export const DeviceModel = model('Device', deviceSchema);
export default DeviceModel;
