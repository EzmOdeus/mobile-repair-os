'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { Building2, CreditCard, DatabaseBackup, Download, Plus, Save, Settings as SettingsIcon, ShieldCheck, Users } from 'lucide-react';
import { api, errorMessage, fetcher } from '@/lib/api';
import { formatDateTime, formatMoney } from '@/lib/format';
import { Badge, Card, CardHeader, EmptyState, Field, LoadingBlock, PageHeader } from '@/components/ui';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { TwoFactorCard } from '@/components/TwoFactorCard';
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
    address?: { governorate?: string; city?: string; area?: string; street?: string };
    managerId?: { fullName?: string } | null;
  }[];
  usage: { activeUsers: number; activeBranches: number; limits?: { maxUsers?: number; maxBranches?: number } };
  /** حالة الاشتراك المحسوبة من الخادم */
  subscription?: {
    planKey: string;
    plan: {
      key: string;
      nameAr: string;
      monthlyPriceEgp: number;
      maxUsers: number;
      maxBranches: number;
      monthlyTicketLimit: number;
      selfService?: boolean;
      trialOnly?: boolean;
      customPricing?: boolean;
    };
    status: 'trialing' | 'active' | 'past_due' | 'cancelled';
    startedAt?: string | null;
    expiresAt?: string | null;
    graceEndsAt?: string | null;
    daysRemaining?: number | null;
    graceDaysRemaining?: number | null;
    priceEgp?: number;
    blocked: boolean;
    inGrace: boolean;
  };
}

interface PlanCatalogItem {
  key: string;
  nameAr: string;
  maxUsers: number;
  maxBranches: number;
  monthlyTicketLimit: number;
  monthlyPriceEgp: number;
  selfService: boolean;
  trialOnly: boolean;
  customPricing: boolean;
}

interface SubscriptionPaymentRow {
  id: string;
  plan: string;
  amountEgp: number;
  months: number;
  method: string;
  methodLabelAr: string;
  reference: string;
  note: string;
  periodStart: string;
  periodEnd: string;
  paidAt: string;
  source: 'self_service' | 'platform';
}

interface RenewalRequestRow {
  id: string;
  plan: string;
  months: number;
  paymentMethod: string;
  paymentMethodLabelAr: string;
  paymentReference: string;
  note: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reviewNote: string;
  reviewedAt?: string | null;
  createdAt: string;
}

const PAYMENT_METHOD_OPTIONS = [
  ['cash', 'نقدًا'],
  ['bank_transfer', 'تحويل بنكي'],
  ['wallet', 'محفظة إلكترونية'],
  ['cheque', 'شيك'],
  ['other', 'أخرى'],
] as const;

const RENEWAL_STATUS: Record<string, { label: string; className: string }> = {
  pending: { label: 'قيد المراجعة', className: 'border-amber-200 bg-amber-50 text-amber-700' },
  approved: { label: 'معتمد', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  rejected: { label: 'مرفوض', className: 'border-red-200 bg-red-50 text-red-700' },
  cancelled: { label: 'ملغي', className: 'border-ink-200 bg-ink-50 text-ink-500' },
};

interface UserRow {
  id: string;
  fullName: string;
  username: string;
  email: string;
  phone: string;
  role: Role;
  isActive: boolean;
  branchIds?: string[];
  lastLoginAt?: string | null;
  twoFactorEnabled?: boolean;
  permissions: string[];
}

const PLAN_LABELS: Record<string, string> = {
  free: 'مجاني (قديم)',
  trial: 'تجريبية',
  starter: 'المبتدئة',
  growth: 'النمو',
  pro: 'الاحترافية',
  business: 'Business (قديم)',
  enterprise: 'المؤسسية',
};

export default function SettingsPage() {
  const toast = useToast();
  const { hasPermission, refreshProfile } = useAuth();
  const [tab, setTab] = useState<'org' | 'branches' | 'users'>('org');
  const [branchOpen, setBranchOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [branchEdit, setBranchEdit] = useState<OrganizationResponse['branches'][number] | null>(null);
  const [userEdit, setUserEdit] = useState<UserRow | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<UserRow | null>(null);
  const [twoFactorResetTarget, setTwoFactorResetTarget] = useState<UserRow | null>(null);
  const [isUserBusy, setIsUserBusy] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const { data, error, isLoading } = useSWR<OrganizationResponse>('/organizations', fetcher);
  const { data: users } = useSWR<UserRow[]>(tab === 'users' && hasPermission('user:read') ? '/auth/users' : null, fetcher);
  const { data: planCatalog } = useSWR<PlanCatalogItem[]>(
    hasPermission('org:update') ? '/organizations/subscription/plans' : null,
    fetcher,
  );

  const [form, setForm] = useState<Record<string, unknown> | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [isPlanBusy, setIsPlanBusy] = useState(false);
  const [isBackupBusy, setIsBackupBusy] = useState(false);
  const [activation, setActivation] = useState({
    months: 1,
    paymentMethod: 'bank_transfer',
    reference: '',
    note: '',
  });
  const [renewalOpen, setRenewalOpen] = useState(false);
  const [isRenewalBusy, setIsRenewalBusy] = useState(false);
  const [renewalForm, setRenewalForm] = useState({
    plan: 'enterprise',
    months: 1,
    paymentMethod: 'bank_transfer',
    reference: '',
    note: '',
  });

  const {
    data: payments,
    mutate: mutatePayments,
  } = useSWR<SubscriptionPaymentRow[]>(
    hasPermission('org:update') ? '/organizations/subscription/payments' : null,
    fetcher,
  );
  const {
    data: renewalRequests,
    mutate: mutateRenewalRequests,
  } = useSWR<RenewalRequestRow[]>(
    hasPermission('org:update') ? '/organizations/subscription/renewal-requests' : null,
    fetcher,
  );

  const downloadBackupAction = async () => {
    setIsBackupBusy(true);
    try {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      await api.download('/organizations/backup/export', `backup-${data?.organization.slug ?? 'org'}-${stamp}.json`);
      toast.success('تم تنزيل النسخة الاحتياطية');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setIsBackupBusy(false);
    }
  };

  const changePlanAction = async () => {
    const plan = chosenPlan;
    if (!plan) return;
    if (subState?.blocked) {
      toast.error('الاشتراك موقوف — استخدم «تفعيل الآن» مع بيانات الدفع بدل تغيير الباقة.');
      return;
    }
    setIsPlanBusy(true);
    try {
      await api.post('/organizations/subscription/change-plan', { plan });
      toast.success('تم تغيير الباقة');
      setSelectedPlan(null);
      await mutate('/organizations');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setIsPlanBusy(false);
    }
  };

  const activateAction = async () => {
    const plan = chosenPlan;
    if (!plan) return;
    if (activation.reference.trim().length < 3) {
      toast.error('أدخل مرجع الدفع (رقم التحويل أو الإيصال) — إلزامي لتسجيل الدفعة.');
      return;
    }
    setIsPlanBusy(true);
    try {
      const response = await api.post<{ expiresAt?: string }>('/organizations/subscription/activate', {
        plan,
        months: activation.months,
        paymentMethod: activation.paymentMethod,
        paymentReference: activation.reference.trim(),
        paymentNote: activation.note.trim(),
      });
      toast.success(
        response.expiresAt
          ? `تم تفعيل الاشتراك حتى ${formatDateTime(response.expiresAt)}`
          : 'تم تفعيل الاشتراك',
      );
      setSelectedPlan(null);
      setActivation((value) => ({ ...value, reference: '', note: '' }));
      await Promise.all([mutate('/organizations'), mutatePayments(), mutateRenewalRequests()]);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setIsPlanBusy(false);
    }
  };

  const submitRenewalRequest = async () => {
    if (renewalForm.note.trim().length < 2 && !renewalForm.reference.trim()) {
      toast.error('أضف ملاحظة أو مرجع تحويل حتى تراجع المنصة الطلب.');
      return;
    }
    setIsRenewalBusy(true);
    try {
      await api.post('/organizations/subscription/renewal-requests', {
        plan: renewalForm.plan,
        months: renewalForm.months,
        paymentMethod: renewalForm.paymentMethod,
        paymentReference: renewalForm.reference.trim(),
        note: renewalForm.note.trim(),
      });
      toast.success('تم إرسال طلب التجديد — ستتم مراجعته من إدارة المنصة.');
      setRenewalOpen(false);
      setRenewalForm((value) => ({ ...value, reference: '', note: '' }));
      await mutateRenewalRequests();
    } catch (err) {
      toast.error(errorMessage(err));
      void mutateRenewalRequests();
    } finally {
      setIsRenewalBusy(false);
    }
  };

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

  const toggleBranch = async (branch: OrganizationResponse['branches'][number]) => {
    try {
      if (branch.isActive === false) {
        await api.patch(`/branches/${branch._id}`, { isActive: true });
        toast.success('تم تفعيل الفرع');
      } else {
        await api.del(`/branches/${branch._id}`);
        toast.success('تم تعطيل الفرع');
      }
      await mutate('/organizations');
      await refreshProfile();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const deactivateUserAction = async () => {
    if (!deactivateTarget) return;
    setIsUserBusy(true);
    try {
      await api.del(`/auth/users/${deactivateTarget.id}`);
      toast.success('تم تعطيل المستخدم');
      setDeactivateTarget(null);
      await Promise.all([mutate('/auth/users'), mutate('/organizations')]);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setIsUserBusy(false);
    }
  };

  const activateUser = async (user: UserRow) => {
    try {
      await api.patch(`/auth/users/${user.id}`, { isActive: true });
      toast.success('تم تفعيل المستخدم');
      await Promise.all([mutate('/auth/users'), mutate('/organizations')]);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const resetUserTwoFactorAction = async () => {
    if (!twoFactorResetTarget) return;
    setIsUserBusy(true);
    try {
      await api.post(`/auth/users/${twoFactorResetTarget.id}/2fa/reset`);
      toast.success('تمت إعادة تعيين التحقق بخطوتين للمستخدم');
      setTwoFactorResetTarget(null);
      await mutate('/auth/users');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setIsUserBusy(false);
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
  const subState = data.subscription;
  const selfServicePlans = planCatalog?.filter((plan) => plan.selfService) ?? [];
  const currentPlanKey = subState?.planKey ?? subscription?.plan;
  const chosenPlan =
    selectedPlan ??
    (selfServicePlans.some((plan) => plan.key === currentPlanKey)
      ? currentPlanKey
      : selfServicePlans[0]?.key ?? 'growth');
  const chosenPlanInfo = planCatalog?.find((plan) => plan.key === chosenPlan);
  const planName = (key?: string) =>
    (key ? planCatalog?.find((plan) => plan.key === key)?.nameAr : undefined) ??
    (key ? PLAN_LABELS[key] : undefined) ??
    key ??
    '—';
  const currentPrice = subState?.priceEgp ?? subscription?.priceEgp ?? 0;
  const pendingRenewal = renewalRequests?.find((request) => request.status === 'pending') ?? null;
  const activationTotal = (chosenPlanInfo?.monthlyPriceEgp ?? 0) * activation.months;

  const SUB_STATUS_LABELS: Record<string, string> = {
    trialing: 'تجريبية',
    active: 'نشطة',
    past_due: 'مهلة سداد',
    cancelled: 'موقوفة',
  };

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
          <p className="mt-1 text-lg font-bold text-ink-900">{subState?.plan.nameAr ?? planName(subscription?.plan)}</p>
          <p className="mt-0.5 text-xs text-ink-500">
            {SUB_STATUS_LABELS[subState?.status ?? subscription?.status ?? ''] ?? subState?.status ?? subscription?.status ?? ''}
            {subState?.plan.customPricing || (!subState && !subscription?.priceEgp)
              ? ' · تسعير حسب الاتفاق'
              : currentPrice
                ? ` · ${formatMoney(currentPrice)}/شهر`
                : ' · مجاني'}
          </p>
        </Card>
        <Card className="card-pad">
          <p className="text-xs font-semibold text-ink-500">المستخدمون</p>
          <p className="mt-1 text-lg font-bold text-ink-900 num">
            {data.usage.activeUsers} / {subState?.plan.maxUsers ?? subscription?.maxUsers ?? data.usage.limits?.maxUsers ?? '—'}
          </p>
        </Card>
        <Card className="card-pad">
          <p className="text-xs font-semibold text-ink-500">الفروع</p>
          <p className="mt-1 text-lg font-bold text-ink-900 num">
            {data.usage.activeBranches} / {subState?.plan.maxBranches ?? subscription?.maxBranches ?? data.usage.limits?.maxBranches ?? '—'}
          </p>
        </Card>
        <Card className="card-pad">
          <p className="text-xs font-semibold text-ink-500">حد التذاكر الشهري</p>
          <p className="mt-1 text-lg font-bold text-ink-900 num">
            {subState?.plan.monthlyTicketLimit ?? subscription?.monthlyTicketLimit ?? '—'}
          </p>
        </Card>
      </div>

      <TwoFactorCard />

      {hasPermission('org:update') && subState ? (
        <Card className={`mb-4 ${subState.blocked ? 'border-red-300' : ''}`}>
          <div className="card-pad">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-bold text-ink-800">
                  <CreditCard size={16} /> الاشتراك والباقة
                </h3>
                <p className="mt-1 text-xs text-ink-500">
                  الباقة: <span className="font-bold text-ink-700">{subState.plan.nameAr}</span>
                  {' · '}الحالة: {SUB_STATUS_LABELS[subState.status] ?? subState.status}
                  {subState.plan.customPricing ? ' · تسعير حسب الاتفاق' : ` · ${formatMoney(currentPrice)}/شهر`}
                </p>
                <p className="mt-0.5 text-xs text-ink-500">
                  {subState.expiresAt ? `التغطية حتى ${formatDateTime(subState.expiresAt)}` : 'بدون تاريخ انتهاء'}
                  {subState.daysRemaining !== null && subState.daysRemaining !== undefined
                    ? subState.daysRemaining >= 0
                      ? ` · متبقي ${subState.daysRemaining} يوم`
                      : ` · انتهت منذ ${Math.abs(subState.daysRemaining)} يوم`
                    : ''}
                  {subState.inGrace && subState.graceDaysRemaining !== null && subState.graceDaysRemaining !== undefined
                    ? ` · مهلة السداد: ${Math.max(subState.graceDaysRemaining, 0)} يوم متبقٍ`
                    : ''}
                </p>
              </div>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setRenewalOpen(true)}
                disabled={Boolean(pendingRenewal)}
              >
                {pendingRenewal ? 'طلب تجديد قيد المراجعة' : 'طلب تجديد / عرض سعر'}
              </button>
            </div>

            {subState.blocked ? (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700">
                {subState.status === 'cancelled'
                  ? 'اشتراك مركزك موقوف — الإنشاء الجديد (مستخدمين/فروع/تذاكر) متوقف حتى تفعيل باقة. القراءة والتقارير متاحة.'
                  : 'انتهت فترة الاشتراك — جدّد باقتك الآن لاستئناف العمل دون انقطاع.'}
              </div>
            ) : null}
            {!subState.blocked && subState.inGrace ? (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-700">
                انتهت فترة الاشتراك وأنت في مهلة سداد — سدّد وفعّل الباقة قبل الإيقاف الكامل.
              </div>
            ) : null}

            <div className="mt-4">
              <p className="text-xs font-bold text-ink-600">باقات التفعيل الذاتي — بعد الدفع خارج المنصة</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {selfServicePlans.map((plan) => (
                  <label
                    key={plan.key}
                    className={`cursor-pointer rounded-lg border px-3 py-2 transition ${
                      chosenPlan === plan.key ? 'border-brand-600 bg-brand-50' : 'border-ink-200 hover:border-ink-400'
                    }`}
                  >
                    <input
                      type="radio"
                      name="plan"
                      className="sr-only"
                      checked={chosenPlan === plan.key}
                      onChange={() => setSelectedPlan(plan.key)}
                    />
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-bold text-ink-800">{plan.nameAr}</p>
                      <p className="text-xs font-bold text-brand-700">{formatMoney(plan.monthlyPriceEgp)}/شهر</p>
                    </div>
                    <p className="mt-0.5 text-[11px] text-ink-500">
                      {plan.maxUsers} مستخدم · {plan.maxBranches} فرع · {plan.monthlyTicketLimit} تذكرة/شهر
                    </p>
                  </label>
                ))}
                <div className="rounded-lg border border-dashed border-ink-300 bg-ink-25 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-bold text-ink-800">المؤسسية</p>
                    <p className="text-xs font-bold text-ink-600">حسب الاتفاق</p>
                  </div>
                  <p className="mt-0.5 text-[11px] text-ink-500">
                    تُفعّلها إدارة المنصة بعد الاتفاق على السعر — استخدم «طلب تجديد / عرض سعر».
                  </p>
                </div>
              </div>
              <p className="mt-1.5 text-[11px] text-ink-400">
                الفترة التجريبية 14 يومًا تنتهي تلقائيًا ولا تُباع كباقة. الترقية بين باقات النمو والاحترافية متاحة في أي وقت.
              </p>
            </div>

            <div className="mt-4 rounded-lg border border-ink-200 bg-ink-25 p-3">
              <p className="text-xs font-bold text-ink-700">بيانات الدفع للتفعيل / التجديد</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="عدد الشهور" required>
                  <select
                    className="input"
                    value={activation.months}
                    onChange={(event) =>
                      setActivation((value) => ({ ...value, months: Number(event.target.value) }))
                    }
                  >
                    {[1, 3, 6, 12].map((months) => (
                      <option key={months} value={months}>
                        {months} شهر
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="طريقة الدفع" required>
                  <select
                    className="input"
                    value={activation.paymentMethod}
                    onChange={(event) =>
                      setActivation((value) => ({ ...value, paymentMethod: event.target.value }))
                    }
                  >
                    {PAYMENT_METHOD_OPTIONS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="مرجع الدفع" required hint="رقم التحويل أو الإيصال">
                  <input
                    className="input"
                    value={activation.reference}
                    onChange={(event) =>
                      setActivation((value) => ({ ...value, reference: event.target.value }))
                    }
                    placeholder="TRX-123456"
                  />
                </Field>
                <Field label="ملاحظة (اختياري)">
                  <input
                    className="input"
                    value={activation.note}
                    onChange={(event) => setActivation((value) => ({ ...value, note: event.target.value }))}
                    placeholder="اسم المُحوِّل مثلًا"
                  />
                </Field>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={activateAction}
                  disabled={isPlanBusy || !chosenPlan || !chosenPlanInfo}
                >
                  {isPlanBusy ? 'جارٍ التنفيذ…' : subState.blocked ? 'تفعيل الاشتراك الآن' : 'تجديد الاشتراك'}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={changePlanAction}
                  disabled={isPlanBusy || subState.blocked || chosenPlan === currentPlanKey}
                >
                  تغيير الباقة بدون تمديد
                </button>
                {chosenPlanInfo ? (
                  <span className="text-xs font-bold text-ink-700">
                    المستحق: {formatMoney(activationTotal)} ({chosenPlanInfo.nameAr} × {activation.months} شهر)
                  </span>
                ) : null}
              </div>
              <p className="mt-1.5 text-[11px] text-ink-400">
                التفعيل يسجّل دفعة إلزامية بالمبلغ المعروض، ويمدّد من نهاية التغطية السارية إن وُجدت. طلبات التجديد
                بأسعار مخصصة (المؤسسية) تُراجع من إدارة المنصة.
              </p>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-bold text-ink-600">آخر المدفوعات</p>
                {payments?.length ? (
                  <div className="overflow-x-auto rounded-lg border border-ink-100">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-ink-100 bg-ink-25 text-ink-500">
                          <th className="px-3 py-2 text-right font-semibold">التاريخ</th>
                          <th className="px-3 py-2 text-right font-semibold">الباقة</th>
                          <th className="px-3 py-2 text-right font-semibold">المبلغ</th>
                          <th className="px-3 py-2 text-right font-semibold">الطريقة</th>
                          <th className="px-3 py-2 text-right font-semibold">المرجع</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payments.slice(0, 8).map((payment) => (
                          <tr key={payment.id} className="border-b border-ink-50 last:border-0">
                            <td className="px-3 py-2 text-ink-500">{formatDateTime(payment.paidAt)}</td>
                            <td className="px-3 py-2 font-semibold text-ink-700">{planName(payment.plan)}</td>
                            <td className="px-3 py-2 font-bold text-ink-800 num">
                              {formatMoney(payment.amountEgp)}
                              <span className="text-[10px] font-normal text-ink-400"> / {payment.months} شهر</span>
                            </td>
                            <td className="px-3 py-2 text-ink-600">{payment.methodLabelAr}</td>
                            <td className="px-3 py-2 text-ink-500" dir="ltr">
                              {payment.reference || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="rounded-lg border border-dashed border-ink-200 px-3 py-4 text-center text-xs text-ink-400">
                    لا توجد مدفوعات مسجّلة بعد.
                  </p>
                )}
              </div>

              <div>
                <p className="mb-2 text-xs font-bold text-ink-600">طلبات التجديد</p>
                {renewalRequests?.length ? (
                  <div className="space-y-1.5">
                    {renewalRequests.slice(0, 5).map((request) => {
                      const meta = RENEWAL_STATUS[request.status] ?? {
                        label: request.status,
                        className: 'border-ink-200 bg-ink-50 text-ink-600',
                      };
                      return (
                        <div
                          key={request.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink-100 px-3 py-2 text-xs"
                        >
                          <div>
                            <p className="font-bold text-ink-700">
                              {planName(request.plan)} · {request.months} شهر
                              <span className="font-normal text-ink-400"> — {formatDateTime(request.createdAt)}</span>
                            </p>
                            {request.reviewNote ? (
                              <p className="mt-0.5 text-ink-500">ملاحظة المراجعة: {request.reviewNote}</p>
                            ) : request.note ? (
                              <p className="mt-0.5 text-ink-500">{request.note}</p>
                            ) : null}
                          </div>
                          <Badge className={meta.className}>{meta.label}</Badge>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="rounded-lg border border-dashed border-ink-200 px-3 py-4 text-center text-xs text-ink-400">
                    لا توجد طلبات تجديد. استخدم الزر أعلى البطاقة لطلب عرض سعر أو تجديد بمساعدة المنصة.
                  </p>
                )}
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      <Modal
        open={renewalOpen}
        onClose={() => setRenewalOpen(false)}
        title="طلب تجديد / عرض سعر"
        subtitle="يراجع الطلب فريق المنصة ثم يفعّل الاشتراك ويسجّل الدفعة"
        size="lg"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setRenewalOpen(false)}>
              إلغاء
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => void submitRenewalRequest()}
              disabled={isRenewalBusy}
            >
              {isRenewalBusy ? 'جارٍ الإرسال…' : 'إرسال الطلب'}
            </button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="الباقة المطلوبة" required>
            <select
              className="input"
              value={renewalForm.plan}
              onChange={(event) => setRenewalForm((value) => ({ ...value, plan: event.target.value }))}
            >
              {(planCatalog ?? [])
                .filter((plan) => !plan.trialOnly)
                .map((plan) => (
                  <option key={plan.key} value={plan.key}>
                    {plan.nameAr}
                    {plan.customPricing ? ' — حسب الاتفاق' : ` — ${formatMoney(plan.monthlyPriceEgp)}/شهر`}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="عدد الشهور" required>
            <select
              className="input"
              value={renewalForm.months}
              onChange={(event) =>
                setRenewalForm((value) => ({ ...value, months: Number(event.target.value) }))
              }
            >
              {[1, 3, 6, 12].map((months) => (
                <option key={months} value={months}>
                  {months} شهر
                </option>
              ))}
            </select>
          </Field>
          <Field label="طريقة الدفع">
            <select
              className="input"
              value={renewalForm.paymentMethod}
              onChange={(event) =>
                setRenewalForm((value) => ({ ...value, paymentMethod: event.target.value }))
              }
            >
              {PAYMENT_METHOD_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="مرجع التحويل (اختياري)">
            <input
              className="input"
              value={renewalForm.reference}
              onChange={(event) =>
                setRenewalForm((value) => ({ ...value, reference: event.target.value }))
              }
              placeholder="BANK-123456"
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="ملاحظة" hint="اذكر السعر المتفق عليه أو أي تفاصيل تساعد المنصة">
              <textarea
                className="input min-h-20"
                value={renewalForm.note}
                onChange={(event) => setRenewalForm((value) => ({ ...value, note: event.target.value }))}
                placeholder="نرغب في تجديد الباقة المؤسسية لمدة سنة بسعر..."
              />
            </Field>
          </div>
        </div>
      </Modal>

      {hasPermission('org:update') ? (
        <Card className="mb-4">
          <div className="card-pad">
            <h3 className="flex items-center gap-2 text-sm font-bold text-ink-800">
              <DatabaseBackup size={16} /> النسخ الاحتياطي
            </h3>
            <p className="mt-1 text-xs text-ink-500">
              نسخة JSON لكل بيانات المركز (تذاكر، عملاء، أجهزة، فواتير، مخزون، مستخدمون) بمعرّفاتها الأصلية —
              قابلة للاستعادة على قاعدة جديدة. الصور والتواقيع ليست داخل الملف وتُنسخ من مجلد الملفات أو التخزين السحابي.
            </p>
            <button type="button" className="btn-secondary mt-3" onClick={downloadBackupAction} disabled={isBackupBusy}>
              <Download size={16} /> {isBackupBusy ? 'جارٍ التحضير…' : 'تنزيل نسخة احتياطية (JSON)'}
            </button>
          </div>
        </Card>
      ) : null}

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
                      <th />
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
                        <td>
                          {hasPermission('branch:manage') ? (
                            <div className="flex flex-wrap gap-1">
                              <button type="button" className="btn-ghost px-2 py-1 text-[11px]" onClick={() => setBranchEdit(branch)}>
                                تعديل
                              </button>
                              {!branch.isDefault ? (
                                <button
                                  type="button"
                                  className={`btn-ghost px-2 py-1 text-[11px] ${branch.isActive === false ? 'text-emerald-700' : 'text-red-600'}`}
                                  onClick={() => void toggleBranch(branch)}
                                >
                                  {branch.isActive === false ? 'تفعيل' : 'تعطيل'}
                                </button>
                              ) : null}
                            </div>
                          ) : null}
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
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {users?.length ? (
                      users.map((user) => (
                        <tr key={user.id}>
                          <td className="text-xs font-medium">
                            <span className="inline-flex items-center gap-1.5">
                              {user.fullName}
                              {user.twoFactorEnabled ? (
                                <ShieldCheck size={13} className="text-emerald-600" aria-label="التحقق بخطوتين مفعّل" />
                              ) : null}
                            </span>
                          </td>
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
                          <td>
                            {hasPermission('user:manage') ? (
                              <div className="flex flex-wrap gap-1">
                                <button type="button" className="btn-ghost px-2 py-1 text-[11px]" onClick={() => setUserEdit(user)}>
                                  تعديل
                                </button>
                                {user.twoFactorEnabled ? (
                                  <button
                                    type="button"
                                    className="btn-ghost px-2 py-1 text-[11px] text-amber-700"
                                    onClick={() => setTwoFactorResetTarget(user)}
                                  >
                                    إعادة تعيين 2FA
                                  </button>
                                ) : null}
                                {user.isActive ? (
                                  <button
                                    type="button"
                                    className="btn-ghost px-2 py-1 text-[11px] text-red-600"
                                    onClick={() => setDeactivateTarget(user)}
                                  >
                                    تعطيل
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className="btn-ghost px-2 py-1 text-[11px] text-emerald-700"
                                    onClick={() => void activateUser(user)}
                                  >
                                    تفعيل
                                  </button>
                                )}
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={7}>
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

      <EditBranchModal
        key={branchEdit?._id ?? 'branch-none'}
        branch={branchEdit}
        onClose={() => setBranchEdit(null)}
        onDone={async () => {
          setBranchEdit(null);
          await Promise.all([mutate('/organizations'), refreshProfile()]);
          toast.success('تم تحديث الفرع');
        }}
        onError={(message) => toast.error(message)}
      />

      <EditUserModal
        key={userEdit?.id ?? 'user-none'}
        user={userEdit}
        branches={data.branches.map((b) => ({ id: b._id, name: b.name }))}
        onClose={() => setUserEdit(null)}
        onDone={async () => {
          setUserEdit(null);
          await Promise.all([mutate('/auth/users'), mutate('/organizations')]);
          toast.success('تم تحديث المستخدم');
        }}
        onError={(message) => toast.error(message)}
      />

      <ConfirmDialog
        open={Boolean(deactivateTarget)}
        title={`تعطيل ${deactivateTarget?.fullName ?? ''}`}
        message="لن يستطيع المستخدم تسجيل الدخول بعد التعطيل، وتبقى بياناته وسجلاته محفوظة. يمكنك تفعيله مرة أخرى في أي وقت."
        confirmLabel="تعطيل المستخدم"
        onCancel={() => setDeactivateTarget(null)}
        onConfirm={() => void deactivateUserAction()}
        isLoading={isUserBusy}
      />

      <ConfirmDialog
        open={Boolean(twoFactorResetTarget)}
        title={`إعادة تعيين التحقق بخطوتين لـ${twoFactorResetTarget?.fullName ?? ''}`}
        message="سيُلغى سر المصادقة وكل رموز الاسترداد، وستُطلب إعادة الإعداد في الدخول القادم. استخدم هذا الخيار فقط إذا فقد المستخدم هاتفه ورموز الاسترداد."
        confirmLabel="إعادة تعيين 2FA"
        onCancel={() => setTwoFactorResetTarget(null)}
        onConfirm={() => void resetUserTwoFactorAction()}
        isLoading={isUserBusy}
      />
    </div>
  );
}

function EditBranchModal({
  branch,
  onClose,
  onDone,
  onError,
}: {
  branch: OrganizationResponse['branches'][number] | null;
  onClose: () => void;
  onDone: () => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState(() => ({
    name: branch?.name ?? '',
    code: branch?.code ?? '',
    phone: branch?.phone ?? '',
    governorate: branch?.address?.governorate ?? '',
    city: branch?.address?.city ?? '',
    area: branch?.address?.area ?? '',
  }));
  const [isSubmitting, setIsSubmitting] = useState(false);

  const open = Boolean(branch);

  const submit = async () => {
    if (!branch) return;
    if (!form.name.trim() || !form.code.trim()) return onError('اسم الفرع والكود مطلوبان');
    setIsSubmitting(true);
    try {
      await api.patch(`/branches/${branch._id}`, {
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
      title={`تعديل ${branch?.name ?? ''}`}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            إلغاء
          </button>
          <button type="button" className="btn-primary" onClick={() => void submit()} disabled={isSubmitting}>
            {isSubmitting ? 'جارٍ الحفظ…' : 'حفظ التعديلات'}
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

function EditUserModal({
  user,
  branches,
  onClose,
  onDone,
  onError,
}: {
  user: UserRow | null;
  branches: { id: string; name: string }[];
  onClose: () => void;
  onDone: () => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState(() => ({
    fullName: user?.fullName ?? '',
    phone: user?.phone ?? '',
    email: user?.email ?? '',
    role: (user?.role ?? 'technician') as Role,
    branchIds: user?.branchIds ?? ([] as string[]),
    newPassword: '',
  }));
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async () => {
    if (!user) return;
    if (form.fullName.trim().length < 2) return onError('اسم المستخدم قصير جدًا');
    if (form.newPassword && form.newPassword.length < 8) return onError('كلمة المرور الجديدة 8 أحرف على الأقل');
    setIsSubmitting(true);
    try {
      await api.patch(`/auth/users/${user.id}`, {
        fullName: form.fullName,
        phone: form.phone,
        email: form.email,
        role: form.role,
        branchIds: form.branchIds,
        ...(form.newPassword ? { newPassword: form.newPassword } : {}),
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
      open={Boolean(user)}
      onClose={onClose}
      title={`تعديل ${user?.fullName ?? ''}`}
      subtitle={`@${user?.username ?? ''}`}
      size="lg"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            إلغاء
          </button>
          <button type="button" className="btn-primary" onClick={() => void submit()} disabled={isSubmitting}>
            {isSubmitting ? 'جارٍ الحفظ…' : 'حفظ التعديلات'}
          </button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="الاسم الكامل" required>
          <input className="input" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
        </Field>
        <Field label="الدور" required>
          <select
            className="input"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
          >
            {Object.entries(ROLE_LABELS_AR)
              .filter(([role]) => role !== 'platform')
              .map(([role, label]) => (
                <option key={role} value={role}>
                  {label}
                </option>
              ))}
          </select>
        </Field>
        <Field label="الهاتف">
          <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" />
        </Field>
        <Field label="البريد الإلكتروني">
          <input type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} dir="ltr" />
        </Field>
        <div className="sm:col-span-2">
          <span className="label">الفروع المسموحة</span>
          <div className="flex flex-wrap gap-2">
            {branches.map((branch) => (
              <label
                key={branch.id}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
                  form.branchIds.includes(branch.id) ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-ink-300'
                }`}
              >
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5"
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
        <div className="sm:col-span-2">
          <Field label="كلمة مرور جديدة (اختياري)" hint="اتركها فارغة إن لم ترغب في تغيير كلمة المرور">
            <input
              type="password"
              className="input"
              value={form.newPassword}
              onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
              dir="ltr"
            />
          </Field>
        </div>
      </div>
    </Modal>
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
