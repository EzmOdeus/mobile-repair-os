import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { tenantPlugin } from './plugins/tenantPlugin.js';

/**
 * رصيد القطعة داخل فرع معيّن (InventoryItem).
 * Part = التعريف/الكتالوج، InventoryItem = الرصيد الفعلي لكل فرع.
 */
const inventoryItemSchema = new Schema(
  {
    // --- عزل المستأجر (tenant isolation) - تُفرض في tenantPlugin ---
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true, immutable: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    partId: { type: Schema.Types.ObjectId, ref: 'Part', required: true, index: true },
    quantity: {
      /** إجمالي الموجود فعليًا في الفرع */
      onHand: { type: Number, default: 0, min: 0 },
      /** محجوز لتذاكر مفتوحة */
      reserved: { type: Number, default: 0, min: 0 },
      /** تالف/معيب بانتظار الإرجاع للمورد */
      defective: { type: Number, default: 0, min: 0 },
      /** في الطريق إلى الفرع (طلب شراء) */
      incoming: { type: Number, default: 0, min: 0 },
    },
    binLocation: { type: String, trim: true, default: '' },
    lastCountedAt: { type: Date, default: null },
    lastMovementAt: { type: Date, default: null, index: true },
    reorderLevel: { type: Number, default: 2, min: 0 },
    reorderQty: { type: Number, default: 5, min: 0 },
    avgCostEgp: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

inventoryItemSchema.plugin(tenantPlugin);

inventoryItemSchema.index({ organizationId: 1, branchId: 1, partId: 1 }, { unique: true });
inventoryItemSchema.index({ organizationId: 1, branchId: 1, 'quantity.onHand': 1 });

inventoryItemSchema.virtual('available').get(function available(this: {
  quantity?: { onHand: number; reserved: number };
}) {
  const q = this.quantity;
  if (!q) return 0;
  return Math.max(0, (q.onHand ?? 0) - (q.reserved ?? 0));
});

inventoryItemSchema.virtual('needsReorder').get(function needsReorder(this: {
  quantity?: { onHand: number; reserved: number };
  reorderLevel: number;
}) {
  const q = this.quantity;
  if (!q) return false;
  return Math.max(0, (q.onHand ?? 0) - (q.reserved ?? 0)) <= this.reorderLevel;
});

export type InventoryItem = InferSchemaType<typeof inventoryItemSchema>;
export type InventoryItemDoc = HydratedDocument<InventoryItem>;

export const InventoryItemModel = model('InventoryItem', inventoryItemSchema);
export default InventoryItemModel;
