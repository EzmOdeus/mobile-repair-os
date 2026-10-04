import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { REPAIR_STATUSES, TIMELINE_EVENT_TYPES } from '../constants/repair.js';
import { tenantPlugin } from './plugins/tenantPlugin.js';

/**
 * Repair Timeline / Chain of Custody
 * سجل غير قابل للتعديل: كل انتقال حالة أو حدث مهم على التذكرة.
 */
const repairStatusHistorySchema = new Schema(
  {
    // --- عزل المستأجر (tenant isolation) - تُفرض في tenantPlugin ---
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true, immutable: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    ticketId: { type: Schema.Types.ObjectId, ref: 'RepairTicket', required: true, index: true },
    deviceId: { type: Schema.Types.ObjectId, ref: 'Device', default: null, index: true },
    fromStatus: { type: String, enum: [...REPAIR_STATUSES, null], default: null },
    toStatus: { type: String, enum: REPAIR_STATUSES, required: true },
    eventType: { type: String, enum: TIMELINE_EVENT_TYPES, default: 'status_changed', index: true },
    note: { type: String, default: '' },
    /** من نفّذ العملية (Chain of Custody) */
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    actorName: { type: String, default: '' },
    actorRole: { type: String, default: '' },
    technicianId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    /** المدة التي قضاها الجهاز في الحالة السابقة */
    durationMinutes: { type: Number, default: 0 },
    metadata: { type: Schema.Types.Mixed, default: {} },
    /** workbench / station داخل المركز */
    station: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

repairStatusHistorySchema.plugin(tenantPlugin);
repairStatusHistorySchema.index({ organizationId: 1, ticketId: 1, createdAt: -1 });
repairStatusHistorySchema.index({ organizationId: 1, createdAt: -1, eventType: 1 });

export type RepairStatusHistory = InferSchemaType<typeof repairStatusHistorySchema>;
export type RepairStatusHistoryDoc = HydratedDocument<RepairStatusHistory>;

export const RepairStatusHistoryModel = model('RepairStatusHistory', repairStatusHistorySchema);
export default RepairStatusHistoryModel;
