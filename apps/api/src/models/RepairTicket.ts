import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import {
  REPAIR_STATUSES,
  TICKET_PRIORITIES,
  REPAIR_OUTCOMES,
} from '../constants/repair.js';
import { tenantPlugin } from './plugins/tenantPlugin.js';

const checklistItemSchema = new Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    labelAr: { type: String, default: '' },
    status: {
      type: String,
      enum: ['pending', 'pass', 'fail', 'not_applicable'],
      default: 'pending',
    },
    notes: { type: String, default: '' },
    checkedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    checkedAt: { type: Date, default: null },
    photoFileId: { type: Schema.Types.ObjectId, ref: 'StoredFile', default: null },
  },
  { _id: false },
);

const intakeSchema = new Schema(
  {
    receivedAt: { type: Date, default: Date.now },
    receivedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    /** شكوى العميل بكلماته */
    complaint: { type: String, required: true, default: '' },
    complaintCategory: { type: String, default: '', index: true },
    /** الفحص الظاهري عند الاستلام */
    visualCondition: {
      screenCracked: { type: Boolean, default: false },
      backGlassBroken: { type: Boolean, default: false },
      frameDented: { type: Boolean, default: false },
      waterDamageSigns: { type: Boolean, default: false },
      buttonsWorking: { type: Boolean, default: true },
      chargingPortCondition: { type: String, default: 'unknown' },
      cameraCondition: { type: String, default: 'unknown' },
    },
    /** sim_tray, memory_card, cover, charger, box */
    accessories: { type: [String], default: [] },
    /** إقرار العميل على الحالة وشروط الإصلاح */
    customerAcknowledged: { type: Boolean, default: false },
    acknowledgedAt: { type: Date, default: null },
    acknowledgmentSignatureFileId: { type: Schema.Types.ObjectId, ref: 'StoredFile', default: null },
    /** إقرار بعدم مسؤولية المركز عن بيانات الجهاز */
    dataLossDisclaimerAccepted: { type: Boolean, default: false },
    devicePasswordProvided: { type: Boolean, default: false },
    /** اختبارات سريعة عند الاستلام */
    initialTests: { type: [checklistItemSchema], default: [] },
    estimatedDeliveryAt: { type: Date, default: null },
    internalNotes: { type: String, default: '' },
  },
  { _id: false },
);

const diagnosisSchema = new Schema(
  {
    summary: { type: String, default: '' },
    faultCategory: { type: String, default: '', index: true },
    faultSeverity: { type: String, enum: ['minor', 'moderate', 'major', 'critical'], default: 'moderate' },
    rootCause: { type: String, default: '' },
    requiredActions: { type: [String], default: [] },
    needsParts: { type: Boolean, default: false },
    isBoardLevel: { type: Boolean, default: false },
    diagnosisNotes: { type: String, default: '' },
    diagnosedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    diagnosedAt: { type: Date, default: null },
    /** دقة التشخيص - تُستخدم لاحقًا في تحليلات نجاح التشخيص */
    confidence: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  },
  { _id: false },
);

const slaSchema = new Schema(
  {
    dueAt: { type: Date, default: null, index: true },
    breached: { type: Boolean, default: false, index: true },
    breachedAt: { type: Date, default: null },
    pausedAt: { type: Date, default: null },
    pausedMinutes: { type: Number, default: 0 },
  },
  { _id: false },
);

const costSchema = new Schema(
  {
    laborQuotedEgp: { type: Number, default: 0, min: 0 },
    laborActualEgp: { type: Number, default: 0, min: 0 },
    partsQuotedEgp: { type: Number, default: 0, min: 0 },
    partsActualEgp: { type: Number, default: 0, min: 0 },
    discountEgp: { type: Number, default: 0, min: 0 },
    taxEgp: { type: Number, default: 0, min: 0 },
    totalQuotedEgp: { type: Number, default: 0, min: 0 },
    totalFinalEgp: { type: Number, default: 0, min: 0 },
    paidEgp: { type: Number, default: 0, min: 0 },
    dueEgp: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const warrantySchema = new Schema(
  {
    policyDays: { type: Number, default: 0, min: 0 },
    partsDays: { type: Number, default: 0, min: 0 },
    laborDays: { type: Number, default: 0, min: 0 },
    startsAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null, index: true },
    terms: { type: String, default: '' },
    isVoid: { type: Boolean, default: false },
    voidReason: { type: String, default: '' },
  },
  { _id: false },
);

const evidenceSchema = new Schema(
  {
    intakePhotoCount: { type: Number, default: 0 },
    repairPhotoCount: { type: Number, default: 0 },
    hasSignature: { type: Boolean, default: false },
    hasQcEvidence: { type: Boolean, default: false },
  },
  { _id: false },
);

const followUpSchema = new Schema(
  {
    lastNotifiedAt: { type: Date, default: null },
    notificationCount: { type: Number, default: 0 },
    reviewRequestedAt: { type: Date, default: null },
    reviewScore: { type: Number, default: null, min: 0, max: 5 },
  },
  { _id: false },
);

const workLogSchema = new Schema(
  {
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, default: null },
    technicianId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    minutes: { type: Number, default: 0 },
    note: { type: String, default: '' },
  },
  { _id: true },
);

const repairTicketSchema = new Schema(
  {
    // --- عزل المستأجر (tenant isolation) - تُفرض في tenantPlugin ---
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true, immutable: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    ticketNumber: { type: String, required: true, trim: true },
    /** رمز عام للتتبع من بوابة العميل بدون تسجيل دخول */
    trackingToken: { type: String, required: true, unique: true, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    deviceId: { type: Schema.Types.ObjectId, ref: 'Device', required: true, index: true },
    status: { type: String, enum: REPAIR_STATUSES, default: 'received', index: true },
    priority: { type: String, enum: TICKET_PRIORITIES, default: 'normal', index: true },
    source: {
      type: String,
      enum: ['walk_in', 'whatsapp', 'phone', 'reseller', 'return_warranty'],
      default: 'walk_in',
    },

    assignedTechnicianId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    assignedAt: { type: Date, default: null },
    assignedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    intake: { type: intakeSchema, default: () => ({}) },
    diagnosis: { type: diagnosisSchema, default: () => ({}) },
    sla: { type: slaSchema, default: () => ({}) },
    cost: { type: costSchema, default: () => ({}) },
    warranty: { type: warrantySchema, default: () => ({}) },
    evidence: { type: evidenceSchema, default: () => ({}) },
    followUp: { type: followUpSchema, default: () => ({}) },
    workLogs: { type: [workLogSchema], default: [] },

    repairingStartedAt: { type: Date, default: null },
    qcStartedAt: { type: Date, default: null },
    readyAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    promisedAt: { type: Date, default: null },

    outcome: { type: String, enum: REPAIR_OUTCOMES, default: 'pending' },
    tags: { type: [String], default: [] },
    internalNotes: { type: String, default: '' },
    customerVisibleNotes: { type: String, default: '' },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    closedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    cancelReason: { type: String, default: '' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

repairTicketSchema.plugin(tenantPlugin);

repairTicketSchema.index({ organizationId: 1, ticketNumber: 1 }, { unique: true });
repairTicketSchema.index({ organizationId: 1, status: 1, priority: -1, createdAt: -1 });
repairTicketSchema.index({ organizationId: 1, assignedTechnicianId: 1, status: 1 });
repairTicketSchema.index({ organizationId: 1, customerId: 1, createdAt: -1 });
repairTicketSchema.index({ organizationId: 1, deviceId: 1, createdAt: -1 });
repairTicketSchema.index({ organizationId: 1, branchId: 1, status: 1 });
repairTicketSchema.index({ ticketNumber: 'text', 'intake.complaint': 'text', 'diagnosis.summary': 'text' });

repairTicketSchema.virtual('isOpen').get(function isOpen(this: { status: string }) {
  return !['delivered', 'cancelled'].includes(this.status);
});

repairTicketSchema.virtual('isWarrantyActive').get(function isWarrantyActive(this: {
  warranty?: { expiresAt?: Date | null; isVoid?: boolean };
}) {
  const w = this.warranty;
  if (!w?.expiresAt || w.isVoid) return false;
  return w.expiresAt.getTime() > Date.now();
});

export type RepairTicket = InferSchemaType<typeof repairTicketSchema>;
export type RepairTicketDoc = HydratedDocument<RepairTicket>;

export const RepairTicketModel = model('RepairTicket', repairTicketSchema);
export default RepairTicketModel;
