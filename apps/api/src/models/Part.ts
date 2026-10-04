import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { tenantPlugin } from './plugins/tenantPlugin.js';

export const PART_CATEGORIES = [
  'screen',
  'battery',
  'charging_port',
  'back_glass',
  'camera',
  'speaker',
  'microphone',
  'flex_cable',
  'motherboard',
  'ic_chip',
  'housing',
  'button',
  'sim_tray',
  'water_damage_part',
  'tools',
  'accessory',
  'other',
] as const;

export const PART_GRADES = [
  'original',
  'oem',
  'aftermarket_a',
  'aftermarket_b',
  'refurbished',
  'pulled',
  'unknown',
] as const;

export const PART_CATEGORY_LABELS_AR: Record<(typeof PART_CATEGORIES)[number], string> = {
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

export const PART_GRADE_LABELS_AR: Record<(typeof PART_GRADES)[number], string> = {
  original: 'أصلي',
  oem: 'OEM',
  aftermarket_a: 'تجاري درجة أولى',
  aftermarket_b: 'تجاري درجة ثانية',
  refurbished: 'مُجدَّد',
  pulled: 'مفكوك من جهاز',
  unknown: 'غير محدد',
};

/** كتالوج القطع (Part) - التعريف، وليس الكمية */
const partSchema = new Schema(
  {
    // --- عزل المستأجر (tenant isolation) - تُفرض في tenantPlugin ---
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true, immutable: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    sku: { type: String, required: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    nameEn: { type: String, trim: true, default: '' },
    category: { type: String, enum: PART_CATEGORIES, required: true, index: true },
    grade: { type: String, enum: PART_GRADES, default: 'unknown', index: true },
    brand: { type: String, trim: true, default: '' },
    barcode: { type: String, trim: true, default: '' },
    description: { type: String, default: '' },

    /** التوافق - أساس اقتراح القطع للفني */
    compatibility: {
      deviceBrands: { type: [String], default: [], index: true },
      deviceModels: { type: [String], default: [], index: true },
      modelNumbers: { type: [String], default: [] },
    },

    pricing: {
      costEgp: { type: Number, default: 0, min: 0 },
      sellingPriceEgp: { type: Number, default: 0, min: 0 },
      wholesalePriceEgp: { type: Number, default: 0, min: 0 },
      lastCostEgp: { type: Number, default: 0, min: 0 },
    },

    /** مخزون إجمالي (مجموع الفروع) - يُحدَّث عند كل حركة */
    stock: {
      onHand: { type: Number, default: 0 },
      reserved: { type: Number, default: 0 },
      defective: { type: Number, default: 0 },
      incoming: { type: Number, default: 0 },
      reorderLevel: { type: Number, default: 2, min: 0 },
      reorderQty: { type: Number, default: 5, min: 0 },
    },

    warranty: {
      days: { type: Number, default: 0, min: 0 },
      supplierDays: { type: Number, default: 0, min: 0 },
      terms: { type: String, default: '' },
    },

    defaultSupplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', default: null },

    /** Parts Quality Intelligence - مؤشرات الفشل */
    quality: {
      unitsSold: { type: Number, default: 0, min: 0 },
      unitsFailed: { type: Number, default: 0, min: 0 },
      failureRatePct: { type: Number, default: 0, min: 0, max: 100 },
      avgLifespanDays: { type: Number, default: 0, min: 0 },
    },

    requiresSerialTracking: { type: Boolean, default: false },
    isConsumable: { type: Boolean, default: false },
    imageFileId: { type: Schema.Types.ObjectId, ref: 'StoredFile', default: null },
    notes: { type: String, default: '' },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

partSchema.plugin(tenantPlugin);

// فريد داخل المؤسسة فقط
partSchema.index({ organizationId: 1, sku: 1 }, { unique: true });
partSchema.index({ organizationId: 1, category: 1, isActive: 1 });
partSchema.index({ organizationId: 1, 'compatibility.deviceModels': 1 });
partSchema.index({ organizationId: 1, 'stock.onHand': 1, 'stock.reorderLevel': 1 });
partSchema.index({ name: 'text', sku: 'text', barcode: 'text', nameEn: 'text' });

/** الكمية المتاحة = الموجود - المحجوز (virtual علوي حتى لا يتعارض مع كائن stock) */
partSchema.virtual('availableQty').get(function available(this: { stock?: { onHand: number; reserved: number } }) {
  const s = this.stock;
  if (!s) return 0;
  return Math.max(0, (s.onHand ?? 0) - (s.reserved ?? 0));
});

partSchema.virtual('marginPct').get(function marginPct(this: {
  pricing?: { costEgp: number; sellingPriceEgp: number };
}) {
  const p = this.pricing;
  if (!p?.sellingPriceEgp) return 0;
  return Number((((p.sellingPriceEgp - p.costEgp) / p.sellingPriceEgp) * 100).toFixed(2));
});

export type Part = InferSchemaType<typeof partSchema>;
export type PartDoc = HydratedDocument<Part>;

export const PartModel = model('Part', partSchema);
export default PartModel;
