'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowRight,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  HardHat,
  History,
  MessageSquare,
  Package,
  PenLine,
  Plus,
  Receipt,
  Send,
  ShieldCheck,
  Stethoscope,
  Upload,
  User,
  Wrench,
  XCircle,
} from 'lucide-react';
import { api, errorMessage, fetcher, qs } from '@/lib/api';
import { formatDateTime, formatDuration, formatMoney, maskImei, timeAgo } from '@/lib/format';
import {
  FAULT_CATEGORY_LABELS,
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  STATUS_COLORS,
  statusLabel,
  type Priority,
  type RepairStatus,
} from '@/lib/constants';
import { Badge, Card, CardHeader, EmptyState, Field, LoadingBlock, PageHeader } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/lib/auth';

interface TicketDetail {
  ticket: {
    _id: string;
    ticketNumber: string;
    trackingToken: string;
    status: RepairStatus;
    statusLabel: string;
    priority: Priority;
    priorityLabel: string;
    source: string;
    createdAt: string;
    promisedAt?: string | null;
    readyAt?: string | null;
    deliveredAt?: string | null;
    ageMinutes: number;
    isOverdue: boolean;
    tags: string[];
    internalNotes?: string;
    customerVisibleNotes?: string;
    intake: {
      complaint: string;
      complaintCategory?: string;
      receivedAt: string;
      accessories?: string[];
      visualCondition?: Record<string, boolean | string>;
      customerAcknowledged?: boolean;
      dataLossDisclaimerAccepted?: boolean;
      devicePasswordProvided?: boolean;
      estimatedDeliveryAt?: string | null;
    };
    diagnosis: {
      summary?: string;
      faultCategory?: string;
      faultSeverity?: string;
      rootCause?: string;
      requiredActions?: string[];
      needsParts?: boolean;
      isBoardLevel?: boolean;
      confidence?: string;
      diagnosedAt?: string | null;
    };
    sla: { dueAt?: string | null; breached?: boolean; pausedMinutes?: number };
    cost: {
      laborQuotedEgp?: number;
      partsQuotedEgp?: number;
      totalQuotedEgp?: number;
      totalFinalEgp?: number;
      paidEgp?: number;
      dueEgp?: number;
      discountEgp?: number;
    };
    warranty: { policyDays?: number; expiresAt?: string | null; isVoid?: boolean; terms?: string };
    evidence: { intakePhotoCount?: number; repairPhotoCount?: number; hasSignature?: boolean; hasQcEvidence?: boolean };
    customerId: { _id: string; fullName: string; phone: string; whatsapp?: string; companyName?: string; type?: string } | null;
    deviceId: {
      _id: string;
      brand: string;
      model: string;
      color?: string;
      storage?: string;
      imei?: string;
      category?: string;
      passport?: { totalRepairs?: number; riskFlags?: string[]; openTickets?: number };
    } | null;
    assignedTechnicianId: { _id?: string; fullName: string; username?: string } | null;
  };
  allowedTransitions: { status: RepairStatus; label: string }[];
  timeline: {
    _id: string;
    fromStatus?: RepairStatus | null;
    toStatus: RepairStatus;
    eventType: string;
    note?: string;
    actorName?: string;
    actorRole?: string;
    durationMinutes?: number;
    station?: string;
    createdAt: string;
  }[];
  notes: {
    _id: string;
    body: string;
    visibility: string;
    category: string;
    authorName?: string;
    createdAt: string;
    isPinned?: boolean;
  }[];
  parts: {
    _id: string;
    quantity: number;
    status: string;
    unitPriceEgp: number;
    totalPriceEgp: number;
    warrantyDays?: number;
    partId?: { name: string; sku: string; category: string } | null;
    supplierId?: { name: string } | null;
  }[];
  labor: { _id: string; description: string; amountEgp: number; category: string; hours?: number }[];
  qualityChecks: {
    _id: string;
    attempt: number;
    result: string;
    passRatePct?: number;
    failureReasons?: string[];
    completedAt?: string | null;
    items?: { key: string; labelAr: string; result: string; required: boolean }[];
  }[];
  estimates: {
    _id: string;
    estimateNumber: string;
    version: number;
    status: string;
    totals: { totalEgp: number; approvedTotalEgp?: number };
    sentAt?: string | null;
    decidedAt?: string | null;
    rejectionReason?: string;
  }[];
  invoices: { _id: string; invoiceNumber: string; status: string; totals: { totalEgp: number; dueEgp: number; paidEgp: number } }[];
  files: { id: string; kind: string; stage: string; url: string; mimeType: string; createdAt: string }[];
  settings: { requireApprovalBeforeRepair: boolean; requireQcBeforeReady: boolean; requireIntakePhotos: boolean };
}

export default function TicketDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { hasPermission, user } = useAuth();
  const ticketId = params?.id;

  const { data, error, isLoading } = useSWR<TicketDetail>(ticketId ? `/tickets/${ticketId}` : null, fetcher, {
    refreshInterval: 30_000,
  });

  const [transitionOpen, setTransitionOpen] = useState(false);
  const [targetStatus, setTargetStatus] = useState<RepairStatus | null>(null);
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [diagnosisOpen, setDiagnosisOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [assignOpen, setAssignOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [estimateOpen, setEstimateOpen] = useState(false);
  const [sendingEstimateId, setSendingEstimateId] = useState<string | null>(null);
  const [decidingEstimateId, setDecidingEstimateId] = useState<string | null>(null);
  const [rejectFor, setRejectFor] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [issuingInvoice, setIssuingInvoice] = useState(false);
  const [partActionId, setPartActionId] = useState<string | null>(null);

  const { data: technicians } = useSWR<{ id: string; fullName: string; activeJobs: number; maxActiveJobs: number; isAvailable: boolean }[]>(
    hasPermission('technician:read') ? '/technicians/available' : null,
    fetcher,
  );

  if (isLoading) {
    return (
      <Card>
        <LoadingBlock rows={8} />
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card className="border-red-200 bg-red-50 p-5 text-sm text-red-700">
        {error ? errorMessage(error) : 'التذكرة غير موجودة'}
      </Card>
    );
  }

  const { ticket, allowedTransitions, timeline, notes, parts, labor, qualityChecks, estimates, invoices, files, settings } = data;

  const refresh = () => mutate(`/tickets/${ticketId}`);

  const doTransition = async () => {
    if (!targetStatus) return;
    setIsSubmitting(true);
    try {
      await api.post(`/tickets/${ticketId}/transition`, { status: targetStatus, note });
      toast.success(`تم تحديث الحالة إلى «${statusLabel(targetStatus)}»`);
      setTransitionOpen(false);
      setNote('');
      setTargetStatus(null);
      await Promise.all([refresh(), mutate('/tickets/board')]);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const doAssign = async (technicianId: string | null) => {
    try {
      await api.post(`/tickets/${ticketId}/assign`, { technicianId });
      toast.success(technicianId ? 'تم إسناد التذكرة' : 'تم إلغاء الإسناد');
      setAssignOpen(false);
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const addNote = async () => {
    if (!noteText.trim()) return;
    try {
      await api.post(`/tickets/${ticketId}/notes`, { body: noteText, visibility: 'internal', category: 'general' });
      setNoteText('');
      toast.success('تمت إضافة الملاحظة');
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const uploadEvidence = async (
    fileList: FileList | null,
    kind: string,
    stage: string,
    field: 'files' | 'signature' = 'files',
  ) => {
    if (!fileList?.length) return;
    const formData = new FormData();
    Array.from(fileList).forEach((file) => formData.append(field, file));
    formData.append('kind', kind);
    formData.append('stage', stage);
    setUploading(true);
    try {
      await api.upload(`/tickets/${ticketId}/evidence`, formData);
      toast.success('تم رفع الأدلة');
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  const sendEstimate = async (estimateId: string) => {
    setSendingEstimateId(estimateId);
    try {
      await api.post(`/estimates/${estimateId}/send`, { via: 'whatsapp' });
      toast.success('تم إرسال عرض السعر للعميل');
      await Promise.all([refresh(), mutate('/tickets/board')]);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSendingEstimateId(null);
    }
  };

  /**
   * تسجيل قرار العميل نيابةً عنه (الاستقبال/الكاشير بعد التبليغ الهاتفي أو الحضوري).
   * الموافقة → إشعار الفني وبدء الإصلاح. الرفض → إلغاء التذكرة وإرجاع القطع المحجوزة.
   */
  const decideEstimate = async (estimateId: string, decision: 'approved' | 'rejected') => {
    setDecidingEstimateId(`${estimateId}:${decision}`);
    try {
      await api.post(`/estimates/${estimateId}/decide`, {
        decision,
        channel: 'in_person',
        rejectionReason: decision === 'rejected' ? rejectReason.trim() : '',
      });
      if (decision === 'approved') {
        toast.success('سُجّلت موافقة العميل — أُخطر الفني لبدء الإصلاح');
      } else {
        toast.success('سُجّل رفض العميل — أُلغيت التذكرة وأُرجعت القطع المحجوزة');
      }
      setRejectFor(null);
      setRejectReason('');
      await Promise.all([refresh(), mutate('/tickets/board')]);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setDecidingEstimateId(null);
    }
  };

  const totalCost = ticket.cost.totalFinalEgp ?? ticket.cost.totalQuotedEgp ?? 0;
  const invoicePaid = invoices.reduce((sum, invoice) => sum + (invoice.totals.paidEgp ?? 0), 0);
  const invoiceDue = invoices.reduce((sum, invoice) => sum + (invoice.totals.dueEgp ?? 0), 0);
  const paidAmount = invoices.length ? invoicePaid : (ticket.cost.paidEgp ?? 0);
  const dueAmount = invoices.length ? invoiceDue : Math.max(0, totalCost - paidAmount);

  const issueInvoice = async () => {
    setIssuingInvoice(true);
    try {
      const invoice = await api.post<{ invoiceNumber: string }>('/finance/invoices', {
        type: 'repair',
        buildFromTicket: true,
        ticketId,
        discountEgp: ticket.cost.discountEgp ?? 0,
        issueNow: true,
      });
      toast.success(`أُصدرت الفاتورة ${invoice.invoiceNumber}`);
      await Promise.all([refresh(), mutate('/tickets/board'), mutate('/finance/summary?period=last30')]);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setIssuingInvoice(false);
    }
  };

  const updatePartStatus = async (partId: string, status: string, label: string) => {
    setPartActionId(partId);
    try {
      await api.patch(`/tickets/${ticketId}/parts/${partId}`, { status });
      toast.success(label);
      await Promise.all([refresh(), mutate('/tickets/board')]);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPartActionId(null);
    }
  };

  const removePart = async (partId: string) => {
    setPartActionId(partId);
    try {
      await api.del(`/tickets/${ticketId}/parts/${partId}`);
      toast.success('أُزيلت القطعة وسُوّي المخزون');
      await Promise.all([refresh(), mutate('/tickets/board')]);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPartActionId(null);
    }
  };

  return (
    <div>
      <PageHeader
        breadcrumb={
          <Link href="/tickets" className="inline-flex items-center gap-1 hover:text-brand-700">
            <ArrowRight size={12} /> كل التذاكر
          </Link>
        }
        title={ticket.ticketNumber}
        subtitle={`${ticket.deviceId ? `${ticket.deviceId.brand} ${ticket.deviceId.model}` : ''} — ${formatDateTime(
          ticket.createdAt,
        )}`}
        actions={
          <>
            <Badge className={STATUS_COLORS[ticket.status]}>{ticket.statusLabel}</Badge>
            <Badge className={PRIORITY_COLORS[ticket.priority]}>{ticket.priorityLabel}</Badge>
            {ticket.isOverdue ? (
              <Badge className="border-red-200 bg-red-50 text-red-700">
                <AlertTriangle size={12} /> متأخرة
              </Badge>
            ) : null}
            {hasPermission('ticket:transition') ? (
              <button type="button" className="btn-primary" onClick={() => setTransitionOpen(true)}>
                <Wrench size={16} /> تغيير الحالة
              </button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-3">
        {/* العمود الرئيسي */}
        <div className="space-y-4 xl:col-span-2">
          {/* الشكوى والتشخيص */}
          <Card>
            <CardHeader title="الشكوى والتشخيص" icon={<Stethoscope size={18} />} />
            <div className="card-pad space-y-4">
              <div>
                <p className="label">شكوى العميل</p>
                <p className="rounded-lg bg-ink-50 p-3 text-sm leading-relaxed text-ink-700">{ticket.intake.complaint}</p>
                <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-ink-500">
                  <span>التصنيف: {FAULT_CATEGORY_LABELS[ticket.intake.complaintCategory ?? ''] ?? 'غير محدد'}</span>
                  <span>·</span>
                  <span>الاستلام: {formatDateTime(ticket.intake.receivedAt)}</span>
                  {ticket.intake.accessories?.length ? (
                    <>
                      <span>·</span>
                      <span>ملحقات: {ticket.intake.accessories.join('، ')}</span>
                    </>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                <EvidencePill label="إقرار العميل" ok={Boolean(ticket.intake.customerAcknowledged)} />
                <EvidencePill label="إقرار فقدان البيانات" ok={Boolean(ticket.intake.dataLossDisclaimerAccepted)} />
                <EvidencePill label="كلمة مرور الجهاز" ok={Boolean(ticket.intake.devicePasswordProvided)} />
              </div>

              {ticket.diagnosis?.summary ? (
                <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-indigo-800">نتيجة التشخيص</p>
                    <span className="text-[11px] text-indigo-700">
                      ثقة: {ticket.diagnosis.confidence === 'high' ? 'عالية' : ticket.diagnosis.confidence === 'low' ? 'منخفضة' : 'متوسطة'}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm text-indigo-900">{ticket.diagnosis.summary}</p>
                  {ticket.diagnosis.rootCause ? (
                    <p className="mt-1.5 text-xs text-indigo-700">السبب: {ticket.diagnosis.rootCause}</p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Badge className="border-indigo-200 bg-white text-indigo-700">
                      {FAULT_CATEGORY_LABELS[ticket.diagnosis.faultCategory ?? ''] ?? ticket.diagnosis.faultCategory}
                    </Badge>
                    <Badge className="border-indigo-200 bg-white text-indigo-700">
                      {ticket.diagnosis.faultSeverity === 'critical'
                        ? 'حرج'
                        : ticket.diagnosis.faultSeverity === 'major'
                          ? 'كبير'
                          : ticket.diagnosis.faultSeverity === 'minor'
                            ? 'بسيط'
                            : 'متوسط'}
                    </Badge>
                    {ticket.diagnosis.isBoardLevel ? (
                      <Badge className="border-amber-200 bg-amber-50 text-amber-800">إصلاح بوردة</Badge>
                    ) : null}
                  </div>
                </div>
              ) : hasPermission('diagnosis:write') ? (
                <button type="button" className="btn-secondary" onClick={() => setDiagnosisOpen(true)}>
                  <Stethoscope size={16} /> تسجيل التشخيص
                </button>
              ) : null}
            </div>
          </Card>

          {/* Timeline */}
          <Card>
            <CardHeader
              title="سلسلة الأحداث (Chain of Custody)"
              subtitle="من استلم، من شخّص، من أصلح، ومتى"
              icon={<History size={18} />}
            />
            <div className="card-pad">
              <ol className="relative space-y-3.5 border-r-2 border-ink-200 pr-4">
                {timeline.map((event) => (
                  <li key={event._id} className="relative">
                    <span className="absolute -right-[1.42rem] top-1 h-3 w-3 rounded-full border-2 border-white bg-brand-600" />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`badge border ${STATUS_COLORS[event.toStatus] ?? ''}`}>
                        {statusLabel(event.toStatus)}
                      </span>
                      <span className="text-[11px] text-ink-500">{formatDateTime(event.createdAt)}</span>
                      {event.durationMinutes ? (
                        <span className="text-[11px] text-ink-400">
                          (مدة المرحلة السابقة: {formatDuration(event.durationMinutes)})
                        </span>
                      ) : null}
                    </div>
                    {event.note ? <p className="mt-1 text-xs leading-relaxed text-ink-600">{event.note}</p> : null}
                    <p className="mt-0.5 text-[11px] text-ink-400">
                      {event.actorName || 'النظام'}
                      {event.station ? ` · ${event.station}` : ''}
                    </p>
                  </li>
                ))}
                {!timeline.length ? <p className="text-sm text-ink-500">لا توجد أحداث مسجلة.</p> : null}
              </ol>
            </div>
          </Card>

          {/* القطع والمصنعية */}
          <Card>
            <CardHeader
              title="القطع والمصنعية"
              subtitle={`${parts.length} قطعة · ${labor.length} بند مصنعية`}
              icon={<Package size={18} />}
            />
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>البند</th>
                    <th>النوع</th>
                    <th>الكمية</th>
                    <th>سعر الوحدة</th>
                    <th>الإجمالي</th>
                    <th>الضمان</th>
                    {hasPermission('part:manage') ? <th>إجراءات</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {parts.map((part) => (
                    <tr key={part._id}>
                      <td className="text-xs">
                        <p className="font-medium text-ink-800">{part.partId?.name ?? 'قطعة'}</p>
                        <p className="text-ink-400" dir="ltr">
                          {part.partId?.sku ?? ''} {part.supplierId ? `· ${part.supplierId.name}` : ''}
                        </p>
                      </td>
                      <td className="text-xs">
                        <Badge
                          className={
                            part.status === 'installed'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              : part.status === 'defective'
                                ? 'border-red-200 bg-red-50 text-red-700'
                                : 'border-ink-200 bg-ink-50 text-ink-600'
                          }
                        >
                          {part.status === 'installed'
                            ? 'مثبتة'
                            : part.status === 'defective'
                              ? 'معيبة'
                              : part.status === 'reserved'
                                ? 'محجوزة'
                                : part.status === 'removed'
                                  ? 'مفكوكة'
                                  : part.status === 'returned'
                                    ? 'مرتجعة'
                                    : part.status}
                        </Badge>
                      </td>
                      <td className="num text-xs">{part.quantity}</td>
                      <td className="num text-xs">{formatMoney(part.unitPriceEgp)}</td>
                      <td className="num text-xs font-bold">{formatMoney(part.totalPriceEgp)}</td>
                      <td className="text-xs">{part.warrantyDays ? `${part.warrantyDays} يوم` : '—'}</td>
                      {hasPermission('part:manage') ? (
                        <td className="whitespace-nowrap">
                          {part.status === 'reserved' ? (
                            <div className="flex flex-wrap gap-1">
                              <button
                                type="button"
                                className="btn-ghost px-1.5 py-0.5 text-[11px] text-emerald-700"
                                disabled={partActionId === part._id}
                                onClick={() => void updatePartStatus(part._id, 'installed', 'سُجّلت القطعة كمثبتة واستُهلكت من المخزون')}
                              >
                                تركيب
                              </button>
                              <button
                                type="button"
                                className="btn-ghost px-1.5 py-0.5 text-[11px] text-red-600"
                                disabled={partActionId === part._id}
                                onClick={() => void updatePartStatus(part._id, 'defective', 'سُجّلت القطعة معيبة')}
                              >
                                معيبة
                              </button>
                              <button
                                type="button"
                                className="btn-ghost px-1.5 py-0.5 text-[11px]"
                                disabled={partActionId === part._id}
                                onClick={() => void removePart(part._id)}
                              >
                                إلغاء الحجز
                              </button>
                            </div>
                          ) : part.status === 'installed' ? (
                            <div className="flex flex-wrap gap-1">
                              <button
                                type="button"
                                className="btn-ghost px-1.5 py-0.5 text-[11px]"
                                disabled={partActionId === part._id}
                                onClick={() => void updatePartStatus(part._id, 'removed', 'فُكّت القطعة وأُرجعت للمخزون')}
                              >
                                فك وإرجاع
                              </button>
                              <button
                                type="button"
                                className="btn-ghost px-1.5 py-0.5 text-[11px] text-red-600"
                                disabled={partActionId === part._id}
                                onClick={() => void updatePartStatus(part._id, 'defective', 'سُجّلت القطعة معيبة')}
                              >
                                معيبة
                              </button>
                            </div>
                          ) : (
                            <span className="text-[11px] text-ink-400">—</span>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                  {labor.map((item) => (
                    <tr key={item._id}>
                      <td className="text-xs font-medium text-ink-800">{item.description}</td>
                      <td className="text-xs">
                        <Badge className="border-sky-200 bg-sky-50 text-sky-700">مصنعية</Badge>
                      </td>
                      <td className="num text-xs">{item.hours ?? 1}</td>
                      <td className="num text-xs">{formatMoney(item.amountEgp)}</td>
                      <td className="num text-xs font-bold">{formatMoney(item.amountEgp)}</td>
                      <td className="text-xs">—</td>
                      {hasPermission('part:manage') ? <td /> : null}
                    </tr>
                  ))}
                  {!parts.length && !labor.length ? (
                    <tr>
                      <td colSpan={hasPermission('part:manage') ? 7 : 6}>
                        <EmptyState title="لا توجد بنود بعد" icon={<Package size={20} />} />
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Card>

          {/* فحص الجودة */}
          <Card>
            <CardHeader
              title="فحص الجودة"
              subtitle={settings.requireQcBeforeReady ? 'إلزامي قبل تجهيز الجهاز للتسليم' : 'غير إلزامي حسب إعدادات المركز'}
              icon={<ClipboardCheck size={18} />}
            />
            <div className="card-pad space-y-3">
              {qualityChecks.map((qc) => (
                <div
                  key={qc._id}
                  className={`rounded-lg border p-3 ${
                    qc.result === 'failed' ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-bold text-ink-800">
                      محاولة {qc.attempt} —{' '}
                      {qc.result === 'passed'
                        ? 'اجتاز'
                        : qc.result === 'passed_with_notes'
                          ? 'اجتاز بملاحظات'
                          : qc.result === 'failed'
                            ? 'لم يجتز'
                            : 'قيد التنفيذ'}
                    </p>
                    <span className="text-[11px] text-ink-500">
                      نسبة الاجتياز {typeof qc.passRatePct === 'number' ? `${qc.passRatePct}%` : '—'}
                    </span>
                  </div>
                  {qc.failureReasons?.length ? (
                    <p className="mt-1 text-xs text-red-700">أسباب الرسوب: {qc.failureReasons.join('، ')}</p>
                  ) : null}
                  {qc.items?.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {qc.items.map((item) => (
                        <span
                          key={item.key}
                          className={`rounded-md px-2 py-0.5 text-[10px] font-medium ${
                            item.result === 'pass'
                              ? 'bg-emerald-100 text-emerald-800'
                              : item.result === 'fail'
                                ? 'bg-red-100 text-red-800'
                                : 'bg-ink-100 text-ink-600'
                          }`}
                        >
                          {item.labelAr}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
              {hasPermission('qc:perform') ? (
                <Link href={`/quality?ticketId=${ticket._id}`} className="btn-secondary">
                  <ClipboardCheck size={16} /> {qualityChecks.length ? 'فحص جديد' : 'بدء فحص الجودة'}
                </Link>
              ) : null}
            </div>
          </Card>

          {/* الملاحظات */}
          <Card>
            <CardHeader title="الملاحظات الداخلية" icon={<MessageSquare size={18} />} />
            <div className="card-pad space-y-3">
              {hasPermission('ticket:update') ? (
                <div className="flex gap-2">
                  <input
                    className="input"
                    placeholder="أضف ملاحظة داخلية…"
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void addNote();
                    }}
                  />
                  <button type="button" className="btn-primary shrink-0" onClick={addNote} disabled={!noteText.trim()}>
                    إضافة
                  </button>
                </div>
              ) : null}

              <div className="space-y-2">
                {notes.map((item) => (
                  <div key={item._id} className="rounded-lg border border-ink-200 p-2.5">
                    <p className="text-xs text-ink-700">{item.body}</p>
                    <p className="mt-1 text-[11px] text-ink-400">
                      {item.authorName || '—'} · {timeAgo(item.createdAt)}
                      {item.visibility === 'customer' ? ' · مرئية للعميل' : ''}
                    </p>
                  </div>
                ))}
                {!notes.length ? <p className="text-xs text-ink-500">لا توجد ملاحظات.</p> : null}
              </div>
            </div>
          </Card>
        </div>

        {/* العمود الجانبي */}
        <div className="space-y-4">
          {/* العميل */}
          <Card>
            <CardHeader title="العميل" icon={<User size={18} />} />
            <div className="card-pad space-y-1.5 text-sm">
              <Link href={`/customers/${ticket.customerId?._id}`} className="font-bold text-brand-700 hover:underline">
                {ticket.customerId?.fullName ?? '—'}
              </Link>
              <p className="text-xs text-ink-500" dir="ltr">
                {ticket.customerId?.phone ?? ''}
              </p>
              {ticket.customerId?.companyName ? (
                <p className="text-xs text-ink-500">{ticket.customerId.companyName}</p>
              ) : null}
              <p className="pt-1 text-xs text-ink-500">
                الجهاز:{' '}
                <Link href={`/devices/${ticket.deviceId?._id}`} className="text-brand-700 hover:underline">
                  {ticket.deviceId?.brand} {ticket.deviceId?.model}
                </Link>
              </p>
              <p className="text-xs text-ink-500" dir="ltr">
                IMEI: {maskImei(ticket.deviceId?.imei)}
              </p>
              {ticket.deviceId?.passport?.riskFlags?.length ? (
                <div className="flex flex-wrap gap-1 pt-1">
                  {ticket.deviceId.passport.riskFlags.map((flag) => (
                    <Badge key={flag} className="border-amber-200 bg-amber-50 text-amber-800">
                      {flag === 'liquid_damage'
                        ? 'أضرار سوائل'
                        : flag === 'board_level'
                          ? 'بوردة'
                          : flag === 'previous_repair'
                            ? 'إصلاح سابق'
                            : flag}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
          </Card>

          {/* الفني */}
          <Card>
            <CardHeader
              title="الفني المسؤول"
              icon={<HardHat size={18} />}
              action={
                hasPermission('ticket:assign') ? (
                  <button type="button" className="btn-ghost text-xs" onClick={() => setAssignOpen(true)}>
                    {ticket.assignedTechnicianId ? 'تغيير' : 'إسناد'}
                  </button>
                ) : null
              }
            />
            <div className="card-pad">
              {ticket.assignedTechnicianId ? (
                <>
                  <p className="text-sm font-bold text-ink-800">{ticket.assignedTechnicianId.fullName}</p>
                  {ticket.assignedTechnicianId.username ? (
                    <p className="text-xs text-ink-500" dir="ltr">
                      {ticket.assignedTechnicianId.username}
                    </p>
                  ) : null}
                  {user?.id === ticket.assignedTechnicianId._id && user?.technicianProfile?.workbench ? (
                    <p className="mt-1.5 text-xs text-ink-500">طاولة العمل: {user.technicianProfile.workbench}</p>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-amber-700">لم يُسند لفني بعد</p>
              )}
            </div>
          </Card>

          {/* التكاليف */}
          <Card>
            <CardHeader title="التكاليف" icon={<Receipt size={18} />} />
            <dl className="card-pad space-y-2 text-sm">
              <Row label="مصنعية" value={formatMoney(ticket.cost.laborQuotedEgp ?? 0)} />
              <Row label="قطع غيار" value={formatMoney(ticket.cost.partsQuotedEgp ?? 0)} />
              {ticket.cost.discountEgp ? <Row label="خصم" value={`- ${formatMoney(ticket.cost.discountEgp)}`} /> : null}
              <div className="border-t border-ink-100 pt-2">
                <Row label="الإجمالي النهائي" value={formatMoney(totalCost)} bold />
              </div>
              <Row label="المدفوع" value={formatMoney(paidAmount)} />
              <Row
                label="المتبقي"
                value={formatMoney(dueAmount)}
                tone={dueAmount > 0 ? 'danger' : 'success'}
                bold
              />
            </dl>
          </Card>

          {/* العروض */}
          <Card>
            <CardHeader
              title="عروض السعر"
              icon={<FileText size={18} />}
              action={
                hasPermission('estimate:write') ? (
                  <button type="button" className="btn-ghost text-xs" onClick={() => setEstimateOpen(true)}>
                    <Plus size={14} /> عرض جديد
                  </button>
                ) : null
              }
            />
            <div className="card-pad space-y-2">
              {estimates.map((estimate) => (
                <div key={estimate._id} className="rounded-lg border border-ink-200 p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-ink-800" dir="ltr">
                      {estimate.estimateNumber} (v{estimate.version})
                    </span>
                    <Badge
                      className={
                        estimate.status === 'approved' || estimate.status === 'partially_approved'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : estimate.status === 'rejected'
                            ? 'border-red-200 bg-red-50 text-red-700'
                            : 'border-amber-200 bg-amber-50 text-amber-800'
                      }
                    >
                      {estimate.status === 'approved'
                        ? 'معتمد'
                        : estimate.status === 'partially_approved'
                          ? 'معتمد جزئيًا'
                          : estimate.status === 'rejected'
                            ? 'مرفوض'
                            : estimate.status === 'sent'
                              ? 'بانتظار الموافقة'
                              : 'مسودة'}
                    </Badge>
                  </div>
                  <p className="mt-1.5 text-sm font-bold text-ink-800 num">{formatMoney(estimate.totals.totalEgp)}</p>
                  {estimate.totals.approvedTotalEgp ? (
                    <p className="text-[11px] text-emerald-700 num">
                      المعتمد: {formatMoney(estimate.totals.approvedTotalEgp)}
                    </p>
                  ) : null}
                  {estimate.rejectionReason ? (
                    <p className="mt-1 text-[11px] text-red-700">سبب الرفض: {estimate.rejectionReason}</p>
                  ) : null}
                  {estimate.status === 'draft' && hasPermission('estimate:write') ? (
                    <button
                      type="button"
                      className="btn-primary mt-2 w-full justify-center text-xs"
                      onClick={() => void sendEstimate(estimate._id)}
                      disabled={sendingEstimateId === estimate._id}
                    >
                      <Send size={13} />
                      {sendingEstimateId === estimate._id ? 'جارٍ الإرسال…' : 'إرسال للعميل'}
                    </button>
                  ) : null}

                  {/* تسجيل قرار العميل — للاستقبال/الكاشير بعد التبليغ */}
                  {estimate.status === 'sent' && hasPermission('estimate:approve') ? (
                    <div className="mt-2 space-y-2">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="btn-primary flex-1 justify-center text-xs"
                          onClick={() => void decideEstimate(estimate._id, 'approved')}
                          disabled={Boolean(decidingEstimateId)}
                        >
                          <CheckCircle2 size={13} />
                          {decidingEstimateId === `${estimate._id}:approved` ? 'جارٍ التسجيل…' : 'العميل وافق'}
                        </button>
                        <button
                          type="button"
                          className="btn-secondary flex-1 justify-center border-red-300 text-xs text-red-700 hover:bg-red-50"
                          onClick={() => {
                            setRejectFor(rejectFor === estimate._id ? null : estimate._id);
                            setRejectReason('');
                          }}
                          disabled={Boolean(decidingEstimateId)}
                        >
                          <XCircle size={13} />
                          العميل رفض
                        </button>
                      </div>
                      {rejectFor === estimate._id ? (
                        <div className="rounded-lg border border-red-200 bg-red-50 p-2.5">
                          <label className="block text-[11px] font-bold text-red-800">
                            سبب الرفض — يُسجَّل مع إلغاء التذكرة كدليل عند النزاع
                          </label>
                          <textarea
                            className="input mt-1.5 text-xs"
                            rows={2}
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                            placeholder="مثال: السعر أعلى من المتوقع، العميل سيأخذ الجهاز لمركز آخر…"
                          />
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              className="btn-primary flex-1 justify-center bg-red-600 text-xs hover:bg-red-700"
                              onClick={() => void decideEstimate(estimate._id, 'rejected')}
                              disabled={Boolean(decidingEstimateId) || !rejectReason.trim()}
                            >
                              {decidingEstimateId === `${estimate._id}:rejected` ? 'جارٍ الإلغاء…' : 'تأكيد الرفض وإلغاء التذكرة'}
                            </button>
                            <button
                              type="button"
                              className="btn-ghost text-xs"
                              onClick={() => {
                                setRejectFor(null);
                                setRejectReason('');
                              }}
                            >
                              تراجع
                            </button>
                          </div>
                          <p className="mt-1.5 text-[10px] leading-relaxed text-red-700">
                            الإلغاء يُفك حجوزات القطع المحجوزة لهذا الطلب، ويُخطر الفني بالتوقف. الجهاز يبقى لدى المركز حتى
                            استلام العميل له.
                          </p>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {estimate.sentAt && estimate.status !== 'draft' ? (
                    <p className="mt-1 text-[11px] text-ink-400">أُرسل: {formatDateTime(estimate.sentAt)}</p>
                  ) : null}
                </div>
              ))}
              {!estimates.length ? (
                <p className="text-xs text-ink-500">
                  {hasPermission('estimate:write') ? 'لا توجد عروض بعد — اضغط «عرض جديد» لإنشاء أول عرض.' : 'لا توجد عروض بعد.'}
                </p>
              ) : null}
            </div>
          </Card>

          {/* الفواتير */}
          <Card>
            <CardHeader
              title="الفواتير"
              subtitle={invoices.length ? `${invoices.length} فاتورة` : 'لا توجد فواتير بعد'}
              icon={<Receipt size={18} />}
              action={
                hasPermission('invoice:write') && totalCost > 0 ? (
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={() => void issueInvoice()}
                    disabled={issuingInvoice}
                  >
                    {issuingInvoice ? 'جارٍ الإصدار…' : 'إصدار فاتورة'}
                  </button>
                ) : undefined
              }
            />
            <div className="card-pad space-y-2">
              {invoices.map((invoice) => (
                <Link
                  key={invoice._id}
                  href={`/invoices/${invoice._id}`}
                  className="flex items-center justify-between rounded-lg border border-ink-200 p-2.5 transition hover:border-brand-400"
                >
                  <span className="text-xs font-bold text-ink-800" dir="ltr">
                    {invoice.invoiceNumber}
                  </span>
                  <span className="text-left">
                    <span className="block text-xs font-bold num">{formatMoney(invoice.totals.totalEgp)}</span>
                    <span className={`block text-[11px] num ${invoice.totals.dueEgp > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      {invoice.totals.dueEgp > 0 ? `متبقي ${formatMoney(invoice.totals.dueEgp)}` : 'مدفوعة'}
                    </span>
                  </span>
                </Link>
              ))}
              {!invoices.length ? (
                <p className="text-xs text-ink-500">
                  {hasPermission('invoice:write')
                    ? 'اضغط «إصدار فاتورة» لإنشاء فاتورة من بنود عرض السعر المعتمد أو المصنعية والقطع.'
                    : 'ستظهر الفاتورة هنا بعد إصدارها من الاستقبال.'}
                </p>
              ) : null}
            </div>
          </Card>

          {/* الضمان */}
          {ticket.warranty.policyDays ? (
            <Card>
              <CardHeader title="الضمان" icon={<ShieldCheck size={18} />} />
              <div className="card-pad space-y-1.5 text-sm">
                <Row label="مدة الضمان" value={`${ticket.warranty.policyDays} يوم`} />
                <Row label="ينتهي في" value={ticket.warranty.expiresAt ? formatDateTime(ticket.warranty.expiresAt) : '—'} />
                {ticket.warranty.isVoid ? <p className="text-xs text-red-700">الضمان ملغى</p> : null}
                {ticket.warranty.terms ? <p className="text-[11px] text-ink-500">{ticket.warranty.terms}</p> : null}
              </div>
            </Card>
          ) : null}

          {/* الأدلة */}
          <Card>
            <CardHeader
              title="الأدلة والصور"
              subtitle={`استلام: ${ticket.evidence.intakePhotoCount ?? 0} · إصلاح: ${ticket.evidence.repairPhotoCount ?? 0}`}
              icon={<Camera size={18} />}
            />
            <div className="card-pad space-y-3">
              {hasPermission('evidence:upload') ? (
                <div className="space-y-2">
                  <label className="btn-secondary w-full cursor-pointer justify-center text-xs">
                    <Upload size={14} /> {uploading ? 'جارٍ الرفع…' : 'رفع صور الاستلام'}
                    <input
                      type="file"
                      multiple
                      accept="image/*"
                      className="sr-only"
                      onChange={(e) => void uploadEvidence(e.target.files, 'intake_photo', 'before_repair')}
                      disabled={uploading}
                    />
                  </label>
                  <label className="btn-secondary w-full cursor-pointer justify-center text-xs">
                    <Upload size={14} /> رفع صور الإصلاح
                    <input
                      type="file"
                      multiple
                      accept="image/*"
                      className="sr-only"
                      onChange={(e) => void uploadEvidence(e.target.files, 'repair_photo', 'during_repair')}
                      disabled={uploading}
                    />
                  </label>
                  <label className="btn-secondary w-full cursor-pointer justify-center text-xs">
                    <PenLine size={14} /> رفع توقيع العميل
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={(e) => void uploadEvidence(e.target.files, 'customer_signature', 'delivery', 'signature')}
                      disabled={uploading}
                    />
                  </label>
                </div>
              ) : null}

              <div className="grid grid-cols-3 gap-2">
                {files.slice(0, 9).map((file) => (
                  <a
                    key={file.id}
                    href={file.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group relative block aspect-square overflow-hidden rounded-lg border border-ink-200 bg-ink-100"
                  >
                    {file.mimeType.startsWith('image/') ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={file.url} alt={file.stage} className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full items-center justify-center text-ink-400">
                        <FileText size={20} />
                      </span>
                    )}
                  </a>
                ))}
              </div>
              {!files.length ? <p className="text-xs text-ink-500">لا توجد أدلة مرفوعة بعد.</p> : null}

              <div className="flex flex-wrap gap-1.5 pt-1">
                <EvidencePill label="توقيع" ok={Boolean(ticket.evidence.hasSignature)} />
                <EvidencePill label="أدلة فحص" ok={Boolean(ticket.evidence.hasQcEvidence)} />
              </div>

              {ticket.trackingToken ? (
                <p className="rounded-lg bg-ink-50 p-2 text-[11px] text-ink-500">
                  رابط تتبع العميل:{' '}
                  <Link href={`/track/${ticket.trackingToken}`} className="text-brand-700 hover:underline" dir="ltr">
                    /track/{ticket.trackingToken.slice(0, 10)}…
                  </Link>
                </p>
              ) : null}
            </div>
          </Card>
        </div>
      </div>

      {/* نافذة تغيير الحالة */}
      <Modal
        open={transitionOpen}
        onClose={() => setTransitionOpen(false)}
        title="تغيير حالة التذكرة"
        subtitle="الانتقالات المتاحة محسوبة من محرّك دورة العمل"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setTransitionOpen(false)}>
              إلغاء
            </button>
            <button type="button" className="btn-primary" onClick={doTransition} disabled={!targetStatus || isSubmitting}>
              {isSubmitting ? 'جارٍ التنفيذ…' : 'تنفيذ الانتقال'}
            </button>
          </>
        }
      >
        {allowedTransitions.length ? (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              {allowedTransitions.map((transition) => (
                <button
                  key={transition.status}
                  type="button"
                  onClick={() => setTargetStatus(transition.status)}
                  className={`rounded-lg border px-3 py-2.5 text-right text-sm transition ${
                    targetStatus === transition.status
                      ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-500'
                      : 'border-ink-200 hover:border-brand-300'
                  }`}
                >
                  <span className={`badge border ${STATUS_COLORS[transition.status]}`}>{transition.label}</span>
                </button>
              ))}
            </div>

            <Field label="ملاحظة على الانتقال (تُسجَّل في سلسلة الأحداث)">
              <textarea
                className="input min-h-[4rem]"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="مثال: تم استلام موافقة العميل هاتفيًا"
              />
            </Field>

            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-800">
              قواعد النظام المفعّلة:{' '}
              {settings.requireApprovalBeforeRepair ? 'لا بد من عرض سعر معتمد قبل بدء الإصلاح · ' : ''}
              {settings.requireQcBeforeReady ? 'لا بد من اجتياز فحص الجودة قبل التجهيز للتسليم · ' : ''}
              لا يمكن التسليم قبل سداد المستحق.
            </div>
          </div>
        ) : (
          <EmptyState title="لا توجد انتقالات متاحة" description="هذه التذكرة في حالة نهائية." icon={<CheckCircle2 size={22} />} />
        )}
      </Modal>

      {/* نافذة الإسناد */}
      <Modal open={assignOpen} onClose={() => setAssignOpen(false)} title="إسناد التذكرة لفني" size="md">
        <div className="space-y-2">
          {!technicians?.length ? <p className="text-xs text-ink-500">لا يوجد فنيون متاحون حاليًا.</p> : null}
          {technicians?.map((tech) => (
            <button
              key={tech.id}
              type="button"
              onClick={() => void doAssign(tech.id)}
              className="flex w-full items-center justify-between rounded-lg border border-ink-200 px-3 py-2.5 text-right transition hover:border-brand-400 hover:bg-brand-50"
            >
              <span>
                <span className="block text-sm font-medium text-ink-800">{tech.fullName}</span>
                <span className="block text-[11px] text-ink-500">
                  {tech.activeJobs}/{tech.maxActiveJobs} مهمة نشطة
                </span>
              </span>
              <Badge
                className={
                  tech.isAvailable
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-red-200 bg-red-50 text-red-700'
                }
              >
                {tech.isAvailable ? 'متاح' : 'محمّل'}
              </Badge>
            </button>
          ))}
          <button
            type="button"
            onClick={() => void doAssign(null)}
            className="btn-secondary w-full justify-center text-xs"
          >
            إلغاء الإسناد
          </button>
        </div>
      </Modal>

      {/* نافذة التشخيص */}
      <DiagnosisModal
        open={diagnosisOpen}
        onClose={() => setDiagnosisOpen(false)}
        ticketId={ticket._id}
        onSaved={async () => {
          setDiagnosisOpen(false);
          await refresh();
        }}
        defaultCategory={ticket.intake.complaintCategory ?? ''}
      />

      {/* نافذة عرض السعر */}
      <EstimateModal
        open={estimateOpen}
        onClose={() => setEstimateOpen(false)}
        ticketId={ticket._id}
        onSaved={async () => {
          setEstimateOpen(false);
          await refresh();
        }}
      />
    </div>
  );
}

function Row({
  label,
  value,
  bold,
  tone,
}: {
  label: string;
  value: string;
  bold?: boolean;
  tone?: 'danger' | 'success';
}) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-ink-500">{label}</dt>
      <dd
        className={`num ${bold ? 'font-bold' : 'font-medium'} ${
          tone === 'danger' ? 'text-red-600' : tone === 'success' ? 'text-emerald-600' : 'text-ink-800'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function EvidencePill({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span
      className={`badge border ${
        ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-ink-200 bg-ink-50 text-ink-500'
      }`}
    >
      {ok ? <CheckCircle2 size={12} /> : null} {label}
    </span>
  );
}

function DiagnosisModal({
  open,
  onClose,
  ticketId,
  onSaved,
  defaultCategory,
}: {
  open: boolean;
  onClose: () => void;
  ticketId: string;
  onSaved: () => Promise<void> | void;
  defaultCategory: string;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    summary: '',
    faultCategory: defaultCategory || 'other',
    faultSeverity: 'moderate',
    rootCause: '',
    requiredActions: '',
    needsParts: false,
    isBoardLevel: false,
    diagnosisNotes: '',
    confidence: 'medium',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async () => {
    if (!form.summary.trim()) {
      toast.error('اكتب ملخص التشخيص');
      return;
    }
    setIsSubmitting(true);
    try {
      await api.put(`/tickets/${ticketId}/diagnosis`, {
        summary: form.summary,
        faultCategory: form.faultCategory,
        faultSeverity: form.faultSeverity,
        rootCause: form.rootCause,
        requiredActions: form.requiredActions
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
        needsParts: form.needsParts,
        isBoardLevel: form.isBoardLevel,
        diagnosisNotes: form.diagnosisNotes,
        confidence: form.confidence,
      });
      toast.success('تم تسجيل التشخيص');
      await onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="تسجيل التشخيص الفني"
      size="lg"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            إلغاء
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={isSubmitting}>
            {isSubmitting ? 'جارٍ الحفظ…' : 'حفظ التشخيص'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="ملخص التشخيص" required>
          <textarea
            className="input min-h-[4rem]"
            value={form.summary}
            onChange={(e) => setForm({ ...form, summary: e.target.value })}
            placeholder="مثال: كسر في طبقة الشاشة مع تلف في مسار اللمس"
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="تصنيف العطل">
            <select
              className="input"
              value={form.faultCategory}
              onChange={(e) => setForm({ ...form, faultCategory: e.target.value })}
            >
              {Object.entries(FAULT_CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="درجة الخطورة">
            <select
              className="input"
              value={form.faultSeverity}
              onChange={(e) => setForm({ ...form, faultSeverity: e.target.value })}
            >
              <option value="minor">بسيط</option>
              <option value="moderate">متوسط</option>
              <option value="major">كبير</option>
              <option value="critical">حرج</option>
            </select>
          </Field>
          <Field label="دقة التشخيص">
            <select
              className="input"
              value={form.confidence}
              onChange={(e) => setForm({ ...form, confidence: e.target.value })}
            >
              <option value="low">منخفضة</option>
              <option value="medium">متوسطة</option>
              <option value="high">عالية</option>
            </select>
          </Field>
        </div>

        <Field label="السبب الجذري">
          <textarea
            className="input min-h-[3rem]"
            value={form.rootCause}
            onChange={(e) => setForm({ ...form, rootCause: e.target.value })}
          />
        </Field>

        <Field label="الإجراءات المطلوبة (كل إجراء في سطر)">
          <textarea
            className="input min-h-[4rem]"
            value={form.requiredActions}
            onChange={(e) => setForm({ ...form, requiredActions: e.target.value })}
            placeholder={'فحص دقيق\nاستبدال الجزء التالف\nاختبار بعد الإصلاح'}
          />
        </Field>

        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-xs text-ink-600">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-ink-300"
              checked={form.needsParts}
              onChange={(e) => setForm({ ...form, needsParts: e.target.checked })}
            />
            يحتاج قطع غيار
          </label>
          <label className="flex items-center gap-2 text-xs text-ink-600">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-ink-300"
              checked={form.isBoardLevel}
              onChange={(e) => setForm({ ...form, isBoardLevel: e.target.checked })}
            />
            إصلاح على مستوى البوردة
          </label>
        </div>

        <Field label="ملاحظات التشخيص">
          <textarea
            className="input min-h-[3rem]"
            value={form.diagnosisNotes}
            onChange={(e) => setForm({ ...form, diagnosisNotes: e.target.value })}
          />
        </Field>
      </div>
    </Modal>
  );
}

interface EstimateFormLine {
  kind: 'part' | 'labor' | 'service';
  description: string;
  quantity: number;
  unitPriceEgp: number;
  warrantyDays: number;
}

const EMPTY_ESTIMATE_LINE: EstimateFormLine = { kind: 'labor', description: '', quantity: 1, unitPriceEgp: 0, warrantyDays: 0 };

function EstimateModal({
  open,
  onClose,
  ticketId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  ticketId: string;
  onSaved: () => Promise<void> | void;
}) {
  const toast = useToast();
  const [lines, setLines] = useState<EstimateFormLine[]>([{ ...EMPTY_ESTIMATE_LINE }]);
  const [discountEgp, setDiscountEgp] = useState(0);
  const [taxRatePct, setTaxRatePct] = useState(14);
  const [warrantyOfferedDays, setWarrantyOfferedDays] = useState(0);
  const [terms, setTerms] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const updateLine = (index: number, patch: Partial<EstimateFormLine>) => {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };

  const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.unitPriceEgp, 0);

  const submit = async () => {
    const valid = lines.filter((line) => line.description.trim().length >= 2);
    if (!valid.length) {
      toast.error('أضف بندًا واحدًا على الأقل بوصف واضح');
      return;
    }
    setIsSubmitting(true);
    try {
      await api.post('/estimates', {
        ticketId,
        lines: valid.map((line) => ({
          kind: line.kind,
          description: line.description.trim(),
          quantity: line.quantity,
          unitPriceEgp: line.unitPriceEgp,
          warrantyDays: line.warrantyDays,
        })),
        discountEgp,
        taxRatePct,
        warrantyOfferedDays,
        terms,
      });
      toast.success('تم إنشاء عرض السعر (مسودة) — أرسله للعميل من البطاقة');
      setLines([{ ...EMPTY_ESTIMATE_LINE }]);
      setDiscountEgp(0);
      setWarrantyOfferedDays(0);
      setTerms('');
      await onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="عرض سعر جديد"
      subtitle="يُنشأ كمسودة، ثم يُرسل للعميل للموافقة"
      size="lg"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            إلغاء
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={isSubmitting}>
            {isSubmitting ? 'جارٍ الحفظ…' : 'إنشاء المسودة'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="label mb-0">البنود</p>
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => setLines((current) => [...current, { ...EMPTY_ESTIMATE_LINE }])}
            >
              <Plus size={13} /> إضافة بند
            </button>
          </div>
          {lines.map((line, index) => (
            <div key={index} className="grid gap-2 rounded-lg border border-ink-200 p-2.5 sm:grid-cols-12">
              <div className="sm:col-span-2">
                <Field label="النوع">
                  <select
                    className="input"
                    value={line.kind}
                    onChange={(e) => updateLine(index, { kind: e.target.value as EstimateFormLine['kind'] })}
                  >
                    <option value="labor">مصنعية</option>
                    <option value="part">قطعة</option>
                    <option value="service">خدمة</option>
                  </select>
                </Field>
              </div>
              <div className="sm:col-span-5">
                <Field label="الوصف">
                  <input
                    className="input"
                    value={line.description}
                    onChange={(e) => updateLine(index, { description: e.target.value })}
                    placeholder="مثال: شاشة أصلية + تركيب"
                  />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="الكمية">
                  <input
                    type="number"
                    min={0}
                    className="input num"
                    value={line.quantity}
                    onChange={(e) => updateLine(index, { quantity: Number(e.target.value) })}
                  />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="سعر الوحدة">
                  <input
                    type="number"
                    min={0}
                    className="input num"
                    value={line.unitPriceEgp}
                    onChange={(e) => updateLine(index, { unitPriceEgp: Number(e.target.value) })}
                  />
                </Field>
              </div>
              <div className="flex items-end justify-end sm:col-span-1">
                <button
                  type="button"
                  className="btn-ghost text-xs text-red-600"
                  onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                  disabled={lines.length === 1}
                  title="حذف البند"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="خصم (جنيه)">
            <input
              type="number"
              min={0}
              className="input num"
              value={discountEgp}
              onChange={(e) => setDiscountEgp(Number(e.target.value))}
            />
          </Field>
          <Field label="ضريبة %">
            <input
              type="number"
              min={0}
              max={100}
              className="input num"
              value={taxRatePct}
              onChange={(e) => setTaxRatePct(Number(e.target.value))}
            />
          </Field>
          <Field label="ضمان مُعرض (يوم)">
            <input
              type="number"
              min={0}
              className="input num"
              value={warrantyOfferedDays}
              onChange={(e) => setWarrantyOfferedDays(Number(e.target.value))}
            />
          </Field>
        </div>

        <Field label="شروط وملاحظات">
          <textarea
            className="input min-h-[3rem]"
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
            placeholder="مثال: الضمان لا يشمل أضرار السوائل، ومدة التنفيذ 48 ساعة"
          />
        </Field>

        <div className="rounded-lg bg-ink-50 p-3 text-xs text-ink-600">
          الإجمالي قبل الضريبة: <span className="num font-bold">{formatMoney(Math.max(subtotal - discountEgp, 0))}</span>
        </div>
      </div>
    </Modal>
  );
}

void qs;
void PRIORITY_LABELS;
