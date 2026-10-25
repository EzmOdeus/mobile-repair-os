import { z } from 'zod';
import { objectIdSchema, trimmedString } from './common.js';
import { PLATFORM_PLAN_KEYS, SELF_SERVICE_PLAN_KEYS } from '../constants/plans.js';
import { SUBSCRIPTION_PAYMENT_METHODS } from '../models/SubscriptionPayment.js';

/* --------------------------- المؤسسة والفروع --------------------------- */

export const updateOrganizationSchema = z.object({
  name: trimmedString(2, 120).optional(),
  nameEn: z.string().trim().max(120).optional(),
  legalName: z.string().trim().max(200).optional(),
  taxId: z.string().trim().max(40).optional(),
  commercialRegister: z.string().trim().max(60).optional(),
  phone: z.string().trim().max(20).optional(),
  email: z.string().trim().toLowerCase().email().optional().or(z.literal('')),
  website: z.string().trim().max(200).optional(),
  address: z
    .object({
      governorate: z.string().trim().max(80).optional(),
      city: z.string().trim().max(80).optional(),
      area: z.string().trim().max(80).optional(),
      street: z.string().trim().max(160).optional(),
      building: z.string().trim().max(80).optional(),
      notes: z.string().trim().max(500).optional(),
    })
    .partial()
    .optional(),
  branding: z
    .object({
      primaryColor: z.string().trim().max(20).optional(),
      receiptFooterText: z.string().trim().max(500).optional(),
    })
    .partial()
    .optional(),
  settings: z
    .object({
      currency: z.string().trim().max(6).optional(),
      timezone: z.string().trim().max(60).optional(),
      locale: z.string().trim().max(10).optional(),
      taxRate: z.coerce.number().min(0).max(100).optional(),
      taxInclusive: z.boolean().optional(),
      defaultWarrantyDays: z.coerce.number().int().min(0).max(3650).optional(),
      partsWarrantyDays: z.coerce.number().int().min(0).max(3650).optional(),
      laborWarrantyDays: z.coerce.number().int().min(0).max(3650).optional(),
      requireApprovalBeforeRepair: z.boolean().optional(),
      requireIntakePhotos: z.boolean().optional(),
      requireQcBeforeReady: z.boolean().optional(),
      defaultSlaHours: z.coerce.number().int().min(1).max(2000).optional(),
      ticketPrefix: z.string().trim().max(10).optional(),
      invoicePrefix: z.string().trim().max(10).optional(),
      whatsappEnabled: z.boolean().optional(),
      notifyOnStatusChange: z.boolean().optional(),
    })
    .partial()
    .optional(),
});

export const createBranchSchema = z.object({
  name: trimmedString(2, 120),
  code: z
    .string()
    .trim()
    .min(2)
    .max(10)
    .transform((v) => v.toUpperCase()),
  phone: z.string().trim().max(20).optional().default(''),
  email: z.string().trim().toLowerCase().email().optional().or(z.literal('')),
  address: z
    .object({
      governorate: z.string().trim().max(80).optional(),
      city: z.string().trim().max(80).optional(),
      area: z.string().trim().max(80).optional(),
      street: z.string().trim().max(160).optional(),
      building: z.string().trim().max(80).optional(),
      notes: z.string().trim().max(500).optional(),
    })
    .partial()
    .optional(),
  managerId: objectIdSchema.nullable().optional(),
  workingHours: z
    .object({
      opensAt: z.string().trim().max(5).optional(),
      closesAt: z.string().trim().max(5).optional(),
      weeklyOff: z.array(z.string().trim().max(10)).max(7).optional(),
    })
    .partial()
    .optional(),
  isDefault: z.boolean().optional().default(false),
});

export const updateBranchSchema = createBranchSchema.partial().extend({
  isActive: z.boolean().optional(),
});

/* ------------------------------ المخزون ------------------------------ */

export const createSupplierSchema = z.object({
  name: trimmedString(2, 160),
  code: z.string().trim().max(20).optional().default(''),
  type: z
    .enum(['local_wholesale', 'importer', 'online', 'authorized_distributor', 'other'])
    .optional()
    .default('local_wholesale'),
  contactPerson: z.string().trim().max(120).optional().default(''),
  phone: z.string().trim().max(20).optional().default(''),
  phoneAlt: z.string().trim().max(20).optional().default(''),
  email: z.string().trim().toLowerCase().email().optional().or(z.literal('')),
  address: z
    .object({
      governorate: z.string().trim().max(80).optional(),
      city: z.string().trim().max(80).optional(),
      area: z.string().trim().max(80).optional(),
      street: z.string().trim().max(160).optional(),
    })
    .partial()
    .optional(),
  taxId: z.string().trim().max(40).optional().default(''),
  paymentTerms: z.string().trim().max(200).optional().default(''),
  notes: z.string().trim().max(2000).optional().default(''),
});

export const updateSupplierSchema = createSupplierSchema.partial().extend({
  isActive: z.boolean().optional(),
  performance: z
    .object({
      avgLeadTimeDays: z.coerce.number().min(0).optional(),
      rating: z.coerce.number().min(0).max(5).optional(),
    })
    .partial()
    .optional(),
});

export const createPartSchema = z.object({
  sku: z
    .string()
    .trim()
    .min(2, 'الكود قصير جدًا')
    .max(40)
    .transform((v) => v.toUpperCase()),
  name: trimmedString(2, 180),
  nameEn: z.string().trim().max(180).optional().default(''),
  category: z.enum([
    'screen',
    'battery',
    'charging_port',
    'back_glass',
    'camera',
    'speaker',
    'microphone',
    'flex_cable',
    'motherboard',
    'ic_chip',
    'housing',
    'button',
    'sim_tray',
    'water_damage_part',
    'tools',
    'accessory',
    'other',
  ]),
  grade: z
    .enum(['original', 'oem', 'aftermarket_a', 'aftermarket_b', 'refurbished', 'pulled', 'unknown'])
    .optional()
    .default('unknown'),
  brand: z.string().trim().max(60).optional().default(''),
  barcode: z.string().trim().max(60).optional().default(''),
  description: z.string().trim().max(2000).optional().default(''),
  compatibility: z
    .object({
      deviceBrands: z.array(z.string().trim().max(60)).max(50).optional(),
      deviceModels: z.array(z.string().trim().max(120)).max(200).optional(),
      modelNumbers: z.array(z.string().trim().max(60)).max(200).optional(),
    })
    .partial()
    .optional(),
  pricing: z.object({
    costEgp: z.coerce.number().min(0).optional().default(0),
    sellingPriceEgp: z.coerce.number().min(0).optional().default(0),
    wholesalePriceEgp: z.coerce.number().min(0).optional().default(0),
  }),
  stock: z
    .object({
      reorderLevel: z.coerce.number().min(0).optional().default(2),
      reorderQty: z.coerce.number().min(0).optional().default(5),
    })
    .partial()
    .optional(),
  warranty: z
    .object({
      days: z.coerce.number().int().min(0).max(3650).optional().default(0),
      supplierDays: z.coerce.number().int().min(0).max(3650).optional().default(0),
      terms: z.string().trim().max(1000).optional().default(''),
    })
    .partial()
    .optional(),
  defaultSupplierId: objectIdSchema.nullable().optional(),
  requiresSerialTracking: z.boolean().optional().default(false),
  isConsumable: z.boolean().optional().default(false),
  notes: z.string().trim().max(2000).optional().default(''),
  /** رصيد افتتاحي اختياري في الفرع الحالي */
  openingStock: z.coerce.number().min(0).optional().default(0),
});

export const updatePartSchema = createPartSchema.partial().omit({ openingStock: true }).extend({
  isActive: z.boolean().optional(),
});

export const stockMovementSchema = z.object({
  partId: objectIdSchema,
  type: z.enum([
    'purchase_in',
    'sale_out',
    'repair_consume',
    'repair_return',
    'adjustment_in',
    'adjustment_out',
    'defective_out',
    'defective_in',
    'reserve',
    'release',
    'initial',
  ]),
  quantity: z.coerce.number().refine((v) => v !== 0, 'الكمية لا تكون صفرًا'),
  unitCostEgp: z.coerce.number().min(0).optional().default(0),
  supplierId: objectIdSchema.nullable().optional(),
  batchId: objectIdSchema.nullable().optional(),
  batchCode: z.string().trim().max(60).optional().default(''),
  ticketId: objectIdSchema.nullable().optional(),
  reason: z.string().trim().max(300).optional().default(''),
  reference: z.string().trim().max(80).optional().default(''),
});

export const stockAdjustSchema = z.object({
  partId: objectIdSchema,
  countedOnHand: z.coerce.number().min(0),
  reason: z.string().trim().max(300).optional().default('جرد فعلي'),
});

export const transferStockSchema = z.object({
  fromBranchId: objectIdSchema,
  toBranchId: objectIdSchema,
  lines: z
    .array(
      z.object({
        partId: objectIdSchema,
        quantity: z.coerce.number().min(1),
      }),
    )
    .min(1),
  reason: z.string().trim().max(300).optional().default(''),
});

export const stockCountSchema = z
  .object({
    branchId: objectIdSchema.optional(),
    lines: z
      .array(
        z.object({
          partId: objectIdSchema,
          countedOnHand: z.coerce.number().min(0),
          note: z.string().trim().max(300).optional().default(''),
        }),
      )
      .min(1, 'أضف قطعة واحدة على الأقل'),
    notes: z.string().trim().max(2000).optional().default(''),
  })
  .refine(
    (v) => new Set(v.lines.map((l) => l.partId)).size === v.lines.length,
    { message: 'القطعة مكررة في محضر الجرد', path: ['lines'] },
  );

/* ---------------------------- قطع ومصنعية ---------------------------- */

export const addRepairPartSchema = z.object({
  partId: objectIdSchema,
  quantity: z.coerce.number().min(1).max(999).optional().default(1),
  unitPriceEgp: z.coerce.number().min(0).optional(),
  batchId: objectIdSchema.nullable().optional(),
  status: z.enum(['reserved', 'installed', 'removed', 'returned', 'defective']).optional().default('reserved'),
  warrantyDays: z.coerce.number().int().min(0).max(3650).optional(),
  notes: z.string().trim().max(500).optional().default(''),
});

export const updateRepairPartSchema = z.object({
  status: z.enum(['reserved', 'installed', 'removed', 'returned', 'defective']).optional(),
  quantity: z.coerce.number().min(1).max(999).optional(),
  unitPriceEgp: z.coerce.number().min(0).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const addLaborSchema = z.object({
  description: trimmedString(2, 200),
  category: z
    .enum(['diagnosis', 'repair', 'board_level', 'software', 'cleaning', 'assembly', 'testing', 'other'])
    .optional()
    .default('repair'),
  hours: z.coerce.number().min(0).max(500).optional().default(0),
  ratePerHourEgp: z.coerce.number().min(0).optional().default(0),
  amountEgp: z.coerce.number().min(0).optional(),
  technicianId: objectIdSchema.nullable().optional(),
  isWarrantyWork: z.boolean().optional().default(false),
  notes: z.string().trim().max(500).optional().default(''),
});

/* --------------------------- الاشتراك والباقات --------------------------- */

const monthsSchema = z.coerce.number().int().min(1).max(36);
const priceSchema = z.coerce.number().min(0).max(1_000_000);
const paymentMethodSchema = z.enum(SUBSCRIPTION_PAYMENT_METHODS);

/** تغيير الباقة ذاتيًا: الباقات القياسية فقط (المبتدئة للتجربة، المؤسسية للمنصة) */
export const changePlanSchema = z.object({
  plan: z.enum(SELF_SERVICE_PLAN_KEYS),
});

/** تفعيل/تجديد ذاتي بعد دفع خارج المنصة — بيانات الدفع إلزامية */
export const activateSubscriptionSchema = z.object({
  plan: z.enum(SELF_SERVICE_PLAN_KEYS),
  months: monthsSchema.optional().default(1),
  paymentMethod: paymentMethodSchema,
  paymentReference: z.string().trim().min(3, 'مرجع الدفع قصير جدًا').max(100),
  paymentNote: z.string().trim().max(500).optional().default(''),
});

/** طلب تجديد/عرض سعر — متاح للمركز المحظور ويشمل المؤسسية */
export const createRenewalRequestSchema = z.object({
  plan: z.enum(PLATFORM_PLAN_KEYS),
  months: monthsSchema.optional().default(1),
  paymentMethod: paymentMethodSchema.optional().default('bank_transfer'),
  paymentReference: z.string().trim().max(100).optional().default(''),
  note: z.string().trim().max(500).optional().default(''),
});

export const rejectRenewalRequestSchema = z.object({
  note: trimmedString(2, 500),
});

export const approveRenewalRequestSchema = z.object({
  months: monthsSchema.optional(),
  monthlyPriceEgp: priceSchema.optional(),
  amountEgp: priceSchema.optional(),
  paymentMethod: paymentMethodSchema.optional(),
  paymentReference: z.string().trim().max(100).optional(),
  note: z.string().trim().max(500).optional().default(''),
});

/** تغيير باقة من إدارة المنصة — يشمل المؤسسية بسعر مخصص */
export const platformChangePlanSchema = z.object({
  plan: z.enum(PLATFORM_PLAN_KEYS),
  monthlyPriceEgp: priceSchema.optional(),
});

/** تفعيل اشتراك من إدارة المنصة — الدفعة اختيارية (منحة/تسوية) */
export const platformActivateSubscriptionSchema = z.object({
  plan: z.enum(PLATFORM_PLAN_KEYS),
  months: monthsSchema.optional().default(1),
  monthlyPriceEgp: priceSchema.optional(),
  amountEgp: priceSchema.optional(),
  paymentMethod: paymentMethodSchema.optional(),
  paymentReference: z.string().trim().max(100).optional().default(''),
  paymentNote: z.string().trim().max(500).optional().default(''),
});
