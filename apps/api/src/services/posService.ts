import { Types } from 'mongoose';
import { logger } from '../config/logger.js';
import { runAsSystem, runWithTenantContext } from '../context/tenantContext.js';
import { InvoiceModel } from '../models/Invoice.js';
import { PaymentModel } from '../models/Payment.js';
import { StockMovementModel } from '../models/StockMovement.js';
import type { TenantContext } from '../context/tenantContext.js';
import { money } from '../utils/money.js';
import { applyStockMovement } from './inventoryService.js';

/**
 * تعويض بيع POS فشل قبل اكتماله.
 *
 * النظام يعمل محليًا على MongoDB standalone (بلا replica set) فلا تتوفر
 * المعاملات. لذلك نعتمد ترتيبًا آمنًا + تعويضًا صريحًا: تُنشأ الفاتورة
 * كمسودة، ثم تُخصم الكميات بحركات مربوطة بها، وأي فشل يستدعي هذه الدالة
 * لعكس الحركات وحذف المسودة — فلا يبقى مخزون مخصوم بلا فاتورة صادرة.
 *
 * كل عكس يحمل مرجعًا حتميًا حتى تكون إعادة المحاولة (بعد انهيار العملية)
 * آمنة ولا تعكس الحركة مرتين.
 */
export interface PosStockRollbackInput {
  invoiceId: Types.ObjectId | string;
  invoiceNumber: string;
  organizationId: Types.ObjectId | string;
  branchId: Types.ObjectId | string | null;
  actorId: Types.ObjectId | string;
  actorName?: string;
}

export async function rollbackPosSaleStock(input: PosStockRollbackInput): Promise<string[]> {
  const invoiceId = new Types.ObjectId(String(input.invoiceId));
  const invoiceNumber = input.invoiceNumber;

  const movements = await StockMovementModel.find({
    invoiceId,
    type: 'sale_out',
    reversedAt: null,
  })
    .select('_id partId quantity')
    .lean();

  const reversed: string[] = [];

  for (const movement of movements) {
    const rollbackRef = `POS-ROLLBACK-${String(invoiceId)}-${String(movement._id)}`;
    const alreadyReversed = await StockMovementModel.findOne({
      invoiceId,
      type: 'adjustment_in',
      reference: rollbackRef,
    })
      .select('_id')
      .lean();

    let reversalId = alreadyReversed?._id;

    if (!reversalId) {
      const reversal = await applyStockMovement({
        partId: movement.partId,
        type: 'adjustment_in',
        quantity: Math.abs(movement.quantity),
        branchId: input.branchId,
        invoiceId,
        reason: 'إرجاع تلقائي: لم يكتمل بيع نقاط البيع',
        reference: rollbackRef,
        actor: { userId: input.actorId, fullName: input.actorName ?? 'النظام' },
      });
      reversalId = (reversal.movement as { _id: Types.ObjectId })._id;
    }

    await StockMovementModel.updateOne(
      { _id: movement._id },
      { $set: { reversedAt: new Date(), reversalMovementId: reversalId } },
    );
    reversed.push(String(movement._id));
  }

  logger.warn(
    { invoiceId: String(invoiceId), invoiceNumber, reversedMovements: reversed.length },
    'تم عكس حركات مخزون بيع POS لم يكتمل',
  );

  return reversed;
}

/**
 * استرداد المسودات المعلّقة عند الإقلاع (انهيار أثناء البيع).
 *
 * - مسودة عليها دفعة ⇒ اكتمل الدفع قبل الانهيار، فنُثبّت الفاتورة.
 * - مسودة بلا دفعة ⇒ عكس المخزون وحذف المسودة.
 * لا تلمس الفواتير المكتملة أو الحديثة (نافذة 10 دقائق) حتى لا تتعارض مع
 * عملية بيع جارية.
 */
export async function recoverIncompletePosSales(olderThanMinutes = 10): Promise<{ finalized: number; rolledBack: number }> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);

  const staleInvoices = await runAsSystem(() =>
    InvoiceModel.find({ type: 'pos_sale', status: 'draft', createdAt: { $lt: cutoff } }).lean(),
  );

  let finalized = 0;
  let rolledBack = 0;

  for (const invoice of staleInvoices) {
    const raw = invoice as unknown as {
      _id: Types.ObjectId;
      invoiceNumber: string;
      organizationId: Types.ObjectId;
      branchId: Types.ObjectId | null;
      createdBy: Types.ObjectId;
      createdAt?: Date;
      totals?: { totalEgp?: number; paidEgp?: number; dueEgp?: number };
    };

    const context: TenantContext = {
      actor: {
        userId: String(raw.createdBy),
        organizationId: raw.organizationId,
        branchId: raw.branchId ?? null,
        role: 'system',
        fullName: 'استرداد تلقائي',
      },
      organizationId: raw.organizationId,
      branchId: raw.branchId ?? null,
      requestId: 'pos-recovery',
    };

    try {
      await runWithTenantContext(context, async () => {
        const payment = await PaymentModel.findOne({ invoiceId: raw._id, direction: 'in' }).lean();
        const total = money(raw.totals?.totalEgp ?? 0);

        if (payment) {
          const paid = money(Math.min(payment.amountEgp, total));
          const due = money(Math.max(0, total - paid));
          const status = due <= 0.009 ? 'paid' : 'partially_paid';
          await InvoiceModel.updateOne(
            { _id: raw._id, status: 'draft' },
            {
              $set: {
                'totals.paidEgp': paid,
                'totals.dueEgp': due,
                status,
                issuedAt: raw.createdAt ?? new Date(),
                paidAt: status === 'paid' ? (payment.paidAt ?? new Date()) : null,
              },
            },
          );
          finalized += 1;
          logger.warn(
            { invoiceId: String(raw._id), invoiceNumber: raw.invoiceNumber, status },
            'أُعيد تثبيت فاتورة POS مسودة بعد انهيار العملية',
          );
          return;
        }

        await rollbackPosSaleStock({
          invoiceId: raw._id,
          invoiceNumber: raw.invoiceNumber,
          organizationId: raw.organizationId,
          branchId: raw.branchId,
          actorId: raw.createdBy,
          actorName: 'استرداد تلقائي',
        });
        await InvoiceModel.deleteOne({ _id: raw._id, status: 'draft' });
        rolledBack += 1;
        logger.warn(
          { invoiceId: String(raw._id), invoiceNumber: raw.invoiceNumber },
          'حُذفت مسودة بيع POS معلّقة بعد عكس مخزونها',
        );
      });
    } catch (err) {
      logger.error({ err, invoiceId: String(raw._id) }, 'تعذر استرداد مسودة بيع POS معلّقة');
    }
  }

  if (finalized || rolledBack) {
    logger.warn({ finalized, rolledBack }, 'نتيجة استرداد مسودات بيع POS المعلّقة');
  }

  return { finalized, rolledBack };
}
