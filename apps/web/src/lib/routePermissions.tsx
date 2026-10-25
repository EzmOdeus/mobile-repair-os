import type { ReactNode } from 'react';
import type { Role } from './auth';
import {
  BarChart3,
  Bell,
  BookOpen,
  Calculator,
  Globe,
  ClipboardCheck,
  HardHat,
  LayoutDashboard,
  Package,
  Receipt,
  ScrollText,
  Settings,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Store,
  TrendingUp,
  Users,
  Wallet,
  Wrench,
} from 'lucide-react';

/** كل الأدوار ما عدا الفني — الشاشات الإدارية التي لا تخص ورشة الفني */
export const NOT_TECHNICIAN: Role[] = ['owner', 'admin', 'manager', 'receptionist', 'accountant', 'viewer'];

/**
 * شاشة الفني مقصورة على الورشة والإدارة. الاستقبال يملك technician:read
 * (لازمة لاختيار الفني عند الإسناد) فلا يكفي فحص الصلاحية وحده.
 */
export const WORKSHOP_ROLES: Role[] = ['owner', 'admin', 'manager', 'technician'];

/**
 * قائمة التذاكر شاشة تشغيل: الاستقبال يشغّلها والمشاهد يتابعها.
 * الفني له شاشته الخاصة والمحاسب يدخل من الفواتير — امتلاكهم ticket:read
 * لعملهم داخل التذكرة الواحدة لا يجعل قائمة التذاكر شاشتهم.
 */
export const TICKET_DESK_ROLES: Role[] = ['owner', 'admin', 'manager', 'receptionist', 'viewer'];

/**
 * فحص الجودة: الفني ينفّذه والإدارة تتابعه. الاستقبال يملك qc:read لمتابعة
 * حالة التذكرة لكن شاشة الفحوص ليست من شاشاته.
 */
export const QUALITY_ROLES: Role[] = ['owner', 'admin', 'manager', 'technician'];

/**
 * المخزون: إدارة وأصول (موردون وتكاليف). الاستقبال يستعلم عن القطع من داخل
 * التذكرة وعرض السعر، فلا تحتاج شاشة المخزون الكاملة.
 */
export const INVENTORY_ROLES: Role[] = ['owner', 'admin', 'manager', 'accountant', 'viewer'];

/** المسار الافتراضي لكل دور بعد الدخول — كل دور يبدأ من شاشته، لا من شاشة غيره */
export function homePathForRole(role?: Role | null): string {
  switch (role) {
    case 'technician':
      return '/technician';
    case 'receptionist':
      return '/tickets';
    case 'accountant':
      return '/invoices';
    case 'platform':
      return '/platform';
    default:
      return '/dashboard';
  }
}

/**
 * خريطة صلاحيات الصفحات — **المصدر الوحيد** الذي يغذّي:
 *   1) عناصر السايد بار (إخفاء ما لا يملكه المستخدم)
 *   2) حارس المسارات `RequirePermission` (منع الوصول المباشر بالرابط)
 *
 * السبب في توحيدها: قبل ذلك كان كل عنصر يحمل صلاحيته داخل `AppShell` وحده، فكان
 * بإمكان أي مستخدم كتابة المسار يدويًا ورؤية الصفحة. الآن نفس الخريطة تحمي الاتجاهين.
 *
 * قاعدة مهمة: كل عنصر في السايد بار **يجب** أن يحمل صلاحية. لا يوجد عنصر مفتوح،
 * وإلا أصبح ثغرة. لو أردت صفحة متاحة للجميع فأضف الصلاحية لكل الأدوار في
 * `apps/api/src/constants/roles.ts`.
 */
export interface RoutePermission {
  href: string;
  label: string;
  icon: ReactNode;
  /** الصلاحية المطلوبة لعرض الرابط وللدخول للصفحة */
  permission: string;
  /**
   * صلاحيات بديلة: يكفي توفر **واحدة** منها للوصول.
   * تُستخدم للصفحات المركّبة مثل الإعدادات التي تضم أقسامًا بصلاحيات مختلفة.
   */
  anyOf?: string[];
  /**
   * قائمة أدوار مسموحة (Allowlist). إذا وُجدت فلا يظهر الرابط ولا يُسمح بالدخول
   * إلا لهذه الأدوار — حتى لو كانت الصلاحية متاحة للدور.
   * تُستخدم لفصل شاشات الفني عن الشاشات الإدارية رغم امتلاكه صلاحيات قراءة لها.
   */
  roles?: Role[];
  /** وصف قصير يظهر في شاشة «لا تملك صلاحية» */
  description: string;
}

export interface NavGroup {
  title: string;
  items: RoutePermission[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'التشغيل',
    items: [
      {
        href: '/dashboard',
        label: 'لوحة التحكم',
        icon: <LayoutDashboard size={18} />,
        permission: 'dashboard:read',
        roles: NOT_TECHNICIAN,
        description: 'مؤشرات التشغيل اليومية',
      },
      {
        href: '/tickets',
        label: 'تذاكر الصيانة',
        icon: <Wrench size={18} />,
        permission: 'ticket:read',
        roles: TICKET_DESK_ROLES,
        description: 'كل تذاكر الصيانة وحالاتها',
      },
      {
        href: '/technician',
        label: 'شاشة الفني',
        icon: <HardHat size={18} />,
        permission: 'technician:read',
        roles: WORKSHOP_ROLES,
        description: 'مهام الفنيين وتوزيع الأحمال',
      },
      {
        href: '/quality',
        label: 'فحص الجودة',
        icon: <ClipboardCheck size={18} />,
        permission: 'qc:read',
        roles: QUALITY_ROLES,
        description: 'فحوص الجودة قبل التسليم',
      },
      {
        href: '/pos',
        label: 'نقاط البيع',
        icon: <Store size={18} />,
        permission: 'pos:operate',
        roles: ['owner', 'admin', 'manager', 'receptionist', 'accountant'],
        description: 'بيع مباشر من المخزون وتحصيل فوري',
      },
    ],
  },
  {
    title: 'البيانات',
    items: [
      {
        href: '/customers',
        label: 'العملاء',
        icon: <Users size={18} />,
        permission: 'customer:read',
        roles: NOT_TECHNICIAN,
        description: 'ملفات العملاء وسجلهم',
      },
      {
        href: '/devices',
        label: 'الأجهزة',
        icon: <Smartphone size={18} />,
        permission: 'device:read',
        roles: NOT_TECHNICIAN,
        description: 'الأجهزة وجواز كل جهاز',
      },
      {
        href: '/inventory',
        label: 'قطع الغيار والمخزون',
        icon: <Package size={18} />,
        permission: 'part:read',
        roles: INVENTORY_ROLES,
        description: 'القطع وأرصدة الفروع',
      },
      {
        href: '/purchases',
        label: 'المشتريات والموردون',
        icon: <ShoppingCart size={18} />,
        permission: 'purchase:read',
        roles: INVENTORY_ROLES,
        description: 'أوامر الشراء والاستلام وحسابات الموردين',
      },
    ],
  },
  {
    title: 'السوق والبورصة',
    items: [
      {
        href: '/market',
        label: 'ماركت بلس',
        icon: <ShoppingBag size={18} />,
        permission: 'market:read',
        roles: NOT_TECHNICIAN,
        description: 'بيع وشراء الأجهزة بين المراكز والمحلات',
      },
      {
        href: '/market/prices',
        label: 'بورصة الأسعار',
        icon: <TrendingUp size={18} />,
        permission: 'market:read',
        roles: NOT_TECHNICIAN,
        description: 'دليل الأسعار ومؤشر السوق وتقييم الأجهزة',
      },
    ],
  },
  {
    title: 'المال والضمان',
    items: [
      {
        href: '/invoices',
        label: 'الفواتير والمدفوعات',
        icon: <Receipt size={18} />,
        permission: 'invoice:read',
        roles: NOT_TECHNICIAN,
        description: 'الفواتير والتحصيل',
      },
      {
        href: '/shifts',
        label: 'الورديات والخزينة',
        icon: <Wallet size={18} />,
        permission: 'shift:read',
        roles: NOT_TECHNICIAN,
        description: 'فتح وإغلاق الورديات ومطابقة النقد',
      },
      {
        href: '/warranty',
        label: 'الضمان والمطالبات',
        icon: <ShieldCheck size={18} />,
        permission: 'warranty:read',
        roles: NOT_TECHNICIAN,
        description: 'مطالبات الضمان وتحليلها',
      },
      {
        href: '/analytics',
        label: 'التحليلات',
        icon: <BarChart3 size={18} />,
        permission: 'analytics:read',
        description: 'التقارير ومؤشرات الأداء',
      },
      {
        href: '/reports',
        label: 'التقارير المالية',
        icon: <Calculator size={18} />,
        permission: 'report:read',
        roles: NOT_TECHNICIAN,
        description: 'الأرباح والخسائر والضريبة وأعمار الديون',
      },
    ],
  },
  {
    title: 'إدارة المنصة',
    items: [
      {
        href: '/platform',
        label: 'لوحة المنصة',
        icon: <Globe size={18} />,
        permission: 'platform:orgs:read',
        roles: ['platform'],
        description: 'كل المراكز وحالات الاشتراك والإحصاءات',
      },
      {
        href: '/platform/market',
        label: 'مراجعة ماركت بلس',
        icon: <ShoppingBag size={18} />,
        permission: 'market:moderate',
        roles: ['platform'],
        description: 'اعتماد أو رفض الإعلانات العامة',
      },
      {
        href: '/platform/prices',
        label: 'دليل أسعار السوق',
        icon: <TrendingUp size={18} />,
        permission: 'market:prices:manage',
        roles: ['platform'],
        description: 'إدارة دليل الأسعار المرجعي للأجهزة',
      },
    ],
  },
  {
    title: 'المعرفة والإعدادات',
    items: [
      {
        href: '/knowledge',
        label: 'قاعدة المعرفة',
        icon: <BookOpen size={18} />,
        permission: 'knowledge:read',
        description: 'أدلة الإصلاح واقتراحات التشخيص',
      },
      {
        href: '/notifications',
        label: 'الإشعارات',
        icon: <Bell size={18} />,
        permission: 'notification:read',
        description: 'سجل الرسائل والتنبيهات',
      },
      {
        href: '/settings',
        label: 'إعدادات المركز',
        icon: <Settings size={18} />,
        // الصفحة تجمع أقسامًا بصلاحيات مختلفة، فيكفي امتلاك أي منها.
        // بدون `anyOf` كان الاستقبال والفني والمشاهدة يدخلون صفحة تغيير
        // السياسات وإدارة المستخدمين رغم أن كل أزرارها معطّلة لهم.
        permission: 'org:update',
        anyOf: ['org:update', 'branch:manage', 'user:manage'],
        description: 'بيانات المركز والفروع والمستخدمون',
      },
      {
        href: '/audit',
        label: 'سجل التدقيق',
        icon: <ScrollText size={18} />,
        permission: 'audit:read',
        roles: ['owner', 'admin', 'accountant'],
        description: 'كل العمليات الحساسة ومن قام بها',
      },
    ],
  },
];

/** كل الصفحات المحمية بصلاحية، مفلطحة — يستخدمها حارس المسارات */
export const PROTECTED_ROUTES: RoutePermission[] = NAV_GROUPS.flatMap((group) => group.items);

/**
 * الصفحات التي لا تحتاج صلاحية من هذه الخريطة (تحتاج تسجيل دخول فقط).
 * مثال: صفحة التذكرة الواحدة — صلاحيتها تُفحص داخل الصفحة حسب بياناتها.
 */
export const ROUTES_WITHOUT_PERMISSION = ['/tickets/', '/customers/', '/devices/', '/invoices/'];

/** يجد الصلاحية المطلوبة لمسار معيّن، أو null إذا لم يكن محميًا بهذه الخريطة */
export function permissionForPath(pathname: string): RoutePermission | null {
  // مطابقة دقيقة أولًا (أولوية للصفحة نفسها على مساراتها الفرعية)
  const exact = PROTECTED_ROUTES.find((route) => route.href === pathname);
  if (exact) return exact;

  // مطابقة بادئة للصفحات الفرعية: /tickets/123 تعود لصلاحية /tickets
  return (
    PROTECTED_ROUTES.find(
      (route) => pathname.startsWith(`${route.href}/`) && !ROUTES_WITHOUT_PERMISSION.some((p) => pathname.startsWith(p)),
    ) ?? null
  );
}

/**
 * هل يملك المستخدم صلاحية الوصول لمسار؟
 * - `anyOf`: يكفي توفر صلاحية واحدة.
 * - `roles`: Allowlist للأدوار — تُفحص فقط عندما تكون هوية الدور معروفة (بعد تحميل الجلسة)،
 *   حتى لا تومض القائمة مخفية أثناء التحميل.
 */
export function canAccessRoute(
  route: RoutePermission | null,
  hasPermission: (permission: string) => boolean,
  role?: Role | null,
): boolean {
  if (!route) return true;
  if (route.roles && role && !route.roles.includes(role)) return false;
  if (hasPermission(route.permission)) return true;
  return (route.anyOf ?? []).some((permission) => hasPermission(permission));
}
