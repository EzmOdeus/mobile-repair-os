/**
 * دورة حياة تذكرة الصيانة (Repair Workflow)
 * Received → Intake → Inspection → Diagnosis → Estimate → Waiting Approval → Approved
 * → Waiting Part → Repairing → Testing/QC → Ready → Customer Notified → Paid → Delivered → Warranty
 */

export const REPAIR_STATUSES = [
  'received',
  'intake',
  'inspection',
  'diagnosis',
  'estimate',
  'waiting_approval',
  'approved',
  'waiting_part',
  'repairing',
  'testing_qc',
  'ready',
  'customer_notified',
  'paid',
  'delivered',
  'warranty',
  'cancelled',
  'unrepairable',
] as const;

export type RepairStatus = (typeof REPAIR_STATUSES)[number];

export const REPAIR_STATUS_LABELS_AR: Record<RepairStatus, string> = {
  received: 'تم الاستلام',
  intake: 'إدخال البيانات',
  inspection: 'الفحص الظاهري',
  diagnosis: 'التشخيص',
  estimate: 'عرض السعر',
  waiting_approval: 'بانتظار الموافقة',
  approved: 'تمت الموافقة',
  waiting_part: 'بانتظار قطعة',
  repairing: 'جارٍ الإصلاح',
  testing_qc: 'اختبار وجودة',
  ready: 'جاهز للتسليم',
  customer_notified: 'تم إبلاغ العميل',
  paid: 'تم الدفع',
  delivered: 'تم التسليم',
  warranty: 'تحت الضمان',
  cancelled: 'ملغي',
  unrepairable: 'غير قابل للإصلاح',
};

/** ترتيب المرحلة على لوحة العمل (Kanban) */
export const REPAIR_STATUS_ORDER: Record<RepairStatus, number> = REPAIR_STATUSES.reduce(
  (acc, status, index) => {
    acc[status] = index;
    return acc;
  },
  {} as Record<RepairStatus, number>,
);

/**
 * المراحل النشطة (الجهاز لا يزال داخل المركز — لم يُسلَّم ولم يُلغَ).
 *
 * ملاحظة مهمة: `warranty` ليست حالة نشطة. الجهاز في `warranty` تم تسليمه بالفعل
 * ويوجد claim ضمان مفتوح عليه؛ وإدراجها هنا كان يجعل مؤشرات «التذاكر المفتوحة»
 * و«متوسط عمر التذاكر المفتوحة» تشمل أجهزة مُسلَّمة منذ شهور.
 */
export const ACTIVE_REPAIR_STATUSES: RepairStatus[] = [
  'received',
  'intake',
  'inspection',
  'diagnosis',
  'estimate',
  'waiting_approval',
  'approved',
  'waiting_part',
  'repairing',
  'testing_qc',
  'ready',
  'customer_notified',
  'paid',
];

/** حالات تعني أن الجهاز غادر المركز (مُسلَّم أو ملغي أو غير قابل للإصلاح) */
export const INACTIVE_REPAIR_STATUSES: RepairStatus[] = [
  'delivered',
  'warranty',
  'cancelled',
  'unrepairable',
];

/** حالات نهائية لا يمكن الانتقال منها */
export const TERMINAL_REPAIR_STATUSES: RepairStatus[] = [
  'delivered',
  'cancelled',
  'unrepairable',
];

/**
 * خريطة الانتقالات المسموح بها. أي انتقال خارجها مرفوض من الـworkflow engine.
 * الانتقالات المضافة تشمل مسارات الرجوع الشائعة واقعيًا (إعادة للفني، انتظار قطعة أخرى، إلخ).
 */
export const REPAIR_TRANSITIONS: Record<RepairStatus, RepairStatus[]> = {
  received: ['intake', 'inspection', 'cancelled'],
  intake: ['inspection', 'diagnosis', 'cancelled'],
  inspection: ['diagnosis', 'estimate', 'cancelled', 'unrepairable'],
  diagnosis: ['estimate', 'waiting_approval', 'repairing', 'unrepairable', 'cancelled'],
  estimate: ['waiting_approval', 'approved', 'cancelled', 'unrepairable'],
  waiting_approval: ['approved', 'cancelled', 'unrepairable', 'diagnosis'],
  approved: ['waiting_part', 'repairing', 'cancelled'],
  waiting_part: ['repairing', 'cancelled', 'approved'],
  repairing: ['testing_qc', 'waiting_part', 'unrepairable'],
  testing_qc: ['ready', 'repairing', 'waiting_part'],
  ready: ['customer_notified', 'paid', 'delivered'],
  customer_notified: ['paid', 'delivered', 'ready'],
  paid: ['delivered', 'ready'],
  delivered: ['warranty'],
  warranty: ['repairing', 'waiting_part', 'ready', 'delivered', 'unrepairable'],
  cancelled: [],
  unrepairable: ['delivered', 'cancelled'],
};

/** هل الانتقال مسموح؟ */
export function canTransition(from: RepairStatus, to: RepairStatus): boolean {
  if (from === to) return false;
  return (REPAIR_TRANSITIONS[from] ?? []).includes(to);
}

/** الحالات التي تعني أن الجهاز تم تسليمه */
export const CLOSED_REPAIR_STATUSES: RepairStatus[] = ['delivered'];

/** حالات تتطلب وجود عرض سعر معتمد قبل المتابعة */
export const STATUSES_REQUIRING_APPROVAL: RepairStatus[] = [
  'approved',
  'waiting_part',
  'repairing',
  'testing_qc',
  'ready',
  'paid',
  'delivered',
];

/** أولوية التذكرة */
export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_PRIORITY_LABELS_AR: Record<TicketPriority, string> = {
  low: 'منخفضة',
  normal: 'عادية',
  high: 'مرتفعة',
  urgent: 'عاجلة',
};

/** معامل حساب الـSLA بالساعات حسب الأولوية */
export const SLA_HOURS_BY_PRIORITY: Record<TicketPriority, number> = {
  low: 120,
  normal: 72,
  high: 24,
  urgent: 6,
};

/** أنواع الأحداث في الـTimeline / Chain of Custody */
export const TIMELINE_EVENT_TYPES = [
  'created',
  'status_changed',
  'assigned',
  'unassigned',
  'diagnosis',
  'estimate_created',
  'estimate_sent',
  'approved',
  'rejected',
  'part_reserved',
  'part_consumed',
  'part_returned',
  'photo_added',
  'note_added',
  'qc_passed',
  'qc_failed',
  'invoice_created',
  'payment_recorded',
  'notified',
  'delivered',
  'warranty_claim',
  'warranty_resolved',
  'sla_breach',
] as const;

export type TimelineEventType = (typeof TIMELINE_EVENT_TYPES)[number];

/** نتيجة الإصلاح النهائية */
export const REPAIR_OUTCOMES = [
  'pending',
  'repaired',
  'partially_repaired',
  'not_repaired',
  'customer_declined',
  'device_unrepairable',
] as const;
export type RepairOutcome = (typeof REPAIR_OUTCOMES)[number];

/** طرق الدفع */
export const PAYMENT_METHODS = [
  'cash',
  'card',
  'wallet',
  'instapay',
  'bank_transfer',
  'credit',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS_AR: Record<PaymentMethod, string> = {
  cash: 'نقدي',
  card: 'بطاقة',
  wallet: 'محفظة إلكترونية',
  instapay: 'إنستاباي',
  bank_transfer: 'تحويل بنكي',
  credit: 'آجل',
};
