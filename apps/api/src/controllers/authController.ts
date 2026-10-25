import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { OrganizationModel } from '../models/Organization.js';
import { BranchModel } from '../models/Branch.js';
import { UserModel, type UserDoc } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler, created, ok } from '../utils/asyncHandler.js';
import { slugifyWithSuffix } from '../utils/ids.js';
import { permissionsForRole, type Permission, type Role } from '../constants/roles.js';
import { normalizeEgyptPhone } from '../validators/common.js';
import {
  generatePasswordResetToken,
  hashToken,
  signAccessToken,
  signRefreshToken,
  signTwoFactorChallenge,
  verifyRefreshToken,
  verifyTwoFactorChallenge,
} from '../services/tokenService.js';
import {
  buildOtpAuthUri,
  buildTotpQrDataUrl,
  decryptTwoFactorSecret,
  encryptTwoFactorSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  verifyTotp,
} from '../services/twoFactorService.js';
import { env } from '../config/env.js';
import { recordAudit } from '../services/auditService.js';
import { assertUserLimit } from '../services/planService.js';
import { startTrial } from '../services/subscriptionService.js';
import { DEFAULT_SIGNUP_PLAN, planLimits } from '../constants/plans.js';
import { logger } from '../config/logger.js';
import { runAsSystem, runWithTenantContext, type TenantContext } from '../context/tenantContext.js';
import { effectivePermissions, getAuth } from '../middleware/auth.js';
import type {
  ChangePasswordInput,
  CreateUserInput,
  DisableTwoFactorInput,
  ForgotPasswordInput,
  LoginInput,
  RegisterOrganizationInput,
  RegenerateRecoveryCodesInput,
  ResetPasswordInput,
  TwoFactorCodeInput,
  UpdateProfileInput,
  UpdateUserInput,
  VerifyTwoFactorInput,
} from '../validators/authValidators.js';
import type { LoginInput as _Login } from '../validators/authValidators.js';

const MAX_LOGIN_ATTEMPTS = 8;
const LOCK_MINUTES = 15;
/** صلاحية رمز استعادة كلمة المرور بالدقائق */
const RESET_TOKEN_TTL_MINUTES = 30;

interface SafeUserShape {
  _id: unknown;
  fullName: string;
  username: string;
  email?: string;
  phone?: string;
  role: Role;
  branchIds?: unknown[];
  isActive: boolean;
  technicianProfile?: unknown;
  locale?: string;
  lastLoginAt?: Date | null;
  extraPermissions?: string[] | null;
  deniedPermissions?: string[] | null;
  twoFactorEnabled?: boolean;
  twoFactorEnabledAt?: Date | null;
}

function serializeUser(user: SafeUserShape) {
  const role = user.role as Role;
  return {
    id: String(user._id),
    fullName: user.fullName,
    username: user.username,
    email: user.email ?? '',
    phone: user.phone ?? '',
    role,
    roleLabel: role,
    branchIds: (user.branchIds ?? []).map((b) => String(b)),
    isActive: user.isActive,
    technicianProfile: user.technicianProfile ?? null,
    locale: user.locale ?? 'ar-EG',
    lastLoginAt: user.lastLoginAt ?? null,
    twoFactorEnabled: Boolean(user.twoFactorEnabled),
    twoFactorEnabledAt: user.twoFactorEnabledAt ?? null,
    // الصلاحيات الفعلية: دور + ممنوحة شخصيًا − محجوبة (وليس الدور وحده)
    permissions: effectivePermissions({
      role,
      isActive: user.isActive,
      extraPermissions: user.extraPermissions ?? [],
      deniedPermissions: user.deniedPermissions ?? [],
    }),
  };
}

function issueTokens(params: {
  userId: string;
  organizationId: string;
  branchId: string | null;
  role: Role;
  fullName: string;
}) {
  const permissions = permissionsForRole(params.role);
  const accessToken = signAccessToken({
    sub: params.userId,
    org: params.organizationId,
    br: params.branchId,
    role: params.role,
    permissions,
    name: params.fullName,
  });
  const refreshToken = signRefreshToken({ sub: params.userId, org: params.organizationId });
  return { accessToken, refreshToken, expiresIn: 15 * 60 };
}

/** سياق تدقيق صريح لمسارات المصادقة العامة (بلا توكن/سياق مستأجر). */
function userAuditContext(user: UserDoc, req: Request): TenantContext {
  return {
    actor: {
      userId: String(user._id),
      organizationId: new Types.ObjectId(String(user.organizationId)),
      branchId: null,
      role: user.role as Role,
      fullName: user.fullName,
    },
    organizationId: new Types.ObjectId(String(user.organizationId)),
    branchId: null,
    requestId: req.requestId ?? '',
    ip: req.ip,
    userAgent: req.headers['user-agent'] ?? '',
  };
}

/** الجزء المشترك من إتمام الدخول: إصدار التوكنات، تدقيق، وإرجاع الجلسة. */
async function finishLogin(
  user: UserDoc,
  req: Request,
  res: Response,
  opts: { usedTwoFactor?: boolean; usedRecoveryCode?: boolean } = {},
) {
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  user.lastLoginAt = new Date();
  await user.save();

  const organization = await runAsSystem(() => OrganizationModel.findById(user.organizationId).lean());
  if (!organization) throw ApiError.notFound('المؤسسة غير موجودة');
  if (!organization.isActive) throw ApiError.forbidden('حساب المركز موقوف');

  const primaryBranchId = user.branchIds?.[0] ? String(user.branchIds[0]) : null;
  const tokens = issueTokens({
    userId: String(user._id),
    organizationId: String(user.organizationId),
    branchId: primaryBranchId,
    role: user.role as Role,
    fullName: user.fullName,
  });

  await runWithTenantContext(
    {
      actor: {
        userId: String(user._id),
        organizationId: new Types.ObjectId(String(user.organizationId)),
        branchId: primaryBranchId ? new Types.ObjectId(primaryBranchId) : null,
        role: user.role as Role,
        fullName: user.fullName,
      },
      organizationId: new Types.ObjectId(String(user.organizationId)),
      branchId: primaryBranchId ? new Types.ObjectId(primaryBranchId) : null,
      requestId: req.requestId ?? '',
      ip: req.ip,
      userAgent: req.headers['user-agent'] ?? '',
    },
    async () => {
      const suffix = opts.usedRecoveryCode
        ? ' (باستخدام رمز استرداد)'
        : opts.usedTwoFactor
          ? ' (بعد التحقق بخطوتين)'
          : '';
      await recordAudit(
        {
          action: 'login',
          resource: 'User',
          resourceId: String(user._id),
          summary: `تسجيل دخول${suffix}: ${user.username}`,
          severity: opts.usedRecoveryCode ? 'warning' : 'info',
        },
        req,
      );
    },
  );

  return ok(res, {
    ...tokens,
    user: serializeUser(user as unknown as SafeUserShape),
    organization: {
      id: String(organization._id),
      name: organization.name,
      slug: organization.slug,
      settings: organization.settings,
      subscription: organization.subscription,
    },
  });
}

/**
 * تسجيل الدخول.
 * ملاحظة أمنية: اسم المستخدم فريد داخل المؤسسة فقط، ولذلك نبحث بدون سياق مستأجر
 * ثم ننشئ السياق من المؤسسة الفعلية للمستخدم قبل أي عملية أخرى.
 */
export const login = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as LoginInput;
  const identifier = body.identifier.trim().toLowerCase();

  // استعلام عبر كل المؤسسات: لا يوجد سياق مستأجر بعد، ولذلك نعمل في علم النظام
  // ثم ننتقل إلى سياق المؤسسة الفعلية للمستخدم قبل أي عملية أخرى.
  const candidates = await runAsSystem(async () =>
    UserModel.find({
      $or: [{ username: identifier }, { email: identifier }],
    })
      .select('+passwordHash')
      .limit(10),
  );

  if (!candidates.length) {
    logger.warn({ identifier, ip: req.ip }, 'محاولة دخول بمستخدم غير موجود');
    throw ApiError.unauthorized('بيانات الدخول غير صحيحة');
  }

  // نختار المرشح المطابق للمؤسسة المحددة إن ذُكرت
  let user = candidates[0]!;
  if (body.organizationSlug) {
    for (const candidate of candidates) {
      const org = await runAsSystem(() =>
        OrganizationModel.findById(candidate.organizationId).select('slug').lean(),
      );
      if (org && org.slug.toLowerCase() === body.organizationSlug.toLowerCase()) {
        user = candidate;
        break;
      }
    }
  } else if (candidates.length > 1) {
    const options = await runAsSystem(async () =>
      Promise.all(
        candidates.map(async (c) => {
          const org = await OrganizationModel.findById(c.organizationId).select('slug name').lean();
          return { slug: org?.slug ?? '', name: org?.name ?? '' };
        }),
      ),
    );
    throw ApiError.badRequest('اسم المستخدم موجود في أكثر من مركز، حدد المركز (organizationSlug)', { options });
  }

  if (!user.isActive) throw ApiError.forbidden('الحساب موقوف، راجع مدير المركز');
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    await recordAudit({
      action: 'login_failed',
      resource: 'User',
      resourceId: String(user._id),
      summary: `محاولة دخول لحساب مقفول مؤقتًا: ${user.username}`,
      severity: 'warning',
      context: userAuditContext(user, req),
    });
    throw ApiError.forbidden('الحساب مقفول مؤقتًا بسبب محاولات دخول خاطئة، حاول لاحقًا');
  }

  const valid = await user.verifyPassword(body.password);
  if (!valid) {
    user.failedLoginAttempts = (user.failedLoginAttempts ?? 0) + 1;
    const lockedNow = user.failedLoginAttempts >= MAX_LOGIN_ATTEMPTS;
    if (lockedNow) {
      user.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60_000);
      user.failedLoginAttempts = 0;
    }
    await user.save();

    await recordAudit({
      action: 'login_failed',
      resource: 'User',
      resourceId: String(user._id),
      summary: lockedNow
        ? `محاولات دخول فاشلة — تم قفل الحساب ${LOCK_MINUTES} دقيقة: ${user.username}`
        : `محاولة دخول فاشلة: ${user.username}`,
      severity: lockedNow ? 'critical' : 'warning',
      context: userAuditContext(user, req),
    });

    throw ApiError.unauthorized('بيانات الدخول غير صحيحة');
  }

  /**
   * بعد صحة كلمة المرور: الحساب المفعّل للتحقق بخطوتين لا يحصل على توكنات،
   * بل على توكن تحدٍّ قصير العمر يُستخدم مرة واحدة مع رمز TOTP أو رمز استرداد.
   */
  if (user.twoFactorEnabled) {
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    await user.save();

    const challengeToken = signTwoFactorChallenge({
      sub: String(user._id),
      org: String(user.organizationId),
    });

    return ok(res, {
      twoFactorRequired: true,
      challengeToken,
      expiresIn: env.TWO_FACTOR_CHALLENGE_TTL_MINUTES * 60,
    });
  }

  return finishLogin(user, req, res);
});

/**
 * إتمام الدخول بعد التحقق بخطوتين.
 * رمز TOTP صالح، أو رمز استرداد يُستهلك ذريًا. المحاولات الفاشلة تتبع نفس
 * سياسة قفل الحساب في الدخول العادي (8 محاولات ← قفل 15 دقيقة).
 */
export const verifyTwoFactorLogin = asyncHandler(async (req: Request, res: Response) => {
  const { challengeToken, code } = req.body as VerifyTwoFactorInput;
  const payload = verifyTwoFactorChallenge(challengeToken);

  const user = await runAsSystem(() =>
    UserModel.findById(payload.sub).select('+twoFactorSecret +twoFactorRecoveryCodeHashes'),
  );
  if (!user || !user.isActive) throw ApiError.unauthorized('جلسة التحقق غير صالحة');
  if (String(user.organizationId) !== payload.org) throw ApiError.unauthorized('جلسة التحقق غير صالحة');
  if (!user.twoFactorEnabled || !user.twoFactorSecret) {
    throw ApiError.unauthorized('التحقق بخطوتين غير مفعّل لهذا الحساب');
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    throw ApiError.forbidden('الحساب مقفول مؤقتًا بسبب محاولات دخول خاطئة، حاول لاحقًا');
  }

  let accepted = false;
  try {
    accepted = verifyTotp(decryptTwoFactorSecret(user.twoFactorSecret), code);
  } catch {
    accepted = false;
  }

  let usedRecoveryCode = false;
  if (!accepted) {
    const recoveryHash = hashRecoveryCode(code);
    const consumed = await runAsSystem(() =>
      UserModel.updateOne(
        { _id: user._id, twoFactorRecoveryCodeHashes: recoveryHash },
        { $pull: { twoFactorRecoveryCodeHashes: recoveryHash } },
      ),
    );
    usedRecoveryCode = consumed.modifiedCount === 1;
    accepted = usedRecoveryCode;
  }

  if (!accepted) {
    user.failedLoginAttempts = (user.failedLoginAttempts ?? 0) + 1;
    const lockedNow = user.failedLoginAttempts >= MAX_LOGIN_ATTEMPTS;
    if (lockedNow) {
      user.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60_000);
      user.failedLoginAttempts = 0;
    }
    await user.save();

    await recordAudit({
      action: 'login_failed',
      resource: 'User',
      resourceId: String(user._id),
      summary: lockedNow
        ? `رمز تحقق ثنائي خاطئ — تم قفل الحساب ${LOCK_MINUTES} دقيقة: ${user.username}`
        : `رمز تحقق ثنائي خاطئ: ${user.username}`,
      severity: lockedNow ? 'critical' : 'warning',
      context: userAuditContext(user, req),
    });

    throw ApiError.unauthorized('رمز التحقق أو رمز الاسترداد غير صحيح');
  }

  return finishLogin(user, req, res, { usedTwoFactor: true, usedRecoveryCode });
});

/** تجديد التوكن */
export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = req.body as { refreshToken: string };
  const payload = verifyRefreshToken(refreshToken);

  /**
   * هذا المسار عام (بلا مصادقة) فلم يدخل سياق مؤسسة بعد؛ و`UserModel` محمي
   * بـtenantPlugin الذي يرفض أي استعلام بلا نطاق. بدون `runAsSystem` كان
   * التجديد يفشل دائمًا بـ403 فتنتهي كل جلسة بعد 15 دقيقة.
   */
  const user = await runAsSystem(() => UserModel.findById(payload.sub).lean());
  if (!user || !user.isActive) throw ApiError.unauthorized('الجلسة غير صالحة');
  if (String(user.organizationId) !== payload.org) throw ApiError.unauthorized('الجلسة غير صالحة');

  /**
   * جلسات أُنشئت قبل تفعيل 2FA لا يجوز أن تتجاوزها: وإلا بقي جهاز قديم
   * مسجّلًا بالتوكن فقط رغم تفعيل الحماية. نقارن وقت إصدار توكن التجديد
   * بوقت التفعيل ونطلب دخولًا جديدًا.
   */
  if (user.twoFactorEnabled && user.twoFactorEnabledAt && payload.iat) {
    if (payload.iat * 1000 < new Date(user.twoFactorEnabledAt).getTime()) {
      throw ApiError.unauthorized('تم تفعيل التحقق بخطوتين بعد بدء هذه الجلسة، سجّل الدخول من جديد');
    }
  }

  const primaryBranchId = user.branchIds?.[0] ? String(user.branchIds[0]) : null;
  const tokens = issueTokens({
    userId: String(user._id),
    organizationId: payload.org,
    branchId: primaryBranchId,
    role: user.role as Role,
    fullName: user.fullName,
  });

  return ok(res, tokens);
});

/** بيانات المستخدم الحالي + المؤسسة + الفروع */
export const me = asyncHandler(async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const user = await UserModel.findById(auth.userId);
  if (!user) throw ApiError.unauthorized('المستخدم غير موجود');

  const [organization, branches] = await Promise.all([
    OrganizationModel.findById(user.organizationId).lean(),
    BranchModel.find({ isActive: true }).select('name code isDefault address phone').sort({ isDefault: -1, name: 1 }).lean(),
  ]);

  return ok(res, {
    user: serializeUser(user as unknown as SafeUserShape),
    organization: organization
      ? {
          id: String(organization._id),
          name: organization.name,
          nameEn: organization.nameEn,
          slug: organization.slug,
          phone: organization.phone,
          address: organization.address,
          settings: organization.settings,
          subscription: organization.subscription,
        }
      : null,
    branches: branches.map((b) => ({
      id: String(b._id),
      name: b.name,
      code: b.code,
      isDefault: b.isDefault,
      phone: b.phone,
      address: b.address,
    })),
  });
});

/**
 * تسجيل مركز جديد (Self-service onboarding).
 * Agent: يُنشئ المؤسسة + الفرع الرئيسي + حساب المالك في خطوة واحدة.
 */
export const registerOrganization = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as RegisterOrganizationInput;

  // التحقق من تفرد اسم المستخدم/البريد على مستوى المنصة كلها (اسم المستخدم فريد داخل المؤسسة،
  // لكن التسجيل الذاتي يحتاج منع التعارض عبر المؤسسات قبل إنشاء المؤسسة نفسها)
  const { existingUsername, existingEmail } = await runAsSystem(async () => ({
    existingUsername: await UserModel.findOne({ username: body.owner.username }).lean(),
    existingEmail: body.owner.email ? await UserModel.findOne({ email: body.owner.email }).lean() : null,
  }));

  if (existingUsername) throw ApiError.conflict('اسم المستخدم مستخدم بالفعل');
  if (existingEmail) throw ApiError.conflict('البريد الإلكتروني مستخدم بالفعل');

  // الاسم الإنجليزي يُستخدم كأساس للـslug لو كان اسم المركز عربيًا بالكامل
  const slug = slugifyWithSuffix(body.organization.name, body.organization.nameEn ?? '');

  const organization = await OrganizationModel.create({
    name: body.organization.name,
    nameEn: body.organization.nameEn ?? '',
    slug,
    phone: body.organization.phone ? normalizeEgyptPhone(body.organization.phone) : '',
    email: body.organization.email ?? '',
    address: {
      governorate: body.organization.governorate ?? '',
      city: body.organization.city ?? '',
    },
    subscription: {
      plan: DEFAULT_SIGNUP_PLAN,
      status: 'trialing',
      startedAt: new Date(),
      maxUsers: planLimits(DEFAULT_SIGNUP_PLAN).maxUsers,
      maxBranches: planLimits(DEFAULT_SIGNUP_PLAN).maxBranches,
      monthlyTicketLimit: planLimits(DEFAULT_SIGNUP_PLAN).monthlyTicketLimit,
    },
    onboardedAt: new Date(),
  });

  // الفترة التجريبية تبدأ من هنا: الحدود من باقة التسجيل لمدة TRIAL_DAYS
  const trialState = await startTrial(String(organization._id), DEFAULT_SIGNUP_PLAN);

  const organizationId = new Types.ObjectId(String(organization._id));

  const result = await runWithTenantContext(
    {
      actor: {
        userId: new Types.ObjectId().toString(),
        organizationId,
        branchId: null,
        role: 'owner',
        fullName: body.owner.fullName,
      },
      organizationId,
      branchId: null,
      requestId: req.requestId ?? '',
      ip: req.ip,
      userAgent: req.headers['user-agent'] ?? '',
    },
    async () => {
      const branch = await BranchModel.create({
        organizationId,
        name: body.branch?.name ?? body.organization.name,
        code: (body.branch?.code ?? 'MAIN').toUpperCase(),
        phone: body.organization.phone ? normalizeEgyptPhone(body.organization.phone) : '',
        isDefault: true,
        isActive: true,
      });

      const user = new UserModel({
        organizationId,
        branchIds: [branch._id],
        fullName: body.owner.fullName,
        username: body.owner.username,
        // لا نكتب '' — الفهرس الفريد sparse يتجاهل المفقود لا الفارغ (انظر التعليق في createUser)
        ...(body.owner.email ? { email: body.owner.email } : {}),
        ...(body.owner.phone ? { phone: normalizeEgyptPhone(body.owner.phone) } : {}),
        role: 'owner',
        isActive: true,
      });
      await user.setPassword(body.owner.password);
      await user.save();

      organization.createdBy = new Types.ObjectId(String(user._id));
      await organization.save();

      branch.managerId = new Types.ObjectId(String(user._id));
      await branch.save();

      return { user, branch };
    },
  );

  const tokens = issueTokens({
    userId: String(result.user._id),
    organizationId: String(organization._id),
    branchId: String(result.branch._id),
    role: 'owner',
    fullName: result.user.fullName,
  });

  return created(res, {
    ...tokens,
    user: serializeUser(result.user as unknown as SafeUserShape),
    organization: {
      id: String(organization._id),
      name: organization.name,
      slug: organization.slug,
      role: 'owner',
      subscription: {
        plan: trialState.planKey,
        status: trialState.status,
        expiresAt: trialState.expiresAt,
        maxUsers: trialState.plan.maxUsers,
        maxBranches: trialState.plan.maxBranches,
        monthlyTicketLimit: trialState.plan.monthlyTicketLimit,
      },
      settings: organization.settings,
    },
    branch: { id: String(result.branch._id), name: result.branch.name, code: result.branch.code },
  });
});

/** تغيير كلمة المرور */
export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const body = req.body as ChangePasswordInput;

  const user = await UserModel.findById(auth.userId).select('+passwordHash');
  if (!user) throw ApiError.notFound('المستخدم غير موجود');

  const valid = await user.verifyPassword(body.currentPassword);
  if (!valid) throw ApiError.badRequest('كلمة المرور الحالية غير صحيحة');

  await user.setPassword(body.newPassword);
  user.mustChangePassword = false;
  await user.save();

  await recordAudit(
    { action: 'password_change', resource: 'User', resourceId: String(user._id), summary: 'تغيير كلمة المرور' },
    req,
  );

  return ok(res, { message: 'تم تغيير كلمة المرور بنجاح' });
});

/* ------------------------------------------------------------------ */
/*  المصادقة الثنائية (TOTP)                                          */
/* ------------------------------------------------------------------ */

/** يبدأ إعدادًا جديدًا ويُرجع السر وQR — لا يُفعّل شيئًا حتى تأكيد الرمز. */
export const beginTwoFactorSetup = asyncHandler(async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const user = await UserModel.findById(auth.userId).select('+twoFactorSecret +twoFactorPendingSecret');
  if (!user) throw ApiError.notFound('المستخدم غير موجود');
  if (user.twoFactorEnabled) {
    throw ApiError.businessRule('التحقق بخطوتين مفعّل بالفعل. أوقفه أولًا لإعادة الإعداد.');
  }

  const organization = await OrganizationModel.findById(user.organizationId).select('name slug').lean();
  const secret = generateTotpSecret();
  user.twoFactorPendingSecret = encryptTwoFactorSecret(secret);
  await user.save();

  const otpauthUri = buildOtpAuthUri({
    secret,
    username: user.username,
    organizationSlug: organization?.slug,
    organizationName: organization?.name,
  });
  const qrDataUrl = await buildTotpQrDataUrl(otpauthUri);

  await recordAudit(
    {
      action: 'update',
      resource: 'User',
      resourceId: String(user._id),
      summary: 'بدء إعداد التحقق بخطوتين',
    },
    req,
  );

  return ok(res, {
    secret,
    otpauthUri,
    qrDataUrl,
    message: 'امسح رمز QR بتطبيق المصادقة ثم أدخل الرمز المكوّن من 6 أرقام لتأكيد التفعيل.',
  });
});

/** يؤكّد السر المعلّق ويفعّل 2FA ويُرجع رموز الاسترداد مرة واحدة فقط. */
export const enableTwoFactor = asyncHandler(async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const { code } = req.body as TwoFactorCodeInput;

  const user = await UserModel.findById(auth.userId).select(
    '+twoFactorPendingSecret +twoFactorSecret +twoFactorRecoveryCodeHashes',
  );
  if (!user) throw ApiError.notFound('المستخدم غير موجود');
  if (user.twoFactorEnabled) throw ApiError.businessRule('التحقق بخطوتين مفعّل بالفعل');
  if (!user.twoFactorPendingSecret) throw ApiError.badRequest('ابدأ إعداد التحقق بخطوتين أولًا');

  let valid = false;
  try {
    valid = verifyTotp(decryptTwoFactorSecret(user.twoFactorPendingSecret), code);
  } catch {
    valid = false;
  }
  if (!valid) {
    throw ApiError.badRequest('رمز التحقق غير صحيح. تأكد من ضبط ساعة الجهاز ثم أعد المحاولة.');
  }

  const { codes, hashes } = generateRecoveryCodes();
  user.twoFactorSecret = user.twoFactorPendingSecret;
  user.twoFactorPendingSecret = null;
  user.twoFactorEnabled = true;
  user.twoFactorEnabledAt = new Date();
  user.twoFactorRecoveryCodeHashes = hashes;
  await user.save();

  await recordAudit(
    {
      action: 'two_factor_enabled',
      resource: 'User',
      resourceId: String(user._id),
      summary: `تفعيل التحقق بخطوتين: ${user.username}`,
      severity: 'warning',
    },
    req,
  );

  return ok(res, {
    twoFactorEnabled: true,
    recoveryCodes: codes,
    message: 'تم تفعيل التحقق بخطوتين. احفظ رموز الاسترداد في مكان آمن — لن تُعرض مرة أخرى.',
  });
});

/** إيقاف 2FA يتطلب كلمة المرور + رمز TOTP صالح أو رمز استرداد. */
export const disableTwoFactor = asyncHandler(async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const { password, code } = req.body as DisableTwoFactorInput;

  const user = await UserModel.findById(auth.userId).select(
    '+passwordHash +twoFactorSecret +twoFactorRecoveryCodeHashes',
  );
  if (!user) throw ApiError.notFound('المستخدم غير موجود');
  if (!user.twoFactorEnabled) throw ApiError.businessRule('التحقق بخطوتين غير مفعّل');

  const passwordValid = await user.verifyPassword(password);
  if (!passwordValid) throw ApiError.badRequest('كلمة المرور غير صحيحة');

  let valid = false;
  try {
    valid = user.twoFactorSecret ? verifyTotp(decryptTwoFactorSecret(user.twoFactorSecret), code) : false;
  } catch {
    valid = false;
  }

  if (!valid) {
    const recoveryHash = hashRecoveryCode(code);
    const consumed = await UserModel.updateOne(
      { _id: user._id, twoFactorRecoveryCodeHashes: recoveryHash },
      { $pull: { twoFactorRecoveryCodeHashes: recoveryHash } },
    );
    valid = consumed.modifiedCount === 1;
  }
  if (!valid) throw ApiError.badRequest('رمز التحقق أو رمز الاسترداد غير صحيح');

  user.twoFactorEnabled = false;
  user.twoFactorSecret = null;
  user.twoFactorPendingSecret = null;
  user.twoFactorEnabledAt = null;
  user.twoFactorRecoveryCodeHashes = [];
  await user.save();

  await recordAudit(
    {
      action: 'two_factor_disabled',
      resource: 'User',
      resourceId: String(user._id),
      summary: `إيقاف التحقق بخطوتين: ${user.username}`,
      severity: 'warning',
    },
    req,
  );

  return ok(res, {
    twoFactorEnabled: false,
    message: 'تم إيقاف التحقق بخطوتين. يمكنك إعادة تفعيله في أي وقت.',
  });
});

/** تجديد رموز الاسترداد يتطلب كلمة المرور + رمز TOTP حالي. */
export const regenerateRecoveryCodes = asyncHandler(async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const { password, code } = req.body as RegenerateRecoveryCodesInput;

  const user = await UserModel.findById(auth.userId).select('+passwordHash +twoFactorSecret');
  if (!user) throw ApiError.notFound('المستخدم غير موجود');
  if (!user.twoFactorEnabled || !user.twoFactorSecret) {
    throw ApiError.businessRule('التحقق بخطوتين غير مفعّل');
  }

  const passwordValid = await user.verifyPassword(password);
  if (!passwordValid) throw ApiError.badRequest('كلمة المرور غير صحيحة');

  let valid = false;
  try {
    valid = verifyTotp(decryptTwoFactorSecret(user.twoFactorSecret), code);
  } catch {
    valid = false;
  }
  if (!valid) throw ApiError.badRequest('رمز التحقق غير صحيح');

  const { codes, hashes } = generateRecoveryCodes();
  user.twoFactorRecoveryCodeHashes = hashes;
  await user.save();

  await recordAudit(
    {
      action: 'two_factor_recovery_regenerated',
      resource: 'User',
      resourceId: String(user._id),
      summary: `تجديد رموز استرداد التحقق بخطوتين: ${user.username}`,
      severity: 'warning',
    },
    req,
  );

  return ok(res, {
    recoveryCodes: codes,
    message: 'تم تجديد رموز الاسترداد. الرموز القديمة لم تعد صالحة — احفظ الجديدة الآن.',
  });
});

/** حالة 2FA للمستخدم الحالي — لا يكشف السر ولا الرموز. */
export const twoFactorStatus = asyncHandler(async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const user = await UserModel.findById(auth.userId).select('+twoFactorRecoveryCodeHashes');
  if (!user) throw ApiError.notFound('المستخدم غير موجود');

  return ok(res, {
    enabled: Boolean(user.twoFactorEnabled),
    enabledAt: user.twoFactorEnabledAt ?? null,
    recoveryCodesRemaining: (user.twoFactorRecoveryCodeHashes ?? []).length,
    recommended: ['owner', 'admin', 'manager'].includes(user.role),
  });
});

/** تحديث الملف الشخصي */
export const updateProfile = asyncHandler(async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const body = req.body as UpdateProfileInput;

  const user = await UserModel.findById(auth.userId);
  if (!user) throw ApiError.notFound('المستخدم غير موجود');

  if (body.fullName) user.fullName = body.fullName;
  if (body.phone) user.phone = normalizeEgyptPhone(body.phone);
  if (body.email !== undefined) user.email = body.email;
  if (body.locale) user.locale = body.locale;
  if (body.technicianProfile) {
    user.technicianProfile = {
      ...(user.technicianProfile ?? {}),
      ...body.technicianProfile,
    } as typeof user.technicianProfile;
  }

  await user.save();

  return ok(res, { user: serializeUser(user as unknown as SafeUserShape) });
});

/* ------------------------------------------------------------------ */
/*  إدارة المستخدمين (Users, Roles & Permissions)                      */
/* ------------------------------------------------------------------ */

export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  const { role, isActive, q } = req.query as Record<string, string | undefined>;
  const filter: Record<string, unknown> = {};
  if (role) filter.role = role;
  if (isActive !== undefined) filter.isActive = isActive === 'true';
  if (q) filter.$or = [{ fullName: new RegExp(q, 'i') }, { username: new RegExp(q, 'i') }];

  const users = await UserModel.find(filter).sort({ role: 1, fullName: 1 }).lean();
  return ok(res, users.map((u) => serializeUser(u as unknown as SafeUserShape)));
});

export const getUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await UserModel.findById(req.params.id);
  if (!user) throw ApiError.notFound('المستخدم غير موجود');
  return ok(res, serializeUser(user as unknown as SafeUserShape));
});

export const createUser = asyncHandler(async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const body = req.body as CreateUserInput;

  // فرض حد الباقة قبل أي إنشاء — كان غير مفروضًا سابقًا
  await assertUserLimit(auth.organizationId);

  const exists = await UserModel.findOne({ username: body.username }).lean();
  if (exists) throw ApiError.conflict('اسم المستخدم مستخدم بالفعل');

  if (body.email) {
    const emailExists = await UserModel.findOne({ email: body.email }).lean();
    if (emailExists) throw ApiError.conflict('البريد الإلكتروني مستخدم بالفعل');
  }

  const user = new UserModel({
    organizationId: new Types.ObjectId(auth.organizationId),
    branchIds: (body.branchIds ?? [auth.branchId].filter(Boolean)).map((b) => new Types.ObjectId(String(b))),
    fullName: body.fullName,
    username: body.username,
    // ملاحظة مهمة: لا نكتب '' في email/phone.
    // فهرس {organizationId, email} فريد وsparse، وsparse يتجاهل **المفقود** لا **الفارغ**.
    // كتابة '' كانت تمنع إضافة أكثر من مستخدم بلا بريد في نفس المركز (Mongo E11000).
    ...(body.email ? { email: body.email } : {}),
    ...(body.phone ? { phone: normalizeEgyptPhone(body.phone) } : {}),
    role: body.role,
    extraPermissions: body.extraPermissions ?? [],
    deniedPermissions: body.deniedPermissions ?? [],
    technicianProfile: body.technicianProfile ?? { isTechnician: body.role === 'technician' },
    isActive: true,
    createdBy: new Types.ObjectId(auth.userId),
  });
  await user.setPassword(body.password);
  await user.save();

  await recordAudit(
    {
      action: 'create',
      resource: 'User',
      resourceId: String(user._id),
      summary: `إنشاء مستخدم: ${user.username} بدور ${user.role}`,
    },
    req,
  );

  return created(res, serializeUser(user as unknown as SafeUserShape));
});

export const updateUser = asyncHandler(async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const body = req.body as UpdateUserInput;

  const user = await UserModel.findById(req.params.id).select('+passwordHash');
  if (!user) throw ApiError.notFound('المستخدم غير موجود');

  const before: Record<string, unknown> = { role: user.role, isActive: user.isActive };

  if (body.fullName) user.fullName = body.fullName;
  if (body.email !== undefined) {
    // تفريغ البريد يجب أن يجعله **مفقودًا** لا سلسلة فارغة، وإلا اصطدم بالفهرس الفريد sparse
    if (body.email) user.email = body.email;
    else user.set('email', undefined);
  }
  if (body.phone) user.phone = normalizeEgyptPhone(body.phone);
  if (body.role) user.role = body.role;
  if (body.branchIds) user.branchIds = body.branchIds.map((b) => new Types.ObjectId(b));
  if (body.extraPermissions) user.extraPermissions = body.extraPermissions;
  if (body.deniedPermissions) user.deniedPermissions = body.deniedPermissions;
  if (body.isActive !== undefined) user.isActive = body.isActive;
  if (body.technicianProfile) {
    user.technicianProfile = { ...(user.technicianProfile ?? {}), ...body.technicianProfile } as typeof user.technicianProfile;
  }
  if (body.newPassword) {
    await user.setPassword(body.newPassword);
    user.mustChangePassword = true;
  }

  // منع تعطيل/تخفيض آخر مالك في المؤسسة
  if ((body.isActive === false || (body.role && body.role !== 'owner')) && user.role === 'owner') {
    const owners = await UserModel.countDocuments({ role: 'owner', isActive: true });
    if (owners <= 1) {
      throw ApiError.businessRule('لا يمكن تعطيل أو تغيير دور آخر مالك في المركز');
    }
  }

  await user.save();

  if (body.role && body.role !== before.role) {
    await recordAudit(
      {
        action: 'permission_change',
        resource: 'User',
        resourceId: String(user._id),
        summary: `تغيير دور ${user.username}: ${String(before.role)} → ${user.role}`,
        changes: [{ field: 'role', before: before.role, after: user.role }],
        severity: 'warning',
      },
      req,
    );
  } else {
    await recordAudit(
      { action: 'update', resource: 'User', resourceId: String(user._id), summary: `تحديث مستخدم: ${user.username}` },
      req,
    );
  }

  void auth;
  return ok(res, serializeUser(user as unknown as SafeUserShape));
});

export const deactivateUser = asyncHandler(async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (String(req.params.id) === auth.userId) {
    throw ApiError.businessRule('لا يمكنك تعطيل حسابك الحالي');
  }

  const user = await UserModel.findById(req.params.id);
  if (!user) throw ApiError.notFound('المستخدم غير موجود');

  if (user.role === 'owner') {
    const owners = await UserModel.countDocuments({ role: 'owner', isActive: true });
    if (owners <= 1) throw ApiError.businessRule('لا يمكن تعطيل آخر مالك في المركز');
  }

  user.isActive = false;
  await user.save();

  await recordAudit(
    { action: 'delete', resource: 'User', resourceId: String(user._id), summary: `تعطيل مستخدم: ${user.username}`, severity: 'warning' },
    req,
  );

  return ok(res, { message: 'تم تعطيل المستخدم' });
});

/**
 * إعادة تعيين 2FA لمستخدم آخر بواسطة الإدارة.
 * المسار الوحيد لاستعادة الحساب عند فقد الهاتف وكل رموز الاسترداد معًا.
 * لا يسمح بتعطيل 2FA عن حساب المدير نفسه — يستخدم تدفق الإيقاف العادي.
 */
export const resetUserTwoFactor = asyncHandler(async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (String(req.params.id) === auth.userId) {
    throw ApiError.businessRule('لا يمكنك إعادة تعيين التحقق بخطوتين لحسابك الحالي — استخدم إعدادات الأمان');
  }

  const user = await UserModel.findById(req.params.id).select(
    '+twoFactorSecret +twoFactorPendingSecret +twoFactorRecoveryCodeHashes',
  );
  if (!user) throw ApiError.notFound('المستخدم غير موجود');
  if (!user.twoFactorEnabled && !user.twoFactorPendingSecret) {
    throw ApiError.businessRule('التحقق بخطوتين غير مفعّل لهذا المستخدم');
  }

  user.twoFactorEnabled = false;
  user.twoFactorSecret = null;
  user.twoFactorPendingSecret = null;
  user.twoFactorEnabledAt = null;
  user.twoFactorRecoveryCodeHashes = [];
  await user.save();

  await recordAudit(
    {
      action: 'two_factor_disabled',
      resource: 'User',
      resourceId: String(user._id),
      summary: `إعادة تعيين التحقق بخطوتين بواسطة الإدارة: ${user.username}`,
      severity: 'critical',
    },
    req,
  );

  return ok(res, {
    message: 'تمت إعادة تعيين التحقق بخطوتين. على المستخدم تسجيل الدخول بكلمة المرور وإعادة الإعداد.',
  });
});

/** قائمة الأدوار والصلاحيات المتاحة لعرضها في الواجهة — أدوار المركز فقط */
export const rolesCatalog = asyncHandler(async (_req: Request, res: Response) => {
  const { CENTER_ASSIGNABLE_ROLES, ROLE_LABELS_AR, ROLE_PERMISSIONS, CENTER_ASSIGNABLE_PERMISSIONS } = await import(
    '../constants/roles.js'
  );
  return ok(res, {
    roles: CENTER_ASSIGNABLE_ROLES.map((role) => ({
      value: role,
      label: ROLE_LABELS_AR[role],
      permissions: ROLE_PERMISSIONS[role] as Permission[],
    })),
    allPermissions: CENTER_ASSIGNABLE_PERMISSIONS,
  });
});

/* ------------------------------------------------------------------ */
/* استعادة كلمة المرور (Self-service)                                   */
/* ------------------------------------------------------------------ */

/**
 * طلب رمز استعادة كلمة المرور.
 *
 * الأمان:
 *  - الرد دائمًا عام مهما كان البريد موجودًا (لا يكشف قائمة مستخدمي المنصة).
 *  - نخزّن SHA-256 للرمز مع صلاحية 30 دقيقة، ونستخدمه مرة واحدة.
 *  - إعادة الطلب تُلغي أي رمز سابق (حقل واحد فقط).
 *  - في بيئة التطوير نُرجع الرمز نفسه في الاستجابة لتسهيل الاختبار بدون بريد.
 */
export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  const { email } = req.body as ForgotPasswordInput;

  // تنظيف الرموز المنتهية — عملية رخيصة تُدار مع كل طلب بدل مهمة منفصلة
  await runAsSystem(() =>
    UserModel.updateMany(
      { passwordResetExpiresAt: { $ne: null, $lt: new Date() } },
      { $unset: { passwordResetTokenHash: '', passwordResetExpiresAt: '' } },
    ),
  );

  /**
   * البريد فريد داخل المركز فقط، فقد ينتمي لحسابات في أكثر من مركز. ننشئ رمزًا
   * لكل حساب مطابق (في الإنتاج تصل رسالة لكل حساب) بدل إعادة تعيين حساب اعتباطي.
   */
  interface ResetCandidate {
    _id: Types.ObjectId;
    username: string;
    fullName: string;
    role: string;
    organizationId: Types.ObjectId;
    isActive?: boolean;
  }
  const users = (await runAsSystem(() =>
    UserModel.find({ email }).select('+passwordResetTokenHash isActive').lean(),
  )) as unknown as ResetCandidate[];

  const activeUsers = users.filter((u) => u.isActive === true);

  interface OrgRow {
    _id: Types.ObjectId;
    slug: string;
    name: string;
  }
  const orgs = (activeUsers.length
    ? await runAsSystem(() =>
        OrganizationModel.find({ _id: { $in: activeUsers.map((u) => u.organizationId) } })
          .select('slug name')
          .lean(),
      )
    : []) as unknown as OrgRow[];
  const orgByUserId = new Map(orgs.map((o) => [String(o._id), o]));

  const devTokens: { organizationSlug: string; organizationName: string; resetToken: string }[] = [];

  for (const user of activeUsers) {
    const { token, hash } = generatePasswordResetToken();
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60_000);
    await runAsSystem(async () => {
      await UserModel.updateOne(
        { _id: user._id },
        { $set: { passwordResetTokenHash: hash, passwordResetExpiresAt: expiresAt } },
      );
    });

    await runAsSystem(async () => {
      await recordAudit({
        action: 'password_change',
        resource: 'User',
        resourceId: String(user._id),
        summary: `طلب رمز استعادة كلمة المرور: ${user.username}`,
        context: {
          actor: {
            userId: String(user._id),
            organizationId: user.organizationId as Types.ObjectId,
            branchId: null,
            role: user.role as Role,
            fullName: user.fullName,
          },
          organizationId: user.organizationId as Types.ObjectId,
          branchId: null,
          requestId: req.requestId ?? '',
          ip: req.ip,
          userAgent: req.headers['user-agent'] ?? '',
        },
      });
    });

    if (!env.isProd) {
      const org = orgByUserId.get(String(user.organizationId));
      devTokens.push({
        organizationSlug: org?.slug ?? '',
        organizationName: org?.name ?? '',
        resetToken: token,
      });
    }
  }

  // وضع التطوير فقط: رمز واحد → نفس شكل الاستجابة السابق؛ أكثر من حساب → رمز لكل مركز
  const devExtras =
    devTokens.length === 0
      ? {}
      : devTokens.length === 1
        ? { resetToken: devTokens[0]!.resetToken, note: 'رمز تطوير — في الإنتاج يُرسل بالبريد فقط' }
        : {
            resetTokens: devTokens,
            note: `البريد مرتبط بـ${devTokens.length} مراكز — رمز لكل حساب (وضع التطوير فقط)`,
          };

  return ok(res, {
    message: 'لو كان البريد مسجلًا لدينا فستصلك رسالة تحتوي رمز استعادة كلمة المرور',
    ...devExtras,
  });
});

/**
 * تعيين كلمة مرور جديدة برمز الاستعادة.
 * الرمز يُستخدم مرة واحدة، ونصفّر عدّاد المحاولات الفاشلة والقفل عند النجاح.
 */
export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const { token, password } = req.body as ResetPasswordInput;
  const tokenHash = hashToken(token);

  /**
   * استهلاك ذري للرمز: شرط التحديث يضم الرمز وسلامة صلاحيته معًا، وتصفيره يحدث
   * في نفس العملية — فلا نافذة سباق بين "فحص" و"حفظ"، ولا يمكن استخدام الرمز
   * مرتين حتى تحت طلبات متزامنة ( findOneAndUpdate ذرية).
   */
  const user = await runAsSystem(() =>
    UserModel.consumePasswordResetToken(tokenHash, password),
  );

  if (!user) {
    throw ApiError.badRequest('رمز الاستعادة غير صحيح أو منتهي الصلاحية، اطلب رمزًا جديدًا');
  }

  await runAsSystem(async () => {
    await recordAudit({
      action: 'password_change',
      resource: 'User',
      resourceId: String(user._id),
      summary: `تعيين كلمة مرور جديدة عبر رمز الاستعادة: ${user.username}`,
      severity: 'warning',
      context: {
        actor: {
          userId: String(user._id),
          organizationId: user.organizationId as Types.ObjectId,
          branchId: null,
          role: user.role as Role,
          fullName: user.fullName,
        },
        organizationId: user.organizationId as Types.ObjectId,
        branchId: null,
        requestId: req.requestId ?? '',
        ip: req.ip,
        userAgent: req.headers['user-agent'] ?? '',
      },
    });
  });

  return ok(res, { message: 'تم تحديث كلمة المرور، يمكنك تسجيل الدخول الآن' });
});
