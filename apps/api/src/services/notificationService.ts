import { Types } from 'mongoose';
import { z } from 'zod';
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
import { normalizeEgyptPhone } from '../validators/common.js';
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

const whatsAppTemplateMapSchema = z.record(
  z.string(),
  z.object({
    name: z.string().min(1),
    language: z.string().min(2).default('ar'),
    params: z.array(z.string()).default([]),
  }),
);

type WhatsAppTemplateConfig = z.infer<typeof whatsAppTemplateMapSchema>[string];

let templateMapCache: Record<string, WhatsAppTemplateConfig> | null = null;

export function parseWhatsAppTemplateMap(raw: string): Record<string, WhatsAppTemplateConfig> {
  try {
    return whatsAppTemplateMapSchema.parse(JSON.parse(raw || '{}'));
  } catch (err) {
    logger.warn({ err }, 'WHATSAPP_TEMPLATE_MAP غير صالح — سيُستخدم النص الحر');
    return {};
  }
}

/** قوالب Meta المعتمدة — تُقرأ مرة واحدة، وأي خطأ إعداد لا يعطّل الإرسال النصي */
export function whatsAppTemplateMap(): Record<string, WhatsAppTemplateConfig> {
  if (!templateMapCache) templateMapCache = parseWhatsAppTemplateMap(env.WHATSAPP_TEMPLATE_MAP);
  return templateMapCache;
}

class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** تحويل رقم مصري محلي إلى صيغة Meta الدولية (2010...) */
export function normalizeWhatsAppPhone(input: string): string {
  const local = normalizeEgyptPhone(input.trim());
  const digits = local.replace(/\D/g, '');
  if (/^01[0125]\d{8}$/.test(digits)) return `20${digits.slice(1)}`;
  return digits;
}

export function resolveNotificationProvider(channel: SendNotificationInput['channel']): string {
  if (channel === 'whatsapp') return env.WHATSAPP_MODE === 'cloud-api' ? 'whatsapp-cloud' : 'log';
  if (channel === 'sms') return env.SMS_MODE === 'http' ? 'sms-http' : 'log';
  return 'log';
}

/** بناء رسالة واتساب: قالب معتمد إن وُجد، وإلا نص حر */
export function buildWhatsAppPayload(
  to: string,
  body: string,
  templateKey?: string,
  variables: Record<string, unknown> = {},
  templates: Record<string, WhatsAppTemplateConfig> = whatsAppTemplateMap(),
): Record<string, unknown> {
  const template = templateKey ? templates[templateKey] : undefined;
  const phone = normalizeWhatsAppPhone(to);
  if (!/^\d{8,15}$/.test(phone)) throw new ProviderError(`رقم واتساب غير صالح: ${to || 'فارغ'}`, false);

  if (template) {
    const parameters = template.params.map((key) => ({
      type: 'text',
      text: String(variables[key] ?? '—').slice(0, 1024),
    }));
    return {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'template',
      template: {
        name: template.name,
        language: { code: template.language },
        ...(parameters.length ? { components: [{ type: 'body', parameters }] } : {}),
      },
    };
  }

  return {
    messaging_product: 'whatsapp',
    to: phone,
    type: 'text',
    text: { preview_url: true, body },
  };
}

export function buildSmsPayload(to: string, message: string): Record<string, unknown> {
  return {
    to: normalizeEgyptPhone(to.trim()),
    message,
    sender: env.SMS_SENDER,
  };
}

async function postJson(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<Response> {
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new ProviderError(`تعذر الوصول لمزوّد الرسائل: ${(err as Error).message}`, true);
  }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function sendWhatsAppCloudApi(
  to: string,
  body: string,
  templateKey?: string,
  variables: Record<string, unknown> = {},
): Promise<string> {
  if (!env.WHATSAPP_PHONE_NUMBER_ID || !env.WHATSAPP_ACCESS_TOKEN) {
    throw new ProviderError('إعدادات WhatsApp Cloud API غير مكتملة', false);
  }
  const payload = buildWhatsAppPayload(to, body, templateKey, variables);
  const url = `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const response = await postJson(
    url,
    { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` },
    payload,
    15_000,
  );
  if (!response.ok) {
    const details = (await response.text()).slice(0, 500);
    throw new ProviderError(
      `WhatsApp API ${response.status}: ${details}`,
      response.status === 429 || response.status >= 500,
    );
  }
  const data = await readJson(response);
  const messages = data.messages as { id?: string }[] | undefined;
  return messages?.[0]?.id ?? '';
}

async function sendSmsHttp(to: string, message: string): Promise<string> {
  if (!env.SMS_API_URL) throw new ProviderError('SMS_API_URL غير مضبوط', false);
  const response = await postJson(
    env.SMS_API_URL,
    env.SMS_API_KEY ? { Authorization: `Bearer ${env.SMS_API_KEY}` } : {},
    buildSmsPayload(to, message),
    env.SMS_TIMEOUT_MS,
  );
  if (!response.ok) {
    const details = (await response.text()).slice(0, 500);
    throw new ProviderError(
      `SMS gateway ${response.status}: ${details}`,
      response.status === 408 || response.status === 429 || response.status >= 500,
    );
  }
  const data = await readJson(response);
  const nested = data.data as Record<string, unknown> | undefined;
  const id = data.id ?? data.messageId ?? data.message_id ?? nested?.id;
  return id ? String(id) : '';
}

interface DispatchInput {
  channel: NonNullable<SendNotificationInput['channel']>;
  toPhone: string;
  body: string;
  templateKey?: string;
  variables: Record<string, unknown>;
}

async function dispatchNotification(input: DispatchInput): Promise<string> {
  if (input.channel === 'whatsapp' && env.WHATSAPP_MODE === 'cloud-api') {
    return sendWhatsAppCloudApi(input.toPhone, input.body, input.templateKey, input.variables);
  }
  if (input.channel === 'sms' && env.SMS_MODE === 'http') {
    return sendSmsHttp(input.toPhone, input.body);
  }
  logger.info(
    { type: input.channel, to: input.toPhone, body: input.body },
    '[إشعار محلي] لم يُرسل لمزوّد خارجي (الوضع log)',
  );
  return '';
}

/**
 * إرسال إشعار مع إعادة محاولة محدودة.
 * الوضع الافتراضي log: يُسجَّل الإشعار في قاعدة البيانات وفي السجل بدون
 * استدعاء مزوّد خارجي. عند ضبط واتساب/SMS يُرسل فعليًا، وتُحفظ حالة كل محاولة.
 */
export async function sendNotification(input: SendNotificationInput): Promise<void> {
  const ctx = getTenantContext();
  if (!ctx) {
    logger.warn({ type: input.type }, 'محاولة إرسال إشعار بدون سياق مؤسسة');
    return;
  }

  const channel = input.channel ?? 'whatsapp';
  const provider = resolveNotificationProvider(channel);
  const variables = input.variables ?? {};

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
    variables,
    provider,
    trackingUrl: input.trackingUrl ?? '',
    createdBy: ctx.actor.userId,
  });

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= env.NOTIFICATION_MAX_ATTEMPTS; attempt += 1) {
    doc.attempts = attempt;
    try {
      doc.providerMessageId = await dispatchNotification({
        channel,
        toPhone: doc.toPhone,
        body: doc.body,
        templateKey: doc.templateKey,
        variables,
      });
      doc.status = 'sent';
      doc.sentAt = new Date();
      doc.errorMessage = '';
      lastError = null;
      break;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      doc.status = 'failed';
      doc.errorMessage = lastError.message.slice(0, 500);
      const retryable = err instanceof ProviderError && err.retryable;
      if (!retryable || attempt >= env.NOTIFICATION_MAX_ATTEMPTS) break;
      logger.warn(
        { notificationId: String(doc._id), attempt, err: lastError.message },
        'فشل مؤقت في إرسال الإشعار — إعادة محاولة',
      );
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    }
  }

  if (lastError) {
    logger.error({ err: lastError, notificationId: String(doc._id) }, 'فشل إرسال الإشعار');
  }
  await doc.save();
}

/**
 * إشعارات تلقائية مرتبطة بتغيّر حالة التذكرة.
 * تُستدعى من محرّك الـworkflow بعد كل انتقال.
 */
export async function notifyTicketEvent(
  ticket: RepairTicketDoc,
  status: RepairStatus,
  actor?: ActingUser | null,
  fromStatus?: RepairStatus,
): Promise<void> {
  /**
   * waiting_part → approved انتقال تشغيلي (رجوع للعمل بعد وصول القطعة) وليس
   * قرارًا جديدًا من العميل؛ إرسال «وصلنا موافقتك» هنا يربك العميل ويكرر رسالة قديمة.
   */
  if (status === 'approved' && fromStatus === 'waiting_part') return;

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
