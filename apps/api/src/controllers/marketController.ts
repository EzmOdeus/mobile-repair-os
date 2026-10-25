import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { OrganizationModel } from '../models/Organization.js';
import { BranchModel } from '../models/Branch.js';
import { UserModel } from '../models/User.js';
import {
  MarketListingModel,
  MARKET_LISTING_STATUSES,
  type MarketListingStatus,
} from '../models/MarketListing.js';
import { MarketOfferModel } from '../models/MarketOffer.js';
import { ApiError } from '../utils/ApiError.js';
import { created, ok, paginated } from '../utils/asyncHandler.js';
import { parseCsv, parseListQuery, regexSearch } from '../utils/queryHelpers.js';
import { authHas, branchFilter, getAuth } from '../middleware/auth.js';
import { runAsSystem } from '../context/tenantContext.js';
import { saveFile, softDeleteFile } from '../services/storageService.js';
import { normalizeEgyptPhone } from '../validators/common.js';
import type {
  createMarketListingSchema,
  createMarketOfferSchema,
  decideMarketOfferSchema,
  markMarketListingSoldSchema,
  removeMarketListingSchema,
  updateMarketListingSchema,
} from '../validators/marketValidators.js';
import type { z } from 'zod';
import {
  effectiveMarketStatus,
  marketImageMap,
  normalizeMarketKey,
  notifyMarketOrganizationStaff,
  notifyMarketUser,
  serializeMarketListing,
  type ListingLike,
} from '../services/marketService.js';

type ListingRecord = ListingLike & { _id: Types.ObjectId; organizationId: Types.ObjectId; branchId?: Types.ObjectId | null };

interface OfferLike {
  _id: unknown;
  organizationId: unknown;
  branchId?: unknown;
  listingId: unknown;
  listingTitle?: string;
  listingPriceEgp?: number;
  listingScope?: string;
  listingKind?: string;
  sellerOrganizationName?: string;
  buyerOrganizationId: unknown;
  buyerBranchId?: unknown;
  buyerUserId: unknown;
  buyerName?: string;
  buyerOrganizationName?: string;
  buyerPhone?: string;
  amountEgp: number;
  quantity?: number;
  message?: string;
  status: string;
  decidedBy?: unknown;
  decidedAt?: Date | null;
  decisionNote?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

function paramId(req: Request): string {
  const raw = req.params.id;
  const id = Array.isArray(raw) ? String(raw[0] ?? '') : String(raw ?? '');
  if (!id || !Types.ObjectId.isValid(id)) throw ApiError.badRequest('معرّف غير صحيح');
  return id;
}

function cleanPhone(value: string): string {
  const cleaned = value.replace(/[\s-()]/g, '');
  return cleaned ? normalizeEgyptPhone(cleaned) : '';
}

const MARKET_SORTS: Record<string, Record<string, 1 | -1>> = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  price_asc: { priceEgp: 1 },
  price_desc: { priceEgp: -1 },
  popular: { viewsCount: -1 },
};

function marketSort(value: unknown): Record<string, 1 | -1> {
  return MARKET_SORTS[String(value ?? 'newest')] ?? MARKET_SORTS.newest!;
}

/** فلترة الحالات مع معالجة الانتهاء الفعلي دون كتابة دورية في قاعدة البيانات */
function applyStatusFilter(filter: Record<string, unknown>, raw: unknown, now: Date): void {
  const requested = parseCsv(raw).filter((s): s is MarketListingStatus =>
    (MARKET_LISTING_STATUSES as readonly string[]).includes(s),
  );
  const statuses = requested.length ? requested : (['active', 'reserved'] as MarketListingStatus[]);

  const clauses = statuses.map((status) => {
    if (status === 'expired') {
      return { $or: [{ status: 'expired' }, { status: 'active', expiresAt: { $ne: null, $lte: now } }] };
    }
    if (status === 'active') {
      return { status: 'active', $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] };
    }
    return { status };
  });

  const existing = Array.isArray(filter.$and) ? (filter.$and as unknown[]) : [];
  filter.$and = [...existing, { $or: clauses }];
}

function applySearchAndFilters(
  filter: Record<string, unknown>,
  req: Request,
  opts: { includeScope?: boolean } = {},
): void {
  const q = regexSearch(req.query.q);
  if (q) {
    filter.$or = [{ title: q }, { brand: q }, { model: q }, { description: q }];
  }
  const brand = String(req.query.brand ?? '').trim();
  if (brand) filter.brandKey = normalizeMarketKey(brand);
  const model = String(req.query.model ?? '').trim();
  if (model) filter.modelKey = normalizeMarketKey(model);
  const storage = String(req.query.storage ?? '').trim();
  if (storage) filter.storage = new RegExp(`^${storage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  const condition = String(req.query.condition ?? '').trim();
  if (condition) filter.condition = condition;
  const category = String(req.query.category ?? '').trim();
  if (category) filter.category = category;
  const kind = String(req.query.kind ?? '').trim();
  if (kind) filter.kind = kind;
  const governorate = String(req.query.governorate ?? '').trim();
  if (governorate) filter['location.governorate'] = governorate;

  const minPrice = Number(req.query.minPrice);
  const maxPrice = Number(req.query.maxPrice);
  if (Number.isFinite(minPrice) && minPrice > 0) filter.priceEgp = { ...(filter.priceEgp as object), $gte: minPrice };
  if (Number.isFinite(maxPrice) && maxPrice > 0) filter.priceEgp = { ...(filter.priceEgp as object), $lte: maxPrice };

  if (opts.includeScope) {
    const scope = String(req.query.scope ?? '').trim();
    if (scope === 'public' || scope === 'internal') filter.scope = scope;
  }
}

function serializeOffer(
  offer: OfferLike,
  opts: { viewerOrganizationId: string; canManage: boolean },
) {
  const isSellerOrg = String(offer.organizationId) === opts.viewerOrganizationId;
  const isBuyerOrg = String(offer.buyerOrganizationId) === opts.viewerOrganizationId;
  return {
    id: String(offer._id),
    listingId: String(offer.listingId),
    listingTitle: offer.listingTitle ?? '',
    listingPriceEgp: offer.listingPriceEgp ?? 0,
    listingScope: offer.listingScope ?? 'public',
    listingKind: offer.listingKind ?? 'sell',
    sellerOrganizationName: offer.sellerOrganizationName ?? '',
    buyerOrganizationId: String(offer.buyerOrganizationId),
    buyerBranchId: offer.buyerBranchId ? String(offer.buyerBranchId) : null,
    buyerUserId: String(offer.buyerUserId),
    buyerName: offer.buyerName ?? '',
    buyerOrganizationName: offer.buyerOrganizationName ?? '',
    buyerPhone: offer.buyerPhone ?? '',
    amountEgp: offer.amountEgp,
    quantity: offer.quantity ?? 1,
    message: offer.message ?? '',
    status: offer.status,
    decidedAt: offer.decidedAt ?? null,
    decisionNote: offer.decisionNote ?? '',
    createdAt: offer.createdAt ?? null,
    updatedAt: offer.updatedAt ?? null,
    isSellerOrg,
    isBuyerOrg,
    canAccept: isSellerOrg && opts.canManage && offer.status === 'pending',
    canReject: isSellerOrg && opts.canManage && offer.status === 'pending',
    canWithdraw: isBuyerOrg && opts.canManage && offer.status === 'pending',
  };
}

async function loadOwnListing(req: Request): Promise<ListingRecord> {
  const filter: Record<string, unknown> = { _id: paramId(req) };
  const branch = branchFilter(req);
  if (branch) filter.branchId = branch;
  const listing = await MarketListingModel.findOne(filter).lean();
  if (!listing) throw ApiError.notFound('الإعلان غير موجود');
  return listing as unknown as ListingRecord;
}

async function loadOwnListingDoc(req: Request) {
  const filter: Record<string, unknown> = { _id: paramId(req) };
  const branch = branchFilter(req);
  if (branch) filter.branchId = branch;
  const listing = await MarketListingModel.findOne(filter);
  if (!listing) throw ApiError.notFound('الإعلان غير موجود');
  return listing;
}

async function loadVisibleListing(req: Request): Promise<{ listing: ListingRecord; isOwnOrg: boolean }> {
  const auth = getAuth(req);
  const listing = await runAsSystem(() => MarketListingModel.findById(paramId(req)).lean());
  if (!listing) throw ApiError.notFound('الإعلان غير موجود');

  const record = listing as unknown as ListingRecord;
  const isOwnOrg = String(record.organizationId) === auth.organizationId;
  if (isOwnOrg) return { listing: record, isOwnOrg };

  const publiclyVisible =
    record.scope === 'public' && ['active', 'reserved'].includes(effectiveMarketStatus(record));
  if (!publiclyVisible) throw ApiError.notFound('الإعلان غير موجود');
  return { listing: record, isOwnOrg };
}

async function serializeListingFor(
  req: Request,
  listing: ListingRecord,
  opts: { includeModeration?: boolean } = {},
) {
  const auth = getAuth(req);
  const isOwnOrg = String(listing.organizationId) === auth.organizationId;
  const imageMap = await marketImageMap([listing]);
  return serializeMarketListing(listing, {
    imageMap,
    viewerOrganizationId: auth.organizationId,
    canManage: isOwnOrg && authHas(req, 'market:manage'),
    includeModeration: isOwnOrg || opts.includeModeration,
  });
}

async function rejectPendingOffers(input: {
  listingId: Types.ObjectId;
  sellerUserId: string;
  note: string;
  excludeOfferId?: Types.ObjectId | null;
}): Promise<void> {
  const filter: Record<string, unknown> = { listingId: input.listingId, status: 'pending' };
  if (input.excludeOfferId) filter._id = { $ne: input.excludeOfferId };

  const pending = await MarketOfferModel.find(filter)
    .select('buyerOrganizationId buyerBranchId buyerUserId listingTitle')
    .lean();
  if (!pending.length) return;

  await MarketOfferModel.updateMany(filter, {
    $set: {
      status: 'rejected',
      decidedBy: new Types.ObjectId(input.sellerUserId),
      decidedAt: new Date(),
      decisionNote: input.note,
    },
  });

  await Promise.all(
    pending.map((offer) =>
      notifyMarketUser({
        organizationId: offer.buyerOrganizationId as Types.ObjectId,
        branchId: offer.buyerBranchId as Types.ObjectId | null,
        userId: offer.buyerUserId as Types.ObjectId,
        type: 'market_offer_rejected',
        subject: 'تم رفض عرضك',
        body: `تم رفض عرضك على «${offer.listingTitle ?? 'إعلان'}»: ${input.note}`,
        listingId: input.listingId,
        createdBy: input.sellerUserId,
      }),
    ),
  );
}

/* ============================== الإعلانات ============================== */

export async function listMarketListings(req: Request, res: Response) {
  const auth = getAuth(req);
  const { page, limit, skip } = parseListQuery(req.query as Record<string, unknown>, 24, 100);
  const now = new Date();
  const scope = String(req.query.scope ?? 'public').trim();

  const filter: Record<string, unknown> = {};
  applySearchAndFilters(filter, req);

  if (scope === 'internal') {
    filter.scope = 'internal';
    applyStatusFilter(filter, req.query.status, now);
    const branchId = String(req.query.branchId ?? '').trim();
    if (branchId && Types.ObjectId.isValid(branchId)) filter.branchId = new Types.ObjectId(branchId);
  } else {
    filter.scope = 'public';
    applyStatusFilter(filter, req.query.status, now);
  }

  const execute = () =>
    Promise.all([
      MarketListingModel.find(filter).sort(marketSort(req.query.sort)).skip(skip).limit(limit).lean(),
      MarketListingModel.countDocuments(filter),
    ]);
  const [items, total] = scope === 'internal' ? await execute() : await runAsSystem(execute);

  const imageMap = await marketImageMap(items as unknown as ListingLike[]);
  return paginated(
    res,
    (items as unknown as ListingRecord[]).map((listing) =>
      serializeMarketListing(listing, {
        imageMap,
        viewerOrganizationId: auth.organizationId,
        canManage: String(listing.organizationId) === auth.organizationId && authHas(req, 'market:manage'),
      }),
    ),
    { page, limit, total },
  );
}

export async function getMarketListing(req: Request, res: Response) {
  const auth = getAuth(req);
  const { listing, isOwnOrg } = await loadVisibleListing(req);

  if (!isOwnOrg && effectiveMarketStatus(listing) === 'active') {
    void runAsSystem(() =>
      MarketListingModel.updateOne({ _id: listing._id }, { $inc: { viewsCount: 1 } }),
    );
  }

  const imageMap = await marketImageMap([listing]);
  const item = serializeMarketListing(listing, {
    imageMap,
    viewerOrganizationId: auth.organizationId,
    canManage: isOwnOrg && authHas(req, 'market:manage'),
    includeModeration: isOwnOrg,
  });

  const offerFilter: Record<string, unknown> = {
    listingId: listing._id,
    buyerOrganizationId: new Types.ObjectId(auth.organizationId),
    status: { $in: ['pending', 'accepted'] },
  };
  if (auth.branchScoped && auth.branchId) offerFilter.buyerBranchId = new Types.ObjectId(auth.branchId);
  const myOffer = await runAsSystem(() =>
    MarketOfferModel.findOne(offerFilter).sort({ createdAt: -1 }).lean(),
  );

  return ok(res, {
    ...item,
    myOffer: myOffer ? serializeOffer(myOffer as unknown as OfferLike, {
      viewerOrganizationId: auth.organizationId,
      canManage: authHas(req, 'market:manage'),
    }) : null,
  });
}

export async function createMarketListing(req: Request, res: Response) {
  const auth = getAuth(req);
  const body = req.body as z.infer<typeof createMarketListingSchema>;

  const org = await OrganizationModel.findById(auth.organizationId).select('name phone address').lean();
  if (!org) throw ApiError.notFound('المؤسسة غير موجودة');
  const branch = auth.branchId
    ? await BranchModel.findById(auth.branchId).select('name phone address').lean()
    : null;

  const phone = cleanPhone(body.contactPhone || branch?.phone || org.phone || '');
  if (!phone) throw ApiError.badRequest('رقم التواصل مطلوب لنشر الإعلان');

  const now = new Date();
  const expiresAt = new Date(now.getTime() + body.expiresInDays * 24 * 60 * 60 * 1000);
  const isPublic = body.scope === 'public';

  const listing = await MarketListingModel.create({
    organizationId: new Types.ObjectId(auth.organizationId),
    branchId: auth.branchId ? new Types.ObjectId(auth.branchId) : null,
    scope: body.scope,
    kind: body.kind,
    status: isPublic ? 'pending_review' : 'active',
    title: body.title,
    description: body.description,
    category: body.category,
    brand: body.brand,
    model: body.model,
    brandKey: normalizeMarketKey(body.brand),
    modelKey: normalizeMarketKey(body.model),
    storage: body.storage,
    storageKey: normalizeMarketKey(body.storage),
    ram: body.ram,
    color: body.color,
    condition: body.condition,
    batteryHealth: body.batteryHealth,
    warrantyDays: body.warrantyDays,
    includes: body.includes,
    priceEgp: body.priceEgp,
    negotiable: body.negotiable,
    quantity: body.quantity,
    contact: {
      name: body.contactName || auth.fullName,
      phone,
      whatsapp: cleanPhone(body.contactWhatsapp) || phone,
    },
    location: {
      governorate: body.location?.governorate || branch?.address?.governorate || org.address?.governorate || '',
      city: body.location?.city || branch?.address?.city || org.address?.city || '',
      area: body.location?.area || branch?.address?.area || org.address?.area || '',
    },
    seller: {
      organizationName: org.name,
      branchName: branch?.name ?? '',
    },
    publishedAt: isPublic ? null : now,
    expiresAt,
    createdBy: new Types.ObjectId(auth.userId),
    updatedBy: new Types.ObjectId(auth.userId),
  });

  return created(res, await serializeListingFor(req, listing.toObject() as unknown as ListingRecord));
}

export async function updateMarketListing(req: Request, res: Response) {
  const auth = getAuth(req);
  const body = req.body as z.infer<typeof updateMarketListingSchema>;
  const doc = await loadOwnListingDoc(req);
  const old = doc.toObject() as unknown as ListingLike;

  if (['reserved', 'sold'].includes(old.status)) {
    throw ApiError.businessRule('لا يمكن تعديل إعلان محجوز أو مكتمل. أعد فتحه أولًا.');
  }

  const now = new Date();
  const changes: Record<string, unknown> = { updatedBy: new Types.ObjectId(auth.userId) };
  const reviewFields = [
    'title', 'description', 'category', 'brand', 'model', 'storage', 'ram', 'color',
    'condition', 'batteryHealth', 'warrantyDays', 'includes', 'priceEgp', 'quantity', 'kind',
  ] as const;
  let contentChanged = false;

  for (const field of reviewFields) {
    const next = body[field as keyof typeof body];
    if (next === undefined) continue;
    if (JSON.stringify((old as unknown as Record<string, unknown>)[field]) !== JSON.stringify(next)) {
      contentChanged = true;
    }
    changes[field] = next;
  }

  if (body.brand !== undefined) changes.brandKey = normalizeMarketKey(body.brand);
  if (body.model !== undefined) changes.modelKey = normalizeMarketKey(body.model);
  if (body.storage !== undefined) changes.storageKey = normalizeMarketKey(body.storage);

  const oldExpired =
    old.status === 'active' && old.expiresAt && new Date(old.expiresAt).getTime() <= now.getTime();
  if (body.expiresInDays !== undefined) {
    changes.expiresAt = new Date(now.getTime() + body.expiresInDays * 24 * 60 * 60 * 1000);
  } else if (oldExpired) {
    changes.expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  }

  if (body.contactName !== undefined || body.contactPhone !== undefined || body.contactWhatsapp !== undefined) {
    const contact = {
      name: body.contactName ?? old.contact?.name ?? '',
      phone: old.contact?.phone ?? '',
      whatsapp: old.contact?.whatsapp ?? '',
    };
    if (body.contactPhone !== undefined) {
      const phone = cleanPhone(body.contactPhone);
      if (phone) contact.phone = phone;
    }
    if (body.contactWhatsapp !== undefined) {
      const whatsapp = cleanPhone(body.contactWhatsapp);
      if (whatsapp) contact.whatsapp = whatsapp;
    }
    changes.contact = contact;
  }

  if (body.location) {
    changes.location = {
      governorate: body.location.governorate ?? old.location?.governorate ?? '',
      city: body.location.city ?? old.location?.city ?? '',
      area: body.location.area ?? old.location?.area ?? '',
    };
  }

  if (body.scope && body.scope !== old.scope) {
    changes.scope = body.scope;
    contentChanged = true;
    if (body.scope === 'public') {
      changes.status = 'pending_review';
      changes.reviewedBy = null;
      changes.reviewedAt = null;
      changes.rejectionReason = '';
      changes.publishedAt = null;
    } else {
      changes.status = 'active';
      changes.publishedAt = old.publishedAt ?? now;
    }
  } else if (['rejected', 'removed'].includes(old.status)) {
    changes.status = old.scope === 'public' ? 'pending_review' : 'active';
    changes.reviewedBy = null;
    changes.reviewedAt = null;
    changes.rejectionReason = '';
    changes.publishedAt = old.scope === 'public' ? null : old.publishedAt ?? now;
  } else if (contentChanged && old.scope === 'public' && old.status === 'active') {
    changes.status = 'pending_review';
    changes.reviewedBy = null;
    changes.reviewedAt = null;
    changes.rejectionReason = '';
  } else if (contentChanged && old.scope === 'public' && old.status === 'pending_review') {
    changes.rejectionReason = '';
  }

  Object.assign(doc, changes);
  await doc.save();
  return ok(res, await serializeListingFor(req, doc.toObject() as unknown as ListingRecord));
}

export async function removeMarketListing(req: Request, res: Response) {
  const auth = getAuth(req);
  const body = req.body as z.infer<typeof removeMarketListingSchema>;
  const listing = await loadOwnListing(req);

  if (listing.status === 'reserved') throw ApiError.businessRule('لا يمكن حذف إعلان محجوز. أعد فتحه أولًا.');
  if (listing.status === 'sold') throw ApiError.businessRule('الإعلان مكتمل بالفعل');

  await MarketListingModel.updateOne(
    { _id: listing._id, organizationId: new Types.ObjectId(auth.organizationId) },
    { $set: { status: 'removed', removedReason: body.reason, updatedBy: new Types.ObjectId(auth.userId) } },
  );

  await rejectPendingOffers({
    listingId: new Types.ObjectId(String(listing._id)),
    sellerUserId: auth.userId,
    note: body.reason || 'تم إغلاق الإعلان',
  });

  return ok(res, await serializeListingFor(req, await loadOwnListing(req)));
}

export async function markMarketListingSold(req: Request, res: Response) {
  const auth = getAuth(req);
  const body = req.body as z.infer<typeof markMarketListingSoldSchema>;
  const listing = await loadOwnListing(req);

  if (!['active', 'reserved'].includes(listing.status)) {
    throw ApiError.businessRule('لا يمكن إتمام بيع إعلان غير متاح');
  }

  const now = new Date();
  await MarketListingModel.updateOne(
    { _id: listing._id, organizationId: new Types.ObjectId(auth.organizationId) },
    {
      $set: {
        status: 'sold',
        soldPriceEgp: body.soldPriceEgp ?? listing.priceEgp,
        soldAt: now,
        updatedBy: new Types.ObjectId(auth.userId),
      },
    },
  );

  await rejectPendingOffers({
    listingId: new Types.ObjectId(String(listing._id)),
    sellerUserId: auth.userId,
    note: body.note || 'تم إتمام البيع',
  });

  return ok(res, await serializeListingFor(req, await loadOwnListing(req)));
}

export async function reopenMarketListing(req: Request, res: Response) {
  const auth = getAuth(req);
  const listing = await loadOwnListing(req);

  if (!['reserved', 'sold'].includes(listing.status)) {
    throw ApiError.businessRule('الإعلان غير محجوز أو مكتمل حتى يُعاد فتحه');
  }

  const now = new Date();
  const expiresAt =
    listing.expiresAt && new Date(listing.expiresAt).getTime() <= now.getTime()
      ? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
      : listing.expiresAt;

  await MarketListingModel.updateOne(
    { _id: listing._id, organizationId: new Types.ObjectId(auth.organizationId) },
    {
      $set: {
        status: listing.scope === 'public' && !listing.reviewedAt ? 'pending_review' : 'active',
        acceptedOfferId: null,
        soldPriceEgp: null,
        soldAt: null,
        expiresAt,
        updatedBy: new Types.ObjectId(auth.userId),
      },
    },
  );

  return ok(res, await serializeListingFor(req, await loadOwnListing(req)));
}

export async function uploadMarketListingImages(req: Request, res: Response) {
  const auth = getAuth(req);
  const listing = await loadOwnListing(req);
  if (['reserved', 'sold', 'removed'].includes(listing.status)) {
    throw ApiError.businessRule('لا يمكن إضافة صور لإعلان محجوز أو مغلق');
  }

  const files = Array.isArray(req.files) ? (req.files as Express.Multer.File[]) : [];
  if (!files.length) throw ApiError.badRequest('أرفق صورة واحدة على الأقل');

  const existing = listing.images?.length ?? 0;
  if (existing + files.length > 6) {
    throw ApiError.businessRule(`الحد الأقصى 6 صور للإعلان (الموجود ${existing})`);
  }

  const savedIds: Types.ObjectId[] = [];
  for (const file of files) {
    const saved = await saveFile({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      kind: 'market_photo',
      caption: '',
    });
    savedIds.push(saved._id as Types.ObjectId);
  }

  const doc = await MarketListingModel.findById(listing._id);
  if (!doc) throw ApiError.notFound('الإعلان غير موجود');
  for (const fileId of savedIds) doc.images.push({ fileId, caption: '' });
  if (doc.scope === 'public' && doc.status === 'active') {
    doc.status = 'pending_review';
    doc.reviewedBy = null;
    doc.reviewedAt = null;
    doc.rejectionReason = '';
  }
  doc.updatedBy = new Types.ObjectId(auth.userId);
  await doc.save();

  return ok(res, await serializeListingFor(req, doc.toObject() as unknown as ListingRecord));
}

export async function deleteMarketListingImage(req: Request, res: Response) {
  const auth = getAuth(req);
  const listing = await loadOwnListing(req);
  const rawFileId = req.params.fileId;
  const fileId = Array.isArray(rawFileId) ? String(rawFileId[0] ?? '') : String(rawFileId ?? '');
  if (!Types.ObjectId.isValid(fileId)) throw ApiError.badRequest('معرّف صورة غير صحيح');

  const doc = await MarketListingModel.findById(listing._id);
  if (!doc) throw ApiError.notFound('الإعلان غير موجود');
  const before = doc.images.length;
  const remaining = doc.images.filter((image) => String(image.fileId) !== fileId);
  if (remaining.length === before) throw ApiError.notFound('الصورة غير موجودة في الإعلان');
  doc.set('images', remaining);

  if (doc.scope === 'public' && doc.status === 'active') {
    doc.status = 'pending_review';
    doc.reviewedBy = null;
    doc.reviewedAt = null;
    doc.rejectionReason = '';
  }
  doc.updatedBy = new Types.ObjectId(auth.userId);
  await doc.save();

  await softDeleteFile(fileId);
  return ok(res, await serializeListingFor(req, doc.toObject() as unknown as ListingRecord));
}

export async function myMarketListings(req: Request, res: Response) {
  const auth = getAuth(req);
  const { page, limit, skip } = parseListQuery(req.query as Record<string, unknown>, 24, 100);
  const filter: Record<string, unknown> = {};
  const branch = branchFilter(req);
  if (branch) filter.branchId = branch;
  const statuses = parseCsv(req.query.status).filter((s) =>
    (MARKET_LISTING_STATUSES as readonly string[]).includes(s),
  );
  if (statuses.length) filter.status = { $in: statuses };
  const q = regexSearch(req.query.q);
  if (q) filter.$or = [{ title: q }, { brand: q }, { model: q }];

  const [items, total] = await Promise.all([
    MarketListingModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    MarketListingModel.countDocuments(filter),
  ]);

  const ids = (items as unknown as ListingRecord[]).map((listing) => listing._id);
  const pendingCounts = ids.length
    ? await runAsSystem(() =>
        MarketOfferModel.aggregate([
          {
            $match: {
              organizationId: new Types.ObjectId(auth.organizationId),
              listingId: { $in: ids },
              status: 'pending',
            },
          },
          { $group: { _id: '$listingId', count: { $sum: 1 } } },
        ]),
      )
    : [];
  const pendingMap = new Map(
    (pendingCounts as Array<{ _id: Types.ObjectId; count: number }>).map((row) => [String(row._id), row.count]),
  );

  const imageMap = await marketImageMap(items as unknown as ListingLike[]);
  return paginated(
    res,
    (items as unknown as ListingRecord[]).map((listing) => ({
      ...serializeMarketListing(listing, {
        imageMap,
        viewerOrganizationId: auth.organizationId,
        canManage: true,
        includeModeration: true,
      }),
      pendingOffers: pendingMap.get(String(listing._id)) ?? 0,
    })),
    { page, limit, total },
  );
}

export async function listingOffers(req: Request, res: Response) {
  const auth = getAuth(req);
  const listing = await loadOwnListing(req);
  const { page, limit, skip } = parseListQuery(req.query as Record<string, unknown>, 40, 100);

  const filter: Record<string, unknown> = { listingId: listing._id };
  const statuses = parseCsv(req.query.status);
  if (statuses.length) filter.status = { $in: statuses };

  const [items, total] = await Promise.all([
    MarketOfferModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    MarketOfferModel.countDocuments(filter),
  ]);

  return paginated(
    res,
    (items as unknown as OfferLike[]).map((offer) =>
      serializeOffer(offer, {
        viewerOrganizationId: auth.organizationId,
        canManage: authHas(req, 'market:manage'),
      }),
    ),
    { page, limit, total },
  );
}

export async function createMarketOffer(req: Request, res: Response) {
  const auth = getAuth(req);
  const body = req.body as z.infer<typeof createMarketOfferSchema>;
  const { listing, isOwnOrg } = await loadVisibleListing(req);

  if (effectiveMarketStatus(listing) !== 'active') {
    throw ApiError.conflict('الإعلان لم يعد متاحًا لاستقبال عروض');
  }

  if (isOwnOrg) {
    if (listing.scope !== 'internal') {
      throw ApiError.conflict('لا يمكنك تقديم عرض على إعلانك العام');
    }
    if (!auth.branchId || String(listing.branchId ?? '') === auth.branchId) {
      throw ApiError.conflict('هذا الإعلان يخص فرعك — لا يمكنك تقديم عرض عليه');
    }
  }

  const quantity = body.quantity ?? 1;
  if (quantity > (listing.quantity ?? 1)) {
    throw ApiError.badRequest(`الكمية المطلوبة أكبر من المتاح (${listing.quantity ?? 1})`);
  }

  const duplicateFilter: Record<string, unknown> = {
    listingId: listing._id,
    buyerOrganizationId: new Types.ObjectId(auth.organizationId),
    status: 'pending',
  };
  if (auth.branchId) duplicateFilter.buyerBranchId = new Types.ObjectId(auth.branchId);
  const existing = await runAsSystem(() => MarketOfferModel.findOne(duplicateFilter).select('_id').lean());
  if (existing) throw ApiError.conflict('لديك عرض معلّق بالفعل على هذا الإعلان');

  const buyerOrg = await OrganizationModel.findById(auth.organizationId).select('name').lean();
  const buyerUser = await UserModel.findById(auth.userId).select('phone').lean();

  const payload = {
    organizationId: new Types.ObjectId(String(listing.organizationId)),
    branchId: listing.branchId ?? null,
    listingId: new Types.ObjectId(String(listing._id)),
    listingTitle: listing.title,
    listingPriceEgp: listing.priceEgp,
    listingScope: listing.scope,
    listingKind: listing.kind,
    sellerOrganizationName: listing.seller?.organizationName ?? '',
    buyerOrganizationId: new Types.ObjectId(auth.organizationId),
    buyerBranchId: auth.branchId ? new Types.ObjectId(auth.branchId) : null,
    buyerUserId: new Types.ObjectId(auth.userId),
    buyerName: auth.fullName,
    buyerOrganizationName: buyerOrg?.name ?? '',
    buyerPhone: cleanPhone(buyerUser?.phone ?? ''),
    amountEgp: body.amountEgp,
    quantity,
    message: body.message,
    status: 'pending' as const,
  };

  const offer = isOwnOrg
    ? await MarketOfferModel.create(payload)
    : await runAsSystem(() => MarketOfferModel.create(payload));

  await runAsSystem(() =>
    MarketListingModel.updateOne(
      { _id: listing._id, organizationId: new Types.ObjectId(String(listing.organizationId)) },
      { $inc: { offersCount: 1 } },
    ),
  );

  await notifyMarketOrganizationStaff({
    organizationId: listing.organizationId as Types.ObjectId,
    branchId: listing.branchId ?? null,
    type: 'market_offer_received',
    subject: 'وصل عرض شراء جديد',
    body: `${auth.fullName} من «${buyerOrg?.name ?? ''}» قدّم عرضًا بقيمة ${body.amountEgp} جنيه على «${listing.title}».`,
    listingId: listing._id,
    offerId: offer._id,
    excludeUserId: auth.userId,
    createdBy: auth.userId,
  });

  return created(res, serializeOffer(offer.toObject() as unknown as OfferLike, {
    viewerOrganizationId: auth.organizationId,
    canManage: true,
  }));
}

export async function decideMarketOffer(req: Request, res: Response) {
  const auth = getAuth(req);
  const body = req.body as z.infer<typeof decideMarketOfferSchema>;
  const offerId = paramId(req);
  const isWithdraw = body.action === 'withdraw';

  const offer = isWithdraw
    ? await runAsSystem(() => {
        const filter: Record<string, unknown> = {
          _id: offerId,
          buyerOrganizationId: new Types.ObjectId(auth.organizationId),
        };
        if (auth.branchScoped && auth.branchId) filter.buyerBranchId = new Types.ObjectId(auth.branchId);
        return MarketOfferModel.findOne(filter).lean();
      })
    : await MarketOfferModel.findOne({ _id: offerId }).lean();

  if (!offer) throw ApiError.notFound('العرض غير موجود');
  if (offer.status !== 'pending') throw ApiError.conflict('لا يمكن تعديل عرض غير معلّق');

  if (isWithdraw) {
    const updated = await runAsSystem(() =>
      MarketOfferModel.findOneAndUpdate(
        { _id: offer._id, organizationId: offer.organizationId, status: 'pending' },
        { $set: { status: 'withdrawn', decisionNote: body.note, decidedAt: new Date() } },
        { new: true },
      ).lean(),
    );
    if (!updated) throw ApiError.conflict('تغيّرت حالة العرض، حدّث الصفحة');
    return ok(res, serializeOffer(updated as unknown as OfferLike, {
      viewerOrganizationId: auth.organizationId,
      canManage: authHas(req, 'market:manage'),
    }));
  }

  const listing = await MarketListingModel.findOne({
    _id: offer.listingId,
    ...(auth.branchScoped && auth.branchId ? { branchId: new Types.ObjectId(auth.branchId) } : {}),
  }).lean();
  if (!listing) throw ApiError.notFound('الإعلان غير موجود');
  if (!['active', 'reserved'].includes(listing.status)) {
    throw ApiError.businessRule('الإعلان لم يعد متاحًا لاتخاذ قرار');
  }

  if (body.action === 'reject') {
    const rejected = await MarketOfferModel.findOneAndUpdate(
      { _id: offer._id, status: 'pending' },
      {
        $set: {
          status: 'rejected',
          decidedBy: new Types.ObjectId(auth.userId),
          decidedAt: new Date(),
          decisionNote: body.note,
        },
      },
      { new: true },
    ).lean();
    if (!rejected) throw ApiError.conflict('تغيّرت حالة العرض، حدّث الصفحة');

    // الملاحظة قد تنتهي بنقطة، فلا نضيف نقطة ثانية في نهاية الإشعار
    const rejectionNote = body.note?.trim().replace(/\.+$/, '');

    await notifyMarketUser({
      organizationId: offer.buyerOrganizationId as Types.ObjectId,
      branchId: offer.buyerBranchId as Types.ObjectId | null,
      userId: offer.buyerUserId as Types.ObjectId,
      type: 'market_offer_rejected',
      subject: 'تم رفض عرضك',
      body: `تم رفض عرضك على «${offer.listingTitle ?? 'إعلان'}»${rejectionNote ? `: ${rejectionNote}` : ''}.`,
      listingId: offer.listingId as Types.ObjectId,
      offerId: offer._id as Types.ObjectId,
      createdBy: auth.userId,
    });

    return ok(res, serializeOffer(rejected as unknown as OfferLike, {
      viewerOrganizationId: auth.organizationId,
      canManage: authHas(req, 'market:manage'),
    }));
  }

  // قبول العرض: حجز الإعلان ذريًا حتى لا يُقبل عرضان في نفس اللحظة
  const now = new Date();
  const reserved = await MarketListingModel.findOneAndUpdate(
    {
      _id: listing._id,
      status: 'active',
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    },
    {
      $set: {
        status: 'reserved',
        acceptedOfferId: new Types.ObjectId(offerId),
        updatedBy: new Types.ObjectId(auth.userId),
      },
    },
    { new: true },
  ).lean();

  if (!reserved) throw ApiError.conflict('الإعلان لم يعد متاحًا — قد يكون حُجز أو أُغلق');

  const accepted = await MarketOfferModel.findOneAndUpdate(
    { _id: offer._id, status: 'pending' },
    {
      $set: {
        status: 'accepted',
        decidedBy: new Types.ObjectId(auth.userId),
        decidedAt: now,
        decisionNote: body.note,
      },
    },
    { new: true },
  ).lean();

  if (!accepted) {
    await MarketListingModel.updateOne(
      { _id: listing._id, organizationId: new Types.ObjectId(String(listing.organizationId)) },
      { $set: { status: 'active', acceptedOfferId: null } },
    );
    throw ApiError.conflict('تغيّرت حالة العرض، حدّث الصفحة');
  }

  await rejectPendingOffers({
    listingId: new Types.ObjectId(String(listing._id)),
    sellerUserId: auth.userId,
    note: 'تم قبول عرض آخر على نفس الإعلان',
    excludeOfferId: new Types.ObjectId(offerId),
  });

  await notifyMarketUser({
    organizationId: offer.buyerOrganizationId as Types.ObjectId,
    branchId: offer.buyerBranchId as Types.ObjectId | null,
    userId: offer.buyerUserId as Types.ObjectId,
    type: 'market_offer_accepted',
    subject: 'تم قبول عرضك',
    body: `تم قبول عرضك بقيمة ${offer.amountEgp} جنيه على «${offer.listingTitle ?? 'إعلان'}». تواصل مع البائع لإتمام التسليم والدفع خارج النظام.`,
    listingId: offer.listingId as Types.ObjectId,
    offerId: offer._id as Types.ObjectId,
    createdBy: auth.userId,
  });

  return ok(res, serializeOffer(accepted as unknown as OfferLike, {
    viewerOrganizationId: auth.organizationId,
    canManage: authHas(req, 'market:manage'),
  }));
}

export async function myMarketOffers(req: Request, res: Response) {
  const auth = getAuth(req);
  const { page, limit, skip } = parseListQuery(req.query as Record<string, unknown>, 30, 100);

  const filter: Record<string, unknown> = {
    buyerOrganizationId: new Types.ObjectId(auth.organizationId),
  };
  if (auth.branchScoped && auth.branchId) filter.buyerBranchId = new Types.ObjectId(auth.branchId);
  const statuses = parseCsv(req.query.status);
  if (statuses.length) filter.status = { $in: statuses };

  const [offers, total] = await runAsSystem(() =>
    Promise.all([
      MarketOfferModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      MarketOfferModel.countDocuments(filter),
    ]),
  );

  const listingIds = [...new Set((offers as unknown as OfferLike[]).map((offer) => String(offer.listingId)))];
  const listings = listingIds.length
    ? await runAsSystem(() =>
        MarketListingModel.find({ _id: { $in: listingIds } })
          .select('title status scope kind expiresAt organizationId seller priceEgp images')
          .lean(),
      )
    : [];
  const listingMap = new Map(
    (listings as unknown as ListingRecord[]).map((listing) => [String(listing._id), listing]),
  );
  const imageMap = await marketImageMap(listings as unknown as ListingLike[]);

  return paginated(
    res,
    (offers as unknown as OfferLike[]).map((offer) => {
      const listing = listingMap.get(String(offer.listingId));
      return {
        ...serializeOffer(offer, {
          viewerOrganizationId: auth.organizationId,
          canManage: authHas(req, 'market:manage'),
        }),
        listing: listing
          ? {
              id: String(listing._id),
              title: listing.title,
              status: effectiveMarketStatus(listing),
              scope: listing.scope,
              kind: listing.kind,
              priceEgp: listing.priceEgp,
              expiresAt: listing.expiresAt ?? null,
              sellerOrganizationName: listing.seller?.organizationName ?? '',
              coverUrl: (listing.images?.[0] ? imageMap.get(String(listing.images[0].fileId)) : '') ?? '',
            }
          : null,
      };
    }),
    { page, limit, total },
  );
}

export async function marketStats(req: Request, res: Response) {
  const auth = getAuth(req);
  const now = new Date();
  const activeFilter = {
    status: 'active',
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
  };

  const [activePublic, activeInternal, pendingReview, sold, pendingOffersReceived] = await Promise.all([
    MarketListingModel.countDocuments({ ...activeFilter, scope: 'public' }),
    MarketListingModel.countDocuments({ ...activeFilter, scope: 'internal' }),
    MarketListingModel.countDocuments({ scope: 'public', status: 'pending_review' }),
    MarketListingModel.countDocuments({ status: 'sold' }),
    MarketOfferModel.countDocuments({ status: 'pending' }),
  ]);

  const pendingOffersSent = await runAsSystem(() =>
    MarketOfferModel.countDocuments({
      buyerOrganizationId: new Types.ObjectId(auth.organizationId),
      status: 'pending',
    }),
  );

  return ok(res, {
    activePublic,
    activeInternal,
    pendingReview,
    sold,
    pendingOffersReceived,
    pendingOffersSent,
  });
}
