import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import {
  PhonePriceGuideModel,
  PRICE_GUIDE_CONDITIONS,
  PRICE_GUIDE_GRADES,
  type PriceGuideCondition,
  type PriceGuideGrade,
} from '../models/PhonePriceGuide.js';
import { MarketListingModel } from '../models/MarketListing.js';
import { ApiError } from '../utils/ApiError.js';
import { getAuth } from '../middleware/auth.js';
import { ok, paginated } from '../utils/asyncHandler.js';
import { parseListQuery, regexSearch } from '../utils/queryHelpers.js';
import { runAsSystem } from '../context/tenantContext.js';
import { MARKET_GRADE_FACTORS, normalizeMarketKey } from '../services/marketService.js';
import type { priceGuideSchema, updatePriceGuideSchema } from '../validators/marketValidators.js';
import type { z } from 'zod';

interface MarketIndexRow {
  _id: { brandKey: string; modelKey: string; storageKey: string; condition: 'new' | 'used' };
  brand: string;
  model: string;
  storage: string;
  avgEgp: number;
  lowEgp: number;
  highEgp: number;
  count: number;
  lastSeenAt: Date;
}

const SAMPLE_THRESHOLD = 3;

function round(value: number): number {
  return Math.round(value);
}

function isPriceCondition(value: unknown): value is PriceGuideCondition {
  return (PRICE_GUIDE_CONDITIONS as readonly string[]).includes(String(value));
}

function isPriceGrade(value: unknown): value is PriceGuideGrade {
  return (PRICE_GUIDE_GRADES as readonly string[]).includes(String(value));
}

/** مؤشر السوق المشتق من الإعلانات العامة النشطة — لا يُخزَّن، يُحسب عند الطلب */
async function deriveMarketIndex(filters: {
  brandKey?: string;
  modelKey?: string;
  storageKey?: string;
  q?: RegExp;
}): Promise<MarketIndexRow[]> {
  const match: Record<string, unknown> = {
    scope: 'public',
    status: { $in: ['active', 'reserved'] },
    kind: 'sell',
    $and: [{ $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] }],
  };
  if (filters.brandKey) match.brandKey = filters.brandKey;
  if (filters.modelKey) match.modelKey = filters.modelKey;
  if (filters.storageKey) match.storageKey = filters.storageKey;
  if (filters.q) {
    (match.$and as unknown[]).push({ $or: [{ brand: filters.q }, { model: filters.q }] });
  }

  return runAsSystem(() =>
    MarketListingModel.aggregate<MarketIndexRow>([
      { $match: match },
      {
        $group: {
          _id: {
            brandKey: '$brandKey',
            modelKey: '$modelKey',
            storageKey: '$storageKey',
            condition: { $cond: [{ $eq: ['$condition', 'new'] }, 'new', 'used'] },
          },
          brand: { $first: '$brand' },
          model: { $first: '$model' },
          storage: { $first: '$storage' },
          avgEgp: { $avg: '$priceEgp' },
          lowEgp: { $min: '$priceEgp' },
          highEgp: { $max: '$priceEgp' },
          count: { $sum: 1 },
          lastSeenAt: { $max: '$updatedAt' },
        },
      },
      { $match: { count: { $gte: SAMPLE_THRESHOLD } } },
      { $sort: { count: -1, brand: 1, model: 1 } },
      { $limit: 300 },
    ]),
  );
}

/* ============================ قراءة الأسعار ============================ */

export async function listMarketPrices(req: Request, res: Response) {
  const condition: PriceGuideCondition = isPriceCondition(req.query.condition)
    ? (req.query.condition as PriceGuideCondition)
    : 'used';
  const grade: PriceGuideGrade = isPriceGrade(req.query.grade)
    ? (req.query.grade as PriceGuideGrade)
    : 'none';
  const brandKey = normalizeMarketKey(req.query.brand);
  const modelKey = normalizeMarketKey(req.query.model);
  const storageKey = normalizeMarketKey(req.query.storage);
  const q = regexSearch(req.query.q);

  const guideFilter: Record<string, unknown> = { isActive: true, condition, grade };
  if (brandKey) guideFilter.brandKey = brandKey;
  if (modelKey) guideFilter.modelKey = modelKey;
  if (storageKey) guideFilter.storageKey = storageKey;
  if (q) guideFilter.$or = [{ brand: q }, { model: q }];

  const [guides, market] = await Promise.all([
    PhonePriceGuideModel.find(guideFilter).sort({ brand: 1, model: 1, storage: 1 }).limit(300).lean(),
    deriveMarketIndex({ brandKey, modelKey: modelKey || undefined, q }),
  ]);

  const rows = new Map<string, {
    key: string;
    brand: string;
    model: string;
    storage: string;
    condition: PriceGuideCondition;
    grade: PriceGuideGrade;
    guide: null | {
      id: string;
      lowEgp: number;
      avgEgp: number;
      highEgp: number;
      effectiveFrom: Date | null;
      sourceNote: string;
      updatedAt: Date | null;
    };
    market: null | {
      lowEgp: number;
      avgEgp: number;
      highEgp: number;
      count: number;
      lastSeenAt: Date | null;
    };
  }>();

  for (const guide of guides) {
    const key = `${guide.brandKey}|${guide.modelKey}|${guide.storageKey}|${guide.condition}`;
    rows.set(key, {
      key,
      brand: guide.brand,
      model: guide.model,
      storage: guide.storage,
      condition: guide.condition as PriceGuideCondition,
      grade,
      guide: {
        id: String(guide._id),
        lowEgp: guide.lowEgp,
        avgEgp: guide.avgEgp,
        highEgp: guide.highEgp,
        effectiveFrom: guide.effectiveFrom ?? null,
        sourceNote: guide.sourceNote ?? '',
        updatedAt: guide.updatedAt ?? null,
      },
      market: null,
    });
  }

  for (const row of market) {
    const { brandKey: rowBrandKey, modelKey: rowModelKey, storageKey: rowStorageKey, condition: rowCondition } = row._id;
    if (condition !== rowCondition) continue;
    if (storageKey && rowStorageKey !== storageKey) continue;
    const key = `${rowBrandKey}|${rowModelKey}|${rowStorageKey}|${rowCondition}`;
    const existing = rows.get(key);
    const marketBlock = {
      lowEgp: round(row.lowEgp),
      avgEgp: round(row.avgEgp),
      highEgp: round(row.highEgp),
      count: row.count,
      lastSeenAt: row.lastSeenAt ?? null,
    };
    if (existing) {
      existing.market = marketBlock;
      existing.brand = existing.brand || row.brand;
      existing.model = existing.model || row.model;
      existing.storage = existing.storage || row.storage;
    } else {
      rows.set(key, {
        key,
        brand: row.brand,
        model: row.model,
        storage: row.storage,
        condition: rowCondition,
        grade: 'none',
        guide: null,
        market: marketBlock,
      });
    }
  }

  const items = [...rows.values()]
    .sort((a, b) => a.brand.localeCompare(b.brand, 'ar') || a.model.localeCompare(b.model, 'ar'))
    .slice(0, 150)
    .map((row) => ({
      ...row,
      spreadPct:
        row.guide && row.market && row.market.avgEgp > 0
          ? Math.round(((row.guide.avgEgp - row.market.avgEgp) / row.market.avgEgp) * 1000) / 10
          : null,
    }));

  return ok(res, {
    items,
    meta: {
      condition,
      grade,
      sampleThreshold: SAMPLE_THRESHOLD,
      guideCount: guides.length,
      marketCount: market.length,
    },
  });
}

/** تقييم سعر جهاز: دليل المنصة + المؤشر المشتق + معامل حالة المستعمل */
export async function valuatePhone(req: Request, res: Response) {
  const brand = String(req.query.brand ?? '').trim();
  const model = String(req.query.model ?? '').trim();
  if (!brand || !model) throw ApiError.badRequest('ماركة وموديل الجهاز مطلوبان للتقييم');

  const storageKey = normalizeMarketKey(req.query.storage);
  const condition: PriceGuideCondition = isPriceCondition(req.query.condition)
    ? (req.query.condition as PriceGuideCondition)
    : 'used';
  const grade: PriceGuideGrade = isPriceGrade(req.query.grade)
    ? (req.query.grade as PriceGuideGrade)
    : 'none';
  const brandKey = normalizeMarketKey(brand);
  const modelKey = normalizeMarketKey(model);

  const guideFilter: Record<string, unknown> = { isActive: true, brandKey, modelKey, condition };
  if (storageKey) guideFilter.storageKey = { $in: [storageKey, ''] };
  const guides = await PhonePriceGuideModel.find(guideFilter).lean();

  const pickGuide =
    guides.find((g) => g.storageKey === (storageKey || '') && g.grade === grade) ??
    guides.find((g) => g.storageKey === (storageKey || '') && g.grade === 'none') ??
    guides.find((g) => g.grade === grade) ??
    guides.find((g) => g.grade === 'none') ??
    guides[0] ??
    null;

  const marketRows = await deriveMarketIndex({
    brandKey,
    modelKey,
    storageKey: storageKey || undefined,
  });
  const market = marketRows.find((row) => row._id.condition === condition) ?? null;

  let guideBlock: null | {
    lowEgp: number;
    avgEgp: number;
    highEgp: number;
    grade: PriceGuideGrade;
    factor: number;
    basis: 'grade_specific' | 'base_with_grade_factor' | 'base';
    effectiveFrom: Date | null;
    sourceNote: string;
  } = null;

  if (pickGuide) {
    const gradeSpecific = pickGuide.grade === grade && grade !== 'none';
    const factor = gradeSpecific || condition === 'new' ? 1 : (MARKET_GRADE_FACTORS[grade] ?? 1);
    guideBlock = {
      lowEgp: round(pickGuide.lowEgp * factor),
      avgEgp: round(pickGuide.avgEgp * factor),
      highEgp: round(pickGuide.highEgp * factor),
      grade: pickGuide.grade as PriceGuideGrade,
      factor,
      basis: gradeSpecific ? 'grade_specific' : factor !== 1 ? 'base_with_grade_factor' : 'base',
      effectiveFrom: pickGuide.effectiveFrom ?? null,
      sourceNote: pickGuide.sourceNote ?? '',
    };
  }

  const marketBlock = market
    ? {
        lowEgp: round(market.lowEgp),
        avgEgp: round(market.avgEgp),
        highEgp: round(market.highEgp),
        count: market.count,
        lastSeenAt: market.lastSeenAt ?? null,
      }
    : null;

  if (!guideBlock && !marketBlock) {
    return ok(res, {
      available: false,
      query: { brand, model, storage: req.query.storage ? String(req.query.storage) : '', condition, grade },
      guide: null,
      market: null,
      valuation: null,
      message: 'لا توجد بيانات كافية بعد. أضف سعرًا في دليل المنصة أو انتظر تجمّع 3 إعلانات على الأقل.',
    });
  }

  const guideAvg = guideBlock?.avgEgp ?? null;
  const marketAvg = marketBlock?.avgEgp ?? null;
  const combined =
    guideAvg !== null && marketAvg !== null
      ? round(guideAvg * 0.6 + marketAvg * 0.4)
      : guideAvg ?? marketAvg ?? 0;

  const lows = [guideBlock?.lowEgp, marketBlock?.lowEgp].filter((v): v is number => typeof v === 'number');
  const highs = [guideBlock?.highEgp, marketBlock?.highEgp].filter((v): v is number => typeof v === 'number');
  const low = lows.length ? Math.min(...lows) : round(combined * 0.9);
  const high = highs.length ? Math.max(...highs) : round(combined * 1.1);
  const confidence = guideAvg !== null && marketAvg !== null ? 'high' : 'medium';

  return ok(res, {
    available: true,
    query: { brand, model, storage: req.query.storage ? String(req.query.storage) : '', condition, grade },
    guide: guideBlock,
    market: marketBlock,
    valuation: {
      lowEgp: low,
      avgEgp: combined,
      highEgp: high,
      suggestedPriceEgp: Math.round(combined / 50) * 50,
      confidence,
      basis: [
        ...(guideBlock ? ['سعر دليل المنصة'] : []),
        ...(marketBlock ? ['مؤشر إعلانات السوق'] : []),
      ],
    },
  });
}

/* ======================= إدارة دليل الأسعار (المنصة) ======================= */

function serializeGuide(guide: Record<string, unknown> & { _id: unknown }) {
  return {
    id: String(guide._id),
    brand: guide.brand,
    model: guide.model,
    storage: guide.storage ?? '',
    condition: guide.condition,
    grade: guide.grade ?? 'none',
    lowEgp: guide.lowEgp,
    avgEgp: guide.avgEgp,
    highEgp: guide.highEgp,
    sourceNote: guide.sourceNote ?? '',
    effectiveFrom: guide.effectiveFrom ?? null,
    isActive: guide.isActive ?? true,
    createdAt: guide.createdAt ?? null,
    updatedAt: guide.updatedAt ?? null,
  };
}

export async function platformListPriceGuides(req: Request, res: Response) {
  const { page, limit, skip } = parseListQuery(req.query as Record<string, unknown>, 40, 200);
  const filter: Record<string, unknown> = {};
  if (req.query.condition && isPriceCondition(req.query.condition)) filter.condition = req.query.condition;
  if (req.query.active === 'true') filter.isActive = true;
  if (req.query.active === 'false') filter.isActive = false;
  const q = regexSearch(req.query.q);
  if (q) filter.$or = [{ brand: q }, { model: q }];

  const [items, total] = await Promise.all([
    PhonePriceGuideModel.find(filter)
      .sort({ brand: 1, model: 1, storage: 1, condition: 1, grade: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    PhonePriceGuideModel.countDocuments(filter),
  ]);

  return paginated(res, items.map((item) => serializeGuide(item as never)), { page, limit, total });
}

export async function upsertPriceGuide(req: Request, res: Response) {
  const auth = getAuth(req);
  const body = req.body as z.infer<typeof priceGuideSchema>;
  const grade = body.condition === 'new' ? 'none' : body.grade;
  const keys = {
    brandKey: normalizeMarketKey(body.brand),
    modelKey: normalizeMarketKey(body.model),
    storageKey: normalizeMarketKey(body.storage),
  };

  const guide = await PhonePriceGuideModel.findOneAndUpdate(
    { ...keys, condition: body.condition, grade },
    {
      $set: {
        brand: body.brand,
        model: body.model,
        storage: body.storage,
        lowEgp: body.lowEgp,
        avgEgp: body.avgEgp,
        highEgp: body.highEgp,
        sourceNote: body.sourceNote,
        isActive: body.isActive,
        effectiveFrom: new Date(),
        updatedBy: new Types.ObjectId(auth.userId),
      },
      $setOnInsert: { createdBy: new Types.ObjectId(auth.userId) },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();

  return ok(res, serializeGuide(guide as never));
}

export async function updatePriceGuide(req: Request, res: Response) {
  const auth = getAuth(req);
  const body = req.body as z.infer<typeof updatePriceGuideSchema>;
  const rawId = req.params.id;
  const id = Array.isArray(rawId) ? String(rawId[0] ?? '') : String(rawId ?? '');
  if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest('معرّف سعر غير صحيح');

  const guide = await PhonePriceGuideModel.findById(id);
  if (!guide) throw ApiError.notFound('سعر الدليل غير موجود');

  const nextCondition = body.condition ?? (guide.condition as PriceGuideCondition);
  const nextGrade = nextCondition === 'new' ? 'none' : body.grade ?? (guide.grade as PriceGuideGrade);
  const nextBrand = body.brand ?? guide.brand;
  const nextModel = body.model ?? guide.model;
  const nextStorage = body.storage ?? guide.storage;
  const nextLow = body.lowEgp ?? guide.lowEgp;
  const nextAvg = body.avgEgp ?? guide.avgEgp;
  const nextHigh = body.highEgp ?? guide.highEgp;

  if (nextLow > nextAvg) throw ApiError.badRequest('المتوسط يجب ألا يقل عن الحد الأدنى');
  if (nextAvg > nextHigh) throw ApiError.badRequest('الحد الأعلى يجب ألا يقل عن المتوسط');

  const brandKey = normalizeMarketKey(nextBrand);
  const modelKey = normalizeMarketKey(nextModel);
  const storageKey = normalizeMarketKey(nextStorage);
  const clash = await PhonePriceGuideModel.findOne({
    _id: { $ne: guide._id },
    brandKey,
    modelKey,
    storageKey,
    condition: nextCondition,
    grade: nextGrade,
  }).select('_id').lean();
  if (clash) throw ApiError.conflict('يوجد سعر مسجّل بالفعل لنفس الماركة والموديل والسعة والحالة');

  await PhonePriceGuideModel.updateOne(
    { _id: guide._id },
    {
      $set: {
        brand: nextBrand,
        model: nextModel,
        storage: nextStorage,
        brandKey,
        modelKey,
        storageKey,
        condition: nextCondition,
        grade: nextGrade,
        lowEgp: nextLow,
        avgEgp: nextAvg,
        highEgp: nextHigh,
        ...(body.sourceNote !== undefined ? { sourceNote: body.sourceNote } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        updatedBy: new Types.ObjectId(auth.userId),
      },
    },
  );

  const updated = await PhonePriceGuideModel.findById(id).lean();
  if (!updated) throw ApiError.notFound('سعر الدليل غير موجود');
  return ok(res, serializeGuide(updated as never));
}

export async function deactivatePriceGuide(req: Request, res: Response) {
  const rawId = req.params.id;
  const id = Array.isArray(rawId) ? String(rawId[0] ?? '') : String(rawId ?? '');
  if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest('معرّف سعر غير صحيح');

  const guide = await PhonePriceGuideModel.findByIdAndUpdate(
    id,
    { $set: { isActive: false } },
    { new: true },
  ).lean();
  if (!guide) throw ApiError.notFound('سعر الدليل غير موجود');
  return ok(res, serializeGuide(guide as never));
}
