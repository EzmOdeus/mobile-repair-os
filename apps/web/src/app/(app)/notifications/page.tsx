'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import Link from 'next/link';
import { Bell, CheckCheck, Mail, MessageSquare, Send } from 'lucide-react';
import { api, errorMessage, fetcher, qs } from '@/lib/api';
import { formatDateTime, timeAgo } from '@/lib/format';
import { Badge, Card, CardHeader, EmptyState, Field, LoadingBlock, PageHeader } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/lib/auth';

interface NotificationRow {
  _id: string;
  type: string;
  channel: string;
  status: string;
  subject?: string;
  body: string;
  toPhone?: string;
  trackingUrl?: string;
  variables?: Record<string, string>;
  readAt?: string | null;
  sentAt?: string | null;
  createdAt: string;
  errorMessage?: string;
  customerId?: { _id?: string; fullName: string; phone: string } | null;
  ticketId?: { _id?: string; ticketNumber: string } | null;
  listingId?: { _id?: string; title: string; status: string } | null;
}

/** الصفحة التي يفتحها الإشعار عند الضغط عليه */
function notificationHref(notification: NotificationRow): string | null {
  const listingId = notification.listingId?._id ?? notification.variables?.listingId;
  if (listingId) return `/market/${listingId}`;
  if (notification.type.startsWith('market_')) return '/market?tab=offers';
  if (notification.ticketId?._id) return `/tickets/${notification.ticketId._id}`;
  if (notification.type.startsWith('subscription_')) return '/settings';
  if (notification.type.startsWith('warranty_')) return '/warranty';
  if (notification.type.startsWith('payment_')) return '/invoices';
  if (notification.type === 'low_stock') return '/inventory?tab=lowStock';
  if (notification.customerId?._id) return `/customers/${notification.customerId._id}`;
  return null;
}

const TYPE_LABELS: Record<string, string> = {
  device_received: 'تم استلام الجهاز',
  diagnosis_completed: 'انتهى التشخيص',
  estimate_ready: 'عرض السعر جاهز',
  approval_required: 'مطلوب موافقة العميل',
  approval_decided: 'قرار العميل على العرض',
  repair_started: 'بدأ الإصلاح',
  waiting_for_part: 'بانتظار قطعة',
  ready_for_pickup: 'جاهز للاستلام',
  delivered: 'تم التسليم',
  payment_received: 'تم التحصيل',
  payment_due: 'مبلغ مستحق',
  warranty_reminder: 'تذكير بالضمان',
  warranty_claim_received: 'مطالبة ضمان جديدة',
  review_request: 'طلب تقييم',
  sla_warning: 'تحذير موعد التسليم',
  sla_breach: 'تجاوز موعد التسليم',
  internal_assignment: 'تعيين مهمة',
  low_stock: 'مخزون منخفض',
  ticket_cancelled: 'إلغاء الطلب',
  subscription_expiring: 'اشتراك على وشك الانتهاء',
  subscription_expired: 'انتهاء الاشتراك',
  subscription_activated: 'تفعيل اشتراك',
  subscription_renewal_rejected: 'رفض طلب تجديد',
  market_offer_received: 'عرض شراء جديد',
  market_offer_accepted: 'قبول عرض',
  market_offer_rejected: 'رفض عرض',
  market_listing_approved: 'اعتماد إعلان',
  market_listing_rejected: 'رفض إعلان',
  custom: 'رسالة مخصصة',
};

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'واتساب',
  sms: 'رسالة نصية',
  email: 'بريد',
  in_app: 'داخلي',
  push: 'إشعار',
  print: 'طباعة',
};

const STATUS_LABELS: Record<string, string> = {
  queued: 'في الطابور',
  sent: 'أُرسل',
  delivered: 'تم التسليم',
  read: 'تم القراءة',
  failed: 'فشل',
  cancelled: 'ملغي',
};

export default function NotificationsPage() {
  const toast = useToast();
  const { hasPermission } = useAuth();
  const [page, setPage] = useState(1);
  const [channelFilter, setChannelFilter] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);

  const key = `/notifications${qs({
    channel: channelFilter || undefined,
    unread: unreadOnly ? 'true' : undefined,
    page,
    limit: 30,
  })}`;
  // نفس مفتاح عدّاد الجرس في AppShell — نُحدّثه فور تعليم القراءة
  const badgeKey = '/notifications?channel=in_app&limit=1';

  const { data, error, isLoading } = useSWR<{
    items: NotificationRow[];
    meta: { total: number; page: number; pages: number; unreadInApp?: number };
  }>(key, fetcher, { refreshInterval: 60_000 });

  const markAllRead = async () => {
    try {
      await api.post('/notifications/read-all');
      toast.success('تم تعليم كل الإشعارات كمقروءة');
      await Promise.all([mutate(key), mutate(badgeKey)]);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const markRead = async (notification: NotificationRow) => {
    if (notification.readAt) return;
    try {
      await api.post(`/notifications/${notification._id}/read`);
      await Promise.all([mutate(key), mutate(badgeKey)]);
    } catch {
      // فشل تعليم القراءة لا يمنع الانتقال لصفحة الإشعار
    }
  };

  return (
    <div>
      <PageHeader
        title="الإشعارات"
        subtitle="كل ما أُرسل للعملاء (WhatsApp/SMS) والإشعارات الداخلية"
        actions={
          <>
            <button type="button" className="btn-secondary" onClick={markAllRead}>
              <CheckCheck size={16} /> تعليم الكل كمقروء
            </button>
            {hasPermission('notification:send') ? (
              <button type="button" className="btn-primary" onClick={() => setSendOpen(true)}>
                <Send size={16} /> إرسال رسالة
              </button>
            ) : null}
          </>
        }
      />

      <Card className="mb-4 card-pad">
        <div className="flex flex-wrap items-center gap-3">
          <select
            className="input w-auto"
            value={channelFilter}
            onChange={(e) => {
              setChannelFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">كل القنوات</option>
            {Object.entries(CHANNEL_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>

          <label className="flex items-center gap-2 text-xs text-ink-600">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-ink-300"
              checked={unreadOnly}
              onChange={(e) => {
                setUnreadOnly(e.target.checked);
                setPage(1);
              }}
            />
            غير المقروءة فقط
          </label>

          <span className="ms-auto text-xs text-ink-500">
            {data?.meta.total ?? 0} إشعار
            {data?.meta.unreadInApp ? ` · ${data.meta.unreadInApp} داخلي غير مقروء` : ''}
          </span>
        </div>
      </Card>

      {error ? <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">{errorMessage(error)}</Card> : null}

      <Card>
        {isLoading ? (
          <LoadingBlock rows={7} />
        ) : (
          <div className="divide-y divide-ink-100">
            {data?.items?.length ? (
              data.items.map((notification) => {
                const href = notificationHref(notification);
                const content = (
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className="border-brand-200 bg-brand-50 text-brand-700">
                          {TYPE_LABELS[notification.type] ?? notification.type}
                        </Badge>
                        <Badge className="border-ink-200 bg-ink-50 text-ink-600">
                          {notification.channel === 'whatsapp' ? (
                            <MessageSquare size={11} />
                          ) : notification.channel === 'email' ? (
                            <Mail size={11} />
                          ) : (
                            <Bell size={11} />
                          )}{' '}
                          {CHANNEL_LABELS[notification.channel] ?? notification.channel}
                        </Badge>
                        <Badge
                          className={
                            notification.status === 'failed'
                              ? 'border-red-200 bg-red-50 text-red-700'
                              : notification.status === 'read'
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : 'border-ink-200 bg-ink-50 text-ink-600'
                          }
                        >
                          {STATUS_LABELS[notification.status] ?? notification.status}
                        </Badge>
                        {notification.customerId ? (
                          <span className="text-[11px] text-ink-500">{notification.customerId.fullName}</span>
                        ) : null}
                        {notification.ticketId ? (
                          <span className="text-[11px] text-brand-700" dir="ltr">
                            {notification.ticketId.ticketNumber}
                          </span>
                        ) : null}
                        {notification.listingId ? (
                          <span className="max-w-[16rem] truncate text-[11px] text-brand-700">{notification.listingId.title}</span>
                        ) : null}
                      </div>

                      <p className="mt-1.5 text-xs leading-relaxed text-ink-700">{notification.body}</p>

                      {notification.errorMessage ? (
                        <p className="mt-1 text-[11px] text-red-600">خطأ: {notification.errorMessage}</p>
                      ) : null}
                    </div>

                    <div className="shrink-0 text-left">
                      <p className="text-[11px] text-ink-400">{timeAgo(notification.createdAt)}</p>
                      {notification.toPhone ? (
                        <p className="num text-[11px] text-ink-400" dir="ltr">
                          {notification.toPhone}
                        </p>
                      ) : null}
                    </div>
                  </div>
                );

                const rowClass = `block px-4 py-3 transition ${notification.readAt ? '' : 'bg-brand-50/30'} ${
                  href ? 'cursor-pointer hover:bg-brand-50/70' : ''
                }`;

                return href ? (
                  <Link
                    key={notification._id}
                    href={href}
                    className={rowClass}
                    onClick={() => void markRead(notification)}
                  >
                    {content}
                  </Link>
                ) : (
                  <div key={notification._id} className={rowClass}>
                    {content}
                  </div>
                );
              })
            ) : (
              <EmptyState title="لا توجد إشعارات" description="ستظهر هنا كل الرسائل الصادرة للعملاء" icon={<Bell size={22} />} />
            )}
          </div>
        )}

        {data && data.meta.pages > 1 ? (
          <div className="flex items-center justify-between border-t border-ink-100 px-4 py-3 text-xs text-ink-600">
            <span>
              صفحة {data.meta.page} من {data.meta.pages}
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

      <SendMessageModal
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        onDone={async () => {
          setSendOpen(false);
          await mutate(key);
          toast.success('تم إرسال الرسالة (مسجلة في سجل الإشعارات)');
        }}
        onError={(message) => toast.error(message)}
      />

      <p className="mt-4 text-[11px] text-ink-400">
        ملاحظة: في وضع التطوير (WHATSAPP_MODE=log) تُسجَّل الرسائل بدون إرسال فعلي لمزوّد خارجي. آخر تحديث:{' '}
        {formatDateTime(new Date())}
      </p>
    </div>
  );
}

function SendMessageModal({
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
  const [form, setForm] = useState({ phone: '', channel: 'whatsapp', body: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async () => {
    if (!form.phone.trim() || !form.body.trim()) {
      onError('رقم الهاتف ونص الرسالة مطلوبان');
      return;
    }
    setIsSubmitting(true);
    try {
      await api.post('/notifications/send', {
        channel: form.channel,
        toPhone: form.phone,
        body: form.body,
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
      title="إرسال رسالة للعميل"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            إلغاء
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={isSubmitting}>
            {isSubmitting ? 'جارٍ الإرسال…' : 'إرسال'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="رقم الهاتف" required>
            <input
              className="input"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              dir="ltr"
              placeholder="01012345678"
            />
          </Field>
          <Field label="القناة">
            <select className="input" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
              <option value="whatsapp">واتساب</option>
              <option value="sms">رسالة نصية</option>
              <option value="email">بريد إلكتروني</option>
              <option value="in_app">إشعار داخلي</option>
            </select>
          </Field>
        </div>
        <Field label="نص الرسالة" required>
          <textarea
            className="input min-h-[5rem]"
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
            placeholder="مثال: جهازك جاهز للاستلام، المبلغ المستحق 450 جنيه."
          />
        </Field>
      </div>
    </Modal>
  );
}

void CardHeader;
