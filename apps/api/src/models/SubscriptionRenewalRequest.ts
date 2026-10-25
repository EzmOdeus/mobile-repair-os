import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { tenantPlugin } from './plugins/tenantPlugin.js';
import { SUBSCRIPTION_PAYMENT_METHODS } from './SubscriptionPayment.js';

export const SUBSCRIPTION_RENEWAL_REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export type SubscriptionRenewalRequestStatus = (typeof SUBSCRIPTION_RENEWAL_REQUEST_STATUSES)[number];

/**
 * طلب تجديد يرسله مالك المركز (متاح حتى أثناء وضع القراءة فقط).
 * يستخدمه صاحب الباقة المؤسسية أو من يريد تسعيرًا/مساعدة من إدارة المنصة،
 * وتُسجَّل نتيجة اعتماده كدفعة في سجل SubscriptionPayment.
 */
const subscriptionRenewalRequestSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, immutable: true },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    plan: { type: String, required: true, trim: true },
    months: { type: Number, required: true, min: 1, max: 36 },
    paymentMethod: { type: String, enum: SUBSCRIPTION_PAYMENT_METHODS, default: 'bank_transfer' },
    paymentReference: { type: String, trim: true, maxlength: 100, default: '' },
    note: { type: String, trim: true, maxlength: 500, default: '' },
    status: {
      type: String,
      enum: SUBSCRIPTION_RENEWAL_REQUEST_STATUSES,
      default: 'pending',
      index: true,
    },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, trim: true, maxlength: 500, default: '' },
    resultingPaymentId: { type: Schema.Types.ObjectId, ref: 'SubscriptionPayment', default: null },
  },
  { timestamps: true },
);

subscriptionRenewalRequestSchema.plugin(tenantPlugin);
subscriptionRenewalRequestSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
subscriptionRenewalRequestSchema.index({ status: 1, createdAt: 1 });
/** طلب معلّق واحد لكل مؤسسة — يمنع تكرار الطلبات وازدواج المعالجة */
subscriptionRenewalRequestSchema.index(
  { organizationId: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } },
);

export type SubscriptionRenewalRequest = InferSchemaType<typeof subscriptionRenewalRequestSchema>;
export type SubscriptionRenewalRequestDoc = HydratedDocument<SubscriptionRenewalRequest>;

export const SubscriptionRenewalRequestModel = model(
  'SubscriptionRenewalRequest',
  subscriptionRenewalRequestSchema,
);
export default SubscriptionRenewalRequestModel;
