import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

/**
 * دليل أسعار مركزي تديره المنصة (لا يخضع لعزل المستأجر).
 * يمثل «العمود الأول» في بورصة الأسعار؛ العمود الثاني مؤشر مشتق من
 * الإعلانات العامة النشطة. صف واحد لكل (ماركة/موديل/سعة/حالة/تصنيف).
 */
export const PRICE_GUIDE_CONDITIONS = ['new', 'used'] as const;
export type PriceGuideCondition = (typeof PRICE_GUIDE_CONDITIONS)[number];

export const PRICE_GUIDE_GRADES = ['none', 'like_new', 'excellent', 'good', 'fair', 'parts'] as const;
export type PriceGuideGrade = (typeof PRICE_GUIDE_GRADES)[number];

export const PRICE_GUIDE_CONDITION_LABELS_AR: Record<PriceGuideCondition, string> = {
  new: 'جديد',
  used: 'مستعمل',
};

export const PRICE_GUIDE_GRADE_LABELS_AR: Record<PriceGuideGrade, string> = {
  none: 'عام',
  like_new: 'كالجديد',
  excellent: 'ممتاز',
  good: 'جيد',
  fair: 'مقبول',
  parts: 'قطع غيار',
};

const phonePriceGuideSchema = new Schema(
  {
    brand: { type: String, required: true, trim: true },
    model: { type: String, required: true, trim: true },
    storage: { type: String, trim: true, default: '' },
    brandKey: { type: String, required: true, index: true },
    modelKey: { type: String, required: true, index: true },
    storageKey: { type: String, default: '', index: true },

    condition: { type: String, enum: PRICE_GUIDE_CONDITIONS, required: true, index: true },
    grade: { type: String, enum: PRICE_GUIDE_GRADES, default: 'none', index: true },

    lowEgp: { type: Number, required: true, min: 0 },
    avgEgp: { type: Number, required: true, min: 0 },
    highEgp: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'EGP' },

    effectiveFrom: { type: Date, default: Date.now },
    sourceNote: { type: String, trim: true, default: '' },
    isActive: { type: Boolean, default: true, index: true },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

phonePriceGuideSchema.index(
  { brandKey: 1, modelKey: 1, storageKey: 1, condition: 1, grade: 1 },
  { unique: true },
);
phonePriceGuideSchema.index({ isActive: 1, updatedAt: -1 });

export type PhonePriceGuide = InferSchemaType<typeof phonePriceGuideSchema>;
export type PhonePriceGuideDoc = HydratedDocument<PhonePriceGuide>;

export const PhonePriceGuideModel = model('PhonePriceGuide', phonePriceGuideSchema);
export default PhonePriceGuideModel;
