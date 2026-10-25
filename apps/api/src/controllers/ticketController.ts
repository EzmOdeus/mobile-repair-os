import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { RepairTicketModel } from '../models/RepairTicket.js';
import { RepairStatusHistoryModel } from '../models/RepairStatusHistory.js';
import { RepairNoteModel } from '../models/RepairNote.js';
import { RepairPartModel } from '../models/RepairPart.js';
import { RepairLaborModel } from '../models/RepairLabor.js';
import { QualityCheckModel } from '../models/QualityCheck.js';
import { EstimateModel } from '../models/Estimate.js';
import { ApprovalModel } from '../models/Approval.js';
import { InvoiceModel } from '../models/Invoice.js';
import { CustomerModel } from '../models/Customer.js';
import { DeviceModel } from '../models/Device.js';
import { PartModel } from '../models/Part.js';
import { SupplierModel } from '../models/Supplier.js';
import { StoredFileModel } from '../models/StoredFile.js';
import { UserModel } from '../models/User.js';
import { OrganizationModel } from '../models/Organization.js';
import { ApiError } from '../utils/ApiError.js';
import { created, ok, paginated } from '../utils/asyncHandler.js';
import { parseCsv, parseDateRange, parseListQuery, parseSort, regexSearch } from '../utils/queryHelpers.js';
import { branchFilter, getAuth, requireBranchAccess } from '../middleware/auth.js';
import { getTenantContext } from '../context/tenantContext.js';
import { recordAudit } from '../services/auditService.js';
import { assertTicketLimit } from '../services/planService.js';
import { notifyUser } from '../services/notificationService.js';
import { logger } from '../config/logger.js';
import {
  REPAIR_STATUS_LABELS_AR,
  REPAIR_STATUS_ORDER,
  ACTIVE_REPAIR_STATUSES,
  REPAIR_TRANSITIONS,
  SLA_HOURS_BY_PRIORITY,
  TICKET_PRIORITY_LABELS_AR,
  type RepairStatus,
  type TicketPriority,
} from '../constants/repair.js';
import {
  assertTechnicianOwnership,
  computeDueAt,
  getTicketOrFail,
  recordTimelineEvent,
  transitionTicket,
} from '../services/workflowService.js';
import { nextTicketNumber, nextTrackingToken, withUniqueRetry } from '../services/numberingService.js';
import { normalizeEgyptPhone } from '../validators/common.js';
import { saveFile, publicFileUrl } from '../services/storageService.js';
import { addHours, diffMinutes } from '../utils/dates.js';
import type { CreateTicketInput, DiagnosisInput } from '../validators/coreValidators.js';


/** الفني لا يرى في القوائم إلا التذاكر المسندة إليه شخصيًا */
function technicianScopeFilter(req: Request): Record<string, unknown> {
  const auth = getAuth(req);
  if (auth.role === 'technician') return { assignedTechnicianId: new Types.ObjectId(auth.userId) };
  return {};
}

/**
 * يتحقق أن المستخدم فني نشط يخدم فرع التذكرة ولديه سعة مهام.
 * الإسناد يجب أن يمر من هنا في الإنشاء والتعديل معًا حتى لا يلتف عميل API
 * على قيود شاشة الإسناد (فرع آخر/سعة ممتلئة/حساب ليس فنيًا).
 */
async function resolveAssignableTechnician(
  organizationId: Types.ObjectId,
  technicianId: string,
  branchId: Types.ObjectId,
): Promise<Types.ObjectId> {
  const technician = await UserModel.findOne({ _id: technicianId, organizationId })
    .select('role isActive technicianProfile branchIds')
    .lean();
  if (!technician) throw ApiError.notFound('الفني غير موجود');
  if (technician.role !== 'technician' && !technician.technicianProfile?.isTechnician) {
    throw ApiError.businessRule('المستخدم المحدد ليس فنيًا');
  }
  if (!technician.isActive) throw ApiError.businessRule('الفني غير نشط');
  if (!(technician.branchIds ?? []).some((id) => String(id) === String(branchId))) {
    throw ApiError.businessRule('الفني لا يخدم فرع التذكرة');
  }

  const maxJobs = technician.technicianProfile?.maxActiveJobs ?? 5;
  const currentJobs = await RepairTicketModel.countDocuments({
    organizationId,
    assignedTechnicianId: technician._id,
    status: { $in: ACTIVE_REPAIR_STATUSES },
  });
  if (currentJobs >= maxJobs) {
    throw ApiError.businessRule(`الفني وصل للحد الأقصى من المهام النشطة (${maxJobs})`, { currentJobs, maxJobs });
  }
  return technician._id as Types.ObjectId;
}

const SORTABLE = ['createdAt', 'updatedAt', 'priority', 'sla.dueAt', 'cost.totalFinalEgp', 'ticketNumber'];

function statusLabel(status: string): string {
  return REPAIR_STATUS_LABELS_AR[status as RepairStatus] ?? status;
}

function buildTicketFilter(req: Request): Record<string, unknown> {
  const query = req.query as Record<string, unknown>;
  const filter: Record<string, unknown> = {};

  const search = regexSearch(query.q);
  if (search) {
    filter.$or = [
      { ticketNumber: search },
      { 'intake.complaint': search },
      { 'diagnosis.summary': search },
      { trackingToken: search },
    ];
  }

  const statuses = parseCsv(query.status);
  if (statuses.length) filter.status = { $in: statuses };
  else if (query.openOnly === 'true') filter.status = { $in: ACTIVE_REPAIR_STATUSES };

  const priorities = parseCsv(query.priority);
  if (priorities.length) filter.priority = { $in: priorities };

  if (query.customerId) filter.customerId = query.customerId;
  if (query.deviceId) filter.deviceId = query.deviceId;
  if (query.technicianId) {
    filter.assignedTechnicianId = query.technicianId === 'unassigned' ? null : query.technicianId;
  }
  if (query.slaBreached !== undefined) filter['sla.breached'] = query.slaBreached === 'true';

  const branchId = branchFilter(req);
  if (branchId) filter.branchId = branchId;

  const range = parseDateRange(query.from, query.to);
  if (range) filter.createdAt = range;

  return filter;
}

/**
 * قائمة التذاكر.
 * نجلب الكيانات المرتبطة باستعلامات صريحة النطاق (organizationId) بدل populate،
 * لأن استعلامات الـpopulate الداخلية لا تحمل مرشّح المؤسسة فيرفضها tenantPlugin.
 */
export const listTickets = async (req: Request, res: Response) => {
  const ctx = getTenantContext();
  const organizationId = ctx!.organizationId;

  const { page, limit, skip } = parseListQuery(req.query as Record<string, unknown>, 30);
  const sort = parseSort(req.query as Record<string, unknown>, SORTABLE, { createdAt: -1 });
  const filter = { ...buildTicketFilter(req), ...technicianScopeFilter(req), organizationId };

  const [items, total] = await Promise.all([
    RepairTicketModel.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    RepairTicketModel.countDocuments(filter),
  ]);

  const customerIds = [...new Set(items.map((t) => String(t.customerId)))];
  const deviceIds = [...new Set(items.map((t) => String(t.deviceId)))];
  const technicianIds = [...new Set(items.map((t) => (t.assignedTechnicianId ? String(t.assignedTechnicianId) : '')).filter(Boolean))];

  const [customers, devices, technicians] = await Promise.all([
    customerIds.length
      ? CustomerModel.find({ _id: { $in: customerIds }, organizationId }).select('fullName phone whatsapp companyName').lean()
      : Promise.resolve([]),
    deviceIds.length
      ? DeviceModel.find({ _id: { $in: deviceIds }, organizationId }).select('brand model color storage imei category').lean()
      : Promise.resolve([]),
    technicianIds.length
      ? UserModel.find({ _id: { $in: technicianIds }, organizationId }).select('fullName username').lean()
      : Promise.resolve([]),
  ]);

  const customerMap = new Map(customers.map((c) => [String(c._id), c]));
  const deviceMap = new Map(devices.map((d) => [String(d._id), d]));
  const technicianMap = new Map(technicians.map((t) => [String(t._id), t]));

  return paginated(
    res,
    items.map((t) => ({
      ...t,
      customerId: customerMap.get(String(t.customerId)) ?? null,
      deviceId: deviceMap.get(String(t.deviceId)) ?? null,
      assignedTechnicianId: t.assignedTechnicianId ? (technicianMap.get(String(t.assignedTechnicianId)) ?? null) : null,
      statusLabel: statusLabel(t.status),
      priorityLabel: TICKET_PRIORITY_LABELS_AR[t.priority as TicketPriority] ?? t.priority,
      isOverdue: Boolean(t.sla?.dueAt && new Date(t.sla.dueAt).getTime() < Date.now()),
    })),
    { page, limit, total },
  );
};

/** لوحة العمل (Kanban): التذاكر مجمّعة حسب الحالة مع الأعداد */
export const ticketBoard = async (req: Request, res: Response) => {
  const ctx = getTenantContext();
  const organizationId = ctx!.organizationId;
  const query = req.query as Record<string, unknown>;

  const filter: Record<string, unknown> = {
    organizationId,
    status: { $in: ACTIVE_REPAIR_STATUSES },
  };
  const scopedBranch = branchFilter(req);
  if (scopedBranch) filter.branchId = scopedBranch;
  if (query.technicianId) filter.assignedTechnicianId = query.technicianId;

  // عزل الفني: لا يرى اللوحة إلا بتذاكره هو
  const scope = technicianScopeFilter(req);
  if (scope.assignedTechnicianId) filter.assignedTechnicianId = scope.assignedTechnicianId;

  const tickets = await RepairTicketModel.find(filter)
    .select('ticketNumber status priority assignedTechnicianId customerId deviceId sla.dueAt createdAt cost intake.complaint')
    .sort({ priority: -1, 'sla.dueAt': 1 })
    .limit(600)
    .lean();

  const customerIds = [...new Set(tickets.map((t) => String(t.customerId)))];
  const deviceIds = [...new Set(tickets.map((t) => String(t.deviceId)))];
  const technicianIds = [...new Set(tickets.map((t) => (t.assignedTechnicianId ? String(t.assignedTechnicianId) : '')).filter(Boolean))];

  const [customers, devices, technicians] = await Promise.all([
    customerIds.length
      ? CustomerModel.find({ _id: { $in: customerIds }, organizationId }).select('fullName phone').lean()
      : Promise.resolve([]),
    deviceIds.length
      ? DeviceModel.find({ _id: { $in: deviceIds }, organizationId }).select('brand model').lean()
      : Promise.resolve([]),
    technicianIds.length
      ? UserModel.find({ _id: { $in: technicianIds }, organizationId }).select('fullName').lean()
      : Promise.resolve([]),
  ]);

  const customerMap = new Map(customers.map((c) => [String(c._id), c]));
  const deviceMap = new Map(devices.map((d) => [String(d._id), d]));
  const technicianMap = new Map(technicians.map((t) => [String(t._id), t]));

  const columns = ACTIVE_REPAIR_STATUSES.map((status) => ({
    status,
    label: REPAIR_STATUS_LABELS_AR[status],
    order: REPAIR_STATUS_ORDER[status],
    count: 0,
    tickets: [] as unknown[],
  }));

  const byStatus = new Map(columns.map((c) => [c.status, c]));
  const now = Date.now();

  for (const ticket of tickets) {
    const column = byStatus.get(ticket.status as RepairStatus);
    if (!column) continue;
    column.count += 1;
    column.tickets.push({
      ...ticket,
      customerId: customerMap.get(String(ticket.customerId)) ?? null,
      deviceId: deviceMap.get(String(ticket.deviceId)) ?? null,
      assignedTechnicianId: ticket.assignedTechnicianId ? (technicianMap.get(String(ticket.assignedTechnicianId)) ?? null) : null,
      statusLabel: statusLabel(ticket.status),
      isOverdue: Boolean(ticket.sla?.dueAt && new Date(ticket.sla.dueAt).getTime() < now),
    });
  }

  return ok(res, {
    columns,
    totals: {
      active: tickets.length,
      overdue: tickets.filter((t) => t.sla?.dueAt && new Date(t.sla.dueAt).getTime() < now).length,
      unassigned: tickets.filter((t) => !t.assignedTechnicianId).length,
    },
  });
};

/** تفاصيل التذكرة الكاملة: الجهاز، العميل، الـTimeline، القطع، العروض، الفحص، الفاتورة */
export const getTicket = async (req: Request, res: Response) => {
  const ctx = getTenantContext();
  const organizationId = ctx!.organizationId;

  const ticket = await RepairTicketModel.findOne({ _id: String(req.params.id), organizationId }).lean();
  if (!ticket) throw ApiError.notFound('التذكرة غير موجودة');
  requireBranchAccess(req, ticket.branchId);

  // عزل الفني: لا يفتح تفاصيل تذكرة غير مسندة إليه
  const auth = getAuth(req);
  if (auth.role === 'technician' && String(ticket.assignedTechnicianId ?? '') !== auth.userId) {
    throw ApiError.forbidden('هذه التذكرة غير مسندة إليك');
  }

  const [
    customer,
    device,
    technician,
    timeline,
    notes,
    parts,
    labor,
    qualityChecks,
    estimates,
    approvals,
    invoices,
    files,
    organization,
  ] = await Promise.all([
    CustomerModel.findOne({ _id: ticket.customerId, organizationId }).lean(),
    DeviceModel.findOne({ _id: ticket.deviceId, organizationId }).lean(),
    ticket.assignedTechnicianId
      ? UserModel.findOne({ _id: ticket.assignedTechnicianId, organizationId })
          .select('fullName username technicianProfile.skillLevel')
          .lean()
      : Promise.resolve(null),
    RepairStatusHistoryModel.find({ organizationId, ticketId: ticket._id }).sort({ createdAt: -1 }).lean(),
    RepairNoteModel.find({ organizationId, ticketId: ticket._id }).sort({ isPinned: -1, createdAt: -1 }).lean(),
    RepairPartModel.find({ organizationId, ticketId: ticket._id }).lean(),
    RepairLaborModel.find({ organizationId, ticketId: ticket._id }).lean(),
    QualityCheckModel.find({ organizationId, ticketId: ticket._id }).sort({ attempt: -1 }).lean(),
    EstimateModel.find({ organizationId, ticketId: ticket._id }).sort({ version: -1 }).lean(),
    ApprovalModel.find({ organizationId, ticketId: ticket._id }).sort({ decidedAt: -1 }).lean(),
    InvoiceModel.find({ organizationId, ticketId: ticket._id }).sort({ createdAt: -1 }).lean(),
    StoredFileModel.find({ organizationId, ticketId: ticket._id, isDeleted: false })
      .select('kind stage caption storageKey mimeType createdAt')
      .sort({ createdAt: -1 })
      .lean(),
    OrganizationModel.findById(organizationId).select('settings').lean(),
  ]);

  // إثراء القطع ببيانات الكتالوج والمورد
  const partIds = [...new Set(parts.map((p) => String(p.partId)))];
  const supplierIds = [...new Set(parts.map((p) => (p.supplierId ? String(p.supplierId) : '')).filter(Boolean))];

  const [partCatalog, suppliers] = await Promise.all([
    partIds.length
      ? PartModel.find({ _id: { $in: partIds }, organizationId }).select('name sku category grade').lean()
      : Promise.resolve([]),
    supplierIds.length
      ? SupplierModel.find({ _id: { $in: supplierIds }, organizationId }).select('name').lean()
      : Promise.resolve([]),
  ]);

  const partMap = new Map(partCatalog.map((p) => [String(p._id), p]));
  const supplierMap = new Map(suppliers.map((s) => [String(s._id), s]));

  const enrichedParts = parts.map((part) => ({
    ...part,
    partId: partMap.get(String(part.partId)) ?? { name: 'قطعة غير معروفة', sku: '' },
    supplierId: part.supplierId ? (supplierMap.get(String(part.supplierId)) ?? null) : null,
  }));

  const currentStatus = ticket.status as RepairStatus;

  return ok(res, {
    ticket: {
      ...ticket,
      customerId: customer,
      deviceId: device,
      assignedTechnicianId: technician,
      statusLabel: statusLabel(ticket.status),
      priorityLabel: TICKET_PRIORITY_LABELS_AR[ticket.priority as TicketPriority] ?? ticket.priority,
      ageMinutes: diffMinutes(ticket.createdAt as unknown as Date, new Date()),
      isOverdue: Boolean(ticket.sla?.dueAt && new Date(ticket.sla.dueAt).getTime() < Date.now()),
    },
    allowedTransitions: (REPAIR_TRANSITIONS[currentStatus] ?? []).map((s) => ({
      status: s,
      label: REPAIR_STATUS_LABELS_AR[s],
    })),
    timeline,
    notes,
    parts: enrichedParts,
    labor,
    qualityChecks,
    estimates,
    approvals,
    invoices,
    files: files.map((f) => ({ ...f, id: String(f._id), url: publicFileUrl(f.storageKey) })),
    settings: {
      requireApprovalBeforeRepair: organization?.settings?.requireApprovalBeforeRepair ?? true,
      requireQcBeforeReady: organization?.settings?.requireQcBeforeReady ?? true,
      requireIntakePhotos: organization?.settings?.requireIntakePhotos ?? true,
    },
  });
};

/**
 * إنشاء تذكرة صيانة (شاشة الاستقبال).
 * يدعم ثلاثة مسارات: جهاز موجود، أو عميل+جهاز جديدان، أو جهاز جديد لعميل موجود.
 */
export const createTicket = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const ctx = getTenantContext();
  const organizationId = ctx!.organizationId;
  const body = req.body as CreateTicketInput;

  // إعادة إرسال من طابور عدم الاتصال: نُرجع نفس التذكرة بدل إنشاء نسخة ثانية
  if (body.clientRequestId) {
    const existing = await RepairTicketModel.findOne({
      organizationId,
      clientRequestId: body.clientRequestId,
      createdBy: new Types.ObjectId(auth.userId),
    }).lean();
    if (existing) {
      return ok(res, {
        ticket: { ...existing, statusLabel: statusLabel(existing.status) },
        trackingUrl: `/track/${existing.trackingToken}`,
        idempotentReplay: true,
      });
    }
  }

  // فرض حد التذاكر الشهري للباقة قبل أي كتابة
  await assertTicketLimit(organizationId);

  let customerId = body.customerId ? new Types.ObjectId(body.customerId) : null;
  let deviceId = body.deviceId ? new Types.ObjectId(body.deviceId) : null;

  // 1) عميل جديد
  if (!customerId && body.newCustomer) {
    const phone = normalizeEgyptPhone(body.newCustomer.phone);
    const existing = await CustomerModel.findOne({ phone, organizationId }).select('_id').lean();
    if (existing) {
      customerId = existing._id as Types.ObjectId;
    } else {
      const count = await CustomerModel.countDocuments({ organizationId });
      const customer = await CustomerModel.create({
        organizationId,
        branchId: ctx!.branchId,
        code: `C${String(count + 1).padStart(5, '0')}`,
        ...body.newCustomer,
        phone,
        whatsapp: body.newCustomer.whatsapp ? normalizeEgyptPhone(body.newCustomer.whatsapp) : phone,
        createdBy: new Types.ObjectId(auth.userId),
      });
      customerId = customer._id as Types.ObjectId;
    }
  }

  // 2) جهاز جديد
  if (!deviceId && body.newDevice) {
    if (!customerId) throw ApiError.badRequest('لازم عميل لإنشاء جهاز');
    const device = await DeviceModel.create({
      organizationId,
      branchId: ctx!.branchId,
      customerId,
      ...body.newDevice,
      createdBy: new Types.ObjectId(auth.userId),
    });
    deviceId = device._id as Types.ObjectId;
  }

  if (!customerId || !deviceId) {
    throw ApiError.badRequest('لازم تحديد العميل والجهاز');
  }

  // التحقق من تطابق العميل مع الجهاز داخل نفس المؤسسة
  const device = await DeviceModel.findOne({ _id: deviceId, organizationId }).select('customerId brand model').lean();
  if (!device) throw ApiError.notFound('الجهاز غير موجود');
  if (String(device.customerId) !== String(customerId)) {
    throw ApiError.businessRule('الجهاز المحدد لا يتبع العميل المحدد');
  }

  const assignedTechnicianId = body.assignedTechnicianId
    ? await resolveAssignableTechnician(organizationId, body.assignedTechnicianId, ctx!.branchId!)
    : null;

  const priority = (body.priority ?? 'normal') as TicketPriority;
  const now = new Date();
  const organization = await OrganizationModel.findById(organizationId).select('settings').lean();
  const dueAt = computeDueAt(priority, now, organization?.settings?.defaultSlaHours);

  const trackingToken = nextTrackingToken();
  const initialTests = (body.intake.initialTests ?? []).map((t) => ({ ...t, checkedAt: null }));

  /**
   * `withUniqueRetry`: يولّد الرقم ثم يُنشئ التذكرة؛ لو صادف رقمًا موجودًا
   * (بعد إعادة تهيئة عدّاد أو استعادة نسخة احتياطية) يعيد المحاولة برقم جديد
   * بدل إفشال عملية الاستقبال على الموظف بـ409.
   */
  const createTicketRecord = async () =>
    withUniqueRetry(
      () => nextTicketNumber(),
      (ticketNumber) =>
        RepairTicketModel.create({
          organizationId,
          branchId: ctx!.branchId,
          ticketNumber,
          clientRequestId: body.clientRequestId ?? null,
          trackingToken,
          customerId,
          deviceId,
          status: 'received',
          priority,
          source: body.source ?? 'walk_in',
          assignedTechnicianId,
          assignedAt: assignedTechnicianId ? now : null,
          assignedBy: assignedTechnicianId ? new Types.ObjectId(auth.userId) : null,
          promisedAt: body.promisedAt ?? null,
          tags: body.tags ?? [],
          internalNotes: body.internalNotes ?? '',
          intake: {
            receivedAt: now,
            receivedBy: new Types.ObjectId(auth.userId),
            complaint: body.intake.complaint,
            complaintCategory: body.intake.complaintCategory ?? '',
            visualCondition: body.intake.visualCondition ?? {},
            accessories: body.intake.accessories ?? [],
            customerAcknowledged: body.intake.customerAcknowledged ?? false,
            acknowledgedAt: body.intake.customerAcknowledged ? now : null,
            dataLossDisclaimerAccepted: body.intake.dataLossDisclaimerAccepted ?? false,
            devicePasswordProvided: body.intake.devicePasswordProvided ?? false,
            initialTests,
            estimatedDeliveryAt: body.intake.estimatedDeliveryAt ?? dueAt,
            internalNotes: body.intake.internalNotes ?? '',
          },
          sla: { dueAt, breached: false, pausedAt: null, pausedMinutes: 0 },
          warranty: {
            policyDays: organization?.settings?.defaultWarrantyDays ?? 30,
            partsDays: organization?.settings?.partsWarrantyDays ?? 90,
            laborDays: organization?.settings?.laborWarrantyDays ?? 14,
          },
          createdBy: new Types.ObjectId(auth.userId),
        }),
    );

  let ticket: Awaited<ReturnType<typeof createTicketRecord>>;
  try {
    ticket = await createTicketRecord();
  } catch (error) {
    // سباق نادر: طلبان بنفس المفتاح وصلًا معًا — الفهرس الفريد يمنع الازدواج
    if (body.clientRequestId && (error as { code?: number }).code === 11000) {
      const existing = await RepairTicketModel.findOne({
        organizationId,
        clientRequestId: body.clientRequestId,
        createdBy: new Types.ObjectId(auth.userId),
      }).lean();
      if (existing) {
        return ok(res, {
          ticket: { ...existing, statusLabel: statusLabel(existing.status) },
          trackingUrl: `/track/${existing.trackingToken}`,
          idempotentReplay: true,
        });
      }
    }
    throw error;
  }

  await recordTimelineEvent({
    ticket,
    eventType: 'created',
    fromStatus: null,
    toStatus: 'received',
    note: `استلام الجهاز: ${body.intake.complaint}`,
    actor: { userId: auth.userId, fullName: auth.fullName, role: auth.role },
    station: 'الاستقبال',
  });

  if (ticket.assignedTechnicianId) {
    await recordTimelineEvent({
      ticket,
      eventType: 'assigned',
      toStatus: 'received',
      note: 'إسناد مبدئي عند الاستلام',
      actor: { userId: auth.userId, fullName: auth.fullName, role: auth.role },
      technicianId: ticket.assignedTechnicianId,
    });
  }

  await DeviceModel.updateOne(
    { _id: deviceId, organizationId },
    { $inc: { 'passport.openTickets': 1 }, $set: { 'passport.lastServiceAt': now } },
  );
  await CustomerModel.updateOne(
    { _id: customerId, organizationId },
    { $inc: { 'stats.totalTickets': 1, 'stats.openTickets': 1 }, $set: { 'stats.lastVisitAt': now } },
  );

  await recordAudit(
    {
      action: 'create',
      resource: 'RepairTicket',
      resourceId: String(ticket._id),
      summary: `تذكرة جديدة ${ticket.ticketNumber} — ${device.brand} ${device.model}`,
    },
    req,
  );

  return created(res, {
    ticket: { ...ticket.toObject(), statusLabel: statusLabel(ticket.status) },
    trackingUrl: `/track/${trackingToken}`,
  });
};

export const updateTicket = async (req: Request, res: Response) => {
  const ticket = await getTicketOrFail(String(req.params.id));
  requireBranchAccess(req, ticket.branchId);
  const body = req.body as Record<string, unknown>;

  for (const field of [
    'priority',
    'source',
    'tags',
    'internalNotes',
    'customerVisibleNotes',
    'promisedAt',
    'cancelReason',
  ] as const) {
    if (body[field] !== undefined) (ticket as unknown as Record<string, unknown>)[field] = body[field];
  }

  if (body.assignedTechnicianId !== undefined) {
    const technicianId = body.assignedTechnicianId ? new Types.ObjectId(String(body.assignedTechnicianId)) : null;
    ticket.assignedTechnicianId = technicianId;
    ticket.assignedAt = technicianId ? new Date() : null;
  }

  if (body.priority) {
    const organization = await OrganizationModel.findById(ticket.organizationId).select('settings').lean();
    ticket.sla.dueAt = computeDueAt(
      body.priority as TicketPriority,
      ticket.createdAt as unknown as Date,
      organization?.settings?.defaultSlaHours,
    );
  }

  await ticket.save();

  await recordAudit(
    { action: 'update', resource: 'RepairTicket', resourceId: String(ticket._id), summary: `تحديث تذكرة ${ticket.ticketNumber}` },
    req,
  );

  return ok(res, { ...ticket.toObject(), statusLabel: statusLabel(ticket.status) });
};

/** تغيير حالة التذكرة - يمر عبر محرّك الـworkflow (تحقق كامل) */
export const changeTicketStatus = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const ticket = await getTicketOrFail(String(req.params.id));
  requireBranchAccess(req, ticket.branchId);
  const body = req.body as {
    status: RepairStatus;
    note?: string;
    station?: string;
    reason?: string;
    metadata?: Record<string, unknown>;
  };

  assertTechnicianOwnership(
    ticket,
    { userId: auth.userId, fullName: auth.fullName, role: auth.role },
    // القيد يخص الفنيين فقط: بقية الأدوار المخوّلة بـticket:transition (استقبال/محاسب) تدير التذكرة كاملة
    auth.role !== 'technician',
  );

  const updated = await transitionTicket(
    String(ticket._id),
    body.status,
    { userId: auth.userId, fullName: auth.fullName, role: auth.role },
    {
      note: body.note,
      station: body.station,
      reason: body.reason,
      metadata: body.metadata,
      // قواعد العمل (موافقة/فحص/سداد) تُفرض دائمًا ولا تُتجاوز من الواجهة
      systemOverride: false,
    },
  );

  return ok(res, {
    ticket: { ...updated.toObject(), statusLabel: statusLabel(updated.status) },
    previousStatus: ticket.status,
  });
};

export const assignTechnician = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const ctx = getTenantContext();
  const ticket = await getTicketOrFail(String(req.params.id));
  requireBranchAccess(req, ticket.branchId);
  const body = req.body as { technicianId: string | null; note?: string };

  if (body.technicianId) {
    await resolveAssignableTechnician(ctx!.organizationId, body.technicianId, ticket.branchId as Types.ObjectId);
  }

  ticket.assignedTechnicianId = body.technicianId ? new Types.ObjectId(body.technicianId) : null;
  ticket.assignedAt = body.technicianId ? new Date() : null;
  ticket.assignedBy = new Types.ObjectId(auth.userId);
  await ticket.save();

  await recordTimelineEvent({
    ticket,
    eventType: body.technicianId ? 'assigned' : 'unassigned',
    note: body.note ?? (body.technicianId ? 'إسناد التذكرة لفني' : 'إلغاء الإسناد'),
    actor: { userId: auth.userId, fullName: auth.fullName, role: auth.role },
    technicianId: body.technicianId ?? null,
  });

  await recordAudit(
    {
      action: 'update',
      resource: 'RepairTicket',
      resourceId: String(ticket._id),
      summary: body.technicianId ? `إسناد ${ticket.ticketNumber} لفني` : `إلغاء إسناد ${ticket.ticketNumber}`,
    },
    req,
  );

  // إخطار الفني باستلام المهمة — فشل الإشعار لا يُبطل الإسناد
  if (body.technicianId) {
    try {
      await notifyUser({
        userId: body.technicianId,
        type: 'internal_assignment',
        subject: `تذكرة جديدة مسندة إليك — ${ticket.ticketNumber}`,
        body: `تم إسناد التذكرة ${ticket.ticketNumber} إليك بواسطة ${auth.fullName}${body.note ? ` — ${body.note}` : ''}. اعمل تشخيصًا مبدئيًا وسجّل عرض السعر من شاشة الفني حتى يتمكن الاستقبال من إبلاغ العميل.`,
        ticketId: ticket._id,
      });
    } catch (err) {
      logger.warn({ err, ticket: ticket.ticketNumber }, 'تعذّر إخطار الفني بالإسناد');
    }
  }

  return ok(res, { ...ticket.toObject(), statusLabel: statusLabel(ticket.status) });
};

/** تسجيل التشخيص الفني */
export const saveDiagnosis = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const ticket = await getTicketOrFail(String(req.params.id));
  requireBranchAccess(req, ticket.branchId);
  if (auth.role === 'technician') {
    assertTechnicianOwnership(ticket, { userId: auth.userId, fullName: auth.fullName, role: auth.role }, false, true);
  }
  const body = req.body as DiagnosisInput;

  ticket.diagnosis = {
    ...ticket.diagnosis,
    summary: body.summary,
    faultCategory: body.faultCategory ?? '',
    faultSeverity: body.faultSeverity ?? 'moderate',
    rootCause: body.rootCause ?? '',
    requiredActions: body.requiredActions ?? [],
    needsParts: body.needsParts ?? false,
    isBoardLevel: body.isBoardLevel ?? false,
    diagnosisNotes: body.diagnosisNotes ?? '',
    confidence: body.confidence ?? 'medium',
    diagnosedBy: new Types.ObjectId(auth.userId),
    diagnosedAt: new Date(),
  } as typeof ticket.diagnosis;

  await ticket.save();

  await recordTimelineEvent({
    ticket,
    eventType: 'diagnosis',
    note: body.summary,
    actor: { userId: auth.userId, fullName: auth.fullName, role: auth.role },
    metadata: {
      faultCategory: body.faultCategory,
      severity: body.faultSeverity,
      isBoardLevel: body.isBoardLevel,
      needsParts: body.needsParts,
    },
  });

  await recordAudit(
    { action: 'update', resource: 'RepairTicket', resourceId: String(ticket._id), summary: `تسجيل تشخيص ${ticket.ticketNumber}` },
    req,
  );

  return ok(res, { diagnosis: ticket.diagnosis });
};

export const addTicketNote = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const ticket = await getTicketOrFail(String(req.params.id));
  requireBranchAccess(req, ticket.branchId);
  const body = req.body as {
    body: string;
    visibility: 'internal' | 'customer';
    category: string;
    minutesSpent: number;
    isPinned: boolean;
  };

  const note = await RepairNoteModel.create({
    organizationId: ticket.organizationId,
    branchId: ticket.branchId,
    ticketId: ticket._id,
    deviceId: ticket.deviceId,
    body: body.body,
    visibility: body.visibility,
    category: body.category,
    minutesSpent: body.minutesSpent,
    isPinned: body.isPinned,
    authorId: new Types.ObjectId(auth.userId),
    authorName: auth.fullName,
  });

  await recordTimelineEvent({
    ticket,
    eventType: 'note_added',
    note: body.body.slice(0, 200),
    actor: { userId: auth.userId, fullName: auth.fullName, role: auth.role },
    metadata: { visibility: body.visibility, noteId: String(note._id) },
  });

  return created(res, note.toObject());
};

/** تسجيل وقت العمل: start / pause / complete */
export const logWork = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const ticket = await getTicketOrFail(String(req.params.id));
  requireBranchAccess(req, ticket.branchId);
  const body = req.body as { action: 'start' | 'pause' | 'complete'; note?: string };

  const openLog = ticket.workLogs.find((log) => !log.endedAt);

  if (body.action === 'start') {
    if (openLog) throw ApiError.businessRule('يوجد تسجيل وقت مفتوح بالفعل');
    ticket.workLogs.push({
      startedAt: new Date(),
      endedAt: null,
      technicianId: new Types.ObjectId(auth.userId),
      minutes: 0,
      note: body.note ?? '',
    } as never);
  } else {
    if (!openLog) throw ApiError.businessRule('لا يوجد تسجيل وقت مفتوح');
    openLog.endedAt = new Date();
    openLog.minutes = diffMinutes(openLog.startedAt, openLog.endedAt);
    if (body.note) openLog.note = body.note;
  }

  await ticket.save();

  const totalMinutes = ticket.workLogs.reduce((acc, log) => acc + (log.minutes ?? 0), 0);

  await recordTimelineEvent({
    ticket,
    eventType: 'note_added',
    note: `تسجيل وقت عمل: ${body.action === 'start' ? 'بدء' : body.action === 'pause' ? 'إيقاف مؤقت' : 'إنهاء'}`,
    actor: { userId: auth.userId, fullName: auth.fullName, role: auth.role },
    metadata: { action: body.action, totalMinutes },
  });

  return ok(res, { workLogs: ticket.workLogs, totalMinutes });
};

/** شاشة الفني: تذاكري */
export const myJobs = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const ctx = getTenantContext();
  const query = req.query as Record<string, unknown>;

  const filter: Record<string, unknown> = {
    organizationId: ctx!.organizationId,
    assignedTechnicianId: new Types.ObjectId(auth.userId),
  };
  if (query.openOnly !== 'false') filter.status = { $in: ACTIVE_REPAIR_STATUSES };
  if (query.status) filter.status = { $in: parseCsv(query.status) };

  const tickets = await RepairTicketModel.find(filter).sort({ priority: -1, 'sla.dueAt': 1 }).limit(100).lean();

  const customerIds = [...new Set(tickets.map((t) => String(t.customerId)))];
  const deviceIds = [...new Set(tickets.map((t) => String(t.deviceId)))];

  const [customers, devices] = await Promise.all([
    customerIds.length
      ? CustomerModel.find({ _id: { $in: customerIds }, organizationId: ctx!.organizationId })
          .select('fullName phone')
          .lean()
      : Promise.resolve([]),
    deviceIds.length
      ? DeviceModel.find({ _id: { $in: deviceIds }, organizationId: ctx!.organizationId })
          .select('brand model color storage')
          .lean()
      : Promise.resolve([]),
  ]);

  const customerMap = new Map(customers.map((c) => [String(c._id), c]));
  const deviceMap = new Map(devices.map((d) => [String(d._id), d]));
  const now = Date.now();

  return ok(res, {
    jobs: tickets.map((t) => ({
      ...t,
      customerId: customerMap.get(String(t.customerId)) ?? null,
      deviceId: deviceMap.get(String(t.deviceId)) ?? null,
      statusLabel: statusLabel(t.status),
      priorityLabel: TICKET_PRIORITY_LABELS_AR[t.priority as TicketPriority] ?? t.priority,
      isOverdue: Boolean(t.sla?.dueAt && new Date(t.sla.dueAt).getTime() < now),
      minutesOpen: diffMinutes(t.createdAt as unknown as Date, new Date()),
    })),
    summary: {
      total: tickets.length,
      urgent: tickets.filter((t) => t.priority === 'urgent').length,
      overdue: tickets.filter((t) => t.sla?.dueAt && new Date(t.sla.dueAt).getTime() < now).length,
      inRepair: tickets.filter((t) => t.status === 'repairing').length,
    },
  });
};

/**
 * رفع أدلة الاستلام/الإصلاح (Digital Intake & Evidence).
 * الملفات تُخزَّن محليًا مع عزل مؤسسي في مسار التخزين.
 */
export const uploadTicketEvidence = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const ticket = await getTicketOrFail(String(req.params.id));
  requireBranchAccess(req, ticket.branchId);

  const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
  const incoming = [
    ...(files.files ?? []),
    ...(files.signature ?? []),
    ...((req.file ? [req.file] : []) as Express.Multer.File[]),
  ];

  if (!incoming.length) throw ApiError.badRequest('لا يوجد ملفات مرفوعة');

  const { kind = 'intake_photo', stage = 'before_repair', caption = '' } = req.body as Record<string, string>;
  const isSignature = Boolean(files.signature?.length);

  const saved = [];
  for (const file of incoming) {
    const doc = await saveFile({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      kind: isSignature ? 'customer_signature' : kind,
      sizeBytes: file.size,
      ticketId: String(ticket._id),
      deviceId: String(ticket.deviceId),
      customerId: String(ticket.customerId),
      caption,
      stage,
      isSensitive: isSignature,
    });
    saved.push({ id: String(doc._id), kind: doc.kind, url: publicFileUrl(doc.storageKey) });
  }

  const [intakeCount, repairCount, hasSignature] = await Promise.all([
    StoredFileModel.countDocuments({
      organizationId: ticket.organizationId,
      ticketId: ticket._id,
      kind: 'intake_photo',
      isDeleted: false,
    }),
    StoredFileModel.countDocuments({
      organizationId: ticket.organizationId,
      ticketId: ticket._id,
      kind: 'repair_photo',
      isDeleted: false,
    }),
    StoredFileModel.exists({
      organizationId: ticket.organizationId,
      ticketId: ticket._id,
      kind: 'customer_signature',
      isDeleted: false,
    }),
  ]);

  ticket.evidence.intakePhotoCount = intakeCount;
  ticket.evidence.repairPhotoCount = repairCount;
  ticket.evidence.hasSignature = Boolean(hasSignature);

  if (!ticket.intake.customerAcknowledged && isSignature) {
    ticket.intake.customerAcknowledged = true;
    ticket.intake.acknowledgedAt = new Date();
    ticket.intake.acknowledgmentSignatureFileId = new Types.ObjectId(String(saved[0]!.id));
  }

  await ticket.save();

  await recordTimelineEvent({
    ticket,
    eventType: 'photo_added',
    note: `إضافة ${saved.length} ملف (${kind})`,
    actor: { userId: auth.userId, fullName: auth.fullName, role: auth.role },
    metadata: { count: saved.length, kind, stage },
  });

  await recordAudit(
    {
      action: 'file_upload',
      resource: 'RepairTicket',
      resourceId: String(ticket._id),
      summary: `رفع ${saved.length} دليل على تذكرة ${ticket.ticketNumber}`,
    },
    req,
  );

  return created(res, { files: saved, evidence: ticket.evidence });
};

/** الـTimeline الكامل (Chain of Custody) */
export const getTicketTimeline = async (req: Request, res: Response) => {
  const ticket = await getTicketOrFail(String(req.params.id));
  requireBranchAccess(req, ticket.branchId);
  const timeline = await RepairStatusHistoryModel.find({
    organizationId: ticket.organizationId,
    ticketId: ticket._id,
  })
    .sort({ createdAt: 1 })
    .lean();

  return ok(res, {
    ticketNumber: ticket.ticketNumber,
    currentStatus: ticket.status,
    currentStatusLabel: statusLabel(ticket.status),
    chain: timeline.map((event) => ({
      ...event,
      toStatusLabel: statusLabel(event.toStatus),
      fromStatusLabel: event.fromStatus ? statusLabel(event.fromStatus) : null,
    })),
  });
};

/** إحصائيات الـSLA والأداء */
export const ticketSlaReport = async (_req: Request, res: Response) => {
  const ctx = getTenantContext();
  const organizationId = ctx!.organizationId;
  const now = new Date();

  const [open, breached, dueSoon, byPriority] = await Promise.all([
    RepairTicketModel.countDocuments({ organizationId, status: { $in: ACTIVE_REPAIR_STATUSES } }),
    RepairTicketModel.countDocuments({
      organizationId,
      status: { $in: ACTIVE_REPAIR_STATUSES },
      'sla.dueAt': { $lt: now },
    }),
    RepairTicketModel.countDocuments({
      organizationId,
      status: { $in: ACTIVE_REPAIR_STATUSES },
      'sla.dueAt': { $gte: now, $lte: addHours(now, 12) },
    }),
    RepairTicketModel.aggregate<{ _id: string; count: number }>([
      { $match: { organizationId, status: { $in: ACTIVE_REPAIR_STATUSES } } },
      { $group: { _id: '$priority', count: { $sum: 1 } } },
    ]),
  ]);

  return ok(res, {
    open,
    breached,
    onTrack: open - breached,
    dueSoon,
    byPriority: byPriority.map((p) => ({
      priority: p._id,
      label: TICKET_PRIORITY_LABELS_AR[p._id as TicketPriority] ?? p._id,
      count: p.count,
      slaHours: SLA_HOURS_BY_PRIORITY[p._id as TicketPriority] ?? 72,
    })),
  });
};
