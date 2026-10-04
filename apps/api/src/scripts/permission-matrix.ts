/**
 * مصفوفة الصلاحيات: ما يراه كل دور من صفحات، وما يستطيع فعله.
 * يُستخدم للتحقق من أن الإخفاء في الواجهة مطابق لما يسمح به الـAPI فعلًا.
 */
import { ROLE_PERMISSIONS, type Role } from '../constants/roles.js';

/** نفس خريطة الواجهة: المسار ← الصلاحية المطلوبة */
const PAGE_PERMISSIONS: { href: string; label: string; permission: string }[] = [
  { href: '/dashboard', label: 'لوحة التحكم', permission: 'dashboard:read' },
  { href: '/tickets', label: 'تذاكر الصيانة', permission: 'ticket:read' },
  { href: '/technician', label: 'شاشة الفني', permission: 'technician:read' },
  { href: '/quality', label: 'فحص الجودة', permission: 'qc:read' },
  { href: '/customers', label: 'العملاء', permission: 'customer:read' },
  { href: '/devices', label: 'الأجهزة', permission: 'device:read' },
  { href: '/inventory', label: 'القطع والمخزون', permission: 'part:read' },
  { href: '/invoices', label: 'الفواتير والمدفوعات', permission: 'invoice:read' },
  { href: '/warranty', label: 'الضمان والمطالبات', permission: 'warranty:read' },
  { href: '/analytics', label: 'التحليلات', permission: 'analytics:read' },
  { href: '/knowledge', label: 'قاعدة المعرفة', permission: 'knowledge:read' },
  { href: '/notifications', label: 'الإشعارات', permission: 'notification:read' },
  { href: '/settings', label: 'إعدادات المركز', permission: 'org:read' },
];

const ROLES: Role[] = ['owner', 'admin', 'manager', 'receptionist', 'technician', 'accountant', 'viewer'];

const WRITE_ACTIONS: { label: string; permission: string }[] = [
  { label: 'إنشاء تذكرة', permission: 'ticket:create' },
  { label: 'تغيير حالة تذكرة', permission: 'ticket:transition' },
  { label: 'إسناد لفني', permission: 'ticket:assign' },
  { label: 'إضافة عميل', permission: 'customer:create' },
  { label: 'إضافة جهاز', permission: 'device:create' },
  { label: 'إدارة القطع', permission: 'part:manage' },
  { label: 'حركة مخزون', permission: 'stock:move' },
  { label: 'إصدار فاتورة', permission: 'invoice:write' },
  { label: 'تحصيل دفعة', permission: 'payment:record' },
  { label: 'تنفيذ فحص جودة', permission: 'qc:perform' },
  { label: 'إدارة الضمان', permission: 'warranty:manage' },
  { label: 'إدارة المستخدمين', permission: 'user:manage' },
  { label: 'إدارة الفروع', permission: 'branch:manage' },
  { label: 'تعديل المؤسسة', permission: 'org:update' },
  { label: 'نقاط البيع', permission: 'pos:operate' },
];

function has(role: Role, permission: string): boolean {
  return ROLE_PERMISSIONS[role].includes(permission as never);
}

console.log('══ الصفحات التي يراها كل دور في السايد بار ══\n');

const header = ['الصفحة'.padEnd(22), ...ROLES.map((r) => r.slice(0, 5).padEnd(6))].join('');
console.log(header);
console.log('─'.repeat(header.length));

for (const page of PAGE_PERMISSIONS) {
  const cells = ROLES.map((role) => (has(role, page.permission) ? ' ✓    ' : ' —    '));
  console.log([page.label.padEnd(22), ...cells].join(''));
}

console.log('\n══ عمليات الكتابة المسموحة لكل دور ══\n');
console.log(header);
console.log('─'.repeat(header.length));

for (const action of WRITE_ACTIONS) {
  const cells = ROLES.map((role) => (has(role, action.permission) ? ' ✓    ' : ' —    '));
  console.log([action.label.padEnd(22), ...cells].join(''));
}

console.log('\n══ عدد الصلاحيات لكل دور ══');
for (const role of ROLES) {
  console.log(`  ${role.padEnd(14)} ${ROLE_PERMISSIONS[role].length} صلاحية`);
}

console.log('\n══ تحقق: هل توجد صفحة لا يراها أي دور؟ ══');
for (const page of PAGE_PERMISSIONS) {
  const visible = ROLES.filter((role) => has(role, page.permission));
  if (!visible.length) console.log(`  ⚠ ${page.label} — لا يراها أي دور!`);
}
console.log('  (لا شيء يعني كل صفحة يراها دور واحد على الأقل)');
