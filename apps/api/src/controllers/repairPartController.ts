import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { RepairPartModel, type RepairPartStatus } from '../models/RepairPart.js';
import { RepairLaborModel } from '../models/RepairLabor.js';
import { PartModel } from '../models/Part.js';
import { RepairTicketModel } from '../models/RepairTicket.js';
import { ApiError } from '../utils/ApiError.js';
import { created, ok } from '../utils/asyncHandler.js';
import { getAuth, requireBranchAccess } from '../middleware/auth.js';
import { getTenantContext } from '../context/tenantContext.js';
import { recordAudit } from '../services/auditService.js';
import { applyStockMovement, refreshPartQualityStats } from '../services/inventoryService.js';
import { money } from '../utils/money.js';
import { addHours } from '../utils/dates.js';
import { assertTechnicianOwnership, getTicketOrFail, recordTimelineEvent } from '../services/workflowService.js';
import { recalcTicketCosts } from '../services/ticketCostService.js';

/** إضافة قطعة لتذكرة صيانة: تحجز من المخزون وتُسجَّل في التذكرة */
export const addRepairPart = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const ctx = getTenantContext();
  const organizationId = ctx!.organizationId;
  const ticket = await getTicketOrFail(String(req.params.id));
  requireBranchAccess(req, ticket.branchId);
  if (auth.role === 'technician') {
    assertTechnicianOwnership(ticket, { userId: auth.userId, fullName: auth.fullName, role: auth.role }, false, true);
  }

  const body = req.body as {
    partId: string;
    quantity: number;
    unitPriceEgp?: number;
    batchId?: string | null;
    status: RepairPartStatus;
    warrantyDays?: number;
    notes?: string;
  };

  const part = await PartModel.findOne({ _id: body.partId, organizationId })
    .select('name sku grade pricing warranty')
    .lean();
  if (!part) throw ApiError.notFound('القطعة غير موجودة');

  const unitCost = part.pricing?.costEgp ?? 0;
  const unitPrice = body.unitPriceEgp ?? part.pricing?.sellingPriceEgp ?? 0;
  const warrantyDays = body.warrantyDays ?? part.warranty?.days ?? 0;

  const repairPart = await RepairPartModel.create({
    organizationId,
    branchId: ctx!.branchId,
    ticketId: ticket._id,
    deviceId: ticket.deviceId,
    partId: part._id,
    batchId: body.batchId ?? null,
    quantity: body.quantity,
    status: body.status,
    unitCostEgp: unitCost,
    unitPriceEgp: unitPrice,
    totalCostEgp: money(body.quantity * unitCost),
    totalPriceEgp: money(body.quantity * unitPrice),
    grade: part.grade ?? 'unknown',
    warrantyDays,
    warrantyExpiresAt: warrantyDays ? addHours(new Date(), warrantyDays * 24) : null,
    installedBy: body.status === 'installed' ? new Types.ObjectId(auth.userId) : null,
    installedAt: body.status === 'installed' ? new Date() : null,
    notes: body.notes ?? '',
    addedBy: new Types.ObjectId(auth.userId),
  });

  // حجز المخزون (أو استهلاك مباشر إذا أُضيفت كمركّبة فعلًا)
  await applyStockMovement({
    partId: part._id,
    type: body.status === 'installed' ? 'repair_consume' : 'reserve',
    quantity: body.status === 'installed' ? -body.quantity : body.quantity,
    unitCostEgp: unitCost,
    ticketId: ticket._id,
    repairPartId: repairPart._id,
    batchId: body.batchId ?? null,
    reason: `قطعة على تذكرة ${ticket.ticketNumber}`,
    actor: { userId: auth.userId, fullName: auth.fullName },
  });

  if (warrantyDays > (ticket.warranty.partsDays ?? 0)) {
    ticket.warranty.partsDays = warrantyDays;
    await ticket.save();
  }
  await recalcTicketCosts(ticket._id as Types.ObjectId);

  await recordTimelineEvent({
    ticket,
    eventType: body.status === 'installed' ? 'part_consumed' : 'part_reserved',
    note: `${body.status === 'installed' ? 'تركيب' : 'حجز'} قطعة ${part.name} × ${body.quantity}`,
    actor: { userId: auth.userId, fullName: auth.fullName, role: auth.role },
    metadata: { repairPartId: String(repairPart._id), partId: String(part._id), quantity: body.quantity },
  });

  await recordAudit(
    {
      action: 'create',
      resource: 'RepairPart',
      resourceId: String(repairPart._id),
      summary: `إضافة قطعة ${part.name} على تذكرة ${ticket.ticketNumber}`,
    },
    req,
  );

  return created(res, repairPart.toObject());
};

/** تحديث حالة قطعة (تركيب/إرجاع/تلف) مع تسوية المخزون */
export const updateRepairPart = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const ctx = getTenantContext();
  const repairPart = await RepairPartModel.findOne({
    _id: String(req.params.partId),
    organizationId: ctx!.organizationId,
  });
  if (!repairPart) throw ApiError.notFound('القطعة غير مسجلة على التذكرة');

  const ticket = await getTicketOrFail(repairPart.ticketId);
  requireBranchAccess(req, ticket.branchId);
  if (auth.role === 'technician') {
    assertTechnicianOwnership(ticket, { userId: auth.userId, fullName: auth.fullName, role: auth.role }, false, true);
  }
  const body = req.body as {
    status?: RepairPartStatus;
    quantity?: number;
    unitPriceEgp?: number;
    notes?: string;
  };

  const previousStatus = repairPart.status;

  if (body.quantity && body.quantity !== repairPart.quantity) {
    const diff = body.quantity - repairPart.quantity;
    await applyStockMovement({
      partId: repairPart.partId,
      branchId: repairPart.branchId ?? undefined,
      type: diff > 0 ? 'reserve' : 'release',
      quantity: Math.abs(diff),
      ticketId: ticket._id,
      repairPartId: repairPart._id,
      reason: `تعديل كمية على تذكرة ${ticket.ticketNumber}`,
      actor: { userId: auth.userId, fullName: auth.fullName },
    });
    repairPart.quantity = body.quantity;
    repairPart.totalCostEgp = money(body.quantity * repairPart.unitCostEgp);
    repairPart.totalPriceEgp = money(body.quantity * repairPart.unitPriceEgp);
  }

  if (body.unitPriceEgp !== undefined) {
    repairPart.unitPriceEgp = body.unitPriceEgp;
    repairPart.totalPriceEgp = money(repairPart.quantity * body.unitPriceEgp);
  }

  if (body.status && body.status !== previousStatus) {
    repairPart.status = body.status;

    // reserved → installed: استهلاك فعلي
    if (previousStatus === 'reserved' && body.status === 'installed') {
      await applyStockMovement({
        partId: repairPart.partId,
      branchId: repairPart.branchId ?? undefined,
        type: 'repair_consume',
        quantity: -repairPart.quantity,
        unitCostEgp: repairPart.unitCostEgp,
        ticketId: ticket._id,
        repairPartId: repairPart._id,
        reason: 'تركيب فعلي للقطعة',
        actor: { userId: auth.userId, fullName: auth.fullName },
      });
      repairPart.installedBy = new Types.ObjectId(auth.userId);
      repairPart.installedAt = new Date();
      if (repairPart.warrantyDays) {
        repairPart.warrantyExpiresAt = addHours(new Date(), repairPart.warrantyDays * 24);
      }
    }

    // installed → removed/returned: فك القطعة وإرجاعها للمخزون
    if (previousStatus === 'installed' && (body.status === 'removed' || body.status === 'returned')) {
      await applyStockMovement({
        partId: repairPart.partId,
      branchId: repairPart.branchId ?? undefined,
        type: 'repair_return',
        quantity: repairPart.quantity,
        unitCostEgp: repairPart.unitCostEgp,
        ticketId: ticket._id,
        repairPartId: repairPart._id,
        reason: 'فك القطعة وإرجاعها للمخزون',
        actor: { userId: auth.userId, fullName: auth.fullName },
      });
      repairPart.removedAt = new Date();
    }

    // reserved → defective: فك الحجز أولًا
    if (previousStatus === 'reserved' && body.status === 'defective') {
      await applyStockMovement({
        partId: repairPart.partId,
      branchId: repairPart.branchId ?? undefined,
        type: 'release',
        quantity: -repairPart.quantity,
        ticketId: ticket._id,
        repairPartId: repairPart._id,
        reason: 'فك حجز القطعة المعيبة',
        actor: { userId: auth.userId, fullName: auth.fullName },
      });
    }

    // أي حالة → defective: تُسجَّل معيبة وتُحدَّث مؤشرات جودة القطعة
    if (body.status === 'defective') {
      await applyStockMovement({
        partId: repairPart.partId,
      branchId: repairPart.branchId ?? undefined,
        type: 'defective_in',
        quantity: repairPart.quantity,
        unitCostEgp: repairPart.unitCostEgp,
        ticketId: ticket._id,
        repairPartId: repairPart._id,
        reason: 'قطعة معيبة',
        actor: { userId: auth.userId, fullName: auth.fullName },
      });
      repairPart.failedAt = new Date();
      repairPart.failureReason = body.notes ?? 'قطعة معيبة';
      await refreshPartQualityStats(repairPart.partId);
    }
  }

  if (body.notes !== undefined) repairPart.notes = body.notes;
  await repairPart.save();
  await recalcTicketCosts(ticket._id as Types.ObjectId);

  await recordAudit(
    {
      action: 'update',
      resource: 'RepairPart',
      resourceId: String(repairPart._id),
      summary: `تحديث قطعة على تذكرة ${ticket.ticketNumber}: ${previousStatus} → ${repairPart.status}`,
    },
    req,
  );

  return ok(res, repairPart.toObject());
};

export const removeRepairPart = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const ctx = getTenantContext();
  const repairPart = await RepairPartModel.findOne({
    _id: String(req.params.partId),
    organizationId: ctx!.organizationId,
  });
  if (!repairPart) throw ApiError.notFound('القطعة غير مسجلة على التذكرة');

  const ticket = await getTicketOrFail(String(repairPart.ticketId));
  requireBranchAccess(req, ticket.branchId);
  if (auth.role === 'technician') {
    assertTechnicianOwnership(ticket, { userId: auth.userId, fullName: auth.fullName, role: auth.role }, false, true);
  }

  if (repairPart.status === 'installed') {
    await applyStockMovement({
      partId: repairPart.partId,
      branchId: repairPart.branchId ?? undefined,
      type: 'repair_return',
      quantity: repairPart.quantity,
      unitCostEgp: repairPart.unitCostEgp,
      ticketId: repairPart.ticketId,
      repairPartId: repairPart._id,
      reason: 'إزالة القطعة من التذكرة',
      actor: { userId: auth.userId, fullName: auth.fullName },
    });
  } else if (repairPart.status === 'reserved') {
    await applyStockMovement({
      partId: repairPart.partId,
      branchId: repairPart.branchId ?? undefined,
      type: 'release',
      quantity: -repairPart.quantity,
      ticketId: repairPart.ticketId,
      repairPartId: repairPart._id,
      reason: 'إلغاء حجز القطعة',
      actor: { userId: auth.userId, fullName: auth.fullName },
    });
  }

  const ticketId = repairPart.ticketId as Types.ObjectId;
  await RepairPartModel.findByIdAndDelete(repairPart._id);
  await recalcTicketCosts(ticketId);

  await recordAudit(
    {
      action: 'delete',
      resource: 'RepairPart',
      resourceId: String(repairPart._id),
      summary: 'إزالة قطعة من تذكرة صيانة',
      severity: 'warning',
    },
    req,
  );

  return ok(res, { message: 'تم إزالة القطعة وتسوية المخزون' });
};

/** إضافة بند مصنعية */
export const addLabor = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const ctx = getTenantContext();
  const ticket = await getTicketOrFail(String(req.params.id));
  requireBranchAccess(req, ticket.branchId);
  if (auth.role === 'technician') {
    assertTechnicianOwnership(ticket, { userId: auth.userId, fullName: auth.fullName, role: auth.role }, false, true);
  }

  const body = req.body as {
    description: string;
    category: string;
    hours: number;
    ratePerHourEgp: number;
    amountEgp?: number;
    technicianId?: string | null;
    isWarrantyWork: boolean;
    notes?: string;
  };

  const amount = body.amountEgp ?? money(body.hours * body.ratePerHourEgp);
  if (amount <= 0 && !body.isWarrantyWork) {
    throw ApiError.badRequest('قيمة المصنعية يجب أن تكون أكبر من صفر');
  }

  const labor = await RepairLaborModel.create({
    organizationId: ctx!.organizationId,
    branchId: ctx!.branchId,
    ticketId: ticket._id,
    description: body.description,
    category: body.category,
    hours: body.hours,
    ratePerHourEgp: body.ratePerHourEgp,
    amountEgp: amount,
    technicianId: body.technicianId ? new Types.ObjectId(body.technicianId) : ticket.assignedTechnicianId,
    isWarrantyWork: body.isWarrantyWork,
    addedBy: new Types.ObjectId(auth.userId),
    notes: body.notes ?? '',
  });

  await recalcTicketCosts(ticket._id as Types.ObjectId);

  await recordTimelineEvent({
    ticket,
    eventType: 'note_added',
    note: `إضافة مصنعية: ${body.description} بمبلغ ${amount} جنيه`,
    actor: { userId: auth.userId, fullName: auth.fullName, role: auth.role },
    metadata: { laborId: String(labor._id), amountEgp: amount },
  });

  return created(res, labor.toObject());
};

export const removeLabor = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const ctx = getTenantContext();
  const labor = await RepairLaborModel.findOne({
    _id: String(req.params.laborId),
    organizationId: ctx!.organizationId,
  });
  if (!labor) throw ApiError.notFound('بند المصنعية غير موجود');

  if (auth.role === 'technician') {
    const ticket = await getTicketOrFail(String(labor.ticketId));
    requireBranchAccess(req, ticket.branchId);
    assertTechnicianOwnership(ticket, { userId: auth.userId, fullName: auth.fullName, role: auth.role }, false, true);
  }

  const ticketId = labor.ticketId as Types.ObjectId;
  await RepairLaborModel.findByIdAndDelete(labor._id);
  await recalcTicketCosts(ticketId);

  await recordAudit(
    {
      action: 'delete',
      resource: 'RepairLabor',
      resourceId: String(labor._id),
      summary: 'حذف بند مصنعية',
      severity: 'warning',
    },
    req,
  );

  return ok(res, { message: 'تم حذف بند المصنعية' });
};
