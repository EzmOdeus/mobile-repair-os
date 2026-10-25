import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { tenantPlugin } from './plugins/tenantPlugin.js';

export const MARKET_OFFER_STATUSES = ['pending', 'accepted', 'rejected', 'withdrawn', 'expired'] as const;
export type MarketOfferStatus = (typeof MARKET_OFFER_STATUSES)[number];

export const MARKET_OFFER_STATUS_LABELS_AR: Record<MarketOfferStatus, string> = {
  pending: 'بانتظار الرد',
  accepted: 'مقبول',
  rejected: 'مرفوض',
  withdrawn: 'مسحوب',
  expired: 'منتهي',
};

/**
 * عرض سعر على إعلان في ماركت بلس.
 * المؤسسة المالكة للمستند هي البائع (organizationId)، والمشتري مؤسسة أخرى
 * تُخزَّن في buyerOrganizationId — قراءة المشتري لعروضه تتم عبر runAsSystem
 * مع فلترة صريحة على buyerOrganizationId.
 */
const marketOfferSchema = new Schema(
  {
    // --- عزل المستأجر (tenant isolation) - تُفرض في tenantPlugin ---
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true, immutable: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },

    listingId: { type: Schema.Types.ObjectId, ref: 'MarketListing', required: true, index: true },
    listingTitle: { type: String, trim: true, default: '' },
    listingPriceEgp: { type: Number, default: 0, min: 0 },
    listingScope: { type: String, enum: ['public', 'internal'], default: 'public' },
    listingKind: { type: String, enum: ['sell', 'wanted'], default: 'sell' },
    sellerOrganizationName: { type: String, trim: true, default: '' },

    buyerOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    buyerBranchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null },
    buyerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    buyerName: { type: String, trim: true, default: '' },
    buyerOrganizationName: { type: String, trim: true, default: '' },
    buyerPhone: { type: String, trim: true, default: '' },

    amountEgp: { type: Number, required: true, min: 0 },
    quantity: { type: Number, default: 1, min: 1 },
    message: { type: String, trim: true, default: '', maxlength: 1000 },

    status: { type: String, enum: MARKET_OFFER_STATUSES, default: 'pending', index: true },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, trim: true, default: '', maxlength: 1000 },
  },
  { timestamps: true },
);

marketOfferSchema.plugin(tenantPlugin);

marketOfferSchema.index({ organizationId: 1, listingId: 1, status: 1, createdAt: -1 });
marketOfferSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
marketOfferSchema.index({ buyerOrganizationId: 1, createdAt: -1 });
marketOfferSchema.index({ listingId: 1, buyerOrganizationId: 1, status: 1 });

export type MarketOffer = InferSchemaType<typeof marketOfferSchema>;
export type MarketOfferDoc = HydratedDocument<MarketOffer>;

export const MarketOfferModel = model('MarketOffer', marketOfferSchema);
export default MarketOfferModel;
