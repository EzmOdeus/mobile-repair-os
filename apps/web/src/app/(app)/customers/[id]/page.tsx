'use client';

import { useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowRight, Camera, FileText, Phone, Printer, ShieldCheck, Smartphone, Wrench, AlertTriangle } from 'lucide-react';
import { api, errorMessage, fetcher } from '@/lib/api';
import { formatDate, formatDateTime, formatMoney, maskImei, timeAgo } from '@/lib/format';
import { STATUS_COLORS, statusLabel, type RepairStatus } from '@/lib/constants';
import { Badge, Card, CardHeader, EmptyState, LoadingBlock, PageHeader } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/lib/auth';

interface CustomerStatement {
  customer: { id: string; fullName: string; phone?: string; code?: string };
  period: { from: string; to: string };
  openingBalanceEgp: number;
  closingBalanceEgp: number;
  entries: {
    date: string;
    kind: string;
    reference: string;
    description: string;
    debitEgp: number;
    creditEgp: number;
    balanceEgp: number;
  }[];
}

interface CustomerDetail {
  _id: string;
  code?: string;
  fullName: string;
  phone: string;
  phoneAlt?: string;
  whatsapp?: string;
  email?: string;
  type: string;
  companyName?: string;
  address?: { governorate?: string; area?: string; street?: string };
  notes?: string;
  tags?: string[];
  isBlacklisted?: boolean;
  createdAt: string;
  devices: {
    _id: string;
    brand: string;
    model: string;
    color?: string;
    storage?: string;
    imei?: string;
    category?: string;
    passport?: { totalRepairs?: number; openTickets?: number; riskFlags?: string[]; lastServiceAt?: string | null };
  }[];
  recentTickets: {
    _id: string;
    ticketNumber: string;
    status: RepairStatus;
    priority: string;
    createdAt: string;
    deliveredAt?: string | null;
    cost?: { totalFinalEgp?: number };
    warranty?: { expiresAt?: string | null };
  }[];
  summary: { openTickets: number; deliveredTickets: number; totalSpentEgp: number };
}

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const toast = useToast();
  const { hasPermission } = useAuth();
  const { data, error, isLoading } = useSWR<CustomerDetail>(params?.id ? `/customers/${params.id}` : null, fetcher);
  const [statementOpen, setStatementOpen] = useState(false);
  const [statement, setStatement] = useState<CustomerStatement | null>(null);
  const [statementLoading, setStatementLoading] = useState(false);

  const openStatement = async () => {
    if (!params?.id) return;
    setStatementOpen(true);
    setStatement(null);
    setStatementLoading(true);
    try {
      const result = await api.get<CustomerStatement>(`/finance/customers/${params.id}/statement`);
      setStatement(result);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setStatementLoading(false);
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
    return <Card className="border-red-200 bg-red-50 p-5 text-sm text-red-700">{error ? errorMessage(error) : 'العميل غير موجود'}</Card>;
  }

  return (
    <div>
      <PageHeader
        breadcrumb={
          <Link href="/customers" className="inline-flex items-center gap-1 hover:text-brand-700">
            <ArrowRight size={12} /> كل العملاء
          </Link>
        }
        title={data.fullName}
        subtitle={`${data.type === 'company' ? 'شركة' : data.type === 'reseller' ? 'تاجر' : 'فرد'} · عميل منذ ${formatDateTime(data.createdAt)}`}
        actions={
          <>
            <a href={`tel:${data.phone}`} className="btn-secondary">
              <Phone size={15} /> <span dir="ltr">{data.phone}</span>
            </a>
            {data.whatsapp ? (
              <a
                href={`https://wa.me/2${data.whatsapp.replace(/^0/, '')}`}
                target="_blank"
                rel="noreferrer"
                className="btn-secondary"
              >
                واتساب
              </a>
            ) : null}
            {hasPermission('payment:read') ? (
              <button type="button" className="btn-secondary" onClick={() => void openStatement()}>
                <FileText size={15} /> كشف حساب
              </button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {/* الأجهزة */}
          <Card>
            <CardHeader title="أجهزة العميل" subtitle={`${data.devices.length} جهاز`} icon={<Smartphone size={18} />} />
            <div className="card-pad">
              {data.devices.length ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {data.devices.map((device) => (
                    <Link
                      key={device._id}
                      href={`/devices/${device._id}`}
                      className="rounded-lg border border-ink-200 p-3 transition hover:border-brand-400 hover:bg-brand-50/40"
                    >
                      <p className="text-sm font-bold text-ink-800">
                        {device.brand} {device.model}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-500">
                        {[device.color, device.storage].filter(Boolean).join(' · ') || '—'}
                      </p>
                      <p className="mt-1 text-[11px] text-ink-400" dir="ltr">
                        IMEI: {maskImei(device.imei)}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {device.passport?.totalRepairs ? (
                          <Badge className="border-ink-200 bg-ink-50 text-ink-600">
                            {device.passport.totalRepairs} إصلاح
                          </Badge>
                        ) : null}
                        {device.passport?.openTickets ? (
                          <Badge className="border-amber-200 bg-amber-50 text-amber-800">
                            {device.passport.openTickets} مفتوح
                          </Badge>
                        ) : null}
                        {device.passport?.riskFlags?.map((flag) => (
                          <Badge key={flag} className="border-red-200 bg-red-50 text-red-700">
                            {flag === 'liquid_damage' ? 'سوائل' : flag === 'board_level' ? 'بوردة' : 'إصلاح سابق'}
                          </Badge>
                        ))}
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyState title="لا توجد أجهزة مسجلة" icon={<Smartphone size={20} />} />
              )}
            </div>
          </Card>

          {/* سجل التذاكر */}
          <Card>
            <CardHeader title="سجل تذاكر الصيانة" subtitle="آخر 15 تذكرة" icon={<Wrench size={18} />} />
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>رقم التذكرة</th>
                    <th>الحالة</th>
                    <th>المبلغ</th>
                    <th>التاريخ</th>
                    <th>الضمان</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.recentTickets.length ? (
                    data.recentTickets.map((ticket) => {
                      const warrantyActive =
                        ticket.warranty?.expiresAt && new Date(ticket.warranty.expiresAt).getTime() > Date.now();
                      return (
                        <tr key={ticket._id}>
                          <td className="font-bold text-ink-900" dir="ltr">
                            {ticket.ticketNumber}
                          </td>
                          <td>
                            <Badge className={STATUS_COLORS[ticket.status]}>{statusLabel(ticket.status)}</Badge>
                          </td>
                          <td className="num text-xs">{formatMoney(ticket.cost?.totalFinalEgp ?? 0)}</td>
                          <td className="text-xs text-ink-500">{formatDateTime(ticket.createdAt)}</td>
                          <td className="text-xs">
                            {ticket.warranty?.expiresAt ? (
                              warrantyActive ? (
                                <span className="flex items-center gap-1 text-emerald-700">
                                  <ShieldCheck size={13} /> ساري
                                </span>
                              ) : (
                                <span className="text-ink-400">منتهي</span>
                              )
                            ) : (
                              '—'
                            )}
                          </td>
                          <td>
                            <Link href={`/tickets/${ticket._id}`} className="btn-ghost text-xs">
                              فتح
                            </Link>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={6}>
                        <EmptyState title="لا توجد تذاكر" icon={<Wrench size={20} />} />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* العمود الجانبي */}
        <div className="space-y-4">
          <Card>
            <CardHeader title="ملخص الحساب" />
            <dl className="card-pad space-y-2.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-500">إجمالي التذاكر</dt>
                <dd className="num font-bold">{data.summary.deliveredTickets + data.summary.openTickets}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-500">تذاكر مفتوحة</dt>
                <dd className="num font-bold text-amber-700">{data.summary.openTickets}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-500">إجمالي المصروف</dt>
                <dd className="num font-bold text-emerald-700">{formatMoney(data.summary.totalSpentEgp)}</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <CardHeader title="بيانات الاتصال" />
            <dl className="card-pad space-y-2 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-ink-500">الهاتف</dt>
                <dd className="num" dir="ltr">
                  {data.phone}
                </dd>
              </div>
              {data.phoneAlt ? (
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-500">هاتف بديل</dt>
                  <dd className="num" dir="ltr">
                    {data.phoneAlt}
                  </dd>
                </div>
              ) : null}
              {data.email ? (
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-500">البريد</dt>
                  <dd className="text-xs" dir="ltr">
                    {data.email}
                  </dd>
                </div>
              ) : null}
              {data.companyName ? (
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-500">الشركة</dt>
                  <dd>{data.companyName}</dd>
                </div>
              ) : null}
              {data.address?.governorate || data.address?.area ? (
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-500">العنوان</dt>
                  <dd className="text-xs">{[data.address.governorate, data.address.area].filter(Boolean).join(' - ')}</dd>
                </div>
              ) : null}
              {data.code ? (
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-500">كود العميل</dt>
                  <dd className="num">{data.code}</dd>
                </div>
              ) : null}
            </dl>
          </Card>

          {data.isBlacklisted ? (
            <Card className="border-red-200 bg-red-50">
              <div className="card-pad flex items-start gap-2 text-sm text-red-800">
                <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                <p>هذا العميل محظور من التعامل. راجع ملاحظات المركز قبل قبول أي جهاز.</p>
              </div>
            </Card>
          ) : null}

          {data.notes ? (
            <Card>
              <CardHeader title="ملاحظات" icon={<Camera size={18} />} />
              <p className="card-pad text-sm leading-relaxed text-ink-600">{data.notes}</p>
            </Card>
          ) : null}

          <p className="px-1 text-[11px] text-ink-400">آخر تحديث: {timeAgo(new Date())}</p>
        </div>
      </div>

      <Modal
        open={statementOpen}
        onClose={() => {
          setStatementOpen(false);
          setStatement(null);
        }}
        title={`كشف حساب — ${data.fullName}`}
        subtitle={statement ? `من ${formatDate(statement.period.from)} إلى ${formatDate(statement.period.to)}` : undefined}
        size="lg"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => window.print()}>
              <Printer size={15} /> طباعة
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                setStatementOpen(false);
                setStatement(null);
              }}
            >
              إغلاق
            </button>
          </>
        }
      >
        {statementLoading ? (
          <LoadingBlock rows={6} />
        ) : statement ? (
          <div id="print-area" className="space-y-3">
            <div className="grid gap-2 rounded-xl border border-ink-100 bg-ink-50 p-3 text-xs sm:grid-cols-3">
              <div>
                <p className="text-ink-500">رصيد افتتاحي</p>
                <p className="num mt-0.5 font-bold">{formatMoney(statement.openingBalanceEgp)}</p>
              </div>
              <div>
                <p className="text-ink-500">إجمالي المدين</p>
                <p className="num mt-0.5 font-bold">{formatMoney(statement.entries.reduce((acc, e) => acc + e.debitEgp, 0))}</p>
              </div>
              <div>
                <p className="text-ink-500">الرصيد الختامي</p>
                <p className="num mt-0.5 font-bold text-red-700">{formatMoney(statement.closingBalanceEgp)}</p>
              </div>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>التاريخ</th>
                    <th>المستند</th>
                    <th>البيان</th>
                    <th>مدين</th>
                    <th>دائن</th>
                    <th>الرصيد</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.entries.length ? (
                    statement.entries.map((entry, index) => (
                      <tr key={`${entry.reference}-${index}`}>
                        <td className="text-xs">{formatDate(entry.date)}</td>
                        <td className="text-xs font-medium" dir="ltr">{entry.reference}</td>
                        <td className="text-xs">{entry.description}</td>
                        <td className="num text-xs">{entry.debitEgp ? formatMoney(entry.debitEgp) : '—'}</td>
                        <td className="num text-xs text-emerald-700">{entry.creditEgp ? formatMoney(entry.creditEgp) : '—'}</td>
                        <td className="num text-xs font-semibold">{formatMoney(entry.balanceEgp)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6}>
                        <EmptyState title="لا توجد حركات في الفترة" icon={<FileText size={20} />} />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
