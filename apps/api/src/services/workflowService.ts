import { INACTIVE_REPAIR_STATUSES } from '../constants/repair.js';
import { Types } from 'mongoose';
import { RepairTicketModel, type RepairTicketDoc } from '../models/RepairTicket.js';
import { RepairPartModel } from '../models/RepairPart.js';
import { RepairStatusHistoryModel } from '../models/RepairStatusHistory.js';
import { EstimateModel } from '../models/Estimate.js';
import { QualityCheckModel } from '../models/QualityCheck.js';
import { InvoiceModel } from '../models/Invoice.js';
import { DeviceModel } from '../models/Device.js';
import { OrganizationModel } from '../models/Organization.js';
import {
  canTransition,
  REPAIR_STATUS_LABELS_AR,
  SLA_HOURS_BY_PRIORITY,
  type RepairStatus,
  type TimelineEventType,
} from '../constants/repair.js';
import { ApiError } from '../utils/ApiError.js';
import { addHours, diffMinutes } from '../utils/dates.js';
import { money } from '../utils/money.js';
import { recordAudit } from './auditService.js';
import { notifyTicketEvent } from './notificationService.js';
import { applyStockMovement } from './inventoryService.js';
import { getTenantContext } from '../context/tenantContext.js';
import { logger } from '../config/logger.js';

export interface ActingUser {
  userId: Types.ObjectId | string;
  fullName: string;
  role: string;
}

export interface TransitionOptions {
  note?: string;
  station?: string;
  metadata?: Record<string, unknown>;
  /** تجاوز فحص الصلاحية (لعمليات النظام الداخلية مثل بوابة العميل) */
  systemOverride?: boolean;
  reason?: string;
  /** false = تخطي إشعار العميل التلقائي المرتبط بالحالة (عند إرسال رسالة مخصصة في نفس العملية) */
  notifyCustomer?: boolean;
}

/** حالات تتطلب موافقة عميل على عرض سعر */
const NEEDS_APPROVAL: RepairStatus[] = ['approved', 'waiting_part', 'repairing', 'testing_qc'];

/** حالات تتطلب اجتياز فحص الجودة */
const NEEDS_QC: RepairStatus[] = ['ready', 'customer_notified', 'paid'];

/** حالات تتطلب سداد كامل */
const NEEDS_PAYMENT: RepairStatus[] = ['delivered'];

export async function getTicketOrFail(ticketId: string | Types.ObjectId): Promise<RepairTicketDoc> {
  if (!Types.ObjectId.isValid(String(ticketId))) throw ApiError.badRequest('معرّف التذكرة غير صحيح');
  const ticket = await RepairTicketModel.findById(ticketId);
  if (!ticket) throw ApiError.notFound('تذكرة الصيانة غير موجودة');
  return ticket;
}

/** حساب تاريخ الاستحقاق وفق الأولوية وإعدادات المؤسسة */
export function computeDueAt(priority: keyof typeof SLA_HOURS_BY_PRIORITY, base = new Date(), defaultSlaHours?: number): Date {
  const hours = defaultSlaHours && defaultSlaHours > 0 ? Math.min(SLA_HOURS_BY_PRIORITY[priority] ?? 72, defaultSlaHours) : (SLA_HOURS_BY_PRIORITY[priority] ?? 72);
  return addHours(base, hours);
}

/**
 * تسجيل حدث في الـTimeline (Repair Timeline / Chain of Custody).
 * يدعم أحداث تغيير الحالة وأحداثًا أخرى (تعيين، تشخيص، دفعة، ...).
 */
export async function recordTimelineEvent(params: {
  ticket: RepairTicketDoc;
  eventType: TimelineEventType;
  fromStatus?: RepairStatus | null;
  toStatus?: RepairStatus;
  note?: string;
  actor?: ActingUser | null;
  technicianId?: string | Types.ObjectId | null;
  station?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { ticket, eventType } = params;

  const previous = await RepairStatusHistoryModel.findOne({ ticketId: ticket._id })
    .sort({ createdAt: -1 })
    .select('createdAt toStatus')
    .lean();

  const durationMinutes = previous?.createdAt
    ? diffMinutes(previous.createdAt as unknown as Date, new Date())
    : diffMinutes(ticket.createdAt ?? new Date(), new Date());

  await RepairStatusHistoryModel.create({
    organizationId: ticket.organizationId,
    branchId: ticket.branchId,
    ticketId: ticket._id,
    deviceId: ticket.deviceId,
    fromStatus: params.fromStatus ?? (previous?.toStatus as RepairStatus) ?? null,
    toStatus: params.toStatus ?? (ticket.status as RepairStatus),
    eventType,
    note: params.note ?? '',
    actorId: params.actor?.userId ?? null,
    actorName: params.actor?.fullName ?? 'النظام',
    actorRole: params.actor?.role ?? 'system',
    technicianId: params.technicianId ?? ticket.assignedTechnicianId ?? null,
    durationMinutes,
    station: params.station ?? '',
    metadata: params.metadata ?? {},
  });
}

interface GuardContext {
  requireApproval: boolean;
  requireQc: boolean;
}

async function loadOrgGuardContext(organizationId: Types.ObjectId): Promise<GuardContext> {
  const org = await OrganizationModel.findById(organizationId).select('settings').lean();
  return {
    requireApproval: org?.settings?.requireApprovalBeforeRepair ?? true,
    requireQc: org?.settings?.requireQcBeforeReady ?? true,
  };
}

async function assertApprovalSatisfied(ticket: RepairTicketDoc, target: RepairStatus, guards: GuardContext): Promise<void> {
  if (!guards.requireApproval) return;
  if (!NEEDS_APPROVAL.includes(target)) return;

  const approved = await EstimateModel.findOne({
    ticketId: ticket._id,
    status: { $in: ['approved', 'partially_approved'] },
  })
    .select('_id estimateNumber totals')
    .lean();

  if (!approved) {
    throw ApiError.businessRule(
      'لا يمكن بدء الإصلاح قبل موافقة العميل على عرض السعر',
      { ticketId: String(ticket._id), targetStatus: target },
    );
  }
}

async function assertQcSatisfied(ticket: RepairTicketDoc, target: RepairStatus, guards: GuardContext): Promise<void> {
  if (!guards.requireQc) return;
  if (!NEEDS_QC.includes(target)) return;

  const passed = await QualityCheckModel.findOne({
    ticketId: ticket._id,
    result: { $in: ['passed', 'passed_with_notes'] },
  })
    .select('_id attempt result')
    .lean();

  if (!passed) {
    throw ApiError.businessRule(
      'لا يمكن تجهيز الجهاز للتسليم قبل اجتياز فحص الجودة (QC)',
      { ticketId: String(ticket._id), targetStatus: target },
    );
  }
}

async function assertPaymentSatisfied(ticket: RepairTicketDoc, target: RepairStatus): Promise<void> {
  if (!NEEDS_PAYMENT.includes(target)) return;

  // كل الفواتير غير الملغاة — تذكرة قد تحمل أكثر من فاتورة (أصلية + تكميلية)
  const invoices = await InvoiceModel.find({ ticketId: ticket._id, status: { $ne: 'void' } })
    .select('totals status invoiceNumber')
    .sort({ createdAt: 1 })
    .lean();

  if (!invoices.length) {
    // لا توجد فاتورة: مسموح فقط إذا كان الإصلاح بدون مقابل (ضمان مثلًا)
    const total = ticket.cost?.totalFinalEgp ?? 0;
    if (total > 0.009) {
      throw ApiError.businessRule('لا يمكن تسليم الجهاز قبل إصدار فاتورة وسداد المستحق', {
        ticketId: String(ticket._id),
        totalEgp: total,
      });
    }
    return;
  }

  // البوابة تفحص مجموع المستحق على كل الفواتير، وليس أول فاتورة فقط
  const unpaidInvoices = invoices.filter((inv) => (inv.totals?.dueEgp ?? 0) > 0.009);
  if (unpaidInvoices.length) {
    const totalDue = money(invoices.reduce((sum, inv) => sum + (inv.totals?.dueEgp ?? 0), 0));
    throw ApiError.businessRule('لا يمكن تسليم الجهاز قبل سداد المبلغ المتبقي', {
      ticketId: String(ticket._id),
      invoiceNumber: unpaidInvoices[0]!.invoiceNumber,
      dueEgp: unpaidInvoices[0]!.totals?.dueEgp ?? 0,
      totalDueEgp: totalDue,
      unpaidCount: unpaidInvoices.length,
    });
  }
}

/**
 * فك حجز القطع «المحجوزة» على تذكرة مُلغاة/غير قابلة للإصلاح وإرجاعها لرصيد فرعها الأصلي.
 * الحجز تم في فرع من أضاف القطعة (`RepairPart.branchId`)، وقد يختلف عن فرع من يُغلق الطلب
 * (مثل الاستقبال في فرع آخر)، ففك الحجز بفرع المُلغي يترك الحجز عالقًا في فرع الفني.
 * القطع المركّبة لا تُفك — استُهلك فعلًا. فشل فك حجز بند لا يُسقط إغلاق التذكرة.
 */
async function releaseReservedPartsForClosedTicket(ticket: RepairTicketDoc, actor: ActingUser): Promise<void> {
  if (!getTenantContext()) {
    logger.warn({ ticket: ticket.ticketNumber }, 'إغلاق تذكرة بلا سياق مستأجر — تُركت القطع المحجوزة دون فك');
    return;
  }
  const reservedParts = await RepairPartModel.find({ ticketId: ticket._id, status: 'reserved' });
  for (const part of reservedParts) {
    try {
      await applyStockMovement({
        partId: part.partId,
        type: 'release',
        quantity: -part.quantity,
        branchId: part.branchId ?? ticket.branchId,
        ticketId: ticket._id,
        repairPartId: part._id,
        reason: `إغلاق التذكرة ${ticket.ticketNumber} — فك الحجز`,
        actor: { userId: actor.userId, fullName: actor.fullName },
      });
      part.status = 'removed';
      part.removedAt = new Date();
      part.notes = part.notes ? `${part.notes}\nأُغلقت التذكرة — فُكّ الحجز` : 'أُغلقت التذكرة — فُكّ الحجز';
      await part.save();
    } catch (err) {
      logger.warn(
        { err, ticket: ticket.ticketNumber, repairPartId: String(part._id) },
        'تعذّر فك حجز قطعة عند إغلاق التذكرة — راجع المخزون يدويًا',
      );
    }
  }
}

/**
 * محرّك الانتقال بين حالات تذكرة الصيانة.
 * يفرض: الانتقالات المسموحة + قواعد العمل (موافقة، QC، سداد) + تسجيل الـTimeline + الإشعارات.
 */
export async function transitionTicket(
  ticketId: string | Types.ObjectId,
  target: RepairStatus,
  actor: ActingUser,
  options: TransitionOptions = {},
): Promise<RepairTicketDoc> {
  const ticket = await getTicketOrFail(ticketId);
  const current = ticket.status as RepairStatus;

  if (current === target) {
    throw ApiError.businessRule(`التذكرة بالفعل في حالة «${REPAIR_STATUS_LABELS_AR[target]}»`);
  }

  if (!canTransition(current, target)) {
    throw ApiError.invalidTransition(
      `الانتقال من «${REPAIR_STATUS_LABELS_AR[current] ?? current}» إلى «${REPAIR_STATUS_LABELS_AR[target] ?? target}» غير مسموح`,
      { from: current, to: target },
    );
  }

  if (!options.systemOverride) {
    const guards = await loadOrgGuardContext(ticket.organizationId);
    await assertApprovalSatisfied(ticket, target, guards);
    await assertQcSatisfied(ticket, target, guards);
    await assertPaymentSatisfied(ticket, target);
  }

  const now = new Date();
  ticket.status = target;

  // طوابع زمنية خاصة بالمرحلة (تُضبط مرة واحدة)
  if (target === 'repairing' && !ticket.repairingStartedAt) ticket.repairingStartedAt = now;
  if (target === 'testing_qc' && !ticket.qcStartedAt) ticket.qcStartedAt = now;
  if (target === 'ready' && !ticket.readyAt) ticket.readyAt = now;
  if (target === 'delivered') {
    ticket.deliveredAt = now;
    ticket.closedBy = new Types.ObjectId(String(actor.userId));
  }

  // بدء الضمان عند التسليم
  if (target === 'delivered' && ticket.warranty && !ticket.warranty.startsAt) {
    const days = ticket.warranty.policyDays || 0;
    ticket.warranty.startsAt = now;
    ticket.warranty.expiresAt = days > 0 ? addHours(now, days * 24) : null;
  }

  // نتيجة الإصلاح
  if (target === 'delivered' && ticket.outcome === 'pending') ticket.outcome = 'repaired';
  if (target === 'unrepairable') ticket.outcome = 'device_unrepairable';
  if (target === 'cancelled' && !ticket.cancelReason) ticket.cancelReason = options.reason ?? options.note ?? '';

  // إغلاق الطلب (إلغاء/غير قابل للإصلاح) يعيد القطع المحجوزة لمخزون فرعها الأصلي —
  // الحجز تم في فرع من أضاف القطعة، وقد يختلف عن فرع من يُلغي الطلب
  if (target === 'cancelled' || target === 'unrepairable') {
    await releaseReservedPartsForClosedTicket(ticket, actor);
  }

  // إيقاف/تشغيل عدّاد الـSLA عند انتظار العميل أو القطعة
  if (target === 'waiting_approval' || target === 'waiting_part') {
    ticket.sla.pausedAt = now;
  } else if (ticket.sla.pausedAt) {
    const pausedMinutes = diffMinutes(ticket.sla.pausedAt, now);
    ticket.sla.pausedMinutes = (ticket.sla.pausedMinutes ?? 0) + pausedMinutes;
    ticket.sla.pausedAt = null;
    if (ticket.sla.dueAt) ticket.sla.dueAt = addHours(ticket.sla.dueAt, pausedMinutes / 60);
  }

  // فحص الـSLA
  if (ticket.sla.dueAt && !ticket.sla.breached && now.getTime() > ticket.sla.dueAt.getTime()) {
    ticket.sla.breached = true;
    ticket.sla.breachedAt = now;
  }

  await ticket.save();

  await recordTimelineEvent({
    ticket,
    eventType: 'status_changed',
    fromStatus: current,
    toStatus: target,
    note: options.note ?? '',
    actor,
    station: options.station,
    metadata: options.metadata,
  });

  // إشعارات العميل المرتبطة بالحالة (تُتخطى إذا أرسل المتصل رسالة مخصصة بنفسه)
  if (options.notifyCustomer !== false) {
    await notifyTicketEvent(ticket, target, actor, current);
  }

  await recordAudit({
    action: 'status_transition',
    resource: 'RepairTicket',
    resourceId: String(ticket._id),
    summary: `تغيير حالة التذكرة ${ticket.ticketNumber}: ${REPAIR_STATUS_LABELS_AR[current]} → ${REPAIR_STATUS_LABELS_AR[target]}`,
    changes: [{ field: 'status', before: current, after: target }],
  });

  // تحديث جواز الجهاز (Device Passport)
  await syncDevicePassport(ticket);

  return ticket;
}

/**
 * تحديث ملخص جواز الجهاز (Device Passport):
 * عدد الإصلاحات، المبالغ، القطع المستبدلة، آخر فني، آخر خدمة.
 */
export async function syncDevicePassport(ticket: RepairTicketDoc): Promise<void> {
  const status = ticket.status as RepairStatus;

  const device = await DeviceModel.findById(ticket.deviceId);
  if (!device) return;

  // القطع المستبدلة تُقرأ من جدول RepairPart عند الحاجة لعرض تفصيلي
  const repairsDelta = status === 'delivered' ? 1 : 0;
  device.passport.lastServiceAt = new Date();
  if (ticket.assignedTechnicianId) device.passport.lastTechnicianId = ticket.assignedTechnicianId;
  if (repairsDelta) {
    device.passport.totalRepairs = (device.passport.totalRepairs ?? 0) + repairsDelta;
    device.passport.totalSpentEgp = Number(
      ((device.passport.totalSpentEgp ?? 0) + (ticket.cost?.totalFinalEgp ?? 0)).toFixed(2),
    );
  }

  // عدد التذاكر المفتوحة للجهاز
  const openCount = await RepairTicketModel.countDocuments({
    deviceId: device._id,
    status: { $nin: INACTIVE_REPAIR_STATUSES },
  });
  device.passport.openTickets = openCount;

  // علامات الخطر
  const flags = new Set(device.passport.riskFlags ?? []);
  if (ticket.intake?.visualCondition?.waterDamageSigns) flags.add('liquid_damage');
  if (ticket.diagnosis?.isBoardLevel) flags.add('board_level');
  if ((device.passport.totalRepairs ?? 0) > 1) flags.add('previous_repair');
  device.passport.riskFlags = [...flags];

  await device.save();
}

/** فحص الـSLA لكل التذاكر المفتوحة (مهمة مجدولة) */
export async function scanSlaBreaches(organizationId: Types.ObjectId): Promise<number> {
  const now = new Date();
  const result = await RepairTicketModel.updateMany(
    {
      organizationId,
      status: { $nin: INACTIVE_REPAIR_STATUSES },
      'sla.dueAt': { $lt: now },
      'sla.breached': false,
    },
    { $set: { 'sla.breached': true, 'sla.breachedAt': now } },
  );
  return result.modifiedCount ?? 0;
}

/**
 * التحقق من أن المستخدم الحالي يقدر على العمل على التذكرة.
 * requireAssignment=true (مسارات التشخيص/التسعير/القطع): الفني لا يكتب إلا على تذكرة مسندة إليه،
 * حتى لا يعمل فني على طلب لم يُسند له أصلًا.
 */
export function assertTechnicianOwnership(
  ticket: RepairTicketDoc,
  actor: ActingUser,
  isManager: boolean,
  requireAssignment = false,
): void {
  if (isManager) return;
  const assigned = ticket.assignedTechnicianId ? String(ticket.assignedTechnicianId) : null;
  if (!assigned) {
    if (requireAssignment) throw ApiError.forbidden('هذه التذكرة غير مسندة إليك');
    return;
  }
  if (assigned !== String(actor.userId)) {
    throw ApiError.forbidden('هذه التذكرة مسندة إلى فني آخر');
  }
}

export function currentActorFromContext(): ActingUser | null {
  const ctx = getTenantContext();
  if (!ctx) return null;
  return { userId: ctx.actor.userId, fullName: ctx.actor.fullName, role: ctx.actor.role };
}
