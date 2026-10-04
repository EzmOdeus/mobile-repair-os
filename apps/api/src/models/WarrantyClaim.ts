import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { tenantPlugin } from './plugins/tenantPlugin.js';

export const WARRANTY_CLAIM_STATUSES = [
  'open',
  'under_review',
  'approved',
  'rejected',
  'in_repair',
  'resolved',
  'cancelled',
] as const;
export type WarrantyClaimStatus = (typeof WARRANTY_CLAIM_STATUSES)[number];

export const WARRANTY_CLAIM_STATUS_LABELS_AR: Record<WarrantyClaimStatus, string> = {
  open: 'مفتوح',
  under_review: 'تحت المراجعة',
  approved: 'مقبول',
  rejected: 'مرفوض',
  in_repair: 'في الإصلاح',
  resolved: 'تم الحل',
  cancelled: 'ملغي',
};

export const WARRANTY_COVERAGE = ['part', 'labor', 'both', 'none'] as const;

/**
 * WarrantyClaim: عودة الجهاز تحت الضمان.
 * الربط بالإصلاح الأصلي والقطعة والفني هو أساس Warranty Intelligence
 * (معدل العودة حسب نوع الإصلاح/القطعة/الفني/الموديل).
 */
const warrantyClaimSchema = new Schema(
  {
    // --- عزل المستأجر (tenant isolation) - تُفرض في tenantPlugin ---
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true, immutable: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    claimNumber: { type: String, required: true, trim: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    deviceId: { type: Schema.Types.ObjectId, ref: 'Device', required: true, index: true },
    /** الإصلاح الأصلي الذي نشأ عنه الضمان */
    originalTicketId: { type: Schema.Types.ObjectId, ref: 'RepairTicket', required: true, index: true },
    originalRepairPartIds: { type: [{ type: Schema.Types.ObjectId, ref: 'RepairPart' }], default: [] },
    originalTechnicianId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    /** التذكرة الجديدة الناتجة عن العودة */
    newTicketId: { type: Schema.Types.ObjectId, ref: 'RepairTicket', default: null, index: true },

    status: { type: String, enum: WARRANTY_CLAIM_STATUSES, default: 'open', index: true },
    coverage: { type: String, enum: WARRANTY_COVERAGE, default: 'both' },
    reportedAt: { type: Date, default: Date.now, index: true },
    /** عدد الأيام من التسليم حتى العودة */
    daysSinceDelivery: { type: Number, default: 0, min: 0 },

    symptom: { type: String, required: true },
    isSameFault: { type: Boolean, default: true },
    faultCategory: { type: String, default: '', index: true },
    /** هل العطل بسبب سوء استخدام/كسر/سوائل؟ */
    misuseSuspected: { type: Boolean, default: false },
    physicalDamageFound: { type: Boolean, default: false },
    liquidDamageFound: { type: Boolean, default: false },
    thirdPartyIntervention: { type: Boolean, default: false },

    /** القرار */
    decisionNotes: { type: String, default: '' },
    rejectedReason: { type: String, default: '' },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },

    /** الإصلاح التعويضي */
    repairCostEgp: { type: Number, default: 0, min: 0 },
    chargedToCustomerEgp: { type: Number, default: 0, min: 0 },
    chargedToSupplierEgp: { type: Number, default: 0, min: 0 },
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', default: null },
    /** هل تحمّل المورد تكلفة القطعة؟ */
    supplierClaimStatus: {
      type: String,
      enum: ['not_applicable', 'requested', 'accepted', 'rejected'],
      default: 'not_applicable',
    },
    replacementRepairPartId: { type: Schema.Types.ObjectId, ref: 'RepairPart', default: null },
    resolutionNotes: { type: String, default: '' },
    resolvedAt: { type: Date, default: null },

    evidenceFileIds: { type: [{ type: Schema.Types.ObjectId, ref: 'StoredFile' }], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

warrantyClaimSchema.plugin(tenantPlugin);
warrantyClaimSchema.index({ organizationId: 1, claimNumber: 1 }, { unique: true });
warrantyClaimSchema.index({ organizationId: 1, status: 1, reportedAt: -1 });
warrantyClaimSchema.index({ organizationId: 1, originalRepairPartIds: 1 });
warrantyClaimSchema.index({ organizationId: 1, originalTechnicianId: 1, reportedAt: -1 });
warrantyClaimSchema.index({ organizationId: 1, faultCategory: 1, isSameFault: 1 });

export type WarrantyClaim = InferSchemaType<typeof warrantyClaimSchema>;
export type WarrantyClaimDoc = HydratedDocument<WarrantyClaim>;

export const WarrantyClaimModel = model('WarrantyClaim', warrantyClaimSchema);
export default WarrantyClaimModel;
