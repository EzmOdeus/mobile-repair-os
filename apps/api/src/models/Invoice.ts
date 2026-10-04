import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { tenantPlugin } from './plugins/tenantPlugin.js';

export const INVOICE_TYPES = ['repair', 'pos_sale', 'accessory', 'service', 'warranty_replacement'] as const;
export const INVOICE_STATUSES = ['draft', 'issued', 'partially_paid', 'paid', 'void', 'refunded'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_STATUS_LABELS_AR: Record<InvoiceStatus, string> = {
  draft: 'مسودة',
  issued: 'صادرة',
  partially_paid: 'مدفوعة جزئيًا',
  paid: 'مدفوعة',
  void: 'ملغاة',
  refunded: 'مرتجعة',
};

const invoiceLineSchema = new Schema(
  {
    kind: { type: String, enum: ['part', 'labor', 'accessory', 'service'], required: true },
    refId: { type: Schema.Types.ObjectId, default: null },
    description: { type: String, required: true },
    quantity: { type: Number, default: 1, min: 0 },
    unitPriceEgp: { type: Number, default: 0, min: 0 },
    totalEgp: { type: Number, default: 0, min: 0 },
    warrantyDays: { type: Number, default: 0, min: 0 },
  },
  { _id: true },
);

const invoiceTotalsSchema = new Schema(
  {
    subtotalEgp: { type: Number, default: 0, min: 0 },
    discountEgp: { type: Number, default: 0, min: 0 },
    taxRatePct: { type: Number, default: 14, min: 0, max: 100 },
    taxEgp: { type: Number, default: 0, min: 0 },
    totalEgp: { type: Number, default: 0, min: 0 },
    paidEgp: { type: Number, default: 0, min: 0 },
    dueEgp: { type: Number, default: 0, min: 0 },
    changeEgp: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

/**
 * Invoice: الفاتورة. قد تكون لتذكرة صيانة أو بيع مباشر من نقاط البيع.
 */
const invoiceSchema = new Schema(
  {
    // --- عزل المستأجر (tenant isolation) - تُفرض في tenantPlugin ---
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true, immutable: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    invoiceNumber: { type: String, required: true, trim: true },
    type: { type: String, enum: INVOICE_TYPES, default: 'repair', index: true },
    status: { type: String, enum: INVOICE_STATUSES, default: 'draft', index: true },

    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', default: null, index: true },
    deviceId: { type: Schema.Types.ObjectId, ref: 'Device', default: null },
    ticketId: { type: Schema.Types.ObjectId, ref: 'RepairTicket', default: null, index: true },
    warrantyClaimId: { type: Schema.Types.ObjectId, ref: 'WarrantyClaim', default: null },

    lines: { type: [invoiceLineSchema], default: [] },
    totals: { type: invoiceTotalsSchema, default: () => ({}) },

    issuedAt: { type: Date, default: null, index: true },
    dueAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
    voidedAt: { type: Date, default: null },
    voidReason: { type: String, default: '' },

    notes: { type: String, default: '' },
    customerNotes: { type: String, default: '' },
    pdfFileId: { type: Schema.Types.ObjectId, ref: 'StoredFile', default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    cashierId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

invoiceSchema.plugin(tenantPlugin);
invoiceSchema.index({ organizationId: 1, invoiceNumber: 1 }, { unique: true });
invoiceSchema.index({ organizationId: 1, status: 1, issuedAt: -1 });
invoiceSchema.index({ organizationId: 1, customerId: 1, issuedAt: -1 });
invoiceSchema.index({ organizationId: 1, branchId: 1, issuedAt: -1 });

invoiceSchema.virtual('isFullyPaid').get(function isFullyPaid(this: { totals?: { dueEgp: number } }) {
  return (this.totals?.dueEgp ?? 0) <= 0.009;
});

export type Invoice = InferSchemaType<typeof invoiceSchema>;
export type InvoiceDoc = HydratedDocument<Invoice>;

export const InvoiceModel = model('Invoice', invoiceSchema);
export default InvoiceModel;
