'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import useSWR from 'swr';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  MapPin,
  Phone,
  ShieldCheck,
  Smartphone,
  Wrench,
  XCircle,
} from 'lucide-react';
import { api, errorMessage, fetcher } from '@/lib/api';
import { formatDateTime, formatMoney, timeAgo } from '@/lib/format';
import { REPAIR_STATUSES, STATUS_LABELS, type RepairStatus } from '@/lib/constants';

interface TrackResponse {
  organization: { name: string; phone: string; primaryColor: string; receiptFooterText: string };
  ticket: {
    ticketNumber: string;
    status: RepairStatus;
    statusLabel: string;
    complaint: string;
    diagnosisSummary: string;
    faultCategory: string;
    customerName: string;
    customerPhone: string;
    device: { brand?: string; model?: string; color?: string; storage?: string; imeiMasked?: string } | null;
    technicianName: string;
    createdAt: string;
    promisedAt?: string | null;
    readyAt?: string | null;
    deliveredAt?: string | null;
    customerVisibleNotes?: string;
  };
  costs: { quotedEgp: number; finalEgp: number; paidEgp: number; dueEgp: number; currency: string };
  warranty: { policyDays: number; startsAt?: string | null; expiresAt?: string | null; isActive: boolean };
  pendingApproval: {
    estimateNumber: string;
    version: number;
    totalEgp: number;
    sentAt?: string | null;
    lines: { description: string; quantity: number; unitPriceEgp: number; totalEgp: number }[];
    terms?: string;
  } | null;
  estimates: { estimateNumber: string; version: number; status: string; totalEgp: number; approvedTotalEgp: number; decidedAt?: string | null }[];
  timeline: { toStatus: RepairStatus; toStatusLabel: string; eventType: string; note: string; at: string }[];
  evidence: { id: string; kind: string; stage: string; caption?: string; url: string; mimeType: string }[];
}

const STAGES: RepairStatus[] = ['received', 'inspection', 'diagnosis', 'estimate', 'waiting_approval', 'approved', 'repairing', 'testing_qc', 'ready', 'delivered'];

export default function PublicTrackPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;

  const { data, error, isLoading, mutate } = useSWR<TrackResponse>(
    token ? `/public/track/${token}` : null,
    fetcher,
    { refreshInterval: 60_000 },
  );

  const [deciding, setDeciding] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; message: string } | null>(null);

  const decide = async (decision: 'approved' | 'rejected') => {
    if (!token) return;
    setDeciding(true);
    setFeedback(null);
    try {
      await api.post(`/public/track/${token}/decide`, {
        decision,
        rejectionReason: decision === 'rejected' ? rejectReason : undefined,
      });
      setFeedback({
        kind: 'ok',
        message: decision === 'approved' ? 'تم تسجيل موافقتك على عرض السعر، شكرًا لك.' : 'تم تسجيل رفضك لعرض السعر.',
      });
      setShowReject(false);
      await mutate();
    } catch (err) {
      setFeedback({ kind: 'err', message: errorMessage(err) });
    } finally {
      setDeciding(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-50">
        <div className="flex flex-col items-center gap-3">
          <span className="h-9 w-9 animate-spin rounded-full border-[3px] border-brand-200 border-t-brand-700" />
          <p className="text-sm text-ink-500">جارٍ تحميل حالة الجهاز…</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-50 p-4">
        <div className="card card-pad max-w-md text-center">
          <AlertCircle size={32} className="mx-auto text-amber-500" />
          <h1 className="mt-3 text-lg font-bold text-ink-900">رابط التتبع غير صحيح</h1>
          <p className="mt-1.5 text-sm text-ink-500">
            {error ? errorMessage(error) : 'لم نتمكن من العثور على تذكرة بهذا الرابط. تأكد من الرابط المُرسل لك من المركز.'}
          </p>
        </div>
      </div>
    );
  }

  const { ticket, costs, warranty, pendingApproval, organization, timeline, evidence } = data;
  const currentIndex = STAGES.indexOf(ticket.status);
  const isDone = ticket.status === 'delivered' || ticket.status === 'cancelled';

  return (
    <div className="min-h-screen bg-ink-50 pb-10" dir="rtl">
      {/* رأس المركز */}
      <header className="bg-brand-800 px-4 py-5 text-white" style={{ backgroundColor: organization.primaryColor || '#0f766e' }}>
        <div className="mx-auto max-w-4xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs text-white/80">تتبع حالة الإصلاح</p>
              <h1 className="text-xl font-bold">{organization.name}</h1>
            </div>
            {organization.phone ? (
              <a href={`tel:${organization.phone}`} className="flex items-center gap-2 rounded-lg bg-white/15 px-3 py-2 text-sm">
                <Phone size={15} />
                <span dir="ltr">{organization.phone}</span>
              </a>
            ) : null}
          </div>

          <div className="mt-4 rounded-xl bg-white/10 p-4 backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs text-white/70">رقم التذكرة</p>
                <p className="text-lg font-bold" dir="ltr">
                  {ticket.ticketNumber}
                </p>
              </div>
              <span className="rounded-full bg-white px-3.5 py-1.5 text-xs font-bold text-brand-800">
                {ticket.statusLabel}
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-4 p-4">
        {feedback ? (
          <div
            className={`flex items-start gap-2 rounded-xl p-3.5 text-sm ${
              feedback.kind === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'
            }`}
          >
            {feedback.kind === 'ok' ? <CheckCircle2 size={18} className="mt-0.5 shrink-0" /> : <XCircle size={18} className="mt-0.5 shrink-0" />}
            <p>{feedback.message}</p>
          </div>
        ) : null}

        {/* شريط المراحل */}
        {!isDone ? (
          <section className="card card-pad">
            <h2 className="mb-3 text-sm font-bold text-ink-800">مراحل الإصلاح</h2>
            <div className="flex items-center gap-1 overflow-x-auto pb-1">
              {STAGES.map((stage, index) => {
                const passed = index <= currentIndex;
                const isCurrent = index === currentIndex;
                return (
                  <div key={stage} className="flex shrink-0 items-center gap-1">
                    <div className="flex flex-col items-center gap-1.5">
                      <span
                        className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold ${
                          isCurrent
                            ? 'bg-brand-700 text-white ring-4 ring-brand-100'
                            : passed
                              ? 'bg-brand-600 text-white'
                              : 'bg-ink-200 text-ink-500'
                        }`}
                      >
                        {passed && !isCurrent ? <CheckCircle2 size={14} /> : index + 1}
                      </span>
                      <span className={`whitespace-nowrap text-[10px] ${isCurrent ? 'font-bold text-brand-800' : 'text-ink-500'}`}>
                        {STATUS_LABELS[stage]}
                      </span>
                    </div>
                    {index < STAGES.length - 1 ? (
                      <span className={`mb-4 h-0.5 w-6 ${index < currentIndex ? 'bg-brand-600' : 'bg-ink-200'}`} />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {/* طلب الموافقة */}
        {pendingApproval ? (
          <section className="card border-amber-300 bg-amber-50 card-pad">
            <h2 className="flex items-center gap-2 text-sm font-bold text-amber-900">
              <AlertCircle size={17} /> مطلوب موافقتك على عرض السعر
            </h2>
            <p className="mt-1 text-xs text-amber-800">
              عرض رقم {pendingApproval.estimateNumber} (إصدار {pendingApproval.version}) — أُرسل {timeAgo(pendingApproval.sentAt)}
            </p>

            <div className="mt-3 space-y-1.5 rounded-lg bg-white p-3">
              {pendingApproval.lines.map((line, index) => (
                <div key={index} className="flex items-center justify-between gap-2 border-b border-ink-100 pb-1.5 last:border-0">
                  <span className="text-xs text-ink-700">{line.description}</span>
                  <span className="num shrink-0 text-xs font-medium text-ink-800">
                    {line.quantity} × {formatMoney(line.unitPriceEgp, false)}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between pt-1.5">
                <span className="text-sm font-bold text-ink-900">الإجمالي</span>
                <span className="num text-base font-bold text-brand-800">{formatMoney(pendingApproval.totalEgp)}</span>
              </div>
            </div>

            {pendingApproval.terms ? <p className="mt-2 text-[11px] text-amber-800">{pendingApproval.terms}</p> : null}

            {showReject ? (
              <div className="mt-3 space-y-2">
                <textarea
                  className="input min-h-[3rem] bg-white"
                  placeholder="اكتب سبب الرفض (اختياري)"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
                <div className="flex gap-2">
                  <button type="button" className="btn-danger flex-1" onClick={() => void decide('rejected')} disabled={deciding}>
                    تأكيد الرفض
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => setShowReject(false)}>
                    رجوع
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex gap-2">
                <button type="button" className="btn-primary flex-1" onClick={() => void decide('approved')} disabled={deciding}>
                  <CheckCircle2 size={16} /> {deciding ? 'جارٍ التسجيل…' : 'أوافق على الإصلاح'}
                </button>
                <button type="button" className="btn-secondary flex-1" onClick={() => setShowReject(true)} disabled={deciding}>
                  <XCircle size={16} /> أرفض
                </button>
              </div>
            )}
          </section>
        ) : null}

        {/* تفاصيل الجهاز */}
        <section className="card card-pad">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink-800">
            <Smartphone size={16} /> تفاصيل الجهاز
          </h2>
          <dl className="grid gap-2.5 text-sm sm:grid-cols-2">
            <Row label="الجهاز" value={ticket.device ? `${ticket.device.brand ?? ''} ${ticket.device.model ?? ''}` : '—'} />
            <Row label="اللون / المساحة" value={[ticket.device?.color, ticket.device?.storage].filter(Boolean).join(' · ') || '—'} />
            <Row label="الشكوى" value={ticket.complaint || '—'} />
            <Row label="التشخيص" value={ticket.diagnosisSummary || 'قيد التشخيص'} />
            <Row label="الفني المسؤول" value={ticket.technicianName || '—'} />
            <Row label="الموعد المتوقع" value={ticket.promisedAt ? formatDateTime(ticket.promisedAt) : '—'} />
          </dl>
        </section>

        {/* التكاليف */}
        <section className="card card-pad">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink-800">
            <Wrench size={16} /> التكاليف
          </h2>
          <div className="grid gap-3 sm:grid-cols-4">
            <CostBox label="عرض السعر" value={formatMoney(costs.quotedEgp)} />
            <CostBox label="التكلفة النهائية" value={formatMoney(costs.finalEgp)} highlight />
            <CostBox label="المدفوع" value={formatMoney(costs.paidEgp)} tone="ok" />
            <CostBox label="المتبقي" value={formatMoney(costs.dueEgp)} tone={costs.dueEgp > 0 ? 'due' : 'ok'} />
          </div>
        </section>

        {/* الضمان */}
        {warranty.policyDays ? (
          <section className={`card card-pad ${warranty.isActive ? 'border-emerald-300 bg-emerald-50' : ''}`}>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-ink-800">
              <ShieldCheck size={16} /> الضمان
            </h2>
            <p className="text-sm text-ink-700">
              مدة الضمان {warranty.policyDays} يوم
              {warranty.expiresAt ? ` — ينتهي في ${formatDateTime(warranty.expiresAt)}` : ''}
            </p>
            {warranty.isActive ? (
              <p className="mt-1 text-xs font-bold text-emerald-700">الضمان ساري حاليًا</p>
            ) : warranty.expiresAt ? (
              <p className="mt-1 text-xs text-ink-500">انتهت مدة الضمان</p>
            ) : null}
          </section>
        ) : null}

        {/* الصور */}
        {evidence.length ? (
          <section className="card card-pad">
            <h2 className="mb-3 text-sm font-bold text-ink-800">صور الجهاز</h2>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {evidence.slice(0, 10).map((file) => (
                <a key={file.id} href={file.url} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded-lg border border-ink-200">
                  {file.mimeType.startsWith('image/') ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={file.url} alt={file.stage} className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full items-center justify-center text-xs text-ink-400">ملف</span>
                  )}
                </a>
              ))}
            </div>
          </section>
        ) : null}

        {/* الأحداث */}
        <section className="card card-pad">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink-800">
            <Clock size={16} /> سجل التحديثات
          </h2>
          <ol className="space-y-3 border-r-2 border-ink-200 pr-4">
            {[...timeline].reverse().map((event, index) => (
              <li key={index} className="relative">
                <span className="absolute -right-[1.42rem] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-brand-600" />
                <p className="text-xs font-bold text-ink-700">{event.toStatusLabel}</p>
                {event.note ? <p className="text-[11px] text-ink-500">{event.note}</p> : null}
                <p className="text-[10px] text-ink-400">{formatDateTime(event.at)}</p>
              </li>
            ))}
            {!timeline.length ? <p className="text-xs text-ink-500">لا توجد تحديثات بعد.</p> : null}
          </ol>
        </section>

        <footer className="pt-2 text-center">
          <p className="text-[11px] leading-relaxed text-ink-400">
            {organization.receiptFooterText || 'هذه الصفحة لمتابعة حالة الجهاز فقط.'}
          </p>
          {organization.phone ? (
            <a href={`tel:${organization.phone}`} className="mt-2 inline-flex items-center gap-1.5 text-xs text-brand-700 hover:underline">
              <MapPin size={12} /> للاستفسار: <span dir="ltr">{organization.phone}</span>
            </a>
          ) : null}
        </footer>
      </main>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-ink-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink-800">{value}</dd>
    </div>
  );
}

function CostBox({ label, value, tone, highlight }: { label: string; value: string; tone?: 'ok' | 'due'; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? 'border-brand-300 bg-brand-50' : 'border-ink-200'}`}>
      <p className="text-[11px] text-ink-500">{label}</p>
      <p
        className={`num mt-1 text-sm font-bold ${
          tone === 'ok' ? 'text-emerald-700' : tone === 'due' ? 'text-red-600' : highlight ? 'text-brand-800' : 'text-ink-800'
        }`}
      >
        {value}
      </p>
    </div>
  );
}

void REPAIR_STATUSES;
