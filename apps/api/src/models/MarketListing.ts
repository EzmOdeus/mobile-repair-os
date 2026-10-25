import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { tenantPlugin } from './plugins/tenantPlugin.js';

export const MARKET_SCOPES = ['public', 'internal'] as const;
export type MarketScope = (typeof MARKET_SCOPES)[number];

export const MARKET_LISTING_KINDS = ['sell', 'wanted'] as const;
export type MarketListingKind = (typeof MARKET_LISTING_KINDS)[number];

export const MARKET_LISTING_STATUSES = [
  'draft',
  'pending_review',
  'active',
  'reserved',
  'sold',
  'expired',
  'rejected',
  'removed',
] as const;
export type MarketListingStatus = (typeof MARKET_LISTING_STATUSES)[number];

export const MARKET_CONDITIONS = ['new', 'excellent', 'good', 'fair', 'poor', 'damaged'] as const;
export type MarketCondition = (typeof MARKET_CONDITIONS)[number];

export const MARKET_SCOPE_LABELS_AR: Record<MarketScope, string> = {
  public: 'السوق العام',
  internal: 'السوق الداخلي',
};

export const MARKET_LISTING_KIND_LABELS_AR: Record<MarketListingKind, string> = {
  sell: 'للبيع',
  wanted: 'مطلوب للشراء',
};

export const MARKET_LISTING_STATUS_LABELS_AR: Record<MarketListingStatus, string> = {
  draft: 'مسودة',
  pending_review: 'قيد المراجعة',
  active: 'متاح',
  reserved: 'محجوز',
  sold: 'تم البيع',
  expired: 'منتهي',
  rejected: 'مرفوض',
  removed: 'محذوف',
};

export const MARKET_CONDITION_LABELS_AR: Record<MarketCondition, string> = {
  new: 'جديد',
  excellent: 'ممتاز',
  good: 'جيد',
  fair: 'مقبول',
  poor: 'ضعيف',
  damaged: 'تالف',
};

export const MARKET_CATEGORIES = ['smartphone', 'tablet', 'smartwatch', 'laptop', 'accessory', 'other'] as const;
export type MarketCategory = (typeof MARKET_CATEGORIES)[number];

const imageSchema = new Schema(
  {
    fileId: { type: Schema.Types.ObjectId, ref: 'StoredFile', required: true },
    caption: { type: String, trim: true, default: '' },
  },
  { _id: false },
);

/**
 * إعلان في ماركت بلس.
 *
 * الإعلان ملك للمؤسسة البائعة (organizationId = البائع). الإعلانات العامة
 * تحتاج مراجعة منصة قبل النشر، والداخلية تُنشر فورًا داخل المؤسسة فقط.
 * المسارات العامة تقرأ عبر runAsSystem مع فلترة صريحة على scope/status.
 */
const marketListingSchema = new Schema(
  {
    // --- عزل المستأجر (tenant isolation) - تُفرض في tenantPlugin ---
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true, immutable: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },

    scope: { type: String, enum: MARKET_SCOPES, default: 'public', index: true },
    kind: { type: String, enum: MARKET_LISTING_KINDS, default: 'sell', index: true },
    status: { type: String, enum: MARKET_LISTING_STATUSES, default: 'draft', index: true },

    title: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, trim: true, default: '', maxlength: 4000 },

    // --- مواصفات الجهاز ---
    category: { type: String, enum: MARKET_CATEGORIES, default: 'smartphone', index: true },
    brand: { type: String, required: true, trim: true },
    model: { type: String, required: true, trim: true },
    brandKey: { type: String, default: '', index: true },
    modelKey: { type: String, default: '', index: true },
    storage: { type: String, trim: true, default: '' },
    storageKey: { type: String, default: '', index: true },
    ram: { type: String, trim: true, default: '' },
    color: { type: String, trim: true, default: '' },
    condition: { type: String, enum: MARKET_CONDITIONS, default: 'good', index: true },
    batteryHealth: { type: Number, min: 0, max: 100, default: null },
    warrantyDays: { type: Number, min: 0, default: 0 },
    includes: { type: [String], default: [] },

    // --- التسعير ---
    priceEgp: { type: Number, required: true, min: 0 },
    negotiable: { type: Boolean, default: true },
    quantity: { type: Number, default: 1, min: 1 },
    /** السعر الذي أُغلقت به الصفقة (عند البيع) */
    soldPriceEgp: { type: Number, default: null, min: 0 },
    soldAt: { type: Date, default: null },

    // --- بيانات تواصل ولقطة بائع ---
    contact: {
      name: { type: String, trim: true, default: '' },
      phone: { type: String, trim: true, default: '' },
      whatsapp: { type: String, trim: true, default: '' },
    },
    location: {
      governorate: { type: String, trim: true, default: '' },
      city: { type: String, trim: true, default: '' },
      area: { type: String, trim: true, default: '' },
    },
    seller: {
      organizationName: { type: String, trim: true, default: '' },
      branchName: { type: String, trim: true, default: '' },
    },

    images: { type: [imageSchema], default: [] },
    viewsCount: { type: Number, default: 0, min: 0 },
    offersCount: { type: Number, default: 0, min: 0 },
    acceptedOfferId: { type: Schema.Types.ObjectId, ref: 'MarketOffer', default: null },

    // --- النشر والمراجعة ---
    publishedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null, index: true },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, trim: true, default: '' },
    removedReason: { type: String, trim: true, default: '' },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

marketListingSchema.plugin(tenantPlugin);

marketListingSchema.index({ organizationId: 1, branchId: 1, status: 1, createdAt: -1 });
marketListingSchema.index({ organizationId: 1, scope: 1, status: 1, createdAt: -1 });
marketListingSchema.index({ scope: 1, status: 1, brandKey: 1, modelKey: 1, createdAt: -1 });
marketListingSchema.index({ scope: 1, status: 1, condition: 1, priceEgp: 1 });
marketListingSchema.index({ title: 'text', description: 'text', brand: 'text', model: 'text' });

export type MarketListing = InferSchemaType<typeof marketListingSchema>;
export type MarketListingDoc = HydratedDocument<MarketListing>;

export const MarketListingModel = model('MarketListing', marketListingSchema);
export default MarketListingModel;
