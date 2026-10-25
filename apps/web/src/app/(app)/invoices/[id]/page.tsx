'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowRight, Download, Receipt, Wallet } from 'lucide-react';
import { api, errorMessage, fetcher } from '@/lib/api';
import { formatDateTime, formatMoney } from '@/lib/format';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from '@/lib/constants';
import { Badge, Card, CardHeader, EmptyState, Field, LoadingBlock, PageHeader } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/lib/auth';

interface InvoiceDetail {
  invoice: {
    _id: string;
    invoiceNumber: string;
    type: string;
    status: string;
    issuedAt?: string | null;
    paidAt?: string | null;
    notes?: string;
    customerNotes?: string;
    totals: {
      subtotalEgp: number;
      discountEgp: number;
      taxRatePct: number;
      taxEgp: number;
      totalEgp: number;
      paidEgp: number;
      dueEgp: number;
    };
    lines: { _id: string; kind: string; description: string; quantity: number; unitPriceEgp: number; totalEgp: number; warrantyDays?: number }[];
    customerId?: { _id?: string; fullName: string; phone: string; companyName?: string } | null;
    ticketId?: { _id?: string; ticketNumber: string } | null;
    createdBy?: { fullName: string } | null;
  };
  payments: {
    _id: string;
    receiptNumber: string;
    method: string;
    amountEgp: number;
    paidAt: string;
    isRefund?: boolean;
    reference?: string;
    recordedBy?: { fullName: string } | null;
  }[];
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'مسودة',
  issued: 'صادرة',
  partially_paid: 'مدفوعة جزئيًا',
  paid: 'مدفوعة',
  void: 'ملغاة',
  refunded: 'مرتجعة',
};

const KIND_LABELS: Record<string, string> = {
  part: 'قطعة غيار',
  labor: 'مصنعية',
  accessory: 'ملحق',
  service: 'خدمة',
};

export default function InvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const key = params?.id ? `/finance/invoices/${params.id}` : null;
  const { data, error, isLoading, mutate } = useSWR<InvoiceDetail>(key, fetcher);
  const toast = useToast();
  const { hasPermission } = useAuth();
  const [printMode, setPrintMode] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [payForm, setPayForm] = useState({ method: 'cash', amountEgp: '', tenderedEgp: '', reference: '', notes: '' });
  const [isPaying, setIsPaying] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundForm, setRefundForm] = useState({ method: 'cash', amountEgp: '', reason: '' });
  const [isRefunding, setIsRefunding] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [isVoiding, setIsVoiding] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    if (printMode) {
      window.print();
      setPrintMode(false);
    }
  }, [printMode]);

  const due = data?.invoice.totals.dueEgp ?? 0;

  const downloadPdf = async () => {
    if (!data) return;
    setIsDownloading(true);
    try {
      await api.download(`/finance/invoices/${data.invoice._id}/pdf`, `${data.invoice.invoiceNumber}.pdf`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setIsDownloading(false);
    }
  };

  const submitPayment = async () => {
    if (!data) return;
    const amount = Number(payForm.amountEgp) || due;
    if (amount <= 0) {
      toast.error('أدخل مبلغًا صحيحًا');
      return;
    }
    setIsPaying(true);
    try {
      await api.post('/finance/payments', {
        invoiceId: data.invoice._id,
        method: payForm.method,
        amountEgp: amount,
        tenderedEgp: Number(payForm.tenderedEgp) || amount,
        reference: payForm.reference,
        notes: payForm.notes,
      });
      toast.success('تم تسجيل الدفعة');
      setPayOpen(false);
      setPayForm({ method: 'cash', amountEgp: '', tenderedEgp: '', reference: '', notes: '' });
      await mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setIsPaying(false);
    }
  };

  const change = payForm.method === 'cash' ? Math.max(0, (Number(payForm.tenderedEgp) || 0) - (Number(payForm.amountEgp) || due)) : 0;

  const submitRefund = async () => {
    if (!data) return;
    const amount = Number(refundForm.amountEgp);
    if (!amount || amount <= 0) {
      toast.error('أدخل مبلغ الاسترداد');
      return;
    }
    if (!refundForm.reason.trim()) {
      toast.error('سبب الاسترداد مطلوب');
      return;
    }
    setIsRefunding(true);
    try {
      await api.post('/finance/payments', {
        invoiceId: data.invoice._id,
        method: refundForm.method,
        amountEgp: amount,
        isRefund: true,
        refundReason: refundForm.reason.trim(),
      });
      toast.success('تم تسجيل الاسترداد');
      setRefundOpen(false);
      setRefundForm({ method: 'cash', amountEgp: '', reason: '' });
      await mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setIsRefunding(false);
    }
  };

  const submitVoid = async () => {
    if (!data) return;
    if (voidReason.trim().length < 3) {
      toast.error('اكتب سبب إلغاء الفاتورة');
      return;
    }
    setIsVoiding(true);
    try {
      await api.post(`/finance/invoices/${data.invoice._id}/void`, { reason: voidReason.trim() });
      toast.success('تم إلغاء الفاتورة');
      setVoidOpen(false);
      setVoidReason('');
      await mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setIsVoiding(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <LoadingBlock rows={7} />
      </Card>
    );
  }

  if (error || !data) {
    return <Card className="border-red-200 bg-red-50 p-5 text-sm text-red-700">{error ? errorMessage(error) : 'الفاتورة غير موجودة'}</Card>;
  }

  const { invoice, payments } = data;

  return (
    <div id="print-area">
      <PageHeader
        breadcrumb={
          <Link href="/invoices" className="inline-flex items-center gap-1 hover:text-brand-700">
            <ArrowRight size={12} /> كل الفواتير
          </Link>
        }
        title={invoice.invoiceNumber}
        subtitle={`${invoice.type === 'repair' ? 'فاتورة صيانة' : invoice.type === 'pos_sale' ? 'بيع مباشر' : invoice.type} · ${formatDateTime(
          invoice.issuedAt,
        )}`}
        actions={
          <>
            <Badge
              className={
                invoice.status === 'paid'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : invoice.status === 'void'
                    ? 'border-red-200 bg-red-50 text-red-700'
                    : 'border-amber-200 bg-amber-50 text-amber-800'
              }
            >
              {STATUS_LABELS[invoice.status] ?? invoice.status}
            </Badge>
            {hasPermission('payment:record') && invoice.totals.dueEgp > 0 && invoice.status !== 'void' ? (
              <button type="button" className="btn-primary inline-flex items-center gap-1" onClick={() => setPayOpen(true)}>
                <Wallet size={14} /> تحصيل
              </button>
            ) : null}
            {hasPermission('payment:record') && invoice.totals.paidEgp > 0 && invoice.status !== 'void' ? (
              <button
                type="button"
                className="btn-secondary inline-flex items-center gap-1 text-red-700"
                onClick={() => setRefundOpen(true)}
              >
                استرداد
              </button>
            ) : null}
            {hasPermission('invoice:write') &&
            invoice.status !== 'void' &&
            invoice.status !== 'refunded' &&
            invoice.totals.paidEgp <= 0.009 ? (
              <button
                type="button"
                className="btn-secondary inline-flex items-center gap-1 text-red-700"
                onClick={() => setVoidOpen(true)}
              >
                إلغاء الفاتورة
              </button>
            ) : null}
            <button
              type="button"
              className="btn-secondary inline-flex items-center gap-1"
              onClick={downloadPdf}
              disabled={isDownloading}
            >
              <Download size={14} /> {isDownloading ? 'جارٍ التحميل…' : 'تحميل PDF'}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setPrintMode(true)}>
              طباعة
            </button>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardHeader title="بنود الفاتورة" icon={<Receipt size={18} />} />
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>البند</th>
                    <th>النوع</th>
                    <th>الكمية</th>
                    <th>سعر الوحدة</th>
                    <th>الإجمالي</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.lines.map((line) => (
                    <tr key={line._id}>
                      <td className="text-xs">{line.description}</td>
                      <td className="text-xs">{KIND_LABELS[line.kind] ?? line.kind}</td>
                      <td className="num text-xs">{line.quantity}</td>
                      <td className="num text-xs">{formatMoney(line.unitPriceEgp, false)}</td>
                      <td className="num text-xs font-bold">{formatMoney(line.totalEgp, false)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="space-y-2 border-t border-ink-100 p-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-500">الإجمالي قبل الخصم</dt>
                <dd className="num">{formatMoney(invoice.totals.subtotalEgp)}</dd>
              </div>
              {invoice.totals.discountEgp ? (
                <div className="flex justify-between">
                  <dt className="text-ink-500">الخصم</dt>
                  <dd className="num text-red-600">- {formatMoney(invoice.totals.discountEgp)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between">
                <dt className="text-ink-500">الضريبة ({invoice.totals.taxRatePct}%)</dt>
                <dd className="num">{formatMoney(invoice.totals.taxEgp)}</dd>
              </div>
              <div className="flex justify-between border-t border-ink-100 pt-2">
                <dt className="font-bold text-ink-800">الإجمالي</dt>
                <dd className="num font-bold text-ink-900">{formatMoney(invoice.totals.totalEgp)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-500">المدفوع</dt>
                <dd className="num text-emerald-700">{formatMoney(invoice.totals.paidEgp)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="font-bold text-ink-800">المتبقي</dt>
                <dd className={`num font-bold ${invoice.totals.dueEgp > 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                  {formatMoney(invoice.totals.dueEgp)}
                </dd>
              </div>
            </dl>
          </Card>

          <Card>
            <CardHeader title="المدفوعات" subtitle={`${payments.length} عملية`} icon={<Wallet size={18} />} />
            {payments.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>رقم الإيصال</th>
                      <th>الطريقة</th>
                      <th>المبلغ</th>
                      <th>المرجع</th>
                      <th>المحصّل</th>
                      <th>التاريخ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((payment) => (
                      <tr key={payment._id}>
                        <td className="text-xs font-medium" dir="ltr">
                          {payment.receiptNumber}
                        </td>
                        <td className="text-xs">
                          {PAYMENT_METHOD_LABELS[payment.method as keyof typeof PAYMENT_METHOD_LABELS] ?? payment.method}
                        </td>
                        <td className={`num text-xs font-bold ${payment.isRefund ? 'text-red-600' : 'text-emerald-700'}`}>
                          {payment.isRefund ? '- ' : ''}
                          {formatMoney(payment.amountEgp)}
                        </td>
                        <td className="text-xs" dir="ltr">
                          {payment.reference || '—'}
                        </td>
                        <td className="text-xs">{payment.recordedBy?.fullName ?? '—'}</td>
                        <td className="text-xs text-ink-500">{formatDateTime(payment.paidAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="لا توجد مدفوعات مسجلة" icon={<Wallet size={20} />} />
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="العميل" />
            <div className="card-pad space-y-1 text-sm">
              {invoice.customerId ? (
                <>
                  <Link href={`/customers/${invoice.customerId._id}`} className="font-bold text-brand-700 hover:underline">
                    {invoice.customerId.fullName}
                  </Link>
                  {invoice.customerId.companyName ? <p className="text-xs text-ink-500">{invoice.customerId.companyName}</p> : null}
                  <p className="num text-xs text-ink-500" dir="ltr">
                    {invoice.customerId.phone}
                  </p>
                </>
              ) : (
                <p className="text-ink-500">بيع نقدي بدون تسجيل عميل</p>
              )}
            </div>
          </Card>

          {invoice.ticketId ? (
            <Card>
              <CardHeader title="التذكرة المرتبطة" />
              <div className="card-pad">
                <Link href={`/tickets/${invoice.ticketId._id ?? ''}`} className="font-bold text-brand-700 hover:underline" dir="ltr">
                  {invoice.ticketId.ticketNumber}
                </Link>
              </div>
            </Card>
          ) : null}

          {invoice.customerNotes || invoice.notes ? (
            <Card>
              <CardHeader title="ملاحظات" />
              <p className="card-pad text-sm text-ink-600">{invoice.customerNotes || invoice.notes}</p>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="بيانات الإصدار" />
            <dl className="card-pad space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-500">أُصدرت في</dt>
                <dd className="text-xs">{formatDateTime(invoice.issuedAt)}</dd>
              </div>
              {invoice.paidAt ? (
                <div className="flex justify-between">
                  <dt className="text-ink-500">تاريخ السداد الكامل</dt>
                  <dd className="text-xs">{formatDateTime(invoice.paidAt)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between">
                <dt className="text-ink-500">أُنشئت بواسطة</dt>
                <dd className="text-xs">{invoice.createdBy?.fullName ?? '—'}</dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>

      <Modal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        title={`تحصيل دفعة · ${invoice.invoiceNumber}`}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setPayOpen(false)} disabled={isPaying}>
              إلغاء
            </button>
            <button type="button" className="btn-primary" onClick={submitPayment} disabled={isPaying}>
              {isPaying ? 'جارٍ التسجيل…' : 'تسجيل الدفعة'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="rounded-lg bg-ink-50 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-ink-500">المتبقي على الفاتورة</span>
              <span className="num font-bold text-red-600">{formatMoney(due)}</span>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="طريقة الدفع">
              <select
                className="input"
                value={payForm.method}
                onChange={(event) => setPayForm((current) => ({ ...current, method: event.target.value }))}
              >
                {PAYMENT_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {PAYMENT_METHOD_LABELS[method]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="المبلغ (ج.م)">
              <input
                type="number"
                min="0"
                step="0.01"
                className="input num"
                placeholder={due.toFixed(2)}
                value={payForm.amountEgp}
                onChange={(event) => setPayForm((current) => ({ ...current, amountEgp: event.target.value }))}
              />
            </Field>
            {payForm.method === 'cash' ? (
              <Field label="المبلغ المستلم من العميل">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="input num"
                  value={payForm.tenderedEgp}
                  onChange={(event) => setPayForm((current) => ({ ...current, tenderedEgp: event.target.value }))}
                />
              </Field>
            ) : (
              <Field label="رقم المرجع">
                <input
                  className="input"
                  dir="ltr"
                  value={payForm.reference}
                  onChange={(event) => setPayForm((current) => ({ ...current, reference: event.target.value }))}
                />
              </Field>
            )}
          </div>
          {payForm.method === 'cash' && change > 0 ? (
            <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
              الباقي للعميل: <span className="num font-bold">{formatMoney(change)}</span>
            </p>
          ) : null}
          <Field label="ملاحظات">
            <textarea
              className="input min-h-[70px]"
              value={payForm.notes}
              onChange={(event) => setPayForm((current) => ({ ...current, notes: event.target.value }))}
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={refundOpen}
        onClose={() => setRefundOpen(false)}
        title={`استرداد من الفاتورة · ${invoice.invoiceNumber}`}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setRefundOpen(false)} disabled={isRefunding}>
              إلغاء
            </button>
            <button type="button" className="btn-primary" onClick={submitRefund} disabled={isRefunding}>
              {isRefunding ? 'جارٍ التسجيل…' : 'تسجيل الاسترداد'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
            المدفوع القابل للاسترداد: <span className="num font-bold">{formatMoney(invoice.totals.paidEgp)}</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="طريقة الاسترداد">
              <select
                className="input"
                value={refundForm.method}
                onChange={(event) => setRefundForm((current) => ({ ...current, method: event.target.value }))}
              >
                {PAYMENT_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {PAYMENT_METHOD_LABELS[method]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="المبلغ (ج.م)" required>
              <input
                type="number"
                min="0"
                max={invoice.totals.paidEgp}
                step="0.01"
                className="input num"
                placeholder={invoice.totals.paidEgp.toFixed(2)}
                value={refundForm.amountEgp}
                onChange={(event) => setRefundForm((current) => ({ ...current, amountEgp: event.target.value }))}
              />
            </Field>
          </div>
          <Field label="سبب الاسترداد" required>
            <textarea
              className="input min-h-[70px]"
              value={refundForm.reason}
              onChange={(event) => setRefundForm((current) => ({ ...current, reason: event.target.value }))}
              placeholder="مثال: إلغاء عملية بيع بعد تركيب قطعة غير مناسبة"
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={voidOpen}
        onClose={() => setVoidOpen(false)}
        title={`إلغاء الفاتورة · ${invoice.invoiceNumber}`}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setVoidOpen(false)} disabled={isVoiding}>
              رجوع
            </button>
            <button type="button" className="btn-primary" onClick={submitVoid} disabled={isVoiding}>
              {isVoiding ? 'جارٍ الإلغاء…' : 'تأكيد إلغاء الفاتورة'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            إلغاء الفاتورة إجراء نهائي ولا يمكن التراجع عنه. مسموح فقط للفواتير غير المدفوعة.
          </p>
          <Field label="سبب الإلغاء" required>
            <textarea
              className="input min-h-[70px]"
              value={voidReason}
              onChange={(event) => setVoidReason(event.target.value)}
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
