import { Types } from 'mongoose';
import { PartModel } from '../models/Part.js';
import { InventoryItemModel } from '../models/InventoryItem.js';
import { StockMovementModel } from '../models/StockMovement.js';
import type { StockMovementType } from '../models/StockMovement.js';
import { StockBatchModel } from '../models/StockBatch.js';
import { RepairPartModel } from '../models/RepairPart.js';
import { ApiError } from '../utils/ApiError.js';
import { getTenantContext } from '../context/tenantContext.js';
import { money } from '../utils/money.js';

export interface StockEffect {
  onHand?: number;
  reserved?: number;
  defective?: number;
  incoming?: number;
}

/** خريطة تأثير كل نوع حركة على الأرصدة */
export function effectForMovementType(type: StockMovementType, quantity: number): StockEffect {
  const q = Math.abs(quantity);
  const sign = quantity < 0 ? -1 : 1;
  switch (type) {
    case 'purchase_in':
    case 'initial':
    case 'adjustment_in':
    case 'transfer_in':
    case 'repair_return':
      return { onHand: q * sign };
    case 'purchase_order':
      return { incoming: q };
    case 'purchase_cancel':
      return { incoming: -q };
    case 'sale_out':
    case 'adjustment_out':
    case 'transfer_out':
      return { onHand: -q };
    case 'defective_in':
      return { defective: q };
    case 'defective_out':
      return { defective: -q };
    case 'reserve':
      return { reserved: q };
    case 'release':
      return { reserved: -q };
    case 'repair_consume':
      // إتمام الاستهلاك: تخرج من الموجود ومن المحجوز
      return { onHand: -q, reserved: -q };
    default:
      throw ApiError.badRequest(`نوع الحركة غير مدعوم: ${type as string}`);
  }
}

export interface ApplyStockInput {
  partId: string | Types.ObjectId;
  type: StockMovementType;
  quantity: number;
  unitCostEgp?: number;
  /** تعديل متزامن على كمية «الوارد المتوقع» مع نفس الحركة (استلام أمر شراء) */
  incomingDelta?: number;
  supplierId?: string | Types.ObjectId | null;
  batchId?: string | Types.ObjectId | null;
  batchCode?: string;
  ticketId?: string | Types.ObjectId | null;
  repairPartId?: string | Types.ObjectId | null;
  invoiceId?: string | Types.ObjectId | null;
  transferId?: string | Types.ObjectId | null;
  fromBranchId?: string | Types.ObjectId | null;
  toBranchId?: string | Types.ObjectId | null;
  reason?: string;
  reference?: string;
  /** الفرع المستهدف (افتراضيًا الفرع الحالي) */
  branchId?: string | Types.ObjectId | null;
  actor: { userId: string | Types.ObjectId; fullName: string };
  /** تخطي فحص الكفاية (للجرد والتسويات الإدارية) */
  skipAvailabilityCheck?: boolean;
}

/**
 * تطبيق حركة مخزون ذرّية.
 *
 * الضمانات:
 * 1) لا رصيد سالب: الشرط يُفرض في استعلام التحديث مع $inc.
 * 2) الرصيد الإجمالي على القطعة يُحدَّث بنفس الفرق.
 * 3) تُسجَّل حركة تفصيلية مع الأرصدة بعدها للتدقيق.
 */
export async function applyStockMovement(input: ApplyStockInput) {
  const ctx = getTenantContext();
  if (!ctx) throw ApiError.forbidden('لا يمكن تعديل المخزون بدون سياق مؤسسة');

  const branchId = input.branchId ?? ctx.branchId;
  const effect = {
    ...effectForMovementType(input.type, input.quantity),
    ...(input.incomingDelta !== undefined ? { incoming: input.incomingDelta } : {}),
  };

  const part = await PartModel.findById(input.partId).select('name sku stock pricing warranty').lean();
  if (!part) throw ApiError.notFound('القطعة غير موجودة');

  const partObjectId = new Types.ObjectId(String(input.partId));

  const dOnHand = effect.onHand ?? 0;
  const dReserved = effect.reserved ?? 0;
  const dDefective = effect.defective ?? 0;
  const dIncoming = effect.incoming ?? 0;

  const balanceUpdate = {
    $inc: {
      'quantity.onHand': dOnHand,
      'quantity.reserved': dReserved,
      'quantity.defective': dDefective,
      'quantity.incoming': effect.incoming ?? 0,
    },
    $set: { lastMovementAt: new Date() },
    $setOnInsert: { organizationId: ctx.organizationId, branchId, partId: partObjectId },
  };

  /**
   * شروط الكفاية تُفرض داخل استعلام التحديث نفسه ($expr) بدل قراءة سابقة،
   * حتى لا تمرّ عمليتان متزامنتان بمجموع يتجاوز الرصيد (TOCTOU).
   */
  const guards: Record<string, unknown>[] = [];
  if (!input.skipAvailabilityCheck) {
    if (dOnHand < 0) {
      guards.push({ $expr: { $gte: [{ $add: [{ $ifNull: ['$quantity.onHand', 0] }, dOnHand] }, 0] } });
    }
    if (dReserved < 0) {
      guards.push({ $expr: { $gte: [{ $add: [{ $ifNull: ['$quantity.reserved', 0] }, dReserved] }, 0] } });
    }
    if (dDefective < 0) {
      guards.push({ $expr: { $gte: [{ $add: [{ $ifNull: ['$quantity.defective', 0] }, dDefective] }, 0] } });
    }
    if (dIncoming < 0) {
      guards.push({ $expr: { $gte: [{ $add: [{ $ifNull: ['$quantity.incoming', 0] }, dIncoming] }, 0] } });
    }
    // لا يجوز أن يتجاوز المحجوز الموجود بعد العملية
    if (dOnHand < 0 || dReserved > 0) {
      guards.push({
        $expr: {
          $gte: [
            { $add: [{ $ifNull: ['$quantity.onHand', 0] }, dOnHand] },
            { $add: [{ $ifNull: ['$quantity.reserved', 0] }, dReserved] },
          ],
        },
      });
    }
  }

  /** يحدد سبب فشل شرط الكفاية (أو null إذا كانت القيم تغيّرت فقط) */
  const availabilityError = (onHand: number, reserved: number, defective: number, incoming = 0): ApiError | null => {
    const nextOnHand = onHand + dOnHand;
    const nextReserved = reserved + dReserved;

    if (dOnHand < 0 && nextOnHand < 0) {
      return ApiError.businessRule(`رصيد القطعة «${part.name}» غير كافٍ في هذا الفرع (الموجود: ${onHand})`, {
        partId: String(partObjectId),
        onHand,
        requested: Math.abs(dOnHand),
      });
    }
    if (dReserved < 0 && nextReserved < 0) {
      return ApiError.businessRule(`الكمية المحجوزة من «${part.name}» غير كافية (المحجوز: ${reserved})`, {
        partId: String(partObjectId),
        reserved,
        requested: Math.abs(dReserved),
      });
    }
    if (dDefective < 0 && defective + dDefective < 0) {
      return ApiError.businessRule(`الكمية التالفة من «${part.name}» غير كافية (التالف: ${defective})`, {
        partId: String(partObjectId),
        defective,
        requested: Math.abs(dDefective),
      });
    }
    if (dIncoming < 0 && incoming + dIncoming < 0) {
      return ApiError.businessRule(`الكمية الواردة المتوقعة من «${part.name}» غير كافية (المتوقع: ${incoming})`, {
        partId: String(partObjectId),
        incoming,
        requested: Math.abs(dIncoming),
      });
    }
    if (nextOnHand < nextReserved) {
      if (dReserved > 0) {
        return ApiError.businessRule(
          `رصيد القطعة «${part.name}» غير كافٍ لحجز ${nextReserved} (الموجود بعد العملية: ${nextOnHand})`,
          { partId: String(partObjectId), onHand, reserved },
        );
      }
      return ApiError.businessRule('الخصم سيؤدي إلى تعارض بين المحجوز والموجود', { onHand, reserved });
    }
    return null;
  };

  // 2) تحديث رصيد الفرع ذرّيًا (بإعادة محاولة عند تزامن الإنشاء)
  let item = null;
  for (let attempt = 0; attempt < 5 && !item; attempt += 1) {
    if (guards.length === 0) {
      item = await InventoryItemModel.findOneAndUpdate({ partId: partObjectId, branchId }, balanceUpdate, {
        upsert: true,
        new: true,
      });
      break;
    }

    item = await InventoryItemModel.findOneAndUpdate(
      { partId: partObjectId, branchId, $and: guards },
      balanceUpdate,
      { new: true },
    );
    if (item) break;

    const current = await InventoryItemModel.findOne({ partId: partObjectId, branchId }).select('quantity').lean();
    if (current) {
      const error = availabilityError(
        current.quantity?.onHand ?? 0,
        current.quantity?.reserved ?? 0,
        current.quantity?.defective ?? 0,
        current.quantity?.incoming ?? 0,
      );
      if (error) throw error;
      continue; // القيم تغيّرت بين التحديث والقراءة — دورة جديدة
    }

    // لا يوجد سجل بعد: نتحقق من الصفر ثم ننشئه
    const freshError = availabilityError(0, 0, 0, 0);
    if (freshError) throw freshError;
    try {
      item = await InventoryItemModel.findOneAndUpdate({ partId: partObjectId, branchId }, balanceUpdate, {
        upsert: true,
        new: true,
      });
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      // سجل أُنشئ في نفس اللحظة — نعيد الدورة بفحص الكفاية
    }
  }

  if (!item) {
    throw ApiError.conflict('تعذّر تحديث رصيد المخزون بسبب تزاحم في العمليات، أعد المحاولة');
  }

  // 3) تحديث الرصيد الإجمالي على القطعة
  const updatedPart = await PartModel.findByIdAndUpdate(
    partObjectId,
    {
      $inc: {
        'stock.onHand': effect.onHand ?? 0,
        'stock.reserved': effect.reserved ?? 0,
        'stock.defective': effect.defective ?? 0,
        'stock.incoming': effect.incoming ?? 0,
      },
    },
    { new: true },
  )
    .select('stock pricing')
    .lean();

  const unitCost = input.unitCostEgp ?? part.pricing?.costEgp ?? 0;

  // 4) الدفعة عند التوريد
  let batchId = input.batchId ? new Types.ObjectId(String(input.batchId)) : null;
  if (input.type === 'purchase_in' && input.batchCode) {
    const batch = await StockBatchModel.create({
      organizationId: ctx.organizationId,
      branchId,
      partId: partObjectId,
      supplierId: input.supplierId ?? null,
      batchCode: input.batchCode,
      unitCostEgp: unitCost,
      quantityReceived: Math.abs(input.quantity),
      quantityAvailable: Math.abs(input.quantity),
      warrantyDays: part.warranty?.supplierDays ?? 0,
      grade: 'unknown',
      receivedBy: new Types.ObjectId(String(input.actor.userId)),
    });
    batchId = batch._id as Types.ObjectId;
  }

  // 5) تحديث عدّادات الدفعة عند الاستهلاك
  if (batchId && (input.type === 'repair_consume' || input.type === 'defective_in')) {
    const inc: Record<string, number> = {};
    if (input.type === 'repair_consume') {
      inc.quantityUsed = Math.abs(input.quantity);
      inc.quantityAvailable = -Math.abs(input.quantity);
    }
    if (input.type === 'defective_in') {
      inc.quantityDefective = Math.abs(input.quantity);
      inc['failureStats.unitsFailed'] = 1;
      inc.quantityUsed = 1;
    }
    await StockBatchModel.updateOne({ _id: batchId }, { $inc: inc });
  }

  // 6) تسجيل الحركة
  const movement = await StockMovementModel.create({
    organizationId: ctx.organizationId,
    branchId,
    partId: partObjectId,
    type: input.type,
    quantity: input.quantity,
    effect,
    balanceAfter: {
      onHand: item.quantity?.onHand ?? 0,
      reserved: item.quantity?.reserved ?? 0,
      defective: item.quantity?.defective ?? 0,
      incoming: item.quantity?.incoming ?? 0,
    },
    unitCostEgp: unitCost,
    totalCostEgp: money(Math.abs(input.quantity) * unitCost),
    batchId,
    supplierId: input.supplierId ?? null,
    ticketId: input.ticketId ?? null,
    repairPartId: input.repairPartId ?? null,
    invoiceId: input.invoiceId ?? null,
    transferId: input.transferId ?? null,
    fromBranchId: input.fromBranchId ?? null,
    toBranchId: input.toBranchId ?? null,
    reason: input.reason ?? '',
    reference: input.reference ?? '',
    actorId: new Types.ObjectId(String(input.actor.userId)),
    actorName: input.actor.fullName,
    occurredAt: new Date(),
  });

  return {
    movement: movement.toObject(),
    branchBalance: item.quantity,
    partBalance: updatedPart?.stock,
    unitCostEgp: unitCost,
  };
}

/**
 * تحديث مؤشرات جودة القطعة بعد إصلاح أو عودة ضمان (Parts Quality Intelligence).
 */
export async function refreshPartQualityStats(partId: string | Types.ObjectId): Promise<void> {
  const id = new Types.ObjectId(String(partId));

  const [used, failed] = await Promise.all([
    RepairPartModel.countDocuments({ partId: id, status: { $in: ['installed', 'defective', 'removed'] } }),
    RepairPartModel.countDocuments({ partId: id, status: 'defective' }),
  ]);

  await PartModel.updateOne(
    { _id: id },
    {
      $set: {
        'quality.unitsSold': used,
        'quality.unitsFailed': failed,
        'quality.failureRatePct': used ? money((failed / used) * 100) : 0,
      },
    },
  );
}

export type { StockMovementType };
