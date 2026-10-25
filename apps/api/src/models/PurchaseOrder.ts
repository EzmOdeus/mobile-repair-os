import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { tenantPlugin } from './plugins/tenantPlugin.js';

export const PURCHASE_ORDER_STATUSES = [
  'draft',
  'ordered',
  'partially_received',
  'received',
  'cancelled',
] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

export const PURCHASE_ORDER_STATUS_LABELS_AR: Record<PurchaseOrderStatus, string> = {
  draft: 'مسودة',
  ordered: 'تم الطلب',
  partially_received: 'مستلم جزئيًا',
  received: 'مستلم بالكامل',
  cancelled: 'ملغى',
};

const purchaseOrderLineSchema = new Schema(
  {
    partId: { type: Schema.Types.ObjectId, ref: 'Part', required: true },
    description: { type: String, trim: true, default: '' },
    quantityOrdered: { type: Number, required: true, min: 1 },
    quantityReceived: { type: Number, default: 0, min: 0 },
    unitCostEgp: { type: Number, required: true, min: 0 },
    totalEgp: { type: Number, required: true, min: 0 },
    warrantyDays: { type: Number, default: 0, min: 0 },
    notes: { type: String, trim: true, default: '' },
  },
  { _id: true },
);

const purchaseOrderTotalsSchema = new Schema(
  {
    subtotalEgp: { type: Number, default: 0, min: 0 },
    discountEgp: { type: Number, default: 0, min: 0 },
    taxRatePct: { type: Number, default: 0, min: 0, max: 100 },
    taxEgp: { type: Number, default: 0, min: 0 },
    totalEgp: { type: Number, default: 0, min: 0 },
    paidEgp: { type: Number, default: 0, min: 0 },
    dueEgp: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

/**
 * أمر شراء لمورد: دورة كاملة من الطلب إلى الاستلام الجزئي/الكامل.
 * عند الطلب تُحتسب الكميات «incoming»، وعند الاستلام تتحول إلى رصيد فعلي.
 */
const purchaseOrderSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true, immutable: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    poNumber: { type: String, required: true, trim: true },
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true, index: true },
    status: { type: String, enum: PURCHASE_ORDER_STATUSES, default: 'draft', index: true },
    supplierInvoiceNumber: { type: String, trim: true, default: '' },
    supplierInvoiceDate: { type: Date, default: null },
    expectedAt: { type: Date, default: null },
    orderedAt: { type: Date, default: null },
    receivedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, trim: true, default: '' },
    lines: { type: [purchaseOrderLineSchema], default: [] },
    totals: { type: purchaseOrderTotalsSchema, default: () => ({}) },
    notes: { type: String, trim: true, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    orderedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    receivedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

purchaseOrderSchema.plugin(tenantPlugin);
purchaseOrderSchema.index({ organizationId: 1, poNumber: 1 }, { unique: true });
purchaseOrderSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
purchaseOrderSchema.index({ organizationId: 1, supplierId: 1, createdAt: -1 });
purchaseOrderSchema.index({ organizationId: 1, branchId: 1, createdAt: -1 });

purchaseOrderSchema.virtual('paymentStatus').get(function paymentStatus(this: {
  totals?: { totalEgp: number; paidEgp: number; dueEgp: number };
}) {
  const totals = this.totals;
  if (!totals || totals.totalEgp <= 0.009) return 'unpaid';
  if ((totals.dueEgp ?? 0) <= 0.009) return 'paid';
  if ((totals.paidEgp ?? 0) > 0.009) return 'partially_paid';
  return 'unpaid';
});

export type PurchaseOrder = InferSchemaType<typeof purchaseOrderSchema>;
export type PurchaseOrderDoc = HydratedDocument<PurchaseOrder>;

export const PurchaseOrderModel = model('PurchaseOrder', purchaseOrderSchema);
export default PurchaseOrderModel;
