'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, ClipboardCheck, Plus, XCircle } from 'lucide-react';
import { api, errorMessage, fetcher, qs } from '@/lib/api';
import { formatDateTime, formatNumber, formatPercent } from '@/lib/format';
import { QC_RESULT_LABELS, statusLabel, type RepairStatus } from '@/lib/constants';
import { Badge, Card, CardHeader, EmptyState, Field, LoadingBlock, PageHeader, StatCard } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/lib/auth';

interface QcRow {
  _id: string;
  attempt: number;
  result: string;
  passRatePct?: number;
  failureReasons?: string[];
  notes?: string;
  startedAt: string;
  completedAt?: string | null;
  durationMinutes?: number;
  ticketId?: { _id?: string; ticketNumber: string; status: RepairStatus } | null;
  inspectorId?: { fullName: string } | null;
  technicianId?: { fullName: string } | null;
  items?: { key: string; labelAr: string; result: string; required: boolean }[];
}

interface QcStats {
  totalChecks: number;
  firstTimePassCount: number;
  firstTimePassRatePct: number;
  byTechnician: { technicianId: string | null; name: string; totalChecks: number; passedChecks: number; passRatePct: number; avgAttempts: number }[];
  topFailureReasons: { reason: string; count: number }[];
}

interface TicketOption {
  _id: string;
  ticketNumber: string;
  status: RepairStatus;
  statusLabel: string;
  deviceId?: { brand: string; model: string } | null;
  customerId?: { fullName: string } | null;
}

const DEFAULT_ITEMS = [
  { key: 'display', labelAr: 'الشاشة والصورة', required: true },
  { key: 'touch', labelAr: 'اللمس', required: true },
  { key: 'front_camera', labelAr: 'الكاميرا الأمامية', required: true },
  { key: 'rear_camera', labelAr: 'الكاميرا الخلفية', required: true },
  { key: 'flash', labelAr: 'الفلاش', required: false },
  { key: 'microphone', labelAr: 'المايك (المتحدث)', required: true },
  { key: 'speaker', labelAr: 'السماعة (السبيكر)', required: true },
  { key: 'earpiece', labelAr: 'سماعة الأذن', required: true },
  { key: 'charging', labelAr: 'الشحن', required: true },
  { key: 'battery_health', labelAr: 'صحة البطارية', required: true },
  { key: 'wifi', labelAr: 'واي فاي', required: true },
  { key: 'bluetooth', labelAr: 'بلوتوث', required: false },
  { key: 'sim', labelAr: 'الشريحة والشبكة', required: true },
  { key: 'biometrics', labelAr: 'البصمة/التعرف على الوجه', required: false },
  { key: 'buttons', labelAr: 'الأزرار', required: true },
  { key: 'vibration', labelAr: 'الاهتزاز', required: false },
  { key: 'software_boot', labelAr: 'إقلاع النظام والبرمجة', required: true },
  { key: 'imei_match', labelAr: 'تطابق الـIMEI مع سجل الاستلام', required: true },
];

export default function QualityPage() {
  const searchParams = useSearchParams();
  const toast = useToast();
  const { hasPermission } = useAuth();
  const [page, setPage] = useState(1);
  const [resultFilter, setResultFilter] = useState('');
  const [startOpen, setStartOpen] = useState(Boolean(searchParams.get('ticketId')));
  const [presetTicketId, setPresetTicketId] = useState(searchParams.get('ticketId') ?? '');
  const [activeCheck, setActiveCheck] = useState<QcRow | null>(null);

  const key = `/quality-checks${qs({ result: resultFilter || undefined, page, limit: 20 })}`;
  const { data, error, isLoading } = useSWR<{ items: QcRow[]; meta: { total: number; page: number; pages: number } }>(
    key,
    fetcher,
  );
  const { data: stats } = useSWR<QcStats>('/quality-checks/stats', fetcher);

  return (
    <div>
      <PageHeader
        title="فحص الجودة (Digital QC)"
        subtitle="قائمة فحص قابلة للتخصيص، والاجتياز شرط للتسليم حسب إعدادات المركز"
        actions={
          hasPermission('qc:perform') ? (
            <button type="button" className="btn-primary" onClick={() => setStartOpen(true)}>
              <Plus size={16} /> فحص جديد
            </button>
          ) : null
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard label="عدد الفحوص" value={formatNumber(stats?.totalChecks ?? 0)} icon={<ClipboardCheck size={18} />} tone="info" />
        <StatCard
          label="اجتياز من أول مرة"
          value={formatPercent(stats?.firstTimePassRatePct ?? 0)}
          hint={`${formatNumber(stats?.firstTimePassCount ?? 0)} فحص`}
          icon={<CheckCircle2 size={18} />}
          tone={(stats?.firstTimePassRatePct ?? 0) >= 85 ? 'success' : 'warning'}
        />
        <StatCard
          label="أكثر أسباب الرسوب"
          value={stats?.topFailureReasons?.[0]?.reason ?? '—'}
          hint={stats?.topFailureReasons?.[0] ? `${stats.topFailureReasons[0].count} مرة` : undefined}
          icon={<XCircle size={18} />}
          tone="danger"
        />
      </div>

      {stats?.byTechnician?.length ? (
        <Card className="mb-4">
          <CardHeader title="أداء الفحص حسب الفني" subtitle="نسبة الاجتياز ومتوسط عدد المحاولات" />
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>الفني</th>
                  <th>عدد الفحوص</th>
                  <th>اجتاز</th>
                  <th>نسبة الاجتياز</th>
                  <th>متوسط المحاولات</th>
                </tr>
              </thead>
              <tbody>
                {stats.byTechnician.map((row) => (
                  <tr key={row.technicianId ?? row.name}>
                    <td className="text-xs font-medium">{row.name}</td>
                    <td className="num text-xs">{row.totalChecks}</td>
                    <td className="num text-xs">{row.passedChecks}</td>
                    <td className="num text-xs font-bold">{formatPercent(row.passRatePct)}</td>
                    <td className="num text-xs">{row.avgAttempts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <Card className="mb-4 card-pad">
        <div className="flex flex-wrap items-center gap-3">
          <select
            className="input w-auto"
            value={resultFilter}
            onChange={(e) => {
              setResultFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">كل النتائج</option>
            <option value="passed">اجتاز</option>
            <option value="passed_with_notes">اجتاز بملاحظات</option>
            <option value="failed">لم يجتز</option>
            <option value="pending">قيد التنفيذ</option>
          </select>
          <span className="text-xs text-ink-500">{formatNumber(data?.meta.total ?? 0)} سجل فحص</span>
        </div>
      </Card>

      {error ? <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">{errorMessage(error)}</Card> : null}

      <Card>
        {isLoading ? (
          <LoadingBlock rows={6} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>التذكرة</th>
                  <th>المحاولة</th>
                  <th>النتيجة</th>
                  <th>نسبة الاجتياز</th>
                  <th>أسباب الرسوب</th>
                  <th>المفتش</th>
                  <th>الفني</th>
                  <th>التاريخ</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data?.items?.length ? (
                  data.items.map((qc) => (
                    <tr key={qc._id}>
                      <td className="text-xs font-bold" dir="ltr">
                        {qc.ticketId ? (
                          <Link href={`/tickets/${qc.ticketId._id ?? ''}`} className="text-brand-700 hover:underline">
                            {qc.ticketId.ticketNumber}
                          </Link>
                        ) : (
                          '—'
                        )}
                        {qc.ticketId ? (
                          <span className="mt-0.5 block text-[11px] font-normal text-ink-400">
                            {statusLabel(qc.ticketId.status)}
                          </span>
                        ) : null}
                      </td>
                      <td className="num text-xs">{qc.attempt}</td>
                      <td>
                        <Badge
                          className={
                            qc.result === 'passed'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              : qc.result === 'passed_with_notes'
                                ? 'border-sky-200 bg-sky-50 text-sky-700'
                                : qc.result === 'failed'
                                  ? 'border-red-200 bg-red-50 text-red-700'
                                  : 'border-ink-200 bg-ink-50 text-ink-600'
                          }
                        >
                          {QC_RESULT_LABELS[qc.result] ?? qc.result}
                        </Badge>
                      </td>
                      <td className="num text-xs">{typeof qc.passRatePct === 'number' ? `${qc.passRatePct}%` : '—'}</td>
                      <td className="max-w-[14rem] text-xs text-red-700">
                        {qc.failureReasons?.length ? qc.failureReasons.join('، ') : '—'}
                      </td>
                      <td className="text-xs">{qc.inspectorId?.fullName ?? '—'}</td>
                      <td className="text-xs">{qc.technicianId?.fullName ?? '—'}</td>
                      <td className="text-xs text-ink-500">{formatDateTime(qc.completedAt ?? qc.startedAt)}</td>
                      <td>
                        {qc.result === 'pending' && hasPermission('qc:perform') ? (
                          <button type="button" className="btn-primary px-2.5 py-1 text-xs" onClick={() => setActiveCheck(qc)}>
                            تسجيل النتيجة
                          </button>
                        ) : (
                          <span className="text-[11px] text-ink-400">
                            {qc.durationMinutes ? `${qc.durationMinutes} دقيقة` : ''}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={9}>
                      <EmptyState title="لا توجد سجلات فحص" icon={<ClipboardCheck size={22} />} />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {data && data.meta.pages > 1 ? (
          <div className="flex items-center justify-between border-t border-ink-100 px-4 py-3 text-xs text-ink-600">
            <span>
              صفحة {data.meta.page} من {data.meta.pages}
            </span>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary text-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                السابق
              </button>
              <button
                type="button"
                className="btn-secondary text-xs"
                disabled={page >= data.meta.pages}
                onClick={() => setPage((p) => p + 1)}
              >
                التالي
              </button>
            </div>
          </div>
        ) : null}
      </Card>

      <StartQcModal
        open={startOpen}
        presetTicketId={presetTicketId}
        onClose={() => {
          setStartOpen(false);
          setPresetTicketId('');
        }}
        onDone={async () => {
          setStartOpen(false);
          setPresetTicketId('');
          await Promise.all([mutate(key), mutate('/quality-checks/stats'), mutate('/tickets/board')]);
          toast.success('تم بدء فحص الجودة');
        }}
        onError={(message) => toast.error(message)}
      />

      <SubmitQcModal
        qc={activeCheck}
        onClose={() => setActiveCheck(null)}
        onDone={async () => {
          setActiveCheck(null);
          await Promise.all([mutate(key), mutate('/quality-checks/stats'), mutate('/tickets/board')]);
          toast.success('تم تسجيل نتيجة الفحص');
        }}
        onError={(message) => toast.error(message)}
      />
    </div>
  );
}

function StartQcModal({
  open,
  presetTicketId,
  onClose,
  onDone,
  onError,
}: {
  open: boolean;
  presetTicketId: string;
  onClose: () => void;
  onDone: () => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [selectedTicket, setSelectedTicket] = useState<string>(presetTicketId);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: tickets } = useSWR<{ items: TicketOption[] }>(
    open ? `/tickets${qs({ q: search || undefined, openOnly: 'true', limit: 25 })}` : null,
    fetcher,
  );

  const submit = async () => {
    if (!selectedTicket) {
      onError('اختر تذكرة');
      return;
    }
    setIsSubmitting(true);
    try {
      await api.post('/quality-checks', { ticketId: selectedTicket, useDefaultChecklist: true });
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
      title="بدء فحص جودة"
      subtitle="اختر التذكرة — سيتم إنشاء قائمة الفحص تلقائيًا"
      size="lg"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            إلغاء
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={isSubmitting || !selectedTicket}>
            {isSubmitting ? 'جارٍ البدء…' : 'بدء الفحص'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <input
          className="input"
          placeholder="ابحث برقم التذكرة…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="max-h-80 space-y-2 overflow-y-auto">
          {tickets?.items?.map((ticket) => (
            <button
              key={ticket._id}
              type="button"
              onClick={() => setSelectedTicket(ticket._id)}
              className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-right transition ${
                selectedTicket === ticket._id ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-500' : 'border-ink-200 hover:border-brand-300'
              }`}
            >
              <span className="min-w-0">
                <span className="block text-xs font-bold text-ink-800" dir="ltr">
                  {ticket.ticketNumber}
                </span>
                <span className="block truncate text-[11px] text-ink-500">
                  {ticket.deviceId ? `${ticket.deviceId.brand} ${ticket.deviceId.model}` : ''} ·{' '}
                  {ticket.customerId?.fullName ?? ''}
                </span>
              </span>
              <Badge className="border-ink-200 bg-ink-50 text-ink-600">{ticket.statusLabel}</Badge>
            </button>
          ))}
          {!tickets?.items?.length ? <p className="py-6 text-center text-xs text-ink-400">لا توجد تذاكر مفتوحة</p> : null}
        </div>
      </div>
    </Modal>
  );
}

function SubmitQcModal({
  qc,
  onClose,
  onDone,
  onError,
}: {
  qc: QcRow | null;
  onClose: () => void;
  onDone: () => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [items, setItems] = useState<Record<string, { result: string; notes: string }>>({});
  const [measurements, setMeasurements] = useState({ batteryHealthPct: '', bootTimeSeconds: '' });
  const [notes, setNotes] = useState('');
  const [advanceTicket, setAdvanceTicket] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!qc) return null;

  const checklist = qc.items?.length ? qc.items : DEFAULT_ITEMS.map((i) => ({ ...i, result: 'pending' }));

  const setItemResult = (key: string, result: string) => {
    setItems((prev) => ({ ...prev, [key]: { result, notes: prev[key]?.notes ?? '' } }));
  };

  const submit = async () => {
    const payloadItems = checklist.map((item) => ({
      key: item.key,
      result: items[item.key]?.result ?? 'pending',
      notes: items[item.key]?.notes ?? '',
    }));

    const missing = checklist.filter((item) => item.required && (items[item.key]?.result ?? 'pending') === 'pending');
    if (missing.length) {
      onError(`يجب تحديد نتيجة البنود الإلزامية: ${missing.map((m) => m.labelAr).join('، ')}`);
      return;
    }

    setIsSubmitting(true);
    try {
      await api.post(`/quality-checks/${qc._id}/submit`, {
        items: payloadItems,
        measurements: {
          batteryHealthPct: measurements.batteryHealthPct ? Number(measurements.batteryHealthPct) : null,
          bootTimeSeconds: measurements.bootTimeSeconds ? Number(measurements.bootTimeSeconds) : null,
        },
        notes,
        advanceTicket,
      });
      await onDone();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const failedRequired = checklist.filter((item) => item.required && items[item.key]?.result === 'fail').length;

  return (
    <Modal
      open
      onClose={onClose}
      title="تسجيل نتيجة فحص الجودة"
      subtitle={qc.ticketId ? `التذكرة ${qc.ticketId.ticketNumber} — محاولة ${qc.attempt}` : undefined}
      size="xl"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            إلغاء
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={isSubmitting}>
            {isSubmitting ? 'جارٍ الحفظ…' : 'إتمام الفحص'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {checklist.map((item) => {
            const current = items[item.key]?.result ?? 'pending';
            return (
              <div
                key={item.key}
                className={`rounded-lg border p-2.5 ${
                  current === 'pass'
                    ? 'border-emerald-300 bg-emerald-50'
                    : current === 'fail'
                      ? 'border-red-300 bg-red-50'
                      : 'border-ink-200'
                }`}
              >
                <p className="mb-2 text-xs font-medium text-ink-800">
                  {item.labelAr}
                  {item.required ? <span className="text-red-600"> *</span> : null}
                </p>
                <div className="flex gap-1.5">
                  {[
                    ['pass', 'سليم'],
                    ['fail', 'عيب'],
                    ['not_applicable', 'لا ينطبق'],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setItemResult(item.key, value)}
                      className={`flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition ${
                        current === value
                          ? value === 'pass'
                            ? 'bg-emerald-600 text-white'
                            : value === 'fail'
                              ? 'bg-red-600 text-white'
                              : 'bg-ink-600 text-white'
                          : 'bg-white text-ink-600 hover:bg-ink-100'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="صحة البطارية %">
            <input
              className="input"
              type="number"
              min={0}
              max={100}
              value={measurements.batteryHealthPct}
              onChange={(e) => setMeasurements({ ...measurements, batteryHealthPct: e.target.value })}
            />
          </Field>
          <Field label="زمن الإقلاع (ثانية)">
            <input
              className="input"
              type="number"
              min={0}
              value={measurements.bootTimeSeconds}
              onChange={(e) => setMeasurements({ ...measurements, bootTimeSeconds: e.target.value })}
            />
          </Field>
        </div>

        <Field label="ملاحظات الفحص">
          <textarea className="input min-h-[3rem]" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        {failedRequired ? (
          <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            يوجد {failedRequired} بند إلزامي لم يجتز — سيُعاد الجهاز للإصلاح.
          </p>
        ) : null}

        <label className="flex items-center gap-2 text-xs text-ink-600">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-ink-300"
            checked={advanceTicket}
            onChange={(e) => setAdvanceTicket(e.target.checked)}
          />
          تحديث حالة التذكرة تلقائيًا (جاهز للتسليم عند الاجتياز، أو إعادة للإصلاح عند الرسوب)
        </label>
      </div>
    </Modal>
  );
}
