'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  Ban,
  Building2,
  CircleCheck,
  CreditCard,
  Loader2,
  RefreshCw,
  Search,
  Users,
  Wrench,
} from 'lucide-react';
import { api, errorMessage, fetcher, qs } from '@/lib/api';
import { formatDate, formatDateTime, formatMoney, formatNumber } from '@/lib/format';
import { Badge, Card, CardHeader, EmptyState, Field, LoadingBlock, PageHeader, StatCard } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/lib/auth';

/* ------------------------------------------------------------------ */
/* أنواع البيانات (مطابقة لمخرجات /platform)                            */
/* ------------------------------------------------------------------ */

interface SubscriptionSummary {
  plan: string;
  planNameAr: string;
  status: string;
  startedAt: string | null;
  expiresAt: string | null;
  graceEndsAt: string | null;
  daysRemaining: number | null;
  graceDaysRemaining: number | null;
  blocked: boolean;
  inGrace: boolean;
  monthlyPriceEgp: number;
  customPricing: boolean;
  limits: { maxUsers: number; maxBranches: number; monthlyTicketLimit: number };
}

interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  phone: string;
  email: string;
  isActive: boolean;
  createdAt: string | null;
  usersCount: number;
  ticketsThisMonth: number;
  subscription: SubscriptionSummary;
}

interface PlatformStats {
  organizationsTotal: number;
  organizationsByStatus: Record<string, number>;
  organizationsSuspended: number;
  usersTotal: number;
  ticketsThisMonth: number;
  activeSubscriptions: number;
  mrrEgp: number;
  collectedThisMonthEgp: number;
  paymentsThisMonth: number;
}

interface PlatformPlan {
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

interface PlatformPayment {
  id: string;
  organizationId: string | null;
  organizationName: string;
  plan: string;
  amountEgp: number;
  months: number;
  method: string;
  methodLabelAr: string;
  reference: string;
  note: string;
  periodStart: string | null;
  periodEnd: string | null;
  paidAt: string | null;
  source: string;
}

interface PlatformRenewalRequest {
  id: string;
  organizationId: string | null;
  organizationName: string;
  plan: string;
  planNameAr: string;
  months: number;
  paymentMethod: string;
  paymentMethodLabelAr: string;
  paymentReference: string;
  note: string;
  status: string;
  reviewNote: string;
  reviewedAt: string | null;
  createdAt: string | null;
  subscriptionStatus?: string;
  subscriptionBlocked?: boolean;
  daysRemaining?: number | null;
}

interface RevenueResponse {
  range: { from: string; to: string };
  totals: {
    collectedEgp: number;
    paymentsCount: number;
    expectedMrrEgp: number;
    activeSubscriptions: number;
  };
  byPlan: { plan: string; planNameAr: string; count: number; collectedEgp: number }[];
  byMethod: { method: string; methodLabelAr: string; count: number; collectedEgp: number }[];
  recent: PlatformPayment[];
}

interface OrgDetail extends OrgSummary {
  subscription: SubscriptionSummary & { statusLabel: string };
  branches: { id: string; name: string; code: string; isDefault: boolean; isActive: boolean }[];
  users: { id: string; fullName: string; username: string; role: string; isActive: boolean; lastLoginAt: string | null }[];
  payments: PlatformPayment[];
  renewalRequests: PlatformRenewalRequest[];
}

const PAYMENT_METHOD_OPTIONS = [
  ['cash', 'نقدًا'],
  ['bank_transfer', 'تحويل بنكي'],
  ['wallet', 'محفظة إلكترونية'],
  ['cheque', 'شيك'],
  ['other', 'أخرى'],
] as const;

function optionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  trialing: 'bg-sky-50 text-sky-700 border-sky-200',
  past_due: 'bg-amber-50 text-amber-700 border-amber-200',
  cancelled: 'bg-red-50 text-red-700 border-red-200',
};

const STATUS_LABELS: Record<string, string> = {
  active: 'ساري',
  trialing: 'تجريبي',
  past_due: 'مهلة سداد',
  cancelled: 'موقوف',
};

/* ------------------------------------------------------------------ */
/* الصفحة                                                               */
/* ------------------------------------------------------------------ */

export default function PlatformPage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const canManage = hasPermission('platform:orgs:manage');

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [actionError, setActionError] = useState('');

  const stats = useSWR<PlatformStats>('/platform/stats', fetcher, { refreshInterval: 60_000 });
  const orgs = useSWR<{ items: OrgSummary[]; count: number }>('/platform/organizations', fetcher, {
    refreshInterval: 60_000,
  });
  const plans = useSWR<PlatformPlan[]>('/platform/plans', fetcher);
  const renewals = useSWR<{ items: PlatformRenewalRequest[]; count: number }>(
    '/platform/renewal-requests?status=pending',
    fetcher,
    { refreshInterval: 60_000 },
  );

  const [revenueRange, setRevenueRange] = useState({ from: '', to: '' });
  const revenueKey = useMemo(
    () => `/platform/revenue${qs({ from: revenueRange.from, to: revenueRange.to })}`,
    [revenueRange],
  );
  const revenue = useSWR<RevenueResponse>(revenueKey, fetcher);

  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = useSWR<OrgDetail>(detailId ? `/platform/organizations/${detailId}` : null, fetcher);

  const [activateFor, setActivateFor] = useState<OrgSummary | null>(null);
  const [planFor, setPlanFor] = useState<OrgSummary | null>(null);
  const [approveFor, setApproveFor] = useState<PlatformRenewalRequest | null>(null);
  const [rejectFor, setRejectFor] = useState<PlatformRenewalRequest | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [busy, setBusy] = useState(false);

  const [activateForm, setActivateForm] = useState({
    plan: 'growth',
    months: 1,
    monthlyPriceEgp: '',
    amountEgp: '',
    paymentMethod: '',
    paymentReference: '',
    paymentNote: '',
  });
  const [planForm, setPlanForm] = useState({ plan: 'growth', monthlyPriceEgp: '' });
  const [approveForm, setApproveForm] = useState({
    months: 1,
    monthlyPriceEgp: '',
    amountEgp: '',
    paymentMethod: 'bank_transfer',
    paymentReference: '',
    note: '',
  });

  const planOptions = useMemo(() => (plans.data ?? []).filter((plan) => !plan.trialOnly), [plans.data]);
  const selectedActivatePlan = planOptions.find((plan) => plan.key === activateForm.plan);
  const expectedActivateAmount =
    activateForm.amountEgp.trim() !== ''
      ? Number(activateForm.amountEgp) || 0
      : (activateForm.monthlyPriceEgp.trim() !== ''
          ? Number(activateForm.monthlyPriceEgp) || 0
          : selectedActivatePlan?.monthlyPriceEgp ?? 0) * activateForm.months;

  const filtered = useMemo(() => {
    const items = orgs.data?.items ?? [];
    const q = search.trim().toLowerCase();
    return items.filter((org) => {
      if (statusFilter && org.subscription.status !== statusFilter) return false;
      if (!q) return true;
      return org.name.toLowerCase().includes(q) || org.slug.toLowerCase().includes(q) || org.phone.includes(q);
    });
  }, [orgs.data, search, statusFilter]);

  // إغلاق نافذة التفاصيل عند اختفاء المركز من القائمة (إيقاف مثلًا لا يغيّر شيء — لكن احتياط)
  useEffect(() => {
    if (detailId && orgs.data && !orgs.data.items.some((o) => o.id === detailId)) {
      setDetailId(null);
    }
  }, [detailId, orgs.data]);

  async function runAction(action: () => Promise<unknown>, successMessage: string) {
    setBusy(true);
    setActionError('');
    try {
      await action();
      toast.success(successMessage);
      void stats.mutate();
      void orgs.mutate();
      void renewals.mutate();
      void revenue.mutate();
      if (detailId) void detail.mutate();
      setActivateFor(null);
      setPlanFor(null);
      setApproveFor(null);
      setRejectFor(null);
      setRejectNote('');
    } catch (err) {
      const message = errorMessage(err);
      setActionError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  function openActivate(org: OrgSummary) {
    const currentIsPaid = planOptions.some((plan) => plan.key === org.subscription.plan);
    setActivateForm({
      plan: currentIsPaid ? org.subscription.plan : 'growth',
      months: 1,
      monthlyPriceEgp:
        currentIsPaid && org.subscription.customPricing && org.subscription.monthlyPriceEgp
          ? String(org.subscription.monthlyPriceEgp)
          : '',
      amountEgp: '',
      paymentMethod: '',
      paymentReference: '',
      paymentNote: '',
    });
    setActivateFor(org);
  }

  function openChangePlan(org: OrgSummary) {
    const currentIsPaid = planOptions.some((plan) => plan.key === org.subscription.plan);
    setPlanForm({
      plan: currentIsPaid ? org.subscription.plan : 'growth',
      monthlyPriceEgp:
        currentIsPaid && org.subscription.customPricing && org.subscription.monthlyPriceEgp
          ? String(org.subscription.monthlyPriceEgp)
          : '',
    });
    setPlanFor(org);
  }

  function openApprove(request: PlatformRenewalRequest) {
    const catalog = planOptions.find((plan) => plan.key === request.plan);
    setApproveForm({
      months: request.months,
      monthlyPriceEgp: catalog && catalog.monthlyPriceEgp > 0 ? String(catalog.monthlyPriceEgp) : '',
      amountEgp: '',
      paymentMethod: request.paymentMethod || 'bank_transfer',
      paymentReference: request.paymentReference || '',
      note: '',
    });
    setApproveFor(request);
  }

  const toggleActive = (org: OrgSummary) =>
    runAction(
      () => api.patch(`/platform/organizations/${org.id}/status`, { isActive: !org.isActive }),
      org.isActive ? `تم إيقاف مركز «${org.name}»` : `تم تفعيل مركز «${org.name}»`,
    );

  const activateSubscription = (org: OrgSummary) => {
    const payload: Record<string, unknown> = {
      plan: activateForm.plan,
      months: activateForm.months,
    };
    const monthlyPrice = optionalNumber(activateForm.monthlyPriceEgp);
    if (monthlyPrice !== undefined) payload.monthlyPriceEgp = monthlyPrice;
    const amount = optionalNumber(activateForm.amountEgp);
    if (amount !== undefined) payload.amountEgp = amount;
    if (activateForm.paymentMethod) {
      payload.paymentMethod = activateForm.paymentMethod;
      payload.paymentReference = activateForm.paymentReference.trim();
      payload.paymentNote = activateForm.paymentNote.trim();
    }

    return runAction(
      () => api.post(`/platform/organizations/${org.id}/subscription/activate`, payload),
      `تم تفعيل اشتراك «${org.name}»`,
    );
  };

  const changePlan = (org: OrgSummary) => {
    const payload: Record<string, unknown> = { plan: planForm.plan };
    const monthlyPrice = optionalNumber(planForm.monthlyPriceEgp);
    if (monthlyPrice !== undefined) payload.monthlyPriceEgp = monthlyPrice;

    return runAction(
      () => api.post(`/platform/organizations/${org.id}/subscription/change-plan`, payload),
      `تم تغيير باقة «${org.name}»`,
    );
  };

  const approveRenewal = () => {
    if (!approveFor) return;
    const payload: Record<string, unknown> = {};
    const monthlyPrice = optionalNumber(approveForm.monthlyPriceEgp);
    if (monthlyPrice !== undefined) payload.monthlyPriceEgp = monthlyPrice;
    const amount = optionalNumber(approveForm.amountEgp);
    if (amount !== undefined) payload.amountEgp = amount;
    if (approveForm.paymentMethod) payload.paymentMethod = approveForm.paymentMethod;
    if (approveForm.paymentReference.trim()) payload.paymentReference = approveForm.paymentReference.trim();
    if (approveForm.note.trim()) payload.note = approveForm.note.trim();

    return runAction(
      () => api.post(`/platform/renewal-requests/${approveFor.id}/approve`, payload),
      `تم اعتماد طلب تجديد «${approveFor.organizationName}»`,
    );
  };

  const rejectRenewal = () => {
    if (!rejectFor) return;
    if (rejectNote.trim().length < 2) {
      toast.error('اكتب سبب الرفض ليصل إلى مالك المركز.');
      return;
    }
    return runAction(
      () => api.post(`/platform/renewal-requests/${rejectFor.id}/reject`, { note: rejectNote.trim() }),
      `تم رفض طلب «${rejectFor.organizationName}»`,
    );
  };

  return (
    <div>
      <PageHeader
        title="لوحة المنصة"
        subtitle="كل مراكز المنصة: حالة الاشتراك، الاستخدام، والإجراءات الإدارية"
        actions={
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              void stats.mutate();
              void orgs.mutate();
            }}
          >
            <RefreshCw size={15} />
            تحديث
          </button>
        }
      />

      {actionError && !busy ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{actionError}</div>
      ) : null}

      {/* ------------------ الإحصاءات ------------------ */}
      {stats.isLoading ? (
        <Card>
          <LoadingBlock rows={2} />
        </Card>
      ) : stats.error ? (
        <Card className="card-pad text-sm text-red-700">تعذر تحميل إحصاءات المنصة: {errorMessage(stats.error)}</Card>
      ) : stats.data ? (
        <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard
            label="المراكز"
            value={formatNumber(stats.data.organizationsTotal)}
            hint={`موقوفة: ${formatNumber(stats.data.organizationsSuspended)}`}
            icon={<Building2 size={20} />}
          />
          <StatCard
            label="ساري / تجريبي"
            value={`${formatNumber(stats.data.organizationsByStatus.active ?? 0)} / ${formatNumber(stats.data.organizationsByStatus.trialing ?? 0)}`}
            hint={`مهلة سداد: ${formatNumber(stats.data.organizationsByStatus.past_due ?? 0)} — موقوف: ${formatNumber(stats.data.organizationsByStatus.cancelled ?? 0)}`}
            icon={<CircleCheck size={20} />}
            tone="success"
          />
          <StatCard
            label="الإيراد الشهري المتوقع"
            value={formatMoney(stats.data.mrrEgp)}
            hint={`${formatNumber(stats.data.activeSubscriptions)} اشتراك ساري`}
            icon={<CreditCard size={20} />}
            tone="info"
          />
          <StatCard
            label="المحصّل هذا الشهر"
            value={formatMoney(stats.data.collectedThisMonthEgp)}
            hint={`${formatNumber(stats.data.paymentsThisMonth)} دفعة مسجّلة`}
            icon={<CreditCard size={20} />}
            tone="success"
          />
          <StatCard
            label="المستخدمون / تذاكر الشهر"
            value={`${formatNumber(stats.data.usersTotal)} / ${formatNumber(stats.data.ticketsThisMonth)}`}
            icon={<Users size={20} />}
          />
        </div>
      ) : null}

      {/* ------------------ طلبات التجديد المعلّقة ------------------ */}
      {renewals.data && renewals.data.items.length > 0 ? (
        <Card className="mb-5 border-amber-200">
          <CardHeader
            title={`طلبات التجديد المعلّقة (${renewals.data.count})`}
            subtitle="اعتمد الطلب لتفعيل الاشتراك وتسجيل الدفعة، أو ارفضه مع سبب واضح"
            icon={<CreditCard size={18} />}
          />
          <div className="divide-y divide-ink-50">
            {renewals.data.items.map((request) => (
              <div key={request.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="font-bold text-ink-800">{request.organizationName}</p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {request.planNameAr} · {request.months} شهر · {request.paymentMethodLabelAr}
                    {request.paymentReference ? ` · مرجع: ${request.paymentReference}` : ''}
                    {request.createdAt ? ` · ${formatDateTime(request.createdAt)}` : ''}
                    {request.daysRemaining !== null && request.daysRemaining !== undefined
                      ? request.daysRemaining >= 0
                        ? ` · متبقي ${request.daysRemaining} يوم`
                        : ' · الاشتراك منتهٍ'
                      : ''}
                  </p>
                  {request.note ? <p className="mt-1 text-xs text-ink-600">{request.note}</p> : null}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    className="btn-primary text-xs"
                    onClick={() => openApprove(request)}
                    disabled={!canManage || busy}
                  >
                    اعتماد وتفعيل
                  </button>
                  <button
                    type="button"
                    className="btn-ghost text-xs text-red-600"
                    onClick={() => {
                      setRejectFor(request);
                      setRejectNote('');
                    }}
                    disabled={!canManage || busy}
                  >
                    رفض
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {/* ------------------ تقرير الإيرادات ------------------ */}
      <Card className="mb-5">
        <CardHeader
          title="إيرادات الاشتراكات"
          subtitle="المحصّل الفعلي من سجل المدفوعات مقابل الإيراد المتوقع من الاشتراكات السارية"
          icon={<CreditCard size={18} />}
          action={
            <div className="flex flex-wrap items-center gap-1.5">
              <input
                type="date"
                className="input w-auto text-xs"
                value={revenueRange.from}
                onChange={(event) => setRevenueRange((value) => ({ ...value, from: event.target.value }))}
              />
              <span className="text-xs text-ink-400">إلى</span>
              <input
                type="date"
                className="input w-auto text-xs"
                value={revenueRange.to}
                onChange={(event) => setRevenueRange((value) => ({ ...value, to: event.target.value }))}
              />
              {revenueRange.from || revenueRange.to ? (
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => setRevenueRange({ from: '', to: '' })}
                >
                  هذا الشهر
                </button>
              ) : null}
            </div>
          }
        />
        {revenue.isLoading && !revenue.data ? (
          <LoadingBlock rows={4} />
        ) : revenue.error ? (
          <div className="card-pad text-sm text-red-700">تعذر تحميل تقرير الإيرادات: {errorMessage(revenue.error)}</div>
        ) : revenue.data ? (
          <div className="card-pad space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-xs font-semibold text-emerald-700">المحصّل في الفترة</p>
                <p className="mt-1 text-xl font-bold text-emerald-800 num">{formatMoney(revenue.data.totals.collectedEgp)}</p>
                <p className="text-xs text-emerald-700">{formatNumber(revenue.data.totals.paymentsCount)} دفعة</p>
              </div>
              <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
                <p className="text-xs font-semibold text-sky-700">الإيراد الشهري المتوقع</p>
                <p className="mt-1 text-xl font-bold text-sky-800 num">{formatMoney(revenue.data.totals.expectedMrrEgp)}</p>
                <p className="text-xs text-sky-700">{formatNumber(revenue.data.totals.activeSubscriptions)} اشتراك ساري</p>
              </div>
              <div className="rounded-lg border border-ink-200 bg-ink-25 p-3">
                <p className="text-xs font-semibold text-ink-600">الفترة</p>
                <p className="mt-1 text-sm font-bold text-ink-800">
                  {formatDate(revenue.data.range.from)} — {formatDate(revenue.data.range.to)}
                </p>
                <p className="text-xs text-ink-500">حسب تاريخ تسجيل الدفعة</p>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-bold text-ink-600">حسب الباقة</p>
                {revenue.data.byPlan.length ? (
                  <div className="overflow-hidden rounded-lg border border-ink-100">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-ink-100 bg-ink-25 text-ink-500">
                          <th className="px-3 py-2 text-right font-semibold">الباقة</th>
                          <th className="px-3 py-2 text-right font-semibold">الدفعات</th>
                          <th className="px-3 py-2 text-right font-semibold">المحصّل</th>
                        </tr>
                      </thead>
                      <tbody>
                        {revenue.data.byPlan.map((row) => (
                          <tr key={row.plan} className="border-b border-ink-50 last:border-0">
                            <td className="px-3 py-2 font-semibold text-ink-700">{row.planNameAr}</td>
                            <td className="px-3 py-2 text-ink-600 num">{formatNumber(row.count)}</td>
                            <td className="px-3 py-2 font-bold text-ink-800 num">{formatMoney(row.collectedEgp)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="rounded-lg border border-dashed border-ink-200 px-3 py-4 text-center text-xs text-ink-400">
                    لا مدفوعات في الفترة المحددة.
                  </p>
                )}
              </div>

              <div>
                <p className="mb-2 text-xs font-bold text-ink-600">حسب طريقة الدفع</p>
                {revenue.data.byMethod.length ? (
                  <div className="overflow-hidden rounded-lg border border-ink-100">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-ink-100 bg-ink-25 text-ink-500">
                          <th className="px-3 py-2 text-right font-semibold">الطريقة</th>
                          <th className="px-3 py-2 text-right font-semibold">الدفعات</th>
                          <th className="px-3 py-2 text-right font-semibold">المحصّل</th>
                        </tr>
                      </thead>
                      <tbody>
                        {revenue.data.byMethod.map((row) => (
                          <tr key={row.method} className="border-b border-ink-50 last:border-0">
                            <td className="px-3 py-2 font-semibold text-ink-700">{row.methodLabelAr}</td>
                            <td className="px-3 py-2 text-ink-600 num">{formatNumber(row.count)}</td>
                            <td className="px-3 py-2 font-bold text-ink-800 num">{formatMoney(row.collectedEgp)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="rounded-lg border border-dashed border-ink-200 px-3 py-4 text-center text-xs text-ink-400">
                    لا مدفوعات في الفترة المحددة.
                  </p>
                )}
              </div>
            </div>

            {revenue.data.recent.length ? (
              <div>
                <p className="mb-2 text-xs font-bold text-ink-600">أحدث الدفعات</p>
                <div className="overflow-x-auto rounded-lg border border-ink-100">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-ink-100 bg-ink-25 text-ink-500">
                        <th className="px-3 py-2 text-right font-semibold">التاريخ</th>
                        <th className="px-3 py-2 text-right font-semibold">المركز</th>
                        <th className="px-3 py-2 text-right font-semibold">الباقة</th>
                        <th className="px-3 py-2 text-right font-semibold">المبلغ</th>
                        <th className="px-3 py-2 text-right font-semibold">الطريقة</th>
                        <th className="px-3 py-2 text-right font-semibold">المصدر</th>
                      </tr>
                    </thead>
                    <tbody>
                      {revenue.data.recent.slice(0, 8).map((payment) => (
                        <tr key={payment.id} className="border-b border-ink-50 last:border-0">
                          <td className="px-3 py-2 text-ink-500">{payment.paidAt ? formatDateTime(payment.paidAt) : '—'}</td>
                          <td className="px-3 py-2 font-semibold text-ink-700">{payment.organizationName || '—'}</td>
                          <td className="px-3 py-2 text-ink-600">{payment.plan}</td>
                          <td className="px-3 py-2 font-bold text-ink-800 num">{formatMoney(payment.amountEgp)}</td>
                          <td className="px-3 py-2 text-ink-600">{payment.methodLabelAr}</td>
                          <td className="px-3 py-2 text-ink-500">
                            {payment.source === 'platform' ? 'إدارة المنصة' : 'تفعيل ذاتي'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </Card>

      {/* ------------------ قائمة المراكز ------------------ */}
      <Card>
        <CardHeader
          title="المراكز"
          subtitle={orgs.data ? `${filtered.length} من ${orgs.data.count}` : undefined}
          icon={<Building2 size={18} />}
        />

        <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-4 py-3">
          <div className="relative min-w-52 flex-1">
            <Search size={15} className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-ink-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بالاسم أو المعرّف أو الهاتف…"
              className="input pr-9"
            />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input w-auto">
            <option value="">كل الحالات</option>
            <option value="active">ساري</option>
            <option value="trialing">تجريبي</option>
            <option value="past_due">مهلة سداد</option>
            <option value="cancelled">موقوف</option>
          </select>
        </div>

        {orgs.isLoading ? (
          <LoadingBlock rows={6} />
        ) : orgs.error ? (
          <div className="card-pad text-sm text-red-700">تعذر تحميل المراكز: {errorMessage(orgs.error)}</div>
        ) : filtered.length === 0 ? (
          <EmptyState title="لا توجد مراكز مطابقة" icon={<Building2 size={24} />} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-100 text-xs text-ink-500">
                  <th className="px-4 py-2.5 text-right font-semibold">المركز</th>
                  <th className="px-3 py-2.5 text-right font-semibold">الباقة</th>
                  <th className="px-3 py-2.5 text-right font-semibold">الحالة</th>
                  <th className="px-3 py-2.5 text-right font-semibold">الاستخدام</th>
                  <th className="px-3 py-2.5 text-right font-semibold">الحساب</th>
                  <th className="px-3 py-2.5 text-left font-semibold">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((org) => {
                  const sub = org.subscription;
                  const expiredSoon = sub.daysRemaining !== null && sub.daysRemaining <= 5;
                  return (
                    <tr key={org.id} className="border-b border-ink-50 last:border-0 hover:bg-ink-25">
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          className="text-right font-bold text-ink-800 hover:text-brand-700"
                          onClick={() => setDetailId(org.id)}
                        >
                          {org.name}
                        </button>
                        <p className="text-xs text-ink-400" dir="ltr">
                          {org.slug}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <p className="font-semibold text-ink-700">{sub.planNameAr}</p>
                        <p className="text-xs text-ink-400">{formatMoney(sub.monthlyPriceEgp)} / شهر</p>
                      </td>
                      <td className="px-3 py-3">
                        <Badge className={STATUS_STYLES[sub.status] ?? ''}>{STATUS_LABELS[sub.status] ?? sub.status}</Badge>
                        {sub.blocked ? (
                          <p className="mt-1 text-xs font-semibold text-red-600">وضع قراءة فقط</p>
                        ) : sub.inGrace ? (
                          <p className="mt-1 text-xs text-amber-600">داخل مهلة السداد</p>
                        ) : null}
                        {sub.expiresAt ? (
                          <p className={expiredSoon ? 'mt-1 text-xs text-red-600' : 'mt-1 text-xs text-ink-400'}>
                            {sub.daysRemaining !== null && sub.daysRemaining >= 0
                              ? `يتبقى ${formatNumber(sub.daysRemaining)} يوم`
                              : `انتهى في ${formatDate(sub.expiresAt)}`}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 text-xs text-ink-600">
                        <p>
                          مستخدمون: <span className="num font-bold">{formatNumber(org.usersCount)}</span>
                          <span className="text-ink-300"> / </span>
                          {formatNumber(sub.limits.maxUsers)}
                        </p>
                        <p>
                          تذاكر الشهر: <span className="num font-bold">{formatNumber(org.ticketsThisMonth)}</span>
                          <span className="text-ink-300"> / </span>
                          {formatNumber(sub.limits.monthlyTicketLimit)}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <Badge className={org.isActive ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}>
                          {org.isActive ? 'نشط' : 'موقوف'}
                        </Badge>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <button type="button" className="btn-ghost text-xs" onClick={() => setDetailId(org.id)}>
                            التفاصيل
                          </button>
                          {canManage ? (
                            <>
                              <button type="button" className="btn-ghost text-xs" onClick={() => openActivate(org)}>
                                تفعيل اشتراك
                              </button>
                              <button type="button" className="btn-ghost text-xs" onClick={() => openChangePlan(org)}>
                                تغيير الباقة
                              </button>
                              <button
                                type="button"
                                className={org.isActive ? 'btn-ghost text-xs text-red-600' : 'btn-ghost text-xs text-emerald-700'}
                                onClick={() => void toggleActive(org)}
                                disabled={busy}
                              >
                                {busy ? <Loader2 size={13} className="animate-spin" /> : org.isActive ? <Ban size={13} /> : <CircleCheck size={13} />}
                                {org.isActive ? 'إيقاف' : 'تفعيل'}
                              </button>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ------------------ تفاصيل مركز ------------------ */}
      <Modal open={Boolean(detailId)} onClose={() => setDetailId(null)} title="تفاصيل المركز" size="xl">
        {detail.isLoading || !detail.data ? (
          <LoadingBlock rows={6} />
        ) : (
          <PlatformOrgDetail org={detail.data} />
        )}
      </Modal>

      {/* ------------------ تفعيل اشتراك ------------------ */}
      <Modal
        open={Boolean(activateFor)}
        onClose={() => setActivateFor(null)}
        title={`تفعيل اشتراك: ${activateFor?.name ?? ''}`}
        subtitle="التفعيل يسجّل دفعة اختيارية بالمبلغ المحدد ويمدّد من نهاية التغطية السارية"
        size="lg"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="الباقة" required>
            <select
              value={activateForm.plan}
              onChange={(e) => setActivateForm((f) => ({ ...f, plan: e.target.value }))}
              className="input"
            >
              {planOptions.map((plan) => (
                <option key={plan.key} value={plan.key}>
                  {plan.nameAr}
                  {plan.customPricing ? ' — حسب الاتفاق' : ` — ${formatMoney(plan.monthlyPriceEgp)}/شهر`}
                </option>
              ))}
            </select>
          </Field>
          <Field label="عدد الأشهر" required hint="من 1 إلى 36 شهرًا">
            <input
              type="number"
              min={1}
              max={36}
              value={activateForm.months}
              onChange={(e) =>
                setActivateForm((f) => ({ ...f, months: Math.min(36, Math.max(1, Number(e.target.value) || 1)) }))
              }
              className="input"
            />
          </Field>
          <Field
            label="سعر شهري مخصص (اختياري)"
            hint={
              selectedActivatePlan?.customPricing
                ? 'المؤسسية بلا سعر ثابت — أدخل السعر المتفق عليه'
                : 'اتركه فارغًا لاستخدام سعر الكتالوج'
            }
          >
            <input
              type="number"
              min={0}
              value={activateForm.monthlyPriceEgp}
              onChange={(e) => setActivateForm((f) => ({ ...f, monthlyPriceEgp: e.target.value }))}
              className="input"
              placeholder={String(selectedActivatePlan?.monthlyPriceEgp ?? 0)}
            />
          </Field>
          <Field label="المبلغ المحصّل (اختياري)" hint="الافتراضي: السعر × عدد الأشهر">
            <input
              type="number"
              min={0}
              value={activateForm.amountEgp}
              onChange={(e) => setActivateForm((f) => ({ ...f, amountEgp: e.target.value }))}
              className="input"
              placeholder={String(expectedActivateAmount)}
            />
          </Field>
          <Field label="طريقة الدفع" hint="اختر «بدون دفعة» للمنحة أو التسوية الإدارية">
            <select
              value={activateForm.paymentMethod}
              onChange={(e) => setActivateForm((f) => ({ ...f, paymentMethod: e.target.value }))}
              className="input"
            >
              <option value="">بدون دفعة (منحة/تسوية)</option>
              {PAYMENT_METHOD_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="مرجع الدفع">
            <input
              value={activateForm.paymentReference}
              onChange={(e) => setActivateForm((f) => ({ ...f, paymentReference: e.target.value }))}
              className="input"
              placeholder="TRX-123456"
              disabled={!activateForm.paymentMethod}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="ملاحظة الدفع">
              <input
                value={activateForm.paymentNote}
                onChange={(e) => setActivateForm((f) => ({ ...f, paymentNote: e.target.value }))}
                className="input"
                placeholder="تفاصيل الاتفاق أو اسم المُحوِّل"
                disabled={!activateForm.paymentMethod}
              />
            </Field>
          </div>
          <p className="text-xs font-bold text-ink-700 sm:col-span-2">
            المبلغ الذي سيُسجَّل: {formatMoney(activateForm.amountEgp.trim() ? Number(activateForm.amountEgp) || 0 : expectedActivateAmount)}
          </p>
        </div>
        <div className="flex justify-end gap-2 pt-4">
          <button type="button" className="btn-secondary" onClick={() => setActivateFor(null)}>
            إلغاء
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={() => activateFor && void activateSubscription(activateFor)}
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : null}
            تفعيل
          </button>
        </div>
      </Modal>

      {/* ------------------ تغيير باقة ------------------ */}
      <Modal
        open={Boolean(planFor)}
        onClose={() => setPlanFor(null)}
        title={`تغيير الباقة: ${planFor?.name ?? ''}`}
        subtitle="تغيير الباقة لا يمدّد المدة ولا يسجّل دفعة"
      >
        <div className="space-y-3">
          <Field label="الباقة الجديدة" required hint="الحدود الجديدة تُطبق فورًا">
            <select
              value={planForm.plan}
              onChange={(e) => setPlanForm((f) => ({ ...f, plan: e.target.value }))}
              className="input"
            >
              {planOptions.map((plan) => (
                <option key={plan.key} value={plan.key}>
                  {plan.nameAr}
                  {plan.customPricing ? ' — حسب الاتفاق' : ` — ${formatMoney(plan.monthlyPriceEgp)}/شهر`}
                </option>
              ))}
            </select>
          </Field>
          <Field label="سعر شهري مخصص (اختياري)" hint="للمؤسسية أو أي اتفاق خاص">
            <input
              type="number"
              min={0}
              value={planForm.monthlyPriceEgp}
              onChange={(e) => setPlanForm((f) => ({ ...f, monthlyPriceEgp: e.target.value }))}
              className="input"
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setPlanFor(null)}>
              إلغاء
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => planFor && void changePlan(planFor)}
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : null}
              تغيير
            </button>
          </div>
        </div>
      </Modal>

      {/* ------------------ اعتماد طلب تجديد ------------------ */}
      <Modal
        open={Boolean(approveFor)}
        onClose={() => setApproveFor(null)}
        title={`اعتماد طلب تجديد: ${approveFor?.organizationName ?? ''}`}
        subtitle={`${approveFor?.planNameAr ?? ''} · ${approveFor?.months ?? 0} شهر · ${approveFor?.paymentMethodLabelAr ?? ''}`}
        size="lg"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="عدد الأشهر" required>
            <input
              type="number"
              min={1}
              max={36}
              value={approveForm.months}
              onChange={(e) =>
                setApproveForm((f) => ({ ...f, months: Math.min(36, Math.max(1, Number(e.target.value) || 1)) }))
              }
              className="input"
            />
          </Field>
          <Field label="سعر شهري مخصص (اختياري)" hint="اتركه فارغًا لسعر الكتالوج">
            <input
              type="number"
              min={0}
              value={approveForm.monthlyPriceEgp}
              onChange={(e) => setApproveForm((f) => ({ ...f, monthlyPriceEgp: e.target.value }))}
              className="input"
            />
          </Field>
          <Field label="المبلغ المحصّل (اختياري)" hint="الافتراضي: السعر × عدد الأشهر">
            <input
              type="number"
              min={0}
              value={approveForm.amountEgp}
              onChange={(e) => setApproveForm((f) => ({ ...f, amountEgp: e.target.value }))}
              className="input"
            />
          </Field>
          <Field label="طريقة الدفع">
            <select
              value={approveForm.paymentMethod}
              onChange={(e) => setApproveForm((f) => ({ ...f, paymentMethod: e.target.value }))}
              className="input"
            >
              {PAYMENT_METHOD_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="مرجع الدفع">
            <input
              value={approveForm.paymentReference}
              onChange={(e) => setApproveForm((f) => ({ ...f, paymentReference: e.target.value }))}
              className="input"
            />
          </Field>
          <Field label="ملاحظة الاعتماد">
            <input
              value={approveForm.note}
              onChange={(e) => setApproveForm((f) => ({ ...f, note: e.target.value }))}
              className="input"
              placeholder="تم تأكيد التحويل..."
            />
          </Field>
          {approveFor?.note ? (
            <p className="rounded-lg border border-ink-100 bg-ink-25 px-3 py-2 text-xs text-ink-600 sm:col-span-2">
              ملاحظة المركز: {approveFor.note}
            </p>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 pt-4">
          <button type="button" className="btn-secondary" onClick={() => setApproveFor(null)}>
            إلغاء
          </button>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void approveRenewal()}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : null}
            اعتماد وتفعيل
          </button>
        </div>
      </Modal>

      {/* ------------------ رفض طلب تجديد ------------------ */}
      <Modal
        open={Boolean(rejectFor)}
        onClose={() => setRejectFor(null)}
        title={`رفض طلب: ${rejectFor?.organizationName ?? ''}`}
        subtitle="يُرسل سبب الرفض إلى مالكي المركز كإشعار داخلي"
        size="sm"
      >
        <Field label="سبب الرفض" required>
          <textarea
            className="input min-h-24"
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            placeholder="بيانات التحويل غير مكتملة..."
          />
        </Field>
        <div className="flex justify-end gap-2 pt-4">
          <button type="button" className="btn-secondary" onClick={() => setRejectFor(null)}>
            إلغاء
          </button>
          <button
            type="button"
            className="btn-primary bg-red-600 hover:bg-red-700"
            disabled={busy}
            onClick={() => void rejectRenewal()}
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : null}
            رفض الطلب
          </button>
        </div>
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* تفاصيل المركز داخل النافذة                                            */
/* ------------------------------------------------------------------ */

function PlatformOrgDetail({ org }: { org: OrgDetail }) {
  const sub = org.subscription;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-ink-100 p-3">
          <p className="text-xs font-semibold text-ink-500">الاشتراك</p>
          <p className="mt-1 font-bold text-ink-800">{sub.planNameAr}</p>
          <p className="mt-0.5 text-xs text-ink-500">
            {sub.statusLabel} — حتى {sub.expiresAt ? formatDate(sub.expiresAt) : '—'}
          </p>
          <p className="mt-0.5 text-xs text-ink-500">
            {sub.customPricing ? 'تسعير حسب الاتفاق' : `${formatMoney(sub.monthlyPriceEgp)}/شهر`}
            {sub.inGrace && sub.graceDaysRemaining !== null
              ? ` · مهلة السداد: ${formatNumber(Math.max(sub.graceDaysRemaining, 0))} يوم`
              : ''}
          </p>
          {sub.blocked ? <Badge className="mt-2 bg-red-50 text-red-700 border-red-200">قراءة فقط</Badge> : null}
        </div>
        <div className="rounded-lg border border-ink-100 p-3">
          <p className="text-xs font-semibold text-ink-500">الاستخدام الشهري</p>
          <p className="mt-1 font-bold text-ink-800 num">
            {formatNumber(org.usersCount)} <span className="text-xs text-ink-400">مستخدم من {formatNumber(sub.limits.maxUsers)}</span>
          </p>
          <p className="mt-0.5 text-xs text-ink-500 num">
            {formatNumber(org.ticketsThisMonth)} <span className="text-xs text-ink-400">تذكرة من {formatNumber(sub.limits.monthlyTicketLimit)}</span>
          </p>
        </div>
        <div className="rounded-lg border border-ink-100 p-3">
          <p className="text-xs font-semibold text-ink-500">تواصل</p>
          <p className="mt-1 text-sm text-ink-700" dir="ltr">
            {org.phone || '—'}
          </p>
          <p className="text-xs text-ink-500" dir="ltr">
            {org.email || '—'}
          </p>
        </div>
      </div>

      <div>
        <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-ink-600">
          <Building2 size={13} /> الفروع ({org.branches.length})
        </p>
        {org.branches.length === 0 ? (
          <p className="text-xs text-ink-400">لا فروع</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {org.branches.map((b) => (
              <Badge key={b.id} className={b.isActive ? '' : 'bg-ink-100 text-ink-400'}>
                {b.name} {b.isDefault ? '★' : ''}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-ink-600">
          <Wrench size={13} /> آخر المستخدمين
        </p>
        <div className="overflow-hidden rounded-lg border border-ink-100">
          <table className="w-full text-xs">
            <tbody>
              {org.users.map((u) => (
                <tr key={u.id} className="border-b border-ink-50 last:border-0">
                  <td className="px-3 py-2 font-semibold text-ink-700">{u.fullName}</td>
                  <td className="px-3 py-2 text-ink-500" dir="ltr">
                    {u.username}
                  </td>
                  <td className="px-3 py-2 text-ink-500">{u.role}</td>
                  <td className="px-3 py-2">
                    {u.isActive ? (
                      <span className="text-emerald-600">نشط</span>
                    ) : (
                      <span className="text-ink-400">موقوف</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-ink-400">{u.lastLoginAt ? formatDate(u.lastLoginAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-ink-600">
          <CreditCard size={13} /> آخر المدفوعات ({org.payments.length})
        </p>
        {org.payments.length === 0 ? (
          <p className="text-xs text-ink-400">لا مدفوعات مسجّلة.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-ink-100">
            <table className="w-full text-xs">
              <tbody>
                {org.payments.map((payment) => (
                  <tr key={payment.id} className="border-b border-ink-50 last:border-0">
                    <td className="px-3 py-2 text-ink-500">{payment.paidAt ? formatDateTime(payment.paidAt) : '—'}</td>
                    <td className="px-3 py-2 font-semibold text-ink-700">{payment.plan}</td>
                    <td className="px-3 py-2 font-bold text-ink-800 num">{formatMoney(payment.amountEgp)}</td>
                    <td className="px-3 py-2 text-ink-500">{payment.months} شهر</td>
                    <td className="px-3 py-2 text-ink-500">{payment.methodLabelAr}</td>
                    <td className="px-3 py-2 text-ink-400" dir="ltr">
                      {payment.reference || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-ink-600">
          <CreditCard size={13} /> طلبات التجديد ({org.renewalRequests.length})
        </p>
        {org.renewalRequests.length === 0 ? (
          <p className="text-xs text-ink-400">لا طلبات تجديد.</p>
        ) : (
          <div className="space-y-1.5">
            {org.renewalRequests.map((request) => (
              <div
                key={request.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink-100 px-3 py-2 text-xs"
              >
                <span className="font-semibold text-ink-700">
                  {request.planNameAr} · {request.months} شهر
                  {request.createdAt ? ` — ${formatDateTime(request.createdAt)}` : ''}
                </span>
                <span className="text-ink-500">
                  {request.status === 'pending'
                    ? 'قيد المراجعة'
                    : request.status === 'approved'
                      ? 'معتمد'
                      : request.status === 'rejected'
                        ? `مرفوض${request.reviewNote ? `: ${request.reviewNote}` : ''}`
                        : 'ملغي'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
