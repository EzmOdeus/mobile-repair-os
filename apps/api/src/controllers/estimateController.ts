import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { EstimateModel } from '../models/Estimate.js';
import { ApprovalModel } from '../models/Approval.js';
import { RepairTicketModel } from '../models/RepairTicket.js';
import { PartModel } from '../models/Part.js';
import { CustomerModel } from '../models/Customer.js';
import { DeviceModel } from '../models/Device.js';
import { OrganizationModel } from '../models/Organization.js';
import { ApiError } from '../utils/ApiError.js';
import { created, ok, paginated } from '../utils/asyncHandler.js';
import { parseListQuery } from '../utils/queryHelpers.js';
import { getAuth } from '../middleware/auth.js';
import { getTenantContext } from '../context/tenantContext.js';
import { recordAudit } from '../services/auditService.js';
import { computeTotals, money } from '../utils/money.js';
import { nextEstimateNumber, withUniqueRetry } from '../services/numberingService.js';
import { assertTechnicianOwnership, getTicketOrFail, recordTimelineEvent, transitionTicket } from '../services/workflowService.js';
import { notifyStaffWithPermission, notifyUser, sendNotification } from '../services/notificationService.js';
import { cancelTicketForCustomerRejection } from '../services/ticketCostService.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

function recalc(estimate: {
  lines: { kind: string; quantity: number; unitPriceEgp: number }[];
  totals: Record<string, number>;
  discountEgp: number;
  taxRatePct?: number;
}) {
  const parts = estimate.lines.filter((l) => l.kind === 'part').reduce((acc, l) => acc + l.quantity * l.unitPriceEgp, 0);
  const labor = estimate.lines.filter((l) => l.kind !== 'part').reduce((acc, l) => acc + l.quantity * l.unitPriceEgp, 0);

  const totals = computeTotals({
    lines: estimate.lines.map((l) => ({ quantity: l.quantity, unitPriceEgp: l.unitPriceEgp })),
    discountEgp: estimate.discountEgp,
    taxRatePct: estimate.taxRatePct ?? 14,
    taxInclusive: true,
  });

  return {
    partsEgp: money(parts),
    laborEgp: money(labor),
    subtotalEgp: totals.subtotalEgp,
    discountEgp: totals.discountEgp,
    taxEgp: totals.taxEgp,
    totalEgp: totals.totalEgp,
    approvedTotalEgp: 0,
  };
}

export const listEstimates = async (req: Request, res: Response) => {
  const { page, limit, skip } = parseListQuery(req.query as Record<string, unknown>, 30);
  const query = req.query as Record<string, unknown>;
  const filter: Record<string, unknown> = {};
  if (query.ticketId) filter.ticketId = query.ticketId;
  if (query.status) filter.status = query.status;
  if (query.customerId) filter.customerId = query.customerId;

  const [items, total] = await Promise.all([
    EstimateModel.find(filter)
      .populate('ticketId', 'ticketNumber status')
      .populate('customerId', 'fullName phone')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    EstimateModel.countDocuments(filter),
  ]);

  return paginated(res, items, { page, limit, total });
};

export const getEstimate = async (req: Request, res: Response) => {
  const estimate = await EstimateModel.findById(req.params.id)
    .populate('ticketId', 'ticketNumber status deviceId customerId')
    .populate('customerId', 'fullName phone whatsapp')
    .populate('lines.partId', 'name sku category')
    .lean();
  if (!estimate) throw ApiError.notFound('عرض السعر غير موجود');

  const approvals = await ApprovalModel.find({ estimateId: estimate._id }).sort({ decidedAt: -1 }).lean();
  return ok(res, { estimate, approvals });
};

/** إنشاء عرض سعر (إصدار جديد إن وُجد عرض سابق) */
export const createEstimate = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const ctx = getTenantContext();
  const body = req.body as Record<string, unknown> & {
    ticketId: string;
    lines: { kind: 'part' | 'labor' | 'service'; partId?: string | null; description: string; quantity: number; unitPriceEgp: number; warrantyDays?: number; notes?: string }[];
  };

  const ticket = await getTicketOrFail(body.ticketId);
  if (auth.role === 'technician') {
    assertTechnicianOwnership(ticket, { userId: auth.userId, fullName: auth.fullName, role: auth.role }, false, true);
  }

  const organization = await OrganizationModel.findById(ctx!.organizationId).select('settings').lean();
  const lastVersion = await EstimateModel.findOne({ ticketId: ticket._id }).sort({ version: -1 }).select('version').lean();
  const version = (lastVersion?.version ?? 0) + 1;

  // التحقق من توفر القطع المقترحة وتحضير الأسعار
  const lines: {
    kind: 'part' | 'labor' | 'service';
    partId: string | null;
    description: string;
    quantity: number;
    unitPriceEgp: number;
    totalEgp: number;
    approved: null;
    warrantyDays: number;
    notes: string;
  }[] = [];
  for (const line of body.lines) {
    let unitPrice = line.unitPriceEgp;
    let warrantyDays = line.warrantyDays ?? 0;

    if (line.kind === 'part' && line.partId) {
      const part = await PartModel.findById(line.partId).select('name pricing warranty stock').lean();
      if (!part) throw ApiError.notFound(`القطعة غير موجودة: ${line.description}`);
      if (!unitPrice) unitPrice = part.pricing?.sellingPriceEgp ?? 0;
      if (!warrantyDays) warrantyDays = part.warranty?.days ?? 0;
    }

    lines.push({
      kind: line.kind,
      partId: line.partId ?? null,
      description: line.description,
      quantity: line.quantity ?? 1,
      unitPriceEgp: unitPrice,
      totalEgp: money((line.quantity ?? 1) * unitPrice),
      approved: null,
      warrantyDays,
      notes: line.notes ?? '',
    });
  }

  const provisional = {
    lines,
    totals: {} as Record<string, number>,
    discountEgp: Number(body.discountEgp ?? 0),
    taxRatePct: Number(body.taxRatePct ?? organization?.settings?.taxRate ?? 14),
  };
  const calculated = recalc(provisional as never);

  /**
   * `withUniqueRetry`: نفس حماية إنشاء التذاكر — لو صادف الرقم المولَّد رقمًا
   * موجودًا (بعد استعادة نسخة احتياطية أو زرع بيانات) نعيد التوليد بدل إفشال
   * المستخدم برسالة تكرار تلقائية.
   */
  const estimate = await withUniqueRetry(nextEstimateNumber, (estimateNumber) =>
    EstimateModel.create({
      organizationId: ctx!.organizationId,
      branchId: ctx!.branchId,
      estimateNumber,
      ticketId: ticket._id,
      customerId: ticket.customerId,
      deviceId: ticket.deviceId,
      version,
      status: 'draft',
      lines,
      totals: {
        ...calculated,
        discountPct: Number(body.discountPct ?? 0),
        taxRatePct: provisional.taxRatePct,
      },
      estimatedDurationHours: Number(body.estimatedDurationHours ?? 0),
      warrantyOfferedDays: Number(body.warrantyOfferedDays ?? 0),
      terms: String(body.terms ?? ''),
      customerNotes: String(body.customerNotes ?? ''),
      internalNotes: String(body.internalNotes ?? ''),
      validUntil: body.validUntil ? new Date(String(body.validUntil)) : null,
      createdBy: new Types.ObjectId(auth.userId),
    }),
  );

  await recordTimelineEvent({
    ticket,
    eventType: 'estimate_created',
    note: `عرض سعر ${estimate.estimateNumber} بمبلغ ${calculated.totalEgp} جنيه`,
    actor: { userId: auth.userId, fullName: auth.fullName, role: auth.role },
    metadata: { estimateId: String(estimate._id), totalEgp: calculated.totalEgp, version },
  });

  await recordAudit(
    {
      action: 'create',
      resource: 'Estimate',
      resourceId: String(estimate._id),
      summary: `عرض سعر ${estimate.estimateNumber} للتذكرة ${ticket.ticketNumber}`,
    },
    req,
  );

  /**
   * إبلاغ الاستقبال بجهوزية عرض السعر — هو من يتواصل مع العميل بالأرقام.
   * الفني يسعّر في شاشته، والاستقبال يُبلَّغ ليشرح السعر ويأخذ القرار.
   */
  try {
    await notifyStaffWithPermission({
      permission: 'estimate:approve',
      type: 'estimate_ready',
      subject: `عرض سعر جاهز للإبلاغ — ${ticket.ticketNumber}`,
      body: `عرض سعر ${estimate.estimateNumber} بمبلغ ${calculated.totalEgp} جنيه جاهز على تذكرة ${ticket.ticketNumber}. تواصل مع العميل لتوضيح التفاصيل وسجّل قراره.`,
      ticketId: ticket._id,
      excludeUserId: auth.userId,
    });
  } catch (err) {
    logger.warn({ err, ticket: ticket.ticketNumber }, 'تعذّر إشعار الاستقبال بعرض السعر الجديد');
  }

  return created(res, estimate.toObject());
};

export const updateEstimate = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const estimate = await EstimateModel.findById(req.params.id);
  if (!estimate) throw ApiError.notFound('عرض السعر غير موجود');
  if (['approved', 'partially_approved'].includes(estimate.status)) {
    throw ApiError.businessRule('لا يمكن تعديل عرض سعر تم اعتماده من العميل');
  }
  if (auth.role === 'technician') {
    const ticket = await getRepairTicketForEstimate(String(estimate.ticketId));
    assertTechnicianOwnership(ticket, { userId: auth.userId, fullName: auth.fullName, role: auth.role }, false, true);
  }

  const body = req.body as Record<string, unknown>;

  if (Array.isArray(body.lines)) {
    estimate.set(
      'lines',
      (body.lines as Record<string, unknown>[]).map((l) => ({
        ...l,
        totalEgp: money(Number(l.quantity ?? 1) * Number(l.unitPriceEgp ?? 0)),
      })),
    );
  }
  for (const field of ['terms', 'customerNotes', 'internalNotes', 'estimatedDurationHours', 'warrantyOfferedDays'] as const) {
    if (body[field] !== undefined) (estimate as unknown as Record<string, unknown>)[field] = body[field];
  }
  if (body.discountEgp !== undefined) estimate.totals.discountEgp = Number(body.discountEgp);
  if (body.discountPct !== undefined) estimate.totals.discountPct = Number(body.discountPct);
  if (body.taxRatePct !== undefined) estimate.totals.taxRatePct = Number(body.taxRatePct);
  if (body.validUntil !== undefined) estimate.validUntil = body.validUntil ? new Date(String(body.validUntil)) : null;

  estimate.totals = { ...estimate.totals, ...recalc(estimate as never), discountPct: estimate.totals.discountPct, taxRatePct: estimate.totals.taxRatePct } as typeof estimate.totals;

  await estimate.save();

  await recordAudit({ action: 'update', resource: 'Estimate', resourceId: String(estimate._id), summary: `تحديث عرض سعر ${estimate.estimateNumber}` }, req);
  return ok(res, estimate.toObject());
};

/** إرسال العرض للعميل: يحدّث الحالة، ينقل التذكرة لانتظار الموافقة، ويرسل رسالة */
export const sendEstimate = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const estimate = await EstimateModel.findById(req.params.id);
  if (!estimate) throw ApiError.notFound('عرض السعر غير موجود');

  const { via = 'whatsapp' } = req.body as { via?: string; message?: string };
  const ticket = await getRepairTicketForEstimate(String(estimate.ticketId));
  if (auth.role === 'technician') {
    assertTechnicianOwnership(ticket, { userId: auth.userId, fullName: auth.fullName, role: auth.role }, false, true);
  }

  estimate.status = 'sent';
  estimate.sentAt = new Date();
  estimate.sentVia = via as typeof estimate.sentVia;
  await estimate.save();

  /**
   * مزامنة تكاليف العرض على التذكرة قبل الانتقال — أي رسالة حالة لاحقة
   * (موافقة/جاهزية/تسليم) تقرأ المبلغ من هنا، وإلا تصل العميل بمبلغ 0.
   */
  const ticketDoc = await RepairTicketModel.findById(ticket._id);
  if (ticketDoc) {
    ticketDoc.cost.partsQuotedEgp = estimate.totals.partsEgp ?? 0;
    ticketDoc.cost.laborQuotedEgp = estimate.totals.laborEgp ?? 0;
    ticketDoc.cost.totalQuotedEgp = estimate.totals.totalEgp ?? 0;
    ticketDoc.cost.discountEgp = estimate.totals.discountEgp ?? 0;
    await ticketDoc.save();
  }

  // نقل التذكرة إلى انتظار الموافقة إن كان ذلك ممكنًا
  // (إشعار العميل التلقائي مُعطَّل: الرسالة المخصصة أدناه هي الرسالة الوحيدة لتجنب التكرار)
  const currentStatus = ticket.status;
  if (currentStatus !== 'waiting_approval' && ['inspection', 'diagnosis', 'estimate'].includes(currentStatus)) {
    await transitionTicket(ticket._id, 'waiting_approval', { userId: auth.userId, fullName: auth.fullName, role: auth.role }, {
      note: `إرسال عرض سعر ${estimate.estimateNumber}`,
      notifyCustomer: false,
    });
  } else {
    await recordTimelineEvent({
      ticket,
      eventType: 'estimate_sent',
      note: `إرسال عرض سعر ${estimate.estimateNumber} عبر ${via}`,
      actor: { userId: auth.userId, fullName: auth.fullName, role: auth.role },
      metadata: { estimateId: String(estimate._id) },
    });
  }

  const customer = await CustomerModel.findById(estimate.customerId).select('fullName phone whatsapp').lean();
  const device = await DeviceModel.findById(ticket.deviceId).select('brand model').lean();
  const deviceLabel = device ? `${device.brand} ${device.model}`.trim() : '';
  const trackingUrl = `${env.PUBLIC_WEB_URL}/track/${ticket.trackingToken}`;

  await sendNotification({
    type: 'estimate_ready',
    channel: via === 'sms' ? 'sms' : 'whatsapp',
    customerId: estimate.customerId,
    ticketId: ticket._id,
    deviceId: ticket.deviceId,
    toPhone: customer?.whatsapp ?? customer?.phone ?? '',
    subject: 'عرض سعر الإصلاح',
    body: `عرض سعر إصلاح جهازك${deviceLabel ? ` ${deviceLabel}` : ''} بمبلغ ${estimate.totals.totalEgp} جنيه. تقدر توافق أو ترفض من الرابط: ${trackingUrl}`,
    templateKey: 'estimate_ready',
    variables: { total: String(estimate.totals.totalEgp), ticketNumber: ticket.ticketNumber, device: deviceLabel },
    trackingUrl,
  });

  await recordAudit(
    { action: 'update', resource: 'Estimate', resourceId: String(estimate._id), summary: `إرسال عرض سعر ${estimate.estimateNumber} للعميل` },
    req,
  );

  return ok(res, { estimate: estimate.toObject(), trackingUrl });
};

async function getRepairTicketForEstimate(ticketId: string) {
  return getTicketOrFail(ticketId);
}

/**
 * تسجيل قرار العميل (Digital Customer Approval).
 * الموافقة مرتبطة بإصدار العرض وبالبنود المعتمدة، وتُستخدم كدليل عند النزاع.
 */
export const decideEstimate = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const estimate = await EstimateModel.findById(req.params.id);
  if (!estimate) throw ApiError.notFound('عرض السعر غير موجود');

  const body = req.body as {
    decision: 'approved' | 'partially_approved' | 'rejected' | 'no_response';
    approvedLineIds?: string[];
    channel?: string;
    customerComment?: string;
    rejectionReason?: string;
    customerPhone?: string;
    otpVerified?: boolean;
  };

  const ticket = await getRepairTicketForEstimate(String(estimate.ticketId));

  // اعتماد البنود
  if (body.decision === 'partially_approved') {
    if (!body.approvedLineIds?.length) throw ApiError.badRequest('حدد البنود المعتمدة للموافقة الجزئية');
    estimate.lines.forEach((line) => {
      line.approved = body.approvedLineIds!.includes(String(line._id));
    });
  } else if (body.decision === 'approved') {
    estimate.lines.forEach((line) => {
      line.approved = true;
    });
  } else if (body.decision === 'rejected') {
    estimate.lines.forEach((line) => {
      line.approved = false;
    });
  }

  const approvedTotal = money(
    estimate.lines.filter((l) => l.approved).reduce((acc, l) => acc + (l.totalEgp ?? 0), 0),
  );

  estimate.totals.approvedTotalEgp = approvedTotal;
  estimate.status =
    body.decision === 'approved'
      ? 'approved'
      : body.decision === 'partially_approved'
        ? 'partially_approved'
        : body.decision === 'rejected'
          ? 'rejected'
          : estimate.status;
  estimate.decidedAt = new Date();
  estimate.rejectionReason = body.rejectionReason ?? '';
  if (body.decision === 'approved' || body.decision === 'partially_approved') {
    estimate.approvedBy = new Types.ObjectId(auth.userId);
  }
  await estimate.save();

  const approval = await ApprovalModel.create({
    organizationId: estimate.organizationId,
    branchId: estimate.branchId,
    ticketId: estimate.ticketId,
    estimateId: estimate._id,
    customerId: estimate.customerId,
    decision: body.decision,
    channel: (body.channel ?? 'in_person') as never,
    approvedLineIds: body.approvedLineIds ?? [],
    approvedAmountEgp: approvedTotal,
    customerComment: body.customerComment ?? '',
    rejectionReason: body.rejectionReason ?? '',
    customerPhone: body.customerPhone ?? '',
    otpVerified: body.otpVerified ?? false,
    ipAddress: String(req.ip ?? ''),
    userAgent: String(req.headers['user-agent'] ?? ''),
    recordedBy: new Types.ObjectId(auth.userId),
    decidedAt: new Date(),
  });

  // تحديث تكلفة التذكرة
  const ticketDoc = await RepairTicketModel.findById(ticket._id);
  if (ticketDoc) {
    const partsQuoted = money(estimate.lines.filter((l) => l.kind === 'part').reduce((a, l) => a + l.totalEgp, 0));
    const laborQuoted = money(estimate.lines.filter((l) => l.kind !== 'part').reduce((a, l) => a + l.totalEgp, 0));
    ticketDoc.cost.laborQuotedEgp = laborQuoted;
    ticketDoc.cost.partsQuotedEgp = partsQuoted;
    ticketDoc.cost.totalQuotedEgp = estimate.totals.totalEgp;
    ticketDoc.cost.discountEgp = estimate.totals.discountEgp;
    if (body.decision === 'approved' || body.decision === 'partially_approved') {
      ticketDoc.cost.totalFinalEgp = approvedTotal;
    }

    // فترة السماح للضمان من العرض
    if (estimate.warrantyOfferedDays) ticketDoc.warranty.policyDays = estimate.warrantyOfferedDays;

    await ticketDoc.save();
  }

  await recordTimelineEvent({
    ticket,
    eventType: body.decision === 'rejected' ? 'rejected' : 'approved',
    note:
      body.decision === 'rejected'
        ? `رفض العميل عرض السعر ${estimate.estimateNumber}: ${body.rejectionReason ?? ''}`
        : `موافقة العميل على عرض السعر ${estimate.estimateNumber} بمبلغ ${approvedTotal} جنيه`,
    actor: { userId: auth.userId, fullName: auth.fullName, role: auth.role },
    metadata: { estimateId: String(estimate._id), decision: body.decision, approvedAmountEgp: approvedTotal },
  });

  const actor = { userId: auth.userId, fullName: auth.fullName, role: auth.role };

  /**
   * رفض العميل = نهاية الطلب: تُلغى التذكرة، تُفك حجوزات القطع، ويُخطَر الفني
   * ليتوقف عن العمل على طلب ملغي. هذا هو المسار الرسمي لسحب الجهاز.
   */
  if (body.decision === 'rejected') {
    try {
      await cancelTicketForCustomerRejection({
        ticketId: ticket._id,
        actor,
        reason: body.rejectionReason,
        estimateNumber: estimate.estimateNumber,
      });
    } catch (err) {
      logger.warn({ err, ticket: ticket.ticketNumber }, 'تعذّر إلغاء التذكرة بعد رفض العميل');
    }
  }

  // الانتقال التلقائي لحالة approved عند الموافقة
  if (body.decision === 'approved' || body.decision === 'partially_approved') {
    const fresh = await RepairTicketModel.findById(ticket._id);
    if (fresh && (fresh.status === 'waiting_approval' || fresh.status === 'estimate' || fresh.status === 'diagnosis')) {
      try {
        await transitionTicket(fresh._id, 'approved', actor, {
          note: 'اعتماد العميل لعرض السعر',
        });
      } catch {
        // قد يكون الانتقال غير مسموح من الحالة الحالية؛ الـTimeline سجّل الموافقة بالفعل
      }
    }

    // إخطار الفني المسند لبدء الإصلاح — فشل الإشعار لا يُبطل القرار
    const technicianId = fresh?.assignedTechnicianId ?? ticket.assignedTechnicianId;
    if (technicianId) {
      try {
        await notifyUser({
          userId: technicianId,
          type: 'approval_decided',
          subject: `العميل وافق — ابدأ الإصلاح (${ticket.ticketNumber})`,
          body: `وافق العميل على عرض السعر ${estimate.estimateNumber} بمبلغ ${approvedTotal} جنيه على تذكرة ${ticket.ticketNumber}. تقدر تبدأ الإصلاح من شاشة الفني.`,
          ticketId: ticket._id,
        });
      } catch (err) {
        logger.warn({ err, ticket: ticket.ticketNumber }, 'تعذّر إخطار الفني بموافقة العميل');
      }
    }
  }

  await recordAudit(
    {
      action: body.decision === 'rejected' ? 'reject' : 'approve',
      resource: 'Estimate',
      resourceId: String(estimate._id),
      summary: `قرار العميل على عرض ${estimate.estimateNumber}: ${body.decision} بمبلغ ${approvedTotal}`,
    },
    req,
  );

  return ok(res, { estimate: estimate.toObject(), approval: approval.toObject() });
};
