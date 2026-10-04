import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { PAYMENT_METHODS } from '../constants/repair.js';
import { tenantPlugin } from './plugins/tenantPlugin.js';

export const PAYMENT_DIRECTIONS = ['in', 'out'] as const;

/** Payment: كل عملية تحصيل أو استرداد */
const paymentSchema = new Schema(
  {
    // --- عزل المستأجر (tenant isolation) - تُفرض في tenantPlugin ---
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true, immutable: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    receiptNumber: { type: String, required: true, trim: true },
    direction: { type: String, enum: PAYMENT_DIRECTIONS, default: 'in', index: true },
    method: { type: String, enum: PAYMENT_METHODS, required: true, index: true },
    amountEgp: { type: Number, required: true, min: 0 },

    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', default: null, index: true },
    ticketId: { type: Schema.Types.ObjectId, ref: 'RepairTicket', default: null, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', default: null, index: true },
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', default: null },

    /** بيانات التحويل الإلكتروني */
    reference: { type: String, default: '' },
    walletNumber: { type: String, default: '' },
    cardLast4: { type: String, default: '' },
    bankName: { type: String, default: '' },
    /** المبلغ المستلم نقدًا والمتبقي للعميل */
    tenderedEgp: { type: Number, default: 0, min: 0 },
    changeEgp: { type: Number, default: 0, min: 0 },

    paidAt: { type: Date, default: Date.now, index: true },
    notes: { type: String, default: '' },
    isRefund: { type: Boolean, default: false },
    refundReason: { type: String, default: '' },
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  },
  { timestamps: true },
);

paymentSchema.plugin(tenantPlugin);
paymentSchema.index({ organizationId: 1, receiptNumber: 1 }, { unique: true });
paymentSchema.index({ organizationId: 1, paidAt: -1, method: 1 });
paymentSchema.index({ organizationId: 1, branchId: 1, paidAt: -1 });
paymentSchema.index({ organizationId: 1, recordedBy: 1, paidAt: -1 });

export type Payment = InferSchemaType<typeof paymentSchema>;
export type PaymentDoc = HydratedDocument<Payment>;

export const PaymentModel = model('Payment', paymentSchema);
export default PaymentModel;
