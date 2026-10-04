'use client';

import useSWR from 'swr';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowRight, Camera, Package, ShieldCheck, Wrench } from 'lucide-react';
import { errorMessage, fetcher } from '@/lib/api';
import { formatDateTime, formatMoney, maskImei, timeAgo } from '@/lib/format';
import { STATUS_COLORS, statusLabel, type RepairStatus } from '@/lib/constants';
import { Badge, Card, CardHeader, EmptyState, LoadingBlock, PageHeader } from '@/components/ui';

interface DevicePassport {
  device: {
    _id: string;
    brand: string;
    model: string;
    modelNumber?: string;
    color?: string;
    storage?: string;
    ram?: string;
    imei?: string;
    serial?: string;
    category?: string;
    conditionOnIntake?: string;
    maskedImei?: string;
    createdAt: string;
    purchase?: { purchasedFrom?: string; purchaseDate?: string | null; warrantyStatus?: string; warrantyExpiresAt?: string | null };
    passport?: {
      totalRepairs?: number;
      totalSpentEgp?: number;
      openTickets?: number;
      warrantyClaims?: number;
      riskFlags?: string[];
      replacedParts?: string[];
      firstSeenAt?: string;
      lastServiceAt?: string | null;
    };
    notes?: string;
  };
  customer: { _id: string; fullName: string; phone: string; companyName?: string } | null;
  repairHistory: {
    _id: string;
    ticketNumber: string;
    status: RepairStatus;
    statusLabel: string;
    createdAt: string;
    deliveredAt?: string | null;
    outcome?: string;
    intake?: { complaint?: string };
    diagnosis?: { summary?: string };
    cost?: { totalFinalEgf?: number; totalFinalEgp?: number };
    assignedTechnicianId?: { fullName: string } | null;
    warranty?: { policyDays?: number; expiresAt?: string | null };
  }[];
  replacedParts: {
    _id: string;
    quantity: number;
    status: string;
    installedAt?: string | null;
    warrantyExpiresAt?: string | null;
    grade?: string;
    partId?: { name: string; sku: string; category: string } | null;
    supplierId?: { name: string } | null;
  }[];
  photos: { id: string; kind: string; stage: string; caption?: string; url: string; mimeType: string; createdAt: string }[];
  timeline: { _id: string; toStatus: RepairStatus; eventType: string; note?: string; actorName?: string; createdAt: string }[];
  warrantyClaims: { _id: string; claimNumber: string; status: string; symptom: string; reportedAt: string; isSameFault: boolean }[];
  summary: {
    totalRepairs: number;
    totalSpentEgp: number;
    openTickets: number;
    riskFlags: string[];
    lastServiceAt?: string | null;
    warrantyClaims: number;
  };
}

const RISK_LABELS: Record<string, string> = {
  liquid_damage: 'أضرار سوائل',
  board_level: 'إصلاح بوردة',
  previous_repair: 'إصلاح سابق',
};

export default function DevicePassportPage() {
  const params = useParams<{ id: string }>();
  const { data, error, isLoading } = useSWR<DevicePassport>(params?.id ? `/devices/${params.id}` : null, fetcher);

  if (isLoading) {
    return (
      <Card>
        <LoadingBlock rows={8} />
      </Card>
    );
  }

  if (error || !data) {
    return <Card className="border-red-200 bg-red-50 p-5 text-sm text-red-700">{error ? errorMessage(error) : 'الجهاز غير موجود'}</Card>;
  }

  const { device, customer, repairHistory, replacedParts, photos, timeline, warrantyClaims, summary } = data;

  return (
    <div>
      <PageHeader
        breadcrumb={
          <Link href="/devices" className="inline-flex items-center gap-1 hover:text-brand-700">
            <ArrowRight size={12} /> كل الأجهزة
          </Link>
        }
        title={`${device.brand} ${device.model}`}
        subtitle={`جواز الجهاز — ${[device.color, device.storage, device.ram].filter(Boolean).join(' · ')}`}
        actions={
          summary.riskFlags?.map((flag) => (
            <Badge key={flag} className="border-amber-200 bg-amber-50 text-amber-800">
              {RISK_LABELS[flag] ?? flag}
            </Badge>
          )) ?? null
        }
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {/* سجل الإصلاحات */}
          <Card>
            <CardHeader
              title="سجل الإصلاحات"
              subtitle={`${repairHistory.length} تذكرة على هذا الجهاز`}
              icon={<Wrench size={18} />}
            />
            <div className="card-pad space-y-3">
              {repairHistory.length ? (
                repairHistory.map((ticket) => (
                  <Link
                    key={ticket._id}
                    href={`/tickets/${ticket._id}`}
                    className="block rounded-lg border border-ink-200 p-3 transition hover:border-brand-400 hover:bg-brand-50/40"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-bold text-ink-900" dir="ltr">
                        {ticket.ticketNumber}
                      </span>
                      <div className="flex items-center gap-2">
                        <Badge className={STATUS_COLORS[ticket.status]}>{ticket.statusLabel}</Badge>
                        <span className="text-xs text-ink-500">{formatDateTime(ticket.createdAt)}</span>
                      </div>
                    </div>
                    {ticket.intake?.complaint ? (
                      <p className="mt-1.5 text-xs text-ink-600">الشكوى: {ticket.intake.complaint}</p>
                    ) : null}
                    {ticket.diagnosis?.summary ? (
                      <p className="mt-1 text-xs text-indigo-700">التشخيص: {ticket.diagnosis.summary}</p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-ink-500">
                      <span className="num font-bold text-ink-700">
                        {formatMoney(ticket.cost?.totalFinalEgp ?? ticket.cost?.totalFinalEgf ?? 0)}
                      </span>
                      {ticket.assignedTechnicianId?.fullName ? <span>الفني: {ticket.assignedTechnicianId.fullName}</span> : null}
                      {ticket.warranty?.expiresAt ? (
                        <span
                          className={
                            new Date(ticket.warranty.expiresAt).getTime() > Date.now() ? 'text-emerald-700' : 'text-ink-400'
                          }
                        >
                          ضمان حتى {formatDateTime(ticket.warranty.expiresAt)}
                        </span>
                      ) : null}
                    </div>
                  </Link>
                ))
              ) : (
                <EmptyState title="لا يوجد سجل إصلاحات" icon={<Wrench size={20} />} />
              )}
            </div>
          </Card>

          {/* القطع المستبدلة */}
          <Card>
            <CardHeader title="القطع المستبدلة" subtitle={`${replacedParts.length} قطعة`} icon={<Package size={18} />} />
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>القطعة</th>
                    <th>المورد</th>
                    <th>الدرجة</th>
                    <th>التاريخ</th>
                    <th>ضمان القطعة</th>
                    <th>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {replacedParts.length ? (
                    replacedParts.map((part) => (
                      <tr key={part._id}>
                        <td className="text-xs">
                          <p className="font-medium text-ink-800">{part.partId?.name ?? '—'}</p>
                          <p className="text-ink-400" dir="ltr">
                            {part.partId?.sku ?? ''}
                          </p>
                        </td>
                        <td className="text-xs">{part.supplierId?.name ?? '—'}</td>
                        <td className="text-xs">{part.grade ?? '—'}</td>
                        <td className="text-xs text-ink-500">
                          {part.installedAt ? formatDateTime(part.installedAt) : '—'}
                        </td>
                        <td className="text-xs">
                          {part.warrantyExpiresAt ? (
                            new Date(part.warrantyExpiresAt).getTime() > Date.now() ? (
                              <span className="text-emerald-700">ساري</span>
                            ) : (
                              <span className="text-ink-400">منتهي</span>
                            )
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          <Badge
                            className={
                              part.status === 'defective'
                                ? 'border-red-200 bg-red-50 text-red-700'
                                : part.status === 'installed'
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                  : 'border-ink-200 bg-ink-50 text-ink-600'
                            }
                          >
                            {part.status === 'defective' ? 'معيبة' : part.status === 'installed' ? 'مثبتة' : part.status}
                          </Badge>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6}>
                        <EmptyState title="لم تُستبدل قطع" icon={<Package size={20} />} />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {/* عوائد الضمان */}
          {warrantyClaims.length ? (
            <Card>
              <CardHeader title="claims الضمان" subtitle={`${warrantyClaims.length} claim`} icon={<ShieldCheck size={18} />} />
              <div className="card-pad space-y-2">
                {warrantyClaims.map((claim) => (
                  <div key={claim._id} className="rounded-lg border border-ink-200 p-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-ink-800" dir="ltr">
                        {claim.claimNumber}
                      </span>
                      <Badge
                        className={
                          claim.status === 'resolved'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : claim.status === 'rejected'
                              ? 'border-red-200 bg-red-50 text-red-700'
                              : 'border-amber-200 bg-amber-50 text-amber-800'
                        }
                      >
                        {claim.status === 'resolved' ? 'تم الحل' : claim.status === 'rejected' ? 'مرفوض' : claim.status}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-ink-600">{claim.symptom}</p>
                    <p className="mt-0.5 text-[11px] text-ink-400">
                      {formatDateTime(claim.reportedAt)} · {claim.isSameFault ? 'نفس العطل' : 'عطل مختلف'}
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}

          {/* سلسلة الأحداث */}
          <Card>
            <CardHeader title="سلسلة أحداث الجهاز" subtitle="كل ما جرى على هذا الجهاز" />
            <div className="card-pad">
              <ol className="space-y-2.5 border-r-2 border-ink-200 pr-4">
                {timeline.slice(0, 25).map((event) => (
                  <li key={event._id} className="relative">
                    <span className="absolute -right-[1.42rem] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-brand-600" />
                    <p className="text-xs font-medium text-ink-700">{statusLabel(event.toStatus)}</p>
                    {event.note ? <p className="text-[11px] text-ink-500">{event.note}</p> : null}
                    <p className="text-[10px] text-ink-400">
                      {formatDateTime(event.createdAt)} {event.actorName ? `· ${event.actorName}` : ''}
                    </p>
                  </li>
                ))}
                {!timeline.length ? <p className="text-xs text-ink-500">لا توجد أحداث.</p> : null}
              </ol>
            </div>
          </Card>
        </div>

        {/* الجانب */}
        <div className="space-y-4">
          <Card>
            <CardHeader title="ملخص الجهاز" />
            <dl className="card-pad space-y-2.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-500">إجمالي الإصلاحات</dt>
                <dd className="num font-bold">{summary.totalRepairs}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-500">إجمالي المصروف</dt>
                <dd className="num font-bold text-emerald-700">{formatMoney(summary.totalSpentEgp)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-500">تذاكر مفتوحة</dt>
                <dd className="num font-bold text-amber-700">{summary.openTickets}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-500">claims الضمان</dt>
                <dd className="num font-bold">{summary.warrantyClaims}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-500">آخر خدمة</dt>
                <dd className="text-xs">{summary.lastServiceAt ? timeAgo(summary.lastServiceAt) : '—'}</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <CardHeader title="بيانات فنية" />
            <dl className="card-pad space-y-2 text-sm">
              <Row label="IMEI" value={device.imei ? maskImei(device.imei) : '—'} ltr />
              <Row label="السيريال" value={device.serial || '—'} ltr />
              <Row label="رقم الموديل" value={device.modelNumber || '—'} ltr />
              <Row label="المساحة" value={device.storage || '—'} />
              <Row label="الذاكرة" value={device.ram || '—'} />
              <Row label="تاريخ التسجيل" value={formatDateTime(device.createdAt)} />
              {device.purchase?.purchasedFrom ? <Row label="مصدر الشراء" value={device.purchase.purchasedFrom} /> : null}
            </dl>
          </Card>

          <Card>
            <CardHeader title="المالك" />
            <div className="card-pad space-y-1 text-sm">
              {customer ? (
                <>
                  <Link href={`/customers/${customer._id}`} className="font-bold text-brand-700 hover:underline">
                    {customer.fullName}
                  </Link>
                  {customer.companyName ? <p className="text-xs text-ink-500">{customer.companyName}</p> : null}
                  <p className="num text-xs text-ink-500" dir="ltr">
                    {customer.phone}
                  </p>
                </>
              ) : (
                <p className="text-ink-500">—</p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="الأدلة والصور" subtitle={`${photos.length} ملف`} icon={<Camera size={18} />} />
            <div className="card-pad">
              {photos.length ? (
                <div className="grid grid-cols-3 gap-2">
                  {photos.slice(0, 9).map((photo) => (
                    <a
                      key={photo.id}
                      href={photo.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block aspect-square overflow-hidden rounded-lg border border-ink-200"
                    >
                      {photo.mimeType.startsWith('image/') ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={photo.url} alt={photo.stage} className="h-full w-full object-cover" />
                      ) : (
                        <span className="flex h-full items-center justify-center text-xs text-ink-400">ملف</span>
                      )}
                    </a>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-ink-500">لا توجد صور.</p>
              )}
            </div>
          </Card>

          {device.notes ? (
            <Card>
              <CardHeader title="ملاحظات" />
              <p className="card-pad text-sm text-ink-600">{device.notes}</p>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-ink-500">{label}</dt>
      <dd className="truncate text-xs font-medium text-ink-800" dir={ltr ? 'ltr' : undefined}>
        {value}
      </dd>
    </div>
  );
}
