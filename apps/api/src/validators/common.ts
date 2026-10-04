import { Types } from 'mongoose';
import { z } from 'zod';

/** ObjectId نصي صحيح */
export const objectIdSchema = z
  .string()
  .refine((v) => Types.ObjectId.isValid(v), { message: 'معرّف غير صحيح' });

export const optionalObjectId = z
  .union([objectIdSchema, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === '' || v === null || v === undefined ? null : v));

/** رقم موبايل مصري: 01xxxxxxxxx أو +201xxxxxxxxx */
export const egyptPhoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-()]/g, ''))
  .refine((v) => /^(\+?20)?0?1[0125]\d{8}$/.test(v), {
    message: 'رقم موبايل مصري غير صحيح (مثال: 01012345678)',
  });

/** توحيد الرقم المصري إلى الصيغة 01xxxxxxxxx */
export function normalizeEgyptPhone(input: string): string {
  let v = input.replace(/[\s-()]/g, '');
  if (v.startsWith('+20')) v = `0${v.slice(3)}`;
  else if (v.startsWith('20') && v.length === 12) v = `0${v.slice(2)}`;
  else if (/^1[0125]\d{8}$/.test(v)) v = `0${v}`;
  return v;
}

export const paginationSchema = {
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(200).optional().default(25),
  sort: z.string().optional(),
  q: z.string().trim().optional(),
};

export const booleanQuery = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    if (typeof v === 'boolean') return v;
    return v === 'true' || v === '1';
  });

export const isoDateSchema = z
  .string()
  .refine((v) => !Number.isNaN(new Date(v).getTime()), { message: 'تاريخ غير صحيح' });

export const trimmedString = (min = 1, max = 500) =>
  z.string().trim().min(min, `الحد الأدنى ${min} حرف`).max(max, `الحد الأقصى ${max} حرف`);

/** مرشّح قوائم: يقبل قيمة واحدة أو قائمة مفصولة بفواصل */
export const csvFilter = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    const arr = Array.isArray(v) ? v : String(v).split(',');
    const clean = arr.map((s) => s.trim()).filter(Boolean);
    return clean.length ? clean : undefined;
  });

export const addressSchema = z
  .object({
    governorate: z.string().trim().max(80).optional(),
    city: z.string().trim().max(80).optional(),
    area: z.string().trim().max(80).optional(),
    street: z.string().trim().max(160).optional(),
    building: z.string().trim().max(80).optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .partial()
  .optional();

export const moneySchema = z.coerce.number().min(0, 'المبلغ لا يكون سالبًا').max(100_000_000);
