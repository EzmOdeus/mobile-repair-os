/**
 * اختبارات تعويض بيع POS واسترداد المسودات المعلّقة.
 *
 * تحمي القاعدة التي فرضناها على MongoDB standalone (بلا معاملات):
 * - أي فشل في منتصف البيع يعكس المخزون ويحذف المسودة، ولا يبقى أثر جزئي.
 * - العكس idempotent: إعادة المحاولة لا تُرجع الكمية مرتين.
 * - عند الإقلاع: مسودة بلا دفعة تُلغى وتُعاد كميتها، ومسودة عليها دفعة تُثبَّت.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { InvoiceModel } from '../models/Invoice.js';
import { PaymentModel } from '../models/Payment.js';
import { PartModel } from '../models/Part.js';
import { InventoryItemModel } from '../models/InventoryItem.js';
import { StockMovementModel } from '../models/StockMovement.js';
import { runAsSystem, runWithTenantContext, type TenantContext } from '../context/tenantContext.js';
import { recoverIncompletePosSales, rollbackPosSaleStock } from './posService.js';

const TEST_URI = process.env.MONGODB_TEST_URI ?? 'mongodb://127.0.0.1:27017/mobile_repair_os_vitest';

const organizationId = new Types.ObjectId();
const branchId = new Types.ObjectId();
const partId = new Types.ObjectId();
const actorId = new Types.ObjectId();
const context: TenantContext = {
  actor: { userId: String(actorId), organizationId, branchId, role: 'owner', fullName: 'اختبار' },
  organizationId,
  branchId,
  requestId: 'vitest',
};

const now = () => new Date();
const stale = () => new Date(Date.now() - 20 * 60_000);

async function seedPart(): Promise<void> {
  await runAsSystem(async () => {
    await PartModel.collection.insertOne({
      _id: partId,
      organizationId,
      branchId,
      sku: 'TST-POS-1',
      name: 'قطعة اختبار POS',
      category: 'ic_chip',
      grade: 'oem',
      pricing: { costEgp: 50, sellingPriceEgp: 100, wholesalePriceEgp: 80, lastCostEgp: 50 },
      stock: { onHand: 5, reserved: 0, defective: 0, incoming: 0, reorderLevel: 2, reorderQty: 5 },
      warranty: { days: 0, supplierDays: 0, terms: '' },
      isActive: true,
      createdAt: now(),
      updatedAt: now(),
    });
    await InventoryItemModel.collection.insertOne({
      _id: new Types.ObjectId(),
      organizationId,
      branchId,
      partId,
      quantity: { onHand: 5, reserved: 0, defective: 0, incoming: 0 },
      reorderLevel: 2,
      reorderQty: 5,
      avgCostEgp: 50,
      isActive: true,
      createdAt: now(),
      updatedAt: now(),
    });
  });
}

async function seedDraftInvoice(invoiceNumber: string, createdAt = stale()): Promise<Types.ObjectId> {
  const _id = new Types.ObjectId();
  await runAsSystem(async () => {
    await InvoiceModel.collection.insertOne({
      _id,
      organizationId,
      branchId,
      invoiceNumber,
      type: 'pos_sale',
      status: 'draft',
      customerId: null,
      lines: [{ kind: 'accessory', description: 'test', quantity: 1, unitPriceEgp: 100, totalEgp: 100 }],
      totals: {
        subtotalEgp: 100,
        discountEgp: 0,
        taxRatePct: 0,
        taxEgp: 0,
        totalEgp: 100,
        paidEgp: 0,
        dueEgp: 100,
        changeEgp: 0,
      },
      issuedAt: null,
      notes: '',
      createdBy: actorId,
      cashierId: actorId,
      createdAt,
      updatedAt: createdAt,
    });
  });
  return _id;
}

/** يحاكي خصم المخزون الذي حدث قبل الانهيار (بدون تعويض) */
async function seedSaleOut(invoiceId: Types.ObjectId, invoiceNumber: string, quantity = 2): Promise<Types.ObjectId> {
  const movementId = new Types.ObjectId();
  await runAsSystem(async () => {
    await StockMovementModel.collection.insertOne({
      _id: movementId,
      organizationId,
      branchId,
      partId,
      type: 'sale_out',
      quantity: -quantity,
      effect: { onHand: -quantity, reserved: 0, defective: 0, incoming: 0 },
      balanceAfter: { onHand: 5 - quantity, reserved: 0, defective: 0, incoming: 0 },
      unitCostEgp: 50,
      totalCostEgp: 50 * quantity,
      invoiceId,
      reason: 'بيع مباشر من نقاط البيع',
      reference: invoiceNumber,
      reversedAt: null,
      reversalMovementId: null,
      actorId,
      actorName: 'اختبار',
      occurredAt: stale(),
      createdAt: stale(),
    });
    await InventoryItemModel.updateOne(
      { partId, branchId },
      { $inc: { 'quantity.onHand': -quantity } },
    );
    await PartModel.updateOne({ _id: partId }, { $inc: { 'stock.onHand': -quantity } });
  });
  return movementId;
}

async function seedPayment(invoiceId: Types.ObjectId, amountEgp = 100): Promise<Types.ObjectId> {
  const _id = new Types.ObjectId();
  await runAsSystem(async () => {
    await PaymentModel.collection.insertOne({
      _id,
      organizationId,
      branchId,
      receiptNumber: `RCP-TEST-${String(_id).slice(-6)}`,
      direction: 'in',
      method: 'cash',
      amountEgp,
      invoiceId,
      customerId: null,
      paidAt: now(),
      recordedBy: actorId,
      createdAt: now(),
      updatedAt: now(),
    });
  });
  return _id;
}

async function stockLevels(): Promise<{ branch: number; part: number }> {
  return runAsSystem(async () => {
    const item = await InventoryItemModel.findOne({ partId, branchId }).lean();
    const part = await PartModel.findById(partId).lean();
    return { branch: item?.quantity?.onHand ?? 0, part: part?.stock?.onHand ?? 0 };
  });
}

beforeAll(async () => {
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 5_000 });
  await mongoose.connection.dropDatabase();
});

afterAll(async () => {
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  }
});

beforeEach(async () => {
  await runAsSystem(async () => {
    await Promise.all([
      InvoiceModel.deleteMany({}),
      PaymentModel.deleteMany({}),
      StockMovementModel.deleteMany({}),
      InventoryItemModel.deleteMany({}),
      PartModel.deleteMany({}),
    ]);
  });
  await seedPart();
});

describe('rollbackPosSaleStock', () => {
  it('يعكس الكمية ويعيد الأرصدة ولا يكرر العكس عند إعادة المحاولة', async () => {
    const invoiceId = await seedDraftInvoice('INV-POS-RB-1');
    const movementId = await seedSaleOut(invoiceId, 'INV-POS-RB-1');
    expect(await stockLevels()).toEqual({ branch: 3, part: 3 });

    const first = await runWithTenantContext(context, () =>
      rollbackPosSaleStock({
        invoiceId,
        invoiceNumber: 'INV-POS-RB-1',
        organizationId,
        branchId,
        actorId,
        actorName: 'اختبار',
      }),
    );
    expect(first).toEqual([String(movementId)]);
    expect(await stockLevels()).toEqual({ branch: 5, part: 5 });

    const original = await runAsSystem(() => StockMovementModel.findById(movementId).lean());
    expect(original?.reversedAt).toBeInstanceOf(Date);
    expect(original?.reversalMovementId).toBeTruthy();

    const second = await runWithTenantContext(context, () =>
      rollbackPosSaleStock({
        invoiceId,
        invoiceNumber: 'INV-POS-RB-1',
        organizationId,
        branchId,
        actorId,
        actorName: 'اختبار',
      }),
    );
    expect(second).toEqual([]);
    expect(await stockLevels()).toEqual({ branch: 5, part: 5 });
  });
});

describe('recoverIncompletePosSales', () => {
  it('يلغي المسودة القديمة بلا دفعة ويعيد كمية المخزون', async () => {
    const invoiceId = await seedDraftInvoice('INV-POS-RC-1');
    await seedSaleOut(invoiceId, 'INV-POS-RC-1');
    expect(await stockLevels()).toEqual({ branch: 3, part: 3 });

    const result = await recoverIncompletePosSales();
    expect(result).toEqual({ finalized: 0, rolledBack: 1 });
    expect(await stockLevels()).toEqual({ branch: 5, part: 5 });

    const invoice = await runAsSystem(() => InvoiceModel.findById(invoiceId).lean());
    expect(invoice).toBeNull();
  });

  it('يثبّت المسودة التي عليها دفعة بدل إلغائها', async () => {
    const invoiceId = await seedDraftInvoice('INV-POS-RC-2');
    await seedSaleOut(invoiceId, 'INV-POS-RC-2');
    const paymentId = await seedPayment(invoiceId);

    const result = await recoverIncompletePosSales();
    expect(result).toEqual({ finalized: 1, rolledBack: 0 });
    expect(await stockLevels()).toEqual({ branch: 3, part: 3 });

    const invoice = await runAsSystem(() => InvoiceModel.findById(invoiceId).lean());
    expect(invoice?.status).toBe('paid');
    expect(invoice?.totals?.paidEgp).toBe(100);
    expect(invoice?.totals?.dueEgp).toBe(0);
    expect(invoice?.issuedAt).toBeTruthy();

    const payment = await runAsSystem(() => PaymentModel.findById(paymentId).lean());
    expect(payment).not.toBeNull();
  });

  it('لا يلمس المسودات الحديثة (قد تكون عملية بيع جارية)', async () => {
    const invoiceId = await seedDraftInvoice('INV-POS-RC-3', new Date());
    await seedSaleOut(invoiceId, 'INV-POS-RC-3');

    const result = await recoverIncompletePosSales();
    expect(result).toEqual({ finalized: 0, rolledBack: 0 });
    expect(await stockLevels()).toEqual({ branch: 3, part: 3 });
    expect(await runAsSystem(() => InvoiceModel.findById(invoiceId).lean())).not.toBeNull();
  });
});
