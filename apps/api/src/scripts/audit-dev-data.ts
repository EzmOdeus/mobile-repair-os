/**
 * تدقيق اتساق بيانات المالية في قاعدة التطوير.
 *
 * الافتراضي معاينة فقط. `--fix` يعيد حساب الحقول المشتقة للفاتورة من المدفوعات
 * (paid/due/status/paidAt) دون حذف أي مستند أو تعديل مبالغ البنود.
 *
 * التشغيل من apps/api:
 *   npx tsx src/scripts/audit-dev-data.ts
 *   npx tsx src/scripts/audit-dev-data.ts --fix
 *   npx tsx src/scripts/audit-dev-data.ts --strict   # exit 1 عند وجود أخطاء
 */
import { Types } from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { logger } from '../config/logger.js';
import { runAsSystem } from '../context/tenantContext.js';
import { registerAllModels } from '../models/register.js';
import { InvoiceModel } from '../models/Invoice.js';
import { PaymentModel } from '../models/Payment.js';
import { RepairTicketModel } from '../models/RepairTicket.js';

const FIX = process.argv.includes('--fix');
const STRICT = process.argv.includes('--strict');
const EPS = 0.01;

interface RawInvoice {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  branchId?: Types.ObjectId | null;
  invoiceNumber: string;
  type: string;
  status: string;
  lines?: { quantity?: number; unitPriceEgp?: number; totalEgp?: number }[];
  totals?: {
    subtotalEgp?: number;
    discountEgp?: number;
    taxEgp?: number;
    totalEgp?: number;
    paidEgp?: number;
    dueEgp?: number;
  };
  paidAt?: Date | null;
}

interface RawPayment {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  branchId?: Types.ObjectId | null;
  receiptNumber: string;
  direction?: string;
  amountEgp?: number;
  invoiceId?: Types.ObjectId | null;
  ticketId?: Types.ObjectId | null;
  isRefund?: boolean;
  paidAt?: Date | null;
}

interface RawTicket {
  _id: Types.ObjectId;
  ticketNumber: string;
  cost?: { paidEgp?: number };
}

interface InvoicePayments {
  net: number;
  count: number;
  refunds: number;
  lastPaidAt: Date | null;
  organizations: Set<string>;
  branches: Set<string>;
}

type Severity = 'error' | 'warning';

interface Issue {
  code: string;
  severity: Severity;
  organizationId: string;
  invoiceNumber?: string;
  receiptNumber?: string;
  message: string;
}

interface InvoiceFix {
  invoiceNumber: string;
  paidEgp: number;
  dueEgp: number;
  status: string;
  paidAt: Date | null;
}

function round(value: number): number {
  return Number((Number.isFinite(value) ? value : 0).toFixed(2));
}

function signedAmount(payment: RawPayment): number {
  return payment.isRefund || payment.direction === 'out' ? -round(payment.amountEgp ?? 0) : round(payment.amountEgp ?? 0);
}

function deriveStatus(invoice: RawInvoice, paid: number, refunds: number, total: number): string {
  if (invoice.status === 'void') return 'void';
  if (refunds > 0 && paid <= EPS) return 'refunded';
  if (total <= EPS) return invoice.status === 'draft' ? 'draft' : 'paid';
  if (paid >= total - EPS) return 'paid';
  if (paid > EPS) return 'partially_paid';
  return invoice.status === 'draft' ? 'draft' : 'issued';
}

function derivePaidAt(invoice: RawInvoice, status: string, lastPaidAt: Date | null): Date | null {
  if (status !== 'paid') return null;
  return invoice.paidAt ?? lastPaidAt ?? null;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production' && !process.argv.includes('--force')) {
    console.error('رفض التشغيل على الإنتاج. استخدم --force فقط بعد مراجعة يدوية.');
    process.exit(1);
  }

  registerAllModels();
  await connectDatabase();

  const { invoices, payments, tickets } = await runAsSystem(async () => ({
    invoices: (await InvoiceModel.find({}).lean()) as unknown as RawInvoice[],
    payments: (await PaymentModel.find({}).lean()) as unknown as RawPayment[],
    tickets: (await RepairTicketModel.find({}).select('_id ticketNumber cost.paidEgp').lean()) as unknown as RawTicket[],
  }));

  const issues: Issue[] = [];
  const fixes = new Map<string, InvoiceFix>();
  const invoiceById = new Map(invoices.map((invoice) => [String(invoice._id), invoice]));
  const paymentsByInvoice = new Map<string, InvoicePayments>();
  const paymentsByTicket = new Map<string, number>();

  for (const payment of payments) {
    const amount = round(payment.amountEgp ?? 0);
    if (amount <= 0) {
      issues.push({
        code: 'zero_payment',
        severity: 'warning',
        organizationId: String(payment.organizationId),
        receiptNumber: payment.receiptNumber,
        message: 'دفعة بقيمة صفر أو أقل',
      });
    }

    if (payment.ticketId) {
      const key = String(payment.ticketId);
      paymentsByTicket.set(key, round((paymentsByTicket.get(key) ?? 0) + signedAmount(payment)));
    }

    if (!payment.invoiceId) continue;
    const invoiceKey = String(payment.invoiceId);
    const invoice = invoiceById.get(invoiceKey);
    if (!invoice) {
      issues.push({
        code: 'orphan_payment',
        severity: 'error',
        organizationId: String(payment.organizationId),
        receiptNumber: payment.receiptNumber,
        message: `دفعة مرتبطة بفاتورة غير موجودة (${invoiceKey})`,
      });
      continue;
    }

    const aggregate = paymentsByInvoice.get(invoiceKey) ?? {
      net: 0,
      count: 0,
      refunds: 0,
      lastPaidAt: null as Date | null,
      organizations: new Set<string>(),
      branches: new Set<string>(),
    };
    aggregate.net = round(aggregate.net + signedAmount(payment));
    aggregate.count += 1;
    if (payment.isRefund || payment.direction === 'out') aggregate.refunds += 1;
    const paidAt = payment.paidAt ? new Date(payment.paidAt) : null;
    if (paidAt && (!aggregate.lastPaidAt || paidAt > aggregate.lastPaidAt)) aggregate.lastPaidAt = paidAt;
    aggregate.organizations.add(String(payment.organizationId));
    aggregate.branches.add(String(payment.branchId ?? ''));
    paymentsByInvoice.set(invoiceKey, aggregate);

    if (String(payment.organizationId) !== String(invoice.organizationId)) {
      issues.push({
        code: 'payment_org_mismatch',
        severity: 'error',
        organizationId: String(payment.organizationId),
        invoiceNumber: invoice.invoiceNumber,
        receiptNumber: payment.receiptNumber,
        message: 'مؤسسة الدفعة تختلف عن مؤسسة الفاتورة',
      });
    }
    if (payment.branchId && invoice.branchId && String(payment.branchId) !== String(invoice.branchId)) {
      issues.push({
        code: 'payment_branch_mismatch',
        severity: 'warning',
        organizationId: String(payment.organizationId),
        invoiceNumber: invoice.invoiceNumber,
        receiptNumber: payment.receiptNumber,
        message: 'فرع الدفعة يختلف عن فرع الفاتورة',
      });
    }
  }

  const numberKeys = new Set<string>();
  for (const invoice of invoices) {
    const numberKey = `${String(invoice.organizationId)}:${invoice.invoiceNumber}`;
    if (numberKeys.has(numberKey)) {
      issues.push({
        code: 'duplicate_invoice_number',
        severity: 'error',
        organizationId: String(invoice.organizationId),
        invoiceNumber: invoice.invoiceNumber,
        message: 'رقم فاتورة مكرر داخل المؤسسة',
      });
    }
    numberKeys.add(numberKey);

    const aggregate = paymentsByInvoice.get(String(invoice._id));
    const total = round(invoice.totals?.totalEgp ?? 0);
    const currentPaid = round(invoice.totals?.paidEgp ?? 0);
    const currentDue = round(invoice.totals?.dueEgp ?? 0);
    const net = round(aggregate?.net ?? 0);
    const paid = invoice.status === 'void' ? 0 : round(Math.max(0, net));
    const refundedFully = invoice.status === 'refunded' && paid <= EPS;
    const due = invoice.status === 'void' || refundedFully ? 0 : round(Math.max(0, total - paid));

    if (net < -EPS) {
      issues.push({
        code: 'negative_net_payments',
        severity: 'error',
        organizationId: String(invoice.organizationId),
        invoiceNumber: invoice.invoiceNumber,
        message: `صافي مدفوعات سالب (${net.toFixed(2)}) — استرداد أكبر من التحصيل`,
      });
    }

    if (invoice.status === 'void' && (aggregate?.count ?? 0) > 0) {
      issues.push({
        code: 'payment_on_void_invoice',
        severity: 'error',
        organizationId: String(invoice.organizationId),
        invoiceNumber: invoice.invoiceNumber,
        message: 'فاتورة ملغاة عليها حركات مالية',
      });
    }

    if (Math.abs(currentPaid - paid) > EPS) {
      issues.push({
        code: 'invoice_paid_mismatch',
        severity: 'error',
        organizationId: String(invoice.organizationId),
        invoiceNumber: invoice.invoiceNumber,
        message: `paidEgp=${currentPaid.toFixed(2)} لكن صافي المدفوعات=${paid.toFixed(2)}`,
      });
    }
    if (Math.abs(currentDue - due) > EPS) {
      issues.push({
        code: 'invoice_due_mismatch',
        severity: 'error',
        organizationId: String(invoice.organizationId),
        invoiceNumber: invoice.invoiceNumber,
        message: `dueEgp=${currentDue.toFixed(2)} لكن المتوقع=${due.toFixed(2)}`,
      });
    }

    const expectedStatus = deriveStatus(invoice, paid, aggregate?.refunds ?? 0, total);
    if (invoice.status !== expectedStatus) {
      issues.push({
        code: 'invoice_status_mismatch',
        severity: 'error',
        organizationId: String(invoice.organizationId),
        invoiceNumber: invoice.invoiceNumber,
        message: `status=${invoice.status} لكن المتوقع=${expectedStatus}`,
      });
    }
    if (invoice.status === 'draft' && (aggregate?.count ?? 0) > 0) {
      issues.push({
        code: 'draft_with_payments',
        severity: 'error',
        organizationId: String(invoice.organizationId),
        invoiceNumber: invoice.invoiceNumber,
        message: 'فاتورة مسودة عليها مدفوعات — قد تكون عملية POS لم تكتمل',
      });
    }

    const expectedPaidAt = derivePaidAt(invoice, expectedStatus, aggregate?.lastPaidAt ?? null);
    if (expectedStatus === 'paid' && !invoice.paidAt) {
      issues.push({
        code: 'paid_invoice_without_paid_at',
        severity: 'warning',
        organizationId: String(invoice.organizationId),
        invoiceNumber: invoice.invoiceNumber,
        message: 'فاتورة مدفوعة بلا تاريخ سداد',
      });
    } else if (expectedStatus !== 'paid' && invoice.paidAt) {
      issues.push({
        code: 'unpaid_invoice_with_paid_at',
        severity: 'warning',
        organizationId: String(invoice.organizationId),
        invoiceNumber: invoice.invoiceNumber,
        message: 'تاريخ سداد موجود على فاتورة غير مدفوعة',
      });
    }

    const lines = invoice.lines ?? [];
    const linesSum = round(lines.reduce((sum, line) => sum + (line.totalEgp ?? 0), 0));
    const calculatedLinesSum = round(
      lines.reduce((sum, line) => sum + round((line.quantity ?? 0) * (line.unitPriceEgp ?? 0)), 0),
    );
    if (lines.length && Math.abs(linesSum - calculatedLinesSum) > EPS) {
      issues.push({
        code: 'line_total_mismatch',
        severity: 'warning',
        organizationId: String(invoice.organizationId),
        invoiceNumber: invoice.invoiceNumber,
        message: `مجموع البنود=${linesSum.toFixed(2)} لكن حاصل الكمية×السعر=${calculatedLinesSum.toFixed(2)}`,
      });
    }
    const subtotal = round(invoice.totals?.subtotalEgp ?? 0);
    if (lines.length && Math.abs(subtotal - calculatedLinesSum) > EPS) {
      issues.push({
        code: 'subtotal_mismatch',
        severity: 'warning',
        organizationId: String(invoice.organizationId),
        invoiceNumber: invoice.invoiceNumber,
        message: `subtotal=${subtotal.toFixed(2)} لكن مجموع البنود=${calculatedLinesSum.toFixed(2)}`,
      });
    }
    const afterDiscount = round(subtotal - round(invoice.totals?.discountEgp ?? 0));
    const tax = round(invoice.totals?.taxEgp ?? 0);
    const inclusiveOk = Math.abs(total - afterDiscount) <= 0.05;
    const exclusiveOk = Math.abs(total - round(afterDiscount + tax)) <= 0.05;
    if (lines.length && !inclusiveOk && !exclusiveOk) {
      issues.push({
        code: 'invoice_total_mismatch',
        severity: 'warning',
        organizationId: String(invoice.organizationId),
        invoiceNumber: invoice.invoiceNumber,
        message: `total=${total.toFixed(2)} لا يطابق الإجمالي الشامل (${afterDiscount.toFixed(2)}) ولا الحصري (${round(afterDiscount + tax).toFixed(2)})`,
      });
    }

    if (invoice.status !== 'void' && (Math.abs(currentPaid - paid) > EPS || Math.abs(currentDue - due) > EPS || invoice.status !== expectedStatus)) {
      fixes.set(String(invoice._id), {
        invoiceNumber: invoice.invoiceNumber,
        paidEgp: paid,
        dueEgp: due,
        status: expectedStatus,
        paidAt: expectedPaidAt,
      });
    }
  }

  for (const ticket of tickets) {
    const ticketPaid = round(ticket.cost?.paidEgp ?? 0);
    const expectedPaid = round(Math.max(0, paymentsByTicket.get(String(ticket._id)) ?? 0));
    if (Math.abs(ticketPaid - expectedPaid) > EPS) {
      issues.push({
        code: 'ticket_paid_mismatch',
        severity: 'warning',
        organizationId: '',
        message: `تذكرة ${ticket.ticketNumber}: paidEgp=${ticketPaid.toFixed(2)} لكن صافي مدفوعاتها=${expectedPaid.toFixed(2)}`,
      });
    }
  }

  const byCode = new Map<string, number>();
  for (const issue of issues) byCode.set(issue.code, (byCode.get(issue.code) ?? 0) + 1);

  console.log('\n=== تدقيق بيانات المالية ===');
  console.log(`فواتير: ${invoices.length} · مدفوعات: ${payments.length} · تذاكر: ${tickets.length}`);
  console.log(`مشاكل: ${issues.filter((issue) => issue.severity === 'error').length} خطأ · ${issues.filter((issue) => issue.severity === 'warning').length} تحذير`);
  if (byCode.size) {
    console.log('\nحسب النوع:');
    for (const [code, count] of [...byCode].sort((a, b) => b[1] - a[1])) console.log(`  ${code}: ${count}`);
  }
  if (issues.length) {
    console.log('\nأول 20 مشكلة:');
    for (const issue of issues.slice(0, 20)) {
      console.log(`  [${issue.severity}] ${issue.code} · ${issue.invoiceNumber ?? issue.receiptNumber ?? '—'} — ${issue.message}`);
    }
  }

  if (FIX && fixes.size) {
    console.log(`\nإصلاح ${fixes.size} فاتورة (الحقول المشتقة فقط)...`);
    for (const [invoiceId, fix] of fixes) {
      await runAsSystem(() =>
        InvoiceModel.updateOne(
          { _id: new Types.ObjectId(invoiceId) },
          {
            $set: {
              'totals.paidEgp': fix.paidEgp,
              'totals.dueEgp': fix.dueEgp,
              status: fix.status,
              paidAt: fix.paidAt,
            },
          },
        ),
      );
      console.log(`  ✔ ${fix.invoiceNumber} → ${fix.status} · paid=${fix.paidEgp.toFixed(2)} · due=${fix.dueEgp.toFixed(2)}`);
    }
    console.log('تم. أعد تشغيل التدقيق للتأكد من نظافة النتائج.');
  } else if (fixes.size) {
    console.log(`\n${fixes.size} فاتورة قابلة للإصلاح تلقائيًا. شغّل بـ--fix لتطبيق الحقول المشتقة فقط.`);
  }

  await disconnectDatabase();

  if (STRICT && issues.some((issue) => issue.severity === 'error')) process.exitCode = 1;
}

main().catch(async (error) => {
  logger.error({ err: error }, 'فشل تدقيق بيانات المالية');
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
