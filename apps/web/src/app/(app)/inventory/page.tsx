'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { AlertTriangle, Package, Plus, Search, TrendingDown } from 'lucide-react';
import { api, errorMessage, fetcher, qs } from '@/lib/api';
import { formatMoney, formatNumber, timeAgo } from '@/lib/format';
import { PART_CATEGORY_LABELS, PART_GRADE_LABELS } from '@/lib/constants';
import { Badge, Card, CardHeader, EmptyState, Field, LoadingBlock, PageHeader, StatCard } from '@/components/ui';
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

export default function InventoryPage() {
  const toast = useToast();
  const { hasPermission } = useAuth();
  const [tab, setTab] = useState<'parts' | 'lowStock' | 'consumption'>('parts');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [movementPart, setMovementPart] = useState<PartRow | null>(null);

  const partsKey = `/parts${qs({
    q: search || undefined,
    category: categoryFilter || undefined,
    page,
    limit: 25,
  })}`;

  const { data: parts, error: partsError, isLoading: partsLoading } = useSWR<{
    items: PartRow[];
    meta: { total: number; page: number; pages: number };
  }>(tab === 'parts' ? partsKey : null, fetcher);

  const { data: lowStock } = useSWR<{ count: number; parts: PartRow[] }>(
    tab === 'lowStock' ? '/parts/low-stock' : null,
    fetcher,
  );

  const { data: consumption } = useSWR<ConsumptionRow[]>(
    tab === 'consumption' && hasPermission('report:read') ? '/parts/consumption-report' : null,
    fetcher,
  );

  const { data: stockSummary } = useSWR<{
    totals: { onHand: number; reserved: number; defective: number; incoming: number };
  }>('/inventory/stock', fetcher);

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
          value={formatMoney(inventoryValue)}
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

void timeAgo;
void CardHeader;
