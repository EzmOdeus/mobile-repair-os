import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { tenantPlugin } from './plugins/tenantPlugin.js';

/**
 * ملاحظات الفني/الاستقبال على التذكرة (Repair Notes).
 * منفصلة عن الـTimeline لأنها محتوى قابل للتحرير والبحث.
 */
const repairNoteSchema = new Schema(
  {
    // --- عزل المستأجر (tenant isolation) - تُفرض في tenantPlugin ---
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true, immutable: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    ticketId: { type: Schema.Types.ObjectId, ref: 'RepairTicket', required: true, index: true },
    deviceId: { type: Schema.Types.ObjectId, ref: 'Device', default: null },
    body: { type: String, required: true },
    visibility: { type: String, enum: ['internal', 'customer'], default: 'internal', index: true },
    category: {
      type: String,
      enum: ['general', 'diagnosis', 'repair_step', 'parts', 'customer_communication', 'qc', 'warning'],
      default: 'general',
    },
    attachments: { type: [{ type: Schema.Types.ObjectId, ref: 'StoredFile' }], default: [] },
    minutesSpent: { type: Number, default: 0, min: 0 },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    authorName: { type: String, default: '' },
    isPinned: { type: Boolean, default: false },
  },
  { timestamps: true },
);

repairNoteSchema.plugin(tenantPlugin);
repairNoteSchema.index({ organizationId: 1, ticketId: 1, createdAt: -1 });
repairNoteSchema.index({ body: 'text' });

export type RepairNote = InferSchemaType<typeof repairNoteSchema>;
export type RepairNoteDoc = HydratedDocument<RepairNote>;

export const RepairNoteModel = model('RepairNote', repairNoteSchema);
export default RepairNoteModel;
