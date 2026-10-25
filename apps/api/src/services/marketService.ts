import { Types } from 'mongoose';
import { StoredFileModel } from '../models/StoredFile.js';
import { UserModel } from '../models/User.js';
import { NotificationModel, type NotificationType } from '../models/Notification.js';
import { permissionsForRole, type Permission, type Role } from '../constants/roles.js';
import { runAsSystem } from '../context/tenantContext.js';
import { env } from '../config/env.js';
import { publicFileUrl } from './storageService.js';
import { rolesWithPermission } from './notificationService.js';
import { slugify } from '../utils/ids.js';

/** روابط صور السوق موقّعة لمدة أسبوع — تُعاد للعميل عند كل تحميل لقائمة/إعلان */
const MARKET_IMAGE_TTL_MINUTES = 60 * 24 * 7;

export function normalizeMarketKey(value: unknown): string {
  return slugify(String(value ?? '').trim());
}

export interface MarketImageRef {
  fileId: unknown;
  caption?: string;
}

export interface ListingLike {
  _id: unknown;
  organizationId: unknown;
  branchId?: unknown;
  scope: string;
  kind: string;
  status: string;
  title: string;
  description?: string;
  category?: string;
  brand: string;
  model: string;
  storage?: string;
  storageKey?: string;
  ram?: string;
  color?: string;
  condition?: string;
  batteryHealth?: number | null;
  warrantyDays?: number;
  includes?: string[];
  priceEgp: number;
  negotiable?: boolean;
  quantity?: number;
  soldPriceEgp?: number | null;
  soldAt?: Date | null;
  contact?: { name?: string; phone?: string; whatsapp?: string };
  location?: { governorate?: string; city?: string; area?: string };
  seller?: { organizationName?: string; branchName?: string };
  images?: MarketImageRef[];
  viewsCount?: number;
  offersCount?: number;
  acceptedOfferId?: unknown;
  publishedAt?: Date | null;
  expiresAt?: Date | null;
  reviewedBy?: unknown;
  reviewedAt?: Date | null;
  rejectionReason?: string;
  removedReason?: string;
  createdBy?: unknown;
  updatedBy?: unknown;
  createdAt?: Date;
  updatedAt?: Date;
}

/** الحالة الفعلية: الإعلان النشط الذي انتهى موعده يُعرض منتهيًا دون كتابة قاعدة بيانات */
export function effectiveMarketStatus(listing: ListingLike, now = new Date()): string {
  if (listing.status === 'active' && listing.expiresAt && new Date(listing.expiresAt).getTime() <= now.getTime()) {
    return 'expired';
  }
  return listing.status;
}

export interface SerializedMarketListing {
  id: string;
  scope: string;
  kind: string;
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
  soldAt: Date | null;
  contact: { name: string; phone: string; whatsapp: string };
  location: { governorate: string; city: string; area: string };
  seller: { organizationName: string; branchName: string; isOwnOrg: boolean };
  images: Array<{ fileId: string; caption: string; url: string }>;
  coverUrl: string;
  viewsCount: number;
  offersCount: number;
  acceptedOfferId: string | null;
  isOwnOrg: boolean;
  canManage: boolean;
  isExpired: boolean;
  publishedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  reviewedAt?: Date | null;
  rejectionReason?: string;
  removedReason?: string;
}

export function serializeMarketListing(
  listing: ListingLike,
  opts: {
    imageMap?: Map<string, string>;
    viewerOrganizationId?: string;
    canManage?: boolean;
    includeModeration?: boolean;
  } = {},
): SerializedMarketListing {
  const isOwnOrg = Boolean(
    opts.viewerOrganizationId && String(listing.organizationId) === String(opts.viewerOrganizationId),
  );
  const images = (listing.images ?? []).map((image) => ({
    fileId: String(image.fileId),
    caption: image.caption ?? '',
    url: opts.imageMap?.get(String(image.fileId)) ?? '',
  }));
  const effectiveStatus = effectiveMarketStatus(listing);

  return {
    id: String(listing._id),
    scope: listing.scope,
    kind: listing.kind,
    status: listing.status,
    effectiveStatus,
    title: listing.title,
    description: listing.description ?? '',
    category: listing.category ?? 'smartphone',
    brand: listing.brand,
    model: listing.model,
    storage: listing.storage ?? '',
    ram: listing.ram ?? '',
    color: listing.color ?? '',
    condition: listing.condition ?? 'good',
    batteryHealth: listing.batteryHealth ?? null,
    warrantyDays: listing.warrantyDays ?? 0,
    includes: listing.includes ?? [],
    priceEgp: listing.priceEgp,
    negotiable: listing.negotiable ?? true,
    quantity: listing.quantity ?? 1,
    soldPriceEgp: listing.soldPriceEgp ?? null,
    soldAt: listing.soldAt ?? null,
    contact: {
      name: listing.contact?.name ?? '',
      phone: listing.contact?.phone ?? '',
      whatsapp: listing.contact?.whatsapp ?? '',
    },
    location: {
      governorate: listing.location?.governorate ?? '',
      city: listing.location?.city ?? '',
      area: listing.location?.area ?? '',
    },
    seller: {
      organizationName: listing.seller?.organizationName ?? '',
      branchName: listing.seller?.branchName ?? '',
      isOwnOrg,
    },
    images,
    coverUrl: images[0]?.url ?? '',
    viewsCount: listing.viewsCount ?? 0,
    offersCount: listing.offersCount ?? 0,
    acceptedOfferId: listing.acceptedOfferId ? String(listing.acceptedOfferId) : null,
    isOwnOrg,
    canManage: opts.canManage ?? isOwnOrg,
    isExpired: effectiveStatus === 'expired',
    publishedAt: listing.publishedAt ?? null,
    expiresAt: listing.expiresAt ?? null,
    createdAt: listing.createdAt ?? null,
    updatedAt: listing.updatedAt ?? null,
    ...(opts.includeModeration
      ? {
          reviewedAt: listing.reviewedAt ?? null,
          rejectionReason: listing.rejectionReason ?? '',
          removedReason: listing.removedReason ?? '',
        }
      : {}),
  };
}

/** خريطة معرّف الملف → رابط موقّع، لكل صور الصفحة دفعة واحدة */
export async function marketImageMap(listings: ListingLike[]): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const listing of listings) {
    for (const image of listing.images ?? []) ids.add(String(image.fileId));
  }
  if (!ids.size) return new Map();

  const files = await runAsSystem(() =>
    StoredFileModel.find({ _id: { $in: [...ids] }, isDeleted: false })
      .select('storageKey')
      .lean(),
  );

  return new Map(
    files.map((file) => [String(file._id), publicFileUrl(file.storageKey, MARKET_IMAGE_TTL_MINUTES)]),
  );
}

export interface MarketNotifyInput {
  organizationId: Types.ObjectId | string;
  branchId?: Types.ObjectId | string | null;
  type: NotificationType;
  subject: string;
  body: string;
  listingId?: Types.ObjectId | string | null;
  offerId?: Types.ObjectId | string | null;
  excludeUserId?: Types.ObjectId | string | null;
  createdBy?: Types.ObjectId | string | null;
}

function marketVariables(input: MarketNotifyInput): Record<string, string> {
  return {
    ...(input.listingId ? { listingId: String(input.listingId) } : {}),
    ...(input.offerId ? { offerId: String(input.offerId) } : {}),
  };
}

function marketTrackingUrl(input: MarketNotifyInput): string {
  return input.listingId ? `${env.PUBLIC_WEB_URL}/market/${String(input.listingId)}` : '';
}

/**
 * إشعار داخلي لفريق مؤسسة أخرى (البائع/المشتري) دون تغيير سياق الطلب.
 * يُستخدم runAsSystem مع organizationId صريح لأن سياق الطلب يخص المؤسسة الأخرى.
 */
export async function notifyMarketOrganizationStaff(
  input: MarketNotifyInput & { permission?: Permission },
): Promise<number> {
  const permission = input.permission ?? 'market:manage';
  const roles = rolesWithPermission(permission);
  if (!roles.length) return 0;

  const organizationId = new Types.ObjectId(String(input.organizationId));
  const users = await runAsSystem(() =>
    UserModel.find({ organizationId, isActive: true, role: { $in: roles } })
      .select('role extraPermissions deniedPermissions')
      .lean(),
  );

  let sent = 0;
  for (const user of users) {
    if (input.excludeUserId && String(user._id) === String(input.excludeUserId)) continue;

    const effective = new Set<string>(permissionsForRole(user.role as Role));
    if (user.role !== 'owner' && user.role !== 'admin') {
      for (const extra of user.extraPermissions ?? []) effective.add(extra);
      for (const denied of user.deniedPermissions ?? []) effective.delete(denied);
    }
    if (!effective.has(permission)) continue;

    await runAsSystem(() =>
      NotificationModel.create({
        organizationId,
        branchId: input.branchId ? new Types.ObjectId(String(input.branchId)) : null,
        type: input.type,
        channel: 'in_app',
        status: 'sent',
        userId: user._id,
        subject: input.subject,
        body: input.body,
        templateKey: input.type,
        variables: marketVariables(input),
        listingId: input.listingId ? new Types.ObjectId(String(input.listingId)) : null,
        offerId: input.offerId ? new Types.ObjectId(String(input.offerId)) : null,
        provider: 'internal',
        trackingUrl: marketTrackingUrl(input),
        sentAt: new Date(),
        createdBy: input.createdBy ? new Types.ObjectId(String(input.createdBy)) : null,
      }),
    );
    sent += 1;
  }
  return sent;
}

/** إشعار مستخدم بعينه (صاحب العرض) داخل مؤسسته */
export async function notifyMarketUser(
  input: MarketNotifyInput & { userId: Types.ObjectId | string },
): Promise<boolean> {
  const organizationId = new Types.ObjectId(String(input.organizationId));
  const user = await runAsSystem(() =>
    UserModel.findOne({ _id: input.userId, organizationId, isActive: true }).select('_id').lean(),
  );
  if (!user) return false;

  await runAsSystem(() =>
    NotificationModel.create({
      organizationId,
      branchId: input.branchId ? new Types.ObjectId(String(input.branchId)) : null,
      type: input.type,
      channel: 'in_app',
      status: 'sent',
      userId: user._id,
      subject: input.subject,
      body: input.body,
      templateKey: input.type,
      variables: marketVariables(input),
      listingId: input.listingId ? new Types.ObjectId(String(input.listingId)) : null,
      offerId: input.offerId ? new Types.ObjectId(String(input.offerId)) : null,
      provider: 'internal',
      trackingUrl: marketTrackingUrl(input),
      sentAt: new Date(),
      createdBy: input.createdBy ? new Types.ObjectId(String(input.createdBy)) : null,
    }),
  );
  return true;
}

/** مضاعفات تصنيف المستعمل — تُطبَّق فقط عند غياب سعر دليل خاص بالتصنيف */
export const MARKET_GRADE_FACTORS: Record<string, number> = {
  none: 1,
  like_new: 0.92,
  excellent: 0.85,
  good: 0.75,
  fair: 0.6,
  parts: 0.35,
};

export function conditionToPriceGuideCondition(condition: string | null | undefined): 'new' | 'used' {
  return condition === 'new' ? 'new' : 'used';
}
