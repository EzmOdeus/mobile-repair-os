import { z } from 'zod';
import { objectIdSchema } from './common.js';
import { PAYMENT_METHODS } from '../constants/repair.js';

const purchaseLineSchema = z.object({
  partId: objectIdSchema,
  description: z.string().trim().max(200).optional().default(''),
  quantityOrdered: z.coerce.number().min(1).max(100000),
  unitCostEgp: z.coerce.number().min(0).max(100_000_000),
  warrantyDays: z.coerce.number().int().min(0).max(3650).optional().default(0),
  notes: z.string().trim().max(500).optional().default(''),
});

export const createPurchaseOrderSchema = z.object({
  branchId: objectIdSchema.optional(),
  supplierId: objectIdSchema,
  expectedAt: z.string().datetime().optional().nullable(),
  supplierInvoiceNumber: z.string().trim().max(60).optional().default(''),
  supplierInvoiceDate: z.string().datetime().optional().nullable(),
  lines: z.array(purchaseLineSchema).min(1, 'أضف بندًا واحدًا على الأقل'),
  discountEgp: z.coerce.number().min(0).optional().default(0),
  taxRatePct: z.coerce.number().min(0).max(100).optional(),
  notes: z.string().trim().max(2000).optional().default(''),
});

export const updatePurchaseOrderSchema = z.object({
  supplierId: objectIdSchema.optional(),
  expectedAt: z.string().datetime().optional().nullable(),
  supplierInvoiceNumber: z.string().trim().max(60).optional(),
  supplierInvoiceDate: z.string().datetime().optional().nullable(),
  lines: z.array(purchaseLineSchema).min(1).optional(),
  discountEgp: z.coerce.number().min(0).optional(),
  taxRatePct: z.coerce.number().min(0).max(100).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const receivePurchaseOrderSchema = z.object({
  lines: z
    .array(
      z.object({
        lineId: objectIdSchema,
        quantity: z.coerce.number().min(0.0001),
        unitCostEgp: z.coerce.number().min(0).optional(),
        batchCode: z.string().trim().max(60).optional().default(''),
        notes: z.string().trim().max(500).optional().default(''),
      }),
    )
    .min(1, 'حدد الكميات المستلمة'),
  supplierInvoiceNumber: z.string().trim().max(60).optional(),
  supplierInvoiceDate: z.string().datetime().optional().nullable(),
  notes: z.string().trim().max(2000).optional(),
});

export const cancelPurchaseOrderSchema = z.object({
  reason: z.string().trim().min(2, 'اذكر سبب الإلغاء').max(300),
});

export const recordSupplierPaymentSchema = z.object({
  supplierId: objectIdSchema,
  purchaseOrderId: objectIdSchema.optional().nullable(),
  amountEgp: z.coerce.number().gt(0),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(80).optional().default(''),
  bankName: z.string().trim().max(80).optional().default(''),
  notes: z.string().trim().max(500).optional().default(''),
  paidAt: z.string().datetime().optional(),
});
