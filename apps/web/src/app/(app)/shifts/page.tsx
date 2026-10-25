'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  Clock,
  History,
  Lock,
  Unlock,
  Wallet,
} from 'lucide-react';
import { api, errorMessage, fetcher, qs } from '@/lib/api';
import { formatDateTime, formatMoney, formatNumber, formatTime } from '@/lib/format';
import { PAYMENT_METHOD_LABELS } from '@/lib/constants';
import { Badge, Card, CardHeader, EmptyState, Field, LoadingBlock, PageHeader, StatCard } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/lib/auth';

interface ShiftUser {
  fullName?: string;
}

interface ShiftBranch {
  name?: string;
  code?: string;
}

interface ShiftRow {
  _id: string;
  shiftNumber: string;
  status: 'open' | 'closed';
  openedAt: string;
  closedAt?: string | null;
  openingCashEgp: number;
  expectedCashEgp?: number | null;
  countedCashEgp?: number | null;
  varianceEgp?: number | null;
  liveExpectedCashEgp?: number;
  openedBy?: ShiftUser | null;
  closedBy?: ShiftUser | null;
  branchId?: ShiftBranch | null;
}

interface ShiftSummary {
  openingCashEgp: number;
  cashInEgp: number;
  cashOutEgp: number;
  cashExpensesEgp: number;
  nonCashInEgp: number;
  nonCashOutEgp: number;
  nonCashExpensesEgp: number;
  expectedCashEgp: number;
  paymentCount: number;
  expenseCount: number;
}

interface UnlinkedCash {
  paymentCount: number;
  expenseCount: number;
  netEgp: number;
}

interface CurrentResponse {
  shift: ShiftRow | null;
  summary: ShiftSummary | null;
  unlinked: UnlinkedCash | null;
}

interface ShiftPayment {
  _id: string;
  receiptNumber: string;
  direction: 'in' | 'out';
  method: string;
  amountEgp: number;
  paidAt: string;
  isRefund?: boolean;
  customerId?: { fullName?: string; phone?: string } | null;
  recordedBy?: ShiftUser | null;
}

interface ShiftExpense {
  _id: string;
  title: string;
  category: string;
  method: string;
  amountEgp: number;
  incurredAt: string;
  createdBy?: ShiftUser | null;
}

interface ShiftDetail extends CurrentResponse {
  payments: ShiftPayment[];
  expenses: ShiftExpense[];
}

interface ListResponse {
  items: ShiftRow[];
  meta: { page: number; pages: number; total: number };
}

const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  rent: 'إيجار',
  salaries: 'رواتب',
  utilities: 'مرافق',
  internet_phone: 'إنترنت وتليفون',
  tools: 'أدوات',
  parts_purchase: 'شراء قطع غيار',
  marketing: 'تسويق',
  maintenance: 'صيانة',
  transport: 'مواصلات',
  taxes: 'ضرائب',
  misc: 'متنوع',
};

function methodLabel(method: string): string {
  return PAYMENT_METHOD_LABELS[method as keyof typeof PAYMENT_METHOD_LABELS] ?? method;
}

export default function ShiftsPage() {
  const toast = useToast();
  const { hasPermission } = useAuth();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [openModal, setOpenModal] = useState(false);
  const [closeModal, setCloseModal] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const currentKey = '/finance/shifts/current';
  const listKey = `/finance/shifts${qs({ status: statusFilter || undefined, page, limit: 15 })}`;

  const { data: current, isLoading: currentLoading } = useSWR<CurrentResponse>(currentKey, fetcher);
  const { data, error, isLoading } = useSWR<ListResponse>(listKey, fetcher);

  const shift = current?.shift ?? null;
  const summary = current?.summary ?? null;
  const unlinked = current?.unlinked ?? null;
  const canManage = hasPermission('shift:manage');

  const refresh = async () => {
    await Promise.all([mutate(currentKey), mutate(listKey)]);
  };

  return (
    <div>
      <PageHeader
        title="الورديات والخزينة"
        subtitle="فتح وردية لكل فرع، وربط التحصيل والمصروفات تلقائيًا بالدرج"
        actions={
          canManage && !shift ? (
            <button type="button" className="btn-primary" onClick={() => setOpenModal(true)}>
              <Unlock size={16} /> فتح وردية
            </button>
          ) : null
        }
      />

      {error ? <Card className="mb-4 border-red-200 bg-red-50 p-4 text-sm text-red-700">{errorMessage(error)}</Card> : null}

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="النقد الداخل"
          value={formatMoney(summary?.cashInEgp ?? 0)}
          hint={`${formatNumber(summary?.paymentCount ?? 0)} حركة دفع`}
          icon={<ArrowDownCircle size={18} />}
          tone="success"
        />
        <StatCard
          label="النقد الخارج"
          value={formatMoney(summary?.cashOutEgp ?? 0)}
          hint="استردادات وسداد موردين نقدي"
          icon={<ArrowUpCircle size={18} />}
          tone="warning"
        />
        <StatCard
          label="مصروفات نقدية"
          value={formatMoney(summary?.cashExpensesEgp ?? 0)}
          hint={`${formatNumber(summary?.expenseCount ?? 0)} مصروف`}
          icon={<Wallet size={18} />}
          tone="warning"
        />
        <StatCard
          label="النقد المتوقع في الدرج"
          value={formatMoney(summary?.expectedCashEgp ?? 0)}
          hint={summary ? `رصيد افتتاحي: ${formatMoney(summary.openingCashEgp)}` : 'افتح وردية لبدء المطابقة'}
          icon={<Lock size={18} />}
          tone="info"
        />
      </div>

      {currentLoading ? (
        <Card className="mb-5">
          <LoadingBlock rows={3} />
        </Card>
      ) : shift ? (
        <Card className="mb-5 border-emerald-200">
          <CardHeader
            title={`وردية ${shift.shiftNumber}`}
            subtitle={`فُتحت ${formatDateTime(shift.openedAt)} · ${shift.openedBy?.fullName ?? '—'} · ${shift.branchId?.name ?? ''}`}
            icon={<Unlock size={18} />}
            action={
              <div className="flex items-center gap-2">
                <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">مفتوحة</Badge>
                {canManage ? (
                  <button type="button" className="btn-primary text-xs" onClick={() => setCloseModal(true)}>
                    <Lock size={14} /> إغلاق الوردية
                  </button>
                ) : null}
              </div>
            }
          />
          <div className="card-pad grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
            <BreakdownItem label="رصيد الافتتاح" value={formatMoney(summary?.openingCashEgp ?? 0)} />
            <BreakdownItem label="نقد داخل" value={formatMoney(summary?.cashInEgp ?? 0)} tone="success" />
            <BreakdownItem label="نقد خارج" value={formatMoney(summary?.cashOutEgp ?? 0)} tone="warning" />
            <BreakdownItem label="متوقع في الدرج" value={formatMoney(summary?.expectedCashEgp ?? 0)} strong />
            <BreakdownItem label="مدفوعات غير نقدية" value={formatMoney((summary?.nonCashInEgp ?? 0) - (summary?.nonCashOutEgp ?? 0))} />
            <BreakdownItem label="مصروفات غير نقدية" value={formatMoney(summary?.nonCashExpensesEgp ?? 0)} />
            <BreakdownItem label="عدد الحركات" value={formatNumber((summary?.paymentCount ?? 0) + (summary?.expenseCount ?? 0))} />
            <BreakdownItem label="وقت الفتح" value={formatTime(shift.openedAt)} />
          </div>
          {unlinked && unlinked.paymentCount + unlinked.expenseCount > 0 ? (
            <div className="mx-4 mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 sm:mx-5">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <p>
                توجد {formatNumber(unlinked.paymentCount)} دفعة و{formatNumber(unlinked.expenseCount)} مصروف نقدي خلال فترة
                الوردية غير مرتبطة بها (صافي {formatMoney(unlinked.netEgp)}). قد تفسر فرقًا في المطابقة.
              </p>
            </div>
          ) : null}
        </Card>
      ) : (
        <Card className="mb-5">
          <EmptyState
            title="لا توجد وردية مفتوحة"
            description="افتح وردية ليبدأ ربط التحصيل والمصروفات النقدية بها تلقائيًا."
            icon={<Wallet size={22} />}
            action={
              canManage ? (
                <button type="button" className="btn-primary" onClick={() => setOpenModal(true)}>
                  <Unlock size={16} /> فتح وردية الآن
                </button>
              ) : undefined
            }
          />
        </Card>
      )}

      <Card>
        <CardHeader
          title="سجل الورديات"
          subtitle="المتوقع والمعدود والفرق عند كل إغلاق"
          icon={<History size={18} />}
          action={
            <select
              className="input w-auto text-xs"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">كل الحالات</option>
              <option value="open">مفتوحة</option>
              <option value="closed">مغلقة</option>
            </select>
          }
        />
        {isLoading ? (
          <LoadingBlock rows={6} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>الوردية</th>
                  <th>الفرع</th>
                  <th>الحالة</th>
                  <th>فتح</th>
                  <th>إغلاق</th>
                  <th>افتتاحي</th>
                  <th>متوقع</th>
                  <th>معدود</th>
                  <th>الفرق</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data?.items?.length ? (
                  data.items.map((row) => {
                    const expected = row.status === 'open' ? row.liveExpectedCashEgp ?? row.expectedCashEgp : row.expectedCashEgp;
                    const variance = row.varianceEgp;
                    return (
                      <tr key={row._id}>
                        <td className="font-bold text-ink-900" dir="ltr">
                          {row.shiftNumber}
                        </td>
                        <td className="text-xs text-ink-600">{row.branchId?.name ?? '—'}</td>
                        <td>
                          <Badge
                            className={
                              row.status === 'open'
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : 'border-ink-200 bg-ink-50 text-ink-600'
                            }
                          >
                            {row.status === 'open' ? 'مفتوحة' : 'مغلقة'}
                          </Badge>
                        </td>
                        <td className="text-xs text-ink-500">
                          {formatDateTime(row.openedAt)}
                          <span className="block text-[11px] text-ink-400">{row.openedBy?.fullName ?? ''}</span>
                        </td>
                        <td className="text-xs text-ink-500">
                          {row.closedAt ? formatDateTime(row.closedAt) : '—'}
                          <span className="block text-[11px] text-ink-400">{row.closedBy?.fullName ?? ''}</span>
                        </td>
                        <td className="num text-xs">{formatMoney(row.openingCashEgp)}</td>
                        <td className="num text-xs font-bold">{formatMoney(expected ?? 0)}</td>
                        <td className="num text-xs">{row.countedCashEgp === null || row.countedCashEgp === undefined ? '—' : formatMoney(row.countedCashEgp)}</td>
                        <td
                          className={`num text-xs font-bold ${
                            variance === null || variance === undefined
                              ? 'text-ink-400'
                              : variance > 0.009
                                ? 'text-emerald-700'
                                : variance < -0.009
                                  ? 'text-red-600'
                                  : 'text-ink-500'
                          }`}
                        >
                          {variance === null || variance === undefined ? '—' : formatMoney(variance)}
                        </td>
                        <td>
                          <button type="button" className="btn-secondary px-2.5 py-1 text-xs" onClick={() => setDetailId(row._id)}>
                            تفاصيل
                          </button>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={10}>
                      <EmptyState title="لا توجد ورديات بعد" icon={<Clock size={22} />} />
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
              صفحة {data.meta.page} من {data.meta.pages} · {data.meta.total} وردية
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

      <OpenShiftModal
        open={openModal}
        onClose={() => setOpenModal(false)}
        onDone={async () => {
          setOpenModal(false);
          await refresh();
          toast.success('تم فتح الوردية');
        }}
        onError={(message) => toast.error(message)}
      />

      {closeModal && shift && summary ? (
        <CloseShiftModal
          shift={shift}
          expectedCashEgp={summary.expectedCashEgp}
          onClose={() => setCloseModal(false)}
          onDone={async () => {
            setCloseModal(false);
            await refresh();
            toast.success('تم إغلاق الوردية');
          }}
          onError={(message) => toast.error(message)}
        />
      ) : null}

      <ShiftDetailModal shiftId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}

function BreakdownItem({ label, value, tone, strong }: { label: string; value: string; tone?: 'success' | 'warning'; strong?: boolean }) {
  return (
    <div className="rounded-lg border border-ink-200 px-3.5 py-2.5">
      <p className="text-xs text-ink-500">{label}</p>
      <p
        className={`num mt-1 font-bold ${strong ? 'text-base text-ink-900' : tone === 'success' ? 'text-sm text-emerald-700' : tone === 'warning' ? 'text-sm text-amber-700' : 'text-sm text-ink-700'}`}
      >
        {value}
      </p>
    </div>
  );
}

function OpenShiftModal({
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
  const [openingCashEgp, setOpeningCashEgp] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async () => {
    if (Number(openingCashEgp) < 0) {
      onError('رصيد الافتتاح لا يكون سالبًا');
      return;
    }
    setIsSubmitting(true);
    try {
      await api.post('/finance/shifts/open', {
        openingCashEgp: Number(openingCashEgp) || 0,
        notes,
      });
      await onDone();
      setOpeningCashEgp('');
      setNotes('');
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
      title="فتح وردية جديدة"
      subtitle="رصيد النقد الموجود في الدرج قبل أول حركة"
      size="sm"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            إلغاء
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={isSubmitting}>
            {isSubmitting ? 'جارٍ الفتح…' : 'فتح الوردية'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="رصيد الافتتاح (نقد)" required>
          <input
            className="input"
            type="number"
            min={0}
            value={openingCashEgp}
            onChange={(e) => setOpeningCashEgp(e.target.value)}
            placeholder="0"
          />
        </Field>
        <Field label="ملاحظات">
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function CloseShiftModal({
  shift,
  expectedCashEgp,
  onClose,
  onDone,
  onError,
}: {
  shift: ShiftRow;
  expectedCashEgp: number;
  onClose: () => void;
  onDone: () => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [countedCashEgp, setCountedCashEgp] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const counted = countedCashEgp === '' ? null : Number(countedCashEgp);
  const variance = counted === null ? null : Number((counted - expectedCashEgp).toFixed(2));

  const submit = async () => {
    if (counted === null || counted < 0) {
      onError('أدخل النقد المعدود فعليًا');
      return;
    }
    setIsSubmitting(true);
    try {
      await api.post(`/finance/shifts/${shift._id}/close`, { countedCashEgp: counted, notes });
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
      title={`إغلاق وردية ${shift.shiftNumber}`}
      subtitle={`النقد المتوقع: ${formatMoney(expectedCashEgp)}`}
      size="sm"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            إلغاء
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={isSubmitting}>
            {isSubmitting ? 'جارٍ الإغلاق…' : 'إغلاق الوردية'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="النقد المعدود في الدرج" required>
          <input
            className="input"
            type="number"
            min={0}
            value={countedCashEgp}
            onChange={(e) => setCountedCashEgp(e.target.value)}
            placeholder={String(expectedCashEgp)}
          />
        </Field>
        {variance !== null ? (
          <div
            className={`rounded-lg border px-3 py-2 text-sm ${
              variance > 0.009
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : variance < -0.009
                  ? 'border-red-200 bg-red-50 text-red-700'
                  : 'border-ink-200 bg-ink-50 text-ink-700'
            }`}
          >
            {variance > 0.009 ? 'زيادة في الدرج: ' : variance < -0.009 ? 'عجز في الدرج: ' : 'مطابق تمامًا: '}
            <span className="num font-bold">{formatMoney(Math.abs(variance))}</span>
          </div>
        ) : null}
        <Field label="ملاحظات الإغلاق">
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <p className="text-xs text-ink-400">بعد الإغلاق لا يمكن تعديل أو حذف مصروفات هذه الوردية.</p>
      </div>
    </Modal>
  );
}

function ShiftDetailModal({ shiftId, onClose }: { shiftId: string | null; onClose: () => void }) {
  const { data, error, isLoading } = useSWR<ShiftDetail>(shiftId ? `/finance/shifts/${shiftId}` : null, fetcher);

  if (!shiftId) return null;
  const shift = data?.shift;
  const summary = data?.summary;

  return (
    <Modal
      open
      onClose={onClose}
      title={shift ? `تفاصيل وردية ${shift.shiftNumber}` : 'تفاصيل الوردية'}
      subtitle={shift ? `${shift.branchId?.name ?? ''} · ${shift.status === 'open' ? 'مفتوحة' : 'مغلقة'}` : undefined}
      size="xl"
    >
      {isLoading ? (
        <LoadingBlock rows={5} />
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{errorMessage(error)}</div>
      ) : !data || !shift || !summary ? null : (
        <div className="space-y-5">
          <div className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
            <BreakdownItem label="رصيد الافتتاح" value={formatMoney(summary.openingCashEgp)} />
            <BreakdownItem label="نقد داخل" value={formatMoney(summary.cashInEgp)} tone="success" />
            <BreakdownItem label="نقد خارج" value={formatMoney(summary.cashOutEgp)} tone="warning" />
            <BreakdownItem label="مصروفات نقدية" value={formatMoney(summary.cashExpensesEgp)} tone="warning" />
            <BreakdownItem label="المتوقع" value={formatMoney(summary.expectedCashEgp)} strong />
            <BreakdownItem
              label="المعدود"
              value={shift.countedCashEgp === null || shift.countedCashEgp === undefined ? '—' : formatMoney(shift.countedCashEgp)}
            />
            <BreakdownItem
              label="الفرق"
              value={shift.varianceEgp === null || shift.varianceEgp === undefined ? '—' : formatMoney(shift.varianceEgp)}
            />
            <BreakdownItem label="فتح/إغلاق" value={`${formatTime(shift.openedAt)} — ${shift.closedAt ? formatTime(shift.closedAt) : 'الآن'}`} />
          </div>

          {data.unlinked && data.unlinked.paymentCount + data.unlinked.expenseCount > 0 ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <p>
                {formatNumber(data.unlinked.paymentCount)} دفعة و{formatNumber(data.unlinked.expenseCount)} مصروف نقدي خلال
                فترة الوردية غير مرتبطة بها (صافي {formatMoney(data.unlinked.netEgp)}).
              </p>
            </div>
          ) : null}

          <section>
            <h3 className="mb-2 text-sm font-bold text-ink-800">المدفوعات ({formatNumber(data.payments.length)})</h3>
            <div className="table-wrap rounded-lg border border-ink-100">
              <table className="table">
                <thead>
                  <tr>
                    <th>الإيصال</th>
                    <th>النوع</th>
                    <th>الطريقة</th>
                    <th>المبلغ</th>
                    <th>العميل</th>
                    <th>بواسطة</th>
                    <th>الوقت</th>
                  </tr>
                </thead>
                <tbody>
                  {data.payments.length ? (
                    data.payments.map((payment) => (
                      <tr key={payment._id}>
                        <td className="text-xs font-bold text-ink-800" dir="ltr">
                          {payment.receiptNumber}
                        </td>
                        <td className="text-xs">
                          <Badge
                            className={
                              payment.direction === 'out'
                                ? 'border-red-200 bg-red-50 text-red-700'
                                : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            }
                          >
                            {payment.direction === 'out' ? (payment.isRefund ? 'استرداد' : 'صادر') : 'تحصيل'}
                          </Badge>
                        </td>
                        <td className="text-xs text-ink-600">{methodLabel(payment.method)}</td>
                        <td className="num text-xs font-bold">{formatMoney(payment.amountEgp)}</td>
                        <td className="text-xs text-ink-600">{payment.customerId?.fullName ?? '—'}</td>
                        <td className="text-xs text-ink-500">{payment.recordedBy?.fullName ?? '—'}</td>
                        <td className="text-xs text-ink-500">{formatDateTime(payment.paidAt)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-xs text-ink-400">
                        لا توجد مدفوعات مربوطة بهذه الوردية
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-bold text-ink-800">المصروفات ({formatNumber(data.expenses.length)})</h3>
            <div className="table-wrap rounded-lg border border-ink-100">
              <table className="table">
                <thead>
                  <tr>
                    <th>البند</th>
                    <th>التصنيف</th>
                    <th>الطريقة</th>
                    <th>المبلغ</th>
                    <th>بواسطة</th>
                    <th>الوقت</th>
                  </tr>
                </thead>
                <tbody>
                  {data.expenses.length ? (
                    data.expenses.map((expense) => (
                      <tr key={expense._id}>
                        <td className="text-xs text-ink-800">{expense.title}</td>
                        <td className="text-xs text-ink-600">{EXPENSE_CATEGORY_LABELS[expense.category] ?? expense.category}</td>
                        <td className="text-xs text-ink-600">{methodLabel(expense.method)}</td>
                        <td className="num text-xs font-bold">{formatMoney(expense.amountEgp)}</td>
                        <td className="text-xs text-ink-500">{expense.createdBy?.fullName ?? '—'}</td>
                        <td className="text-xs text-ink-500">{formatDateTime(expense.incurredAt)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-xs text-ink-400">
                        لا توجد مصروفات مربوطة بهذه الوردية
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </Modal>
  );
}
