import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { MarketListingModel, MARKET_LISTING_STATUSES } from '../models/MarketListing.js';
import { MarketOfferModel } from '../models/MarketOffer.js';
import { PhonePriceGuideModel } from '../models/PhonePriceGuide.js';
import { ApiError } from '../utils/ApiError.js';
import { ok } from '../utils/asyncHandler.js';
import { parseCsv, parseListQuery, regexSearch } from '../utils/queryHelpers.js';
import { getAuth } from '../middleware/auth.js';
import { recordAudit } from '../services/auditService.js';
import { runAsSystem, type TenantContext } from '../context/tenantContext.js';
import {
  marketImageMap,
  notifyMarketOrganizationStaff,
  serializeMarketListing,
  type ListingLike,
} from '../services/marketService.js';
import type { rejectMarketListingSchema } from '../validators/marketValidators.js';
import type { z } from 'zod';

type ListingRecord = ListingLike & { _id: Types.ObjectId; organizationId: Types.ObjectId; branchId?: Types.ObjectId | null };

function paramId(req: Request): string {
  const raw = req.params.id;
  const id = Array.isArray(raw) ? String(raw[0] ?? '') : String(raw ?? '');
  if (!id || !Types.ObjectId.isValid(id)) throw ApiError.badRequest('معرّف إعلان غير صحيح');
  return id;
}

async function findListing(id: string): Promise<ListingRecord> {
  const listing = await runAsSystem(() => MarketListingModel.findById(id).lean());
  if (!listing) throw ApiError.notFound('الإعلان غير موجود');
  return listing as unknown as ListingRecord;
}

async function serializeForPlatform(listing: ListingRecord) {
  const imageMap = await marketImageMap([listing]);
  return serializeMarketListing(listing, { imageMap, canManage: false, includeModeration: true });
}

function platformMarketAuditContext(req: Request, listing: ListingRecord): TenantContext {
  const auth = getAuth(req);
  const userAgent = req.headers['user-agent'];
  return {
    actor: {
      userId: auth.userId,
      organizationId: new Types.ObjectId(auth.organizationId),
      branchId: null,
      role: auth.role,
      fullName: auth.fullName,
    },
    organizationId: new Types.ObjectId(String(listing.organizationId)),
    branchId: listing.branchId ? new Types.ObjectId(String(listing.branchId)) : null,
    requestId: req.requestId ?? '',
    ip: typeof req.ip === 'string' ? req.ip : '',
    userAgent: typeof userAgent === 'string' ? userAgent : '',
  };
}

/** قائمة إعلانات السوق لمراجعة المنصة (كل المؤسسات) */
export async function platformListMarketListings(req: Request, res: Response) {
  const { page, limit, skip } = parseListQuery(req.query as Record<string, unknown>, 30, 100);
  const filter: Record<string, unknown> = {};
  const statuses = parseCsv(req.query.status).filter((s) =>
    (MARKET_LISTING_STATUSES as readonly string[]).includes(s),
  );
  if (statuses.length) filter.status = { $in: statuses };
  else filter.status = 'pending_review';

  const scope = String(req.query.scope ?? '').trim();
  if (scope === 'public' || scope === 'internal') filter.scope = scope;
  const q = regexSearch(req.query.q);
  if (q) filter.$or = [{ title: q }, { brand: q }, { model: q }, { 'seller.organizationName': q }];

  const [items, total, pendingTotal] = await runAsSystem(() =>
    Promise.all([
      MarketListingModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      MarketListingModel.countDocuments(filter),
      MarketListingModel.countDocuments({ scope: 'public', status: 'pending_review' }),
    ]),
  );

  const imageMap = await marketImageMap(items as unknown as ListingLike[]);
  const pages = Math.ceil(total / limit);
  return res.status(200).json({
    success: true,
    data: (items as unknown as ListingRecord[]).map((listing) =>
      serializeMarketListing(listing, { imageMap, canManage: false, includeModeration: true }),
    ),
    meta: {
      page,
      limit,
      total,
      pages,
      hasNext: page < pages,
      hasPrev: page > 1,
      pendingTotal,
    },
  });
}

export async function platformApproveMarketListing(req: Request, res: Response) {
  const auth = getAuth(req);
  const listing = await findListing(paramId(req));

  if (listing.scope !== 'public') throw ApiError.businessRule('الإعلانات الداخلية لا تحتاج مراجعة منصة');
  if (listing.status === 'active') return ok(res, await serializeForPlatform(listing));
  if (!['pending_review', 'rejected'].includes(listing.status)) {
    throw ApiError.businessRule('لا يمكن اعتماد إعلان في حالته الحالية');
  }

  const now = new Date();
  const expiresAt =
    !listing.expiresAt || new Date(listing.expiresAt).getTime() <= now.getTime()
      ? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
      : listing.expiresAt;

  const updated = await runAsSystem(() =>
    MarketListingModel.findByIdAndUpdate(
      listing._id,
      {
        $set: {
          status: 'active',
          reviewedBy: new Types.ObjectId(auth.userId),
          reviewedAt: now,
          rejectionReason: '',
          publishedAt: now,
          expiresAt,
        },
      },
      { new: true },
    ).lean(),
  );
  if (!updated) throw ApiError.notFound('الإعلان غير موجود');

  await notifyMarketOrganizationStaff({
    organizationId: listing.organizationId,
    branchId: listing.branchId ?? null,
    type: 'market_listing_approved',
    subject: 'تم اعتماد إعلانك في ماركت بلس',
    body: `تم اعتماد إعلان «${listing.title}» ونشره في السوق العام.`,
    listingId: listing._id,
    createdBy: auth.userId,
  });

  await recordAudit(
    {
      action: 'update',
      resource: 'market_listing',
      resourceId: String(listing._id),
      summary: `اعتماد إعلان ماركت بلس: ${listing.title}`,
      changes: [{ field: 'status', before: listing.status, after: 'active' }],
      context: platformMarketAuditContext(req, listing),
    },
    req,
  );

  return ok(res, await serializeForPlatform(updated as unknown as ListingRecord));
}

export async function platformRejectMarketListing(req: Request, res: Response) {
  const auth = getAuth(req);
  const body = req.body as z.infer<typeof rejectMarketListingSchema>;
  const listing = await findListing(paramId(req));

  if (!['pending_review', 'active', 'rejected'].includes(listing.status)) {
    throw ApiError.businessRule('لا يمكن رفض إعلان في حالته الحالية');
  }

  const updated = await runAsSystem(() =>
    MarketListingModel.findByIdAndUpdate(
      listing._id,
      {
        $set: {
          status: 'rejected',
          reviewedBy: new Types.ObjectId(auth.userId),
          reviewedAt: new Date(),
          rejectionReason: body.reason,
        },
      },
      { new: true },
    ).lean(),
  );
  if (!updated) throw ApiError.notFound('الإعلان غير موجود');

  await notifyMarketOrganizationStaff({
    organizationId: listing.organizationId,
    branchId: listing.branchId ?? null,
    type: 'market_listing_rejected',
    subject: 'تم رفض إعلانك في ماركت بلس',
    body: `تم رفض إعلان «${listing.title}»: ${body.reason}. عدّل الإعلان وأعد نشره للمراجعة.`,
    listingId: listing._id,
    createdBy: auth.userId,
  });

  await recordAudit(
    {
      action: 'update',
      resource: 'market_listing',
      resourceId: String(listing._id),
      summary: `رفض إعلان ماركت بلس: ${listing.title} — ${body.reason}`,
      changes: [{ field: 'status', before: listing.status, after: 'rejected' }],
      severity: 'warning',
      context: platformMarketAuditContext(req, listing),
    },
    req,
  );

  return ok(res, await serializeForPlatform(updated as unknown as ListingRecord));
}

export async function platformMarketStats(_req: Request, res: Response) {
  const [pending, active, reserved, sold, rejected, offersPending, guides] = await Promise.all([
    runAsSystem(() => MarketListingModel.countDocuments({ scope: 'public', status: 'pending_review' })),
    runAsSystem(() => MarketListingModel.countDocuments({ status: 'active' })),
    runAsSystem(() => MarketListingModel.countDocuments({ status: 'reserved' })),
    runAsSystem(() => MarketListingModel.countDocuments({ status: 'sold' })),
    runAsSystem(() => MarketListingModel.countDocuments({ status: 'rejected' })),
    runAsSystem(() => MarketOfferModel.countDocuments({ status: 'pending' })),
    PhonePriceGuideModel.countDocuments({ isActive: true }),
  ]);

  return ok(res, {
    pending,
    active,
    reserved,
    sold,
    rejected,
    offersPending,
    priceGuides: guides,
  });
}
