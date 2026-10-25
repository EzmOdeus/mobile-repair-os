'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { mutate } from 'swr';
import { AlertTriangle, CloudOff, RefreshCw, Trash2, WifiOff } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { formatDateTime } from '@/lib/format';
import {
  flushOfflineQueue,
  getQueueSummary,
  listQueue,
  removeQueueItem,
  retryQueueItem,
  subscribeToQueue,
  type QueueSummary,
  type QueuedTicket,
} from '@/lib/offlineQueue';
import { useOnlineStatus } from '@/lib/useOnlineStatus';

export function OfflineStatus() {
  const online = useOnlineStatus();
  const toast = useToast();
  const [summary, setSummary] = useState<QueueSummary>({ pending: 0, failed: 0, total: 0 });
  const [items, setItems] = useState<QueuedTicket[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);

  const refresh = useCallback(() => {
    setSummary(getQueueSummary());
    setItems(listQueue());
  }, []);

  useEffect(() => {
    refresh();
    return subscribeToQueue(refresh);
  }, [refresh]);

  const sync = useCallback(
    async (manual: boolean) => {
      if (syncingRef.current) return;
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        if (manual) toast.warning('لا يوجد اتصال بالإنترنت');
        return;
      }

      syncingRef.current = true;
      setSyncing(true);
      try {
        const result = await flushOfflineQueue();
        refresh();
        if (result.synced > 0) {
          toast.success(
            result.synced === 1
              ? 'تمت مزامنة تذكرة واحدة بنجاح'
              : `تمت مزامنة ${result.synced} تذاكر بنجاح`,
          );
          void mutate((key) => typeof key === 'string' && key.startsWith('/tickets'));
        } else if (manual && result.failed > 0) {
          toast.warning('بعض التذاكر تحتاج مراجعة قبل المزامنة');
          setPanelOpen(true);
        } else if (manual && result.remaining > 0) {
          toast.error('تعذرت المزامنة — سيُعاد المحاولة تلقائيًا');
        } else if (manual) {
          toast.info('لا توجد تذاكر بانتظار المزامنة');
        }
      } catch {
        if (manual) toast.error('تعذرت مزامنة الطابور');
      } finally {
        syncingRef.current = false;
        setSyncing(false);
      }
    },
    [refresh, toast],
  );

  // مزامنة تلقائية عند عودة الاتصال وعند وجود عناصر معلّقة
  useEffect(() => {
    if (!online || summary.pending === 0) return;
    const firstTry = window.setTimeout(() => void sync(false), 1_500);
    const interval = window.setInterval(() => void sync(false), 45_000);
    return () => {
      window.clearTimeout(firstTry);
      window.clearInterval(interval);
    };
  }, [online, summary.pending, sync]);

  const lastError = items.find((item) => item.lastError)?.lastError ?? null;

  if (summary.total === 0 && online) return null;

  const tone = !online
    ? 'border-amber-200 bg-amber-50 text-amber-900'
    : summary.failed > 0
      ? 'border-red-200 bg-red-50 text-red-800'
      : 'border-sky-200 bg-sky-50 text-sky-900';

  return (
    <>
      <div className={`mb-4 flex flex-wrap items-center gap-3 rounded-xl border px-3.5 py-2.5 text-xs ${tone}`}>
        <span className="flex items-center gap-2 font-semibold">
          {online ? <CloudOff size={16} /> : <WifiOff size={16} />}
          {!online
            ? 'أنت غير متصل — الواجهة تعمل، والتذاكر الجديدة تُحفظ على هذا الجهاز.'
            : summary.failed > 0
              ? `${summary.failed} تذكرة محفوظة تحتاج مراجعة قبل الإرسال.`
              : `${summary.pending} تذكرة محفوظة بانتظار المزامنة.`}
        </span>

        {online && lastError ? (
          <span className="hidden max-w-md truncate text-[11px] opacity-75 sm:inline" title={lastError}>
            آخر خطأ: {lastError}
          </span>
        ) : null}

        <span className="ms-auto flex items-center gap-2">
          <button
            type="button"
            className="btn-secondary px-2.5 py-1 text-[11px]"
            onClick={() => setPanelOpen(true)}
          >
            عرض الطابور ({summary.total})
          </button>
          {online ? (
            <button
              type="button"
              className="btn-primary px-2.5 py-1 text-[11px]"
              onClick={() => void sync(true)}
              disabled={syncing || summary.pending === 0}
            >
              <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
              {syncing ? 'جارٍ المزامنة…' : 'مزامنة الآن'}
            </button>
          ) : null}
        </span>
      </div>

      <Modal
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        title="طابور المزامنة"
        subtitle="تذاكر أُنشئت على هذا الجهاز ولم تصل للخادم بعد"
        size="md"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setPanelOpen(false)}>
              إغلاق
            </button>
            {online ? (
              <button
                type="button"
                className="btn-primary"
                onClick={() => void sync(true)}
                disabled={syncing || summary.pending === 0}
              >
                <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />
                {syncing ? 'جارٍ المزامنة…' : 'مزامنة الآن'}
              </button>
            ) : null}
          </>
        }
      >
        {items.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-500">الطابور فارغ — كل التذاكر وصلت للخادم.</p>
        ) : (
          <div className="space-y-2.5">
            {items.map((item) => {
              const customer = (item.body.newCustomer ?? {}) as { fullName?: string; phone?: string };
              const device = (item.body.newDevice ?? {}) as { brand?: string; model?: string };
              const complaint = (item.body.intake as { complaint?: string } | undefined)?.complaint;
              return (
                <div key={item.id} className="rounded-lg border border-ink-200 bg-white p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-ink-900">
                        {customer.fullName ?? 'عميل غير محدد'}
                        {customer.phone ? <span className="ms-2 font-normal text-ink-500" dir="ltr">{customer.phone}</span> : null}
                      </p>
                      <p className="mt-0.5 text-[11px] text-ink-600">
                        {device.brand ?? ''} {device.model ?? ''}
                        {complaint ? ` — ${complaint}` : ''}
                      </p>
                      <p className="mt-1 text-[10px] text-ink-400">{formatDateTime(item.createdAt)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {item.status === 'failed' ? (
                        <span className="badge bg-red-100 text-red-700">تحتاج مراجعة</span>
                      ) : (
                        <span className="badge bg-amber-100 text-amber-800">بانتظار الإرسال</span>
                      )}
                      {item.status === 'failed' ? (
                        <button
                          type="button"
                          className="btn-ghost px-1.5 py-1 text-[11px]"
                          onClick={() => {
                            retryQueueItem(item.id);
                            refresh();
                          }}
                        >
                          <RefreshCw size={13} /> إعادة
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn-ghost px-1.5 py-1 text-[11px] text-red-600"
                        onClick={() => {
                          removeQueueItem(item.id);
                          refresh();
                        }}
                        title="حذف من الطابور"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                  {item.lastError ? (
                    <p className="mt-2 flex items-start gap-1.5 rounded-md bg-red-50 px-2 py-1.5 text-[11px] leading-relaxed text-red-700">
                      <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                      {item.lastError}
                      {item.attempts > 0 ? ` (محاولة ${item.attempts})` : ''}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </Modal>
    </>
  );
}
