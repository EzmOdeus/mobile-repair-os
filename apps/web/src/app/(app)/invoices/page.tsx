'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import Link from 'next/link';
import { BadgeDollarSign, Plus, Receipt, Search, Wallet } from 'lucide-react';
import { api, errorMessage, fetcher, qs } from '@/lib/api';
import { formatDateTime, formatMoney, formatNumber } from '@/lib/format';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from '@/lib/constants';
import { Badge, Card, CardHeader, EmptyState, Field, LoadingBlock, PageHeader, StatCard } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/lib/auth';

interface InvoiceRow {
  _id: string;
  invoiceNumber: string;
  type: string;
  status: string;
  issuedAt?: string | null;
  totals: { totalEgp: number; paidEgp: number; dueEgp: number };
  customerId?: { fullName: string; phone: string } | null;
  ticketId?: { ticketNumber: string } | null;
}

interface FinanceSummary {
  revenueEgp: number;
  refundsEgp: number;
  netRevenueEgp: number;
  expensesEgp: number;
  profitEgp: number;
  receivablesEgp: number;
  unpaidInvoicesCount: number;
  byPaymentMethod: { method: string; count: number; totalEgp: number }[];
}

const STATUS_BADGES: Record<string, string> = {
  draft: 'border-ink-200 bg-ink-50 text-ink-600',
  issued: 'border-amber-200 bg-amber-50 text-amber-800',
  partially_paid: 'border-sky-200 bg-sky-50 text-sky-700',
  paid: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  void: 'border-red-200 bg-red-50 text-red-700',
  refunded: 'border-purple-200 bg-purple-50 text-purple-700',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'مسودة',
  issued: 'صادرة',
  partially_paid: 'مدفوعة جزئيًا',
  paid: 'مدفوعة',
  void: 'ملغاة',
  refunded: 'مرتجعة',
};

export default function InvoicesPage() {
  const toast = useToast();
  const { hasPermission } = useAuth();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [unpaidOnly, setUnpaidOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [payInvoice, setPayInvoice] = useState<InvoiceRow | null>(null);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [period, setPeriod] = useState<'today' | 'month' | 'last30'>('last30');

  const key = `/finance/invoices${qs({
    q: search || undefined,
    status: statusFilter || undefined,
    unpaid: unpaidOnly ? 'true' : undefined,
    page,
    limit: 20,
  })}`;

  const { data, error, isLoading } = useSWR<{ items: InvoiceRow[]; meta: { total: number; page: number; pages: number } }>(
    key,
    fetcher,
  );
  const { data: summary } = useSWR<FinanceSummary>(`/finance/summary${qs({ period })}`, fetcher);

  return (
    <div>
      <PageHeader
        title="الفواتير والمدفوعات"
        subtitle="التحصيل والمستحقات والمصروفات"
        actions={
          <>
            <select className="input w-auto" value={period} onChange={(e) => setPeriod(e.target.value as typeof period)}>
              <option value="today">اليوم</option>
              <option value="month">هذا الشهر</option>
              <option value="last30">آخر 30 يومًا</option>
            </select>
            {hasPermission('expense:manage') ? (
              <button type="button" className="btn-secondary" onClick={() => setExpenseOpen(true)}>
                <Plus size={16} /> مصروف
              </button>
            ) : null}
          </>
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="الإيراد المحصّل"
          value={formatMoney(summary?.revenueEgp ?? 0)}
          hint={summary?.refundsEgp ? `استردادات: ${formatMoney(summary.refundsEgp)}` : undefined}
          icon={<BadgeDollarSign size={18} />}
          tone="success"
        />
        <StatCard
          label="المصروفات"
          value={formatMoney(summary?.expensesEgp ?? 0)}
          icon={<Wallet size={18} />}
          tone="warning"
        />
        <StatCard
          label="صافي الربح"
          value={formatMoney(summary?.profitEgp ?? 0)}
          icon={<BadgeDollarSign size={18} />}
          tone={(summary?.profitEgp ?? 0) >= 0 ? 'success' : 'danger'}
        />
        <StatCard
          label="مستحقات غير محصّلة"
          value={formatMoney(summary?.receivablesEgp ?? 0)}
          hint={`${formatNumber(summary?.unpaidInvoicesCount ?? 0)} فاتورة`}
          icon={<Receipt size={18} />}
          tone={(summary?.receivablesEgp ?? 0) > 0 ? 'danger' : 'success'}
        />
      </div>

      {summary?.byPaymentMethod?.length ? (
        <Card className="mb-4">
          <CardHeader title="توزيع التحصيل حسب طريقة الدفع" icon={<Wallet size={18} />} />
          <div className="card-pad flex flex-wrap gap-3">
            {summary.byPaymentMethod.map((method) => (
              <div key={method.method} className="rounded-lg border border-ink-200 px-3.5 py-2.5">
                <p className="text-xs text-ink-500">{PAYMENT_METHOD_LABELS[method.method as keyof typeof PAYMENT_METHOD_LABELS] ?? method.method}</p>
                <p className="num text-sm font-bold text-ink-800">{formatMoney(method.totalEgp)}</p>
                <p className="text-[11px] text-ink-400">{method.count} عملية</p>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card className="mb-4 card-pad">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="relative sm:col-span-2">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              className="input pr-9"
              placeholder="ابحث برقم الفاتورة…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">كل الحالات</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <label className="mt-3 flex items-center gap-2 text-xs text-ink-600">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-ink-300"
            checked={unpaidOnly}
            onChange={(e) => {
              setUnpaidOnly(e.target.checked);
              setPage(1);
            }}
          />
          الفواتير غير المسددة فقط
        </label>
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
                  <th>رقم الفاتورة</th>
                  <th>العميل</th>
                  <th>التذكرة</th>
                  <th>الإجمالي</th>
                  <th>المدفوع</th>
                  <th>المتبقي</th>
                  <th>الحالة</th>
                  <th>التاريخ</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data?.items?.length ? (
                  data.items.map((invoice) => (
                    <tr key={invoice._id}>
                      <td className="font-bold text-ink-900" dir="ltr">
                        <Link href={`/invoices/${invoice._id}`} className="text-brand-700 hover:underline">
                          {invoice.invoiceNumber}
                        </Link>
                      </td>
                      <td className="text-xs">
                        <p className="text-ink-700">{invoice.customerId?.fullName ?? '—'}</p>
                        <p className="text-ink-400" dir="ltr">
                          {invoice.customerId?.phone ?? ''}
                        </p>
                      </td>
                      <td className="text-xs">
                        {invoice.ticketId ? (
                          <Link href={`/tickets/${(invoice.ticketId as unknown as { _id?: string })._id ?? ''}`} className="text-brand-700 hover:underline" dir="ltr">
                            {invoice.ticketId.ticketNumber}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="num text-xs font-bold">{formatMoney(invoice.totals.totalEgp)}</td>
                      <td className="num text-xs text-emerald-700">{formatMoney(invoice.totals.paidEgp)}</td>
                      <td className={`num text-xs font-bold ${invoice.totals.dueEgp > 0 ? 'text-red-600' : 'text-ink-400'}`}>
                        {formatMoney(invoice.totals.dueEgp)}
                      </td>
                      <td>
                        <Badge className={STATUS_BADGES[invoice.status] ?? ''}>{STATUS_LABELS[invoice.status] ?? invoice.status}</Badge>
                      </td>
                      <td className="text-xs text-ink-500">{formatDateTime(invoice.issuedAt)}</td>
                      <td>
                        {invoice.totals.dueEgp > 0 && hasPermission('payment:record') ? (
                          <button type="button" className="btn-primary px-2.5 py-1 text-xs" onClick={() => setPayInvoice(invoice)}>
                            تحصيل
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={9}>
                      <EmptyState title="لا توجد فواتير" icon={<Receipt size={22} />} />
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
              صفحة {data.meta.page} من {data.meta.pages} · {data.meta.total} فاتورة
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

      <PaymentModal
        invoice={payInvoice}
        onClose={() => setPayInvoice(null)}
        onDone={async () => {
          setPayInvoice(null);
          await Promise.all([mutate(key), mutate(`/finance/summary${qs({ period })}`)]);
          toast.success('تم تسجيل الدفعة');
        }}
        onError={(message) => toast.error(message)}
      />

      <ExpenseModal
        open={expenseOpen}
        onClose={() => setExpenseOpen(false)}
        onDone={async () => {
          setExpenseOpen(false);
          await mutate(`/finance/summary${qs({ period })}`);
          toast.success('تم تسجيل المصروف');
        }}
        onError={(message) => toast.error(message)}
      />
    </div>
  );
}

function PaymentModal({
  invoice,
  onClose,
  onDone,
  onError,
}: {
  invoice: InvoiceRow | null;
  onClose: () => void;
  onDone: () => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState({ method: 'cash', amountEgp: '', tenderedEgp: '', reference: '', notes: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!invoice) return null;

  const due = invoice.totals.dueEgp;

  const submit = async () => {
    const amount = Number(form.amountEgp) || due;
    if (amount <= 0) {
      onError('أدخل مبلغًا صحيحًا');
      return;
    }
    setIsSubmitting(true);
    try {
      await api.post('/finance/payments', {
        invoiceId: invoice._id,
        method: form.method,
        amountEgp: amount,
        tenderedEgp: Number(form.tenderedEgp) || amount,
        reference: form.reference,
        notes: form.notes,
      });
      await onDone();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const change = form.method === 'cash' ? Math.max(0, (Number(form.tenderedEgp) || 0) - (Number(form.amountEgp) || due)) : 0;

  return (
    <Modal
      open
      onClose={onClose}
      title={`تحصيل — ${invoice.invoiceNumber}`}
      subtitle={`المتبقي: ${formatMoney(due)}`}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            إلغاء
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={isSubmitting}>
            {isSubmitting ? 'جارٍ التسجيل…' : 'تسجيل الدفعة'}
          </button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="طريقة الدفع">
          <select className="input" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
            {PAYMENT_METHODS.map((method) => (
              <option key={method} value={method}>
                {PAYMENT_METHOD_LABELS[method]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="المبلغ">
          <input
            className="input"
            type="number"
            min={0}
            value={form.amountEgp}
            placeholder={String(due)}
            onChange={(e) => setForm({ ...form, amountEgp: e.target.value })}
          />
        </Field>
        {form.method === 'cash' ? (
          <Field label="المبلغ المستلم" hint={change > 0 ? `الباقي للعميل: ${formatMoney(change)}` : undefined}>
            <input
              className="input"
              type="number"
              min={0}
              value={form.tenderedEgp}
              onChange={(e) => setForm({ ...form, tenderedEgp: e.target.value })}
            />
          </Field>
        ) : (
          <Field label="رقم المرجع / العملية">
            <input className="input" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} dir="ltr" />
          </Field>
        )}
        <div className="sm:col-span-2">
          <Field label="ملاحظات">
            <input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function ExpenseModal({
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
  const [form, setForm] = useState({ title: '', category: 'misc', amountEgp: '', method: 'cash', notes: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async () => {
    if (!form.title.trim() || !Number(form.amountEgp)) {
      onError('العنوان والمبلغ مطلوبان');
      return;
    }
    setIsSubmitting(true);
    try {
      await api.post('/finance/expenses', {
        title: form.title,
        category: form.category,
        amountEgp: Number(form.amountEgp),
        method: form.method,
        notes: form.notes,
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
      title="تسجيل مصروف"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            إلغاء
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={isSubmitting}>
            {isSubmitting ? 'جارٍ الحفظ…' : 'حفظ المصروف'}
          </button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="عنوان المصروف" required>
          <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="المبلغ" required>
          <input
            className="input"
            type="number"
            min={0}
            value={form.amountEgp}
            onChange={(e) => setForm({ ...form, amountEgp: e.target.value })}
          />
        </Field>
        <Field label="التصنيف">
          <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {[
              ['rent', 'إيجار'],
              ['salaries', 'رواتب'],
              ['utilities', 'مرافق'],
              ['internet_phone', 'إنترنت وتليفون'],
              ['tools', 'أدوات'],
              ['parts_purchase', 'شراء قطع غيار'],
              ['marketing', 'تسويق'],
              ['maintenance', 'صيانة'],
              ['transport', 'مواصلات'],
              ['taxes', 'ضرائب'],
              ['misc', 'متنوع'],
            ].map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="طريقة الدفع">
          <select className="input" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
            {PAYMENT_METHODS.map((method) => (
              <option key={method} value={method}>
                {PAYMENT_METHOD_LABELS[method]}
              </option>
            ))}
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="ملاحظات">
            <input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
