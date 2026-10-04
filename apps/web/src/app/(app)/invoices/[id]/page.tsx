'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowRight, Receipt, Wallet } from 'lucide-react';
import { errorMessage, fetcher } from '@/lib/api';
import { formatDateTime, formatMoney } from '@/lib/format';
import { PAYMENT_METHOD_LABELS } from '@/lib/constants';
import { Badge, Card, CardHeader, EmptyState, LoadingBlock, PageHeader } from '@/components/ui';

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
    totals: { subtotalEgp: number; discountEgp: number; taxEgp: number; totalEgp: number; paidEgp: number; dueEgp: number };
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
  const { data, error, isLoading } = useSWR<InvoiceDetail>(params?.id ? `/finance/invoices/${params.id}` : null, fetcher);
  const [printMode, setPrintMode] = useState(false);

  useEffect(() => {
    if (printMode) {
      window.print();
      setPrintMode(false);
    }
  }, [printMode]);

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
    <div>
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
    </div>
  );
}
