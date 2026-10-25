'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import Link from 'next/link';
import { AlertTriangle, Package, Plus, Search, ShieldCheck, TrendingDown, Wrench } from 'lucide-react';
import { api, errorMessage, fetcher, qs } from '@/lib/api';
import { formatDateTime, formatMoney, formatNumber, formatPercent } from '@/lib/format';
import { FAULT_CATEGORY_LABELS, WARRANTY_STATUS_LABELS } from '@/lib/constants';
import { Badge, Card, CardHeader, EmptyState, Field, LoadingBlock, PageHeader, StatCard } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/lib/auth';

interface WarrantyIntelligence {
  totalClaims: number;
  totalDeliveredTickets: number;
  returnRatePct: number;
  totalWarrantyCostEgp: number;
  byStatus: { status: string; count: number; costEgp: number }[];
  byFaultCategory: { faultCategory: string; claims: number; sameFaultClaims: number; sameFaultPct: number }[];
  byTechnician: {
    technicianId: string | null;
    name: string;
    claims: number;
    sameFaultClaims: number;
    avgDaysToReturn: number;
    note: string;
  }[];
  topReturningDevices: { deviceId: string | null; device: string; claims: number; sameFaultClaims: number }[];
}

interface ClaimRow {
  _id: string;
  claimNumber: string;
  status: string;
  coverage: string;
  symptom: string;
  isSameFault: boolean;
  misuseSuspected?: boolean;
  daysSinceDelivery: number;
  reportedAt: string;
  repairCostEgp: number;
  chargedToCustomerEgp: number;
  chargedToSupplierEgp: number;
  decisionNotes?: string;
  rejectedReason?: string;
  supplierClaimStatus?: string;
  resolutionNotes?: string;
  customerId?: { fullName: string; phone: string } | null;
  deviceId?: { brand: string; model: string } | null;
  originalTicketId?: { ticketNumber: string } | null;
  originalTechnicianId?: { fullName: string } | null;
}

interface FailingPart {
  partId: string;
  name: string;
  sku: string;
  category: string;
  grade: string;
  unitsUsed: number;
  failures: number;
  failureRatePct: number;
  estimatedLossEgp: number;
}

export default function WarrantyPage() {
  const toast = useToast();
  const { hasPermission } = useAuth();
  const [tab, setTab] = useState<'claims' | 'intelligence'>('claims');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [selectedClaim, setSelectedClaim] = useState<ClaimRow | null>(null);
  const [openClaim, setOpenClaim] = useState(false);

  const claimsKey = `/warranty/claims${qs({ status: statusFilter || undefined, page, limit: 20 })}`;
  const { data: claims, error, isLoading } = useSWR<{ items: ClaimRow[]; meta: { total: number; page: number; pages: number } }>(
    tab === 'claims' ? claimsKey : null,
    fetcher,
  );
  // بطاقات الإحصاء ظاهرة في التبويبين، لذا تُجلب دائمًا وليست مرتبطة بتبويب التحليلات
  const { data: intel } = useSWR<WarrantyIntelligence>('/warranty/intelligence', fetcher);
  const { data: failing } = useSWR<FailingPart[]>('/warranty/failing-parts', fetcher);

  return (
    <div>
      <PageHeader
        title="الضمان والمطالبات"
        subtitle="قياس معدلات العودة وربطها بالقطعة والفني والموديل"
        actions={
          hasPermission('warranty:manage') ? (
            <button type="button" className="btn-primary" onClick={() => setOpenClaim(true)}>
              <Plus size={16} /> فتح مطالبة ضمان
            </button>
          ) : null
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="إجمالي مطالبات الضمان"
          value={formatNumber(claims?.meta.total ?? intel?.totalClaims ?? 0)}
          icon={<ShieldCheck size={18} />}
          tone="info"
        />
        <StatCard
          label="معدل العودة"
          value={formatPercent(intel?.returnRatePct ?? 0)}
          hint={`من ${formatNumber(intel?.totalDeliveredTickets ?? 0)} إصلاح مُسلَّم`}
          icon={<TrendingDown size={18} />}
          tone={(intel?.returnRatePct ?? 0) > 5 ? 'warning' : 'success'}
        />
        <StatCard
          label="تكلفة الضمان"
          value={formatMoney(intel?.totalWarrantyCostEgp ?? 0)}
          icon={<AlertTriangle size={18} />}
          tone="danger"
        />
        <StatCard
          label="قطع بمعدل فشل مرتفع"
          value={formatNumber(failing?.length ?? 0)}
          hint="تحتاج مراجعة المورد"
          icon={<Package size={18} />}
          tone={(failing?.length ?? 0) > 0 ? 'warning' : 'success'}
        />
      </div>

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-3 py-2">
          {[
            ['claims', 'قائمة المطالبات'],
            ['intelligence', 'تحليلات الضمان'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value as typeof tab)}
              className={`btn px-3 py-1.5 text-xs ${tab === value ? 'bg-brand-700 text-white' : 'text-ink-600 hover:bg-ink-100'}`}
            >
              {label}
            </button>
          ))}
          {tab === 'claims' ? (
            <select
              className="input ms-auto w-auto text-xs"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">كل الحالات</option>
              {Object.entries(WARRANTY_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          ) : null}
        </div>

        {tab === 'intelligence' ? (
          <div className="card-pad space-y-5">
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm font-bold text-ink-800">توزيع المطالبات حسب الحالة</h3>
                <div className="space-y-1.5">
                  {intel?.byStatus?.map((row) => (
                    <div key={row.status} className="flex items-center justify-between rounded-lg border border-ink-200 px-3 py-2 text-xs">
                      <span>{WARRANTY_STATUS_LABELS[row.status] ?? row.status}</span>
                      <span className="num font-bold">
                        {row.count} · {formatMoney(row.costEgp)}
                      </span>
                    </div>
                  ))}
                  {!intel?.byStatus?.length ? <p className="text-xs text-ink-500">لا بيانات.</p> : null}
                </div>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-bold text-ink-800">أكثر الأعطال عودة</h3>
                <div className="space-y-1.5">
                  {intel?.byFaultCategory?.slice(0, 8).map((row) => (
                    <div key={row.faultCategory} className="rounded-lg border border-ink-200 px-3 py-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{row.faultCategory || 'غير محدد'}</span>
                        <span className="num font-bold">{row.claims}</span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-ink-500">
                        نفس العطل: {row.sameFaultClaims} ({formatPercent(row.sameFaultPct)})
                      </p>
                    </div>
                  ))}
                  {!intel?.byFaultCategory?.length ? <p className="text-xs text-ink-500">لا بيانات.</p> : null}
                </div>
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-bold text-ink-800">العودة حسب الفني</h3>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>الفني</th>
                      <th>المطالبات</th>
                      <th>نفس العطل</th>
                      <th>متوسط الأيام حتى العودة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {intel?.byTechnician?.map((row) => (
                      <tr key={row.technicianId ?? 'unknown'}>
                        <td className="text-xs font-medium">{row.name}</td>
                        <td className="num text-xs">{row.claims}</td>
                        <td className="num text-xs">{row.sameFaultClaims}</td>
                        <td className="num text-xs">{row.avgDaysToReturn} يوم</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[11px] leading-relaxed text-amber-800">
                تنبيه منهجي: هذه المؤشرات سياقية. بعض الأعطال أكثر تعقيدًا من غيرها، ولا يجب استخدامها كأداة عقابية آلية.
              </p>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-bold text-ink-800">قطع تحتاج مراجعة المورد</h3>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>القطعة</th>
                      <th>الوحدات المستخدمة</th>
                      <th>مرات الفشل</th>
                      <th>معدل الفشل</th>
                      <th>خسارة تقديرية</th>
                    </tr>
                  </thead>
                  <tbody>
                    {failing?.length ? (
                      failing.map((part) => (
                        <tr key={part.partId}>
                          <td className="text-xs">
                            <p className="font-medium text-ink-800">{part.name}</p>
                            <p className="text-ink-400" dir="ltr">
                              {part.sku}
                            </p>
                          </td>
                          <td className="num text-xs">{part.unitsUsed}</td>
                          <td className="num text-xs">{part.failures}</td>
                          <td>
                            <span
                              className={`badge border ${
                                part.failureRatePct > 10
                                  ? 'border-red-200 bg-red-50 text-red-700'
                                  : 'border-amber-200 bg-amber-50 text-amber-800'
                              }`}
                            >
                              {part.failureRatePct}%
                            </span>
                          </td>
                          <td className="num text-xs text-red-600">{formatMoney(part.estimatedLossEgp)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5}>
                          <EmptyState title="لا توجد قطع بمعدلات فشل مسجلة" icon={<Package size={20} />} />
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {intel?.topReturningDevices?.length ? (
              <div>
                <h3 className="mb-2 text-sm font-bold text-ink-800">أجهزة متكررة العودة</h3>
                <div className="flex flex-wrap gap-2">
                  {intel.topReturningDevices.map((device) => (
                    <Link
                      key={device.deviceId ?? device.device}
                      href={device.deviceId ? `/devices/${device.deviceId}` : '#'}
                      className="rounded-lg border border-ink-200 px-3 py-2 text-xs transition hover:border-brand-400"
                    >
                      <span className="block font-medium text-ink-800">{device.device}</span>
                      <span className="block text-[11px] text-ink-500">
                        {device.claims} مطالبة · نفس العطل {device.sameFaultClaims}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <>
            {error ? (
              <div className="border-b border-red-200 bg-red-50 p-4 text-sm text-red-700">{errorMessage(error)}</div>
            ) : null}
            {isLoading ? (
              <LoadingBlock rows={6} />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>رقم المطالبة</th>
                      <th>العميل</th>
                      <th>الجهاز</th>
                      <th>التذكرة الأصلية</th>
                      <th>العَرَض</th>
                      <th>أيام بعد التسليم</th>
                      <th>الحالة</th>
                      <th>التكلفة</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {claims?.items?.length ? (
                      claims.items.map((claim) => (
                        <tr key={claim._id}>
                          <td className="font-bold text-ink-900" dir="ltr">
                            {claim.claimNumber}
                          </td>
                          <td className="text-xs">{claim.customerId?.fullName ?? '—'}</td>
                          <td className="text-xs">
                            {claim.deviceId ? `${claim.deviceId.brand} ${claim.deviceId.model}` : '—'}
                          </td>
                          <td className="text-xs">
                            {claim.originalTicketId ? (
                              <Link
                                href={`/tickets/${(claim.originalTicketId as unknown as { _id?: string })._id ?? ''}`}
                                className="text-brand-700 hover:underline"
                                dir="ltr"
                              >
                                {claim.originalTicketId.ticketNumber}
                              </Link>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="max-w-[16rem] text-xs">
                            <p className="line-clamp-2 text-ink-600">{claim.symptom}</p>
                            {claim.isSameFault ? (
                              <Badge className="mt-1 border-amber-200 bg-amber-50 text-amber-800">نفس العطل</Badge>
                            ) : null}
                            {claim.misuseSuspected ? (
                              <Badge className="mt-1 border-red-200 bg-red-50 text-red-700">اشتباه سوء استخدام</Badge>
                            ) : null}
                          </td>
                          <td className="num text-xs">{claim.daysSinceDelivery}</td>
                          <td>
                            <Badge
                              className={
                                claim.status === 'resolved'
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                  : claim.status === 'rejected'
                                    ? 'border-red-200 bg-red-50 text-red-700'
                                    : 'border-amber-200 bg-amber-50 text-amber-800'
                              }
                            >
                              {WARRANTY_STATUS_LABELS[claim.status] ?? claim.status}
                            </Badge>
                          </td>
                          <td className="num text-xs">{formatMoney(claim.repairCostEgp)}</td>
                          <td>
                            {hasPermission('warranty:manage') ? (
                              <button type="button" className="btn-ghost text-xs" onClick={() => setSelectedClaim(claim)}>
                                قرار
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={9}>
                          <EmptyState title="لا توجد مطالبات" icon={<ShieldCheck size={22} />} />
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {claims && claims.meta.pages > 1 ? (
              <div className="flex items-center justify-between border-t border-ink-100 px-4 py-3 text-xs text-ink-600">
                <span>
                  صفحة {claims.meta.page} من {claims.meta.pages}
                </span>
                <div className="flex gap-2">
                  <button type="button" className="btn-secondary text-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    السابق
                  </button>
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    disabled={page >= claims.meta.pages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    التالي
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </Card>

      {openClaim ? (
        <OpenClaimModal
          onClose={() => setOpenClaim(false)}
          onDone={async (claimNumber) => {
            setOpenClaim(false);
            await Promise.all([mutate(claimsKey), mutate('/warranty/intelligence')]);
            toast.success(`تم فتح مطالبة الضمان ${claimNumber}`);
          }}
          onError={(message) => toast.error(message)}
        />
      ) : null}

      <ClaimDecisionModal
        key={selectedClaim?._id ?? 'none'}
        claim={selectedClaim}
        onClose={() => setSelectedClaim(null)}
        onDone={async () => {
          setSelectedClaim(null);
          await Promise.all([mutate(claimsKey), mutate('/warranty/intelligence')]);
          toast.success('تم تسجيل قرار الضمان');
        }}
        onError={(message) => toast.error(message)}
      />

      <p className="mt-4 flex items-center gap-1.5 text-[11px] text-ink-400">
        <Wrench size={12} /> آخر تحديث: {formatDateTime(new Date())}
      </p>
    </div>
  );
}

function ClaimDecisionModal({
  claim,
  onClose,
  onDone,
  onError,
}: {
  claim: ClaimRow | null;
  onClose: () => void;
  onDone: () => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState(() => ({
    status: claim && !['open', 'under_review'].includes(claim.status) ? claim.status : 'approved',
    coverage: claim?.coverage ?? 'both',
    decisionNotes: claim?.decisionNotes ?? '',
    rejectedReason: claim?.rejectedReason ?? '',
    repairCostEgp: claim?.repairCostEgp ? String(claim.repairCostEgp) : '',
    chargedToCustomerEgp: String(claim?.chargedToCustomerEgp ?? 0),
    chargedToSupplierEgp: String(claim?.chargedToSupplierEgp ?? 0),
    supplierClaimStatus: claim?.supplierClaimStatus ?? 'not_applicable',
    resolutionNotes: claim?.resolutionNotes ?? '',
  }));
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!claim) return null;

  const submit = async () => {
    if (form.status === 'rejected' && !form.rejectedReason.trim()) {
      onError('سبب الرفض مطلوب عند رفض المطالبة');
      return;
    }
    setIsSubmitting(true);
    try {
      await api.post(`/warranty/claims/${claim._id}/decide`, {
        status: form.status,
        coverage: form.coverage,
        decisionNotes: form.decisionNotes,
        rejectedReason: form.rejectedReason,
        repairCostEgp: Number(form.repairCostEgp) || 0,
        chargedToCustomerEgp: Number(form.chargedToCustomerEgp) || 0,
        chargedToSupplierEgp: Number(form.chargedToSupplierEgp) || 0,
        supplierClaimStatus: form.supplierClaimStatus,
        resolutionNotes: form.resolutionNotes,
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
      open
      onClose={onClose}
      title={`قرار الضمان — ${claim.claimNumber}`}
      subtitle={`${claim.deviceId?.brand ?? ''} ${claim.deviceId?.model ?? ''} · ${claim.symptom.slice(0, 60)}`}
      size="lg"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            إلغاء
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={isSubmitting}>
            {isSubmitting ? 'جارٍ الحفظ…' : 'تسجيل القرار'}
          </button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="القرار">
          <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            {Object.entries(WARRANTY_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="التغطية">
          <select className="input" value={form.coverage} onChange={(e) => setForm({ ...form, coverage: e.target.value })}>
            <option value="both">قطعة + مصنعية</option>
            <option value="part">قطعة فقط</option>
            <option value="labor">مصنعية فقط</option>
            <option value="none">بدون تغطية</option>
          </select>
        </Field>
        <Field label="تكلفة الإصلاح التعويضي">
          <input
            className="input"
            type="number"
            min={0}
            value={form.repairCostEgp}
            onChange={(e) => setForm({ ...form, repairCostEgp: e.target.value })}
          />
        </Field>
        <Field label="محصّل من العميل">
          <input
            className="input"
            type="number"
            min={0}
            value={form.chargedToCustomerEgp}
            onChange={(e) => setForm({ ...form, chargedToCustomerEgp: e.target.value })}
          />
        </Field>
        <Field label="محصّل من المورد" hint="عند تحميل المورد تكلفة القطعة المعيبة">
          <input
            className="input"
            type="number"
            min={0}
            value={form.chargedToSupplierEgp}
            onChange={(e) => setForm({ ...form, chargedToSupplierEgp: e.target.value })}
          />
        </Field>
        <Field label="حالة claim المورد">
          <select
            className="input"
            value={form.supplierClaimStatus}
            onChange={(e) => setForm({ ...form, supplierClaimStatus: e.target.value })}
          >
            <option value="not_applicable">لا ينطبق</option>
            <option value="requested">تم الطلب</option>
            <option value="accepted">قبله المورد</option>
            <option value="rejected">رفضه المورد</option>
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="أساس القرار">
            <textarea
              className="input min-h-[3rem]"
              value={form.decisionNotes}
              onChange={(e) => setForm({ ...form, decisionNotes: e.target.value })}
            />
          </Field>
        </div>
        {form.status === 'rejected' ? (
          <div className="sm:col-span-2">
            <Field label="سبب الرفض" required>
              <textarea
                className="input min-h-[3rem]"
                value={form.rejectedReason}
                onChange={(e) => setForm({ ...form, rejectedReason: e.target.value })}
                placeholder="مثال: وجود آثار سوائل وكسر خارجي خارج نطاق الضمان"
              />
            </Field>
          </div>
        ) : null}
        <div className="sm:col-span-2">
          <Field label="ملاحظات الحل">
            <textarea
              className="input min-h-[3rem]"
              value={form.resolutionNotes}
              onChange={(e) => setForm({ ...form, resolutionNotes: e.target.value })}
            />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

interface DeliveredTicket {
  _id: string;
  ticketNumber: string;
  status: string;
  deliveredAt?: string | null;
  warranty?: { policyDays?: number; startsAt?: string | null; expiresAt?: string | null; isVoid?: boolean } | null;
  customerId?: { fullName?: string; phone?: string } | null;
  deviceId?: { brand?: string; model?: string; imei?: string } | null;
  assignedTechnicianId?: { fullName?: string } | null;
}

function OpenClaimModal({
  onClose,
  onDone,
  onError,
}: {
  onClose: () => void;
  onDone: (claimNumber: string) => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [ticket, setTicket] = useState<DeliveredTicket | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState({
    symptom: '',
    coverage: 'both',
    faultCategory: '',
    isSameFault: true,
    misuseSuspected: false,
    physicalDamageFound: false,
    liquidDamageFound: false,
    thirdPartyIntervention: false,
    createNewTicket: true,
    priority: 'high',
  });

  const { data, isLoading } = useSWR<{ items: DeliveredTicket[] }>(
    `/tickets${qs({ status: 'delivered,warranty', q: search || undefined, limit: 20, sort: '-updatedAt' })}`,
    fetcher,
  );

  const submit = async () => {
    if (!ticket) return onError('اختر التذكرة المُسلَّمة أولًا');
    if (form.symptom.trim().length < 3) return onError('اكتب وصف العَرَض (٣ أحرف على الأقل)');
    setIsSubmitting(true);
    try {
      const response = await api.post<{ claimNumber: string }>('/warranty/claims', {
        originalTicketId: ticket._id,
        symptom: form.symptom.trim(),
        coverage: form.coverage,
        faultCategory: form.faultCategory,
        isSameFault: form.isSameFault,
        misuseSuspected: form.misuseSuspected,
        physicalDamageFound: form.physicalDamageFound,
        liquidDamageFound: form.liquidDamageFound,
        thirdPartyIntervention: form.thirdPartyIntervention,
        createNewTicket: form.createNewTicket,
        priority: form.priority,
      });
      await onDone(response.claimNumber);
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const expiry = ticket?.warranty?.expiresAt ? new Date(ticket.warranty.expiresAt) : null;
  const warrantyActive = Boolean(expiry && expiry.getTime() > Date.now() && !ticket?.warranty?.isVoid);
  const flagFields = [
    ['isSameFault', 'نفس العطل السابق'],
    ['misuseSuspected', 'اشتباه سوء استخدام'],
    ['physicalDamageFound', 'تلف مادي ظاهر'],
    ['liquidDamageFound', 'آثار سوائل'],
    ['thirdPartyIntervention', 'تدخل فني خارجي'],
    ['createNewTicket', 'إنشاء تذكرة عودة تلقائيًا'],
  ] as const;

  return (
    <Modal
      open
      onClose={onClose}
      title="فتح مطالبة ضمان"
      subtitle="اختر التذكرة المُسلَّمة ثم سجّل العَرَض"
      size="lg"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            إلغاء
          </button>
          <button type="button" className="btn-primary" onClick={() => void submit()} disabled={isSubmitting || !ticket}>
            {isSubmitting ? 'جارٍ الفتح…' : 'فتح المطالبة'}
          </button>
        </>
      }
    >
      {!ticket ? (
        <div className="space-y-3">
          <div className="relative">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              className="input pr-9"
              placeholder="ابحث برقم التذكرة أو اسم العميل…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {isLoading ? (
            <LoadingBlock rows={3} />
          ) : data?.items?.length ? (
            <div className="max-h-80 space-y-2 overflow-y-auto">
              {data.items.map((item) => {
                const itemExpiry = item.warranty?.expiresAt ? new Date(item.warranty.expiresAt) : null;
                const active = Boolean(itemExpiry && itemExpiry.getTime() > Date.now() && !item.warranty?.isVoid);
                return (
                  <button
                    key={item._id}
                    type="button"
                    onClick={() => setTicket(item)}
                    className="w-full rounded-xl border border-ink-200 p-3 text-right transition hover:border-brand-400 hover:bg-brand-50/40"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-bold text-ink-900" dir="ltr">
                          {item.ticketNumber}
                        </p>
                        <p className="mt-0.5 text-xs text-ink-700">
                          {item.customerId?.fullName ?? '—'} · {item.deviceId?.brand ?? ''} {item.deviceId?.model ?? ''}
                        </p>
                      </div>
                      <Badge
                        className={
                          active
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-ink-200 bg-ink-50 text-ink-500'
                        }
                      >
                        {active ? 'ضمان ساري' : 'خارج الضمان'}
                      </Badge>
                    </div>
                    <p className="mt-1 text-[11px] text-ink-400">
                      {item.deliveredAt ? `سُلِّمت في ${formatDateTime(item.deliveredAt)}` : 'لا يوجد تاريخ تسليم'}
                      {itemExpiry ? ` · ينتهي ${formatDateTime(itemExpiry)}` : ''}
                    </p>
                  </button>
                );
              })}
            </div>
          ) : (
            <EmptyState title="لا توجد تذاكر مُسلَّمة مطابقة" icon={<ShieldCheck size={20} />} />
          )}
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[11px] leading-relaxed text-amber-800">
            يُسمح بفتح مطالبة واحدة مفتوحة لكل تذكرة. المطالبات خارج فترة الضمان تُسجَّل أيضًا لأغراض المتابعة، لكن دون تغطية تلقائية.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-bold text-ink-900" dir="ltr">
                  {ticket.ticketNumber}
                </p>
                <p className="mt-0.5 text-xs text-ink-700">
                  {ticket.customerId?.fullName ?? '—'} · {ticket.deviceId?.brand ?? ''} {ticket.deviceId?.model ?? ''}
                </p>
                <p className="mt-1 text-[11px] text-ink-500">
                  {warrantyActive ? 'الضمان ساري' : 'الضمان منتهٍ أو ملغى'}
                  {ticket.assignedTechnicianId?.fullName ? ` · الفني: ${ticket.assignedTechnicianId.fullName}` : ''}
                </p>
              </div>
              <button type="button" className="btn-ghost text-xs" onClick={() => setTicket(null)}>
                تغيير التذكرة
              </button>
            </div>
          </div>

          <Field label="وصف العَرَض" required>
            <textarea
              className="input min-h-[4rem]"
              value={form.symptom}
              onChange={(e) => setForm({ ...form, symptom: e.target.value })}
              placeholder="مثال: الشاشة تعمل لكن اللمس لا يستجيب في الجزء السفلي"
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="التغطية المطلوبة">
              <select className="input" value={form.coverage} onChange={(e) => setForm({ ...form, coverage: e.target.value })}>
                <option value="both">قطعة + مصنعية</option>
                <option value="part">قطعة فقط</option>
                <option value="labor">مصنعية فقط</option>
                <option value="none">بدون تغطية</option>
              </select>
            </Field>
            <Field label="تصنيف العطل">
              <select
                className="input"
                value={form.faultCategory}
                onChange={(e) => setForm({ ...form, faultCategory: e.target.value })}
              >
                <option value="">غير محدد</option>
                {Object.entries(FAULT_CATEGORY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="أولوية تذكرة العودة">
              <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                <option value="normal">عادية</option>
                <option value="high">عالية</option>
                <option value="urgent">عاجلة</option>
                <option value="low">منخفضة</option>
              </select>
            </Field>
          </div>

          <div className="grid gap-2 rounded-xl border border-ink-200 p-3 sm:grid-cols-2">
            {flagFields.map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-xs text-ink-700">
                <input
                  type="checkbox"
                  checked={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.checked })}
                />
                {label}
              </label>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

void CardHeader;
