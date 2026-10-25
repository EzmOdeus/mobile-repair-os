'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import useSWR from 'swr';
import {
  Building2,
  Clock,
  Eye,
  Inbox,
  MapPin,
  MessageCircle,
  Package,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShoppingBag,
  Store,
  Tag,
  TrendingUp,
} from 'lucide-react';
import { api, errorMessage, fetcher, qs, type Paginated } from '@/lib/api';
import { formatMoney, formatNumber, timeAgo } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import {
  CATEGORY_LABELS,
  CONDITION_LABELS,
  CONDITION_STYLES,
  KIND_LABELS,
  LISTING_STATUS_LABELS,
  LISTING_STATUS_STYLES,
  OFFER_STATUS_LABELS,
  OFFER_STATUS_STYLES,
  SCOPE_LABELS,
  locationLine,
  specLine,
  type MarketListing,
  type MarketOffer,
  type MarketStats,
} from '@/lib/market';
import { Badge, Card, CardHeader, EmptyState, LoadingBlock, PageHeader, StatCard } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';

type Tab = 'browse' | 'mine' | 'offers';

const EMPTY_FILTERS = {
  q: '',
  condition: '',
  category: '',
  kind: '',
  governorate: '',
  minPrice: '',
  maxPrice: '',
  sort: 'newest',
};

export default function MarketPage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const canManage = hasPermission('market:manage');

  const [tab, setTab] = useState<Tab>('browse');
  const [scope, setScope] = useState<'public' | 'internal'>('public');
  const [draft, setDraft] = useState(EMPTY_FILTERS);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [busyOffer, setBusyOffer] = useState<string | null>(null);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('tab');
    if (requested === 'offers' || requested === 'mine') setTab(requested);
  }, []);

  const stats = useSWR<MarketStats>('/market/stats', fetcher, { refreshInterval: 60_000 });

  const listKey =
    tab === 'browse'
      ? `/market/listings${qs({ scope, ...filters, page, limit: 12 })}`
      : tab === 'mine'
        ? '/market/my/listings?limit=50'
        : '/market/my/offers?limit=50';

  const list = useSWR<Paginated<MarketListing> | Paginated<MarketOffer>>(listKey, fetcher, {
    keepPreviousData: true,
    refreshInterval: tab === 'offers' ? 45_000 : 0,
  });

  const applyFilters = () => {
    setFilters(draft);
    setPage(1);
  };

  const resetFilters = () => {
    setDraft(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    setPage(1);
  };

  async function withdrawOffer(offer: MarketOffer) {
    setBusyOffer(offer.id);
    try {
      await api.patch(`/market/offers/${offer.id}`, { action: 'withdraw' });
      toast.success('تم سحب العرض');
      void list.mutate();
      void stats.mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyOffer(null);
    }
  }

  const me = stats.data;

  return (
    <div>
      <PageHeader
        title="ماركت بلس"
        subtitle="سوق عام بين مراكز الصيانة وسوق داخلي بين فروع مركزك — بيع وشراء وعروض وتواصل"
        actions={
          <>
            <Link href="/market/prices" className="btn-secondary">
              <TrendingUp size={15} />
              بورصة الأسعار
            </Link>
            {canManage ? (
              <Link href="/market/new" className="btn-primary">
                <Plus size={15} />
                إعلان جديد
              </Link>
            ) : null}
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="إعلانات السوق العام"
          value={formatNumber(me?.activePublic)}
          hint={`بانتظار المراجعة: ${formatNumber(me?.pendingReview)}`}
          icon={<Store size={20} />}
          tone="info"
        />
        <StatCard
          label="إعلانات السوق الداخلي"
          value={formatNumber(me?.activeInternal)}
          hint="بين فروع نفس المركز"
          icon={<Building2 size={20} />}
          tone="success"
        />
        <StatCard
          label="عروض واردة معلّقة"
          value={formatNumber(me?.pendingOffersReceived)}
          hint="على إعلاناتك"
          icon={<Inbox size={20} />}
          tone="warning"
        />
        <StatCard
          label="عروض أرسلتها"
          value={formatNumber(me?.pendingOffersSent)}
          hint="بانتظار رد البائع"
          icon={<Send size={20} />}
        />
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-4 py-3">
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ['browse', 'تصفح السوق'],
                ['mine', 'إعلاناتي'],
                ['offers', 'عروضي'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={tab === value ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'}
                onClick={() => {
                  setTab(value);
                  setPage(1);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => {
              void stats.mutate();
              void list.mutate();
            }}
          >
            <RefreshCw size={14} />
            تحديث
          </button>
        </div>

        {tab === 'browse' ? (
          <>
            <div className="flex flex-wrap items-center gap-1.5 border-b border-ink-100 px-4 py-2.5">
              {(['public', 'internal'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={
                    scope === value
                      ? 'rounded-full bg-brand-50 px-3 py-1.5 text-xs font-bold text-brand-800'
                      : 'rounded-full px-3 py-1.5 text-xs font-semibold text-ink-500 hover:bg-ink-50'
                  }
                  onClick={() => {
                    setScope(value);
                    setPage(1);
                  }}
                >
                  {value === 'public' ? 'السوق العام — بين المراكز' : 'السوق الداخلي — بين الفروع'}
                </button>
              ))}
            </div>

            <div className="border-b border-ink-100 px-4 py-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="relative min-w-48 flex-1">
                  <Search size={15} className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-ink-400" />
                  <input
                    value={draft.q}
                    onChange={(e) => setDraft((f) => ({ ...f, q: e.target.value }))}
                    onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
                    placeholder="ابحث بالاسم أو الماركة أو الموديل…"
                    className="input pr-9"
                  />
                </div>
                <select
                  value={draft.condition}
                  onChange={(e) => setDraft((f) => ({ ...f, condition: e.target.value }))}
                  className="input w-auto"
                >
                  <option value="">كل الحالات</option>
                  {Object.entries(CONDITION_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
                <select
                  value={draft.category}
                  onChange={(e) => setDraft((f) => ({ ...f, category: e.target.value }))}
                  className="input w-auto"
                >
                  <option value="">كل الفئات</option>
                  {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
                <select
                  value={draft.kind}
                  onChange={(e) => setDraft((f) => ({ ...f, kind: e.target.value }))}
                  className="input w-auto"
                >
                  <option value="">بيع ومطلوب</option>
                  <option value="sell">بيع</option>
                  <option value="wanted">مطلوب</option>
                </select>
                <input
                  value={draft.governorate}
                  onChange={(e) => setDraft((f) => ({ ...f, governorate: e.target.value }))}
                  placeholder="المحافظة"
                  className="input w-28"
                />
                <input
                  value={draft.minPrice}
                  onChange={(e) => setDraft((f) => ({ ...f, minPrice: e.target.value }))}
                  type="number"
                  min={0}
                  placeholder="من سعر"
                  className="input w-24"
                />
                <input
                  value={draft.maxPrice}
                  onChange={(e) => setDraft((f) => ({ ...f, maxPrice: e.target.value }))}
                  type="number"
                  min={0}
                  placeholder="إلى سعر"
                  className="input w-24"
                />
                <select
                  value={draft.sort}
                  onChange={(e) => setDraft((f) => ({ ...f, sort: e.target.value }))}
                  className="input w-auto"
                >
                  <option value="newest">الأحدث</option>
                  <option value="oldest">الأقدم</option>
                  <option value="price_asc">السعر الأقل</option>
                  <option value="price_desc">السعر الأعلى</option>
                  <option value="popular">الأكثر مشاهدة</option>
                </select>
                <button type="button" className="btn-primary btn-sm" onClick={applyFilters}>
                  <Search size={14} />
                  بحث
                </button>
                <button type="button" className="btn-ghost btn-sm" onClick={resetFilters}>
                  مسح
                </button>
              </div>
            </div>
          </>
        ) : null}

        {list.isLoading ? (
          <LoadingBlock rows={6} />
        ) : list.error ? (
          <div className="card-pad text-sm text-red-700">تعذر تحميل البيانات: {errorMessage(list.error)}</div>
        ) : tab === 'browse' ? (
          <BrowseGrid data={list.data as Paginated<MarketListing> | undefined} />
        ) : tab === 'mine' ? (
          <MyListings data={list.data as Paginated<MarketListing> | undefined} canManage={canManage} />
        ) : (
          <MyOffers data={list.data as Paginated<MarketOffer> | undefined} busyOffer={busyOffer} onWithdraw={withdrawOffer} />
        )}

        {tab === 'browse' && list.data ? (
          <Pagination
            page={list.data.meta.page}
            pages={list.data.meta.pages}
            total={list.data.meta.total}
            onPage={(next) => setPage(next)}
          />
        ) : tab === 'mine' || tab === 'offers' ? (
          list.data ? <p className="border-t border-ink-100 px-4 py-2.5 text-xs text-ink-400">الإجمالي: {formatNumber(list.data.meta.total)}</p> : null
        ) : null}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* شبكة الإعلانات                                                       */
/* ------------------------------------------------------------------ */

function BrowseGrid({ data }: { data?: Paginated<MarketListing> }) {
  if (!data?.items.length) {
    return (
      <EmptyState
        title="لا توجد إعلانات مطابقة"
        description="جرّب توسيع نطاق البحث أو كن أول من ينشر إعلانًا."
        icon={<ShoppingBag size={24} />}
      />
    );
  }

  return (
    <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
      {data.items.map((listing) => (
        <Link
          key={listing.id}
          href={`/market/${listing.id}`}
          className="group overflow-hidden rounded-xl border border-ink-200 bg-white transition hover:border-brand-400 hover:shadow-md"
        >
          <div className="relative flex h-40 items-center justify-center overflow-hidden bg-gradient-to-br from-ink-100 to-ink-50">
            {listing.coverUrl ? (
              // روابط الصور موقّعة من الـAPI وليست ضمن نطاق Next/Image
              // eslint-disable-next-line @next/next/no-img-element
              <img src={listing.coverUrl} alt={listing.title} className="h-full w-full object-cover transition group-hover:scale-105" />
            ) : (
              <Package size={40} className="text-ink-300" />
            )}
            <div className="absolute top-2 right-2 flex gap-1">
              <Badge className={listing.scope === 'internal' ? 'bg-brand-50 text-brand-700 border-brand-200' : 'bg-sky-50 text-sky-700 border-sky-200'}>
                {SCOPE_LABELS[listing.scope]}
              </Badge>
              {listing.kind === 'wanted' ? <Badge className="bg-amber-50 text-amber-700 border-amber-200">مطلوب</Badge> : null}
            </div>
            {listing.isOwnOrg ? (
              <div className="absolute top-2 left-2">
                <Badge className="bg-ink-900/80 text-white border-transparent">إعلانك</Badge>
              </div>
            ) : null}
          </div>

          <div className="p-3">
            <div className="flex items-start justify-between gap-2">
              <h3 className="line-clamp-2 text-sm font-bold text-ink-800 group-hover:text-brand-700">{listing.title}</h3>
              <Badge className={CONDITION_STYLES[listing.condition] ?? ''}>{CONDITION_LABELS[listing.condition] ?? listing.condition}</Badge>
            </div>
            <p className="mt-1 truncate text-xs text-ink-500">{specLine(listing)}</p>

            <div className="mt-2.5 flex items-end justify-between gap-2">
              <p className="text-lg font-bold text-brand-800 num">
                {formatMoney(listing.priceEgp)}
                {listing.negotiable ? <span className="mr-1 text-[10px] font-normal text-ink-400">قابل للتفاوض</span> : null}
              </p>
              <p className="text-[11px] text-ink-400">{timeAgo(listing.createdAt)}</p>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-500">
              {locationLine(listing) ? (
                <span className="inline-flex items-center gap-1">
                  <MapPin size={11} />
                  {locationLine(listing)}
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1">
                <Eye size={11} />
                {formatNumber(listing.viewsCount)}
              </span>
              <span className="inline-flex items-center gap-1">
                <MessageCircle size={11} />
                {formatNumber(listing.offersCount)} عرض
              </span>
            </div>

            <p className="mt-2 border-t border-ink-50 pt-2 text-[11px] text-ink-400">
              {listing.seller.organizationName}
              {listing.seller.branchName ? ` — ${listing.seller.branchName}` : ''}
            </p>
          </div>
        </Link>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* إعلاناتي                                                             */
/* ------------------------------------------------------------------ */

function MyListings({ data, canManage }: { data?: Paginated<MarketListing>; canManage: boolean }) {
  if (!data?.items.length) {
    return (
      <EmptyState
        title="لا توجد إعلانات لك بعد"
        description={canManage ? 'انشر أول إعلان لعرض جهاز أو طلب جهاز من مراكز أخرى.' : 'تحتاج صلاحية إدارة السوق لنشر إعلان.'}
        icon={<Tag size={24} />}
        action={
          canManage ? (
            <Link href="/market/new" className="btn-primary btn-sm">
              <Plus size={14} />
              إعلان جديد
            </Link>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="divide-y divide-ink-100">
      {data.items.map((listing) => {
        const status = listing.effectiveStatus || listing.status;
        return (
          <div key={listing.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-ink-100">
              {listing.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={listing.coverUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <Package size={20} className="text-ink-300" />
              )}
            </div>
            <div className="min-w-48 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <Link href={`/market/${listing.id}`} className="text-sm font-bold text-ink-800 hover:text-brand-700">
                  {listing.title}
                </Link>
                <Badge className={LISTING_STATUS_STYLES[status] ?? ''}>{LISTING_STATUS_LABELS[status] ?? status}</Badge>
                <Badge className={listing.scope === 'internal' ? 'bg-brand-50 text-brand-700 border-brand-200' : ''}>
                  {SCOPE_LABELS[listing.scope]}
                </Badge>
                {listing.pendingOffers ? (
                  <Badge className="bg-amber-50 text-amber-700 border-amber-200">
                    <Inbox size={10} className="ml-0.5 inline" /> {formatNumber(listing.pendingOffers)} عرض جديد
                  </Badge>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-ink-500">
                {specLine(listing)} — {formatMoney(listing.priceEgp)}
              </p>
              {status === 'rejected' && listing.rejectionReason ? (
                <p className="mt-1 text-xs text-red-600">سبب الرفض: {listing.rejectionReason}</p>
              ) : null}
            </div>
            <div className="flex items-center gap-3 text-xs text-ink-400">
              <span className="inline-flex items-center gap-1">
                <Eye size={12} /> {formatNumber(listing.viewsCount)}
              </span>
              <span className="inline-flex items-center gap-1">
                <Clock size={12} /> {timeAgo(listing.createdAt)}
              </span>
              <Link href={`/market/${listing.id}`} className="btn-secondary btn-sm">
                إدارة
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* عروضي                                                                */
/* ------------------------------------------------------------------ */

function MyOffers({
  data,
  busyOffer,
  onWithdraw,
}: {
  data?: Paginated<MarketOffer>;
  busyOffer: string | null;
  onWithdraw: (offer: MarketOffer) => void;
}) {
  if (!data?.items.length) {
    return (
      <EmptyState
        title="لا توجد عروض أرسلتها"
        description="قدّم عرضًا على إعلان من السوق العام أو الداخلي، وتابع الرد من هنا."
        icon={<Send size={24} />}
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>الإعلان</th>
            <th>قيمة عرضي</th>
            <th>سعر الإعلان</th>
            <th>البائع</th>
            <th>الحالة</th>
            <th>التاريخ</th>
            <th className="text-left">إجراء</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((offer) => (
            <tr key={offer.id}>
              <td>
                <Link href={`/market/${offer.listingId}`} className="font-semibold text-ink-800 hover:text-brand-700">
                  {offer.listing?.title || offer.listingTitle}
                </Link>
                <p className="text-[11px] text-ink-400">{SCOPE_LABELS[offer.listing?.scope ?? offer.listingScope]}</p>
              </td>
              <td className="num font-bold text-ink-800">{formatMoney(offer.amountEgp)}</td>
              <td className="num text-ink-500">{formatMoney(offer.listing?.priceEgp ?? offer.listingPriceEgp)}</td>
              <td className="text-xs text-ink-600">{offer.sellerOrganizationName}</td>
              <td>
                <Badge className={OFFER_STATUS_STYLES[offer.status] ?? ''}>{OFFER_STATUS_LABELS[offer.status] ?? offer.status}</Badge>
                {offer.decisionNote ? <p className="mt-1 text-[11px] text-ink-400">{offer.decisionNote}</p> : null}
              </td>
              <td className="text-xs text-ink-400">{timeAgo(offer.createdAt)}</td>
              <td>
                <div className="flex justify-end gap-1.5">
                  <Link href={`/market/${offer.listingId}`} className="btn-ghost btn-sm">
                    فتح الإعلان
                  </Link>
                  {offer.canWithdraw ? (
                    <button
                      type="button"
                      className="btn-ghost btn-sm text-red-600"
                      disabled={busyOffer === offer.id}
                      onClick={() => onWithdraw(offer)}
                    >
                      سحب العرض
                    </button>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ترقيم الصفحات                                                        */
/* ------------------------------------------------------------------ */

function Pagination({
  page,
  pages,
  total,
  onPage,
}: {
  page: number;
  pages: number;
  total: number;
  onPage: (page: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 px-4 py-3">
      <p className="text-xs text-ink-500">
        صفحة {formatNumber(page)} من {formatNumber(Math.max(pages, 1))} — {formatNumber(total)} إعلان
      </p>
      <div className="flex gap-1.5">
        <button type="button" className="btn-secondary btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          السابق
        </button>
        <button type="button" className="btn-secondary btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          التالي
        </button>
      </div>
    </div>
  );
}
