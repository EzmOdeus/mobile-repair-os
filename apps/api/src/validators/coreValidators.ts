import { z } from 'zod';
import { addressSchema, csvFilter, objectIdSchema, trimmedString } from './common.js';

/* ------------------------------ العملاء ------------------------------ */

export const customerAddressSchema = addressSchema;

export const createCustomerSchema = z.object({
  fullName: trimmedString(2, 120),
  phone: z.string().trim().min(8, 'رقم الهاتف مطلوب').max(20),
  phoneAlt: z.string().trim().max(20).optional().default(''),
  email: z.string().trim().toLowerCase().email('بريد غير صحيح').optional().or(z.literal('')),
  whatsapp: z.string().trim().max(20).optional().default(''),
  type: z.enum(['individual', 'company', 'reseller']).optional().default('individual'),
  companyName: z.string().trim().max(160).optional().default(''),
  taxId: z.string().trim().max(40).optional().default(''),
  address: customerAddressSchema,
  tags: z.array(z.string().trim().max(30)).max(20).optional().default([]),
  notes: z.string().trim().max(2000).optional().default(''),
  consent: z
    .object({
      marketingOptIn: z.boolean().optional(),
      dataProcessingAcceptedAt: z.coerce.date().nullable().optional(),
    })
    .optional(),
});

export const updateCustomerSchema = createCustomerSchema.partial().extend({
  isBlacklisted: z.boolean().optional(),
  blacklistReason: z.string().trim().max(300).optional(),
  isActive: z.boolean().optional(),
});

export const listCustomersQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  q: z.string().trim().optional(),
  sort: z.string().trim().optional(),
  type: csvFilter,
  tags: csvFilter,
  isActive: z.enum(['true', 'false']).optional(),
  isBlacklisted: z.enum(['true', 'false']).optional(),
});

/* ------------------------------ الأجهزة ------------------------------ */

export const createDeviceSchema = z.object({
  customerId: objectIdSchema,
  category: z.enum(['smartphone', 'tablet', 'smartwatch', 'laptop', 'accessory', 'other']).optional().default('smartphone'),
  brand: trimmedString(1, 60),
  model: trimmedString(1, 80),
  modelNumber: z.string().trim().max(60).optional().default(''),
  imei: z.string().trim().max(20).optional().default(''),
  imei2: z.string().trim().max(20).optional().default(''),
  serial: z.string().trim().max(60).optional().default(''),
  color: z.string().trim().max(40).optional().default(''),
  storage: z.string().trim().max(20).optional().default(''),
  ram: z.string().trim().max(20).optional().default(''),
  hasLockCode: z.boolean().optional().default(false),
  lockType: z
    .enum(['none', 'pin', 'pattern', 'password', 'face', 'fingerprint', 'icloud', 'google'])
    .optional()
    .default('none'),
  lockProvidedByCustomer: z.boolean().optional().default(false),
  isAccountLocked: z.boolean().optional().default(false),
  conditionOnIntake: z.enum(['new', 'excellent', 'good', 'fair', 'poor', 'damaged']).optional().default('good'),
  purchase: z
    .object({
      purchasedFrom: z.string().trim().max(120).optional(),
      purchaseDate: z.coerce.date().nullable().optional(),
      invoiceNumber: z.string().trim().max(60).optional(),
      warrantyStatus: z.enum(['unknown', 'in_warranty', 'out_of_warranty', 'shop_warranty']).optional(),
      warrantyExpiresAt: z.coerce.date().nullable().optional(),
    })
    .partial()
    .optional(),
  notes: z.string().trim().max(2000).optional().default(''),
});

export const updateDeviceSchema = createDeviceSchema.partial().omit({ customerId: true }).extend({
  isActive: z.boolean().optional(),
});

export const listDevicesQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  q: z.string().trim().optional(),
  sort: z.string().trim().optional(),
  customerId: objectIdSchema.optional(),
  brand: csvFilter,
  category: csvFilter,
  hasOpenTicket: z.enum(['true', 'false']).optional(),
  isActive: z.enum(['true', 'false']).optional(),
});

/* --------------------------- تذاكر الصيانة --------------------------- */

const checklistItemInput = z.object({
  key: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1).max(120),
  labelAr: z.string().trim().max(120).optional().default(''),
  status: z.enum(['pending', 'pass', 'fail', 'not_applicable']).optional().default('pending'),
  notes: z.string().trim().max(500).optional().default(''),
});

export const createTicketSchema = z
  .object({
    customerId: objectIdSchema.optional(),
    deviceId: objectIdSchema.optional(),
    /** إنشاء عميل وجهاز معًا في نفس الطلب (شاشة الاستقبال السريعة) */
    newCustomer: createCustomerSchema.optional(),
    newDevice: createDeviceSchema.omit({ customerId: true }).optional(),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).optional().default('normal'),
    source: z.enum(['walk_in', 'whatsapp', 'phone', 'reseller', 'return_warranty']).optional().default('walk_in'),
    assignedTechnicianId: objectIdSchema.nullable().optional(),
    promisedAt: z.coerce.date().nullable().optional(),
    tags: z.array(z.string().trim().max(30)).max(20).optional().default([]),
    internalNotes: z.string().trim().max(3000).optional().default(''),
    intake: z.object({
      complaint: trimmedString(3, 1000),
      complaintCategory: z.string().trim().max(60).optional().default(''),
      visualCondition: z
        .object({
          screenCracked: z.boolean().optional(),
          backGlassBroken: z.boolean().optional(),
          frameDented: z.boolean().optional(),
          waterDamageSigns: z.boolean().optional(),
          buttonsWorking: z.boolean().optional(),
          chargingPortCondition: z.string().trim().max(40).optional(),
          cameraCondition: z.string().trim().max(40).optional(),
        })
        .partial()
        .optional(),
      accessories: z.array(z.string().trim().max(40)).max(15).optional().default([]),
      customerAcknowledged: z.boolean().optional().default(false),
      dataLossDisclaimerAccepted: z.boolean().optional().default(false),
      devicePasswordProvided: z.boolean().optional().default(false),
      initialTests: z.array(checklistItemInput).max(40).optional().default([]),
      estimatedDeliveryAt: z.coerce.date().nullable().optional(),
      internalNotes: z.string().trim().max(1000).optional().default(''),
    }),
  })
  .refine((v) => v.deviceId || ((v.customerId || v.newCustomer) && v.newDevice), {
    message: 'لازم تحدد جهازًا موجودًا أو تنشئ عميلًا وجهازًا جديدين',
    path: ['deviceId'],
  });

export const updateTicketSchema = z.object({
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  source: z.enum(['walk_in', 'whatsapp', 'phone', 'reseller', 'return_warranty']).optional(),
  promisedAt: z.coerce.date().nullable().optional(),
  tags: z.array(z.string().trim().max(30)).max(20).optional(),
  internalNotes: z.string().trim().max(3000).optional(),
  customerVisibleNotes: z.string().trim().max(3000).optional(),
  assignedTechnicianId: objectIdSchema.nullable().optional(),
  cancelReason: z.string().trim().max(300).optional(),
});

export const transitionTicketSchema = z.object({
  status: z.enum([
    'received',
    'intake',
    'inspection',
    'diagnosis',
    'estimate',
    'waiting_approval',
    'approved',
    'waiting_part',
    'repairing',
    'testing_qc',
    'ready',
    'customer_notified',
    'paid',
    'delivered',
    'warranty',
    'cancelled',
    'unrepairable',
  ]),
  note: z.string().trim().max(1000).optional().default(''),
  station: z.string().trim().max(60).optional().default(''),
  reason: z.string().trim().max(300).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const assignTechnicianSchema = z.object({
  technicianId: objectIdSchema.nullable(),
  note: z.string().trim().max(500).optional().default(''),
});

export const diagnosisSchema = z.object({
  summary: trimmedString(3, 1000),
  faultCategory: z.string().trim().max(60).optional().default(''),
  faultSeverity: z.enum(['minor', 'moderate', 'major', 'critical']).optional().default('moderate'),
  rootCause: z.string().trim().max(1000).optional().default(''),
  requiredActions: z.array(z.string().trim().max(200)).max(30).optional().default([]),
  needsParts: z.boolean().optional().default(false),
  isBoardLevel: z.boolean().optional().default(false),
  diagnosisNotes: z.string().trim().max(2000).optional().default(''),
  confidence: z.enum(['low', 'medium', 'high']).optional().default('medium'),
});

export const addNoteSchema = z.object({
  body: trimmedString(2, 3000),
  visibility: z.enum(['internal', 'customer']).optional().default('internal'),
  category: z
    .enum(['general', 'diagnosis', 'repair_step', 'parts', 'customer_communication', 'qc', 'warning'])
    .optional()
    .default('general'),
  minutesSpent: z.coerce.number().min(0).max(1440).optional().default(0),
  isPinned: z.boolean().optional().default(false),
});

export const listTicketsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  q: z.string().trim().optional(),
  sort: z.string().trim().optional(),
  status: csvFilter,
  priority: csvFilter,
  customerId: objectIdSchema.optional(),
  deviceId: objectIdSchema.optional(),
  technicianId: objectIdSchema.optional(),
  openOnly: z.enum(['true', 'false']).optional(),
  slaBreached: z.enum(['true', 'false']).optional(),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
});

export const workLogSchema = z.object({
  action: z.enum(['start', 'pause', 'complete']),
  note: z.string().trim().max(500).optional().default(''),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type CreateDeviceInput = z.infer<typeof createDeviceSchema>;
export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type TransitionTicketInput = z.infer<typeof transitionTicketSchema>;
export type DiagnosisInput = z.infer<typeof diagnosisSchema>;
