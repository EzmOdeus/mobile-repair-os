import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { tenantPlugin } from './plugins/tenantPlugin.js';

export const ESTIMATE_STATUSES = [
  'draft',
  'sent',
  'approved',
  'partially_approved',
  'rejected',
  'expired',
  'cancelled',
] as const;
export type EstimateStatus = (typeof ESTIMATE_STATUSES)[number];

export const ESTIMATE_STATUS_LABELS_AR: Record<EstimateStatus, string> = {
  draft: 'مسودة',
  sent: 'تم الإرسال',
  approved: 'معتمد',
  partially_approved: 'معتمد جزئيًا',
  rejected: 'مرفوض',
  expired: 'منتهي',
  cancelled: 'ملغي',
};

const lineSchema = new Schema(
  {
    kind: { type: String, enum: ['part', 'labor', 'service'], required: true },
    partId: { type: Schema.Types.ObjectId, ref: 'Part', default: null },
    description: { type: String, required: true },
    quantity: { type: Number, default: 1, min: 0 },
    unitPriceEgp: { type: Number, default: 0, min: 0 },
    totalEgp: { type: Number, default: 0, min: 0 },
    /** العميل قد يوافق على بعض البنود ويرفض أخرى */
    approved: { type: Boolean, default: null },
    warrantyDays: { type: Number, default: 0, min: 0 },
    notes: { type: String, default: '' },
  },
  { _id: true },
);

const totalsSchema = new Schema(
  {
    partsEgp: { type: Number, default: 0, min: 0 },
    laborEgp: { type: Number, default: 0, min: 0 },
    subtotalEgp: { type: Number, default: 0, min: 0 },
    discountEgp: { type: Number, default: 0, min: 0 },
    discountPct: { type: Number, default: 0, min: 0, max: 100 },
    taxRatePct: { type: Number, default: 14, min: 0, max: 100 },
    taxEgp: { type: Number, default: 0, min: 0 },
    totalEgp: { type: Number, default: 0, min: 0 },
    approvedTotalEgp: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

/**
 * Estimate: عرض سعر الإصلاح. يمكن أن يوجد أكثر من إصدار على نفس التذكرة،
 * والموافقة مرتبطة بإصدار بعينه (Approval) لتوثيق قرار العميل.
 */
const estimateSchema = new Schema(
  {
    // --- عزل المستأجر (tenant isolation) - تُفرض في tenantPlugin ---
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true, immutable: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    estimateNumber: { type: String, required: true, trim: true },
    ticketId: { type: Schema.Types.ObjectId, ref: 'RepairTicket', required: true, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', default: null, index: true },
    deviceId: { type: Schema.Types.ObjectId, ref: 'Device', default: null },
    version: { type: Number, default: 1, min: 1 },
    status: { type: String, enum: ESTIMATE_STATUSES, default: 'draft', index: true },

    lines: { type: [lineSchema], default: [] },
    totals: { type: totalsSchema, default: () => ({}) },

    estimatedDurationHours: { type: Number, default: 0, min: 0 },
    warrantyOfferedDays: { type: Number, default: 0, min: 0 },
    terms: { type: String, default: '' },
    customerNotes: { type: String, default: '' },
    internalNotes: { type: String, default: '' },

    validUntil: { type: Date, default: null },
    sentAt: { type: Date, default: null },
    sentVia: { type: String, enum: ['', 'whatsapp', 'sms', 'print', 'portal', 'in_person'], default: '' },
    decidedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: '' },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

estimateSchema.plugin(tenantPlugin);
estimateSchema.index({ organizationId: 1, estimateNumber: 1 }, { unique: true });
estimateSchema.index({ organizationId: 1, ticketId: 1, version: -1 });
estimateSchema.index({ organizationId: 1, status: 1, createdAt: -1 });

estimateSchema.virtual('isDecided').get(function isDecided(this: { status: EstimateStatus }) {
  return ['approved', 'partially_approved', 'rejected'].includes(this.status);
});

/** حساب إجمالي كل بند قبل الحفظ (المجاميع الكلية تُحسب في طبقة الخدمة) */
estimateSchema.pre('save', function computeLineTotals(this: {
  lines: { quantity: number; unitPriceEgp: number; totalEgp: number }[];
  isModified(path: string): boolean;
}) {
  if (!this.isModified('lines')) return;
  for (const line of this.lines) {
    line.totalEgp = Number(((line.quantity ?? 0) * (line.unitPriceEgp ?? 0)).toFixed(2));
  }
});

export type Estimate = InferSchemaType<typeof estimateSchema>;
export type EstimateDoc = HydratedDocument<Estimate>;

export const EstimateModel = model('Estimate', estimateSchema);
export default EstimateModel;
