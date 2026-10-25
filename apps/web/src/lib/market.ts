/** أنواع وتسميات ماركت بلس وبورصة الأسعار — مشتركة بين صفحات الويب */

export type MarketScope = 'public' | 'internal';
export type MarketKind = 'sell' | 'wanted';

export interface MarketListing {
  id: string;
  scope: MarketScope;
  kind: MarketKind;
  status: string;
  effectiveStatus: string;
  title: string;
  description: string;
  category: string;
  brand: string;
  model: string;
  storage: string;
  ram: string;
  color: string;
  condition: string;
  batteryHealth: number | null;
  warrantyDays: number;
  includes: string[];
  priceEgp: number;
  negotiable: boolean;
  quantity: number;
  soldPriceEgp: number | null;
  soldAt: string | null;
  contact: { name: string; phone: string; whatsapp: string };
  location: { governorate: string; city: string; area: string };
  seller: { organizationName: string; branchName: string; isOwnOrg: boolean };
  images: { fileId: string; caption: string; url: string }[];
  coverUrl: string;
  viewsCount: number;
  offersCount: number;
  acceptedOfferId: string | null;
  isOwnOrg: boolean;
  canManage: boolean;
  isExpired: boolean;
  publishedAt: string | null;
  expiresAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  reviewedAt?: string | null;
  rejectionReason?: string;
  removedReason?: string;
  pendingOffers?: number;
  /** عرض المستخدم الحالي (معلّق أو مقبول) — يرد فقط في صفحة التفاصيل */
  myOffer?: MarketOffer | null;
}

export interface MarketOffer {
  id: string;
  listingId: string;
  listingTitle: string;
  listingPriceEgp: number;
  listingScope: MarketScope;
  listingKind: MarketKind;
  sellerOrganizationName: string;
  buyerOrganizationId: string;
  buyerBranchId: string | null;
  buyerUserId: string;
  buyerName: string;
  buyerOrganizationName: string;
  buyerPhone: string;
  amountEgp: number;
  quantity: number;
  message: string;
  status: string;
  decidedAt: string | null;
  decisionNote: string;
  createdAt: string | null;
  updatedAt: string | null;
  isSellerOrg: boolean;
  isBuyerOrg: boolean;
  canAccept: boolean;
  canReject: boolean;
  canWithdraw: boolean;
  listing?: MarketListing | null;
}

export interface MarketStats {
  activePublic: number;
  activeInternal: number;
  pendingReview: number;
  sold: number;
  pendingOffersReceived: number;
  pendingOffersSent: number;
}

export interface MarketPriceGuideBlock {
  id: string;
  lowEgp: number;
  avgEgp: number;
  highEgp: number;
  effectiveFrom: string | null;
  sourceNote: string;
  updatedAt: string | null;
}

export interface MarketIndexBlock {
  lowEgp: number;
  avgEgp: number;
  highEgp: number;
  count: number;
  lastSeenAt: string | null;
}

export interface MarketPriceRow {
  key: string;
  brand: string;
  model: string;
  storage: string;
  condition: 'new' | 'used';
  grade: string;
  guide: MarketPriceGuideBlock | null;
  market: MarketIndexBlock | null;
  spreadPct: number | null;
}

export interface MarketPriceList {
  items: MarketPriceRow[];
  meta: {
    condition: 'new' | 'used';
    grade: string;
    sampleThreshold: number;
    guideCount: number;
    marketCount: number;
  };
}

export interface PhoneValuation {
  available: boolean;
  query: { brand: string; model: string; storage: string; condition: 'new' | 'used'; grade: string };
  guide: null | {
    lowEgp: number;
    avgEgp: number;
    highEgp: number;
    grade: string;
    factor: number;
    basis: 'grade_specific' | 'base_with_grade_factor' | 'base';
    effectiveFrom: string | null;
    sourceNote: string;
  };
  market: MarketIndexBlock | null;
  valuation: null | {
    lowEgp: number;
    avgEgp: number;
    highEgp: number;
    suggestedPriceEgp: number;
    confidence: 'high' | 'medium';
    basis: string[];
  };
  message?: string;
}

export interface PlatformPriceGuide {
  id: string;
  brand: string;
  model: string;
  storage: string;
  condition: 'new' | 'used';
  grade: string;
  lowEgp: number;
  avgEgp: number;
  highEgp: number;
  sourceNote: string;
  effectiveFrom: string | null;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export const SCOPE_LABELS: Record<string, string> = {
  public: 'سوق عام',
  internal: 'سوق داخلي',
};

export const KIND_LABELS: Record<string, string> = {
  sell: 'بيع',
  wanted: 'مطلوب',
};

export const LISTING_STATUS_LABELS: Record<string, string> = {
  draft: 'مسودة',
  pending_review: 'بانتظار المراجعة',
  active: 'نشط',
  reserved: 'محجوز',
  sold: 'مُباع',
  expired: 'منتهي',
  rejected: 'مرفوض',
  removed: 'محذوف',
};

export const OFFER_STATUS_LABELS: Record<string, string> = {
  pending: 'معلّق',
  accepted: 'مقبول',
  rejected: 'مرفوض',
  withdrawn: 'مسحوب',
  expired: 'منتهي',
};

export const CONDITION_LABELS: Record<string, string> = {
  new: 'جديد',
  excellent: 'ممتاز',
  good: 'جيد',
  fair: 'مقبول',
  poor: 'ضعيف',
  damaged: 'تالف',
};

export const CATEGORY_LABELS: Record<string, string> = {
  smartphone: 'هاتف',
  tablet: 'تابلت',
  smartwatch: 'ساعة ذكية',
  laptop: 'لابتوب',
  accessory: 'إكسسوار',
  other: 'أخرى',
};

export const GRADE_LABELS: Record<string, string> = {
  none: 'بدون تحديد',
  like_new: 'كالجديد',
  excellent: 'ممتاز',
  good: 'جيد',
  fair: 'مقبول',
  parts: 'قطع غيار',
};

export const CONDITION_STYLES: Record<string, string> = {
  new: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  excellent: 'bg-teal-50 text-teal-700 border-teal-200',
  good: 'bg-sky-50 text-sky-700 border-sky-200',
  fair: 'bg-amber-50 text-amber-700 border-amber-200',
  poor: 'bg-orange-50 text-orange-700 border-orange-200',
  damaged: 'bg-red-50 text-red-700 border-red-200',
};

export const LISTING_STATUS_STYLES: Record<string, string> = {
  draft: 'bg-ink-100 text-ink-600 border-ink-200',
  pending_review: 'bg-amber-50 text-amber-700 border-amber-200',
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  reserved: 'bg-sky-50 text-sky-700 border-sky-200',
  sold: 'bg-brand-50 text-brand-700 border-brand-200',
  expired: 'bg-ink-100 text-ink-500 border-ink-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
  removed: 'bg-ink-100 text-ink-400 border-ink-200',
};

export const OFFER_STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  accepted: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
  withdrawn: 'bg-ink-100 text-ink-500 border-ink-200',
  expired: 'bg-ink-100 text-ink-500 border-ink-200',
};

export const ARTICLE = 'إعلان';

export function specLine(listing: Pick<MarketListing, 'brand' | 'model' | 'storage' | 'ram' | 'color'>): string {
  return [listing.brand, listing.model, listing.storage, listing.ram, listing.color].filter(Boolean).join(' · ');
}

export function locationLine(listing: Pick<MarketListing, 'location'>): string {
  return [listing.location.governorate, listing.location.city, listing.location.area].filter(Boolean).join(' — ');
}
