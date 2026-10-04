import { z } from 'zod';
import { egyptPhoneSchema, trimmedString } from './common.js';

export const loginSchema = z.object({
  identifier: z.string().trim().min(3, 'أدخل اسم المستخدم أو البريد'),
  password: z.string().min(6, 'كلمة المرور 6 أحرف على الأقل'),
  /** اختياري: لتحديد المؤسسة عند تكرار اسم المستخدم */
  organizationSlug: z.string().trim().optional(),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(10, 'رمز التجديد مطلوب'),
});

export const registerOrganizationSchema = z.object({
  organization: z.object({
    name: trimmedString(2, 120),
    nameEn: z.string().trim().max(120).optional().default(''),
    phone: egyptPhoneSchema.optional(),
    email: z.string().trim().toLowerCase().email('بريد إلكتروني غير صحيح').optional(),
    governorate: z.string().trim().max(80).optional().default(''),
    city: z.string().trim().max(80).optional().default(''),
  }),
  owner: z.object({
    fullName: trimmedString(3, 120),
    username: z
      .string()
      .trim()
      .toLowerCase()
      .min(3, 'اسم المستخدم 3 أحرف على الأقل')
      .max(40)
      .regex(/^[a-z0-9._-]+$/, 'اسم المستخدم يقبل حروف إنجليزية وأرقام و . _ - فقط'),
    email: z.string().trim().toLowerCase().email('بريد إلكتروني غير صحيح').optional(),
    phone: egyptPhoneSchema.optional(),
    password: z
      .string()
      .min(8, 'كلمة المرور 8 أحرف على الأقل')
      .regex(/[A-Za-z]/, 'لازم تحتوي على حرف')
      .regex(/\d/, 'لازم تحتوي على رقم'),
  }),
  branch: z
    .object({
      name: trimmedString(2, 120),
      code: z.string().trim().min(2).max(10).optional().default('MAIN'),
    })
    .optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(6),
  newPassword: z
    .string()
    .min(8, 'كلمة المرور 8 أحرف على الأقل')
    .regex(/[A-Za-z]/, 'لازم تحتوي على حرف')
    .regex(/\d/, 'لازم تحتوي على رقم'),
});

export const updateProfileSchema = z.object({
  fullName: z.string().trim().min(3).max(120).optional(),
  phone: egyptPhoneSchema.optional(),
  email: z.string().trim().toLowerCase().email().optional().or(z.literal('')),
  locale: z.string().trim().max(10).optional(),
  technicianProfile: z
    .object({
      isTechnician: z.boolean().optional(),
      specialities: z.array(z.string().trim().max(40)).max(20).optional(),
      skillLevel: z.enum(['junior', 'mid', 'senior', 'lead']).optional(),
      maxActiveJobs: z.coerce.number().int().min(1).max(50).optional(),
      hourlyCostEgp: z.coerce.number().min(0).optional(),
      workbench: z.string().trim().max(60).optional(),
    })
    .partial()
    .optional(),
});

export const createUserSchema = z.object({
  fullName: trimmedString(3, 120),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(40)
    .regex(/^[a-z0-9._-]+$/, 'اسم المستخدم يقبل حروف إنجليزية وأرقام و . _ - فقط'),
  email: z.string().trim().toLowerCase().email().optional().or(z.literal('')),
  phone: egyptPhoneSchema.optional(),
  password: z
    .string()
    .min(8, 'كلمة المرور 8 أحرف على الأقل')
    .regex(/[A-Za-z]/, 'لازم تحتوي على حرف')
    .regex(/\d/, 'لازم تحتوي على رقم'),
  role: z.enum(['owner', 'admin', 'manager', 'receptionist', 'technician', 'accountant', 'viewer']),
  branchIds: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/)).optional(),
  extraPermissions: z.array(z.string()).optional(),
  deniedPermissions: z.array(z.string()).optional(),
  technicianProfile: z
    .object({
      isTechnician: z.boolean().optional(),
      specialities: z.array(z.string().trim().max(40)).max(20).optional(),
      skillLevel: z.enum(['junior', 'mid', 'senior', 'lead']).optional(),
      maxActiveJobs: z.coerce.number().int().min(1).max(50).optional(),
      hourlyCostEgp: z.coerce.number().min(0).optional(),
      workbench: z.string().trim().max(60).optional(),
    })
    .optional(),
});

export const updateUserSchema = createUserSchema.partial().omit({ password: true }).extend({
  isActive: z.boolean().optional(),
  newPassword: z
    .string()
    .min(8, 'كلمة المرور 8 أحرف على الأقل')
    .regex(/[A-Za-z]/, 'لازم تحتوي على حرف')
    .regex(/\d/, 'لازم تحتوي على رقم')
    .optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterOrganizationInput = z.infer<typeof registerOrganizationSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
