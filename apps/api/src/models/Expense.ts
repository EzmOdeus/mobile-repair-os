import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { PAYMENT_METHODS } from '../constants/repair.js';
import { tenantPlugin } from './plugins/tenantPlugin.js';

export const EXPENSE_CATEGORIES = [
  'rent',
  'salaries',
  'utilities',
  'internet_phone',
  'tools',
  'parts_purchase',
  'marketing',
  'maintenance',
  'transport',
  'taxes',
  'misc',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_CATEGORY_LABELS_AR: Record<ExpenseCategory, string> = {
  rent: 'إيجار',
  salaries: 'رواتب',
  utilities: 'مرافق',
  internet_phone: 'إنترنت وتليفون',
  tools: 'أدوات',
  parts_purchase: 'شراء قطع غيار',
  marketing: 'تسويق',
  maintenance: 'صيانة',
  transport: 'مواصلات',
  taxes: 'ضرائب',
  misc: 'متنوع',
};

/** Expense: المصروفات التشغيلية */
const expenseSchema = new Schema(
  {
    // --- عزل المستأجر (tenant isolation) - تُفرض في tenantPlugin ---
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true, immutable: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    title: { type: String, required: true, trim: true },
    category: { type: String, enum: EXPENSE_CATEGORIES, required: true, index: true },
    amountEgp: { type: Number, required: true, min: 0 },
    method: { type: String, enum: PAYMENT_METHODS, default: 'cash' },
    incurredAt: { type: Date, default: Date.now, index: true },
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', default: null },
    /** ربط اختياري بمصروف شراء قطع */
    relatedInvoiceNumber: { type: String, default: '' },
    attachmentFileId: { type: Schema.Types.ObjectId, ref: 'StoredFile', default: null },
    notes: { type: String, default: '' },
    isRecurring: { type: Boolean, default: false },
    recurrence: { type: String, enum: ['none', 'monthly', 'weekly', 'yearly'], default: 'none' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

expenseSchema.plugin(tenantPlugin);
expenseSchema.index({ organizationId: 1, incurredAt: -1, category: 1 });
expenseSchema.index({ organizationId: 1, branchId: 1, incurredAt: -1 });

export type Expense = InferSchemaType<typeof expenseSchema>;
export type ExpenseDoc = HydratedDocument<Expense>;

export const ExpenseModel = model('Expense', expenseSchema);
export default ExpenseModel;
