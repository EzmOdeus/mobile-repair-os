import { z } from 'zod';
import { moneySchema, objectIdSchema, trimmedString } from './common.js';

/* -------------------------- العروض والموافقات -------------------------- */

const estimateLineSchema = z.object({
  kind: z.enum(['part', 'labor', 'service']),
  partId: objectIdSchema.nullable().optional(),
  description: trimmedString(2, 200),
  quantity: z.coerce.number().min(0).max(9999).optional().default(1),
  unitPriceEgp: moneySchema,
  warrantyDays: z.coerce.number().int().min(0).max(3650).optional().default(0),
  notes: z.string().trim().max(300).optional().default(''),
});

export const createEstimateSchema = z.object({
  ticketId: objectIdSchema,
  lines: z.array(estimateLineSchema).min(1, 'أضف بندًا واحدًا على الأقل').max(60),
  discountPct: z.coerce.number().min(0).max(100).optional().default(0),
  discountEgp: moneySchema.optional().default(0),
  taxRatePct: z.coerce.number().min(0).max(100).optional(),
  estimatedDurationHours: z.coerce.number().min(0).max(2000).optional().default(0),
  warrantyOfferedDays: z.coerce.number().int().min(0).max(3650).optional().default(0),
  terms: z.string().trim().max(4000).optional().default(''),
  customerNotes: z.string().trim().max(2000).optional().default(''),
  internalNotes: z.string().trim().max(2000).optional().default(''),
  validUntil: z.coerce.date().nullable().optional(),
});

export const updateEstimateSchema = createEstimateSchema.partial().omit({ ticketId: true });

export const sendEstimateSchema = z.object({
  via: z.enum(['whatsapp', 'sms', 'print', 'portal', 'in_person']).optional().default('whatsapp'),
  message: z.string().trim().max(1000).optional(),
});

export const decideEstimateSchema = z.object({
  decision: z.enum(['approved', 'partially_approved', 'rejected', 'no_response']),
  approvedLineIds: z.array(z.string()).optional().default([]),
  channel: z.enum(['in_person', 'phone', 'whatsapp', 'sms', 'portal', 'email']).optional().default('in_person'),
  customerComment: z.string().trim().max(1000).optional().default(''),
  rejectionReason: z.string().trim().max(1000).optional().default(''),
  customerPhone: z.string().trim().max(20).optional().default(''),
  otpVerified: z.boolean().optional().default(false),
});

/* ------------------------ الفواتير والمدفوعات ------------------------ */

export const createInvoiceSchema = z.object({
  type: z.enum(['repair', 'pos_sale', 'accessory', 'service', 'warranty_replacement']).optional().default('repair'),
  customerId: objectIdSchema.nullable().optional(),
  ticketId: objectIdSchema.nullable().optional(),
  /** عند تحديد تذكرة: تُبنى الفاتورة من قطع ومصنعية التذكرة */
  buildFromTicket: z.boolean().optional().default(false),
  lines: z
    .array(
      z.object({
        kind: z.enum(['part', 'labor', 'accessory', 'service', 'discount']),
        refId: objectIdSchema.nullable().optional(),
        description: trimmedString(2, 200),
        quantity: z.coerce.number().min(0).max(9999).optional().default(1),
        unitPriceEgp: moneySchema.optional().default(0),
        warrantyDays: z.coerce.number().int().min(0).max(3650).optional().default(0),
      }),
    )
    .optional()
    .default([]),
  discountEgp: moneySchema.optional().default(0),
  taxRatePct: z.coerce.number().min(0).max(100).optional(),
  notes: z.string().trim().max(1000).optional().default(''),
  customerNotes: z.string().trim().max(1000).optional().default(''),
  issueNow: z.boolean().optional().default(true),
});

export const recordPaymentSchema = z.object({
  invoiceId: objectIdSchema.nullable().optional(),
  ticketId: objectIdSchema.nullable().optional(),
  customerId: objectIdSchema.nullable().optional(),
  method: z.enum(['cash', 'card', 'wallet', 'instapay', 'bank_transfer', 'credit']),
  amountEgp: moneySchema,
  tenderedEgp: moneySchema.optional().default(0),
  reference: z.string().trim().max(80).optional().default(''),
  walletNumber: z.string().trim().max(30).optional().default(''),
  cardLast4: z.string().trim().max(4).optional().default(''),
  bankName: z.string().trim().max(80).optional().default(''),
  notes: z.string().trim().max(500).optional().default(''),
  /** تسجيل استرداد بدل تحصيل */
  isRefund: z.boolean().optional().default(false),
  refundReason: z.string().trim().max(300).optional().default(''),
});

export const voidInvoiceSchema = z.object({
  reason: trimmedString(3, 300),
});

/* ----------------------------- المصروفات ----------------------------- */

export const createExpenseSchema = z.object({
  title: trimmedString(2, 160),
  category: z.enum([
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
  ]),
  amountEgp: moneySchema,
  method: z.enum(['cash', 'card', 'wallet', 'instapay', 'bank_transfer', 'credit']).optional().default('cash'),
  incurredAt: z.coerce.date().optional(),
  supplierId: objectIdSchema.nullable().optional(),
  relatedInvoiceNumber: z.string().trim().max(60).optional().default(''),
  notes: z.string().trim().max(1000).optional().default(''),
  isRecurring: z.boolean().optional().default(false),
  recurrence: z.enum(['none', 'monthly', 'weekly', 'yearly']).optional().default('none'),
});

export const updateExpenseSchema = createExpenseSchema.partial();

/* ----------------------------- الإشعارات ----------------------------- */

export const sendMessageSchema = z.object({
  customerId: objectIdSchema.nullable().optional(),
  ticketId: objectIdSchema.nullable().optional(),
  channel: z.enum(['whatsapp', 'sms', 'email', 'in_app']).optional().default('whatsapp'),
  toPhone: z.string().trim().max(20).optional(),
  templateKey: z.string().trim().max(60).optional(),
  body: trimmedString(2, 1500),
  variables: z.record(z.string(), z.string()).optional(),
});

export type CreateEstimateInput = z.infer<typeof createEstimateSchema>;
export type DecideEstimateInput = z.infer<typeof decideEstimateSchema>;
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
