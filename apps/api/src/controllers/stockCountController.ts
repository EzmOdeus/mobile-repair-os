import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { StockCountModel } from '../models/StockCount.js';
import { InventoryItemModel } from '../models/InventoryItem.js';
import { PartModel } from '../models/Part.js';
import { BranchModel } from '../models/Branch.js';
import { ApiError } from '../utils/ApiError.js';
import { created, ok, paginated } from '../utils/asyncHandler.js';
import { parseListQuery, parseSort } from '../utils/queryHelpers.js';
import { getAuth, branchFilter, requireBranchAccess } from '../middleware/auth.js';
import { getTenantContext } from '../context/tenantContext.js';
import { recordAudit } from '../services/auditService.js';
import { money } from '../utils/money.js';
import { nextStockCountNumber } from '../services/numberingService.js';
import { applyStockMovement } from '../services/inventoryService.js';

/** جرد فعلي: يثبّت فروق الجرد كحركات تسوية، ويحفظ صورة الرصيد وقت الجرد */
export const createStockCount = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const ctx = getTenantContext();
  const body = req.body as {
    branchId?: string;
    lines: { partId: string; countedOnHand: number; note: string }[];
    notes: string;
  };

  const branchCandidate = body.branchId ?? (ctx?.branchId ? String(ctx.branchId) : null);
  if (!branchCandidate) throw ApiError.badRequest('حدد الفرع المراد جرده');
  requireBranchAccess(req, branchCandidate);
  const branch = await BranchModel.findOne({ _id: branchCandidate, isActive: true }).select('_id name').lean();
  if (!branch) throw ApiError.notFound('الفرع غير موجود أو موقوف');

  const partIds = body.lines.map((l) => new Types.ObjectId(l.partId));
  const [parts, balances] = await Promise.all([
    PartModel.find({ _id: { $in: partIds } }).select('name sku pricing.costEgp').lean(),
    InventoryItemModel.find({ branchId: branch._id, partId: { $in: partIds } })
      .select('partId quantity')
      .lean(),
  ]);
  const partMap = new Map(parts.map((p) => [String(p._id), p]));
  const balanceMap = new Map(balances.map((b) => [String(b.partId), b]));

  const missing = body.lines.filter((l) => !partMap.has(l.partId));
  if (missing.length) throw ApiError.notFound(`قطع غير موجودة: ${missing.map((m) => m.partId).join(', ')}`);

  const countNumber = await nextStockCountNumber();

  const lines = body.lines.map((input) => {
    const part = partMap.get(input.partId)!;
    const snapshot = balanceMap.get(input.partId)?.quantity?.onHand ?? 0;
    const difference = money(input.countedOnHand - snapshot);
    const unitCost = money(part.pricing?.costEgp ?? 0);
    return {
      partId: new Types.ObjectId(input.partId),
      snapshotOnHand: snapshot,
      countedOnHand: input.countedOnHand,
      difference,
      unitCostEgp: unitCost,
      differenceValueEgp: money(difference * unitCost),
      note: input.note,
      partName: part.name,
      partSku: part.sku,
    };
  });

  for (const line of lines) {
    if (!line.difference) continue;
    await applyStockMovement({
      partId: line.partId,
      type: line.difference > 0 ? 'adjustment_in' : 'adjustment_out',
      quantity: Math.abs(line.difference),
      unitCostEgp: line.unitCostEgp,
      branchId: branch._id,
      reason: `تسوية جرد ${countNumber}`,
      reference: countNumber,
      skipAvailabilityCheck: true,
      actor: { userId: auth.userId, fullName: auth.fullName },
    });
  }

  await InventoryItemModel.updateMany(
    { branchId: branch._id, partId: { $in: partIds } },
    { $set: { lastCountedAt: new Date() } },
  );

  const discrepancies = lines.filter((l) => l.difference !== 0).length;
  const netDifferenceEgp = money(lines.reduce((acc, l) => acc + l.differenceValueEgp, 0));

  const stockCount = await StockCountModel.create({
    organizationId: ctx!.organizationId,
    branchId: branch._id,
    countNumber,
    status: 'completed',
    lines: lines.map((l) => ({
      partId: l.partId,
      snapshotOnHand: l.snapshotOnHand,
      countedOnHand: l.countedOnHand,
      difference: l.difference,
      unitCostEgp: l.unitCostEgp,
      differenceValueEgp: l.differenceValueEgp,
      note: l.note,
    })),
    totals: { itemsCounted: lines.length, discrepancies, netDifferenceEgp },
    notes: body.notes,
    countedBy: new Types.ObjectId(auth.userId),
    countedAt: new Date(),
  });

  await recordAudit(
    {
      action: 'stock_count',
      resource: 'StockCount',
      resourceId: String(stockCount._id),
      summary: `جرد ${branch.name}: ${lines.length} قطعة، ${discrepancies} فرق، صافي ${netDifferenceEgp} جنيه`,
      severity: Math.abs(netDifferenceEgp) > 500 ? 'critical' : 'info',
    },
    req,
  );

  return created(res, {
    stockCount: stockCount.toObject(),
    items: lines.map((l) => ({
      partId: String(l.partId),
      partName: l.partName,
      partSku: l.partSku,
      snapshotOnHand: l.snapshotOnHand,
      countedOnHand: l.countedOnHand,
      difference: l.difference,
      differenceValueEgp: l.differenceValueEgp,
    })),
    totals: { itemsCounted: lines.length, discrepancies, netDifferenceEgp },
  });
};

export const listStockCounts = async (req: Request, res: Response) => {
  const { page, limit, skip } = parseListQuery(req.query as Record<string, unknown>, 30);
  const sort = parseSort(req.query as Record<string, unknown>, ['countedAt', 'createdAt'], { countedAt: -1 });
  const query = req.query as Record<string, unknown>;

  const filter: Record<string, unknown> = {};
  const scopedBranch = branchFilter(req);
  if (scopedBranch) filter.branchId = scopedBranch;
  if (query.from || query.to) {
    const range: Record<string, Date> = {};
    if (query.from) range.$gte = new Date(String(query.from));
    if (query.to) range.$lte = new Date(String(query.to));
    filter.countedAt = range;
  }

  const [items, total] = await Promise.all([
    StockCountModel.find(filter)
      .populate('branchId', 'name code')
      .populate('countedBy', 'fullName')
      .populate('lines.partId', 'name sku')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    StockCountModel.countDocuments(filter),
  ]);

  return paginated(res, items, { page, limit, total });
};

export const getStockCount = async (req: Request, res: Response) => {
  const count = await StockCountModel.findById(req.params.id)
    .populate('branchId', 'name code')
    .populate('countedBy', 'fullName')
    .populate('lines.partId', 'name sku category')
    .lean();
  if (!count) throw ApiError.notFound('محضر الجرد غير موجود');
  requireBranchAccess(req, count.branchId);
  return ok(res, count);
};
