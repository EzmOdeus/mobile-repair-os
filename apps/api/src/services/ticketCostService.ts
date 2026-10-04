import { Types } from 'mongoose';
import { RepairPartModel } from '../models/RepairPart.js';
import { RepairLaborModel } from '../models/RepairLabor.js';
import { RepairTicketModel, type RepairTicketDoc } from '../models/RepairTicket.js';
import { money } from '../utils/money.js';
import { logger } from '../config/logger.js';
import { canTransition, type RepairStatus } from '../constants/repair.js';
import { applyStockMovement } from './inventoryService.js';
import { transitionTicket, type ActingUser } from './workflowService.js';
import { notifyUser } from './notificationService.js';

/** إعادة حساب تكاليف التذكرة من القطع والمصنعية الفعلية */
export async function recalcTicketCosts(ticketId: Types.ObjectId): Promise<void> {
  const [partsAgg, laborAgg] = await Promise.all([
    RepairPartModel.aggregate<{ total: number }>([
      { $match: { ticketId, status: { $in: ['reserved', 'installed'] } } },
      { $group: { _id: null, total: { $sum: '$totalPriceEgp' } } },
    ]),
    RepairLaborModel.aggregate<{ total: number }>([
      { $match: { ticketId } },
      { $group: { _id: null, total: { $sum: '$amountEgp' } } },
    ]),
  ]);

  const partsTotal = money(partsAgg[0]?.total ?? 0);
  const laborTotal = money(laborAgg[0]?.total ?? 0);

  const ticket = await RepairTicketModel.findById(ticketId);
  if (!ticket) return;

  ticket.cost.partsActualEgp = partsTotal;
  ticket.cost.laborActualEgp = laborTotal;
  ticket.cost.totalFinalEgp = money(partsTotal + laborTotal - (ticket.cost.discountEgp ?? 0));
  ticket.cost.dueEgp = money(Math.max(0, ticket.cost.totalFinalEgp - (ticket.cost.paidEgp ?? 0)));
  await ticket.save();
}

/**
 * إلغاء التذكرة بسبب رفض العميل لعرض السعر.
 *
 * الخطوات بالترتيب:
 *   1) فك حجز كل القطع «المحجوزة» وإرجاعها للمخزون (القطع المركّبة لا تُفك — الرفض
 *      لا يصل لهذه المرحلة أصلًا لأن بوابة الموافقة تمنع الإصلاح قبل الاعتماد).
 *   2) إعادة حساب التكاليف بعد إسقاط البنود المحجوزة.
 *   3) إلغاء التذكرة (systemOverride: قرار العميل نفسه وليس انتقالًا تشغيليًا،
 *      فلا يخضع لبوابات الموافقة/الجودة/السداد).
 *   4) توثيق النتيجة `customer_declined` لتحليلات لاحقة.
 *   5) إخطار الفني المسند حتى لا يظل يعمل على طلب ملغي.
 *
 * تُستدعى من `decideEstimate` (الاستقبال) ومن بوابة تتبع العميل — بهذا لا تختلف
 * النتيجة باختلاف قناة تسجيل الرفض.
 */
export async function cancelTicketForCustomerRejection(params: {
  ticketId: Types.ObjectId | string;
  actor: ActingUser;
  reason?: string;
  estimateNumber?: string;
}): Promise<RepairTicketDoc | null> {
  const ticket = await RepairTicketModel.findById(params.ticketId);
  if (!ticket) return null;

  // إلغاء مكرر (مثل نقر مزدوج أو قرار عبر قناتين): لا نعيد التنفيذ
  if (ticket.status === 'cancelled') return ticket;

  const current = ticket.status as RepairStatus;
  if (!canTransition(current, 'cancelled')) {
    logger.warn(
      { ticket: ticket.ticketNumber, status: current },
      'رفض العميل: الحالة الحالية لا تسمح بالإلغاء — تُركت التذكرة كما هي',
    );
    return null;
  }

  const reason = params.reason?.trim() || 'رفض العميل عرض السعر';

  // 1) فك حجز القطع غير المركّبة (في فرعها الأصلي — قد يخالف فرع من يسجّل الرفض)
  const reservedParts = await RepairPartModel.find({ ticketId: ticket._id, status: 'reserved' });
  for (const part of reservedParts) {
    await applyStockMovement({
      partId: part.partId,
      type: 'release',
      quantity: -part.quantity,
      branchId: part.branchId ?? ticket.branchId,
      ticketId: ticket._id,
      repairPartId: part._id,
      reason: `رفض العميل عرض السعر — فك حجز على تذكرة ${ticket.ticketNumber}`,
      actor: { userId: params.actor.userId, fullName: params.actor.fullName },
    });
    part.status = 'removed';
    part.removedAt = new Date();
    part.notes = part.notes ? `${part.notes}\nأُلغيت التذكرة (رفض العميل)` : 'أُلغيت التذكرة (رفض العميل)';
    await part.save();
  }

  // 2) إعادة حساب التكاليف بعد إسقاط القطع المحجوزة
  await recalcTicketCosts(ticket._id as Types.ObjectId);

  // 3) إلغاء التذكرة
  const cancelled = await transitionTicket(ticket._id, 'cancelled', params.actor, {
    systemOverride: true,
    reason,
    note: `إلغاء بسبب رفض العميل عرض السعر${params.estimateNumber ? ` ${params.estimateNumber}` : ''}`,
  });

  // 4) توثيق النتيجة
  cancelled.outcome = 'customer_declined';
  await cancelled.save();

  // 5) إخطار الفني المسند — فشل الإشعار لا يُبطل الإلغاء
  if (cancelled.assignedTechnicianId) {
    try {
      await notifyUser({
        userId: cancelled.assignedTechnicianId,
        type: 'approval_decided',
        subject: `العميل رفض عرض السعر — أُلغيت التذكرة ${cancelled.ticketNumber}`,
        body: `رفض العميل عرض السعر للتذكرة ${cancelled.ticketNumber}. أُلغي الطلب وفُكّ حجز القطع، والجهاز بانتظار استلام العميل. السبب: ${reason}`,
        ticketId: cancelled._id,
      });
    } catch (err) {
      logger.warn({ err, ticket: cancelled.ticketNumber }, 'تعذّر إخطار الفني بإلغاء التذكرة');
    }
  }

  return cancelled;
}
