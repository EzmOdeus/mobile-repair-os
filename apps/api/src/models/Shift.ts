import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { tenantPlugin } from './plugins/tenantPlugin.js';

export const SHIFT_STATUSES = ['open', 'closed'] as const;

/** لقطة مجاميع الوردية عند الإغلاق — لا تتأثر بأي تعديل لاحق على الدفعات/المصروفات */
const shiftTotalsSchema = new Schema(
  {
    cashInEgp: { type: Number, default: 0 },
    cashOutEgp: { type: Number, default: 0 },
    cashExpensesEgp: { type: Number, default: 0 },
    nonCashInEgp: { type: Number, default: 0 },
    nonCashOutEgp: { type: Number, default: 0 },
    nonCashExpensesEgp: { type: Number, default: 0 },
    paymentCount: { type: Number, default: 0 },
    expenseCount: { type: Number, default: 0 },
  },
  { _id: false },
);

/**
 * الوردية = خزينة فرع مفتوحة لفترة عمل.
 * الحركات المالية (دفعات/مصروفات) تُربط بالوردية المفتوحة للفرع وقت إنشائها،
 * ومنها يُحسب النقد المتوقع في الدرج لحظة الإغلاق.
 */
const shiftSchema = new Schema(
  {
    // --- عزل المستأجر (tenant isolation) - تُفرض في tenantPlugin ---
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true, immutable: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    shiftNumber: { type: String, required: true, trim: true },
    status: { type: String, enum: SHIFT_STATUSES, default: 'open', index: true },

    openedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    openedAt: { type: Date, default: Date.now, index: true },
    openingCashEgp: { type: Number, default: 0, min: 0 },
    openingNotes: { type: String, default: '' },

    closedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    closedAt: { type: Date, default: null },
    countedCashEgp: { type: Number, default: null, min: 0 },
    expectedCashEgp: { type: Number, default: null },
    /** الموجب زيادة في الدرج، والسالب عجز */
    varianceEgp: { type: Number, default: null },
    closeNotes: { type: String, default: '' },

    totals: { type: shiftTotalsSchema, default: () => ({}) },
  },
  { timestamps: true },
);

shiftSchema.plugin(tenantPlugin);
shiftSchema.index({ organizationId: 1, shiftNumber: 1 }, { unique: true });
/**
 * وردية مفتوحة واحدة فقط لكل فرع. الفهرس الجزئي هو الضمان الذري الوحيد
 * على MongoDB standalone (لا معاملات): طلبان متزامنان لفتح وردية لن ينجحا معًا.
 */
shiftSchema.index(
  { organizationId: 1, branchId: 1 },
  { unique: true, partialFilterExpression: { status: 'open' } },
);
shiftSchema.index({ organizationId: 1, branchId: 1, openedAt: -1 });

export type Shift = InferSchemaType<typeof shiftSchema>;
export type ShiftDoc = HydratedDocument<Shift>;

export const ShiftModel = model('Shift', shiftSchema);
export default ShiftModel;
