/** ثوابت مطابقة للـAPI: حالات الصيانة، الأولويات، والتصنيفات */

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

export const STATUS_LABELS: Record<RepairStatus, string> = {
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

export const STATUS_COLORS: Record<RepairStatus, string> = {
  received: 'bg-ink-100 text-ink-700 border-ink-200',
  intake: 'bg-sky-50 text-sky-700 border-sky-200',
  inspection: 'bg-sky-50 text-sky-700 border-sky-200',
  diagnosis: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  estimate: 'bg-violet-50 text-violet-700 border-violet-200',
  waiting_approval: 'bg-amber-50 text-amber-800 border-amber-200',
  approved: 'bg-teal-50 text-teal-700 border-teal-200',
  waiting_part: 'bg-orange-50 text-orange-800 border-orange-200',
  repairing: 'bg-blue-50 text-blue-700 border-blue-200',
  testing_qc: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  ready: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  customer_notified: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  paid: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  delivered: 'bg-ink-800 text-white border-ink-800',
  warranty: 'bg-purple-50 text-purple-700 border-purple-200',
  cancelled: 'bg-red-50 text-red-700 border-red-200',
  unrepairable: 'bg-red-50 text-red-700 border-red-200',
};

export const KANBAN_COLUMNS: RepairStatus[] = [
  'received',
  'inspection',
  'diagnosis',
  'waiting_approval',
  'approved',
  'waiting_part',
  'repairing',
  'testing_qc',
  'ready',
  'paid',
];

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'منخفضة',
  normal: 'عادية',
  high: 'مرتفعة',
  urgent: 'عاجلة',
};

export const PRIORITY_COLORS: Record<Priority, string> = {
  low: 'bg-ink-100 text-ink-600',
  normal: 'bg-sky-100 text-sky-700',
  high: 'bg-amber-100 text-amber-800',
  urgent: 'bg-red-100 text-red-700',
};

export const PAYMENT_METHODS = ['cash', 'card', 'wallet', 'instapay', 'bank_transfer', 'credit'] as const;
export const PAYMENT_METHOD_LABELS: Record<(typeof PAYMENT_METHODS)[number], string> = {
  cash: 'نقدي',
  card: 'بطاقة',
  wallet: 'محفظة إلكترونية',
  instapay: 'إنستاباي',
  bank_transfer: 'تحويل بنكي',
  credit: 'آجل',
};

export const PART_CATEGORY_LABELS: Record<string, string> = {
  screen: 'شاشة',
  battery: 'بطارية',
  charging_port: 'منفذ شحن',
  back_glass: 'ظهر زجاج',
  camera: 'كاميرا',
  speaker: 'سماعة',
  microphone: 'ميكروفون',
  flex_cable: 'فليكس',
  motherboard: 'بوردة',
  ic_chip: 'آي سي',
  housing: 'هيكل',
  button: 'زر',
  sim_tray: 'درج شريحة',
  water_damage_part: 'قطع أضرار سوائل',
  tools: 'أدوات',
  accessory: 'ملحق',
  other: 'أخرى',
};

export const PART_GRADE_LABELS: Record<string, string> = {
  original: 'أصلي',
  oem: 'OEM',
  aftermarket_a: 'تجاري درجة أولى',
  aftermarket_b: 'تجاري درجة ثانية',
  refurbished: 'مُجدَّد',
  pulled: 'مفكوك من جهاز',
  unknown: 'غير محدد',
};

export const QC_RESULT_LABELS: Record<string, string> = {
  pending: 'قيد التنفيذ',
  passed: 'اجتاز',
  failed: 'لم يجتز',
  passed_with_notes: 'اجتاز بملاحظات',
};

export const WARRANTY_STATUS_LABELS: Record<string, string> = {
  open: 'مفتوح',
  under_review: 'تحت المراجعة',
  approved: 'مقبول',
  rejected: 'مرفوض',
  in_repair: 'في الإصلاح',
  resolved: 'تم الحل',
  cancelled: 'ملغي',
};

export const FAULT_CATEGORY_LABELS: Record<string, string> = {
  display: 'شاشة وعرض',
  charging: 'شحن',
  battery: 'بطارية',
  audio: 'صوت وسماعات',
  water_damage: 'أضرار سوائل',
  camera: 'كاميرا',
  network: 'شبكة وشرائح',
  power: 'باور وتشغيل',
  software: 'برمجيات',
  hardware: 'هاردوير',
  back_glass: 'ظهر زجاج',
  biometrics: 'بصمة/تعرف',
  other: 'أخرى',
};

export const ACCESSORY_LABELS: Record<string, string> = {
  sim_tray: 'درج شريحة',
  memory_card: 'كارت ميموري',
  cover: 'جراب',
  charger: 'شاحن',
  box: 'علبة',
};

export function statusLabel(status?: string): string {
  return STATUS_LABELS[status as RepairStatus] ?? status ?? '—';
}

export function faultLabel(category?: string): string {
  if (!category) return 'غير محدد';
  return FAULT_CATEGORY_LABELS[category] ?? category;
}
