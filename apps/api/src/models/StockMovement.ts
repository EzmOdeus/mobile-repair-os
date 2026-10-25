import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { tenantPlugin } from './plugins/tenantPlugin.js';

export const STOCK_MOVEMENT_TYPES = [
  'purchase_in',
  'purchase_order',
  'purchase_cancel',
  'sale_out',
  'repair_consume',
  'repair_return',
  'transfer_out',
  'transfer_in',
  'adjustment_in',
  'adjustment_out',
  'defective_out',
  'defective_in',
  'reserve',
  'release',
  'initial',
] as const;

export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export const STOCK_MOVEMENT_LABELS_AR: Record<StockMovementType, string> = {
  purchase_in: 'توريد مشتريات',
  purchase_order: 'طلب شراء (وارد متوقع)',
  purchase_cancel: 'إلغاء توريد متوقع',
  sale_out: 'بيع',
  repair_consume: 'استهلاك في إصلاح',
  repair_return: 'إرجاع من إصلاح',
  transfer_out: 'تحويل صادر',
  transfer_in: 'تحويل وارد',
  adjustment_in: 'تسوية بالزيادة',
  adjustment_out: 'تسوية بالنقص',
  defective_out: 'إخراج تالف',
  defective_in: 'إدخال تالف',
  reserve: 'حجز',
  release: 'فك حجز',
  initial: 'رصيد افتتاحي',
};

/**
 * حركة المخزون: سجل غير قابل للتعديل لكل تغيير في الكميات.
 * أساس دقة المخزون وتقارير الاستهلاك.
 */
const stockMovementSchema = new Schema(
  {
    // --- عزل المستأجر (tenant isolation) - تُفرض في tenantPlugin ---
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true, immutable: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    partId: { type: Schema.Types.ObjectId, ref: 'Part', required: true, index: true },
    type: { type: String, enum: STOCK_MOVEMENT_TYPES, required: true, index: true },
    /** الكمية أو الفرق (موجب/سالب حسب النوع) */
    quantity: { type: Number, required: true },
    /** أثر الحركة على كل دلو */
    effect: {
      onHand: { type: Number, default: 0 },
      reserved: { type: Number, default: 0 },
      defective: { type: Number, default: 0 },
      incoming: { type: Number, default: 0 },
    },
    /** الأرصدة بعد الحركة (للتدقيق) */
    balanceAfter: {
      onHand: { type: Number, default: 0 },
      reserved: { type: Number, default: 0 },
      defective: { type: Number, default: 0 },
      incoming: { type: Number, default: 0 },
    },
    unitCostEgp: { type: Number, default: 0, min: 0 },
    totalCostEgp: { type: Number, default: 0, min: 0 },
    batchId: { type: Schema.Types.ObjectId, ref: 'StockBatch', default: null, index: true },
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', default: null },

    /** الربط بالعمليات */
    ticketId: { type: Schema.Types.ObjectId, ref: 'RepairTicket', default: null, index: true },
    repairPartId: { type: Schema.Types.ObjectId, ref: 'RepairPart', default: null },
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', default: null },
    transferId: { type: Schema.Types.ObjectId, ref: 'StockTransfer', default: null },
    fromBranchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null },
    toBranchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null },

    reason: { type: String, default: '' },
    reference: { type: String, default: '' },
    /** عكس حركة بيع لم تكتمل: تُعلَّم الأصلية حتى لا تُعكس مرتين */
    reversedAt: { type: Date, default: null },
    reversalMovementId: { type: Schema.Types.ObjectId, ref: 'StockMovement', default: null },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    actorName: { type: String, default: '' },
    occurredAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

stockMovementSchema.plugin(tenantPlugin);
stockMovementSchema.index({ organizationId: 1, partId: 1, occurredAt: -1 });
stockMovementSchema.index({ organizationId: 1, branchId: 1, occurredAt: -1 });
stockMovementSchema.index({ organizationId: 1, ticketId: 1 });

export type StockMovement = InferSchemaType<typeof stockMovementSchema>;
export type StockMovementDoc = HydratedDocument<StockMovement>;

export const StockMovementModel = model('StockMovement', stockMovementSchema);
export default StockMovementModel;
