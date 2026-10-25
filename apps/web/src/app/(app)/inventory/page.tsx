'use client';

import { useEffect, useState } from 'react';
import useSWR, { mutate as globalMutate } from 'swr';
import {
  AlertTriangle,
  ArrowLeftRight,
  ClipboardList,
  History,
  Layers,
  Package,
  Plus,
  Search,
  Send,
  TrendingDown,
} from 'lucide-react';
import { api, errorMessage, fetcher, qs } from '@/lib/api';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { PART_CATEGORY_LABELS, PART_GRADE_LABELS } from '@/lib/constants';
import { Badge, Card, EmptyState, Field, LoadingBlock, PageHeader, StatCard } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/lib/auth';

interface PartRow {
  _id: string;
  sku: string;
  name: string;
  category: string;
  grade: string;
  brand?: string;
  pricing: { costEgp: number; sellingPriceEgp: number };
  stock: { onHand: number; reserved: number; defective: number; incoming: number; reorderLevel: number; reorderQty: number };
  warranty?: { days?: number };
  availableQty?: number;
  isLowStock?: boolean;
  defaultSupplierId?: { _id: string; name: string } | null;
  quality?: { unitsSold?: number; unitsFailed?: number; failureRatePct?: number };
}

interface ConsumptionRow {
  partId: string;
  name: string;
  sku: string;
  unitsUsed: number;
  revenueEgp: number;
  costEgp: number;
  marginEgp: number;
  failures: number;
  failureRatePct: number;
}

interface ValuationData {
  totals: {
    branches: number;
    parts: number;
    onHand: number;
    defective: number;
    valueEgp: number;
    sellValueEgp: number;
    potentialMarginEgp: number;
  };
  byBranch: {
    branchId: string;
    branchName: string;
    branchCode: string;
    parts: number;
    onHand: number;
    reserved: number;
    defective: number;
    valueEgp: number;
    sellValueEgp: number;
  }[];
  lowStock: {
    partId: string;
    name: string;
    sku: string;
    branchName: string;
    onHand: number;
    reserved: number;
    available: number;
    reorderLevel: number;
  }[];
}

interface MovementRow {
  _id: string;
  type: string;
  quantity: number;
  unitCostEgp?: number;
  totalCostEgp?: number;
  reason?: string;
  reference?: string;
  occurredAt: string;
  branchId?: { name?: string; code?: string } | string;
  partId?: { name?: string; sku?: string } | string;
  actorName?: string;
  actorId?: { fullName?: string } | string;
  balanceAfter?: { onHand?: number };
}

interface TransferRow {
  _id: string;
  transferNumber: string;
  status: string;
  createdAt: string;
  reason?: string;
  fromBranchId?: { _id?: string; name?: string; code?: string } | string;
  toBranchId?: { _id?: string; name?: string; code?: string } | string;
  lines: {
    partId?: { name?: string; sku?: string } | string;
    quantityRequested: number;
    quantitySent: number;
    quantityReceived: number;
  }[];
}

interface StockCountRow {
  _id: string;
  countNumber: string;
  status: string;
  countedAt: string;
  branchId?: { name?: string; code?: string } | string;
  countedBy?: { fullName?: string } | string;
  totals: { itemsCounted: number; discrepancies: number; netDifferenceEgp: number };
  lines: {
    partId?: { name?: string; sku?: string } | string;
    snapshotOnHand: number;
    countedOnHand: number;
    difference: number;
    differenceValueEgp: number;
  }[];
}

interface InStockRow {
  partId: { _id: string; name: string; sku: string } | string;
  quantity: { onHand: number; reserved: number; defective: number; incoming: number };
  available: number;
}

const MOVEMENT_LABELS: Record<string, string> = {
  purchase_in: 'توريد مشتريات',
  purchase_order: 'وارد متوقع',
  purchase_cancel: 'إلغاء توريد',
  sale_out: 'بيع مباشر',
  repair_consume: 'استهلاك إصلاح',
  repair_return: 'مرتجع إصلاح',
  adjustment_in: 'تسوية بالزيادة',
  adjustment_out: 'تسوية بالنقص',
  defective_in: 'إدخال تالف',
  defective_out: 'إخراج تالف',
  reserve: 'حجز',
  release: 'فك حجز',
  transfer_out: 'تحويل صادر',
  transfer_in: 'تحويل وارد',
  initial: 'رصيد افتتاحي',
};

const TRANSFER_STATUS_LABELS: Record<string, string> = {
  draft: 'مسودة',
  requested: 'مطلوب',
  approved: 'معتمد',
  in_transit: 'في الطريق',
  received: 'مستلم',
  cancelled: 'ملغي',
};

function branchIdOf(branch?: { _id?: string; name?: string; code?: string } | string): string | null {
  return typeof branch === 'string' ? branch : (branch?._id ?? null);
}

function branchName(branch?: { name?: string; code?: string } | string): string {
  if (!branch) return '—';
  return typeof branch === 'string' ? branch : branch.name ?? branch.code ?? '—';
}

function partName(part?: { name?: string; sku?: string } | string): { name: string; sku: string } {
  if (!part) return { name: '—', sku: '' };
  if (typeof part === 'string') return { name: part, sku: '' };
  return { name: part.name ?? '—', sku: part.sku ?? '' };
}

type InventoryTab = 'parts' | 'lowStock' | 'consumption' | 'valuation' | 'movements' | 'transfers' | 'counts';

export default function InventoryPage() {
  const toast = useToast();
  const { hasPermission, availableBranches, activeBranchId } = useAuth();
  const [tab, setTab] = useState<InventoryTab>('parts');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [movementPart, setMovementPart] = useState<PartRow | null>(null);
  const [movementType, setMovementType] = useState('');
  const [transferOpen, setTransferOpen] = useState(false);
  const [countOpen, setCountOpen] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('tab') === 'lowStock') setTab('lowStock');
  }, []);

  const partsKey = `/parts${qs({
    q: search || undefined,
    category: categoryFilter || undefined,
    page,
    limit: 25,
  })}`;

  const { data: parts, error: partsError, isLoading: partsLoading } = useSWR<{
    items: PartRow[];
    meta: { total: number; page: number; pages: number };
  }>(partsKey, fetcher);

  const { data: lowStock } = useSWR<{ count: number; parts: PartRow[] }>('/parts/low-stock', fetcher);

  const { data: consumption } = useSWR<ConsumptionRow[]>(
    tab === 'consumption' && hasPermission('report:read') ? '/parts/consumption-report' : null,
    fetcher,
  );

  const { data: stockSummary } = useSWR<{
    totals: { onHand: number; reserved: number; defective: number; incoming: number };
  }>('/inventory/stock', fetcher);

  const { data: valuation, isLoading: valuationLoading } = useSWR<ValuationData>(
    hasPermission('report:read') ? '/inventory/valuation' : null,
    fetcher,
  );

  const movementsKey = `/inventory/movements${qs({ type: movementType || undefined, limit: 40 })}`;
  const { data: movements, isLoading: movementsLoading } = useSWR<{
    items: MovementRow[];
    meta: { total: number };
  }>(tab === 'movements' ? movementsKey : null, fetcher);

  const { data: transfers, isLoading: transfersLoading } = useSWR<{
    items: TransferRow[];
    meta: { total: number };
  }>(tab === 'transfers' ? '/inventory/transfers?limit=40' : null, fetcher);

  const { data: counts, isLoading: countsLoading } = useSWR<{
    items: StockCountRow[];
    meta: { total: number };
  }>(tab === 'counts' ? '/inventory/counts?limit=40' : null, fetcher);

  const rows = tab === 'parts' ? (parts?.items ?? []) : tab === 'lowStock' ? (lowStock?.parts ?? []) : [];

  const inventoryValue = rows.reduce((acc, part) => acc + (part.stock?.onHand ?? 0) * (part.pricing?.costEgp ?? 0), 0);

  return (
    <div>
      <PageHeader
        title="قطع الغيار والمخزون"
        subtitle="الرصيد، الحد الأدنى، جودة القطع، وتقييم الاستهلاك"
        actions={
          hasPermission('part:manage') ? (
            <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
              <Plus size={16} /> قطعة جديدة
            </button>
          ) : null
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="إجمالي القطع في الكتالوج"
          value={formatNumber(parts?.meta.total ?? 0)}
          icon={<Package size={18} />}
          tone="info"
        />
        <StatCard
          label="إجمالي الكميات الموجودة"
          value={formatNumber(stockSummary?.totals.onHand ?? 0)}
          hint={`محجوز: ${formatNumber(stockSummary?.totals.reserved ?? 0)}`}
          icon={<Package size={18} />}
        />
        <StatCard
          label="قطع تحت حد إعادة الطلب"
          value={formatNumber(lowStock?.count ?? 0)}
          hint="تحتاج أمر شراء"
          icon={<TrendingDown size={18} />}
          tone={(lowStock?.count ?? 0) > 0 ? 'warning' : 'success'}
        />
        <StatCard
          label="قيمة المخزون (بالتكلفة)"
          value={formatMoney(valuation?.totals.valueEgp ?? inventoryValue)}
          hint={`قطعة معيبة: ${formatNumber(stockSummary?.totals.defective ?? 0)}`}
          icon={<AlertTriangle size={18} />}
        />
      </div>

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-3 py-2">
          {[
            ['parts', 'كتالوج القطع'],
            ['lowStock', 'نواقص المخزون'],
            ['consumption', 'تقييم الاستهلاك'],
            ['valuation', 'تقييم المخزون'],
            ['movements', 'حركات المخزون'],
            ['transfers', 'التحويلات'],
            ['counts', 'الجرد'],
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

        {tab === 'parts' ? (
          <div className="grid gap-3 p-4 sm:grid-cols-3">
            <div className="relative sm:col-span-2">
              <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400" />
              <input
                className="input pr-9"
                placeholder="ابحث بالاسم أو الكود أو الباركود…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <select className="input" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">كل التصنيفات</option>
              {Object.entries(PART_CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </Card>

      {partsError ? <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">{errorMessage(partsError)}</Card> : null}

      <Card>
        {partsLoading && tab === 'parts' ? (
          <LoadingBlock rows={7} />
        ) : tab === 'consumption' ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>القطعة</th>
                  <th>الوحدات المستخدمة</th>
                  <th>الإيراد</th>
                  <th>التكلفة</th>
                  <th>الهامش</th>
                  <th>مرات الفشل</th>
                  <th>معدل الفشل</th>
                </tr>
              </thead>
              <tbody>
                {consumption?.length ? (
                  consumption.map((row) => (
                    <tr key={row.partId}>
                      <td className="text-xs">
                        <p className="font-medium text-ink-800">{row.name}</p>
                        <p className="text-ink-400" dir="ltr">
                          {row.sku}
                        </p>
                      </td>
                      <td className="num text-xs">{row.unitsUsed}</td>
                      <td className="num text-xs">{formatMoney(row.revenueEgp)}</td>
                      <td className="num text-xs">{formatMoney(row.costEgp)}</td>
                      <td className="num text-xs font-bold text-emerald-700">{formatMoney(row.marginEgp)}</td>
                      <td className="num text-xs">{row.failures}</td>
                      <td>
                        <span
                          className={`badge border ${
                            row.failureRatePct > 8
                              ? 'border-red-200 bg-red-50 text-red-700'
                              : row.failureRatePct > 3
                                ? 'border-amber-200 bg-amber-50 text-amber-800'
                                : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          }`}
                        >
                          {row.failureRatePct}%
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7}>
                      <EmptyState title="لا توجد بيانات استهلاك" icon={<Package size={20} />} />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : tab === 'valuation' ? (
          valuationLoading ? (
            <LoadingBlock rows={7} />
          ) : valuation ? (
            <div className="space-y-5 p-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border border-ink-100 bg-ink-50 p-3">
                  <p className="text-xs text-ink-500">قيمة المخزون بالتكلفة</p>
                  <p className="num mt-1 text-lg font-bold text-ink-900">{formatMoney(valuation.totals.valueEgp)}</p>
                  <p className="mt-0.5 text-[11px] text-ink-400">{formatNumber(valuation.totals.onHand)} وحدة في {formatNumber(valuation.totals.branches)} فرع</p>
                </div>
                <div className="rounded-xl border border-ink-100 bg-ink-50 p-3">
                  <p className="text-xs text-ink-500">قيمة البيع المتوقعة</p>
                  <p className="num mt-1 text-lg font-bold text-brand-800">{formatMoney(valuation.totals.sellValueEgp)}</p>
                </div>
                <div className="rounded-xl border border-ink-100 bg-ink-50 p-3">
                  <p className="text-xs text-ink-500">هامش الربح المحتمل</p>
                  <p className="num mt-1 text-lg font-bold text-emerald-700">{formatMoney(valuation.totals.potentialMarginEgp)}</p>
                </div>
                <div className="rounded-xl border border-ink-100 bg-ink-50 p-3">
                  <p className="text-xs text-ink-500">قطع تالفة</p>
                  <p className="num mt-1 text-lg font-bold text-red-700">{formatNumber(valuation.totals.defective)}</p>
                </div>
              </div>

              <div>
                <p className="mb-2 text-sm font-bold text-ink-800">التقييم حسب الفرع</p>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>الفرع</th>
                        <th>عدد الأصناف</th>
                        <th>الموجود</th>
                        <th>المحجوز</th>
                        <th>التالف</th>
                        <th>قيمة التكلفة</th>
                        <th>قيمة البيع</th>
                      </tr>
                    </thead>
                    <tbody>
                      {valuation.byBranch.map((row) => (
                        <tr key={row.branchId}>
                          <td className="text-xs font-medium">{row.branchName}</td>
                          <td className="num text-xs">{formatNumber(row.parts)}</td>
                          <td className="num text-xs">{formatNumber(row.onHand)}</td>
                          <td className="num text-xs">{formatNumber(row.reserved)}</td>
                          <td className="num text-xs text-red-600">{formatNumber(row.defective)}</td>
                          <td className="num text-xs font-semibold">{formatMoney(row.valueEgp)}</td>
                          <td className="num text-xs text-emerald-700">{formatMoney(row.sellValueEgp)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <p className="mb-2 text-sm font-bold text-ink-800">قطع تحت حد إعادة الطلب</p>
                {valuation.lowStock.length ? (
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>القطعة</th>
                          <th>الفرع</th>
                          <th>الموجود</th>
                          <th>المحجوز</th>
                          <th>المتاح</th>
                          <th>حد الطلب</th>
                        </tr>
                      </thead>
                      <tbody>
                        {valuation.lowStock.map((row) => (
                          <tr key={`${row.partId}-${row.branchName}`}>
                            <td className="text-xs">
                              <p className="font-medium text-ink-800">{row.name}</p>
                              <p className="text-ink-400" dir="ltr">{row.sku}</p>
                            </td>
                            <td className="text-xs">{row.branchName}</td>
                            <td className="num text-xs">{formatNumber(row.onHand)}</td>
                            <td className="num text-xs">{formatNumber(row.reserved)}</td>
                            <td className="num text-xs font-bold text-amber-700">{formatNumber(row.available)}</td>
                            <td className="num text-xs">{formatNumber(row.reorderLevel)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="rounded-lg border border-ink-100 p-3 text-xs text-ink-500">كل الأصناف فوق حد إعادة الطلب.</p>
                )}
              </div>
            </div>
          ) : null
        ) : tab === 'movements' ? (
          <div>
            <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-3 py-2">
              <select className="input h-9 w-auto min-w-44 py-1 text-xs" value={movementType} onChange={(e) => setMovementType(e.target.value)}>
                <option value="">كل أنواع الحركة</option>
                {Object.entries(MOVEMENT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <span className="text-[11px] text-ink-400">آخر {formatNumber(movements?.meta.total ?? 0)} حركة</span>
            </div>
            {movementsLoading ? (
              <LoadingBlock rows={7} />
            ) : movements?.items.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>التاريخ</th>
                      <th>القطعة</th>
                      <th>الحركة</th>
                      <th>الكمية</th>
                      <th>الرصيد بعدها</th>
                      <th>الفرع</th>
                      <th>بواسطة</th>
                      <th>السبب</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.items.map((row) => {
                      const part = partName(row.partId);
                      return (
                        <tr key={row._id}>
                          <td className="whitespace-nowrap text-xs">{formatDate(row.occurredAt)}</td>
                          <td className="text-xs">
                            <p className="font-medium text-ink-800">{part.name}</p>
                            <p className="text-ink-400" dir="ltr">{part.sku}</p>
                          </td>
                          <td className="text-xs">
                            <Badge className="border-ink-200 bg-ink-50 text-ink-700">{MOVEMENT_LABELS[row.type] ?? row.type}</Badge>
                          </td>
                          <td className={`num text-xs font-bold ${row.quantity < 0 ? 'text-red-600' : 'text-emerald-700'}`} dir="ltr">
                            {row.quantity > 0 ? '+' : ''}
                            {formatNumber(row.quantity)}
                          </td>
                          <td className="num text-xs">{row.balanceAfter?.onHand ?? '—'}</td>
                          <td className="text-xs">{branchName(row.branchId)}</td>
                          <td className="text-xs">{row.actorName || (typeof row.actorId === 'object' ? row.actorId?.fullName : '') || '—'}</td>
                          <td className="max-w-xs text-xs text-ink-500">{row.reason || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="لا توجد حركات مخزون" icon={<History size={20} />} />
            )}
          </div>
        ) : tab === 'transfers' ? (
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-3 py-2">
              <p className="text-xs text-ink-500">
                <ArrowLeftRight size={14} className="ml-1 inline" /> نقل المخزون بين الفروع مع خصم وإضافة ذرّية وحركة مسجلة
              </p>
              {hasPermission('stock:move') ? (
                <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setTransferOpen(true)}>
                  <Plus size={14} /> تحويل جديد
                </button>
              ) : null}
            </div>
            {transfersLoading ? (
              <LoadingBlock rows={6} />
            ) : transfers?.items.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>رقم التحويل</th>
                      <th>من فرع</th>
                      <th>إلى فرع</th>
                      <th>الأصناف</th>
                      <th>الحالة</th>
                      <th>التاريخ</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {transfers.items.map((transfer) => {
                      const canSend = !activeBranchId || branchIdOf(transfer.fromBranchId) === activeBranchId;
                      const canReceive = !activeBranchId || branchIdOf(transfer.toBranchId) === activeBranchId;
                      return (
                      <tr key={transfer._id}>
                        <td className="text-xs font-bold" dir="ltr">{transfer.transferNumber}</td>
                        <td className="text-xs">{branchName(transfer.fromBranchId)}</td>
                        <td className="text-xs">{branchName(transfer.toBranchId)}</td>
                        <td className="num text-xs">{formatNumber(transfer.lines.length)}</td>
                        <td>
                          <Badge className="border-ink-200 bg-ink-50 text-ink-700">
                            {TRANSFER_STATUS_LABELS[transfer.status] ?? transfer.status}
                          </Badge>
                        </td>
                        <td className="text-xs">{formatDate(transfer.createdAt)}</td>
                        <td>
                          <div className="flex gap-1">
                            {canSend && ['requested', 'approved'].includes(transfer.status) ? (
                              <button
                                type="button"
                                className="btn-ghost px-2 py-1 text-[11px]"
                                onClick={async () => {
                                  try {
                                    await api.post(`/inventory/transfers/${transfer._id}/send`);
                                    toast.success('تم إرسال التحويل وخصم الكميات من الفرع المصدر');
                                    await globalMutate('/inventory/transfers?limit=40');
                                    await globalMutate('/inventory/stock');
                                  } catch (error) {
                                    toast.error(errorMessage(error));
                                  }
                                }}
                              >
                                <Send size={13} /> إرسال
                              </button>
                            ) : null}
                            {canReceive && transfer.status === 'in_transit' ? (
                              <button
                                type="button"
                                className="btn-secondary px-2 py-1 text-[11px]"
                                onClick={async () => {
                                  try {
                                    await api.post(`/inventory/transfers/${transfer._id}/receive`);
                                    toast.success('تم استلام التحويل وإضافته لمخزون الفرع');
                                    await globalMutate('/inventory/transfers?limit=40');
                                    await globalMutate('/inventory/stock');
                                  } catch (error) {
                                    toast.error(errorMessage(error));
                                  }
                                }}
                              >
                                استلام
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="لا توجد تحويلات بين الفروع" icon={<ArrowLeftRight size={20} />} />
            )}
          </div>
        ) : tab === 'counts' ? (
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-3 py-2">
              <p className="text-xs text-ink-500">
                <ClipboardList size={14} className="ml-1 inline" /> الجرد يثبّت الفروق كحركات تسوية فورية ويحفظ صورة الرصيد
              </p>
              {hasPermission('stock:move') ? (
                <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setCountOpen(true)}>
                  <Plus size={14} /> جرد جديد
                </button>
              ) : null}
            </div>
            {countsLoading ? (
              <LoadingBlock rows={6} />
            ) : counts?.items.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>رقم الجرد</th>
                      <th>الفرع</th>
                      <th>التاريخ</th>
                      <th>عدد الأصناف</th>
                      <th>فروق</th>
                      <th>صافي الفرق</th>
                      <th>بواسطة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {counts.items.map((count) => (
                      <tr key={count._id}>
                        <td className="text-xs font-bold" dir="ltr">{count.countNumber}</td>
                        <td className="text-xs">{branchName(count.branchId)}</td>
                        <td className="text-xs">{formatDate(count.countedAt)}</td>
                        <td className="num text-xs">{formatNumber(count.totals.itemsCounted)}</td>
                        <td className="num text-xs">
                          <span className={count.totals.discrepancies ? 'font-bold text-amber-700' : 'text-ink-500'}>
                            {formatNumber(count.totals.discrepancies)}
                          </span>
                        </td>
                        <td className={`num text-xs font-bold ${count.totals.netDifferenceEgp < 0 ? 'text-red-600' : count.totals.netDifferenceEgp > 0 ? 'text-emerald-700' : 'text-ink-500'}`}>
                          {formatMoney(count.totals.netDifferenceEgp)}
                        </td>
                        <td className="text-xs">
                          {typeof count.countedBy === 'object' ? count.countedBy?.fullName : count.countedBy}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="لا توجد عمليات جرد" icon={<ClipboardList size={20} />} />
            )}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>القطعة</th>
                  <th>التصنيف</th>
                  <th>الدرجة</th>
                  <th>التكلفة</th>
                  <th>سعر البيع</th>
                  <th>الموجود</th>
                  <th>متاح</th>
                  <th>الحد الأدنى</th>
                  <th>معدل الفشل</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.length ? (
                  rows.map((part) => (
                    <tr key={part._id}>
                      <td className="text-xs">
                        <p className="font-medium text-ink-800">{part.name}</p>
                        <p className="text-ink-400" dir="ltr">
                          {part.sku}
                        </p>
                      </td>
                      <td className="text-xs">{PART_CATEGORY_LABELS[part.category] ?? part.category}</td>
                      <td className="text-xs">{PART_GRADE_LABELS[part.grade] ?? part.grade}</td>
                      <td className="num text-xs">{formatMoney(part.pricing?.costEgp ?? 0, false)}</td>
                      <td className="num text-xs font-medium">{formatMoney(part.pricing?.sellingPriceEgp ?? 0, false)}</td>
                      <td className="num text-xs">{part.stock?.onHand ?? 0}</td>
                      <td className="num text-xs font-bold">
                        {part.availableQty ?? Math.max(0, (part.stock?.onHand ?? 0) - (part.stock?.reserved ?? 0))}
                      </td>
                      <td className="num text-xs text-ink-500">{part.stock?.reorderLevel ?? 0}</td>
                      <td className="text-xs">
                        {part.quality?.failureRatePct ? (
                          <span className={part.quality.failureRatePct > 8 ? 'text-red-600' : 'text-ink-600'}>
                            {part.quality.failureRatePct}%
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        {hasPermission('stock:move') ? (
                          <button type="button" className="btn-ghost text-xs" onClick={() => setMovementPart(part)}>
                            حركة مخزون
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={10}>
                      <EmptyState
                        title={tab === 'lowStock' ? 'لا توجد نواقص' : 'لا توجد قطع'}
                        description={tab === 'lowStock' ? 'كل القطع فوق حد إعادة الطلب' : undefined}
                        icon={<Package size={20} />}
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'parts' && parts && parts.meta.pages > 1 ? (
          <div className="flex items-center justify-between border-t border-ink-100 px-4 py-3 text-xs text-ink-600">
            <span>
              صفحة {parts.meta.page} من {parts.meta.pages}
            </span>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary text-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                السابق
              </button>
              <button
                type="button"
                className="btn-secondary text-xs"
                disabled={page >= parts.meta.pages}
                onClick={() => setPage((p) => p + 1)}
              >
                التالي
              </button>
            </div>
          </div>
        ) : null}
      </Card>

      <CreatePartModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={async () => {
          setCreateOpen(false);
          toast.success('تمت إضافة القطعة');
          await Promise.all([import('swr').then((m) => m.mutate(partsKey)), import('swr').then((m) => m.mutate('/parts/low-stock'))]);
        }}
        onError={(message) => toast.error(message)}
      />

      <StockMovementModal
        part={movementPart}
        onClose={() => setMovementPart(null)}
        onDone={async () => {
          setMovementPart(null);
          const { mutate } = await import('swr');
          await Promise.all([mutate(partsKey), mutate('/parts/low-stock'), mutate('/inventory/stock')]);
          toast.success('تم تسجيل حركة المخزون');
        }}
        onError={(message) => toast.error(message)}
      />

      <TransferModal
        open={transferOpen}
        branches={availableBranches}
        defaultFrom={activeBranchId ?? availableBranches[0]?.id ?? ''}
        onClose={() => setTransferOpen(false)}
        onDone={async () => {
          setTransferOpen(false);
          await Promise.all([globalMutate('/inventory/transfers?limit=40'), globalMutate('/inventory/stock')]);
          toast.success('تم إنشاء طلب التحويل — أرسله لخصم الكميات من الفرع المصدر');
        }}
        onError={(message) => toast.error(message)}
      />

      <StockCountModal
        open={countOpen}
        branches={availableBranches}
        defaultBranch={activeBranchId ?? availableBranches[0]?.id ?? ''}
        onClose={() => setCountOpen(false)}
        onDone={async () => {
          setCountOpen(false);
          await Promise.all([globalMutate('/inventory/counts?limit=40'), globalMutate('/inventory/stock'), globalMutate('/parts/low-stock')]);
          toast.success('تم حفظ الجرد وتطبيق فروقه على المخزون');
        }}
        onError={(message) => toast.error(message)}
      />
    </div>
  );
}

function CreatePartModal({
  open,
  onClose,
  onCreated,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState({
    sku: '',
    name: '',
    category: 'screen',
    grade: 'aftermarket_a',
    brand: '',
    costEgp: '',
    sellingPriceEgp: '',
    openingStock: '0',
    reorderLevel: '3',
    warrantyDays: '90',
    deviceModels: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async () => {
    if (!form.sku.trim() || !form.name.trim()) {
      onError('الكود والاسم مطلوبان');
      return;
    }
    setIsSubmitting(true);
    try {
      await api.post('/parts', {
        sku: form.sku,
        name: form.name,
        category: form.category,
        grade: form.grade,
        brand: form.brand,
        pricing: {
          costEgp: Number(form.costEgp) || 0,
          sellingPriceEgp: Number(form.sellingPriceEgp) || 0,
        },
        stock: { reorderLevel: Number(form.reorderLevel) || 3 },
        warranty: { days: Number(form.warrantyDays) || 0 },
        compatibility: {
          deviceModels: form.deviceModels
            .split(',')
            .map((m) => m.trim())
            .filter(Boolean),
          deviceBrands: form.brand ? [form.brand] : [],
        },
        openingStock: Number(form.openingStock) || 0,
      });
      await onCreated();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="إضافة قطعة جديدة"
      subtitle="كتالوج القطع + رصيد افتتاحي اختياري"
      size="lg"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            إلغاء
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={isSubmitting}>
            {isSubmitting ? 'جارٍ الحفظ…' : 'حفظ القطعة'}
          </button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="كود القطعة (SKU)" required>
          <input className="input" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} dir="ltr" />
        </Field>
        <Field label="اسم القطعة" required>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="التصنيف">
          <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {Object.entries(PART_CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="الدرجة">
          <select className="input" value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })}>
            {Object.entries(PART_GRADE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="الماركة">
          <input className="input" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
        </Field>
        <Field label="الموديلات المتوافقة (مفصولة بفاصلة)">
          <input
            className="input"
            value={form.deviceModels}
            onChange={(e) => setForm({ ...form, deviceModels: e.target.value })}
            placeholder="Galaxy A15, Galaxy A55"
          />
        </Field>
        <Field label="سعر التكلفة">
          <input
            className="input"
            type="number"
            min={0}
            value={form.costEgp}
            onChange={(e) => setForm({ ...form, costEgp: e.target.value })}
          />
        </Field>
        <Field label="سعر البيع">
          <input
            className="input"
            type="number"
            min={0}
            value={form.sellingPriceEgp}
            onChange={(e) => setForm({ ...form, sellingPriceEgp: e.target.value })}
          />
        </Field>
        <Field label="الرصيد الافتتاحي">
          <input
            className="input"
            type="number"
            min={0}
            value={form.openingStock}
            onChange={(e) => setForm({ ...form, openingStock: e.target.value })}
          />
        </Field>
        <Field label="حد إعادة الطلب">
          <input
            className="input"
            type="number"
            min={0}
            value={form.reorderLevel}
            onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })}
          />
        </Field>
        <Field label="ضمان القطعة (أيام)">
          <input
            className="input"
            type="number"
            min={0}
            value={form.warrantyDays}
            onChange={(e) => setForm({ ...form, warrantyDays: e.target.value })}
          />
        </Field>
      </div>
    </Modal>
  );
}

function StockMovementModal({
  part,
  onClose,
  onDone,
  onError,
}: {
  part: PartRow | null;
  onClose: () => void;
  onDone: () => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState({ type: 'purchase_in', quantity: '1', unitCostEgp: '', batchCode: '', reason: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!part) return null;

  const submit = async () => {
    const quantity = Number(form.quantity);
    if (!quantity) {
      onError('أدخل كمية صحيحة');
      return;
    }
    setIsSubmitting(true);
    try {
      const sign = ['sale_out', 'adjustment_out', 'defective_out'].includes(form.type) ? -Math.abs(quantity) : Math.abs(quantity);
      await api.post('/inventory/movements', {
        partId: part._id,
        type: form.type,
        quantity: form.type === 'reserve' || form.type === 'release' ? Math.abs(quantity) : sign,
        unitCostEgp: Number(form.unitCostEgp) || part.pricing?.costEgp || 0,
        batchCode: form.batchCode || undefined,
        reason: form.reason,
      });
      await onDone();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      open={Boolean(part)}
      onClose={onClose}
      title={`حركة مخزون — ${part.name}`}
      subtitle={`الموجود حاليًا: ${part.stock?.onHand ?? 0} · المحجوز: ${part.stock?.reserved ?? 0}`}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            إلغاء
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={isSubmitting}>
            {isSubmitting ? 'جارٍ التنفيذ…' : 'تسجيل الحركة'}
          </button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="نوع الحركة">
          <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="purchase_in">توريد مشتريات (+)</option>
            <option value="adjustment_in">تسوية بالزيادة (+)</option>
            <option value="adjustment_out">تسوية بالنقص (−)</option>
            <option value="defective_in">إدخال تالف</option>
            <option value="defective_out">إخراج تالف</option>
            <option value="reserve">حجز لتذكرة</option>
            <option value="release">فك حجز</option>
          </select>
        </Field>
        <Field label="الكمية">
          <input
            className="input"
            type="number"
            min={1}
            value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: e.target.value })}
          />
        </Field>
        <Field label="تكلفة الوحدة">
          <input
            className="input"
            type="number"
            min={0}
            value={form.unitCostEgp}
            placeholder={String(part.pricing?.costEgp ?? 0)}
            onChange={(e) => setForm({ ...form, unitCostEgp: e.target.value })}
          />
        </Field>
        <Field label="كود الدفعة (للتوريد)">
          <input className="input" value={form.batchCode} onChange={(e) => setForm({ ...form, batchCode: e.target.value })} dir="ltr" />
        </Field>
        <div className="sm:col-span-2">
          <Field label="السبب / المرجع">
            <input className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </Field>
        </div>
      </div>

      <p className="mt-3 rounded-lg bg-ink-50 p-2.5 text-[11px] leading-relaxed text-ink-500">
        حركات المخزون تُسجَّل بسجل غير قابل للتعديل مع الأرصدة قبل/بعد، ويُمنع أي رصيد سالب.
      </p>
    </Modal>
  );
}

function TransferModal({
  open,
  branches,
  defaultFrom,
  onClose,
  onDone,
  onError,
}: {
  open: boolean;
  branches: { id: string; name: string }[];
  defaultFrom: string;
  onClose: () => void;
  onDone: () => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [fromBranchId, setFromBranchId] = useState(defaultFrom);
  const [toBranchId, setToBranchId] = useState('');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<{ partId: string; quantity: string }[]>([{ partId: '', quantity: '1' }]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: partsData } = useSWR<{ items: PartRow[] }>(open ? '/parts?limit=200&sort=name' : null, fetcher);
  const parts = partsData?.items ?? [];

  const submit = async () => {
    if (!fromBranchId || !toBranchId) return onError('اختر فرع المصدر وفرع الاستلام');
    if (fromBranchId === toBranchId) return onError('لا يمكن التحويل لنفس الفرع');
    const payloadLines = lines
      .filter((line) => line.partId && Number(line.quantity) > 0)
      .map((line) => ({ partId: line.partId, quantity: Number(line.quantity) }));
    if (!payloadLines.length) return onError('أضف بندًا واحدًا على الأقل');

    setIsSubmitting(true);
    try {
      await api.post('/inventory/transfers', {
        fromBranchId,
        toBranchId,
        lines: payloadLines,
        reason,
      });
      await onDone();
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="تحويل مخزون بين الفروع"
      subtitle="ينشئ طلب تحويل — الإرسال يخصم من المصدر والاستلام يضيف للمستلم"
      size="lg"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            إلغاء
          </button>
          <button type="button" className="btn-primary" onClick={() => void submit()} disabled={isSubmitting}>
            {isSubmitting ? 'جارٍ الإنشاء…' : 'إنشاء التحويل'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="من فرع" required>
            <select className="input" value={fromBranchId} onChange={(e) => setFromBranchId(e.target.value)}>
              <option value="">اختر الفرع…</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="إلى فرع" required>
            <select className="input" value={toBranchId} onChange={(e) => setToBranchId(e.target.value)}>
              <option value="">اختر الفرع…</option>
              {branches
                .filter((branch) => branch.id !== fromBranchId)
                .map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
            </select>
          </Field>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-bold text-ink-800">البنود</p>
            <button
              type="button"
              className="btn-ghost px-2 py-1 text-xs"
              onClick={() => setLines((prev) => [...prev, { partId: '', quantity: '1' }])}
            >
              <Plus size={14} /> إضافة بند
            </button>
          </div>
          <div className="space-y-2">
            {lines.map((line, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-[1fr_110px_36px]">
                <select
                  className="input"
                  value={line.partId}
                  onChange={(e) => setLines((prev) => prev.map((l, i) => (i === index ? { ...l, partId: e.target.value } : l)))}
                >
                  <option value="">اختر القطعة…</option>
                  {parts.map((part) => (
                    <option key={part._id} value={part._id}>
                      {part.name} — {part.sku}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  className="input"
                  value={line.quantity}
                  onChange={(e) => setLines((prev) => prev.map((l, i) => (i === index ? { ...l, quantity: e.target.value } : l)))}
                />
                <button
                  type="button"
                  className="btn-ghost px-2 text-red-600"
                  onClick={() => setLines((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)))}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>

        <Field label="سبب التحويل">
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function StockCountModal({
  open,
  branches,
  defaultBranch,
  onClose,
  onDone,
  onError,
}: {
  open: boolean;
  branches: { id: string; name: string }[];
  defaultBranch: string;
  onClose: () => void;
  onDone: () => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [branchId, setBranchId] = useState(defaultBranch);
  const [notes, setNotes] = useState('');
  const [search, setSearch] = useState('');
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: stock, isLoading } = useSWR<{ items: InStockRow[] }>(
    open ? `/inventory/stock${qs({ branchId: branchId || undefined })}` : null,
    fetcher,
  );
  const rows = (stock?.items ?? []).filter((item) => {
    const part = partName(item.partId);
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return part.name.toLowerCase().includes(term) || part.sku.toLowerCase().includes(term);
  });

  const submit = async () => {
    const lines = (stock?.items ?? [])
      .filter((item) => counted[typeof item.partId === 'string' ? item.partId : item.partId._id] !== undefined)
      .map((item) => {
        const partId = typeof item.partId === 'string' ? item.partId : item.partId._id;
        return { partId, countedOnHand: Number(counted[partId]) || 0 };
      })
      .filter((line) => line.partId);
    if (!lines.length) return onError('أدخل كمية مجرودة لقطعة واحدة على الأقل');

    setIsSubmitting(true);
    try {
      await api.post('/inventory/counts', { branchId: branchId || undefined, lines, notes });
      await onDone();
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="جرد فعلي"
      subtitle="أدخل الكميات المجرودة — تُطبق الفروق فورًا كحركات تسوية"
      size="xl"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            إلغاء
          </button>
          <button type="button" className="btn-primary" onClick={() => void submit()} disabled={isSubmitting}>
            {isSubmitting ? 'جارٍ الحفظ…' : 'حفظ الجرد'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="الفرع">
            <select className="input" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">الفرع النشط</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="بحث">
            <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="اسم أو كود القطعة…" />
          </Field>
        </div>

        {isLoading ? (
          <LoadingBlock rows={6} />
        ) : rows.length ? (
          <div className="max-h-[55vh] overflow-y-auto rounded-lg border border-ink-100">
            <table className="table">
              <thead className="sticky top-0 bg-white">
                <tr>
                  <th>القطعة</th>
                  <th>الرصيد المسجل</th>
                  <th>الكمية المجرودة</th>
                  <th>الفرق</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => {
                  const part = partName(item.partId);
                  const partId = typeof item.partId === 'string' ? item.partId : item.partId._id;
                  const value = counted[partId];
                  const diff = value === undefined || value === '' ? null : (Number(value) || 0) - item.quantity.onHand;
                  return (
                    <tr key={partId}>
                      <td className="text-xs">
                        <p className="font-medium text-ink-800">{part.name}</p>
                        <p className="text-ink-400" dir="ltr">{part.sku}</p>
                      </td>
                      <td className="num text-xs">{formatNumber(item.quantity.onHand)}</td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          className="input h-8 w-24 px-2 text-xs"
                          placeholder={String(item.quantity.onHand)}
                          value={value ?? ''}
                          onChange={(e) => setCounted((prev) => ({ ...prev, [partId]: e.target.value }))}
                        />
                      </td>
                      <td className={`num text-xs font-semibold ${diff === null ? 'text-ink-400' : diff === 0 ? 'text-ink-500' : diff > 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                        {diff === null ? '—' : `${diff > 0 ? '+' : ''}${formatNumber(diff)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-lg border border-ink-100 p-3 text-xs text-ink-500">لا توجد أصناف لهذا الفرع.</p>
        )}

        <Field label="ملاحظات الجرد">
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
