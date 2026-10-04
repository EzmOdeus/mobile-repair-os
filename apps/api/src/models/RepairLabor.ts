import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { tenantPlugin } from './plugins/tenantPlugin.js';

/** RepairLabor: بنود المصنعية على التذكرة */
const repairLaborSchema = new Schema(
  {
    // --- عزل المستأجر (tenant isolation) - تُفرض في tenantPlugin ---
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true, immutable: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    ticketId: { type: Schema.Types.ObjectId, ref: 'RepairTicket', required: true, index: true },
    description: { type: String, required: true },
    category: {
      type: String,
      enum: ['diagnosis', 'repair', 'board_level', 'software', 'cleaning', 'assembly', 'testing', 'other'],
      default: 'repair',
    },
    hours: { type: Number, default: 0, min: 0 },
    ratePerHourEgp: { type: Number, default: 0, min: 0 },
    amountEgp: { type: Number, required: true, min: 0 },
    technicianId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    isWarrantyWork: { type: Boolean, default: false },
    addedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    notes: { type: String, default: '' },
  },
  { timestamps: true },
);

repairLaborSchema.plugin(tenantPlugin);
repairLaborSchema.index({ organizationId: 1, ticketId: 1 });
repairLaborSchema.index({ organizationId: 1, technicianId: 1, createdAt: -1 });

export type RepairLabor = InferSchemaType<typeof repairLaborSchema>;
export type RepairLaborDoc = HydratedDocument<RepairLabor>;

export const RepairLaborModel = model('RepairLabor', repairLaborSchema);
export default RepairLaborModel;
