import { Schema, model, type InferSchemaType, type HydratedDocument, type Model } from 'mongoose';
import { tenantPlugin } from './plugins/tenantPlugin.js';

export const APPROVAL_DECISIONS = ['approved', 'partially_approved', 'rejected', 'no_response'] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

export const APPROVAL_CHANNELS = ['in_person', 'phone', 'whatsapp', 'sms', 'portal', 'email'] as const;

/**
 * Approval: توثيق موافقة/رفض العميل لعرض سعر.
 * Digital Customer Approval - عنصر تمييزي في المنصة، ويُستخدم كدليل عند النزاع.
 */
const approvalSchema = new Schema(
  {
    // --- عزل المستأجر (tenant isolation) - تُفرض في tenantPlugin ---
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true, immutable: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    ticketId: { type: Schema.Types.ObjectId, ref: 'RepairTicket', required: true, index: true },
    estimateId: { type: Schema.Types.ObjectId, ref: 'Estimate', required: true, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', default: null, index: true },
    decision: { type: String, enum: APPROVAL_DECISIONS, required: true, index: true },
    channel: { type: String, enum: APPROVAL_CHANNELS, default: 'in_person' },
    approvedLineIds: { type: [String], default: [] },
    approvedAmountEgp: { type: Number, default: 0, min: 0 },
    rejectionReason: { type: String, default: '' },
    customerComment: { type: String, default: '' },
    /** إثبات الموافقة */
    signatureFileId: { type: Schema.Types.ObjectId, ref: 'StoredFile', default: null },
    voiceNoteFileId: { type: Schema.Types.ObjectId, ref: 'StoredFile', default: null },
    whatsappMessageId: { type: String, default: '' },
    /** بيانات التحقق */
    customerPhone: { type: String, default: '' },
    otpVerified: { type: Boolean, default: false },
    ipAddress: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true },
);

approvalSchema.plugin(tenantPlugin);
approvalSchema.index({ organizationId: 1, ticketId: 1, decidedAt: -1 });
approvalSchema.index({ organizationId: 1, decision: 1, decidedAt: -1 });

export type Approval = InferSchemaType<typeof approvalSchema>;
export type ApprovalDoc = HydratedDocument<Approval>;

export const ApprovalModel: Model<Approval> = model('Approval', approvalSchema);
export default ApprovalModel;
