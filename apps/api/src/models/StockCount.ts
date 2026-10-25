import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { tenantPlugin } from './plugins/tenantPlugin.js';

export const STOCK_COUNT_STATUSES = ['completed', 'cancelled'] as const;
export type StockCountStatus = (typeof STOCK_COUNT_STATUSES)[number];

const stockCountLineSchema = new Schema(
  {
    partId: { type: Schema.Types.ObjectId, ref: 'Part', required: true },
    snapshotOnHand: { type: Number, required: true, min: 0 },
    countedOnHand: { type: Number, required: true, min: 0 },
    difference: { type: Number, required: true },
    unitCostEgp: { type: Number, default: 0, min: 0 },
    differenceValueEgp: { type: Number, default: 0 },
    note: { type: String, trim: true, default: '' },
  },
  { _id: true },
);

/**
 * محضر جرد فعلي لفرع واحد. الحفظ ينشئ حركات تسوية فعلية لكل فرق،
 * ويحفظ صورة الرصيد وقت الجرد للتدقيق لاحقًا.
 */
const stockCountSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true, immutable: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    countNumber: { type: String, required: true, trim: true },
    status: { type: String, enum: STOCK_COUNT_STATUSES, default: 'completed', index: true },
    lines: { type: [stockCountLineSchema], default: [] },
    totals: {
      itemsCounted: { type: Number, default: 0, min: 0 },
      discrepancies: { type: Number, default: 0, min: 0 },
      netDifferenceEgp: { type: Number, default: 0 },
    },
    notes: { type: String, trim: true, default: '' },
    countedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    countedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true },
);

stockCountSchema.plugin(tenantPlugin);
stockCountSchema.index({ organizationId: 1, countNumber: 1 }, { unique: true });
stockCountSchema.index({ organizationId: 1, branchId: 1, countedAt: -1 });

export type StockCount = InferSchemaType<typeof stockCountSchema>;
export type StockCountDoc = HydratedDocument<StockCount>;

export const StockCountModel = model('StockCount', stockCountSchema);
export default StockCountModel;
