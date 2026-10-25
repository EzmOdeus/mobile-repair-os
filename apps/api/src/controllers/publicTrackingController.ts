import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { RepairTicketModel } from '../models/RepairTicket.js';
import { RepairStatusHistoryModel } from '../models/RepairStatusHistory.js';
import { EstimateModel } from '../models/Estimate.js';
import { ApprovalModel } from '../models/Approval.js';
import { OrganizationModel } from '../models/Organization.js';
import { DeviceModel } from '../models/Device.js';
import { CustomerModel } from '../models/Customer.js';
import { UserModel } from '../models/User.js';
import { StoredFileModel } from '../models/StoredFile.js';
import { ApiError } from '../utils/ApiError.js';
import { ok } from '../utils/asyncHandler.js';
import { REPAIR_STATUS_LABELS_AR, type RepairStatus } from '../constants/repair.js';
import { money } from '../utils/money.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { recordTimelineEvent, transitionTicket } from '../services/workflowService.js';
import { notifyUser } from '../services/notificationService.js';
import { cancelTicketForCustomerRejection } from '../services/ticketCostService.js';
import { recordAudit } from '../services/auditService.js';
import { publicFileUrl } from '../services/storageService.js';
import { runWithTenantContext } from '../context/tenantContext.js';

/**
 * بوابة تتبع العميل (Customer Portal) — بدون تسجيل دخول.
 *
 * مبادئ الأمان المطبَّقة:
 * 1) الوصول برمز عشوائي طويل (tracking token) وليس برقم التذكرة أو الـIMEI.
 * 2) البيانات المكشوفة محدودة: لا IMEI كامل، لا ملاحظات داخلية، لا بيانات مستخدمين.
 * 3) هذا الملف هو المكان الوحيد الذي يقرأ بيانات عبر المؤسسات، ولذلك يمرّر
 *    organizationId صراحةً في كل استعلام — وهو ما يعتمد عليه tenantPlugin
 *    («الاستعلام صريح النطاق») بدل الاعتماد على سياق الطلب غير المصادق عليه.
 */

function maskPhone(phone: string): string {
  if (!phone || phone.length < 6) return '****';
  return `${phone.slice(0, 4)}****${phone.slice(-2)}`;
}

function maskName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0]!;
  return `${parts[0]} ${parts[1]![0] ?? ''}.`;
}

function maskImei(imei: string | undefined): string {
  if (!imei || imei.length < 6) return '';
  return `${imei.slice(0, 4)}${'*'.repeat(Math.max(0, imei.length - 7))}${imei.slice(-3)}`;
}

/**
 * إيجاد التذكرة بالرمز.
 *
 * أول قراءة تتم على الـcollection مباشرة (بدون Mongoose) لأنها القراءة الوحيدة
 * التي لا يمكن أن تحمل organizationId — فهي الوسيلة لمعرفته. الرمز نفسه سرّي
 * وطويل (24 بايت عشوائية) ولا يُستخدم لأي غرض آخر.
 *
 * بعد معرفة المؤسسة، تمرّر كل الاستعلامات اللاحقة organizationId صراحةً،
 * وهو ما يعتمد عليه tenantPlugin لتقييد النطاق دون الحاجة لسياق طلب مصادق عليه.
 */
async function locateTicket(token: string) {
  if (!token || token.length < 16) throw ApiError.notFound('رابط التتبع غير صحيح');

  const raw = await RepairTicketModel.collection.findOne(
    { trackingToken: token },
    { projection: { _id: 1, organizationId: 1, branchId: 1 } },
  );

  if (!raw?.organizationId) throw ApiError.notFound('لم يتم العثور على تذكرة بهذا الرابط');

  return {
    ticketId: raw._id as Types.ObjectId,
    organizationId: raw.organizationId as Types.ObjectId,
    branchId: (raw.branchId as Types.ObjectId) ?? null,
  };
}

export const trackRepair = async (req: Request, res: Response) => {
  const token = String(req.params.token ?? '').trim();
  const { ticketId, organizationId } = await locateTicket(token);

  const ticket = await RepairTicketModel.findOne({ _id: ticketId, organizationId })
    .select(
      'ticketNumber status priority customerId deviceId intake.complaint diagnosis.summary diagnosis.faultCategory ' +
        'cost.totalQuotedEgp cost.totalFinalEgp cost.paidEgp cost.dueEgp warranty.policyDays warranty.startsAt warranty.expiresAt ' +
        'createdAt promisedAt readyAt deliveredAt assignedTechnicianId evidence customerVisibleNotes',
    )
    .lean();

  if (!ticket) throw ApiError.notFound('لم يتم العثور على تذكرة بهذا الرابط');

  /**
   * ملاحظة: لا نستخدم `populate` هنا لأن استعلامات الـpopulate الداخلية لا تحمل
   * مرشّح organizationId، فيرفضها tenantPlugin (وهو سلوك صحيح يمنع تسرب بيانات).
   * بدلًا من ذلك نقرأ الكيانات المرتبطة باستعلامات صريحة النطاق.
   */
  const [organization, device, customer, technician, timeline, estimates, approvals, photos] = await Promise.all([
    OrganizationModel.findById(organizationId).select('name phone branding settings').lean(),
    ticket.deviceId
      ? DeviceModel.findOne({ _id: ticket.deviceId, organizationId })
          .select('brand model color storage category imei')
          .lean()
      : Promise.resolve(null),
    ticket.customerId
      ? CustomerModel.findOne({ _id: ticket.customerId, organizationId }).select('fullName phone').lean()
      : Promise.resolve(null),
    ticket.assignedTechnicianId
      ? UserModel.findOne({ _id: ticket.assignedTechnicianId, organizationId }).select('fullName').lean()
      : Promise.resolve(null),
    RepairStatusHistoryModel.find({
      organizationId,
      ticketId,
      eventType: {
        $in: ['status_changed', 'estimate_sent', 'approved', 'rejected', 'qc_passed', 'payment_recorded', 'delivered'],
      },
    })
      .select('fromStatus toStatus eventType note createdAt')
      .sort({ createdAt: 1 })
      .limit(100)
      .lean(),
    EstimateModel.find({ organizationId, ticketId, status: { $in: ['sent', 'approved', 'partially_approved'] } })
      .select(
        'estimateNumber version status lines totals.totalEgp totals.approvedTotalEgp sentAt decidedAt rejectionReason warrantyOfferedDays terms customerNotes createdAt',
      )
      .sort({ version: -1 })
      .limit(5)
      .lean(),
    ApprovalModel.find({ organizationId, ticketId })
      .select('decision decidedAt approvedAmountEgp')
      .sort({ decidedAt: -1 })
      .limit(10)
      .lean(),
    StoredFileModel.find({ organizationId, ticketId, isDeleted: false, isSensitive: false })
      .select('kind stage caption storageKey mimeType createdAt')
      .sort({ createdAt: -1 })
      .limit(30)
      .lean(),
  ]);

  const latestEstimate = estimates[0];

  return ok(res, {
    organization: {
      name: organization?.name ?? '',
      phone: organization?.phone ?? '',
      primaryColor: organization?.branding?.primaryColor ?? '#0f766e',
      receiptFooterText: organization?.branding?.receiptFooterText ?? '',
    },
    ticket: {
      ticketNumber: ticket.ticketNumber,
      status: ticket.status,
      statusLabel: REPAIR_STATUS_LABELS_AR[ticket.status as RepairStatus] ?? ticket.status,
      complaint: ticket.intake?.complaint ?? '',
      diagnosisSummary: ticket.diagnosis?.summary ?? '',
      faultCategory: ticket.diagnosis?.faultCategory ?? '',
      customerName: maskName(customer?.fullName ?? ''),
      customerPhone: maskPhone(customer?.phone ?? ''),
      device: device
        ? {
            brand: device.brand,
            model: device.model,
            color: device.color,
            storage: device.storage,
            category: device.category,
            imeiMasked: maskImei(device.imei),
          }
        : null,
      technicianName: technician?.fullName ?? '',
      createdAt: ticket.createdAt,
      promisedAt: ticket.promisedAt,
      readyAt: ticket.readyAt,
      deliveredAt: ticket.deliveredAt,
      customerVisibleNotes: ticket.customerVisibleNotes ?? '',
    },
    costs: {
      quotedEgp: money(ticket.cost?.totalQuotedEgp ?? 0),
      finalEgp: money(ticket.cost?.totalFinalEgp ?? 0),
      paidEgp: money(ticket.cost?.paidEgp ?? 0),
      dueEgp: money(ticket.cost?.dueEgp ?? 0),
      currency: organization?.settings?.currency ?? env.DEFAULT_CURRENCY,
    },
    warranty: {
      policyDays: ticket.warranty?.policyDays ?? 0,
      startsAt: ticket.warranty?.startsAt ?? null,
      expiresAt: ticket.warranty?.expiresAt ?? null,
      isActive: Boolean(ticket.warranty?.expiresAt && ticket.warranty.expiresAt.getTime() > Date.now()),
    },
    pendingApproval:
      latestEstimate && latestEstimate.status === 'sent'
        ? {
            estimateNumber: latestEstimate.estimateNumber,
            version: latestEstimate.version,
            totalEgp: money(latestEstimate.totals?.totalEgp ?? 0),
            sentAt: latestEstimate.sentAt,
            lines: (latestEstimate.lines ?? []).map(
              (l: { description: string; quantity: number; unitPriceEgp: number; totalEgp: number }) => ({
                description: l.description,
                quantity: l.quantity,
                unitPriceEgp: l.unitPriceEgp,
                totalEgp: l.totalEgp,
              }),
            ),
            terms: latestEstimate.terms,
          }
        : null,
    estimates: estimates.map((e) => ({
      estimateNumber: e.estimateNumber,
      version: e.version,
      status: e.status,
      totalEgp: money(e.totals?.totalEgp ?? 0),
      approvedTotalEgp: money(e.totals?.approvedTotalEgp ?? 0),
      sentAt: e.sentAt,
      decidedAt: e.decidedAt,
      rejectionReason: e.rejectionReason,
      warrantyOfferedDays: e.warrantyOfferedDays,
    })),
    approvals,
    timeline: timeline.map((t) => ({
      toStatus: t.toStatus,
      toStatusLabel: REPAIR_STATUS_LABELS_AR[t.toStatus as RepairStatus] ?? t.toStatus,
      eventType: t.eventType,
      note: t.note,
      at: t.createdAt,
    })),
    evidence: photos.map((f) => ({
      id: String(f._id),
      kind: f.kind,
      stage: f.stage,
      caption: f.caption,
      mimeType: f.mimeType,
      url: publicFileUrl(f.storageKey),
      createdAt: f.createdAt,
    })),
  });
};

/**
 * موافقة/رفض العميل من صفحة التتبع (Digital Customer Approval).
 * يُسجَّل القرار مع عنوان الـIP كإثبات، وتُحدَّث حالة التذكرة تلقائيًا.
 */
export const decideByTrackingToken = async (req: Request, res: Response) => {
  const token = String(req.params.token ?? '').trim();
  const body = req.body as {
    decision: 'approved' | 'rejected';
    estimateId?: string;
    approvedLineIds?: string[];
    comment?: string;
    rejectionReason?: string;
    customerPhone?: string;
  };

  const { ticketId, organizationId, branchId } = await locateTicket(token);

  /**
   * كل ما يلي عمليات كتابة (تحديث عرض سعر، إنشاء موافقة، سجل أحداث، سجل تدقيق).
   * نُشغّلها داخل سياق مؤسسة التذكرة حتى تُسجَّل كل السجلات بنفس النطاق
   * ويحصل سجل التدقيق على الفاعل الصحيح.
   */
  return runWithTenantContext(
    {
      actor: {
        userId: String(ticketId),
        organizationId,
        branchId,
        role: 'viewer',
        fullName: 'العميل (بوابة التتبع)',
      },
      organizationId,
      branchId,
      requestId: req.requestId ?? '',
      ip: req.ip,
      userAgent: req.headers['user-agent'] ?? '',
    },
    async () => {
      const ticket = await RepairTicketModel.findOne({ _id: ticketId, organizationId });
      if (!ticket) throw ApiError.notFound('رابط التتبع غير صحيح');

      if (['delivered', 'cancelled'].includes(ticket.status)) {
        throw ApiError.businessRule('لا يمكن تعديل القرار بعد تسليم الجهاز');
      }

      const estimate = body.estimateId
        ? await EstimateModel.findOne({ _id: body.estimateId, organizationId, ticketId })
        : await EstimateModel.findOne({ organizationId, ticketId, status: 'sent' }).sort({ version: -1 });

      if (!estimate) throw ApiError.notFound('لا يوجد عرض سعر بانتظار الموافقة');
      if (estimate.status !== 'sent') throw ApiError.businessRule('تم تسجيل قرار على هذا العرض مسبقًا');

      estimate.lines.forEach((line) => {
        line.approved =
          body.decision === 'approved'
            ? true
            : body.approvedLineIds?.length
              ? body.approvedLineIds.includes(String(line._id))
              : false;
      });

      const approvedIds = estimate.lines.filter((l) => l.approved).map((l) => String(l._id));
      const approvedTotal = money(
        estimate.lines.filter((l) => l.approved).reduce((acc, l) => acc + (l.totalEgp ?? 0), 0),
      );
      const isPartial =
        body.decision === 'approved' && approvedIds.length > 0 && approvedIds.length < estimate.lines.length;

      estimate.status = body.decision === 'rejected' ? 'rejected' : isPartial ? 'partially_approved' : 'approved';
      estimate.totals.approvedTotalEgp = approvedTotal;
      estimate.decidedAt = new Date();
      estimate.rejectionReason = body.rejectionReason ?? '';
      await estimate.save();

      const approval = await ApprovalModel.create({
        organizationId,
        branchId,
        ticketId,
        estimateId: estimate._id,
        customerId: ticket.customerId,
        decision: estimate.status === 'rejected' ? 'rejected' : isPartial ? 'partially_approved' : 'approved',
        channel: 'portal',
        approvedLineIds: approvedIds,
        approvedAmountEgp: approvedTotal,
        customerComment: body.comment ?? '',
        rejectionReason: body.rejectionReason ?? '',
        customerPhone: body.customerPhone ?? '',
        ipAddress: String(req.ip ?? ''),
        userAgent: String(req.headers['user-agent'] ?? ''),
        decidedAt: new Date(),
      });

      ticket.cost.totalFinalEgp = approvedTotal || ticket.cost.totalFinalEgp;
      ticket.cost.partsQuotedEgp = money(
        estimate.lines.filter((l) => l.kind === 'part').reduce((acc, l) => acc + (l.totalEgp ?? 0), 0),
      );
      ticket.cost.laborQuotedEgp = money(
        estimate.lines.filter((l) => l.kind !== 'part').reduce((acc, l) => acc + (l.totalEgp ?? 0), 0),
      );
      ticket.cost.totalQuotedEgp = estimate.totals.totalEgp;
      ticket.cost.discountEgp = estimate.totals.discountEgp;
      ticket.cost.dueEgp = money(Math.max(0, (ticket.cost.totalFinalEgp ?? 0) - (ticket.cost.paidEgp ?? 0)));
      ticket.customerVisibleNotes =
        body.decision === 'rejected'
          ? `رفض العميل عرض السعر: ${body.rejectionReason ?? ''}`.trim()
          : `وافق العميل على عرض السعر بمبلغ ${approvedTotal} جنيه`;
      await ticket.save();

      await recordTimelineEvent({
        ticket,
        eventType: body.decision === 'rejected' ? 'rejected' : 'approved',
        note:
          body.decision === 'rejected'
            ? `رفض العميل من بوابة التتبع: ${body.rejectionReason ?? ''}`
            : `موافقة العميل من بوابة التتبع بمبلغ ${approvedTotal} جنيه`,
        actor: { userId: String(ticket.customerId), fullName: 'العميل (بوابة التتبع)', role: 'viewer' },
        metadata: { estimateId: String(estimate._id), channel: 'portal', approvedTotalEgp: approvedTotal },
      });

      await recordAudit({
        action: body.decision === 'rejected' ? 'reject' : 'approve',
        resource: 'Estimate',
        resourceId: String(estimate._id),
        summary: `قرار العميل من بوابة التتبع: ${estimate.status} بمبلغ ${approvedTotal}`,
        severity: body.decision === 'rejected' ? 'warning' : 'info',
      });

      const portalActor = { userId: String(ticket.customerId), fullName: 'العميل (بوابة التتبع)', role: 'viewer' };

      /**
       * رفض العميل = نهاية الطلب: إلغاء التذكرة وفك حجوزات القطع وإخطار الفني.
       * نفس منطق `decideEstimate` حتى لا تختلف النتيجة باختلاف قناة القرار.
       */
      if (body.decision === 'rejected') {
        try {
          await cancelTicketForCustomerRejection({
            ticketId,
            actor: portalActor,
            reason: body.rejectionReason,
            estimateNumber: estimate.estimateNumber,
          });
        } catch (err) {
          logger.warn({ err, ticketId: String(ticketId) }, 'تعذّر إلغاء التذكرة بعد رفض العميل من البوابة');
        }
      } else {
        // الموافقة من البوابة: نقل التذكرة إلى approved فورًا ثم إخطار الفني
        if (['waiting_approval', 'estimate', 'diagnosis'].includes(ticket.status)) {
          try {
            await transitionTicket(ticket._id, 'approved', portalActor, {
              note: 'اعتماد العميل من بوابة التتبع',
            });
          } catch (err) {
            logger.warn({ err, ticketId: String(ticketId) }, 'تعذّر نقل التذكرة إلى «معتمد» بعد موافقة البوابة');
          }
        }

        if (ticket.assignedTechnicianId) {
          try {
            await notifyUser({
              userId: ticket.assignedTechnicianId,
              type: 'approval_decided',
              subject: `العميل وافق — ابدأ الإصلاح (${ticket.ticketNumber})`,
              body: `وافق العميل من بوابة التتبع على عرض السعر ${estimate.estimateNumber} بمبلغ ${approvedTotal} جنيه على تذكرة ${ticket.ticketNumber}. تقدر تبدأ الإصلاح من شاشة الفني.`,
              ticketId: ticket._id,
            });
          } catch (err) {
            logger.warn({ err, ticketId: String(ticketId) }, 'تعذّر إخطار الفني بموافقة العميل من البوابة');
          }
        }
      }

      return ok(res, {
        message: 'تم تسجيل قرارك بنجاح',
        estimateNumber: estimate.estimateNumber,
        status: estimate.status,
        approvedTotalEgp: approvedTotal,
        approvalId: String(approval._id),
      });
    },
  );
};

/** معلومات الاتصال بالمركز من رمز التتبع (لأزرار التواصل) */
export const trackingContact = async (req: Request, res: Response) => {
  const token = String(req.params.token ?? '').trim();
  const { ticketId, organizationId } = await locateTicket(token);

  const [organization, ticket] = await Promise.all([
    OrganizationModel.findById(organizationId).select('name phone email website address').lean(),
    RepairTicketModel.findOne({ _id: ticketId, organizationId }).select('ticketNumber').lean(),
  ]);

  return ok(res, {
    ticketNumber: ticket?.ticketNumber ?? '',
    organization: {
      name: organization?.name ?? '',
      phone: organization?.phone ?? '',
      email: organization?.email ?? '',
      website: organization?.website ?? '',
      address: organization?.address ?? {},
    },
  });
};
