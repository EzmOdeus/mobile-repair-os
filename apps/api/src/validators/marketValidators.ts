import { z } from 'zod';
import { moneySchema, trimmedString } from './common.js';
import {
  MARKET_CATEGORIES,
  MARKET_CONDITIONS,
  MARKET_LISTING_KINDS,
  MARKET_SCOPES,
} from '../models/MarketListing.js';
import { PRICE_GUIDE_CONDITIONS, PRICE_GUIDE_GRADES } from '../models/PhonePriceGuide.js';

const optionalPhone = z
  .string()
  .trim()
  .max(20)
  .optional()
  .default('')
  .refine((v) => !v || /^(\+?20)?0?1[0125]\d{8}$/.test(v.replace(/[\s-()]/g, '')), {
    message: 'رقم موبايل مصري غير صحيح (مثال: 01012345678)',
  });

const locationSchema = z
  .object({
    governorate: z.string().trim().max(80).optional().default(''),
    city: z.string().trim().max(80).optional().default(''),
    area: z.string().trim().max(80).optional().default(''),
  })
  .partial()
  .optional();

const listingFields = {
  scope: z.enum(MARKET_SCOPES).optional().default('public'),
  kind: z.enum(MARKET_LISTING_KINDS).optional().default('sell'),
  title: trimmedString(5, 160),
  description: z.string().trim().max(4000).optional().default(''),
  category: z.enum(MARKET_CATEGORIES).optional().default('smartphone'),
  brand: trimmedString(1, 60),
  model: trimmedString(1, 60),
  storage: z.string().trim().max(30).optional().default(''),
  ram: z.string().trim().max(20).optional().default(''),
  color: z.string().trim().max(30).optional().default(''),
  condition: z.enum(MARKET_CONDITIONS).optional().default('good'),
  batteryHealth: z.coerce.number().int().min(0).max(100).nullable().optional().default(null),
  warrantyDays: z.coerce.number().int().min(0).max(3650).optional().default(0),
  includes: z.array(z.string().trim().min(1).max(40)).max(10).optional().default([]),
  priceEgp: moneySchema,
  negotiable: z.boolean().optional().default(true),
  quantity: z.coerce.number().int().min(1).max(999).optional().default(1),
  expiresInDays: z.coerce.number().int().min(1).max(180).optional().default(30),
  contactName: z.string().trim().max(120).optional().default(''),
  contactPhone: optionalPhone,
  contactWhatsapp: optionalPhone,
  location: locationSchema,
};

export const createMarketListingSchema = z.object(listingFields);

export const updateMarketListingSchema = z
  .object({
    scope: z.enum(MARKET_SCOPES).optional(),
    kind: z.enum(MARKET_LISTING_KINDS).optional(),
    title: trimmedString(5, 160).optional(),
    description: z.string().trim().max(4000).optional(),
    category: z.enum(MARKET_CATEGORIES).optional(),
    brand: trimmedString(1, 60).optional(),
    model: trimmedString(1, 60).optional(),
    storage: z.string().trim().max(30).optional(),
    ram: z.string().trim().max(20).optional(),
    color: z.string().trim().max(30).optional(),
    condition: z.enum(MARKET_CONDITIONS).optional(),
    batteryHealth: z.coerce.number().int().min(0).max(100).nullable().optional(),
    warrantyDays: z.coerce.number().int().min(0).max(3650).optional(),
    includes: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
    priceEgp: moneySchema.optional(),
    negotiable: z.boolean().optional(),
    quantity: z.coerce.number().int().min(1).max(999).optional(),
    expiresInDays: z.coerce.number().int().min(1).max(180).optional(),
    contactName: z.string().trim().max(120).optional(),
    contactPhone: optionalPhone.optional(),
    contactWhatsapp: optionalPhone.optional(),
    location: locationSchema,
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'لا توجد حقول للتحديث' });

export const createMarketOfferSchema = z.object({
  amountEgp: moneySchema.refine((v) => v > 0, 'قيمة العرض يجب أن تكون أكبر من صفر'),
  quantity: z.coerce.number().int().min(1).max(999).optional().default(1),
  message: z.string().trim().max(1000).optional().default(''),
});

export const decideMarketOfferSchema = z.object({
  action: z.enum(['accept', 'reject', 'withdraw']),
  note: z.string().trim().max(1000).optional().default(''),
});

export const rejectMarketListingSchema = z.object({
  reason: trimmedString(3, 500),
});

export const markMarketListingSoldSchema = z.preprocess(
  (value) => value ?? {},
  z.object({
    soldPriceEgp: moneySchema.optional(),
    note: z.string().trim().max(500).optional().default(''),
  }),
);

export const removeMarketListingSchema = z.preprocess(
  (value) => value ?? {},
  z.object({
    reason: z.string().trim().max(500).optional().default(''),
  }),
);

export const priceGuideSchema = z
  .object({
    brand: trimmedString(1, 60),
    model: trimmedString(1, 60),
    storage: z.string().trim().max(30).optional().default(''),
    condition: z.enum(PRICE_GUIDE_CONDITIONS),
    grade: z.enum(PRICE_GUIDE_GRADES).optional().default('none'),
    lowEgp: moneySchema,
    avgEgp: moneySchema,
    highEgp: moneySchema,
    sourceNote: z.string().trim().max(300).optional().default(''),
    isActive: z.boolean().optional().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.lowEgp > v.avgEgp) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['avgEgp'], message: 'المتوسط يجب ألا يقل عن الحد الأدنى' });
    }
    if (v.avgEgp > v.highEgp) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['highEgp'], message: 'الحد الأعلى يجب ألا يقل عن المتوسط' });
    }
  });

export const updatePriceGuideSchema = z.object({
  brand: trimmedString(1, 60).optional(),
  model: trimmedString(1, 60).optional(),
  storage: z.string().trim().max(30).optional(),
  condition: z.enum(PRICE_GUIDE_CONDITIONS).optional(),
  grade: z.enum(PRICE_GUIDE_GRADES).optional(),
  lowEgp: moneySchema.optional(),
  avgEgp: moneySchema.optional(),
  highEgp: moneySchema.optional(),
  sourceNote: z.string().trim().max(300).optional(),
  isActive: z.boolean().optional(),
});
