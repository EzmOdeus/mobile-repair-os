import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { tenantPlugin } from './plugins/tenantPlugin.js';

export const BATCH_QUALITY_STATUS = ['unverified', 'good', 'suspect', 'bad', 'returned_to_supplier'] as const;

/**
 * StockBatch: دفعة توريد قطعة من مورد.
 * الهدف: معرفة معدل فشل القطعة حسب المورد والدفعة والموديل (Parts Intelligence)،
 * وليس فقط معرفة كمية المخزون.
 */
const stockBatchSchema = new Schema(
  {
    // --- عزل المستأجر (tenant isolation) - تُفرض في tenantPlugin ---
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true, immutable: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    partId: { type: Schema.Types.ObjectId, ref: 'Part', required: true, index: true },
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', default: null, index: true },
    batchCode: { type: String, required: true, trim: true },
    invoiceNumber: { type: String, trim: true, default: '' },
    purchaseInvoiceFileId: { type: Schema.Types.ObjectId, ref: 'StoredFile', default: null },
    receivedAt: { type: Date, default: Date.now, index: true },
    receivedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    unitCostEgp: { type: Number, required: true, min: 0 },
    quantityReceived: { type: Number, required: true, min: 1 },
    quantityAvailable: { type: Number, default: 0, min: 0 },
    quantityUsed: { type: Number, default: 0, min: 0 },
    quantityDefective: { type: Number, default: 0, min: 0 },
    quantityReturned: { type: Number, default: 0, min: 0 },
    /** نسخة من درجة القطعة وقت التوريد */
    grade: { type: String, default: 'unknown' },
    warrantyDays: { type: Number, default: 0, min: 0 },
    warrantyExpiresAt: { type: Date, default: null },
    qualityStatus: { type: String, enum: BATCH_QUALITY_STATUS, default: 'unverified', index: true },
    /** مؤشرات الفشل على مستوى الدفعة */
    failureStats: {
      unitsFailed: { type: Number, default: 0, min: 0 },
      avgFailureAfterDays: { type: Number, default: 0, min: 0 },
      notes: { type: String, default: '' },
    },
    notes: { type: String, default: '' },
  },
  { timestamps: true },
);

stockBatchSchema.plugin(tenantPlugin);
stockBatchSchema.index({ organizationId: 1, partId: 1, batchCode: 1 }, { unique: true });
stockBatchSchema.index({ organizationId: 1, supplierId: 1, receivedAt: -1 });

stockBatchSchema.virtual('failureRatePct').get(function failureRatePct(this: {
  quantityUsed: number;
  failureStats?: { unitsFailed: number };
}) {
  const used = this.quantityUsed ?? 0;
  if (!used) return 0;
  return Number((((this.failureStats?.unitsFailed ?? 0) / used) * 100).toFixed(2));
});

export type StockBatch = InferSchemaType<typeof stockBatchSchema>;
export type StockBatchDoc = HydratedDocument<StockBatch>;

export const StockBatchModel = model('StockBatch', stockBatchSchema);
export default StockBatchModel;
