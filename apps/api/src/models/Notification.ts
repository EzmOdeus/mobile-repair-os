import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { tenantPlugin } from './plugins/tenantPlugin.js';

export const NOTIFICATION_CHANNELS = ['whatsapp', 'sms', 'email', 'in_app', 'push', 'print'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_TYPES = [
  'device_received',
  'diagnosis_completed',
  'estimate_ready',
  'approval_required',
  'approval_decided',
  'repair_started',
  'waiting_for_part',
  'ready_for_pickup',
  'delivered',
  'payment_due',
  'payment_received',
  'warranty_reminder',
  'warranty_claim_received',
  'review_request',
  'sla_warning',
  'sla_breach',
  'internal_assignment',
  'low_stock',
  'ticket_cancelled',
  'custom',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_TYPE_LABELS_AR: Record<NotificationType, string> = {
  device_received: 'تم استلام الجهاز',
  diagnosis_completed: 'انتهى التشخيص',
  estimate_ready: 'عرض السعر جاهز',
  approval_required: 'مطلوب موافقة العميل',
  approval_decided: 'قرار العميل على العرض',
  repair_started: 'بدأ الإصلاح',
  waiting_for_part: 'بانتظار قطعة',
  ready_for_pickup: 'الجهاز جاهز للاستلام',
  delivered: 'تم التسليم',
  payment_due: 'مبلغ مستحق',
  payment_received: 'تم تحصيل مبلغ',
  warranty_reminder: 'تذكير بالضمان',
  warranty_claim_received: 'استلام claim ضمان',
  review_request: 'طلب تقييم',
  sla_warning: 'تحذير موعد التسليم',
  sla_breach: 'تجاوز موعد التسليم',
  internal_assignment: 'تعيين مهمة لفني',
  low_stock: 'مخزون منخفض',
  ticket_cancelled: 'إلغاء الطلب',
  custom: 'رسالة مخصصة',
};

export const NOTIFICATION_STATUSES = ['queued', 'sent', 'delivered', 'read', 'failed', 'cancelled'] as const;

/**
 * Notification: الإشعارات الصادرة (WhatsApp/SMS/داخلي).
 * الأتمتة مرتبطة بحالة الإصلاح، والوضع الافتراضي log لتشغيل البيئة المحلية بدون مزوّد.
 */
const notificationSchema = new Schema(
  {
    // --- عزل المستأجر (tenant isolation) - تُفرض في tenantPlugin ---
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true, immutable: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true, index: true },
    channel: { type: String, enum: NOTIFICATION_CHANNELS, default: 'whatsapp', index: true },
    status: { type: String, enum: NOTIFICATION_STATUSES, default: 'queued', index: true },

    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', default: null, index: true },
    ticketId: { type: Schema.Types.ObjectId, ref: 'RepairTicket', default: null, index: true },
    deviceId: { type: Schema.Types.ObjectId, ref: 'Device', default: null },
    /** المستخدم المستهدف في الإشعارات الداخلية */
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },

    /** القناة */
    toPhone: { type: String, default: '' },
    toEmail: { type: String, default: '' },
    subject: { type: String, default: '' },
    body: { type: String, default: '' },
    /** القالب المستخدم ومتغيّراته */
    templateKey: { type: String, default: '' },
    variables: { type: Schema.Types.Mixed, default: {} },
    /** بيانات مزوّد الخدمة */
    provider: { type: String, default: 'log' },
    providerMessageId: { type: String, default: '' },
    errorMessage: { type: String, default: '' },
    attempts: { type: Number, default: 0, min: 0 },

    /** ربط بعنوان عام قابل للمشاركة */
    trackingUrl: { type: String, default: '' },
    readAt: { type: Date, default: null },
    sentAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    scheduledFor: { type: Date, default: null, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

notificationSchema.plugin(tenantPlugin);
notificationSchema.index({ organizationId: 1, createdAt: -1, status: 1 });
notificationSchema.index({ organizationId: 1, userId: 1, readAt: 1, createdAt: -1 });
notificationSchema.index({ organizationId: 1, ticketId: 1, createdAt: -1 });

export type Notification = InferSchemaType<typeof notificationSchema>;
export type NotificationDoc = HydratedDocument<Notification>;

export const NotificationModel = model('Notification', notificationSchema);
export default NotificationModel;
