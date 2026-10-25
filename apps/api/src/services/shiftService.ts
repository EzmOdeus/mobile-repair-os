import { Types } from 'mongoose';
import { ShiftModel } from '../models/Shift.js';
import { PaymentModel } from '../models/Payment.js';
import { ExpenseModel } from '../models/Expense.js';
import { ApiError } from '../utils/ApiError.js';
import { money } from '../utils/money.js';

export interface ShiftCashBreakdown {
  openingCashEgp: number;
  cashInEgp: number;
  cashOutEgp: number;
  cashExpensesEgp: number;
  nonCashInEgp: number;
  nonCashOutEgp: number;
  nonCashExpensesEgp: number;
  expectedCashEgp: number;
  paymentCount: number;
  expenseCount: number;
}

export interface ShiftUnlinkedCash {
  paymentCount: number;
  expenseCount: number;
  netEgp: number;
}

interface PaymentGroups {
  _id: { method: string; direction: string };
  total: number;
  count: number;
}

interface ExpenseGroups {
  _id: string;
  total: number;
  count: number;
}

/**
 * معرّف الوردية المفتوحة للفرع (أو null). تُستدعى من كل مسار ينشئ حركة نقدية
 * لربطها تلقائيًا بالوردية الجارية، بدل الاعتماد على إدخال المستخدم.
 */
export async function resolveOpenShiftId(
  branchId: Types.ObjectId | string | null | undefined,
): Promise<Types.ObjectId | null> {
  if (!branchId || !Types.ObjectId.isValid(String(branchId))) return null;
  const shift = await ShiftModel.findOne({
    branchId: new Types.ObjectId(String(branchId)),
    status: 'open',
  })
    .select('_id')
    .lean();
  return (shift?._id as Types.ObjectId | undefined) ?? null;
}

/**
 * ربط حركة بتاريخ وقوعها: لا تُنسب لوردية فُتحت بعد وقوعها (مصروف بأثر رجعي
 * أو سداد مورد بتاريخ سابق) حتى لا يتشوه درج النقد الحالي.
 */
export async function resolveOpenShiftForDate(
  branchId: Types.ObjectId | string | null | undefined,
  occurredAt: Date,
): Promise<Types.ObjectId | null> {
  if (!branchId || !Types.ObjectId.isValid(String(branchId))) return null;
  const shift = await ShiftModel.findOne({
    branchId: new Types.ObjectId(String(branchId)),
    status: 'open',
  })
    .select('_id openedAt')
    .lean();
  if (!shift) return null;
  return occurredAt.getTime() >= shift.openedAt.getTime()
    ? (shift._id as Types.ObjectId)
    : null;
}

/**
 * حساب درج النقد من الحركات المربوطة بالوردية:
 * المتوقع = رصيد البداية + نقد داخل − نقد خارج (استردادات/سداد موردين) − مصروفات نقدية.
 */
export async function computeShiftCash(shift: {
  _id: Types.ObjectId;
  openingCashEgp: number;
}): Promise<ShiftCashBreakdown> {
  const [paymentGroups, expenseGroups] = await Promise.all([
    PaymentModel.aggregate<PaymentGroups>([
      { $match: { shiftId: shift._id } },
      {
        $group: {
          _id: { method: '$method', direction: '$direction' },
          total: { $sum: '$amountEgp' },
          count: { $sum: 1 },
        },
      },
    ]),
    ExpenseModel.aggregate<ExpenseGroups>([
      { $match: { shiftId: shift._id } },
      { $group: { _id: '$method', total: { $sum: '$amountEgp' }, count: { $sum: 1 } } },
    ]),
  ]);

  let cashIn = 0;
  let cashOut = 0;
  let nonCashIn = 0;
  let nonCashOut = 0;
  let paymentCount = 0;

  for (const group of paymentGroups) {
    paymentCount += group.count;
    if (group._id.method === 'cash') {
      if (group._id.direction === 'out') cashOut += group.total;
      else cashIn += group.total;
    } else if (group._id.direction === 'out') {
      nonCashOut += group.total;
    } else {
      nonCashIn += group.total;
    }
  }

  let cashExpenses = 0;
  let nonCashExpenses = 0;
  let expenseCount = 0;
  for (const group of expenseGroups) {
    expenseCount += group.count;
    if (group._id === 'cash') cashExpenses += group.total;
    else nonCashExpenses += group.total;
  }

  const openingCash = money(shift.openingCashEgp);
  return {
    openingCashEgp: openingCash,
    cashInEgp: money(cashIn),
    cashOutEgp: money(cashOut),
    cashExpensesEgp: money(cashExpenses),
    nonCashInEgp: money(nonCashIn),
    nonCashOutEgp: money(nonCashOut),
    nonCashExpensesEgp: money(nonCashExpenses),
    expectedCashEgp: money(openingCash + cashIn - cashOut - cashExpenses),
    paymentCount,
    expenseCount,
  };
}

/**
 * حركات نقدية وقعت خلال فترة الوردية لكنها لم تُربط بها (سُجلت قبل فتح الوردية
 * أو قبل تفعيل الخاصية، أو من مسار لا يمر بالربط التلقائي). تُعرض كتحذير
 * لأنها قد تفسر فرقًا بين النقد المتوقع والمعدود.
 */
export async function computeUnlinkedCash(
  branchId: Types.ObjectId,
  openedAt: Date,
  endAt: Date = new Date(),
): Promise<ShiftUnlinkedCash> {
  const [paymentGroups, expenseGroups] = await Promise.all([
    PaymentModel.aggregate<{ _id: string; total: number; count: number }>([
      {
        $match: {
          branchId,
          shiftId: null,
          method: 'cash',
          paidAt: { $gte: openedAt, $lte: endAt },
        },
      },
      { $group: { _id: '$direction', total: { $sum: '$amountEgp' }, count: { $sum: 1 } } },
    ]),
    ExpenseModel.aggregate<{ _id: null; total: number; count: number }>([
      {
        $match: {
          branchId,
          shiftId: null,
          method: 'cash',
          incurredAt: { $gte: openedAt, $lte: endAt },
        },
      },
      { $group: { _id: null, total: { $sum: '$amountEgp' }, count: { $sum: 1 } } },
    ]),
  ]);

  let net = 0;
  let paymentCount = 0;
  for (const group of paymentGroups) {
    paymentCount += group.count;
    net += group._id === 'out' ? -group.total : group.total;
  }

  let expenseCount = 0;
  for (const group of expenseGroups) {
    expenseCount += group.count;
    net -= group.total;
  }

  return { paymentCount, expenseCount, netEgp: money(net) };
}

/** هل الوردية مغلقة؟ لمنع تعديل مصروف/حركة أُغلقت ورديتها. */
export async function isShiftClosed(shiftId: Types.ObjectId | null | undefined): Promise<boolean> {
  if (!shiftId) return false;
  const shift = await ShiftModel.findById(shiftId).select('status').lean();
  return shift?.status === 'closed';
}

/** يمنع تعديل/حذف مصروف بعد إغلاق ورديته — الحساب الختامي أصبح لقطة معتمدة */
export async function assertExpenseShiftEditable(shiftId: Types.ObjectId | null | undefined): Promise<void> {
  if (await isShiftClosed(shiftId)) {
    throw ApiError.businessRule('هذا المصروف مرتبط بوردية مغلقة ولا يمكن تعديله أو حذفه');
  }
}
