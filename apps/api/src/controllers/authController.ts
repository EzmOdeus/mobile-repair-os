import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { OrganizationModel } from '../models/Organization.js';
import { BranchModel } from '../models/Branch.js';
import { UserModel } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler, created, ok } from '../utils/asyncHandler.js';
import { slugifyWithSuffix } from '../utils/ids.js';
import { permissionsForRole, type Permission, type Role } from '../constants/roles.js';
import { normalizeEgyptPhone } from '../validators/common.js';
import {
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../services/tokenService.js';
import { recordAudit } from '../services/auditService.js';
import { assertUserLimit } from '../services/planService.js';
import { DEFAULT_SIGNUP_PLAN, planLimits } from '../constants/plans.js';
import { logger } from '../config/logger.js';
import { runAsSystem, runWithTenantContext, type TenantContext } from '../context/tenantContext.js';
import { effectivePermissions, getAuth } from '../middleware/auth.js';
import type {
  ChangePasswordInput,
  CreateUserInput,
  LoginInput,
  RegisterOrganizationInput,
  UpdateProfileInput,
  UpdateUserInput,
} from '../validators/authValidators.js';
import type { LoginInput as _Login } from '../validators/authValidators.js';

const MAX_LOGIN_ATTEMPTS = 8;
const LOCK_MINUTES = 15;

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

  /** سياق تدقيق صريح: مسار الدخول عام (بلا توكن/سياق مستأجر) لكننا نعرف مؤسسة المستخدم */
  const loginAuditContext = (): TenantContext => ({
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
  });

  if (!user.isActive) throw ApiError.forbidden('الحساب موقوف، راجع مدير المركز');
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    await recordAudit({
      action: 'login_failed',
      resource: 'User',
      resourceId: String(user._id),
      summary: `محاولة دخول لحساب مقفول مؤقتًا: ${user.username}`,
      severity: 'warning',
      context: loginAuditContext(),
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
      context: loginAuditContext(),
    });

    throw ApiError.unauthorized('بيانات الدخول غير صحيحة');
  }

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
      await recordAudit(
        {
          action: 'login',
          resource: 'User',
          resourceId: String(user._id),
          summary: `تسجيل دخول: ${user.username}`,
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
        plan: organization.subscription?.plan ?? 'starter',
        status: organization.subscription?.status ?? 'trialing',
        maxUsers: organization.subscription?.maxUsers ?? 5,
        maxBranches: organization.subscription?.maxBranches ?? 2,
        monthlyTicketLimit: organization.subscription?.monthlyTicketLimit ?? 300,
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

/** قائمة الأدوار والصلاحيات المتاحة لعرضها في الواجهة */
export const rolesCatalog = asyncHandler(async (_req: Request, res: Response) => {
  const { ROLES, ROLE_LABELS_AR, ROLE_PERMISSIONS, PERMISSIONS } = await import('../constants/roles.js');
  return ok(res, {
    roles: ROLES.map((role) => ({
      value: role,
      label: ROLE_LABELS_AR[role],
      permissions: ROLE_PERMISSIONS[role] as Permission[],
    })),
    allPermissions: PERMISSIONS,
  });
});
