import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { tenantPlugin } from './plugins/tenantPlugin.js';

export const SUBSCRIPTION_PAYMENT_METHODS = ['cash', 'bank_transfer', 'wallet', 'cheque', 'other'] as const;
export type SubscriptionPaymentMethod = (typeof SUBSCRIPTION_PAYMENT_METHODS)[number];

export const SUBSCRIPTION_PAYMENT_METHOD_LABELS_AR: Record<SubscriptionPaymentMethod, string> = {
  cash: 'نقدًا',
  bank_transfer: 'تحويل بنكي',
  wallet: 'محفظة إلكترونية',
  cheque: 'شيك',
  other: 'أخرى',
};

export const SUBSCRIPTION_PAYMENT_SOURCES = ['self_service', 'platform'] as const;
export type SubscriptionPaymentSource = (typeof SUBSCRIPTION_PAYMENT_SOURCES)[number];

/**
 * سجل تحصيلات الاشتراكات — مصدر تقرير الإيرادات.
 *
 * التفعيل الذاتي يسجّل دفعة إلزامية (طريقة + مرجع تحويل) بعد دفع خارج المنصة.
 * إدارة المنصة قد تسجّل دفعة بسعر مخصص (المؤسسية) أو تفعّل دون دفعة (منحة/تجديد إداري).
 */
const subscriptionPaymentSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true, immutable: true },
    plan: { type: String, required: true, trim: true },
    amountEgp: { type: Number, required: true, min: 0 },
    months: { type: Number, required: true, min: 1, max: 36 },
    method: { type: String, enum: SUBSCRIPTION_PAYMENT_METHODS, default: 'other' },
    reference: { type: String, trim: true, default: '' },
    note: { type: String, trim: true, maxlength: 500, default: '' },
    /** فترة التغطية التي اشترتها هذه الدفعة */
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    paidAt: { type: Date, default: Date.now, index: true },
    source: { type: String, enum: SUBSCRIPTION_PAYMENT_SOURCES, required: true },
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    renewalRequestId: { type: Schema.Types.ObjectId, ref: 'SubscriptionRenewalRequest', default: null },
  },
  { timestamps: true },
);

subscriptionPaymentSchema.plugin(tenantPlugin);
subscriptionPaymentSchema.index({ organizationId: 1, paidAt: -1 });
subscriptionPaymentSchema.index({ paidAt: -1, plan: 1 });
subscriptionPaymentSchema.index({ paidAt: -1, method: 1 });

export type SubscriptionPayment = InferSchemaType<typeof subscriptionPaymentSchema>;
export type SubscriptionPaymentDoc = HydratedDocument<SubscriptionPayment>;

export const SubscriptionPaymentModel = model('SubscriptionPayment', subscriptionPaymentSchema);
export default SubscriptionPaymentModel;
