'use client';

import { useMemo, useState } from 'react';
import useSWR, { mutate } from 'swr';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Filter, LayoutGrid, List, Plus, Search, Wrench, AlertTriangle, User } from 'lucide-react';
import { api, errorMessage, fetcher, qs } from '@/lib/api';
import { formatMoney, formatNumber, formatDateTime, timeAgo } from '@/lib/format';
import {
  KANBAN_COLUMNS,
  PRIORITIES,
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  STATUS_COLORS,
  statusLabel,
  type Priority,
  type RepairStatus,
} from '@/lib/constants';
import { Badge, Card, EmptyState, LoadingBlock, PageHeader } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/lib/auth';

interface TicketRow {
  _id: string;
  ticketNumber: string;
  status: RepairStatus;
  statusLabel: string;
  priority: Priority;
  priorityLabel: string;
  createdAt: string;
  promisedAt?: string | null;
  cost?: { totalFinalEgp?: number; totalQuotedEgp?: number; dueEgp?: number };
  isOverdue?: boolean;
  sla?: { dueAt?: string | null; breached?: boolean };
  customerId?: { _id: string; fullName: string; phone: string; companyName?: string } | null;
  deviceId?: { _id: string; brand: string; model: string; color?: string } | null;
  assignedTechnicianId?: { fullName: string } | null;
  intake?: { complaint?: string };
}

interface BoardColumn {
  status: RepairStatus;
  label: string;
  count: number;
  tickets: TicketRow[];
}

interface BoardResponse {
  columns: BoardColumn[];
  totals: { active: number; overdue: number; unassigned: number };
}

interface ListResponse {
  items: TicketRow[];
  meta: { total: number; page: number; pages: number };
}

export default function TicketsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const { hasPermission } = useAuth();

  const [view, setView] = useState<'board' | 'list'>('board');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>(searchParams.get('status') ?? '');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [openOnly, setOpenOnly] = useState(true);
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [technicianFilter, setTechnicianFilter] = useState('');

  const listKey = `/tickets${qs({
    q: search || undefined,
    status: statusFilter || undefined,
    priority: priorityFilter || undefined,
    openOnly: openOnly ? 'true' : undefined,
    technicianId: technicianFilter || undefined,
    page,
    limit: 20,
  })}`;

  const { data: board, error: boardError, isLoading: boardLoading } = useSWR<BoardResponse>(
    view === 'board' ? '/tickets/board' : null,
    fetcher,
    { refreshInterval: 45_000 },
  );

  const { data: list, error: listError, isLoading: listLoading } = useSWR<ListResponse>(
    view === 'list' ? listKey : null,
    fetcher,
  );

  const { data: technicians } = useSWR<{ id: string; fullName: string; activeJobs: number; maxActiveJobs: number }[]>(
    hasPermission('technician:read') ? '/technicians/available' : null,
    fetcher,
  );

  const filteredColumns = useMemo(() => {
    if (!board) return [];
    return board.columns.filter((column) => KANBAN_COLUMNS.includes(column.status) || column.count > 0);
  }, [board]);

  const error = boardError ?? listError;
  const isLoading = view === 'board' ? boardLoading : listLoading;

  return (
    <div>
      <PageHeader
        title="تذاكر الصيانة"
        subtitle="لوحة العمل الكاملة: من الاستلام حتى التسليم والضمان"
        actions={
          <>
            <div className="flex items-center rounded-lg border border-ink-300 bg-white p-0.5">
              <button
                type="button"
                onClick={() => setView('board')}
                className={`btn px-2.5 py-1.5 text-xs ${view === 'board' ? 'bg-brand-700 text-white' : 'text-ink-600'}`}
              >
                <LayoutGrid size={15} /> لوحة
              </button>
              <button
                type="button"
                onClick={() => setView('list')}
                className={`btn px-2.5 py-1.5 text-xs ${view === 'list' ? 'bg-brand-700 text-white' : 'text-ink-600'}`}
              >
                <List size={15} /> قائمة
              </button>
            </div>
            {hasPermission('ticket:create') ? (
              <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
                <Plus size={16} /> تذكرة جديدة
              </button>
            ) : null}
          </>
        }
      />

      {/* أدوات التصفية */}
      <Card className="mb-4 card-pad">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="relative md:col-span-2">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              className="input pr-9"
              placeholder="ابحث برقم التذكرة أو الشكوى…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>

          <select
            className="input"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">كل الحالات</option>
            {Object.entries(STATUS_COLORS).map(([status]) => (
              <option key={status} value={status}>
                {statusLabel(status)}
              </option>
            ))}
          </select>

          <select
            className="input"
            value={priorityFilter}
            onChange={(e) => {
              setPriorityFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">كل الأولويات</option>
            {PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {PRIORITY_LABELS[priority]}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-ink-600">
            <input
              type="checkbox"
              checked={openOnly}
              onChange={(e) => {
                setOpenOnly(e.target.checked);
                setPage(1);
              }}
              className="h-4 w-4 rounded border-ink-300"
            />
            التذاكر المفتوحة فقط
          </label>

          {technicians?.length ? (
            <select
              className="input w-auto text-xs"
              value={technicianFilter}
              onChange={(e) => {
                setTechnicianFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">كل الفنيين</option>
              <option value="unassigned">بدون فني</option>
              {technicians.map((tech) => (
                <option key={tech.id} value={tech.id}>
                  {tech.fullName} ({tech.activeJobs}/{tech.maxActiveJobs})
                </option>
              ))}
            </select>
          ) : null}

          <span className="ms-auto flex items-center gap-1.5 text-xs text-ink-500">
            <Filter size={14} />
            {view === 'board'
              ? `${formatNumber(board?.totals.active ?? 0)} تذكرة نشطة · ${formatNumber(board?.totals.overdue ?? 0)} متأخرة`
              : `${formatNumber(list?.meta.total ?? 0)} نتيجة`}
          </span>
        </div>
      </Card>

      {error ? <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">{errorMessage(error)}</Card> : null}

      {isLoading ? (
        <Card>
          <LoadingBlock rows={6} />
        </Card>
      ) : view === 'board' ? (
        <div className="flex gap-3 overflow-x-auto pb-3">
          {filteredColumns.length ? (
            filteredColumns.map((column) => (
              <div key={column.status} className="flex w-[19rem] shrink-0 flex-col rounded-xl bg-ink-100/70 p-2">
                <div className="mb-2 flex items-center justify-between px-1.5">
                  <span className={`badge border ${STATUS_COLORS[column.status] ?? 'bg-ink-100 text-ink-700'}`}>
                    {column.label}
                  </span>
                  <span className="text-xs font-bold text-ink-600 num">{formatNumber(column.count)}</span>
                </div>

                <div className="flex max-h-[68vh] flex-col gap-2 overflow-y-auto px-0.5">
                  {column.tickets.length ? (
                    column.tickets.map((ticket) => (
                      <Link
                        key={ticket._id}
                        href={`/tickets/${ticket._id}`}
                        className="card block p-3 transition hover:border-brand-400 hover:shadow-md"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-xs font-bold text-ink-900" dir="ltr">
                            {ticket.ticketNumber}
                          </span>
                          <span className={`badge ${PRIORITY_COLORS[ticket.priority]}`}>
                            {PRIORITY_LABELS[ticket.priority]}
                          </span>
                        </div>

                        <p className="mt-1.5 text-xs font-semibold text-ink-700">
                          {ticket.deviceId ? `${ticket.deviceId.brand} ${ticket.deviceId.model}` : 'جهاز غير معروف'}
                        </p>
                        <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-ink-500">
                          {ticket.intake?.complaint ?? '—'}
                        </p>

                        <div className="mt-2.5 flex items-center justify-between text-[10px] text-ink-500">
                          <span className="flex items-center gap-1 truncate">
                            <User size={11} />
                            {ticket.assignedTechnicianId?.fullName ?? <span className="text-amber-600">بدون فني</span>}
                          </span>
                          <span className="shrink-0">{timeAgo(ticket.createdAt)}</span>
                        </div>

                        {ticket.isOverdue ? (
                          <p className="mt-2 flex items-center gap-1 rounded-md bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-700">
                            <AlertTriangle size={11} /> تجاوز موعد التسليم
                          </p>
                        ) : null}
                      </Link>
                    ))
                  ) : (
                    <p className="px-2 py-6 text-center text-[11px] text-ink-400">لا توجد تذاكر في هذه المرحلة</p>
                  )}
                </div>
              </div>
            ))
          ) : (
            <Card className="w-full">
              <EmptyState title="لا توجد تذاكر" description="ابدأ بإنشاء تذكرة صيانة جديدة" icon={<Wrench size={22} />} />
            </Card>
          )}
        </div>
      ) : (
        <Card>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>رقم التذكرة</th>
                  <th>العميل</th>
                  <th>الجهاز</th>
                  <th>الحالة</th>
                  <th>الأولوية</th>
                  <th>الفني</th>
                  <th>المستحق</th>
                  <th>التاريخ</th>
                </tr>
              </thead>
              <tbody>
                {list?.items?.length ? (
                  list.items.map((ticket) => (
                    <tr
                      key={ticket._id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/tickets/${ticket._id}`)}
                    >
                      <td className="font-bold text-ink-900" dir="ltr">
                        {ticket.ticketNumber}
                      </td>
                      <td>
                        <p className="font-medium text-ink-800">{ticket.customerId?.fullName ?? '—'}</p>
                        <p className="text-xs text-ink-500" dir="ltr">
                          {ticket.customerId?.phone ?? ''}
                        </p>
                      </td>
                      <td>
                        {ticket.deviceId ? (
                          <>
                            <p className="text-ink-700">
                              {ticket.deviceId.brand} {ticket.deviceId.model}
                            </p>
                            <p className="text-xs text-ink-500">{ticket.deviceId.color ?? ''}</p>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        <Badge className={STATUS_COLORS[ticket.status] ?? ''}>{ticket.statusLabel}</Badge>
                        {ticket.isOverdue ? (
                          <span className="mt-1 block text-[10px] font-semibold text-red-600">متأخرة</span>
                        ) : null}
                      </td>
                      <td>
                        <span className={`badge ${PRIORITY_COLORS[ticket.priority]}`}>{ticket.priorityLabel}</span>
                      </td>
                      <td className="text-xs">{ticket.assignedTechnicianId?.fullName ?? '—'}</td>
                      <td className="num text-xs">
                        {formatMoney(ticket.cost?.totalFinalEgp ?? ticket.cost?.totalQuotedEgp ?? 0)}
                      </td>
                      <td className="text-xs text-ink-500">{formatDateTime(ticket.createdAt)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8}>
                      <EmptyState title="لا نتائج مطابقة" icon={<Search size={22} />} />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {list && list.meta.pages > 1 ? (
            <div className="flex items-center justify-between border-t border-ink-100 px-4 py-3 text-xs text-ink-600">
              <span>
                صفحة {list.meta.page} من {list.meta.pages}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  السابق
                </button>
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  disabled={page >= list.meta.pages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  التالي
                </button>
              </div>
            </div>
          ) : null}
        </Card>
      )}

      <CreateTicketModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={async (ticketId) => {
          setCreateOpen(false);
          await Promise.all([mutate('/tickets/board'), mutate(listKey)]);
          toast.success('تم إنشاء التذكرة بنجاح');
          router.push(`/tickets/${ticketId}`);
        }}
      />
    </div>
  );
}

/* ====================== نموذج إنشاء تذكرة ====================== */

interface CustomerLookup {
  found: boolean;
  customer: { _id: string; fullName: string; phone: string; companyName?: string } | null;
  devices: { _id: string; brand: string; model: string; color?: string; imei?: string }[];
}

function CreateTicketModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (ticketId: string) => void;
}) {
  const toast = useToast();
  const [step, setStep] = useState<'customer' | 'device' | 'intake'>('customer');
  const [phone, setPhone] = useState('');
  const [lookup, setLookup] = useState<CustomerLookup | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);

  const [customerForm, setCustomerForm] = useState({ fullName: '', phone: '', companyName: '' });
  const [deviceForm, setDeviceForm] = useState({
    brand: '',
    model: '',
    color: '',
    storage: '',
    imei: '',
    conditionOnIntake: 'good',
  });
  const [intake, setIntake] = useState({
    complaint: '',
    complaintCategory: 'other',
    priority: 'normal',
    accessories: [] as string[],
    customerAcknowledged: false,
    dataLossDisclaimerAccepted: false,
    devicePasswordProvided: false,
    estimatedDays: 3,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [useNewCustomer, setUseNewCustomer] = useState(false);
  const [useNewDevice, setUseNewDevice] = useState(false);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [customerError, setCustomerError] = useState<string | null>(null);

  /** هل للعميل أجهزة مسجلة فعلًا؟ (يرفع أخطاء النوع مع مصفوفة قد تكون undefined) */
  const registeredDevices = lookup?.devices ?? [];
  const hasRegisteredDevices = registeredDevices.length > 0;

  /**
   * الانتقال بين الخطوات مع تحقق فعلي.
   * السبب: كانت مؤشرات الخطوات قابلة للنقر مباشرة، فيصل المستخدم لشاشة الاستلام
   * بدون تحديد جهاز ثم يُرفض عند الحفظ. الآن كل انتقال يتحقق من الخطوة التي يتركها.
   */
  const goToStep = (target: 'customer' | 'device' | 'intake') => {
    const order: Record<'customer' | 'device' | 'intake', number> = { customer: 0, device: 1, intake: 2 };
    setDeviceError(null);
    setCustomerError(null);

    // الرجوع للخلف مسموح دائمًا
    if (order[target] < order[step]) {
      setStep(target);
      return;
    }

    // التحقق من خطوة العميل قبل تجاوزها
    if (target !== 'customer') {
      if (!selectedCustomerId && !useNewCustomer) {
        setCustomerError('ابحث برقم الهاتف أو أنشئ عميلًا جديدًا أولًا');
        setStep('customer');
        return;
      }
      if (useNewCustomer && (!customerForm.fullName.trim() || !customerForm.phone.trim())) {
        setCustomerError('اكتب اسم العميل ورقم هاتفه');
        setStep('customer');
        return;
      }
    }

    // التحقق من خطوة الجهاز قبل الوصول للاستلام
    if (target === 'intake') {
      if (useNewDevice || !hasRegisteredDevices) {
        if (!deviceForm.brand.trim() || !deviceForm.model.trim()) {
          setDeviceError('اكتب ماركة وموديل الجهاز');
          setStep('device');
          return;
        }
      } else if (!selectedDeviceId) {
        setDeviceError('اختر جهازًا من القائمة، أو اضغط «جهاز جديد» لتسجيل جهاز آخر');
        setStep('device');
        return;
      }
    }

    setStep(target);
  };

  const doLookup = async () => {
    if (!phone.trim()) {
      setCustomerError('اكتب رقم الهاتف أولًا');
      return;
    }
    setIsLookingUp(true);
    setCustomerError(null);
    try {
      const result = await api.get<CustomerLookup>(`/customers/lookup${qs({ phone })}`);
      setLookup(result);
      if (result.found && result.customer) {
        setSelectedCustomerId(result.customer._id);
        setUseNewCustomer(false);
        // نختار الجهاز تلقائيًا لو للعميل جهاز واحد فقط — يقلّل خطوة يدوية بلا داعٍ
        const devices = result.devices ?? [];
        setSelectedDeviceId(devices.length === 1 ? devices[0]!._id : null);
        setUseNewDevice(false);
        setStep('device');
      } else {
        setUseNewCustomer(true);
        setSelectedCustomerId(null);
        setSelectedDeviceId(null);
        setUseNewDevice(true);
        setCustomerForm((prev) => ({ ...prev, phone }));
        setStep('customer');
      }
    } catch (err) {
      setCustomerError(errorMessage(err));
      toast.error(errorMessage(err));
    } finally {
      setIsLookingUp(false);
    }
  };

  const close = () => {
    onClose();
    setStep('customer');
    setPhone('');
    setLookup(null);
    setSelectedCustomerId(null);
    setSelectedDeviceId(null);
    setUseNewCustomer(false);
    setUseNewDevice(false);
    setDeviceError(null);
    setCustomerError(null);
    setCustomerForm({ fullName: '', phone: '', companyName: '' });
    setDeviceForm({ brand: '', model: '', color: '', storage: '', imei: '', conditionOnIntake: 'good' });
    setIntake({
      complaint: '',
      complaintCategory: 'other',
      priority: 'normal',
      accessories: [],
      customerAcknowledged: false,
      dataLossDisclaimerAccepted: false,
      devicePasswordProvided: false,
      estimatedDays: 3,
    });
  };

  const submit = async () => {
    setDeviceError(null);
    setCustomerError(null);

    // نفس تحقق `goToStep` — فلا يمكن الوصول للحفظ بحالة ناقصة
    if (useNewCustomer) {
      if (!customerForm.fullName.trim() || !customerForm.phone.trim()) {
        setCustomerError('اكتب اسم العميل ورقم هاتفه');
        setStep('customer');
        toast.error('بيانات العميل ناقصة');
        return;
      }
    } else if (!selectedCustomerId) {
      setCustomerError('ابحث برقم الهاتف أو أنشئ عميلًا جديدًا');
      setStep('customer');
      toast.error('حدد العميل');
      return;
    }

    if (useNewDevice || !hasRegisteredDevices) {
      if (!deviceForm.brand.trim() || !deviceForm.model.trim()) {
        setDeviceError('اكتب ماركة وموديل الجهاز');
        setStep('device');
        toast.error('بيانات الجهاز ناقصة');
        return;
      }
    } else if (!selectedDeviceId) {
      setDeviceError('اختر جهازًا من القائمة، أو اضغط «جهاز جديد» لتسجيل جهاز آخر');
      setStep('device');
      toast.error('حدد الجهاز');
      return;
    }

    if (!intake.complaint.trim()) {
      setStep('intake');
      toast.error('اكتب شكوى العميل');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        priority: intake.priority,
        source: 'walk_in',
        intake: {
          complaint: intake.complaint,
          complaintCategory: intake.complaintCategory,
          accessories: intake.accessories,
          customerAcknowledged: intake.customerAcknowledged,
          dataLossDisclaimerAccepted: intake.dataLossDisclaimerAccepted,
          devicePasswordProvided: intake.devicePasswordProvided,
          estimatedDeliveryAt: new Date(Date.now() + intake.estimatedDays * 86_400_000).toISOString(),
        },
      };

      if (useNewCustomer) {
        payload.newCustomer = {
          fullName: customerForm.fullName,
          phone: customerForm.phone,
          companyName: customerForm.companyName,
          type: customerForm.companyName ? 'company' : 'individual',
        };
      } else {
        payload.customerId = selectedCustomerId;
      }

      if (useNewDevice || !hasRegisteredDevices) {
        payload.newDevice = {
          brand: deviceForm.brand,
          model: deviceForm.model,
          color: deviceForm.color,
          storage: deviceForm.storage,
          imei: deviceForm.imei,
          conditionOnIntake: deviceForm.conditionOnIntake,
        };
      } else {
        payload.deviceId = selectedDeviceId;
      }

      const created = await api.post<{ ticket: { _id: string } }>('/tickets', payload);
      onCreated(created.ticket._id);
      close();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="تذكرة صيانة جديدة"
      subtitle="الاستقبال الرقمي: بيانات العميل، الجهاز، والأدلة"
      size="lg"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={close}>
            إلغاء
          </button>
          {step !== 'intake' ? (
            <button
              type="button"
              className="btn-primary"
              onClick={() => goToStep(step === 'customer' ? 'device' : 'intake')}
            >
              التالي
            </button>
          ) : (
            <button type="button" className="btn-primary" onClick={submit} disabled={isSubmitting}>
              {isSubmitting ? 'جارٍ الحفظ…' : 'إنشاء التذكرة'}
            </button>
          )}
        </>
      }
    >
      {/* خطوات — قابلة للنقر لكن كل انتقال يمر بتحقق `goToStep` */}
      <div className="mb-4 flex items-center gap-2 text-xs">
        {(['customer', 'device', 'intake'] as const).map((s, index) => {
          const order: Record<'customer' | 'device' | 'intake', number> = { customer: 0, device: 1, intake: 2 };
          const isDone = order[s] < order[step];
          return (
            <div key={s} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => goToStep(s)}
                className={`flex h-6 w-6 items-center justify-center rounded-full font-bold transition ${
                  step === s
                    ? 'bg-brand-700 text-white'
                    : isDone
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-ink-200 text-ink-600'
                }`}
                aria-current={step === s ? 'step' : undefined}
              >
                {isDone ? '✓' : index + 1}
              </button>
              <button
                type="button"
                onClick={() => goToStep(s)}
                className={`transition ${step === s ? 'font-bold text-ink-800' : 'text-ink-500 hover:text-ink-700'}`}
              >
                {s === 'customer' ? 'العميل' : s === 'device' ? 'الجهاز' : 'الاستلام'}
              </button>
              {index < 2 ? <span className="text-ink-300">—</span> : null}
            </div>
          );
        })}
      </div>

      {step === 'customer' ? (
        <div className="space-y-4">
          <div className="flex gap-2">
            <input
              className="input"
              placeholder="رقم موبايل العميل (01xxxxxxxxx)"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              dir="ltr"
            />
            <button type="button" className="btn-primary shrink-0" onClick={doLookup} disabled={isLookingUp}>
              {isLookingUp ? '…' : 'بحث'}
            </button>
          </div>

          {lookup?.found && lookup.customer ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-sm font-bold text-emerald-800">
                عميل مسجل: {lookup.customer.fullName}
                {lookup.customer.companyName ? ` — ${lookup.customer.companyName}` : ''}
              </p>
              <p className="mt-0.5 text-xs text-emerald-700">
                لديه {lookup.devices.length} جهاز مسجل — اختر الجهاز في الخطوة التالية.
              </p>
            </div>
          ) : null}

          {lookup && !lookup.found ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              لا يوجد عميل بهذا الرقم — املأ البيانات لإنشاء عميل جديد.
            </div>
          ) : null}

          {customerError ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
              {customerError}
            </p>
          ) : null}

          {useNewCustomer || !lookup?.found ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block sm:col-span-1">
                <span className="label">اسم العميل *</span>
                <input
                  className="input"
                  value={customerForm.fullName}
                  onChange={(e) => setCustomerForm({ ...customerForm, fullName: e.target.value })}
                  placeholder="مثال: أحمد عبدالله"
                />
              </label>
              <label className="block">
                <span className="label">رقم الموبايل *</span>
                <input
                  className="input"
                  value={customerForm.phone || phone}
                  onChange={(e) => setCustomerForm({ ...customerForm, phone: e.target.value })}
                  dir="ltr"
                  placeholder="01012345678"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="label">اسم الشركة (اختياري)</span>
                <input
                  className="input"
                  value={customerForm.companyName}
                  onChange={(e) => setCustomerForm({ ...customerForm, companyName: e.target.value })}
                  placeholder="لعملاء الشركات والتجار"
                />
              </label>
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 'device' ? (
        <div className="space-y-4">
          {/*
            ملاحظة: كان اختيار «جهاز جديد» ممكنًا فقط عبر checkbox يظهر أسفل القائمة،
            وكانت خطوة الجهاز قابلة للتخطي عبر مؤشرات الخطوات القابلة للنقر — فيصل
            المستخدم لشاشة الاستلام بلا جهاز ثم يُرفض عند الحفظ برسالة «حدد الجهاز».
            الآن: الاختيار صريح في الأعلى، ونوع الجهازين ظاهر دائمًا مع تحقق عند الانتقال.
          */}
          {hasRegisteredDevices ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  setUseNewDevice(false);
                }}
                className={`rounded-lg border p-3 text-right text-xs transition ${
                  !useNewDevice ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-500' : 'border-ink-200 hover:border-brand-300'
                }`}
              >
                <span className="block font-bold text-ink-800">جهاز مسجل للعميل</span>
                <span className="block text-ink-500">{lookup?.devices.length ?? 0} جهاز متاح للاختيار</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setUseNewDevice(true);
                  setSelectedDeviceId(null);
                }}
                className={`rounded-lg border p-3 text-right text-xs transition ${
                  useNewDevice ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-500' : 'border-ink-200 hover:border-brand-300'
                }`}
              >
                <span className="block font-bold text-ink-800">جهاز جديد</span>
                <span className="block text-ink-500">لم يُسجَّل من قبل عند العميل</span>
              </button>
            </div>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              لا يوجد جهاز مسجل لهذا العميل — سجّل الجهاز الجديد بالبيانات التالية.
            </div>
          )}

          {hasRegisteredDevices && !useNewDevice ? (
            <div>
              <p className="label">
                اختر جهازًا مسجلًا <span className="text-red-600">*</span>
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {lookup!.devices.map((device) => (
                  <button
                    key={device._id}
                    type="button"
                    onClick={() => setSelectedDeviceId(device._id)}
                    className={`rounded-lg border p-3 text-right text-xs transition ${
                      selectedDeviceId === device._id
                        ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-500'
                        : deviceError && useNewDevice === false
                          ? 'border-red-200 hover:border-brand-300'
                          : 'border-ink-200 hover:border-brand-300'
                    }`}
                  >
                    <span className="block font-bold text-ink-800">
                      {device.brand} {device.model}
                    </span>
                    <span className="block text-ink-500" dir="ltr">
                      {device.imei ? `IMEI: ${device.imei}` : device.color ?? ''}
                    </span>
                    {selectedDeviceId === device._id ? (
                      <span className="mt-1 block font-bold text-brand-700">✓ محدد</span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {!hasRegisteredDevices || useNewDevice ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="label">الماركة *</span>
                <input
                  className={`input ${deviceError && !deviceForm.brand ? 'border-red-400' : ''}`}
                  list="brands"
                  value={deviceForm.brand}
                  onChange={(e) => setDeviceForm({ ...deviceForm, brand: e.target.value })}
                  placeholder="Samsung"
                />
                <datalist id="brands">
                  {['Samsung', 'Xiaomi', 'Oppo', 'Realme', 'Apple', 'Infinix', 'Vivo', 'Honor', 'Nokia', 'Tecno'].map(
                    (brand) => (
                      <option key={brand} value={brand} />
                    ),
                  )}
                </datalist>
              </label>
              <label className="block">
                <span className="label">الموديل *</span>
                <input
                  className={`input ${deviceError && !deviceForm.model ? 'border-red-400' : ''}`}
                  value={deviceForm.model}
                  onChange={(e) => setDeviceForm({ ...deviceForm, model: e.target.value })}
                  placeholder="Galaxy A15"
                />
              </label>
              <label className="block">
                <span className="label">اللون</span>
                <input
                  className="input"
                  value={deviceForm.color}
                  onChange={(e) => setDeviceForm({ ...deviceForm, color: e.target.value })}
                />
              </label>
              <label className="block">
                <span className="label">المساحة</span>
                <input
                  className="input"
                  value={deviceForm.storage}
                  onChange={(e) => setDeviceForm({ ...deviceForm, storage: e.target.value })}
                  placeholder="128GB"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="label">IMEI / السيريال</span>
                <input
                  className="input"
                  value={deviceForm.imei}
                  onChange={(e) => setDeviceForm({ ...deviceForm, imei: e.target.value })}
                  dir="ltr"
                  placeholder="35xxxxxxxxxxxxx"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="label">حالة الجهاز عند الاستلام</span>
                <select
                  className="input"
                  value={deviceForm.conditionOnIntake}
                  onChange={(e) => setDeviceForm({ ...deviceForm, conditionOnIntake: e.target.value })}
                >
                  <option value="new">جديد</option>
                  <option value="excellent">ممتاز</option>
                  <option value="good">جيد</option>
                  <option value="fair">مقبول</option>
                  <option value="poor">ضعيف</option>
                  <option value="damaged">تالف</option>
                </select>
              </label>
            </div>
          ) : null}

          {deviceError ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
              {deviceError}
            </p>
          ) : null}
        </div>
      ) : null}

      {step === 'intake' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2.5">
            <div className="text-xs text-brand-900">
              <span className="font-bold">الجهاز المحدد: </span>
              {useNewDevice || !hasRegisteredDevices
                ? `${deviceForm.brand || 'ماركة غير محددة'} ${deviceForm.model || 'موديل غير محدد'}`
                : (() => {
                    const selected = registeredDevices.find((device) => device._id === selectedDeviceId);
                    return selected ? `${selected.brand} ${selected.model}` : 'لم يتم اختيار جهاز';
                  })()}
            </div>
            <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => goToStep('device')}>
              اختيار / تغيير الجهاز
            </button>
          </div>
          <label className="block">
            <span className="label">شكوى العميل (بكلماته) *</span>
            <textarea
              className="input min-h-[5rem]"
              value={intake.complaint}
              onChange={(e) => setIntake({ ...intake, complaint: e.target.value })}
              placeholder="مثال: الشاشة مكسورة واللمس لا يعمل في الجزء العلوي"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="label">تصنيف العطل</span>
              <select
                className="input"
                value={intake.complaintCategory}
                onChange={(e) => setIntake({ ...intake, complaintCategory: e.target.value })}
              >
                {[
                  ['display', 'شاشة وعرض'],
                  ['charging', 'شحن'],
                  ['battery', 'بطارية'],
                  ['audio', 'صوت وسماعات'],
                  ['water_damage', 'أضرار سوائل'],
                  ['camera', 'كاميرا'],
                  ['network', 'شبكة وشرائح'],
                  ['power', 'باور وتشغيل'],
                  ['software', 'برمجيات'],
                  ['hardware', 'هاردوير'],
                  ['back_glass', 'ظهر زجاج'],
                  ['biometrics', 'بصمة/تعرف'],
                  ['other', 'أخرى'],
                ].map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="label">الأولوية</span>
              <select
                className="input"
                value={intake.priority}
                onChange={(e) => setIntake({ ...intake, priority: e.target.value })}
              >
                {PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {PRIORITY_LABELS[priority]}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="label">الموعد الموعود (أيام)</span>
              <input
                type="number"
                min={1}
                max={60}
                className="input"
                value={intake.estimatedDays}
                onChange={(e) => setIntake({ ...intake, estimatedDays: Number(e.target.value) || 1 })}
              />
            </label>
          </div>

          <div>
            <p className="label">ملحقات مع العميل</p>
            <div className="flex flex-wrap gap-2">
              {[
                ['sim_tray', 'درج شريحة'],
                ['memory_card', 'كارت ميموري'],
                ['cover', 'جراب'],
                ['charger', 'شاحن'],
                ['box', 'علبة'],
              ].map(([value, label]) => (
                <label
                  key={value}
                  className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs transition ${
                    intake.accessories.includes(value) ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-ink-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={intake.accessories.includes(value)}
                    onChange={(e) =>
                      setIntake({
                        ...intake,
                        accessories: e.target.checked
                          ? [...intake.accessories, value]
                          : intake.accessories.filter((a) => a !== value),
                      })
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2 rounded-lg border border-ink-200 bg-ink-50 p-3">
            <p className="text-xs font-bold text-ink-700">إقرار العميل (Evidence)</p>
            {[
              ['customerAcknowledged', 'العميل أقر بحالة الجهاز الظاهرة'],
              ['dataLossDisclaimerAccepted', 'العميل أقر باحتمال فقدان البيانات'],
              ['devicePasswordProvided', 'العميل وفّر كلمة مرور/نمط فتح الجهاز'],
            ].map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-xs text-ink-600">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-ink-300"
                  checked={Boolean(intake[key as keyof typeof intake])}
                  onChange={(e) => setIntake({ ...intake, [key]: e.target.checked })}
                />
                {label}
              </label>
            ))}
            <p className="text-[11px] text-ink-500">
              يمكن رفع صور الاستلام وتوقيع العميل من صفحة التذكرة بعد الإنشاء.
            </p>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
