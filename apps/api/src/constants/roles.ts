/**
 * الأدوار والصلاحيات (RBAC) - بديل Supabase RLS
 *
 * كل طلب يحمل: organizationId (من التوكن) + branchId + role + permissions.
 * طبقة الوصول للبيانات تفرض عزل المستأجر (tenant isolation) على كل استعلام،
 * والصلاحيات تُفحص على مستوى المسار (route) قبل الوصول للموديل.
 */

export const ROLES = ['owner', 'admin', 'manager', 'receptionist', 'technician', 'accountant', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS_AR: Record<Role, string> = {
  owner: 'مالك المركز',
  admin: 'مدير النظام',
  manager: 'مدير فرع',
  receptionist: 'موظف استقبال',
  technician: 'فني',
  accountant: 'محاسب',
  viewer: 'مشاهدة فقط',
};

export const PERMISSIONS = [
  // المؤسسة والفروع
  'org:read',
  'org:update',
  'branch:read',
  'branch:manage',
  // لوحة التحكم: كانت بلا صلاحية فكانت مكشوفة لكل الأدوار بلا ضابط
  'dashboard:read',
  // المستخدمون
  'user:read',
  'user:manage',
  // العملاء
  'customer:read',
  'customer:create',
  'customer:update',
  'customer:delete',
  // الأجهزة
  'device:read',
  'device:create',
  'device:update',
  'device:delete',
  // تذاكر الصيانة
  'ticket:read',
  'ticket:create',
  'ticket:update',
  'ticket:assign',
  'ticket:transition',
  'ticket:delete',
  // التشخيص والفحص
  'diagnosis:read',
  'diagnosis:write',
  'qc:read',
  'qc:perform',
  // الأدلة والصور
  'evidence:read',
  'evidence:upload',
  'evidence:delete',
  // العروض والموافقات
  'estimate:read',
  'estimate:write',
  'estimate:approve',
  // الفنيين والوقت
  'technician:read',
  'technician:manage',
  // المخزون وقطع الغيار
  'part:read',
  'part:manage',
  'stock:read',
  'stock:move',
  'supplier:read',
  'supplier:manage',
  // الفواتير والمدفوعات
  'invoice:read',
  'invoice:write',
  'payment:read',
  'payment:record',
  'expense:read',
  'expense:manage',
  // الضمان
  'warranty:read',
  'warranty:manage',
  // نقاط البيع
  'pos:operate',
  // الإشعارات
  'notification:read',
  'notification:send',
  // التقارير والتحليلات
  'report:read',
  'analytics:read',
  // سجل التدقيق
  'audit:read',
  // قاعدة المعرفة
  'knowledge:read',
  'knowledge:write',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL: Permission[] = [...PERMISSIONS];

/** محلل الاستقبال: دورة الاستلام والتسليم والتحصيل */
const RECEPTIONIST: Permission[] = [
  'org:read',
  'branch:read',
  'user:read',
  'customer:read',
  'customer:create',
  'customer:update',
  'device:read',
  'device:create',
  'device:update',
  'ticket:read',
  'ticket:create',
  'ticket:update',
  'ticket:transition',
  'ticket:assign',
  'technician:read',
  'diagnosis:read',
  'qc:read',
  'evidence:read',
  'evidence:upload',
  'estimate:read',
  'estimate:write',
  'estimate:approve',
  'part:read',
  'stock:read',
  'invoice:read',
  'invoice:write',
  'payment:read',
  'payment:record',
  'warranty:read',
  'pos:operate',
  'notification:read',
  'notification:send',
  'report:read',
  'knowledge:read',
];

/** الفني: قائمة أعماله، التشخيص، القطع، الفحص */
const TECHNICIAN: Permission[] = [
  'org:read',
  'dashboard:read',
  'branch:read',
  'user:read',
  'customer:read',
  'device:read',
  'device:update',
  'ticket:read',
  'ticket:update',
  'ticket:transition',
  'diagnosis:read',
  'diagnosis:write',
  'qc:read',
  'qc:perform',
  'evidence:read',
  'evidence:upload',
  'estimate:read',
  'estimate:write',
  'part:read',
  'part:manage',
  'stock:read',
  'stock:move',
  'technician:read',
  'warranty:read',
  'notification:read',
  'knowledge:read',
  'knowledge:write',
];

/** المحاسب: الفواتير والمدفوعات والتقارير والتدقيق */
const ACCOUNTANT: Permission[] = [
  'org:read',
  'branch:read',
  'user:read',
  'customer:read',
  'device:read',
  'ticket:read',
  'estimate:read',
  'part:read',
  'stock:read',
  'supplier:read',
  'supplier:manage',
  'invoice:read',
  'invoice:write',
  'payment:read',
  'payment:record',
  'expense:read',
  'expense:manage',
  'report:read',
  'analytics:read',
  'audit:read',
  'pos:operate',
  'warranty:read',
  'notification:read',
];

/** مدير الفرع: كل شيء داخل الفرع ما عدا إدارة المؤسسة والمستخدمين */
const MANAGER: Permission[] = ALL.filter(
  (p) => !['org:update', 'branch:manage', 'user:manage'].includes(p),
);

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: ALL,
  admin: ALL,
  manager: MANAGER,
  receptionist: RECEPTIONIST,
  technician: TECHNICIAN,
  accountant: ACCOUNTANT,
  viewer: [
    'org:read',
    'dashboard:read',
    'branch:read',
    'customer:read',
    'device:read',
    'ticket:read',
    'diagnosis:read',
    'qc:read',
    'evidence:read',
    'estimate:read',
    'part:read',
    'stock:read',
    'invoice:read',
    'payment:read',
    'warranty:read',
    'report:read',
    'analytics:read',
    'knowledge:read',
    'notification:read',
  ],
};

export function permissionsForRole(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return permissionsForRole(role).includes(permission);
}
