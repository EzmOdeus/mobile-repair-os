/**
 * اختبارات حساب درج النقد للورديات:
 * - المتوقع = افتتاحي + نقد داخل − نقد خارج − مصروفات نقدية.
 * - الحركات غير النقدية لا تمس الدرج لكنها تُحتسب في إجمالي الحركات.
 * - الحركة ذات التاريخ السابق لفتح الوردية لا تُنسب إليها.
 * - النقد غير المربوط خلال فترة الوردية يُكشف كتحذير.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { ShiftModel } from '../models/Shift.js';
import { PaymentModel } from '../models/Payment.js';
import { ExpenseModel } from '../models/Expense.js';
import { runAsSystem, runWithTenantContext, type TenantContext } from '../context/tenantContext.js';
import {
  computeShiftCash,
  computeUnlinkedCash,
  isShiftClosed,
  resolveOpenShiftForDate,
  resolveOpenShiftId,
} from './shiftService.js';

const TEST_URI = process.env.MONGODB_TEST_URI ?? 'mongodb://127.0.0.1:27017/mobile_repair_os_vitest';

const organizationId = new Types.ObjectId();
const branchId = new Types.ObjectId();
const actorId = new Types.ObjectId();
const context: TenantContext = {
  actor: { userId: String(actorId), organizationId, branchId, role: 'owner', fullName: 'اختبار' },
  organizationId,
  branchId,
  requestId: 'vitest',
};

const openedAt = new Date(Date.now() - 60 * 60_000);

async function seedShift(input: {
  status?: 'open' | 'closed';
  openingCashEgp?: number;
  openedAt?: Date;
  expectedCashEgp?: number | null;
  countedCashEgp?: number | null;
  varianceEgp?: number | null;
} = {}): Promise<Types.ObjectId> {
  const _id = new Types.ObjectId();
  await runAsSystem(async () => {
    await ShiftModel.collection.insertOne({
      _id,
      organizationId,
      branchId,
      shiftNumber: `SFT-TEST-${String(_id).slice(-6)}`,
      status: input.status ?? 'open',
      openedBy: actorId,
      openedAt: input.openedAt ?? openedAt,
      openingCashEgp: input.openingCashEgp ?? 500,
      openingNotes: '',
      closedBy: input.status === 'closed' ? actorId : null,
      closedAt: input.status === 'closed' ? new Date() : null,
      countedCashEgp: input.countedCashEgp ?? null,
      expectedCashEgp: input.expectedCashEgp ?? null,
      varianceEgp: input.varianceEgp ?? null,
      closeNotes: '',
      totals: {},
      createdAt: openedAt,
      updatedAt: openedAt,
    });
  });
  return _id;
}

async function seedPayment(input: {
  shiftId: Types.ObjectId | null;
  direction: 'in' | 'out';
  method: string;
  amountEgp: number;
  paidAt?: Date;
}): Promise<Types.ObjectId> {
  const _id = new Types.ObjectId();
  await runAsSystem(async () => {
    await PaymentModel.collection.insertOne({
      _id,
      organizationId,
      branchId,
      receiptNumber: `RCP-SFT-${String(_id).slice(-6)}`,
      direction: input.direction,
      method: input.method,
      amountEgp: input.amountEgp,
      shiftId: input.shiftId,
      invoiceId: null,
      customerId: null,
      paidAt: input.paidAt ?? new Date(),
      recordedBy: actorId,
      createdAt: input.paidAt ?? new Date(),
      updatedAt: input.paidAt ?? new Date(),
    });
  });
  return _id;
}

async function seedExpense(input: {
  shiftId: Types.ObjectId | null;
  method: string;
  amountEgp: number;
  incurredAt?: Date;
}): Promise<Types.ObjectId> {
  const _id = new Types.ObjectId();
  await runAsSystem(async () => {
    await ExpenseModel.collection.insertOne({
      _id,
      organizationId,
      branchId,
      title: 'مصروف اختبار',
      category: 'misc',
      amountEgp: input.amountEgp,
      method: input.method,
      shiftId: input.shiftId,
      incurredAt: input.incurredAt ?? new Date(),
      createdBy: actorId,
      createdAt: input.incurredAt ?? new Date(),
      updatedAt: input.incurredAt ?? new Date(),
    });
  });
  return _id;
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
      ShiftModel.deleteMany({}),
      PaymentModel.deleteMany({}),
      ExpenseModel.deleteMany({}),
    ]);
  });
});

describe('computeShiftCash', () => {
  it('يحسب النقد المتوقع من الحركات المربوطة فقط ويفصل غير النقدي', async () => {
    const shiftId = await seedShift({ openingCashEgp: 500, openedAt });

    await seedPayment({ shiftId, direction: 'in', method: 'cash', amountEgp: 300 });
    await seedPayment({ shiftId, direction: 'in', method: 'card', amountEgp: 200 });
    await seedPayment({ shiftId, direction: 'out', method: 'cash', amountEgp: 100 });
    await seedPayment({ shiftId, direction: 'out', method: 'cash', amountEgp: 50 });
    await seedExpense({ shiftId, method: 'cash', amountEgp: 80 });
    await seedExpense({ shiftId, method: 'card', amountEgp: 20 });

    const summary = await runWithTenantContext(context, () =>
      computeShiftCash({ _id: shiftId, openingCashEgp: 500 }),
    );

    expect(summary.cashInEgp).toBe(300);
    expect(summary.cashOutEgp).toBe(150);
    expect(summary.cashExpensesEgp).toBe(80);
    expect(summary.nonCashInEgp).toBe(200);
    expect(summary.nonCashExpensesEgp).toBe(20);
    expect(summary.expectedCashEgp).toBe(570);
    expect(summary.paymentCount).toBe(4);
    expect(summary.expenseCount).toBe(2);
  });

  it('يعطي المتوقع السالب عندما تزيد المصروفات عن النقد المتاح', async () => {
    const shiftId = await seedShift({ openingCashEgp: 100, openedAt });
    await seedExpense({ shiftId, method: 'cash', amountEgp: 250 });

    const summary = await runWithTenantContext(context, () =>
      computeShiftCash({ _id: shiftId, openingCashEgp: 100 }),
    );

    expect(summary.expectedCashEgp).toBe(-150);
  });
});

describe('resolveOpenShiftForDate', () => {
  it('يربط الحركة بالوردية المفتوحة فقط إذا وقعت بعد فتحها', async () => {
    const shiftId = await seedShift({ openedAt });

    const current = await runWithTenantContext(context, () => resolveOpenShiftId(branchId));
    expect(String(current)).toBe(String(shiftId));

    const during = await runWithTenantContext(context, () =>
      resolveOpenShiftForDate(branchId, new Date()),
    );
    expect(String(during)).toBe(String(shiftId));

    const backdated = await runWithTenantContext(context, () =>
      resolveOpenShiftForDate(branchId, new Date(openedAt.getTime() - 60_000)),
    );
    expect(backdated).toBeNull();
  });

  it('لا تُربط الحركات بوردية مغلقة', async () => {
    await seedShift({ status: 'closed', openedAt });

    const current = await runWithTenantContext(context, () => resolveOpenShiftId(branchId));
    expect(current).toBeNull();
  });
});

describe('computeUnlinkedCash', () => {
  it('يكشف النقد غير المربوط داخل فترة الوردية فقط', async () => {
    const shiftId = await seedShift({ openedAt });

    await seedPayment({ shiftId: null, direction: 'in', method: 'cash', amountEgp: 40 });
    await seedExpense({ shiftId: null, method: 'cash', amountEgp: 10 });
    // خارج الفترة: قبل فتح الوردية
    await seedPayment({
      shiftId: null,
      direction: 'in',
      method: 'cash',
      amountEgp: 999,
      paidAt: new Date(openedAt.getTime() - 5 * 60_000),
    });
    // غير نقدي: لا يدخل الدرج
    await seedPayment({ shiftId: null, direction: 'in', method: 'card', amountEgp: 700 });

    const result = await runWithTenantContext(context, () =>
      computeUnlinkedCash(branchId, openedAt, new Date()),
    );

    expect(result.paymentCount).toBe(1);
    expect(result.expenseCount).toBe(1);
    expect(result.netEgp).toBe(30);
  });
});

describe('isShiftClosed', () => {
  it('يميز المفتوحة من المغلقة', async () => {
    const openId = await seedShift({ status: 'open', openedAt });
    const closedId = await seedShift({ status: 'closed', openedAt });

    expect(await runWithTenantContext(context, () => isShiftClosed(openId))).toBe(false);
    expect(await runWithTenantContext(context, () => isShiftClosed(closedId))).toBe(true);
    expect(await runWithTenantContext(context, () => isShiftClosed(null))).toBe(false);
  });
});
