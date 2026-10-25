import { z } from 'zod';
import { egyptPhoneSchema, trimmedString } from './common.js';
import { CENTER_ASSIGNABLE_PERMISSIONS, CENTER_ASSIGNABLE_ROLES } from '../constants/roles.js';

export const loginSchema = z.object({
  identifier: z.string().trim().min(3, 'أدخل اسم المستخدم أو البريد'),
  password: z.string().min(6, 'كلمة المرور 6 أحرف على الأقل'),
  /** اختياري: لتحديد المؤسسة عند تكرار اسم المستخدم */
  organizationSlug: z.string().trim().optional(),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(10, 'رمز التجديد مطلوب'),
});

const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'رمز التحقق 6 أرقام');

export const verifyTwoFactorSchema = z.object({
  challengeToken: z.string().trim().min(20, 'توكن التحقق مطلوب'),
  code: z.string().trim().min(6, 'أدخل رمز التحقق أو رمز الاسترداد').max(20),
});

export const twoFactorCodeSchema = z.object({
  code: totpCodeSchema,
});

export const disableTwoFactorSchema = z.object({
  password: z.string().min(6, 'كلمة المرور مطلوبة'),
  code: z.string().trim().min(6, 'أدخل رمز التحقق أو رمز الاسترداد').max(20),
});

export const regenerateRecoveryCodesSchema = z.object({
  password: z.string().min(6, 'كلمة المرور مطلوبة'),
  code: totpCodeSchema,
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

/**
 * استعادة كلمة المرور.
 * forgot-password يقبل البريد فقط ويرد دائمًا ردًا عامًا (لا يكشف وجود الحساب من عدمه).
 */
export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email('أدخل بريدًا إلكترونيًا صحيحًا'),
});

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(20, 'رمز الاستعادة غير صحيح'),
  password: z
    .string()
    .min(8, 'كلمة المرور 8 أحرف على الأقل')
    .regex(/[A-Za-z]/, 'لازم تحتوي على حرف')
    .regex(/\d/, 'لازم تحتوي على رقم'),
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
  /** دور المنصة (platform) غير قابل للإنشاء من مسارات المركز — يُدار من إدارة المنصة */
  role: z.enum(CENTER_ASSIGNABLE_ROLES),
  branchIds: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/)).optional(),
  /** صلاحيات المنصة غير قابلة للمنح الفردي لمستخدم مركز (منع تصعيد الصلاحيات) */
  extraPermissions: z
    .array(z.enum(CENTER_ASSIGNABLE_PERMISSIONS))
    .optional(),
  deniedPermissions: z.array(z.enum(CENTER_ASSIGNABLE_PERMISSIONS)).optional(),
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
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type VerifyTwoFactorInput = z.infer<typeof verifyTwoFactorSchema>;
export type TwoFactorCodeInput = z.infer<typeof twoFactorCodeSchema>;
export type DisableTwoFactorInput = z.infer<typeof disableTwoFactorSchema>;
export type RegenerateRecoveryCodesInput = z.infer<typeof regenerateRecoveryCodesSchema>;
