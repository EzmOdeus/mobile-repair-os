'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  BatteryCharging,
  Building2,
  CalendarClock,
  CheckCircle2,
  Clock,
  Eye,
  ImagePlus,
  Loader2,
  Lock,
  MapPin,
  MessageCircle,
  Package,
  Pencil,
  Phone,
  RefreshCw,
  Send,
  ShieldCheck,
  ShoppingBag,
  Store,
  Trash2,
  XCircle,
} from 'lucide-react';
import { api, errorMessage, fetcher, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatMoney, formatNumber, timeAgo } from '@/lib/format';
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
} from '@/lib/market';
import { Badge, Card, CardHeader, EmptyState, Field, LoadingBlock, PageHeader } from '@/components/ui';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';

export default function MarketListingPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { hasPermission } = useAuth();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const canManageMarket = hasPermission('market:manage');

  const { data: listing, isLoading, error, mutate } = useSWR<MarketListing>(
    id ? `/market/listings/${id}` : null,
    fetcher,
    { refreshInterval: 45_000 },
  );

  const offers = useSWR<Paginated<MarketOffer>>(
    listing?.canManage && canManageMarket ? `/market/listings/${id}/offers?limit=100` : null,
    fetcher,
    { refreshInterval: 45_000 },
  );

  const [imageIndex, setImageIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [soldOpen, setSoldOpen] = useState(false);
  const [soldPrice, setSoldPrice] = useState('');
  const [removeOpen, setRemoveOpen] = useState(false);
  const [deleteImage, setDeleteImage] = useState<string | null>(null);
  const [decision, setDecision] = useState<{ offer: MarketOffer; action: 'accept' | 'reject' } | null>(null);
  const [decisionNote, setDecisionNote] = useState('');
  const [offerForm, setOfferForm] = useState({ amountEgp: '', quantity: '1', message: '' });
  const [offerBusy, setOfferBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setImageIndex(0);
  }, [listing?.id]);

  useEffect(() => {
    if (listing && !offerForm.amountEgp) {
      setOfferForm((f) => ({ ...f, amountEgp: String(listing.priceEgp) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing?.id]);

  async function refreshAll() {
    await Promise.all([mutate(), offers.mutate()]);
  }

  async function action(run: () => Promise<unknown>, message: string) {
    setBusy(true);
    try {
      await run();
      toast.success(message);
      await refreshAll();
      return true;
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function uploadImages(files: FileList | null) {
    if (!files?.length || !listing) return;
    const remaining = Math.max(0, 6 - listing.images.length);
    if (!remaining) {
      toast.error('الحد الأقصى 6 صور للإعلان');
      return;
    }
    const formData = new FormData();
    Array.from(files)
      .slice(0, remaining)
      .forEach((file) => formData.append('files', file));

    setBusy(true);
    try {
      await api.upload(`/market/listings/${listing.id}/images`, formData);
      toast.success('تمت إضافة الصور. الإعلان العام العائد للمراجعة سيُعاد للمراجعة.');
      await refreshAll();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function submitOffer(event: React.FormEvent) {
    event.preventDefault();
    if (!listing) return;
    setOfferBusy(true);
    try {
      await api.post(`/market/listings/${listing.id}/offers`, {
        amountEgp: Number(offerForm.amountEgp),
        quantity: Number(offerForm.quantity) || 1,
        message: offerForm.message.trim(),
      });
      toast.success('تم إرسال عرضك إلى البائع');
      await refreshAll();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setOfferBusy(false);
    }
  }

  async function decideOffer() {
    if (!decision) return;
    setBusy(true);
    try {
      await api.patch(`/market/offers/${decision.offer.id}`, {
        action: decision.action,
        note: decisionNote.trim(),
      });
      toast.success(decision.action === 'accept' ? 'تم قبول العرض وحجز الإعلان' : 'تم رفض العرض');
      setDecision(null);
      setDecisionNote('');
      await refreshAll();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function withdrawMyOffer() {
    if (!listing?.myOffer) return;
    setBusy(true);
    try {
      await api.patch(`/market/offers/${listing.myOffer.id}`, { action: 'withdraw' });
      toast.success('تم سحب عرضك');
      await refreshAll();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) {
    return (
      <Card>
        <LoadingBlock rows={8} />
      </Card>
    );
  }

  if (error || !listing) {
    return (
      <Card>
        <EmptyState
          title="تعذر عرض الإعلان"
          description={error ? errorMessage(error) : 'الإعلان غير موجود أو لم يعد متاحًا.'}
          icon={<ShoppingBag size={26} />}
          action={
            <Link href="/market" className="btn-secondary btn-sm">
              العودة للسوق
            </Link>
          }
        />
      </Card>
    );
  }

  const status = listing.effectiveStatus || listing.status;
  const canEdit = listing.canManage && !['reserved', 'sold', 'removed'].includes(listing.status);
  // البيع يمكن تأكيده بعد الحجز أيضًا — وهو المسار الطبيعي بعد قبول عرض
  const canMarkSold = listing.canManage && ['active', 'reserved'].includes(listing.status);
  const canOffer =
    canManageMarket &&
    status === 'active' &&
    !listing.isOwnOrg &&
    listing.kind === 'sell' &&
    !listing.myOffer;
  const canOfferInternal = canManageMarket && status === 'active' && listing.isOwnOrg && listing.scope === 'internal' && !listing.myOffer;
  const activeImage = listing.images[imageIndex];

  return (
    <div>
      <PageHeader
        title={listing.title}
        breadcrumb={
          <Link href="/market" className="inline-flex items-center gap-1 hover:text-brand-700">
            <ArrowRight size={12} />
            ماركت بلس
          </Link>
        }
        subtitle={specLine(listing)}
        actions={
          <>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => {
                void refreshAll();
                toast.success('تم تحديث البيانات');
              }}
            >
              <RefreshCw size={14} />
              تحديث
            </button>
            {canEdit ? (
              <>
                <button type="button" className="btn-secondary btn-sm" onClick={() => setEditOpen(true)}>
                  <Pencil size={14} />
                  تعديل
                </button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => fileInput.current?.click()} disabled={busy || listing.images.length >= 6}>
                  <ImagePlus size={14} />
                  صور
                </button>
                <button type="button" className="btn-danger btn-sm" onClick={() => setRemoveOpen(true)} disabled={busy || status === 'reserved'}>
                  <Trash2 size={14} />
                  حذف
                </button>
              </>
            ) : null}
            {canMarkSold ? (
              <button type="button" className="btn-primary btn-sm" onClick={() => setSoldOpen(true)} disabled={busy}>
                <BadgeCheck size={14} />
                تم البيع
              </button>
            ) : null}
            {listing.canManage && ['sold', 'reserved'].includes(listing.status) ? (
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={busy}
                onClick={() => action(() => api.post(`/market/listings/${listing.id}/reopen`), 'تم إعادة فتح الإعلان')}
              >
                <RefreshCw size={14} />
                إعادة فتح
              </button>
            ) : null}
          </>
        }
      />

      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
        onChange={(e) => void uploadImages(e.target.files)}
      />

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <Badge className={LISTING_STATUS_STYLES[status] ?? ''}>{LISTING_STATUS_LABELS[status] ?? status}</Badge>
        <Badge className={listing.scope === 'internal' ? 'bg-brand-50 text-brand-700 border-brand-200' : 'bg-sky-50 text-sky-700 border-sky-200'}>
          {SCOPE_LABELS[listing.scope]}
        </Badge>
        <Badge>{KIND_LABELS[listing.kind] ?? listing.kind}</Badge>
        <Badge className={CONDITION_STYLES[listing.condition] ?? ''}>{CONDITION_LABELS[listing.condition] ?? listing.condition}</Badge>
        <span className="text-xs text-ink-400">نُشر {timeAgo(listing.publishedAt ?? listing.createdAt)}</span>
      </div>

      {status === 'pending_review' ? (
        <Banner tone="amber" icon={<Clock size={18} />} title="بانتظار مراجعة المنصة">
          الإعلان العام لا يظهر لبقية المراكز حتى تعتمده إدارة المنصة. يمكنك تعديله أو إضافة صور الآن.
        </Banner>
      ) : null}
      {status === 'rejected' ? (
        <Banner tone="red" icon={<AlertTriangle size={18} />} title="تم رفض الإعلان">
          {listing.rejectionReason || 'عدّل بيانات الإعلان وأعد حفظه ليُرسل للمراجعة من جديد.'}
        </Banner>
      ) : null}
      {status === 'expired' ? (
        <Banner tone="ink" icon={<CalendarClock size={18} />} title="انتهت مدة الإعلان">
          يمكنك تعديل الإعلان لتمديد النشر 30 يومًا إضافية، أو إعادة نشره من زر تعديل.
        </Banner>
      ) : null}
      {listing.status === 'reserved' ? (
        <Banner tone="sky" icon={<Lock size={18} />} title="الإعلان محجوز">
          تم قبول أحد العروض وحجز الجهاز. تواصل مع المشتري لإتمام التسليم والدفع خارج النظام، ثم أكّد البيع.
        </Banner>
      ) : null}
      {listing.status === 'sold' ? (
        <Banner tone="green" icon={<CheckCircle2 size={18} />} title="تم إتمام البيع">
          سعر البيع: {formatMoney(listing.soldPriceEgp)} — بتاريخ {formatDate(listing.soldAt)}.
        </Banner>
      ) : null}
      {listing.status === 'removed' ? (
        <Banner tone="ink" icon={<XCircle size={18} />} title="الإعلان محذوف">
          {listing.removedReason || 'تم إغلاق الإعلان وإلغاء العروض المعلّقة.'}
        </Banner>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card className="overflow-hidden">
            <div className="relative flex aspect-[16/10] items-center justify-center bg-gradient-to-br from-ink-100 to-ink-50">
              {activeImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={activeImage.url} alt={listing.title} className="h-full w-full object-contain" />
              ) : (
                <div className="flex flex-col items-center gap-2 text-ink-300">
                  <Package size={52} />
                  <p className="text-xs">لا توجد صور بعد</p>
                </div>
              )}
              {listing.isOwnOrg ? (
                <Badge className="absolute top-3 right-3 bg-ink-900/75 text-white border-transparent">إعلان مركزك</Badge>
              ) : null}
            </div>
            {listing.images.length ? (
              <div className="flex flex-wrap gap-2 border-t border-ink-100 p-3">
                {listing.images.map((image, index) => (
                  <div key={image.fileId} className="relative">
                    <button
                      type="button"
                      onClick={() => setImageIndex(index)}
                      className={
                        index === imageIndex
                          ? 'block h-16 w-16 overflow-hidden rounded-lg border-2 border-brand-600'
                          : 'block h-16 w-16 overflow-hidden rounded-lg border border-ink-200 hover:border-brand-300'
                      }
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={image.url} alt="" className="h-full w-full object-cover" />
                    </button>
                    {canEdit ? (
                      <button
                        type="button"
                        className="absolute -top-1.5 -left-1.5 rounded-full bg-red-600 p-1 text-white shadow hover:bg-red-700"
                        title="حذف الصورة"
                        onClick={() => setDeleteImage(image.fileId)}
                      >
                        <XCircle size={12} />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </Card>

          <Card>
            <CardHeader title="المواصفات" icon={<Package size={18} />} />
            <div className="grid gap-x-6 gap-y-3 p-4 sm:grid-cols-2">
              <Spec label="الفئة" value={CATEGORY_LABELS[listing.category] ?? listing.category} />
              <Spec label="الماركة والموديل" value={`${listing.brand} ${listing.model}`} />
              <Spec label="السعة" value={listing.storage || '—'} />
              <Spec label="الرام" value={listing.ram || '—'} />
              <Spec label="اللون" value={listing.color || '—'} />
              <Spec label="الحالة" value={CONDITION_LABELS[listing.condition] ?? listing.condition} />
              {listing.batteryHealth !== null ? (
                <Spec label="صحة البطارية" value={`${formatNumber(listing.batteryHealth)}%`} icon={<BatteryCharging size={12} />} />
              ) : null}
              <Spec label="الضمان" value={listing.warrantyDays ? `${formatNumber(listing.warrantyDays)} يوم` : 'بدون ضمان'} />
              <Spec label="الكمية" value={formatNumber(listing.quantity)} />
              <Spec label="المشاهدات" value={formatNumber(listing.viewsCount)} icon={<Eye size={12} />} />
              <Spec label="العروض" value={formatNumber(listing.offersCount)} icon={<MessageCircle size={12} />} />
              <Spec label="تاريخ النشر" value={formatDate(listing.publishedAt ?? listing.createdAt)} />
              <Spec label="ينتهي في" value={formatDate(listing.expiresAt)} icon={<CalendarClock size={12} />} />
            </div>
            {listing.includes.length ? (
              <div className="border-t border-ink-100 px-4 py-3">
                <p className="mb-1.5 text-xs font-semibold text-ink-500">الملحقات المرفقة</p>
                <div className="flex flex-wrap gap-1.5">
                  {listing.includes.map((item) => (
                    <Badge key={item}>{item}</Badge>
                  ))}
                </div>
              </div>
            ) : null}
            {listing.description ? (
              <div className="border-t border-ink-100 px-4 py-3">
                <p className="mb-1.5 text-xs font-semibold text-ink-500">الوصف</p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-700">{listing.description}</p>
              </div>
            ) : null}
          </Card>

          {listing.canManage && canManageMarket ? (
            <Card>
              <CardHeader
                title="العروض الواردة"
                subtitle={offers.data ? `${offers.data.meta.total} عرض` : 'عروض الشراء على هذا الإعلان'}
                icon={<MessageCircle size={18} />}
                action={
                  <button type="button" className="btn-ghost btn-sm" onClick={() => void offers.mutate()}>
                    <RefreshCw size={13} />
                    تحديث
                  </button>
                }
              />
              {offers.isLoading ? (
                <LoadingBlock rows={3} />
              ) : offers.error ? (
                <div className="card-pad text-sm text-red-700">{errorMessage(offers.error)}</div>
              ) : !offers.data?.items.length ? (
                <EmptyState title="لا توجد عروض بعد" description="عندما يقدّم مركز آخر عرضًا سيظهر هنا مع بيانات التواصل." icon={<Send size={22} />} />
              ) : (
                <div className="divide-y divide-ink-100">
                  {offers.data.items.map((offer) => (
                    <div key={offer.id} className="p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-48 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-sm font-bold text-ink-800">{offer.buyerOrganizationName || offer.buyerName}</span>
                            <Badge className={OFFER_STATUS_STYLES[offer.status] ?? ''}>{OFFER_STATUS_LABELS[offer.status] ?? offer.status}</Badge>
                            <span className="text-[11px] text-ink-400">{timeAgo(offer.createdAt)}</span>
                          </div>
                          <p className="mt-1 text-xs text-ink-500">
                            {offer.buyerName}
                            {offer.buyerPhone ? ` — ${offer.buyerPhone}` : ''}
                          </p>
                          {offer.message ? <p className="mt-1.5 rounded-lg bg-ink-50 px-2.5 py-1.5 text-xs leading-relaxed text-ink-600">{offer.message}</p> : null}
                          {offer.decisionNote ? <p className="mt-1 text-[11px] text-ink-400">ملاحظة القرار: {offer.decisionNote}</p> : null}
                        </div>
                        <div className="text-left">
                          <p className="text-lg font-bold text-brand-800 num">{formatMoney(offer.amountEgp)}</p>
                          <p className="text-[11px] text-ink-400">الكمية: {formatNumber(offer.quantity)} من {formatNumber(listing.quantity)}</p>
                          {offer.canAccept || offer.canReject ? (
                            <div className="mt-2 flex justify-end gap-1.5">
                              <button
                                type="button"
                                className="btn-primary btn-sm"
                                onClick={() => {
                                  setDecisionNote('');
                                  setDecision({ offer, action: 'accept' });
                                }}
                              >
                                <CheckCircle2 size={13} />
                                قبول
                              </button>
                              <button
                                type="button"
                                className="btn-secondary btn-sm text-red-600"
                                onClick={() => {
                                  setDecisionNote('');
                                  setDecision({ offer, action: 'reject' });
                                }}
                              >
                                <XCircle size={13} />
                                رفض
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          <Card>
            <div className="p-4">
              <p className="text-xs font-semibold text-ink-500">السعر المطلوب</p>
              <p className="mt-1 text-3xl font-bold text-brand-800 num">{formatMoney(listing.priceEgp)}</p>
              <p className="mt-1 text-xs text-ink-500">
                {listing.negotiable ? 'قابل للتفاوض' : 'سعر نهائي'} — الكمية {formatNumber(listing.quantity)}
              </p>
              {listing.kind === 'wanted' ? (
                <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-amber-700">
                  هذا إعلان «مطلوب»: البائع هو من يتقدم بعرض.
                </p>
              ) : null}

              {listing.myOffer ? (
                <div className="mt-3 rounded-lg border border-ink-200 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-bold text-ink-700">عرضك الحالي</p>
                    <Badge className={OFFER_STATUS_STYLES[listing.myOffer.status] ?? ''}>
                      {OFFER_STATUS_LABELS[listing.myOffer.status] ?? listing.myOffer.status}
                    </Badge>
                  </div>
                  <p className="mt-1 text-lg font-bold text-ink-800 num">{formatMoney(listing.myOffer.amountEgp)}</p>
                  {listing.myOffer.decisionNote ? <p className="mt-1 text-xs text-ink-500">{listing.myOffer.decisionNote}</p> : null}
                  {listing.myOffer.canWithdraw ? (
                    <button type="button" className="btn-secondary btn-sm mt-2 w-full text-red-600" disabled={busy} onClick={() => void withdrawMyOffer()}>
                      سحب العرض
                    </button>
                  ) : null}
                  {listing.myOffer.status === 'accepted' ? (
                    <p className="mt-2 rounded-lg bg-emerald-50 px-2.5 py-2 text-xs text-emerald-700">
                      تم قبول عرضك. تواصل مع البائع على {listing.contact.phone || 'رقم التواصل'} لإتمام التسليم والدفع خارج النظام.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {canOffer || canOfferInternal ? (
                <form onSubmit={submitOffer} className="mt-3 space-y-2.5 border-t border-ink-100 pt-3">
                  <p className="text-xs font-bold text-ink-700">قدّم عرض شراء</p>
                  <Field label="قيمة العرض (ج.م)" required>
                    <input
                      required
                      type="number"
                      min={1}
                      step="0.01"
                      value={offerForm.amountEgp}
                      onChange={(e) => setOfferForm((f) => ({ ...f, amountEgp: e.target.value }))}
                      className="input"
                    />
                  </Field>
                  <Field label="الكمية">
                    <input
                      type="number"
                      min={1}
                      max={listing.quantity}
                      value={offerForm.quantity}
                      onChange={(e) => setOfferForm((f) => ({ ...f, quantity: e.target.value }))}
                      className="input"
                    />
                  </Field>
                  <Field label="رسالة للبائع">
                    <textarea
                      rows={2}
                      maxLength={1000}
                      value={offerForm.message}
                      onChange={(e) => setOfferForm((f) => ({ ...f, message: e.target.value }))}
                      className="input resize-y"
                      placeholder="أضف أي تفاصيل عن العرض…"
                    />
                  </Field>
                  <button type="submit" className="btn-primary w-full" disabled={offerBusy}>
                    {offerBusy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                    إرسال العرض
                  </button>
                </form>
              ) : listing.isOwnOrg && listing.scope === 'public' ? (
                <p className="mt-3 rounded-lg bg-ink-50 px-2.5 py-2 text-xs text-ink-500">هذا إعلان مركزك — لا يمكن تقديم عرض عليه.</p>
              ) : !listing.isOwnOrg && status !== 'active' ? (
                <p className="mt-3 rounded-lg bg-ink-50 px-2.5 py-2 text-xs text-ink-500">الإعلان لم يعد متاحًا لاستقبال عروض.</p>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardHeader title="البائع" icon={<Store size={18} />} />
            <div className="space-y-2.5 p-4 text-sm">
              <p className="font-bold text-ink-800">{listing.seller.organizationName}</p>
              {listing.seller.branchName ? (
                <p className="flex items-center gap-1.5 text-xs text-ink-500">
                  <Building2 size={13} />
                  {listing.seller.branchName}
                </p>
              ) : null}
              {listing.contact.name ? (
                <p className="text-xs text-ink-500">
                  جهة التواصل: <span className="font-semibold text-ink-700">{listing.contact.name}</span>
                </p>
              ) : null}
              {listing.contact.phone ? (
                <a href={`tel:${listing.contact.phone}`} className="btn-secondary btn-sm w-full" dir="ltr">
                  <Phone size={13} />
                  {listing.contact.phone}
                </a>
              ) : null}
              {listing.contact.whatsapp ? (
                <a
                  href={`https://wa.me/${listing.contact.whatsapp.replace(/^0/, '20')}`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-primary btn-sm w-full"
                >
                  <MessageCircle size={13} />
                  واتساب
                </a>
              ) : null}
              {locationLine(listing) ? (
                <p className="flex items-start gap-1.5 border-t border-ink-100 pt-2.5 text-xs text-ink-500">
                  <MapPin size={13} className="mt-0.5 shrink-0" />
                  {locationLine(listing)}
                </p>
              ) : null}
              {listing.isOwnOrg ? (
                <p className="rounded-lg bg-brand-50 px-2.5 py-2 text-center text-[11px] font-semibold text-brand-700">
                  هذا الإعلان تابع لمركزك
                </p>
              ) : null}
            </div>
          </Card>

          <Card className="card-pad">
            <p className="flex items-center gap-1.5 text-xs font-bold text-ink-600">
              <ShieldCheck size={14} />
              التعاملات خارج النظام
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-500">
              ماركت بلس للعروض والتواصل بين المراكز فقط. التسليم والدفع يتمان مباشرة بين الطرفين، ولا يتحمل النظام أي
              مسؤولية عن جودة الجهاز أو إتمام الصفقة.
            </p>
          </Card>
        </div>
      </div>

      {editOpen ? (
        <EditListingModal
          listing={listing}
          onClose={() => setEditOpen(false)}
          onSaved={async () => {
            setEditOpen(false);
            await refreshAll();
          }}
        />
      ) : null}

      <Modal
        open={soldOpen}
        onClose={() => setSoldOpen(false)}
        title="تأكيد إتمام البيع"
        size="sm"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setSoldOpen(false)} disabled={busy}>
              إلغاء
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={async () => {
                const saved = await action(
                  () =>
                    api.post(`/market/listings/${listing.id}/mark-sold`, {
                      ...(soldPrice ? { soldPriceEgp: Number(soldPrice) } : {}),
                    }),
                  'تم تسجيل بيع الإعلان',
                );
                if (saved) setSoldOpen(false);
              }}
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : null}
              تأكيد البيع
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-ink-600">سيُغلق الإعلان وتُرفض كل العروض المعلّقة. الدفع والتسليم خارج النظام.</p>
          <Field label="سعر البيع الفعلي (اختياري)" hint="اتركه فارغًا لاستخدام سعر الإعلان">
            <input type="number" min={1} value={soldPrice} onChange={(e) => setSoldPrice(e.target.value)} className="input" placeholder={String(listing.priceEgp)} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={Boolean(decision)}
        onClose={() => setDecision(null)}
        title={decision?.action === 'accept' ? 'قبول العرض وحجز الإعلان' : 'رفض العرض'}
        size="sm"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setDecision(null)} disabled={busy}>
              إلغاء
            </button>
            <button type="button" className={decision?.action === 'accept' ? 'btn-primary' : 'btn-danger'} disabled={busy} onClick={() => void decideOffer()}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : null}
              {decision?.action === 'accept' ? 'قبول العرض' : 'رفض العرض'}
            </button>
          </>
        }
      >
        {decision ? (
          <div className="space-y-3">
            <p className="text-sm text-ink-600">
              عرض من <span className="font-bold">{decision.offer.buyerOrganizationName || decision.offer.buyerName}</span> بقيمة{' '}
              <span className="font-bold num">{formatMoney(decision.offer.amountEgp)}</span>.
              {decision.action === 'accept' ? ' عند القبول سيُحجز الإعلان وتُرفض العروض الأخرى المعلّقة تلقائيًا.' : ''}
            </p>
            <Field label="ملاحظة (اختياري)">
              <textarea rows={2} maxLength={1000} value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} className="input resize-y" />
            </Field>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={removeOpen}
        title="حذف الإعلان"
        message="سيتم إغلاق الإعلان وإلغاء العروض المعلّقة. لا يمكن التراجع عن الحذف من الواجهة."
        confirmLabel="حذف الإعلان"
        onCancel={() => setRemoveOpen(false)}
        onConfirm={async () => {
          const removed = await action(() => api.del(`/market/listings/${listing.id}`), 'تم حذف الإعلان');
          if (removed) {
            setRemoveOpen(false);
            router.push('/market');
          }
        }}
        isLoading={busy}
      />

      <ConfirmDialog
        open={Boolean(deleteImage)}
        title="حذف الصورة"
        message="سيتم حذف الصورة من الإعلان. إذا كان الإعلان عامًا ونشطًا فسيعود للمراجعة."
        confirmLabel="حذف"
        onCancel={() => setDeleteImage(null)}
        onConfirm={async () => {
          const deleted = await action(() => api.del(`/market/listings/${listing.id}/images/${deleteImage}`), 'تم حذف الصورة');
          if (deleted) setDeleteImage(null);
        }}
        isLoading={busy}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* عناصر مساعدة                                                        */
/* ------------------------------------------------------------------ */

function Banner({
  tone,
  icon,
  title,
  children,
}: {
  tone: 'amber' | 'red' | 'sky' | 'green' | 'ink';
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  const tones = {
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    red: 'border-red-200 bg-red-50 text-red-800',
    sky: 'border-sky-200 bg-sky-50 text-sky-800',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    ink: 'border-ink-200 bg-ink-50 text-ink-700',
  } as const;
  return (
    <div className={`mb-4 flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm ${tones[tone]}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div>
        <p className="font-bold">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed opacity-90">{children}</p>
      </div>
    </div>
  );
}

function Spec({ label, value, icon }: { label: string; value: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2 border-b border-ink-50 pb-1.5">
      <span className="text-xs text-ink-500">{label}</span>
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-ink-800">
        {icon}
        {value}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* نافذة التعديل                                                        */
/* ------------------------------------------------------------------ */

function EditListingModal({
  listing,
  onClose,
  onSaved,
}: {
  listing: MarketListing;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    scope: listing.scope,
    kind: listing.kind,
    category: listing.category,
    title: listing.title,
    description: listing.description,
    brand: listing.brand,
    model: listing.model,
    storage: listing.storage,
    ram: listing.ram,
    color: listing.color,
    condition: listing.condition,
    batteryHealth: listing.batteryHealth === null ? '' : String(listing.batteryHealth),
    warrantyDays: String(listing.warrantyDays),
    includes: listing.includes.join('، '),
    priceEgp: String(listing.priceEgp),
    negotiable: listing.negotiable,
    quantity: String(listing.quantity),
    expiresInDays: '',
    contactName: listing.contact.name,
    contactPhone: listing.contact.phone,
    contactWhatsapp: listing.contact.whatsapp,
    governorate: listing.location.governorate,
    city: listing.location.city,
    area: listing.location.area,
  });

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((prev) => ({ ...prev, [key]: value }));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api.patch(`/market/listings/${listing.id}`, {
        scope: form.scope,
        kind: form.kind,
        category: form.category,
        title: form.title.trim(),
        description: form.description.trim(),
        brand: form.brand.trim(),
        model: form.model.trim(),
        storage: form.storage.trim(),
        ram: form.ram.trim(),
        color: form.color.trim(),
        condition: form.condition,
        batteryHealth: form.batteryHealth ? Number(form.batteryHealth) : null,
        warrantyDays: Number(form.warrantyDays) || 0,
        includes: form.includes
          .split(/[,،]/)
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 10),
        priceEgp: Number(form.priceEgp),
        negotiable: form.negotiable,
        quantity: Number(form.quantity) || 1,
        ...(form.expiresInDays ? { expiresInDays: Number(form.expiresInDays) } : {}),
        contactName: form.contactName.trim(),
        contactPhone: form.contactPhone.trim(),
        contactWhatsapp: form.contactWhatsapp.trim(),
        location: {
          governorate: form.governorate.trim(),
          city: form.city.trim(),
          area: form.area.trim(),
        },
      });
      toast.success(form.scope === 'public' ? 'تم حفظ التعديلات — الإعلان العام سيعود للمراجعة' : 'تم حفظ التعديلات');
      await onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="تعديل الإعلان" subtitle="أي تعديل في محتوى الإعلان العام النشط يعيده لمراجعة المنصة" size="lg">
      <form onSubmit={save} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="النطاق" required>
            <select value={form.scope} onChange={(e) => set('scope', e.target.value as 'public' | 'internal')} className="input">
              <option value="public">السوق العام</option>
              <option value="internal">السوق الداخلي</option>
            </select>
          </Field>
          <Field label="النوع" required>
            <select value={form.kind} onChange={(e) => set('kind', e.target.value as 'sell' | 'wanted')} className="input">
              <option value="sell">بيع</option>
              <option value="wanted">مطلوب</option>
            </select>
          </Field>
        </div>
        <Field label="العنوان" required>
          <input required minLength={5} maxLength={160} value={form.title} onChange={(e) => set('title', e.target.value)} className="input" />
        </Field>
        <Field label="الوصف">
          <textarea rows={3} maxLength={4000} value={form.description} onChange={(e) => set('description', e.target.value)} className="input resize-y" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="الفئة">
            <select value={form.category} onChange={(e) => set('category', e.target.value)} className="input">
              {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="الماركة" required>
            <input required maxLength={60} value={form.brand} onChange={(e) => set('brand', e.target.value)} className="input" />
          </Field>
          <Field label="الموديل" required>
            <input required maxLength={60} value={form.model} onChange={(e) => set('model', e.target.value)} className="input" />
          </Field>
          <Field label="السعة">
            <input maxLength={30} value={form.storage} onChange={(e) => set('storage', e.target.value)} className="input" />
          </Field>
          <Field label="الرام">
            <input maxLength={20} value={form.ram} onChange={(e) => set('ram', e.target.value)} className="input" />
          </Field>
          <Field label="اللون">
            <input maxLength={30} value={form.color} onChange={(e) => set('color', e.target.value)} className="input" />
          </Field>
          <Field label="الحالة">
            <select value={form.condition} onChange={(e) => set('condition', e.target.value)} className="input">
              {Object.entries(CONDITION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="صحة البطارية %">
            <input type="number" min={0} max={100} disabled={form.condition === 'new'} value={form.batteryHealth} onChange={(e) => set('batteryHealth', e.target.value)} className="input" />
          </Field>
          <Field label="الضمان بالأيام">
            <input type="number" min={0} max={3650} value={form.warrantyDays} onChange={(e) => set('warrantyDays', e.target.value)} className="input" />
          </Field>
          <Field label="السعر (ج.م)" required>
            <input required type="number" min={1} step="0.01" value={form.priceEgp} onChange={(e) => set('priceEgp', e.target.value)} className="input" />
          </Field>
          <Field label="الكمية">
            <input type="number" min={1} max={999} value={form.quantity} onChange={(e) => set('quantity', e.target.value)} className="input" />
          </Field>
          <Field label="تمديد الإعلان (أيام)" hint="اتركه فارغًا دون تغيير">
            <input type="number" min={1} max={180} value={form.expiresInDays} onChange={(e) => set('expiresInDays', e.target.value)} className="input" />
          </Field>
        </div>
        <Field label="الملحقات" hint="افصل بفاصلة">
          <input maxLength={300} value={form.includes} onChange={(e) => set('includes', e.target.value)} className="input" />
        </Field>
        <label className="flex items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" checked={form.negotiable} onChange={(e) => set('negotiable', e.target.checked)} className="h-4 w-4 accent-brand-700" />
          السعر قابل للتفاوض
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="اسم التواصل">
            <input maxLength={120} value={form.contactName} onChange={(e) => set('contactName', e.target.value)} className="input" />
          </Field>
          <Field label="هاتف التواصل">
            <input maxLength={20} value={form.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} className="input" />
          </Field>
          <Field label="واتساب">
            <input maxLength={20} value={form.contactWhatsapp} onChange={(e) => set('contactWhatsapp', e.target.value)} className="input" />
          </Field>
          <Field label="المحافظة">
            <input maxLength={80} value={form.governorate} onChange={(e) => set('governorate', e.target.value)} className="input" />
          </Field>
          <Field label="المدينة">
            <input maxLength={80} value={form.city} onChange={(e) => set('city', e.target.value)} className="input" />
          </Field>
          <Field label="المنطقة">
            <input maxLength={80} value={form.area} onChange={(e) => set('area', e.target.value)} className="input" />
          </Field>
        </div>
        <div className="flex justify-end gap-2 border-t border-ink-100 pt-3">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            إلغاء
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : null}
            حفظ التعديلات
          </button>
        </div>
      </form>
    </Modal>
  );
}
