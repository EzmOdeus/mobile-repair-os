import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { OrganizationModel } from '../models/Organization.js';
import { RepairTicketModel } from '../models/RepairTicket.js';
import { NotificationModel } from '../models/Notification.js';
import { INACTIVE_REPAIR_STATUSES } from '../constants/repair.js';
import { runAsSystem } from '../context/tenantContext.js';
import { scanSlaBreaches } from './workflowService.js';

/**
 * مهمة دورية لفحص تجاوزات SLA لكل المؤسسات النشطة.
 *
 * كانت `scanSlaBreaches` موجودة في workflowService لكن لا يناديها أي كود، فحقل
 * `sla.breached` لا يُضبط أبدًا من الخلفية، ولا تظهر أي تنبيهات عن تأخر التذاكر.
 * هذا الملف يربطها بمؤقت داخلي، ويُنشئ إشعارًا داخليًا (sla_breach) لكل تذكرة
 * تتجاوز موعدها لأول مرة — النوع كان معرّفًا في الموديل لكن لا يُنشئه أحد.
 *
 * تعمل تحت سياق النظام لأنها تعبر كل المؤسسات؛ كل كتابة تُفلتر بمعرّف مؤسستها.
 */
export async function runSlaScanOnce(): Promise<number> {
  return runAsSystem(async () => {
    const organizations = await OrganizationModel.find({ isActive: { $ne: false } })
      .select('_id name')
      .lean();

    let total = 0;
    for (const organization of organizations) {
      const now = new Date();

      const candidates = await RepairTicketModel.find({
        organizationId: organization._id,
        status: { $nin: INACTIVE_REPAIR_STATUSES },
        'sla.dueAt': { $lt: now },
        'sla.breached': false,
      })
        .select('_id ticketNumber branchId sla.dueAt')
        .lean();

      const breached = await scanSlaBreaches(organization._id);
      if (breached === 0) continue;

      total += breached;
      logger.warn(
        {
          organizationId: String(organization._id),
          organizationName: organization.name,
          breachedTickets: breached,
        },
        'تذاكر تجاوزت الموعد المستهدف (SLA)',
      );

      if (candidates.length) {
        await NotificationModel.insertMany(
          candidates.map((ticket) => ({
            organizationId: organization._id,
            branchId: ticket.branchId ?? null,
            type: 'sla_breach' as const,
            channel: 'in_app' as const,
            status: 'sent' as const,
            ticketId: ticket._id,
            subject: 'تجاوز موعد التسليم',
            body: `التذكرة ${ticket.ticketNumber} تجاوزت الموعد المستهدف للتسليم.`,
            templateKey: 'sla_breach',
            variables: { ticketNumber: ticket.ticketNumber, dueAt: ticket.sla?.dueAt ?? null },
            provider: 'log',
            sentAt: now,
          })),
        );
      }
    }
    return total;
  });
}

let timer: NodeJS.Timeout | null = null;

/** تشغيل الجدولة الدورية. تُرجع دالة إيقاف (تُستدعى عند إغلاق السيرفر). */
export function startSlaScheduler(): () => void {
  if (timer) return stopSlaScheduler;

  const intervalMs = env.SLA_SCAN_INTERVAL_MINUTES * 60_000;

  // فحص أولي عند الإقلاع ثم فحص دوري
  void runSlaScanOnce().catch((err) => logger.error({ err }, 'فشل فحص SLA الأولي'));

  timer = setInterval(() => {
    void runSlaScanOnce().catch((err) => logger.error({ err }, 'فشل فحص SLA الدوري'));
  }, intervalMs);
  timer.unref();

  logger.info(
    { intervalMinutes: env.SLA_SCAN_INTERVAL_MINUTES },
    `جدولة فحص SLA مفعّلة (كل ${env.SLA_SCAN_INTERVAL_MINUTES} دقائق)`,
  );

  return stopSlaScheduler;
}

export function stopSlaScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
