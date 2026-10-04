import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { tenantPlugin } from './plugins/tenantPlugin.js';

export const TRANSFER_STATUSES = ['draft', 'requested', 'approved', 'in_transit', 'received', 'cancelled'] as const;

/** نقل مخزون بين الفروع (Transfer) */
const stockTransferSchema = new Schema(
  {
    // --- عزل المستأجر (tenant isolation) - تُفرض في tenantPlugin ---
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true, immutable: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    transferNumber: { type: String, required: true, trim: true },
    fromBranchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    toBranchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    status: { type: String, enum: TRANSFER_STATUSES, default: 'draft', index: true },
    lines: {
      type: [
        new Schema(
          {
            partId: { type: Schema.Types.ObjectId, ref: 'Part', required: true },
            batchId: { type: Schema.Types.ObjectId, ref: 'StockBatch', default: null },
            quantityRequested: { type: Number, required: true, min: 1 },
            quantitySent: { type: Number, default: 0, min: 0 },
            quantityReceived: { type: Number, default: 0, min: 0 },
            unitCostEgp: { type: Number, default: 0, min: 0 },
            notes: { type: String, default: '' },
          },
          { _id: true },
        ),
      ],
      default: [],
    },
    reason: { type: String, default: '' },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    shippedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    receivedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    requestedAt: { type: Date, default: Date.now },
    shippedAt: { type: Date, default: null },
    receivedAt: { type: Date, default: null },
    notes: { type: String, default: '' },
  },
  { timestamps: true },
);

stockTransferSchema.plugin(tenantPlugin);
stockTransferSchema.index({ organizationId: 1, transferNumber: 1 }, { unique: true });
stockTransferSchema.index({ organizationId: 1, status: 1, createdAt: -1 });

export type StockTransfer = InferSchemaType<typeof stockTransferSchema>;
export type StockTransferDoc = HydratedDocument<StockTransfer>;

export const StockTransferModel = model('StockTransfer', stockTransferSchema);
export default StockTransferModel;
