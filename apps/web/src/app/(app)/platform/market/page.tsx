'use client';

import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  Globe2,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Store,
  Tag,
  XCircle,
} from 'lucide-react';
import { api, errorMessage, fetcher, qs, type Paginated } from '@/lib/api';
import { formatDate, formatMoney, formatNumber, timeAgo } from '@/lib/format';
import {
  CONDITION_LABELS,
  CONDITION_STYLES,
  LISTING_STATUS_LABELS,
  LISTING_STATUS_STYLES,
  locationLine,
  specLine,
  type MarketListing,
} from '@/lib/market';
import { Badge, Card, CardHeader, EmptyState, Field, LoadingBlock, PageHeader, StatCard } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';

interface PlatformMarketStats {
  pending: number;
  active: number;
  reserved: number;
  sold: number;
  rejected: number;
  offersPending: number;
  priceGuides: number;
}

interface MarketListMeta {
  pendingTotal: number;
  [key: string]: unknown;
}

const STATUS_OPTIONS = [
  ['pending_review', 'بانتظار المراجعة'],
  ['active', 'نشط'],
  ['rejected', 'مرفوض'],
  ['reserved', 'محجوز'],
  ['sold', 'مُباع'],
] as const;

export default function PlatformMarketPage() {
  const toast = useToast();
  const [status, setStatus] = useState('pending_review');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<MarketListing | null>(null);
  const [rejectFor, setRejectFor] = useState<MarketListing | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const stats = useSWR<PlatformMarketStats>('/platform/market/stats', fetcher, { refreshInterval: 60_000 });
  const list = useSWR<Paginated<MarketListing>>(
    `/platform/market/listings${qs({ status, q: query, scope: 'public', limit: 40 })}`,
    fetcher,
    { refreshInterval: 60_000 },
  );
  const pendingTotal = (list.data?.meta as MarketListMeta | undefined)?.pendingTotal ?? stats.data?.pending ?? 0;

  async function runAction(run: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError('');
    try {
      await run();
      toast.success(message);
      setRejectFor(null);
      setReason('');
      setDetail(null);
      void list.mutate();
      void stats.mutate();
    } catch (err) {
      const messageText = errorMessage(err);
      setError(messageText);
      toast.error(messageText);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="مراجعة ماركت بلس"
        subtitle="اعتماد أو رفض الإعلانات العامة قبل ظهورها لبقية المراكز — الإعلانات الداخلية لا تحتاج مراجعة"
        actions={
          <>
            <Link href="/platform/prices" className="btn-secondary">
              <Tag size={15} />
              دليل الأسعار
            </Link>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                void list.mutate();
                void stats.mutate();
              }}
            >
              <RefreshCw size={15} />
              تحديث
            </button>
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="بانتظار المراجعة"
          value={formatNumber(stats.data?.pending)}
          hint="إعلانات عامة"
          icon={<Clock size={20} />}
          tone="warning"
        />
        <StatCard label="إعلانات عامة نشطة" value={formatNumber(stats.data?.active)} icon={<Globe2 size={20} />} tone="success" />
        <StatCard label="محجوزة / مبيعة" value={`${formatNumber(stats.data?.reserved)} / ${formatNumber(stats.data?.sold)}`} icon={<CheckCircle2 size={20} />} />
        <StatCard
          label="عروض معلّقة"
          value={formatNumber(stats.data?.offersPending)}
          hint={`دليل الأسعار: ${formatNumber(stats.data?.priceGuides)} سعرًا`}
          icon={<Store size={20} />}
          tone="info"
        />
      </div>

      {error ? <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div> : null}

      <Card>
        <CardHeader
          title="الإعلانات العامة"
          subtitle={`${formatNumber(list.data?.meta.total ?? 0)} إعلان — منها ${formatNumber(pendingTotal)} بانتظار المراجعة`}
          icon={<ShieldCheck size={18} />}
        />
        <div className="flex flex-wrap items-end gap-2 border-b border-ink-100 px-4 py-3">
          <div className="relative min-w-52 flex-1">
            <Search size={15} className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-ink-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && setQuery(search)}
              placeholder="بحث بالعنوان أو الماركة أو اسم المركز…"
              className="input pr-9"
            />
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="input w-auto">
            {STATUS_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button type="button" className="btn-primary btn-sm" onClick={() => setQuery(search)}>
            <Search size={14} />
            بحث
          </button>
        </div>

        {list.isLoading ? (
          <LoadingBlock rows={6} />
        ) : list.error ? (
          <div className="card-pad text-sm text-red-700">تعذر تحميل الإعلانات: {errorMessage(list.error)}</div>
        ) : !list.data?.items.length ? (
          <EmptyState title="لا توجد إعلانات في هذه الحالة" icon={<Globe2 size={24} />} />
        ) : (
          <div className="divide-y divide-ink-100">
            {list.data.items.map((listing) => {
              const effective = listing.effectiveStatus || listing.status;
              return (
                <div key={listing.id} className="flex flex-wrap items-start gap-3 p-4">
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-ink-100">
                    {listing.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={listing.coverUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <Store size={24} className="text-ink-300" />
                    )}
                  </div>
                  <div className="min-w-56 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button type="button" className="text-sm font-bold text-ink-800 hover:text-brand-700" onClick={() => setDetail(listing)}>
                        {listing.title}
                      </button>
                      <Badge className={LISTING_STATUS_STYLES[effective] ?? ''}>{LISTING_STATUS_LABELS[effective] ?? effective}</Badge>
                      <Badge className={CONDITION_STYLES[listing.condition] ?? ''}>{CONDITION_LABELS[listing.condition] ?? listing.condition}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-ink-500">{specLine(listing)}</p>
                    <p className="mt-1 text-xs text-ink-500">
                      {listing.seller.organizationName}
                      {listing.seller.branchName ? ` — ${listing.seller.branchName}` : ''} · {locationLine(listing) || 'بدون موقع'}
                    </p>
                    <p className="mt-1 text-[11px] text-ink-400">
                      {formatMoney(listing.priceEgp)} · نُشر {timeAgo(listing.createdAt)} · {formatNumber(listing.viewsCount)} مشاهدة
                    </p>
                    {listing.rejectionReason ? (
                      <p className="mt-1 rounded bg-red-50 px-2 py-1 text-[11px] text-red-600">سبب الرفض السابق: {listing.rejectionReason}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button type="button" className="btn-ghost btn-sm" onClick={() => setDetail(listing)}>
                      <Eye size={13} />
                      تفاصيل
                    </button>
                    {['pending_review', 'rejected'].includes(listing.status) ? (
                      <button
                        type="button"
                        className="btn-primary btn-sm"
                        disabled={busy}
                        onClick={() => runAction(() => api.post(`/platform/market/listings/${listing.id}/approve`), 'تم اعتماد الإعلان ونشره')}
                      >
                        {busy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                        اعتماد
                      </button>
                    ) : null}
                    {['pending_review', 'active', 'rejected'].includes(listing.status) ? (
                      <button
                        type="button"
                        className="btn-secondary btn-sm text-red-600"
                        disabled={busy}
                        onClick={() => {
                          setReason('');
                          setRejectFor(listing);
                        }}
                      >
                        <XCircle size={13} />
                        رفض
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* تفاصيل الإعلان للمراجعة */}
      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title="تفاصيل الإعلان" size="lg">
        {detail ? (
          <div className="space-y-4">
            {detail.images.length ? (
              <div className="grid grid-cols-3 gap-2">
                {detail.images.map((image) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={image.fileId} src={image.url} alt="" className="h-28 w-full rounded-lg border border-ink-100 object-cover" />
                ))}
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge className={LISTING_STATUS_STYLES[detail.effectiveStatus] ?? ''}>
                {LISTING_STATUS_LABELS[detail.effectiveStatus] ?? detail.effectiveStatus}
              </Badge>
              <Badge>{detail.scope === 'public' ? 'سوق عام' : 'سوق داخلي'}</Badge>
              <Badge className={CONDITION_STYLES[detail.condition] ?? ''}>{CONDITION_LABELS[detail.condition] ?? detail.condition}</Badge>
            </div>
            <div>
              <h3 className="text-lg font-bold text-ink-900">{detail.title}</h3>
              <p className="mt-1 text-xs text-ink-500">{specLine(detail)}</p>
              <p className="mt-2 text-2xl font-bold text-brand-800 num">{formatMoney(detail.priceEgp)}</p>
              <p className="text-xs text-ink-500">
                {detail.negotiable ? 'قابل للتفاوض' : 'سعر نهائي'} — الكمية {formatNumber(detail.quantity)}
              </p>
            </div>
            {detail.description ? <p className="whitespace-pre-wrap rounded-lg bg-ink-50 p-3 text-sm leading-relaxed text-ink-700">{detail.description}</p> : null}
            <div className="grid gap-2 rounded-lg border border-ink-100 p-3 text-xs sm:grid-cols-2">
              <p>
                <span className="text-ink-400">المركز: </span>
                <span className="font-semibold text-ink-700">{detail.seller.organizationName}</span>
              </p>
              <p>
                <span className="text-ink-400">الفرع: </span>
                <span className="font-semibold text-ink-700">{detail.seller.branchName || '—'}</span>
              </p>
              <p>
                <span className="text-ink-400">التواصل: </span>
                <span className="font-semibold text-ink-700" dir="ltr">
                  {detail.contact.phone || '—'}
                </span>
              </p>
              <p>
                <span className="text-ink-400">الموقع: </span>
                <span className="font-semibold text-ink-700">{locationLine(detail) || '—'}</span>
              </p>
              <p>
                <span className="text-ink-400">ينتهي: </span>
                <span className="font-semibold text-ink-700">{formatDate(detail.expiresAt)}</span>
              </p>
              <p>
                <span className="text-ink-400">أُنشئ: </span>
                <span className="font-semibold text-ink-700">{formatDate(detail.createdAt)}</span>
              </p>
            </div>
            {detail.rejectionReason ? (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">سبب الرفض السابق: {detail.rejectionReason}</p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2 border-t border-ink-100 pt-3">
              {['pending_review', 'rejected'].includes(detail.status) ? (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy}
                  onClick={() => runAction(() => api.post(`/platform/market/listings/${detail.id}/approve`), 'تم اعتماد الإعلان ونشره')}
                >
                  <CheckCircle2 size={15} />
                  اعتماد ونشر
                </button>
              ) : null}
              {['pending_review', 'active', 'rejected'].includes(detail.status) ? (
                <button
                  type="button"
                  className="btn-danger"
                  disabled={busy}
                  onClick={() => {
                    setReason('');
                    setRejectFor(detail);
                  }}
                >
                  <XCircle size={15} />
                  رفض الإعلان
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>

      {/* رفض الإعلان */}
      <Modal
        open={Boolean(rejectFor)}
        onClose={() => setRejectFor(null)}
        title="رفض الإعلان"
        subtitle={rejectFor?.title}
        size="sm"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setRejectFor(null)} disabled={busy}>
              إلغاء
            </button>
            <button
              type="button"
              className="btn-danger"
              disabled={busy || reason.trim().length < 3}
              onClick={() =>
                rejectFor &&
                runAction(
                  () => api.post(`/platform/market/listings/${rejectFor.id}/reject`, { reason: reason.trim() }),
                  'تم رفض الإعلان وإبلاغ المركز',
                )
              }
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <AlertTriangle size={15} />}
              تأكيد الرفض
            </button>
          </>
        }
      >
        <Field label="سبب الرفض" required hint="يظهر للمركز صاحب الإعلان — من 3 إلى 500 حرف">
          <textarea rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} className="input resize-y" />
        </Field>
      </Modal>
    </div>
  );
}
