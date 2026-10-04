import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { tenantPlugin } from './plugins/tenantPlugin.js';

export const REPAIR_PART_STATUS = ['reserved', 'installed', 'removed', 'returned', 'defective'] as const;
export type RepairPartStatus = (typeof REPAIR_PART_STATUS)[number];

/**
 * RepairPart: القطعة المستخدمة فعليًا في تذكرة صيانة.
 * الربط بين التذكرة والقطعة والدفعة والمورد هو ما يجعل Warranty/Parts Intelligence ممكنًا.
 */
const repairPartSchema = new Schema(
  {
    // --- عزل المستأجر (tenant isolation) - تُفرض في tenantPlugin ---
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true, immutable: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    ticketId: { type: Schema.Types.ObjectId, ref: 'RepairTicket', required: true, index: true },
    deviceId: { type: Schema.Types.ObjectId, ref: 'Device', default: null, index: true },
    partId: { type: Schema.Types.ObjectId, ref: 'Part', required: true, index: true },
    batchId: { type: Schema.Types.ObjectId, ref: 'StockBatch', default: null, index: true },
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', default: null, index: true },
    quantity: { type: Number, required: true, min: 1, default: 1 },
    status: { type: String, enum: REPAIR_PART_STATUS, default: 'reserved', index: true },

    unitCostEgp: { type: Number, default: 0, min: 0 },
    unitPriceEgp: { type: Number, default: 0, min: 0 },
    totalCostEgp: { type: Number, default: 0, min: 0 },
    totalPriceEgp: { type: Number, default: 0, min: 0 },
    grade: { type: String, default: 'unknown' },

    /** ضمان القطعة المقدَّم للعميل */
    warrantyDays: { type: Number, default: 0, min: 0 },
    warrantyExpiresAt: { type: Date, default: null, index: true },

    installedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    installedAt: { type: Date, default: null },
    removedAt: { type: Date, default: null },
    /** هل رجعت القطعة معيبة في claim ضمان؟ */
    failedAt: { type: Date, default: null },
    failureReason: { type: String, default: '' },
    isWarrantyReplacement: { type: Boolean, default: false },
    replacedByRepairPartId: { type: Schema.Types.ObjectId, ref: 'RepairPart', default: null },

    notes: { type: String, default: '' },
    addedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

repairPartSchema.plugin(tenantPlugin);
repairPartSchema.index({ organizationId: 1, ticketId: 1, status: 1 });
repairPartSchema.index({ organizationId: 1, partId: 1, installedAt: -1 });
repairPartSchema.index({ organizationId: 1, batchId: 1, status: 1 });
repairPartSchema.index({ organizationId: 1, warrantyExpiresAt: 1 });

export type RepairPart = InferSchemaType<typeof repairPartSchema>;
export type RepairPartDoc = HydratedDocument<RepairPart>;

export const RepairPartModel = model('RepairPart', repairPartSchema);
export default RepairPartModel;
