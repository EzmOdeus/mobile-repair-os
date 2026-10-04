'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import Link from 'next/link';
import { CheckCircle2, HardHat, Pause, Play, Plus, Wrench } from 'lucide-react';
import { api, errorMessage, fetcher } from '@/lib/api';
import { formatDateTime, formatDuration, timeAgo } from '@/lib/format';
import { PRIORITY_COLORS, PRIORITY_LABELS, STATUS_COLORS, statusLabel, type Priority, type RepairStatus } from '@/lib/constants';
import { Badge, Card, CardHeader, EmptyState, Field, LoadingBlock, PageHeader, StatCard } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/lib/auth';

interface Job {
  _id: string;
  ticketNumber: string;
  status: RepairStatus;
  statusLabel: string;
  priority: Priority;
  priorityLabel: string;
  isOverdue: boolean;
  minutesOpen: number;
  createdAt: string;
  assignedAt?: string | null;
  intake?: { complaint?: string };
  diagnosis?: { summary?: string; faultCategory?: string };
  customerId?: { fullName: string; phone: string } | null;
  deviceId?: { brand: string; model: string; color?: string } | null;
  cost?: { totalFinalEgp?: number; totalQuotedEgp?: number };
  workLogs?: { startedAt: string; endedAt?: string | null; minutes?: number; note?: string }[];
}

interface JobsResponse {
  jobs: Job[];
  summary: { total: number; urgent: number; overdue: number; inRepair: number };
}

export default function TechnicianPage() {
  const toast = useToast();
  const { user, hasPermission } = useAuth();
  const [noteOpen, setNoteOpen] = useState<Job | null>(null);
  const [noteText, setNoteText] = useState('');
  const [partOpen, setPartOpen] = useState<Job | null>(null);

  const key = '/tickets/my-jobs';
  const { data, error, isLoading } = useSWR<JobsResponse>(key, fetcher, { refreshInterval: 30_000 });

  const logWork = async (job: Job, action: 'start' | 'pause') => {
    try {
      await api.post(`/tickets/${job._id}/work-log`, { action });
      toast.success(action === 'start' ? 'بدأ تسجيل الوقت' : 'تم إيقاف تسجيل الوقت');
      await mutate(key);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const addNote = async () => {
    if (!noteOpen || !noteText.trim()) return;
    try {
      await api.post(`/tickets/${noteOpen._id}/notes`, { body: noteText, category: 'repair_step' });
      toast.success('تمت إضافة الملاحظة');
      setNoteOpen(null);
      setNoteText('');
      await mutate(key);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const openWorkLog = data?.jobs.find((job) => job.workLogs?.some((log) => !log.endedAt));
  const totalLoggedMinutes =
    data?.jobs.reduce(
      (acc, job) => acc + (job.workLogs?.reduce((sum, log) => sum + (log.minutes ?? 0), 0) ?? 0),
      0,
    ) ?? 0;

  return (
    <div>
      <PageHeader
        title="شاشة الفني"
        subtitle={`${user?.fullName ?? ''}${user?.technicianProfile?.workbench ? ` · ${user.technicianProfile.workbench}` : ''}`}
        actions={
          openWorkLog ? (
            <button type="button" className="btn-danger" onClick={() => void logWork(openWorkLog, 'pause')}>
              <Pause size={16} /> إيقاف تسجيل الوقت
            </button>
          ) : null
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="مهامي النشطة" value={data?.summary.total ?? 0} icon={<Wrench size={18} />} tone="info" />
        <StatCard label="عاجلة" value={data?.summary.urgent ?? 0} icon={<HardHat size={18} />} tone="danger" />
        <StatCard
          label="متأخرة عن الموعد"
          value={data?.summary.overdue ?? 0}
          icon={<Pause size={18} />}
          tone={(data?.summary.overdue ?? 0) > 0 ? 'warning' : 'success'}
        />
        <StatCard label="وقت مسجل (تراكمي)" value={formatDuration(totalLoggedMinutes)} icon={<Play size={18} />} tone="default" />
      </div>

      {error ? <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">{errorMessage(error)}</Card> : null}

      {isLoading ? (
        <Card>
          <LoadingBlock rows={6} />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data?.jobs?.length ? (
            data.jobs.map((job) => {
              const hasOpenLog = job.workLogs?.some((log) => !log.endedAt);
              const loggedMinutes = job.workLogs?.reduce((sum, log) => sum + (log.minutes ?? 0), 0) ?? 0;

              return (
                <Card key={job._id} className={job.isOverdue ? 'border-red-300' : undefined}>
                  <div className="flex items-start justify-between gap-3 border-b border-ink-100 px-4 py-3">
                    <div className="min-w-0">
                      <Link href={`/tickets/${job._id}`} className="text-sm font-bold text-brand-700 hover:underline" dir="ltr">
                        {job.ticketNumber}
                      </Link>
                      <p className="mt-0.5 truncate text-xs text-ink-600">
                        {job.deviceId ? `${job.deviceId.brand} ${job.deviceId.model}` : '—'}
                        {job.deviceId?.color ? ` · ${job.deviceId.color}` : ''}
                      </p>
                      <p className="truncate text-[11px] text-ink-400">{job.customerId?.fullName ?? ''}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <Badge className={STATUS_COLORS[job.status]}>{job.statusLabel}</Badge>
                      <Badge className={PRIORITY_COLORS[job.priority]}>{PRIORITY_LABELS[job.priority]}</Badge>
                    </div>
                  </div>

                  <div className="card-pad space-y-3">
                    <div>
                      <p className="label">شكوى العميل</p>
                      <p className="text-sm leading-relaxed text-ink-700">{job.intake?.complaint ?? '—'}</p>
                    </div>

                    {job.diagnosis?.summary ? (
                      <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-2.5">
                        <p className="text-[11px] font-bold text-indigo-800">التشخيص</p>
                        <p className="mt-0.5 text-xs text-indigo-900">{job.diagnosis.summary}</p>
                      </div>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-ink-500">
                      <span>عمر التذكرة: {formatDuration(job.minutesOpen)}</span>
                      {loggedMinutes ? <span>وقت مسجل: {formatDuration(loggedMinutes)}</span> : null}
                      <span>استُلمت: {timeAgo(job.createdAt)}</span>
                      {hasOpenLog ? (
                        <span className="flex items-center gap-1 font-bold text-emerald-700">
                          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-600" /> جارٍ تسجيل الوقت
                        </span>
                      ) : null}
                      {job.isOverdue ? <span className="font-bold text-red-600">تجاوز الموعد</span> : null}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {hasOpenLog ? (
                        <button type="button" className="btn-secondary text-xs" onClick={() => void logWork(job, 'pause')}>
                          <Pause size={14} /> إيقاف الوقت
                        </button>
                      ) : (
                        <button type="button" className="btn-secondary text-xs" onClick={() => void logWork(job, 'start')}>
                          <Play size={14} /> بدء الوقت
                        </button>
                      )}

                      <button type="button" className="btn-secondary text-xs" onClick={() => setNoteOpen(job)}>
                        <Plus size={14} /> ملاحظة
                      </button>

                      {hasPermission('part:manage') ? (
                        <button type="button" className="btn-secondary text-xs" onClick={() => setPartOpen(job)}>
                          <Plus size={14} /> طلب قطعة
                        </button>
                      ) : null}

                      <Link href={`/tickets/${job._id}`} className="btn-primary text-xs">
                        <CheckCircle2 size={14} /> فتح التذكرة
                      </Link>
                    </div>
                  </div>
                </Card>
              );
            })
          ) : (
            <Card className="lg:col-span-2">
              <EmptyState
                title="لا توجد مهام مسندة لك"
                description="عند إسناد تذكرة لك ستظهر هنا مع كل التفاصيل التي تحتاجها"
                icon={<Wrench size={22} />}
              />
            </Card>
          )}
        </div>
      )}

      <Modal
        open={Boolean(noteOpen)}
        onClose={() => setNoteOpen(null)}
        title={`ملاحظة على ${noteOpen?.ticketNumber ?? ''}`}
        size="md"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setNoteOpen(null)}>
              إلغاء
            </button>
            <button type="button" className="btn-primary" onClick={addNote} disabled={!noteText.trim()}>
              حفظ الملاحظة
            </button>
          </>
        }
      >
        <Field label="الملاحظة">
          <textarea
            className="input min-h-[5rem]"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="مثال: تم فك البوردة وفحص مسار الشحن — التأكسد في المنطقة العلوية"
          />
        </Field>
      </Modal>

      <RequestPartModal
        job={partOpen}
        onClose={() => setPartOpen(null)}
        onDone={async () => {
          setPartOpen(null);
          await mutate(key);
          toast.success('تمت إضافة القطعة للتذكرة وحجزها من المخزون');
        }}
        onError={(message) => toast.error(message)}
      />

      <p className="mt-4 text-[11px] text-ink-400">آخر تحديث: {formatDateTime(new Date())}</p>
    </div>
  );
}

function RequestPartModal({
  job,
  onClose,
  onDone,
  onError,
}: {
  job: Job | null;
  onClose: () => void;
  onDone: () => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: parts } = useSWR<{ items: { _id: string; name: string; sku: string; availableQty?: number; stock?: { onHand: number; reserved: number } }[] }>(
    job
      ? `/parts?limit=25${search ? `&q=${encodeURIComponent(search)}` : ''}${
          job.deviceId ? `&deviceModel=${encodeURIComponent(job.deviceId.model)}` : ''
        }`
      : null,
    fetcher,
  );

  if (!job) return null;

  const add = async (partId: string) => {
    setIsSubmitting(true);
    try {
      await api.post(`/tickets/${job._id}/parts`, {
        partId,
        quantity: Number(quantity) || 1,
        status: 'reserved',
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
      open
      onClose={onClose}
      title={`طلب قطعة — ${job.ticketNumber}`}
      subtitle={job.deviceId ? `${job.deviceId.brand} ${job.deviceId.model}` : undefined}
      size="lg"
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <input
            className="input"
            placeholder="ابحث عن قطعة…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <input
            className="input w-24"
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            title="الكمية"
          />
        </div>

        <div className="max-h-80 space-y-2 overflow-y-auto">
          {parts?.items?.length ? (
            parts.items.map((part) => {
              const available = part.availableQty ?? Math.max(0, (part.stock?.onHand ?? 0) - (part.stock?.reserved ?? 0));
              return (
                <button
                  key={part._id}
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => void add(part._id)}
                  className="flex w-full items-center justify-between rounded-lg border border-ink-200 px-3 py-2.5 text-right transition hover:border-brand-400 hover:bg-brand-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium text-ink-800">{part.name}</span>
                    <span className="block text-[11px] text-ink-400" dir="ltr">
                      {part.sku}
                    </span>
                  </span>
                  <Badge
                    className={
                      available > 0
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-red-200 bg-red-50 text-red-700'
                    }
                  >
                    متاح {available}
                  </Badge>
                </button>
              );
            })
          ) : (
            <p className="py-6 text-center text-xs text-ink-400">لا توجد قطع مطابقة</p>
          )}
        </div>

        <p className="rounded-lg bg-ink-50 p-2.5 text-[11px] text-ink-500">
          القطعة تُحجز من مخزون الفرع فورًا وتظهر في تكلفة التذكرة، وعند تركيبها تُسجَّل كاستهلاك فعلي.
        </p>
      </div>
    </Modal>
  );
}

void CardHeader;
