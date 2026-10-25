import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { ShiftModel } from '../models/Shift.js';
import { PaymentModel } from '../models/Payment.js';
import { ExpenseModel } from '../models/Expense.js';
import { BranchModel } from '../models/Branch.js';
import { ApiError } from '../utils/ApiError.js';
import { created, ok, paginated } from '../utils/asyncHandler.js';
import { parseCsv, parseDateRange, parseListQuery } from '../utils/queryHelpers.js';
import { branchFilter, getAuth, requireBranchAccess } from '../middleware/auth.js';
import { getTenantContext } from '../context/tenantContext.js';
import { recordAudit } from '../services/auditService.js';
import { nextShiftNumber, withUniqueRetry } from '../services/numberingService.js';
import {
  computeShiftCash,
  computeUnlinkedCash,
  type ShiftCashBreakdown,
} from '../services/shiftService.js';
import { money } from '../utils/money.js';

/** الفرع المستهدف للعملية: الفرع النشط افتراضيًا، مع فرض صلاحية الفرع */
function resolveBranchId(req: Request, requested?: unknown): Types.ObjectId {
  const auth = getAuth(req);
  const raw = typeof requested === 'string' && requested.trim() ? requested.trim() : null;
  if (raw && !Types.ObjectId.isValid(raw)) throw ApiError.badRequest('معرّف الفرع غير صحيح');

  const branchId = auth.branchScoped ? auth.branchId : raw ?? auth.branchId;
  if (!branchId) throw ApiError.badRequest('لا يوجد فرع نشط — اختر فرعًا أولًا');
  requireBranchAccess(req, branchId);
  return new Types.ObjectId(branchId);
}

/** ملخص وردية مغلقة من اللقطة المحفوظة (لا يُعاد حسابه من البيانات الحية) */
function closedSummary(shift: {
  openingCashEgp?: number | null;
  expectedCashEgp?: number | null;
  totals?: {
    cashInEgp?: number | null;
    cashOutEgp?: number | null;
    cashExpensesEgp?: number | null;
    nonCashInEgp?: number | null;
    nonCashOutEgp?: number | null;
    nonCashExpensesEgp?: number | null;
    paymentCount?: number | null;
    expenseCount?: number | null;
  } | null;
}): ShiftCashBreakdown {
  const totals = shift.totals ?? {};
  return {
    openingCashEgp: money(shift.openingCashEgp),
    cashInEgp: money(totals.cashInEgp),
    cashOutEgp: money(totals.cashOutEgp),
    cashExpensesEgp: money(totals.cashExpensesEgp),
    nonCashInEgp: money(totals.nonCashInEgp),
    nonCashOutEgp: money(totals.nonCashOutEgp),
    nonCashExpensesEgp: money(totals.nonCashExpensesEgp),
    expectedCashEgp: money(shift.expectedCashEgp),
    paymentCount: totals.paymentCount ?? 0,
    expenseCount: totals.expenseCount ?? 0,
  };
}

/* ===================== فتح وإغلاق الورديات ===================== */

export const openShift = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const ctx = getTenantContext();
  const body = req.body as { branchId?: string; openingCashEgp: number; notes?: string };
  const branchId = resolveBranchId(req, body.branchId);

  const branch = await BranchModel.findOne({ _id: branchId, isActive: true }).select('_id').lean();
  if (!branch) throw ApiError.notFound('الفرع غير موجود أو موقوف');

  const existing = await ShiftModel.findOne({ branchId, status: 'open' })
    .select('_id shiftNumber openedAt')
    .lean();
  if (existing) {
    throw ApiError.businessRule(`الوردية ${existing.shiftNumber} مفتوحة بالفعل لهذا الفرع`, {
      shiftId: String(existing._id),
    });
  }

  let shift;
  try {
    shift = await withUniqueRetry(nextShiftNumber, (shiftNumber) =>
      ShiftModel.create({
        organizationId: ctx!.organizationId,
        branchId,
        shiftNumber,
        status: 'open',
        openedBy: new Types.ObjectId(auth.userId),
        openedAt: new Date(),
        openingCashEgp: money(body.openingCashEgp ?? 0),
        openingNotes: body.notes ?? '',
      }),
    );
  } catch (error) {
    // الفهرس الجزئي يرفض الوردية الثانية؛ الرقم المكرر نادر جدًا (إعادة تعيين عدّاد)
    if ((error as { code?: number }).code === 11000) {
      throw ApiError.businessRule('يوجد وردية مفتوحة بالفعل لهذا الفرع — أغلقها قبل فتح وردية جديدة');
    }
    throw error;
  }

  await recordAudit(
    {
      action: 'create',
      resource: 'Shift',
      resourceId: String(shift._id),
      summary: `فتح وردية ${shift.shiftNumber} برصيد افتتاحي ${shift.openingCashEgp} جنيه`,
    },
    req,
  );

  return created(res, shift.toObject());
};

export const closeShift = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const body = req.body as { countedCashEgp: number; notes?: string };

  const shift = await ShiftModel.findById(req.params.id);
  if (!shift) throw ApiError.notFound('الوردية غير موجودة');
  requireBranchAccess(req, shift.branchId);
  if (shift.status === 'closed') throw ApiError.businessRule('هذه الوردية مغلقة بالفعل');

  const breakdown = await computeShiftCash(shift);
  const counted = money(body.countedCashEgp);
  const variance = money(counted - breakdown.expectedCashEgp);

  shift.status = 'closed';
  shift.closedBy = new Types.ObjectId(auth.userId);
  shift.closedAt = new Date();
  shift.countedCashEgp = counted;
  shift.expectedCashEgp = breakdown.expectedCashEgp;
  shift.varianceEgp = variance;
  shift.closeNotes = body.notes ?? '';
  shift.totals = {
    cashInEgp: breakdown.cashInEgp,
    cashOutEgp: breakdown.cashOutEgp,
    cashExpensesEgp: breakdown.cashExpensesEgp,
    nonCashInEgp: breakdown.nonCashInEgp,
    nonCashOutEgp: breakdown.nonCashOutEgp,
    nonCashExpensesEgp: breakdown.nonCashExpensesEgp,
    paymentCount: breakdown.paymentCount,
    expenseCount: breakdown.expenseCount,
  };
  await shift.save();

  await recordAudit(
    {
      action: 'status_transition',
      resource: 'Shift',
      resourceId: String(shift._id),
      summary: `إغلاق وردية ${shift.shiftNumber}: متوقع ${breakdown.expectedCashEgp}، معدود ${counted}، فرق ${variance}`,
      severity: Math.abs(variance) > 0.009 ? 'warning' : 'info',
      changes: [{ field: 'status', before: 'open', after: 'closed' }],
    },
    req,
  );

  return ok(res, {
    shift: shift.toObject(),
    summary: breakdown,
    varianceEgp: variance,
  });
};

/* ===================== قراءة الورديات ===================== */

export const currentShift = async (req: Request, res: Response) => {
  const branchId = resolveBranchId(req, req.query.branchId);
  const shift = await ShiftModel.findOne({ branchId, status: 'open' })
    .populate('openedBy', 'fullName')
    .populate('branchId', 'name code');

  if (!shift) {
    return ok(res, { shift: null, summary: null, unlinked: null });
  }

  const [summary, unlinked] = await Promise.all([
    computeShiftCash(shift),
    computeUnlinkedCash(branchId, shift.openedAt, new Date()),
  ]);

  return ok(res, { shift: shift.toObject(), summary, unlinked });
};

export const listShifts = async (req: Request, res: Response) => {
  const { page, limit, skip } = parseListQuery(req.query as Record<string, unknown>, 25);
  const query = req.query as Record<string, unknown>;

  const filter: Record<string, unknown> = {};
  const statuses = parseCsv(query.status);
  if (statuses.length) filter.status = { $in: statuses };
  const scopedBranch = branchFilter(req);
  if (scopedBranch) filter.branchId = scopedBranch;
  const openedAt = parseDateRange(query.from, query.to);
  if (openedAt) filter.openedAt = openedAt;

  const [items, total] = await Promise.all([
    ShiftModel.find(filter)
      .populate('branchId', 'name code')
      .populate('openedBy', 'fullName')
      .populate('closedBy', 'fullName')
      .sort({ openedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    ShiftModel.countDocuments(filter),
  ]);

  /** الورديات المفتوحة تُعرض بنقد متوقع لحظي، والمغلقة بلقطتها المحفوظة */
  const enriched = await Promise.all(
    items.map(async (item) => {
      if (item.status !== 'open') return item;
      const live = await computeShiftCash({
        _id: item._id as Types.ObjectId,
        openingCashEgp: item.openingCashEgp ?? 0,
      });
      return { ...item, liveExpectedCashEgp: live.expectedCashEgp };
    }),
  );

  return paginated(res, enriched, { page, limit, total });
};

export const getShift = async (req: Request, res: Response) => {
  const shift = await ShiftModel.findById(req.params.id)
    .populate('branchId', 'name code')
    .populate('openedBy', 'fullName')
    .populate('closedBy', 'fullName');
  if (!shift) throw ApiError.notFound('الوردية غير موجودة');
  requireBranchAccess(req, shift.branchId);

  const isOpen = shift.status === 'open';
  const endAt = shift.closedAt ?? new Date();

  const [summary, unlinked, payments, expenses] = await Promise.all([
    isOpen ? computeShiftCash(shift) : Promise.resolve(closedSummary(shift)),
    computeUnlinkedCash(shift.branchId as Types.ObjectId, shift.openedAt, endAt),
    PaymentModel.find({ shiftId: shift._id })
      .populate('recordedBy', 'fullName')
      .populate('customerId', 'fullName phone')
      .sort({ paidAt: -1 })
      .limit(200)
      .lean(),
    ExpenseModel.find({ shiftId: shift._id })
      .populate('createdBy', 'fullName')
      .sort({ incurredAt: -1 })
      .limit(200)
      .lean(),
  ]);

  return ok(res, {
    shift: shift.toObject(),
    summary,
    unlinked,
    payments,
    expenses,
  });
};
