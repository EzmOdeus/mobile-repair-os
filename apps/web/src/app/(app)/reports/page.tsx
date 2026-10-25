'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { BarChart3, Printer, ReceiptText, Scale, Wallet } from 'lucide-react';
import { errorMessage, fetcher, qs } from '@/lib/api';
import { formatDate, formatMoney, formatNumber, formatPercent } from '@/lib/format';
import { PAYMENT_METHOD_LABELS } from '@/lib/constants';
import { Badge, Card, EmptyState, LoadingBlock, PageHeader, StatCard } from '@/components/ui';

/* ============================ الأنواع ============================ */

interface ProfitLoss {
  period: { from: string; to: string };
  revenueEgp: number;
  receiptsCount: number;
  refundsEgp: number;
  refundsCount: number;
  netRevenueEgp: number;
  cogsEgp: number;
  partsConsumedUnits: number;
  grossProfitEgp: number;
  grossMarginPct: number;
  expensesEgp: number;
  expensesByCategory: { category: string; count: number; totalEgp: number }[];
  netProfitEgp: number;
  netMarginPct: number;
  revenueByMethod: { method: string; count: number; totalEgp: number }[];
}

interface VatReport {
  period: { from: string; to: string };
  output: { salesNetEgp: number; salesGrossEgp: number; taxEgp: number; invoicesCount: number };
  input: {
    purchasesNetEgp: number;
    taxEgp: number;
    purchaseOrdersCount: number;
    details: { poNumber: string; date: string; netEgp: number; taxEgp: number }[];
  };
  netTaxDueEgp: number;
}

interface AgingReport {
  totalDueEgp: number;
  invoicesCount: number;
  buckets: { key: string; label: string; count: number; totalEgp: number }[];
  items: {
    invoiceId: string;
    invoiceNumber: string;
    customerName: string;
    customerPhone: string;
    issueDate: string;
    dueDate: string;
    daysOverdue: number;
    bucket: string;
    totalEgp: number;
    dueEgp: number;
  }[];
}

interface CashierReport {
  period: { from: string; to: string };
  totalCollectionsEgp: number;
  totalRefundsEgp: number;
  items: {
    userId: string;
    fullName: string;
    username: string;
    role: string;
    collectionsEgp: number;
    refundsEgp: number;
    transactions: number;
  }[];
}

const EXPENSE_LABELS: Record<string, string> = {
  rent: 'إيجار',
  salaries: 'رواتب',
  utilities: 'مرافق',
  internet_phone: 'إنترنت وتليفون',
  tools: 'أدوات',
  parts_purchase: 'شراء قطع',
  marketing: 'تسويق',
  maintenance: 'صيانة',
  transport: 'مواصلات',
  taxes: 'ضرائب',
  misc: 'متنوع',
};

const ROLE_LABELS: Record<string, string> = {
  owner: 'مالك المركز',
  admin: 'مدير النظام',
  manager: 'مدير فرع',
  receptionist: 'استقبال',
  technician: 'فني',
  accountant: 'محاسب',
  viewer: 'مشاهدة فقط',
};

function monthStart(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function toIso(value: string, end = false): string | undefined {
  if (!value) return undefined;
  return new Date(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}`).toISOString();
}

/* ============================ الصفحة ============================ */

export default function ReportsPage() {
  const [tab, setTab] = useState<'pl' | 'vat' | 'aging' | 'cashier'>('pl');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());

  const range = qs({ from: toIso(from), to: toIso(to, true) });

  const { data: pl, error: plError, isLoading: plLoading } = useSWR<ProfitLoss>(
    tab === 'pl' ? `/finance/reports/profit-loss${range}` : null,
    fetcher,
  );
  const { data: vat, error: vatError, isLoading: vatLoading } = useSWR<VatReport>(
    tab === 'vat' ? `/finance/reports/vat${range}` : null,
    fetcher,
  );
  const { data: aging, error: agingError, isLoading: agingLoading } = useSWR<AgingReport>(
    tab === 'aging' ? '/finance/reports/aging' : null,
    fetcher,
  );
  const { data: cashier, error: cashierError, isLoading: cashierLoading } = useSWR<CashierReport>(
    tab === 'cashier' ? `/finance/reports/cashier${range}` : null,
    fetcher,
  );

  const error = plError ?? vatError ?? agingError ?? cashierError;

  return (
    <div>
      <PageHeader
        title="التقارير المالية"
        subtitle="الأرباح والخسائر، ضريبة القيمة المضافة، أعمار الديون، وأداء الكاشير"
        actions={
          <button type="button" className="btn-secondary" onClick={() => window.print()}>
            <Printer size={15} /> طباعة
          </button>
        }
      />

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-3 py-2">
          {[
            ['pl', 'الأرباح والخسائر'],
            ['vat', 'ضريبة القيمة المضافة'],
            ['aging', 'أعمار الديون'],
            ['cashier', 'الكاشير'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value as typeof tab)}
              className={`btn px-3 py-1.5 text-xs ${tab === value ? 'bg-brand-700 text-white' : 'text-ink-600 hover:bg-ink-100'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {tab !== 'aging' ? (
          <div className="flex flex-wrap items-end gap-3 p-4">
            <label className="block">
              <span className="label">من تاريخ</span>
              <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="block">
              <span className="label">إلى تاريخ</span>
              <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            <p className="pb-2 text-xs text-ink-400">الفترة الافتراضية: من أول الشهر حتى اليوم</p>
          </div>
        ) : null}
      </Card>

      {error ? <Card className="mb-4 border-red-200 bg-red-50 p-4 text-sm text-red-700">{errorMessage(error)}</Card> : null}

      <div id="print-area">
        {tab === 'pl' ? (
          plLoading ? (
            <Card><LoadingBlock rows={7} /></Card>
          ) : pl ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard label="صافي الإيراد" value={formatMoney(pl.netRevenueEgp)} hint={`تحصيل ${formatMoney(pl.revenueEgp)} — استرداد ${formatMoney(pl.refundsEgp)}`} icon={<Wallet size={18} />} tone="info" />
                <StatCard label="تكلفة القطع المستهلكة" value={formatMoney(pl.cogsEgp)} hint={`${formatNumber(pl.partsConsumedUnits)} وحدة`} icon={<BarChart3 size={18} />} />
                <StatCard label="الربح الإجمالي" value={formatMoney(pl.grossProfitEgp)} hint={`هامش ${formatPercent(pl.grossMarginPct)}`} icon={<Scale size={18} />} tone="success" />
                <StatCard label="صافي الربح" value={formatMoney(pl.netProfitEgp)} hint={`المصروفات ${formatMoney(pl.expensesEgp)} — هامش ${formatPercent(pl.netMarginPct)}`} icon={<ReceiptText size={18} />} tone={pl.netProfitEgp >= 0 ? 'success' : 'danger'} />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <div className="border-b border-ink-100 px-4 py-3">
                    <h2 className="text-sm font-bold text-ink-800">الإيراد حسب طريقة الدفع</h2>
                  </div>
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>الطريقة</th>
                          <th>عدد الحركات</th>
                          <th>الإجمالي</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pl.revenueByMethod.length ? (
                          pl.revenueByMethod.map((row) => (
                            <tr key={row.method}>
                              <td className="text-xs">{PAYMENT_METHOD_LABELS[row.method as keyof typeof PAYMENT_METHOD_LABELS] ?? row.method}</td>
                              <td className="num text-xs">{formatNumber(row.count)}</td>
                              <td className="num text-xs font-semibold">{formatMoney(row.totalEgp)}</td>
                            </tr>
                          ))
                        ) : (
                          <tr><td colSpan={3}><EmptyState title="لا توجد تحصيلات" /></td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </Card>

                <Card>
                  <div className="border-b border-ink-100 px-4 py-3">
                    <h2 className="text-sm font-bold text-ink-800">المصروفات حسب التصنيف</h2>
                  </div>
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>التصنيف</th>
                          <th>العدد</th>
                          <th>الإجمالي</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pl.expensesByCategory.length ? (
                          pl.expensesByCategory.map((row) => (
                            <tr key={row.category}>
                              <td className="text-xs">{EXPENSE_LABELS[row.category] ?? row.category}</td>
                              <td className="num text-xs">{formatNumber(row.count)}</td>
                              <td className="num text-xs font-semibold">{formatMoney(row.totalEgp)}</td>
                            </tr>
                          ))
                        ) : (
                          <tr><td colSpan={3}><EmptyState title="لا توجد مصروفات" /></td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>
            </div>
          ) : null
        ) : null}

        {tab === 'vat' ? (
          vatLoading ? (
            <Card><LoadingBlock rows={6} /></Card>
          ) : vat ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <StatCard label="ضريبة المخرجات (مبيعات)" value={formatMoney(vat.output.taxEgp)} hint={`${formatNumber(vat.output.invoicesCount)} فاتورة — صافي ${formatMoney(vat.output.salesNetEgp)}`} tone="info" />
                <StatCard label="ضريبة المدخلات (مشتريات)" value={formatMoney(vat.input.taxEgp)} hint={`${formatNumber(vat.input.purchaseOrdersCount)} أمر شراء — صافي ${formatMoney(vat.input.purchasesNetEgp)}`} tone="success" />
                <StatCard label={vat.netTaxDueEgp >= 0 ? 'الصافي المستحق للمصلحة' : 'رصيد ضريبة لصالحك'} value={formatMoney(Math.abs(vat.netTaxDueEgp))} tone={vat.netTaxDueEgp > 0 ? 'warning' : 'success'} />
              </div>
              <Card>
                <div className="border-b border-ink-100 px-4 py-3">
                  <h2 className="text-sm font-bold text-ink-800">تفاصيل ضريبة المدخلات</h2>
                  <p className="mt-0.5 text-xs text-ink-500">محسوبة من أوامر الشراء المستلمة داخل الفترة</p>
                </div>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>أمر الشراء</th>
                        <th>التاريخ</th>
                        <th>الصافي</th>
                        <th>الضريبة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vat.input.details.length ? (
                        vat.input.details.map((row) => (
                          <tr key={row.poNumber}>
                            <td className="text-xs font-semibold" dir="ltr">{row.poNumber}</td>
                            <td className="text-xs">{formatDate(row.date)}</td>
                            <td className="num text-xs">{formatMoney(row.netEgp)}</td>
                            <td className="num text-xs">{formatMoney(row.taxEgp)}</td>
                          </tr>
                        ))
                      ) : (
                        <tr><td colSpan={4}><EmptyState title="لا توجد مشتريات مستلمة في الفترة" /></td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          ) : null
        ) : null}

        {tab === 'aging' ? (
          agingLoading ? (
            <Card><LoadingBlock rows={6} /></Card>
          ) : aging ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
                {aging.buckets.map((bucket) => (
                  <StatCard
                    key={bucket.key}
                    label={bucket.label}
                    value={formatMoney(bucket.totalEgp)}
                    hint={`${formatNumber(bucket.count)} فاتورة`}
                    tone={bucket.key === 'd90_plus' ? 'danger' : bucket.key === 'current' ? 'success' : 'warning'}
                  />
                ))}
              </div>

              <Card>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-4 py-3">
                  <div>
                    <h2 className="text-sm font-bold text-ink-800">الفواتير غير المسددة</h2>
                    <p className="mt-0.5 text-xs text-ink-500">
                      إجمالي المستحق {formatMoney(aging.totalDueEgp)} على {formatNumber(aging.invoicesCount)} فاتورة
                    </p>
                  </div>
                </div>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>الفاتورة</th>
                        <th>العميل</th>
                        <th>تاريخ الإصدار</th>
                        <th>تاريخ الاستحقاق</th>
                        <th>التأخر</th>
                        <th>الإجمالي</th>
                        <th>المتبقي</th>
                      </tr>
                    </thead>
                    <tbody>
                      {aging.items.length ? (
                        aging.items.map((row) => (
                          <tr key={row.invoiceId}>
                            <td className="text-xs font-semibold" dir="ltr">{row.invoiceNumber}</td>
                            <td className="text-xs">
                              <p className="font-medium text-ink-800">{row.customerName}</p>
                              <p className="text-ink-400" dir="ltr">{row.customerPhone}</p>
                            </td>
                            <td className="text-xs">{formatDate(row.issueDate)}</td>
                            <td className="text-xs">{formatDate(row.dueDate)}</td>
                            <td className="text-xs">
                              <Badge
                                className={
                                  row.daysOverdue > 90
                                    ? 'border-red-200 bg-red-50 text-red-700'
                                    : row.daysOverdue > 30
                                      ? 'border-amber-200 bg-amber-50 text-amber-800'
                                      : 'border-ink-200 bg-ink-50 text-ink-600'
                                }
                              >
                                {row.daysOverdue > 0 ? `${formatNumber(row.daysOverdue)} يوم` : 'غير مستحقة'}
                              </Badge>
                            </td>
                            <td className="num text-xs">{formatMoney(row.totalEgp)}</td>
                            <td className="num text-xs font-bold text-red-700">{formatMoney(row.dueEgp)}</td>
                          </tr>
                        ))
                      ) : (
                        <tr><td colSpan={7}><EmptyState title="لا توجد فواتير غير مسددة" /></td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          ) : null
        ) : null}

        {tab === 'cashier' ? (
          cashierLoading ? (
            <Card><LoadingBlock rows={5} /></Card>
          ) : cashier ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <StatCard label="إجمالي التحصيل" value={formatMoney(cashier.totalCollectionsEgp)} tone="success" />
                <StatCard label="إجمالي الاسترداد" value={formatMoney(cashier.totalRefundsEgp)} tone="danger" />
              </div>
              <Card>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>الموظف</th>
                        <th>الدور</th>
                        <th>التحصيل</th>
                        <th>الاسترداد</th>
                        <th>عدد الحركات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cashier.items.length ? (
                        cashier.items.map((row) => (
                          <tr key={row.userId}>
                            <td className="text-xs">
                              <p className="font-medium text-ink-800">{row.fullName}</p>
                              <p className="text-ink-400" dir="ltr">@{row.username}</p>
                            </td>
                            <td className="text-xs">{ROLE_LABELS[row.role] ?? row.role}</td>
                            <td className="num text-xs font-semibold text-emerald-700">{formatMoney(row.collectionsEgp)}</td>
                            <td className="num text-xs text-red-600">{formatMoney(row.refundsEgp)}</td>
                            <td className="num text-xs">{formatNumber(row.transactions)}</td>
                          </tr>
                        ))
                      ) : (
                        <tr><td colSpan={5}><EmptyState title="لا توجد حركات في الفترة" /></td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          ) : null
        ) : null}
      </div>
    </div>
  );
}
