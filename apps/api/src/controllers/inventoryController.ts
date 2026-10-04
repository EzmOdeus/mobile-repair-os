import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { PartModel } from '../models/Part.js';
import { SupplierModel } from '../models/Supplier.js';
import { InventoryItemModel } from '../models/InventoryItem.js';
import { StockMovementModel } from '../models/StockMovement.js';
import { StockBatchModel } from '../models/StockBatch.js';
import { StockTransferModel } from '../models/StockTransfer.js';
import { RepairPartModel } from '../models/RepairPart.js';
import { ApiError } from '../utils/ApiError.js';
import { created, ok, paginated } from '../utils/asyncHandler.js';
import { parseCsv, parseListQuery, parseSort, regexSearch } from '../utils/queryHelpers.js';
import { getAuth } from '../middleware/auth.js';
import { getTenantContext } from '../context/tenantContext.js';
import { recordAudit } from '../services/auditService.js';
import { money } from '../utils/money.js';
import { nextTransferNumber, withUniqueRetry } from '../services/numberingService.js';
import { applyStockMovement, type StockMovementType } from '../services/inventoryService.js';

/* ============================== الموردون ============================== */

export const listSuppliers = async (req: Request, res: Response) => {
  const { page, limit, skip } = parseListQuery(req.query as Record<string, unknown>, 50);
  const query = req.query as Record<string, unknown>;

  const filter: Record<string, unknown> = {};
  const search = regexSearch(query.q);
  if (search) filter.$or = [{ name: search }, { code: search }, { phone: search }, { contactPerson: search }];
  if (query.isActive !== undefined) filter.isActive = query.isActive === 'true';
  const types = parseCsv(query.type);
  if (types.length) filter.type = { $in: types };

  const [items, total] = await Promise.all([
    SupplierModel.find(filter).sort({ name: 1 }).skip(skip).limit(limit).lean(),
    SupplierModel.countDocuments(filter),
  ]);

  return paginated(res, items, { page, limit, total });
};

export const createSupplier = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const ctx = getTenantContext();
  const body = req.body as Record<string, unknown>;

  const supplier = await SupplierModel.create({
    organizationId: ctx!.organizationId,
    branchId: ctx!.branchId,
    ...body,
    createdBy: new Types.ObjectId(auth.userId),
  });

  await recordAudit({ action: 'create', resource: 'Supplier', resourceId: String(supplier._id), summary: `مورد جديد: ${supplier.name}` }, req);
  return created(res, supplier.toObject());
};

export const updateSupplier = async (req: Request, res: Response) => {
  const supplier = await SupplierModel.findById(req.params.id);
  if (!supplier) throw ApiError.notFound('المورد غير موجود');

  const body = req.body as Record<string, unknown>;
  const { performance, ...rest } = body;
  Object.assign(supplier, rest);
  if (performance) supplier.performance = { ...supplier.performance, ...(performance as object) } as typeof supplier.performance;
  await supplier.save();

  await recordAudit({ action: 'update', resource: 'Supplier', resourceId: String(supplier._id), summary: `تحديث مورد: ${supplier.name}` }, req);
  return ok(res, supplier.toObject());
};

export const deleteSupplier = async (req: Request, res: Response) => {
  const supplier = await SupplierModel.findById(req.params.id);
  if (!supplier) throw ApiError.notFound('المورد غير موجود');
  supplier.isActive = false;
  await supplier.save();
  await recordAudit({ action: 'delete', resource: 'Supplier', resourceId: String(supplier._id), summary: `تعطيل مورد: ${supplier.name}`, severity: 'warning' }, req);
  return ok(res, { message: 'تم تعطيل المورد' });
};

/** أداء الموردين: معدل العيوب وزمن التوريد (Parts Intelligence) */
export const supplierPerformance = async (_req: Request, res: Response) => {
  const suppliers = await SupplierModel.find({ isActive: true })
    .select('name type performance')
    .sort({ 'performance.defectRatePct': 1 })
    .lean();

  const batches = await StockBatchModel.aggregate<{ _id: Types.ObjectId; received: number; defective: number; used: number }>([
    {
      $group: {
        _id: '$supplierId',
        received: { $sum: '$quantityReceived' },
        defective: { $sum: '$quantityDefective' },
        used: { $sum: '$quantityUsed' },
      },
    },
  ]);
  const bySupplier = new Map(batches.map((b) => [String(b._id), b]));

  return ok(
    res,
    suppliers.map((s) => {
      const stats = bySupplier.get(String(s._id));
      const computedDefect = stats && stats.received > 0 ? money((stats.defective / stats.received) * 100) : 0;
      return {
        id: String(s._id),
        name: s.name,
        type: s.type,
        rating: s.performance?.rating ?? 0,
        avgLeadTimeDays: s.performance?.avgLeadTimeDays ?? 0,
        storedDefectRatePct: s.performance?.defectRatePct ?? 0,
        computedDefectRatePct: computedDefect,
        unitsReceived: stats?.received ?? 0,
        unitsDefective: stats?.defective ?? 0,
        unitsUsed: stats?.used ?? 0,
        totalPurchasedEgp: s.performance?.totalPurchasedEgp ?? 0,
      };
    }),
  );
};

/* ============================== القطع ============================== */

function buildPartFilter(req: Request): Record<string, unknown> {
  const query = req.query as Record<string, unknown>;
  const filter: Record<string, unknown> = {};
  const search = regexSearch(query.q);
  if (search) filter.$or = [{ name: search }, { nameEn: search }, { sku: search }, { barcode: search }, { brand: search }];
  const categories = parseCsv(query.category);
  if (categories.length) filter.category = { $in: categories };
  const grades = parseCsv(query.grade);
  if (grades.length) filter.grade = { $in: grades };
  if (query.supplierId) filter.defaultSupplierId = query.supplierId;
  if (query.deviceModel) filter['compatibility.deviceModels'] = new RegExp(String(query.deviceModel), 'i');
  if (query.deviceBrand) filter['compatibility.deviceBrands'] = String(query.deviceBrand);
  if (query.isActive !== undefined) filter.isActive = query.isActive === 'true';
  if (query.lowStock === 'true') filter.$expr = { $lte: [{ $subtract: ['$stock.onHand', '$stock.reserved'] }, '$stock.reorderLevel'] };
  return filter;
}

export const listParts = async (req: Request, res: Response) => {
  const { page, limit, skip } = parseListQuery(req.query as Record<string, unknown>, 40);
  const sort = parseSort(req.query as Record<string, unknown>, ['createdAt', 'name', 'pricing.sellingPriceEgp', 'stock.onHand'], { name: 1 });
  const filter = buildPartFilter(req);

  const [items, total] = await Promise.all([
    PartModel.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    PartModel.countDocuments(filter),
  ]);

  return paginated(
    res,
    items.map((p) => ({
      ...p,
      availableQty: Math.max(0, (p.stock?.onHand ?? 0) - (p.stock?.reserved ?? 0)),
      isLowStock: Math.max(0, (p.stock?.onHand ?? 0) - (p.stock?.reserved ?? 0)) <= (p.stock?.reorderLevel ?? 0),
    })),
    { page, limit, total },
  );
};

export const getPart = async (req: Request, res: Response) => {
  const part = await PartModel.findById(req.params.id).populate('defaultSupplierId', 'name phone').lean();
  if (!part) throw ApiError.notFound('القطعة غير موجودة');

  const [batches, movements, usedInRepairs, stockByBranch] = await Promise.all([
    StockBatchModel.find({ partId: part._id }).sort({ receivedAt: -1 }).limit(50).lean(),
    StockMovementModel.find({ partId: part._id }).sort({ occurredAt: -1 }).limit(80).lean(),
    RepairPartModel.find({ partId: part._id, status: { $in: ['installed', 'defective'] } })
      .populate('ticketId', 'ticketNumber')
      .sort({ installedAt: -1 })
      .limit(50)
      .lean(),
    InventoryItemModel.find({ partId: part._id }).populate('branchId', 'name code').lean(),
  ]);

  const totalUsed = await RepairPartModel.countDocuments({ partId: part._id, status: { $in: ['installed', 'defective'] } });
  const totalFailed = await RepairPartModel.countDocuments({ partId: part._id, status: 'defective' });

  return ok(res, {
    part: {
      ...part,
      availableQty: Math.max(0, (part.stock?.onHand ?? 0) - (part.stock?.reserved ?? 0)),
    },
    stockByBranch,
    batches,
    recentMovements: movements,
    usedInRepairs,
    quality: {
      totalUsed,
      totalFailed,
      failureRatePct: totalUsed ? money((totalFailed / totalUsed) * 100) : 0,
    },
  });
};

export const createPart = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const ctx = getTenantContext();
  const body = req.body as Record<string, unknown> & { openingStock?: number; sku: string };

  const exists = await PartModel.findOne({ sku: body.sku }).select('_id name').lean();
  if (exists) throw ApiError.conflict('كود القطعة (SKU) مستخدم بالفعل', { partId: String(exists._id), name: exists.name });

  const openingStock = Number(body.openingStock ?? 0);
  delete body.openingStock;

  const part = await PartModel.create({
    organizationId: ctx!.organizationId,
    branchId: ctx!.branchId,
    ...body,
    stock: { ...(body.stock as object), onHand: openingStock },
    createdBy: new Types.ObjectId(auth.userId),
  });

  if (openingStock > 0) {
    await InventoryItemModel.findOneAndUpdate(
      { partId: part._id, branchId: ctx!.branchId },
      {
        $set: { 'quantity.onHand': openingStock, lastMovementAt: new Date() },
        $setOnInsert: { organizationId: ctx!.organizationId, branchId: ctx!.branchId, partId: part._id },
      },
      { upsert: true, new: true },
    );

    await StockMovementModel.create({
      organizationId: ctx!.organizationId,
      branchId: ctx!.branchId,
      partId: part._id,
      type: 'initial',
      quantity: openingStock,
      effect: { onHand: openingStock },
      balanceAfter: { onHand: openingStock },
      unitCostEgp: (body.pricing as { costEgp?: number } | undefined)?.costEgp ?? 0,
      totalCostEgp: money(openingStock * ((body.pricing as { costEgp?: number } | undefined)?.costEgp ?? 0)),
      reason: 'رصيد افتتاحي عند إنشاء القطعة',
      actorId: new Types.ObjectId(auth.userId),
      actorName: auth.fullName,
    });
  }

  await recordAudit({ action: 'create', resource: 'Part', resourceId: String(part._id), summary: `قطعة جديدة: ${part.name}` }, req);
  return created(res, part.toObject());
};

export const updatePart = async (req: Request, res: Response) => {
  const part = await PartModel.findById(req.params.id);
  if (!part) throw ApiError.notFound('القطعة غير موجودة');

  const body = req.body as Record<string, unknown>;
  if (body.sku && body.sku !== part.sku) {
    const dup = await PartModel.findOne({ sku: body.sku, _id: { $ne: part._id } }).lean();
    if (dup) throw ApiError.conflict('كود القطعة مستخدم بالفعل');
  }

  const nested = ['pricing', 'compatibility', 'warranty', 'stock'];
  for (const [key, value] of Object.entries(body)) {
    if (nested.includes(key) && value && typeof value === 'object') {
      (part as unknown as Record<string, unknown>)[key] = {
        ...((part as unknown as Record<string, Record<string, unknown>>)[key] ?? {}),
        ...(value as Record<string, unknown>),
      };
    } else {
      (part as unknown as Record<string, unknown>)[key] = value;
    }
  }

  await part.save();
  await recordAudit({ action: 'update', resource: 'Part', resourceId: String(part._id), summary: `تحديث قطعة: ${part.name}` }, req);
  return ok(res, part.toObject());
};

export const deletePart = async (req: Request, res: Response) => {
  const part = await PartModel.findById(req.params.id);
  if (!part) throw ApiError.notFound('القطعة غير موجودة');

  const inUse = await RepairPartModel.countDocuments({ partId: part._id, status: { $in: ['reserved', 'installed'] } });
  if (inUse) throw ApiError.businessRule('لا يمكن تعطيل قطعة مرتبطة بإصلاحات جارية', { openUsages: inUse });

  part.isActive = false;
  await part.save();
  await recordAudit({ action: 'delete', resource: 'Part', resourceId: String(part._id), summary: `تعطيل قطعة: ${part.name}`, severity: 'warning' }, req);
  return ok(res, { message: 'تم تعطيل القطعة' });
};

/** قطع منخفضة عن حد إعادة الطلب */
export const lowStockParts = async (_req: Request, res: Response) => {
  const parts = await PartModel.find({
    isActive: true,
    $expr: { $lte: [{ $subtract: ['$stock.onHand', '$stock.reserved'] }, '$stock.reorderLevel'] },
  })
    .select('name sku category stock pricing.costEgp defaultSupplierId')
    .populate('defaultSupplierId', 'name phone')
    .sort({ 'stock.onHand': 1 })
    .limit(200)
    .lean();

  return ok(res, {
    count: parts.length,
    parts: parts.map((p) => ({
      ...p,
      availableQty: Math.max(0, (p.stock?.onHand ?? 0) - (p.stock?.reserved ?? 0)),
      suggestedOrderQty: p.stock?.reorderQty ?? 5,
      estimatedCostEgp: money((p.stock?.reorderQty ?? 5) * (p.pricing?.costEgp ?? 0)),
    })),
  });
};

/* ============================ المخزون ============================ */

/** رصيد المخزون حسب الفرع */
export const inventoryStock = async (req: Request, res: Response) => {
  const query = req.query as Record<string, unknown>;
  const filter: Record<string, unknown> = {};
  if (query.branchId) filter.branchId = query.branchId;

  const items = await InventoryItemModel.find(filter)
    .populate('partId', 'name sku category grade pricing cost')
    .populate('branchId', 'name code')
    .sort({ lastMovementAt: -1 })
    .limit(500)
    .lean();

  // الرصيد الإجمالي للقطع
  const totals = await InventoryItemModel.aggregate<{
    _id: null;
    onHand: number;
    reserved: number;
    defective: number;
    incoming: number;
  }>([
    { $match: { ...(query.branchId ? { branchId: new Types.ObjectId(String(query.branchId)) } : {}) } },
    {
      $group: {
        _id: null,
        onHand: { $sum: '$quantity.onHand' },
        reserved: { $sum: '$quantity.reserved' },
        defective: { $sum: '$quantity.defective' },
        incoming: { $sum: '$quantity.incoming' },
      },
    },
  ]);

  return ok(res, {
    items: items.map((i) => ({
      ...i,
      available: Math.max(0, (i.quantity?.onHand ?? 0) - (i.quantity?.reserved ?? 0)),
    })),
    totals: totals[0] ?? { onHand: 0, reserved: 0, defective: 0, incoming: 0 },
  });
};

/**
 * تسجيل حركة مخزون ذرّية.
 * الأرصدة تُحدَّث بمرجع ذرّي مع منع الرصيد السالب، وتُسجَّل حركة تفصيلية للتدقيق.
 */
export const recordStockMovement = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const body = req.body as {
    partId: string;
    type: StockMovementType;
    quantity: number;
    unitCostEgp?: number;
    supplierId?: string | null;
    batchId?: string | null;
    batchCode?: string;
    ticketId?: string | null;
    reason?: string;
    reference?: string;
  };

  const result = await applyStockMovement({
    partId: body.partId,
    type: body.type,
    quantity: body.quantity,
    unitCostEgp: body.unitCostEgp,
    supplierId: body.supplierId ?? null,
    batchId: body.batchId ?? null,
    batchCode: body.batchCode,
    ticketId: body.ticketId ?? null,
    reason: body.reason,
    reference: body.reference,
    actor: { userId: auth.userId, fullName: auth.fullName },
  });

  const movementId = String((result.movement as { _id?: unknown })._id ?? '');
  const summary = `حركة مخزون ${body.type} بكمية ${body.quantity}`;

  await recordAudit(
    { action: 'stock_adjust', resource: 'StockMovement', resourceId: movementId, summary },
    req,
  );

  return created(res, result);
};

/** جرد فعلي: يضبط الرصيد على العدد المحسوب ويسجل الفرق */
export const adjustStock = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const ctx = getTenantContext();
  const { partId, countedOnHand, reason } = req.body as { partId: string; countedOnHand: number; reason: string };

  const partExists = await PartModel.exists({ _id: partId });
  if (!partExists) throw ApiError.notFound('القطعة غير موجودة');

  let previous = 0;
  let diff = 0;
  let item = null;

  // إعادة محاولة محدودة: شرط التفاؤل يضمن أن الفرق المحسوب طُبّق فعلًا
  for (let attempt = 0; attempt < 5 && !item; attempt += 1) {
    const current = await InventoryItemModel.findOne({ partId, branchId: ctx!.branchId }).lean();
    previous = current?.quantity?.onHand ?? 0;
    diff = money(countedOnHand - previous);

    if (diff === 0) return ok(res, { message: 'الرصيد مطابق، لا يوجد فرق', onHand: previous });

    const reserved = current?.quantity?.reserved ?? 0;
    if (countedOnHand < reserved) {
      throw ApiError.businessRule(`لا يمكن ضبط الجرد على ${countedOnHand} وهو أقل من الكمية المحجوزة (${reserved})`, {
        partId: String(partId),
        reserved,
        countedOnHand,
      });
    }

    if (current) {
      item = await InventoryItemModel.findOneAndUpdate(
        {
          _id: current._id,
          'quantity.onHand': previous,
          // الجرد لا يجوز أن يترك الموجود أقل من المحجوز (يُفحص ذرّيًا أيضًا)
          $expr: { $gte: [countedOnHand, { $ifNull: ['$quantity.reserved', 0] }] },
        },
        { $set: { 'quantity.onHand': countedOnHand, lastCountedAt: new Date(), lastMovementAt: new Date() } },
        { new: true },
      );
      // عدم التطابق ⇒ رصيد تغيّر أثناء الجرد: نقرأ ونعيد الحساب في الدورة التالية
    } else {
      try {
        item = await InventoryItemModel.create({
          organizationId: ctx!.organizationId,
          branchId: ctx!.branchId,
          partId,
          quantity: { onHand: countedOnHand },
          lastCountedAt: new Date(),
          lastMovementAt: new Date(),
        });
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
        // سجل أُنشئ تزامنيًا — نعيد الدورة بقراءة جديدة
      }
    }
  }

  if (!item) throw ApiError.conflict('تعذّر تثبيت الجرد بسبب تزاحم في العمليات، أعد المحاولة');

  await PartModel.updateOne({ _id: partId }, { $inc: { 'stock.onHand': diff } });

  const movement = await StockMovementModel.create({
    organizationId: ctx!.organizationId,
    branchId: ctx!.branchId,
    partId,
    type: diff > 0 ? 'adjustment_in' : 'adjustment_out',
    quantity: diff,
    effect: { onHand: diff },
    reason: reason ?? 'جرد فعلي',
    actorId: new Types.ObjectId(auth.userId),
    actorName: auth.fullName,
  });

  await recordAudit(
    {
      action: 'stock_adjust',
      resource: 'InventoryItem',
      resourceId: String(partId),
      summary: `تسوية مخزون: ${previous} → ${countedOnHand} (فرق ${diff})`,
      severity: 'warning',
    },
    req,
  );

  return ok(res, { previous, counted: countedOnHand, difference: diff, movementId: String(movement._id) });
};

/** حركات المخزون */
export const listStockMovements = async (req: Request, res: Response) => {
  const { page, limit, skip } = parseListQuery(req.query as Record<string, unknown>, 50);
  const query = req.query as Record<string, unknown>;

  const filter: Record<string, unknown> = {};
  if (query.partId) filter.partId = query.partId;
  const types = parseCsv(query.type);
  if (types.length) filter.type = { $in: types };
  if (query.ticketId) filter.ticketId = query.ticketId;
  if (query.from || query.to) {
    const range: Record<string, Date> = {};
    if (query.from) range.$gte = new Date(String(query.from));
    if (query.to) range.$lte = new Date(String(query.to));
    filter.occurredAt = range;
  }

  const [items, total] = await Promise.all([
    StockMovementModel.find(filter)
      .populate('partId', 'name sku category')
      .populate('actorId', 'fullName')
      .sort({ occurredAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    StockMovementModel.countDocuments(filter),
  ]);

  return paginated(res, items, { page, limit, total });
};

/** تقييم استهلاك القطع (أعلى القطع استخدامًا وقيمتها) */
export const partsConsumptionReport = async (req: Request, res: Response) => {
  const query = req.query as Record<string, unknown>;
  const range: Record<string, Date> = {};
  if (query.from) range.$gte = new Date(String(query.from));
  if (query.to) range.$lte = new Date(String(query.to));

  const match: Record<string, unknown> = { status: { $in: ['installed', 'defective'] } };
  if (Object.keys(range).length) match.installedAt = range;

  const usage = await RepairPartModel.aggregate<{
    _id: Types.ObjectId;
    units: number;
    revenue: number;
    cost: number;
    failures: number;
  }>([
    { $match: match },
    {
      $group: {
        _id: '$partId',
        units: { $sum: '$quantity' },
        revenue: { $sum: '$totalPriceEgp' },
        cost: { $sum: '$totalCostEgp' },
        failures: { $sum: { $cond: [{ $eq: ['$status', 'defective'] }, 1, 0] } },
      },
    },
    { $sort: { units: -1 } },
    { $limit: 100 },
  ]);

  const partIds = usage.map((u) => u._id);
  const parts = await PartModel.find({ _id: { $in: partIds } }).select('name sku category grade').lean();
  const partMap = new Map(parts.map((p) => [String(p._id), p]));

  return ok(
    res,
    usage.map((u) => ({
      partId: String(u._id),
      name: partMap.get(String(u._id))?.name ?? '—',
      sku: partMap.get(String(u._id))?.sku ?? '',
      category: partMap.get(String(u._id))?.category ?? '',
      grade: partMap.get(String(u._id))?.grade ?? '',
      unitsUsed: u.units,
      revenueEgp: money(u.revenue),
      costEgp: money(u.cost),
      marginEgp: money(u.revenue - u.cost),
      failures: u.failures,
      failureRatePct: u.units ? money((u.failures / u.units) * 100) : 0,
    })),
  );
};

/* ========================= تحويل بين الفروع ========================= */

export const createStockTransfer = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const ctx = getTenantContext();
  const { fromBranchId, toBranchId, lines, reason } = req.body as {
    fromBranchId: string;
    toBranchId: string;
    lines: { partId: string; quantity: number }[];
    reason: string;
  };

  if (fromBranchId === toBranchId) throw ApiError.badRequest('لا يمكن التحويل لنفس الفرع');

  const transfer = await withUniqueRetry(nextTransferNumber, (transferNumber) =>
    StockTransferModel.create({
      organizationId: ctx!.organizationId,
      branchId: ctx!.branchId,
      transferNumber,
      fromBranchId: new Types.ObjectId(fromBranchId),
      toBranchId: new Types.ObjectId(toBranchId),
      status: 'requested',
      lines: lines.map((l) => ({
        partId: new Types.ObjectId(l.partId),
        quantityRequested: l.quantity,
      })),
      reason: reason ?? '',
      requestedBy: new Types.ObjectId(auth.userId),
    }),
  );

  await recordAudit(
    { action: 'create', resource: 'StockTransfer', resourceId: String(transfer._id), summary: `طلب تحويل مخزون ${transfer.transferNumber}` },
    req,
  );

  return created(res, transfer.toObject());
};

export const listStockTransfers = async (req: Request, res: Response) => {
  const { page, limit, skip } = parseListQuery(req.query as Record<string, unknown>, 30);
  const query = req.query as Record<string, unknown>;
  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;
  if (query.branchId) filter.$or = [{ fromBranchId: query.branchId }, { toBranchId: query.branchId }];

  const [items, total] = await Promise.all([
    StockTransferModel.find(filter)
      .populate('fromBranchId', 'name code')
      .populate('toBranchId', 'name code')
      .populate('lines.partId', 'name sku')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    StockTransferModel.countDocuments(filter),
  ]);

  return paginated(res, items, { page, limit, total });
};

/** إرسال تحويل: يخصم من الفرع المصدر */
export const sendStockTransfer = async (req: Request, res: Response) => {
  const auth = getAuth(req);

  const transfer = await StockTransferModel.findById(req.params.id);
  if (!transfer) throw ApiError.notFound('التحويل غير موجود');
  if (transfer.status !== 'requested' && transfer.status !== 'approved') {
    throw ApiError.businessRule('لا يمكن إرسال تحويل في حالته الحالية');
  }

  for (const line of transfer.lines) {
    if (line.quantitySent > 0) continue;

    // خصم ذرّي من الفرع المصدر: يرفض الرصيد السالب ويسجّل الحركة
    const result = await applyStockMovement({
      partId: line.partId,
      type: 'transfer_out',
      quantity: -line.quantityRequested,
      branchId: transfer.fromBranchId,
      transferId: transfer._id,
      fromBranchId: transfer.fromBranchId,
      toBranchId: transfer.toBranchId,
      reason: `تحويل ${transfer.transferNumber} إلى فرع آخر`,
      actor: { userId: auth.userId, fullName: auth.fullName },
    });

    line.quantitySent = line.quantityRequested;
    line.unitCostEgp = result.unitCostEgp;
  }

  transfer.status = 'in_transit';
  transfer.shippedBy = new Types.ObjectId(auth.userId);
  transfer.shippedAt = new Date();
  await transfer.save();

  await recordAudit(
    { action: 'stock_adjust', resource: 'StockTransfer', resourceId: String(transfer._id), summary: `إرسال تحويل ${transfer.transferNumber}` },
    req,
  );

  return ok(res, transfer.toObject());
};

/** استلام تحويل: يضيف للفرع المستلم */
export const receiveStockTransfer = async (req: Request, res: Response) => {
  const auth = getAuth(req);

  const transfer = await StockTransferModel.findById(req.params.id);
  if (!transfer) throw ApiError.notFound('التحويل غير موجود');
  if (transfer.status !== 'in_transit') throw ApiError.businessRule('لا يمكن الاستلام قبل الإرسال');

  for (const line of transfer.lines) {
    if (line.quantitySent <= 0) continue;
    // تُتخطى البنود المستلمة فعلًا (استكمال استلام جزئي بعد فشل سابق)
    if (line.quantityReceived > 0) continue;

    await applyStockMovement({
      partId: line.partId,
      type: 'transfer_in',
      quantity: line.quantitySent,
      unitCostEgp: line.unitCostEgp,
      branchId: transfer.toBranchId,
      transferId: transfer._id,
      fromBranchId: transfer.fromBranchId,
      toBranchId: transfer.toBranchId,
      reason: `استلام تحويل ${transfer.transferNumber}`,
      actor: { userId: auth.userId, fullName: auth.fullName },
    });

    line.quantityReceived = line.quantitySent;
  }

  transfer.status = 'received';
  transfer.receivedBy = new Types.ObjectId(auth.userId);
  transfer.receivedAt = new Date();
  await transfer.save();

  await recordAudit(
    { action: 'stock_adjust', resource: 'StockTransfer', resourceId: String(transfer._id), summary: `استلام تحويل ${transfer.transferNumber}` },
    req,
  );

  return ok(res, transfer.toObject());
};
