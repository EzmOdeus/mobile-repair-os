'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { Building2, Plus, Save, Settings as SettingsIcon, ShieldCheck, Users } from 'lucide-react';
import { api, errorMessage, fetcher } from '@/lib/api';
import { formatDateTime, formatMoney } from '@/lib/format';
import { Badge, Card, CardHeader, EmptyState, Field, LoadingBlock, PageHeader } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useAuth, ROLE_LABELS_AR, type Role } from '@/lib/auth';

interface OrganizationResponse {
  organization: {
    _id: string;
    name: string;
    nameEn?: string;
    slug: string;
    legalName?: string;
    taxId?: string;
    commercialRegister?: string;
    phone?: string;
    email?: string;
    website?: string;
    address?: { governorate?: string; city?: string; area?: string; street?: string; building?: string };
    branding?: { primaryColor?: string; receiptFooterText?: string };
    settings: {
      currency?: string;
      timezone?: string;
      taxRate?: number;
      taxInclusive?: boolean;
      defaultWarrantyDays?: number;
      partsWarrantyDays?: number;
      laborWarrantyDays?: number;
      requireApprovalBeforeRepair?: boolean;
      requireIntakePhotos?: boolean;
      requireQcBeforeReady?: boolean;
      defaultSlaHours?: number;
      whatsappEnabled?: boolean;
    };
    subscription?: { plan?: string; status?: string; maxUsers?: number; maxBranches?: number; monthlyTicketLimit?: number; priceEgp?: number; expiresAt?: string | null };
  };
  branches: {
    _id: string;
    name: string;
    code: string;
    phone?: string;
    isDefault?: boolean;
    isActive?: boolean;
    managerId?: { fullName?: string } | null;
  }[];
  usage: { activeUsers: number; activeBranches: number; limits?: { maxUsers?: number; maxBranches?: number } };
}

interface UserRow {
  id: string;
  fullName: string;
  username: string;
  email: string;
  phone: string;
  role: Role;
  isActive: boolean;
  lastLoginAt?: string | null;
  permissions: string[];
}

const PLAN_LABELS: Record<string, string> = {
  free: 'مجاني',
  starter: 'Starter',
  pro: 'Pro',
  business: 'Business',
  enterprise: 'Enterprise',
};

export default function SettingsPage() {
  const toast = useToast();
  const { hasPermission, refreshProfile } = useAuth();
  const [tab, setTab] = useState<'org' | 'branches' | 'users'>('org');
  const [branchOpen, setBranchOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const { data, error, isLoading } = useSWR<OrganizationResponse>('/organizations', fetcher);
  const { data: users } = useSWR<UserRow[]>(tab === 'users' && hasPermission('user:read') ? '/auth/users' : null, fetcher);

  const [form, setForm] = useState<Record<string, unknown> | null>(null);

  const current = form ?? data?.organization ?? null;

  const saveOrg = async () => {
    if (!current) return;
    setIsSaving(true);
    try {
      await api.patch('/organizations', {
        name: current.name,
        nameEn: current.nameEn,
        legalName: current.legalName,
        taxId: current.taxId,
        commercialRegister: current.commercialRegister,
        phone: current.phone,
        email: current.email,
        website: current.website,
        address: (current as { address?: unknown }).address,
        branding: (current as { branding?: unknown }).branding,
        settings: current.settings,
      });
      toast.success('تم حفظ الإعدادات');
      setForm(null);
      await Promise.all([mutate('/organizations'), refreshProfile()]);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const update = (path: string, value: unknown) => {
    const base = JSON.parse(JSON.stringify(current ?? {})) as Record<string, unknown>;
    const keys = path.split('.');
    let cursor = base;
    for (let i = 0; i < keys.length - 1; i += 1) {
      const key = keys[i]!;
      if (typeof cursor[key] !== 'object' || cursor[key] === null) cursor[key] = {};
      cursor = cursor[key] as Record<string, unknown>;
    }
    cursor[keys[keys.length - 1]!] = value;
    setForm(base);
  };

  if (isLoading) {
    return (
      <Card>
        <LoadingBlock rows={8} />
      </Card>
    );
  }

  if (error || !data || !current) {
    return <Card className="border-red-200 bg-red-50 p-5 text-sm text-red-700">{error ? errorMessage(error) : 'تعذر تحميل الإعدادات'}</Card>;
  }

  const settings = (current.settings ?? {}) as Record<string, unknown>;
  const address = ((current as { address?: Record<string, string> }).address ?? {}) as Record<string, string>;
  const branding = ((current as { branding?: Record<string, string> }).branding ?? {}) as Record<string, string>;
  const subscription = data.organization.subscription;

  return (
    <div>
      <PageHeader
        title="إعدادات المركز"
        subtitle="بيانات المؤسسة، الفروع، المستخدمون والصلاحيات، وسياسات التشغيل"
        actions={
          tab === 'org' && hasPermission('org:update') ? (
            <button type="button" className="btn-primary" onClick={saveOrg} disabled={isSaving || !form}>
              <Save size={16} /> {isSaving ? 'جارٍ الحفظ…' : 'حفظ التعديلات'}
            </button>
          ) : null
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="card-pad">
          <p className="text-xs font-semibold text-ink-500">الباقة الحالية</p>
          <p className="mt-1 text-lg font-bold text-ink-900">{PLAN_LABELS[subscription?.plan ?? 'free'] ?? '—'}</p>
          <p className="mt-0.5 text-xs text-ink-500">
            {subscription?.status === 'active' ? 'نشطة' : subscription?.status === 'trialing' ? 'تجريبية' : subscription?.status ?? ''}
            {subscription?.priceEgp ? ` · ${formatMoney(subscription.priceEgp)}/شهر` : ''}
          </p>
        </Card>
        <Card className="card-pad">
          <p className="text-xs font-semibold text-ink-500">المستخدمون</p>
          <p className="mt-1 text-lg font-bold text-ink-900 num">
            {data.usage.activeUsers} / {subscription?.maxUsers ?? data.usage.limits?.maxUsers ?? '—'}
          </p>
        </Card>
        <Card className="card-pad">
          <p className="text-xs font-semibold text-ink-500">الفروع</p>
          <p className="mt-1 text-lg font-bold text-ink-900 num">
            {data.usage.activeBranches} / {subscription?.maxBranches ?? data.usage.limits?.maxBranches ?? '—'}
          </p>
        </Card>
        <Card className="card-pad">
          <p className="text-xs font-semibold text-ink-500">حد التذاكر الشهري</p>
          <p className="mt-1 text-lg font-bold text-ink-900 num">{subscription?.monthlyTicketLimit ?? '—'}</p>
        </Card>
      </div>

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-3 py-2">
          {/*
            الأقسام تُفلتر حسب الصلاحية: كان القسم يظهر لكل الأدوار ثم تكون كل
            أزراره معطّلة، فيرى الاستقبال والفني صفحة إدارة المستخدمين بلا داعٍ.
          */}
          {(
            [
              { value: 'org', label: 'بيانات المركز', permission: 'org:update' },
              { value: 'branches', label: 'الفروع', permission: 'branch:manage' },
              { value: 'users', label: 'المستخدمون والصلاحيات', permission: 'user:manage' },
            ] as const
          )
            .filter((section) => hasPermission(section.permission))
            .map((section) => (
              <button
                key={section.value}
                type="button"
                onClick={() => setTab(section.value)}
                className={`btn px-3 py-1.5 text-xs ${
                  tab === section.value ? 'bg-brand-700 text-white' : 'text-ink-600 hover:bg-ink-100'
                }`}
              >
                {section.label}
              </button>
            ))}
        </div>

        <div className="card-pad">
          {tab === 'org' ? (
            <div className="space-y-5">
              <div>
                <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink-800">
                  <Building2 size={16} /> بيانات أساسية
                </h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="اسم المركز">
                    <input
                      className="input"
                      value={String(current.name ?? '')}
                      onChange={(e) => update('name', e.target.value)}
                      disabled={!hasPermission('org:update')}
                    />
                  </Field>
                  <Field label="الاسم بالإنجليزية">
                    <input
                      className="input"
                      value={String(current.nameEn ?? '')}
                      onChange={(e) => update('nameEn', e.target.value)}
                      dir="ltr"
                      disabled={!hasPermission('org:update')}
                    />
                  </Field>
                  <Field label="معرّف المركز (slug)" hint="يُستخدم في تسجيل الدخول">
                    <input className="input" value={String(current.slug ?? '')} dir="ltr" disabled />
                  </Field>
                  <Field label="الاسم القانوني">
                    <input
                      className="input"
                      value={String(current.legalName ?? '')}
                      onChange={(e) => update('legalName', e.target.value)}
                      disabled={!hasPermission('org:update')}
                    />
                  </Field>
                  <Field label="السجل التجاري">
                    <input
                      className="input"
                      value={String(current.commercialRegister ?? '')}
                      onChange={(e) => update('commercialRegister', e.target.value)}
                      dir="ltr"
                      disabled={!hasPermission('org:update')}
                    />
                  </Field>
                  <Field label="الرقم الضريبي">
                    <input
                      className="input"
                      value={String(current.taxId ?? '')}
                      onChange={(e) => update('taxId', e.target.value)}
                      dir="ltr"
                      disabled={!hasPermission('org:update')}
                    />
                  </Field>
                  <Field label="الهاتف">
                    <input
                      className="input"
                      value={String(current.phone ?? '')}
                      onChange={(e) => update('phone', e.target.value)}
                      dir="ltr"
                      disabled={!hasPermission('org:update')}
                    />
                  </Field>
                  <Field label="البريد الإلكتروني">
                    <input
                      className="input"
                      value={String(current.email ?? '')}
                      onChange={(e) => update('email', e.target.value)}
                      dir="ltr"
                      disabled={!hasPermission('org:update')}
                    />
                  </Field>
                  <Field label="الموقع الإلكتروني">
                    <input
                      className="input"
                      value={String(current.website ?? '')}
                      onChange={(e) => update('website', e.target.value)}
                      dir="ltr"
                      disabled={!hasPermission('org:update')}
                    />
                  </Field>
                  <Field label="المحافظة">
                    <input
                      className="input"
                      value={address.governorate ?? ''}
                      onChange={(e) => update('address.governorate', e.target.value)}
                      disabled={!hasPermission('org:update')}
                    />
                  </Field>
                  <Field label="المدينة">
                    <input
                      className="input"
                      value={address.city ?? ''}
                      onChange={(e) => update('address.city', e.target.value)}
                      disabled={!hasPermission('org:update')}
                    />
                  </Field>
                  <Field label="المنطقة">
                    <input
                      className="input"
                      value={address.area ?? ''}
                      onChange={(e) => update('address.area', e.target.value)}
                      disabled={!hasPermission('org:update')}
                    />
                  </Field>
                </div>
              </div>

              <div>
                <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink-800">
                  <SettingsIcon size={16} /> سياسات التشغيل
                </h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="نسبة الضريبة %">
                    <input
                      className="input"
                      type="number"
                      min={0}
                      max={100}
                      value={Number(settings.taxRate ?? 14)}
                      onChange={(e) => update('settings.taxRate', Number(e.target.value))}
                      disabled={!hasPermission('org:update')}
                    />
                  </Field>
                  <Field label="ضمان افتراضي (يوم)">
                    <input
                      className="input"
                      type="number"
                      min={0}
                      value={Number(settings.defaultWarrantyDays ?? 30)}
                      onChange={(e) => update('settings.defaultWarrantyDays', Number(e.target.value))}
                      disabled={!hasPermission('org:update')}
                    />
                  </Field>
                  <Field label="ضمان القطع (يوم)">
                    <input
                      className="input"
                      type="number"
                      min={0}
                      value={Number(settings.partsWarrantyDays ?? 90)}
                      onChange={(e) => update('settings.partsWarrantyDays', Number(e.target.value))}
                      disabled={!hasPermission('org:update')}
                    />
                  </Field>
                  <Field label="ضمان المصنعية (يوم)">
                    <input
                      className="input"
                      type="number"
                      min={0}
                      value={Number(settings.laborWarrantyDays ?? 14)}
                      onChange={(e) => update('settings.laborWarrantyDays', Number(e.target.value))}
                      disabled={!hasPermission('org:update')}
                    />
                  </Field>
                  <Field label="مدة الـSLA الافتراضية (ساعة)">
                    <input
                      className="input"
                      type="number"
                      min={1}
                      value={Number(settings.defaultSlaHours ?? 72)}
                      onChange={(e) => update('settings.defaultSlaHours', Number(e.target.value))}
                      disabled={!hasPermission('org:update')}
                    />
                  </Field>
                  <Field label="الضريبة مضمّنة في السعر">
                    <select
                      className="input"
                      value={settings.taxInclusive === false ? 'false' : 'true'}
                      onChange={(e) => update('settings.taxInclusive', e.target.value === 'true')}
                      disabled={!hasPermission('org:update')}
                    >
                      <option value="true">نعم — السعر شامل الضريبة</option>
                      <option value="false">لا — تُضاف الضريبة</option>
                    </select>
                  </Field>
                </div>

                <div className="mt-3 space-y-2">
                  {[
                    ['requireApprovalBeforeRepair', 'إلزام موافقة العميل على عرض السعر قبل بدء الإصلاح'],
                    ['requireIntakePhotos', 'إلزام صور الاستلام عند فتح التذكرة'],
                    ['requireQcBeforeReady', 'إلزام فحص الجودة قبل تجهيز الجهاز للتسليم'],
                    ['whatsappEnabled', 'تفعيل إرسال رسائل WhatsApp (يحتاج إعداد المزوّد)'],
                  ].map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2 text-xs text-ink-600">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-ink-300"
                        checked={Boolean(settings[key])}
                        onChange={(e) => update(`settings.${key}`, e.target.checked)}
                        disabled={!hasPermission('org:update')}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="mb-3 text-sm font-bold text-ink-800">هوية الفواتير</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="لون الهوية">
                    <input
                      className="input"
                      type="color"
                      value={branding.primaryColor ?? '#0f766e'}
                      onChange={(e) => update('branding.primaryColor', e.target.value)}
                      disabled={!hasPermission('org:update')}
                    />
                  </Field>
                  <Field label="نص أسفل الفاتورة">
                    <input
                      className="input"
                      value={branding.receiptFooterText ?? ''}
                      onChange={(e) => update('branding.receiptFooterText', e.target.value)}
                      disabled={!hasPermission('org:update')}
                    />
                  </Field>
                </div>
              </div>
            </div>
          ) : null}

          {tab === 'branches' ? (
            <div className="space-y-4">
              {hasPermission('branch:manage') ? (
                <button type="button" className="btn-primary" onClick={() => setBranchOpen(true)}>
                  <Plus size={16} /> فرع جديد
                </button>
              ) : null}

              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>الفرع</th>
                      <th>الكود</th>
                      <th>الهاتف</th>
                      <th>المدير</th>
                      <th>الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.branches.map((branch) => (
                      <tr key={branch._id}>
                        <td className="text-xs font-medium">
                          {branch.name}
                          {branch.isDefault ? (
                            <Badge className="ms-2 border-brand-200 bg-brand-50 text-brand-700">رئيسي</Badge>
                          ) : null}
                        </td>
                        <td className="text-xs" dir="ltr">
                          {branch.code}
                        </td>
                        <td className="num text-xs" dir="ltr">
                          {branch.phone || '—'}
                        </td>
                        <td className="text-xs">{branch.managerId?.fullName ?? '—'}</td>
                        <td>
                          <Badge
                            className={
                              branch.isActive === false
                                ? 'border-red-200 bg-red-50 text-red-700'
                                : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            }
                          >
                            {branch.isActive === false ? 'موقوف' : 'نشط'}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {tab === 'users' ? (
            <div className="space-y-4">
              {hasPermission('user:manage') ? (
                <button type="button" className="btn-primary" onClick={() => setUserOpen(true)}>
                  <Plus size={16} /> مستخدم جديد
                </button>
              ) : null}

              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>الاسم</th>
                      <th>اسم المستخدم</th>
                      <th>الدور</th>
                      <th>الهاتف</th>
                      <th>آخر دخول</th>
                      <th>الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users?.length ? (
                      users.map((user) => (
                        <tr key={user.id}>
                          <td className="text-xs font-medium">{user.fullName}</td>
                          <td className="text-xs" dir="ltr">
                            {user.username}
                          </td>
                          <td>
                            <Badge className="border-ink-200 bg-ink-50 text-ink-700">{ROLE_LABELS_AR[user.role] ?? user.role}</Badge>
                          </td>
                          <td className="num text-xs" dir="ltr">
                            {user.phone || '—'}
                          </td>
                          <td className="text-xs text-ink-500">
                            {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : '—'}
                          </td>
                          <td>
                            <Badge
                              className={
                                user.isActive
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                  : 'border-red-200 bg-red-50 text-red-700'
                              }
                            >
                              {user.isActive ? 'نشط' : 'موقوف'}
                            </Badge>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6}>
                          <EmptyState title="لا يوجد مستخدمون" icon={<Users size={20} />} />
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="rounded-lg border border-ink-200 bg-ink-50 p-3">
                <p className="flex items-center gap-2 text-xs font-bold text-ink-700">
                  <ShieldCheck size={14} /> الأدوار والصلاحيات
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {Object.entries(ROLE_LABELS_AR).map(([role, label]) => (
                    <div key={role} className="rounded-lg border border-ink-200 bg-white px-3 py-2">
                      <p className="text-xs font-bold text-ink-800">{label}</p>
                      <p className="text-[11px] text-ink-500" dir="ltr">
                        {role}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </Card>

      <CreateBranchModal
        open={branchOpen}
        onClose={() => setBranchOpen(false)}
        onDone={async () => {
          setBranchOpen(false);
          await mutate('/organizations');
          toast.success('تمت إضافة الفرع');
        }}
        onError={(message) => toast.error(message)}
      />

      <CreateUserModal
        open={userOpen}
        onClose={() => setUserOpen(false)}
        branches={data.branches.map((b) => ({ id: b._id, name: b.name }))}
        onDone={async () => {
          setUserOpen(false);
          await Promise.all([mutate('/auth/users'), mutate('/organizations')]);
          toast.success('تمت إضافة المستخدم');
        }}
        onError={(message) => toast.error(message)}
      />
    </div>
  );
}

function CreateBranchModal({
  open,
  onClose,
  onDone,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState({ name: '', code: '', phone: '', governorate: '', city: '', area: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async () => {
    if (!form.name.trim() || !form.code.trim()) {
      onError('اسم الفرع والكود مطلوبان');
      return;
    }
    setIsSubmitting(true);
    try {
      await api.post('/branches', {
        name: form.name,
        code: form.code,
        phone: form.phone,
        address: { governorate: form.governorate, city: form.city, area: form.area },
      });
      await onDone();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="إضافة فرع"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            إلغاء
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={isSubmitting}>
            {isSubmitting ? 'جارٍ الحفظ…' : 'حفظ الفرع'}
          </button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="اسم الفرع" required>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="كود الفرع" required>
          <input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} dir="ltr" />
        </Field>
        <Field label="الهاتف">
          <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" />
        </Field>
        <Field label="المحافظة">
          <input className="input" value={form.governorate} onChange={(e) => setForm({ ...form, governorate: e.target.value })} />
        </Field>
        <Field label="المدينة">
          <input className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
        </Field>
        <Field label="المنطقة">
          <input className="input" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

function CreateUserModal({
  open,
  onClose,
  branches,
  onDone,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  branches: { id: string; name: string }[];
  onDone: () => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState({
    fullName: '',
    username: '',
    password: '',
    phone: '',
    email: '',
    role: 'technician',
    branchIds: [] as string[],
    specialities: '',
    skillLevel: 'mid',
    maxActiveJobs: '5',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async () => {
    if (!form.fullName.trim() || !form.username.trim() || form.password.length < 8) {
      onError('الاسم واسم المستخدم وكلمة مرور (8 أحرف على الأقل مع حرف ورقم) مطلوبة');
      return;
    }
    setIsSubmitting(true);
    try {
      await api.post('/auth/users', {
        fullName: form.fullName,
        username: form.username,
        password: form.password,
        phone: form.phone || undefined,
        email: form.email || undefined,
        role: form.role,
        branchIds: form.branchIds.length ? form.branchIds : undefined,
        technicianProfile:
          form.role === 'technician'
            ? {
                isTechnician: true,
                specialities: form.specialities
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
                skillLevel: form.skillLevel,
                maxActiveJobs: Number(form.maxActiveJobs) || 5,
              }
            : undefined,
      });
      await onDone();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="إضافة مستخدم"
      size="lg"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            إلغاء
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={isSubmitting}>
            {isSubmitting ? 'جارٍ الحفظ…' : 'حفظ المستخدم'}
          </button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="الاسم الكامل" required>
          <input className="input" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
        </Field>
        <Field label="اسم المستخدم" required>
          <input
            className="input"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })}
            dir="ltr"
            placeholder="tech.ali"
          />
        </Field>
        <Field label="كلمة المرور" required hint="8 أحرف على الأقل وتحتوي حرفًا ورقمًا">
          <input
            className="input"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            dir="ltr"
          />
        </Field>
        <Field label="الدور" required>
          <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {Object.entries(ROLE_LABELS_AR).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="الهاتف">
          <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" />
        </Field>
        <Field label="البريد الإلكتروني">
          <input className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} dir="ltr" />
        </Field>

        <div className="sm:col-span-2">
          <p className="label">الفروع المسموح بها</p>
          <div className="flex flex-wrap gap-2">
            {branches.map((branch) => (
              <label
                key={branch.id}
                className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs transition ${
                  form.branchIds.includes(branch.id) ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-ink-300'
                }`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={form.branchIds.includes(branch.id)}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      branchIds: e.target.checked
                        ? [...form.branchIds, branch.id]
                        : form.branchIds.filter((id) => id !== branch.id),
                    })
                  }
                />
                {branch.name}
              </label>
            ))}
          </div>
        </div>

        {form.role === 'technician' ? (
          <>
            <Field label="التخصصات (مفصولة بفاصلة)">
              <input
                className="input"
                value={form.specialities}
                onChange={(e) => setForm({ ...form, specialities: e.target.value })}
                placeholder="hardware, board-level, iphone"
              />
            </Field>
            <Field label="المستوى">
              <select className="input" value={form.skillLevel} onChange={(e) => setForm({ ...form, skillLevel: e.target.value })}>
                <option value="junior">مبتدئ</option>
                <option value="mid">متوسط</option>
                <option value="senior">خبير</option>
                <option value="lead">قائد</option>
              </select>
            </Field>
            <Field label="الحد الأقصى للمهام النشطة">
              <input
                className="input"
                type="number"
                min={1}
                max={50}
                value={form.maxActiveJobs}
                onChange={(e) => setForm({ ...form, maxActiveJobs: e.target.value })}
              />
            </Field>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
