import { Types } from 'mongoose';
import { CustomerModel } from '../models/Customer.js';
import { UserModel } from '../models/User.js';
import { DeviceModel } from '../models/Device.js';
import { NotificationModel, type NotificationType } from '../models/Notification.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { permissionsForRole, ROLE_PERMISSIONS, type Permission, type Role } from '../constants/roles.js';
import type { RepairTicketDoc } from '../models/RepairTicket.js';
import { REPAIR_STATUS_LABELS_AR, type RepairStatus } from '../constants/repair.js';
import { money } from '../utils/money.js';
import { getTenantContext } from '../context/tenantContext.js';
import type { ActingUser } from './workflowService.js';

/** القوالب العربية للرسائل - كل قالب مرتبط بحالة إصلاح */
export const MESSAGE_TEMPLATES: Record<string, { title: string; build: (v: Record<string, string>) => string }> = {
  device_received: {
    title: 'تم استلام الجهاز',
    build: (v) =>
      `أهلًا ${v.customerName}، استلمنا جهازك ${v.device} برقم تذكرة ${v.ticketNumber}. هنبلّغك أول ما يخلص التشخيص.`,
  },
  diagnosis_completed: {
    title: 'انتهى التشخيص',
    build: (v) => `خلصنا تشخيص جهازك ${v.device} (تذكرة ${v.ticketNumber}). ${v.summary ?? ''}`.trim(),
  },
  estimate_ready: {
    title: 'عرض السعر جاهز',
    build: (v) =>
      `عرض سعر إصلاح ${v.device} جاهز. التكلفة المبدئية ${v.total} جنيه. تقدر توافق أو ترفض من الرابط: ${v.trackingUrl}`,
  },
  approval_required: {
    title: 'مطلوب موافقة',
    build: (v) => `محتاجين موافقتك على عرض سعر ${v.device} بمبلغ ${v.total} جنيه. من فضلك افتح: ${v.trackingUrl}`,
  },
  repair_started: {
    title: 'بدأ الإصلاح',
    build: (v) => `بدأنا إصلاح جهازك ${v.device} (تذكرة ${v.ticketNumber}).`,
  },
  waiting_for_part: {
    title: 'بانتظار قطعة',
    build: (v) => `جهازك ${v.device} مستني قطعة غيار${v.part ? ` (${v.part})` : ''}. هنكمل أول ما توصل.`,
  },
  ready_for_pickup: {
    title: 'جاهز للاستلام',
    build: (v) =>
      `خبر حلو! جهازك ${v.device} جاهز للاستلام. المبلغ المستحق ${v.total} جنيه. رقم التذكرة ${v.ticketNumber}.`,
  },
  approval_decided: {
    title: 'وصلنا قرارك على العرض',
    build: (v) =>
      `شكرًا ${v.customerName}! وصلنا موافقتك على عرض سعر ${v.device} (تذكرة ${v.ticketNumber}) بمبلغ ${v.total} جنيه. هنبدأ الإصلاح فورًا وهنبلّغك أول ما الجهاز يجهز.`,
  },
  ticket_cancelled: {
    title: 'إلغاء الطلب',
    build: (v) =>
      `تم إلغاء طلب الإصلاح على جهازك ${v.device} (تذكرة ${v.ticketNumber})${v.reason ? ` — ${v.reason}` : ''}. تقدر تستلم جهازك من المركز في أي وقت.`,
  },
  delivered: {
    title: 'تم التسليم',
    build: (v) => `تم تسليم جهازك ${v.device}. شكرًا لثقتك فينا. مدة الضمان ${v.warrantyDays} يوم.`,
  },
  payment_received: {
    title: 'تم التحصيل',
    build: (v) => `استلمنا مبلغ ${v.amount} جنيه على تذكرة ${v.ticketNumber}. شكرًا لك.`,
  },
  warranty_reminder: {
    title: 'تذكير بالضمان',
    build: (v) => `ضمان جهازك ${v.device} ينتهي يوم ${v.expiresAt}. لو فيه أي مشكلة كلمنا قبل الميعاد.`,
  },
  review_request: {
    title: 'طلب تقييم',
    build: (v) => `لو الخدمة عجبتك، قيّم تجربتك معانا 🙏 (تذكرة ${v.ticketNumber}).`,
  },
  sla_warning: {
    title: 'تحذير موعد التسليم',
    build: (v) => `تنبيه داخلي: التذكرة ${v.ticketNumber} اقترب موعد تسليمها (${v.dueAt}).`,
  },
  low_stock: {
    title: 'مخزون منخفض',
    build: (v) => `تنبيه مخزون: ${v.partName} متبقي ${v.onHand} فقط.`,
  },
};

/** الحالات التي تنتج إشعارًا للعميل */
const STATUS_TO_NOTIFICATION: Partial<Record<RepairStatus, NotificationType>> = {
  received: 'device_received',
  diagnosis: 'diagnosis_completed',
  estimate: 'estimate_ready',
  waiting_approval: 'approval_required',
  approved: 'approval_decided',
  repairing: 'repair_started',
  waiting_part: 'waiting_for_part',
  ready: 'ready_for_pickup',
  customer_notified: 'ready_for_pickup',
  delivered: 'delivered',
  cancelled: 'ticket_cancelled',
};

export interface SendNotificationInput {
  type: NotificationType;
  channel?: 'whatsapp' | 'sms' | 'email' | 'in_app' | 'print';
  customerId?: Types.ObjectId | string | null;
  ticketId?: Types.ObjectId | string | null;
  deviceId?: Types.ObjectId | string | null;
  userId?: Types.ObjectId | string | null;
  toPhone?: string;
  toEmail?: string;
  subject?: string;
  body: string;
  templateKey?: string;
  variables?: Record<string, unknown>;
  trackingUrl?: string;
}

/**
 * إرسال إشعار.
 * الوضع الافتراضي WHATSAPP_MODE=log: يُسجَّل الإشعار في قاعدة البيانات وفي السجل
 * بدون استدعاء مزوّد خارجي، ما يتيح التشغيل الكامل محليًا.
 */
export async function sendNotification(input: SendNotificationInput): Promise<void> {
  const ctx = getTenantContext();
  if (!ctx) {
    logger.warn({ type: input.type }, 'محاولة إرسال إشعار بدون سياق مؤسسة');
    return;
  }

  const channel = input.channel ?? 'whatsapp';
  const provider = channel === 'whatsapp' ? env.WHATSAPP_MODE : 'log';

  const doc = await NotificationModel.create({
    organizationId: ctx.organizationId,
    branchId: ctx.branchId,
    type: input.type,
    channel,
    status: 'queued',
    customerId: input.customerId ?? null,
    ticketId: input.ticketId ?? null,
    deviceId: input.deviceId ?? null,
    userId: input.userId ?? null,
    toPhone: input.toPhone ?? '',
    toEmail: input.toEmail ?? '',
    subject: input.subject ?? MESSAGE_TEMPLATES[input.templateKey ?? '']?.title ?? '',
    body: input.body,
    templateKey: input.templateKey ?? '',
    variables: input.variables ?? {},
    provider,
    trackingUrl: input.trackingUrl ?? '',
    createdBy: ctx.actor.userId,
  });

  try {
    if (channel === 'whatsapp' && env.WHATSAPP_MODE === 'cloud-api') {
      await sendWhatsAppCloudApi(doc.toPhone, doc.body);
    } else {
      logger.info(
        { notificationId: String(doc._id), type: doc.type, to: doc.toPhone, body: doc.body },
        '[إشعار محلي] لم يُرسل لمزوّد خارجي (WHATSAPP_MODE=log)',
      );
    }
    doc.status = 'sent';
    doc.sentAt = new Date();
  } catch (err) {
    doc.status = 'failed';
    doc.errorMessage = (err as Error).message;
    logger.error({ err, notificationId: String(doc._id) }, 'فشل إرسال الإشعار');
  }

  doc.attempts = (doc.attempts ?? 0) + 1;
  await doc.save();
}

/** تكامل WhatsApp Business Cloud API - يُستخدم فقط عند ضبط المزود */
async function sendWhatsAppCloudApi(to: string, body: string): Promise<void> {
  if (!env.WHATSAPP_PHONE_NUMBER_ID || !env.WHATSAPP_ACCESS_TOKEN) {
    throw new Error('إعدادات WhatsApp Cloud API غير مكتملة');
  }
  const url = `https://graph.facebook.com/v21.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: to.replace(/^0/, '20'),
      type: 'text',
      text: { body },
    }),
  });
  if (!response.ok) {
    throw new Error(`WhatsApp API: ${response.status} ${await response.text()}`);
  }
}

/**
 * إشعارات تلقائية مرتبطة بتغيّر حالة التذكرة.
 * تُستدعى من محرّك الـworkflow بعد كل انتقال.
 */
export async function notifyTicketEvent(
  ticket: RepairTicketDoc,
  status: RepairStatus,
  actor?: ActingUser | null,
): Promise<void> {
  const type = STATUS_TO_NOTIFICATION[status];
  if (!type) return;

  const customer = await CustomerModel.findById(ticket.customerId).select('fullName phone whatsapp').lean();
  if (!customer) return;

  const device = await DeviceModel.findById(ticket.deviceId).select('brand model').lean();
  const deviceLabel = device ? `${device.brand} ${device.model}`.trim() : 'الخاص بك';

  const template = MESSAGE_TEMPLATES[type];
  const trackingUrl = `${env.PUBLIC_WEB_URL}/track/${ticket.trackingToken}`;

  const variables: Record<string, string> = {
    customerName: customer.fullName ?? '',
    ticketNumber: ticket.ticketNumber,
    device: deviceLabel,
    total: String(money(ticket.cost?.totalFinalEgp ?? ticket.cost?.totalQuotedEgp ?? 0)),
    status: REPAIR_STATUS_LABELS_AR[status],
    warrantyDays: String(ticket.warranty?.policyDays ?? 0),
    summary: ticket.diagnosis?.summary ?? '',
    reason: ticket.cancelReason ?? '',
    trackingUrl,
  };

  const body = template ? template.build(variables) : `تحديث حالة تذكرة ${ticket.ticketNumber}: ${REPAIR_STATUS_LABELS_AR[status]}`;

  await sendNotification({
    type,
    channel: 'whatsapp',
    customerId: ticket.customerId,
    ticketId: ticket._id,
    deviceId: ticket.deviceId,
    toPhone: customer.whatsapp || customer.phone || '',
    body,
    templateKey: type,
    variables,
    trackingUrl,
  });

  ticket.followUp.lastNotifiedAt = new Date();
  ticket.followUp.notificationCount = (ticket.followUp.notificationCount ?? 0) + 1;
  await ticket.save();

  logger.debug({ ticket: ticket.ticketNumber, status, actor: actor?.fullName }, 'تم إنشاء إشعار حالة');
}

/** إشعارات داخلية لمستخدم بعينه */
export async function notifyUser(input: {
  userId: Types.ObjectId | string;
  type: NotificationType;
  subject: string;
  body: string;
  ticketId?: Types.ObjectId | string | null;
}): Promise<void> {
  await sendNotification({
    type: input.type,
    channel: 'in_app',
    userId: input.userId,
    subject: input.subject,
    body: input.body,
    ticketId: input.ticketId ?? null,
  });
}

/** الأدوار التي تملك صلاحية معيّنة — تُستخدم لتوجيه الإشعارات الداخلية حسب المسؤولية */
export function rolesWithPermission(permission: Permission): Role[] {
  return (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((role) =>
    ROLE_PERMISSIONS[role].includes(permission),
  );
}

/**
 * إشعار كل الموظفين النشطين الذين يملكون صلاحية معيّنة (مثل: الفني يسعّر →
 * الاستقبال يُبلَّغ ليعرض السعر على العميل).
 *
 * الصلاحية الفعلية تُحسب لكل مستخدم (الدور + الممنوح − المحجوب) بنفس منطق
 * `effectivePermissions`، فلا يُشعَر موظف حُجبت عنه الصلاحية شخصيًا.
 */
export async function notifyStaffWithPermission(input: {
  permission: Permission;
  type: NotificationType;
  subject: string;
  body: string;
  ticketId?: Types.ObjectId | string | null;
  excludeUserId?: Types.ObjectId | string | null;
}): Promise<number> {
  const ctx = getTenantContext();
  if (!ctx) return 0;

  const roles = rolesWithPermission(input.permission);
  if (!roles.length) return 0;

  const users = await UserModel.find({
    organizationId: ctx.organizationId,
    isActive: true,
    role: { $in: roles },
  })
    .select('role extraPermissions deniedPermissions')
    .lean();

  let sent = 0;
  for (const user of users) {
    if (input.excludeUserId && String(user._id) === String(input.excludeUserId)) continue;

    const effective = new Set<string>(permissionsForRole(user.role as Role));
    // لا يمكن حجب الأساسيات عن المالك/المدير — نفس استثناء effectivePermissions
    if (user.role !== 'owner' && user.role !== 'admin') {
      for (const extra of user.extraPermissions ?? []) effective.add(extra);
      for (const denied of user.deniedPermissions ?? []) effective.delete(denied);
    }
    if (!effective.has(input.permission)) continue;

    await notifyUser({
      userId: user._id,
      type: input.type,
      subject: input.subject,
      body: input.body,
      ticketId: input.ticketId ?? null,
    });
    sent += 1;
  }

  return sent;
}
