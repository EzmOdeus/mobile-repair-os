import { z } from 'zod';
import { objectIdSchema, trimmedString } from './common.js';

/* ------------------------- الفحص والضمان ------------------------- */

export const createQualityCheckSchema = z.object({
  ticketId: objectIdSchema,
  items: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(60),
        labelAr: z.string().trim().min(1).max(120),
        required: z.boolean().optional().default(false),
        result: z.enum(['pending', 'pass', 'fail', 'not_applicable']).optional().default('pending'),
        notes: z.string().trim().max(400).optional().default(''),
      }),
    )
    .optional(),
  /** استخدام القائمة الافتراضية إن لم تُرسل بنود */
  useDefaultChecklist: z.boolean().optional().default(true),
  measurements: z
    .object({
      batteryHealthPct: z.coerce.number().min(0).max(100).nullable().optional(),
      chargingCurrentA: z.coerce.number().nullable().optional(),
      bootTimeSeconds: z.coerce.number().nullable().optional(),
      screenTestResult: z.string().trim().max(200).optional(),
      networkSignalDbm: z.coerce.number().nullable().optional(),
    })
    .partial()
    .optional(),
  functionalTests: z.array(z.string().trim().max(80)).max(30).optional().default([]),
  notes: z.string().trim().max(2000).optional().default(''),
});

export const submitQualityCheckSchema = z.object({
  items: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(60),
        result: z.enum(['pending', 'pass', 'fail', 'not_applicable']),
        notes: z.string().trim().max(400).optional().default(''),
      }),
    )
    .min(1),
  measurements: z
    .object({
      batteryHealthPct: z.coerce.number().min(0).max(100).nullable().optional(),
      chargingCurrentA: z.coerce.number().nullable().optional(),
      bootTimeSeconds: z.coerce.number().nullable().optional(),
      screenTestResult: z.string().trim().max(200).optional(),
      networkSignalDbm: z.coerce.number().nullable().optional(),
    })
    .partial()
    .optional(),
  functionalTests: z.array(z.string().trim().max(80)).max(30).optional(),
  notes: z.string().trim().max(2000).optional(),
  requiresReRepair: z.boolean().optional(),
  reRepairReason: z.string().trim().max(500).optional(),
  /** عند true: يُنقل الجهاز تلقائيًا إلى ready بعد الاجتياز */
  advanceTicket: z.boolean().optional().default(true),
});

export const createWarrantyClaimSchema = z.object({
  originalTicketId: objectIdSchema,
  symptom: trimmedString(3, 1000),
  coverage: z.enum(['part', 'labor', 'both', 'none']).optional().default('both'),
  isSameFault: z.boolean().optional().default(true),
  faultCategory: z.string().trim().max(60).optional().default(''),
  misuseSuspected: z.boolean().optional().default(false),
  physicalDamageFound: z.boolean().optional().default(false),
  liquidDamageFound: z.boolean().optional().default(false),
  thirdPartyIntervention: z.boolean().optional().default(false),
  createNewTicket: z.boolean().optional().default(true),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional().default('high'),
});

export const decideWarrantyClaimSchema = z.object({
  status: z.enum(['open', 'under_review', 'approved', 'rejected', 'in_repair', 'resolved', 'cancelled']),
  coverage: z.enum(['part', 'labor', 'both', 'none']).optional(),
  decisionNotes: z.string().trim().max(1000).optional().default(''),
  rejectedReason: z.string().trim().max(1000).optional().default(''),
  repairCostEgp: z.coerce.number().min(0).optional().default(0),
  chargedToCustomerEgp: z.coerce.number().min(0).optional().default(0),
  chargedToSupplierEgp: z.coerce.number().min(0).optional().default(0),
  supplierId: objectIdSchema.nullable().optional(),
  supplierClaimStatus: z.enum(['not_applicable', 'requested', 'accepted', 'rejected']).optional(),
  replacementRepairPartId: objectIdSchema.nullable().optional(),
  resolutionNotes: z.string().trim().max(1000).optional().default(''),
});

/* --------------------------- قاعدة المعرفة --------------------------- */

export const createKnowledgeSchema = z.object({
  title: trimmedString(3, 200),
  brand: z.string().trim().max(60).optional().default(''),
  models: z.array(z.string().trim().max(120)).max(100).optional().default([]),
  category: z
    .enum([
      'display',
      'power',
      'charging',
      'audio',
      'camera',
      'network',
      'software',
      'board_level',
      'water_damage',
      'biometrics',
      'other',
    ])
    .optional()
    .default('other'),
  symptom: trimmedString(3, 500),
  diagnosticSteps: z
    .array(
      z.object({
        step: z.coerce.number().int().min(1),
        instruction: trimmedString(2, 600),
        expectedResult: z.string().trim().max(300).optional().default(''),
        toolRequired: z.string().trim().max(120).optional().default(''),
      }),
    )
    .max(50)
    .optional()
    .default([]),
  knownCauses: z
    .array(
      z.object({
        cause: trimmedString(2, 300),
        likelihood: z.enum(['low', 'medium', 'high']).optional().default('medium'),
        verifyBy: z.string().trim().max(300).optional().default(''),
      }),
    )
    .max(50)
    .optional()
    .default([]),
  repairNotes: z.string().trim().max(5000).optional().default(''),
  requiredTools: z.array(z.string().trim().max(80)).max(50).optional().default([]),
  difficulty: z.enum(['easy', 'medium', 'hard', 'expert']).optional().default('medium'),
  estimatedMinutes: z.coerce.number().int().min(0).max(10000).optional().default(0),
  riskWarnings: z.array(z.string().trim().max(300)).max(30).optional().default([]),
  tags: z.array(z.string().trim().max(40)).max(30).optional().default([]),
  status: z.enum(['draft', 'review', 'published', 'archived']).optional().default('draft'),
});

export const updateKnowledgeSchema = createKnowledgeSchema.partial();
