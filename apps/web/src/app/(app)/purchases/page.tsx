'use client';

import { useMemo, useState } from 'react';
import useSWR, { mutate } from 'swr';
import {
  Building2,
  CheckCircle2,
  FileText,
  PackagePlus,
  Plus,
  Printer,
  Search,
  ShoppingCart,
  Trash2,
  Truck,
  Wallet,
} from 'lucide-react';
import { api, errorMessage, fetcher, qs } from '@/lib/api';
import { formatDate, formatDateTime, formatMoney, formatNumber } from '@/lib/format';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from '@/lib/constants';
import { Badge, Card, CardHeader, EmptyState, Field, LoadingBlock, PageHeader, StatCard } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/lib/auth';

/* ============================ الأنواع ============================ */

interface SupplierRow {
  _id: string;
  name: string;
  code?: string;
  type?: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  paymentTerms?: string;
  notes?: string;
  isActive?: boolean;
  address?: { governorate?: string; city?: string; area?: string; street?: string };
}

interface PartOption {
  _id: string;
  sku: string;
  name: string;
  category?: string;
  pricing: { costEgp?: number; sellingPriceEgp?: number; lastCostEgp?: number };
  stock?: { onHand?: number; incoming?: number; reorderLevel?: number };
  availableQty?: number;
}

interface PurchaseLine {
  _id: string;
  partId: string | { _id: string; name?: string; sku?: string };
  description: string;
  quantityOrdered: number;
  quantityReceived: number;
  unitCostEgp: number;
  totalEgp: number;
}

interface PurchaseOrder {
  _id: string;
  poNumber: string;
  status: string;
  supplierId: { _id: string; name: string; phone?: string } | string;
  branchId?: { name?: string; code?: string } | string;
  lines: PurchaseLine[];
  totals: {
    subtotalEgp: number;
    discountEgp: number;
    taxRatePct: number;
    taxEgp: number;
    totalEgp: number;
    paidEgp: number;
    dueEgp: number;
  };
  expectedAt?: string | null;
  createdAt: string;
  supplierInvoiceNumber?: string;
  notes?: string;
  orderedAt?: string | null;
  receivedAt?: string | null;
  cancelReason?: string;
}

interface PurchasePayment {
  _id: string;
  receiptNumber: string;
  amountEgp: number;
  method: string;
  paidAt: string;
  reference?: string;
}

interface PayableRow {
  supplierId: string;
  supplierName: string;
  supplierPhone: string;
  dueEgp: number;
  totalEgp: number;
  paidEgp: number;
  orders: number;
  oldestOrderAt: string | null;
  lastPaymentAt: string | null;
}

interface StatementEntry {
  date: string;
  kind: string;
  reference: string;
  description: string;
  debitEgp: number;
  creditEgp: number;
  balanceEgp: number;
}

interface SupplierStatement {
  supplier: { id: string; name: string; phone?: string; code?: string };
  period: { from: string; to: string };
  openingBalanceEgp: number;
  closingBalanceEgp: number;
  entries: StatementEntry[];
}

const PO_STATUS_LABELS: Record<string, string> = {
  draft: 'مسودة',
  ordered: 'معتمد',
  partially_received: 'مستلم جزئيًا',
  received: 'مستلم بالكامل',
  cancelled: 'ملغي',
};

const PO_STATUS_COLORS: Record<string, string> = {
  draft: 'border-ink-200 bg-ink-100 text-ink-700',
  ordered: 'border-sky-200 bg-sky-50 text-sky-700',
  partially_received: 'border-amber-200 bg-amber-50 text-amber-800',
  received: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  cancelled: 'border-red-200 bg-red-50 text-red-700',
};

const SUPPLIER_TYPE_LABELS: Record<string, string> = {
  local_wholesale: 'تاجر جملة محلي',
  importer: 'مستورد',
  online: 'متجر إلكتروني',
  authorized_distributor: 'موزع معتمد',
  other: 'أخرى',
};

function supplierOf(po: PurchaseOrder): { id: string; name: string } {
  if (typeof po.supplierId === 'string') return { id: po.supplierId, name: '—' };
  return { id: po.supplierId?._id ?? '', name: po.supplierId?.name ?? '—' };
}

function toIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/* ============================ الصفحة ============================ */

export default function PurchasesPage() {
  const toast = useToast();
  const { hasPermission, availableBranches, activeBranchId } = useAuth();
  const [tab, setTab] = useState<'orders' | 'payables' | 'suppliers'>('orders');

  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const [supplierSearch, setSupplierSearch] = useState('');

  const ordersKey = `/purchases${qs({
    status: statusFilter || undefined,
    q: search || undefined,
    page,
    limit: 25,
  })}`;
  const { data: orders, error: ordersError, isLoading: ordersLoading } = useSWR<{
    items: PurchaseOrder[];
    meta: { total: number; page: number; pages: number; dueEgp?: number; byStatus?: { status: string; count: number }[] };
  }>(ordersKey, fetcher);

  const { data: payables, isLoading: payablesLoading } = useSWR<{
    totalDueEgp: number;
    suppliersCount: number;
    items: PayableRow[];
  }>(tab === 'payables' ? '/purchases/payables' : null, fetcher);

  const { data: suppliersData, isLoading: suppliersLoading } = useSWR<{
    items: SupplierRow[];
    meta: { total: number };
  }>(`/suppliers${qs({ q: supplierSearch || undefined, limit: 100 })}`, fetcher);

  const { data: partsData } = useSWR<{ items: PartOption[] }>(
    '/parts?limit=300&sort=name',
    fetcher,
  );
  const parts = partsData?.items ?? [];
  const suppliers = suppliersData?.items ?? [];

  /* ------------------------- إنشاء أمر شراء ------------------------- */
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    supplierId: '',
    branchId: '',
    expectedAt: '',
    supplierInvoiceNumber: '',
    discountEgp: '0',
    taxRatePct: '14',
    notes: '',
  });
  const [lines, setLines] = useState<{ partId: string; quantityOrdered: string; unitCostEgp: string }[]>([
    { partId: '', quantityOrdered: '1', unitCostEgp: '0' },
  ]);

  const openCreate = () => {
    setForm({
      supplierId: suppliers[0]?._id ?? '',
      branchId: activeBranchId ?? availableBranches[0]?.id ?? '',
      expectedAt: '',
      supplierInvoiceNumber: '',
      discountEgp: '0',
      taxRatePct: '14',
      notes: '',
    });
    setLines([{ partId: '', quantityOrdered: '1', unitCostEgp: '0' }]);
    setCreateOpen(true);
  };

  const createTotals = useMemo(() => {
    const subtotal = lines.reduce(
      (acc, line) => acc + (Number(line.quantityOrdered) || 0) * (Number(line.unitCostEgp) || 0),
      0,
    );
    const discount = Math.min(subtotal, Number(form.discountEgp) || 0);
    const taxable = subtotal - discount;
    const tax = (taxable * (Number(form.taxRatePct) || 0)) / 100;
    return { subtotal, discount, tax, total: taxable + tax };
  }, [lines, form.discountEgp, form.taxRatePct]);

  const setLine = (index: number, patch: Partial<(typeof lines)[number]>) => {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };

  const pickPart = (index: number, partId: string) => {
    const part = parts.find((p) => p._id === partId);
    const cost = part?.pricing?.lastCostEgp || part?.pricing?.costEgp || 0;
    setLine(index, { partId, unitCostEgp: String(cost) });
  };

  const submitCreate = async () => {
    if (!form.supplierId) return toast.error('اختر المورد');
    const payloadLines = lines
      .filter((l) => l.partId && Number(l.quantityOrdered) > 0)
      .map((l) => ({
        partId: l.partId,
        quantityOrdered: Number(l.quantityOrdered),
        unitCostEgp: Number(l.unitCostEgp),
      }));
    if (!payloadLines.length) return toast.error('أضف بندًا واحدًا على الأقل');

    setSaving(true);
    try {
      await api.post('/purchases', {
        supplierId: form.supplierId,
        branchId: form.branchId || undefined,
        expectedAt: toIso(form.expectedAt),
        supplierInvoiceNumber: form.supplierInvoiceNumber,
        lines: payloadLines,
        discountEgp: Number(form.discountEgp) || 0,
        taxRatePct: Number(form.taxRatePct) || 0,
        notes: form.notes,
      });
      toast.success('تم إنشاء أمر الشراء كمسودة');
      setCreateOpen(false);
      await mutate((key) => typeof key === 'string' && key.startsWith('/purchases'));
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  /* ------------------------- اعتماد / إلغاء ------------------------- */
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<PurchaseOrder | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [detailsTarget, setDetailsTarget] = useState<PurchaseOrder | null>(null);
  const [details, setDetails] = useState<{ payments: PurchasePayment[] } | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  const orderPo = async (po: PurchaseOrder) => {
    setBusy(po._id);
    try {
      await api.post(`/purchases/${po._id}/order`);
      toast.success(`تم اعتماد ${po.poNumber} واحتساب الكميات كوارد متوقع`);
      await mutate((key) => typeof key === 'string' && key.startsWith('/purchases'));
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const cancelPo = async () => {
    if (!cancelTarget) return;
    if (cancelReason.trim().length < 2) return toast.error('اذكر سبب الإلغاء');
    setBusy(cancelTarget._id);
    try {
      await api.post(`/purchases/${cancelTarget._id}/cancel`, { reason: cancelReason.trim() });
      toast.success('تم إلغاء أمر الشراء وتحرير الوارد المتوقع');
      setCancelTarget(null);
      setCancelReason('');
      await mutate((key) => typeof key === 'string' && key.startsWith('/purchases'));
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const openDetails = async (po: PurchaseOrder) => {
    setDetailsTarget(po);
    setDetails(null);
    setDetailsLoading(true);
    try {
      const result = await api.get<{ purchaseOrder: PurchaseOrder; payments: PurchasePayment[] }>(`/purchases/${po._id}`);
      setDetails({ payments: result.payments ?? [] });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDetailsLoading(false);
    }
  };

  /* ------------------------- استلام ------------------------- */
  const [receiveTarget, setReceiveTarget] = useState<PurchaseOrder | null>(null);
  const [receiveRows, setReceiveRows] = useState<Record<string, { quantity: string; unitCostEgp: string; batchCode: string }>>({});

  const openReceive = (po: PurchaseOrder) => {
    setReceiveTarget(po);
    const rows: Record<string, { quantity: string; unitCostEgp: string; batchCode: string }> = {};
    for (const line of po.lines) {
      const remaining = Math.max(0, line.quantityOrdered - line.quantityReceived);
      rows[line._id] = {
        quantity: remaining ? String(remaining) : '0',
        unitCostEgp: String(line.unitCostEgp),
        batchCode: '',
      };
    }
    setReceiveRows(rows);
  };

  const submitReceive = async () => {
    if (!receiveTarget) return;
    const payload = Object.entries(receiveRows)
      .map(([lineId, row]) => ({
        lineId,
        quantity: Number(row.quantity) || 0,
        unitCostEgp: Number(row.unitCostEgp) || 0,
        batchCode: row.batchCode.trim(),
      }))
      .filter((row) => row.quantity > 0);
    if (!payload.length) return toast.error('حدد كمية مستلمة واحدة على الأقل');

    setSaving(true);
    try {
      await api.post(`/purchases/${receiveTarget._id}/receive`, { lines: payload });
      toast.success('تم تسجيل الاستلام وتحديث المخزون');
      setReceiveTarget(null);
      await mutate((key) => typeof key === 'string' && (key.startsWith('/purchases') || key.startsWith('/parts') || key.startsWith('/inventory')));
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  /* ------------------------- سداد مورد ------------------------- */
  const [paymentTarget, setPaymentTarget] = useState<{
    supplierId: string;
    supplierName: string;
    purchaseOrderId?: string;
    poNumber?: string;
    dueEgp: number;
  } | null>(null);
  const [paymentForm, setPaymentForm] = useState({
    amountEgp: '',
    method: 'cash',
    reference: '',
    notes: '',
  });

  const openPayment = (target: NonNullable<typeof paymentTarget>) => {
    setPaymentTarget(target);
    setPaymentForm({ amountEgp: String(target.dueEgp || ''), method: 'cash', reference: '', notes: '' });
  };

  const submitPayment = async () => {
    if (!paymentTarget) return;
    const amount = Number(paymentForm.amountEgp) || 0;
    if (amount <= 0) return toast.error('أدخل مبلغًا صحيحًا');

    setSaving(true);
    try {
      await api.post('/purchases/payments', {
        supplierId: paymentTarget.supplierId,
        purchaseOrderId: paymentTarget.purchaseOrderId ?? null,
        amountEgp: amount,
        method: paymentForm.method,
        reference: paymentForm.reference,
        bankName: '',
        notes: paymentForm.notes,
      });
      toast.success('تم تسجيل سداد المورد');
      setPaymentTarget(null);
      await mutate((key) => typeof key === 'string' && (key.startsWith('/purchases') || key.startsWith('/finance')));
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  /* ------------------------- كشف حساب ------------------------- */
  const [statementTarget, setStatementTarget] = useState<SupplierRow | null>(null);
  const [statement, setStatement] = useState<SupplierStatement | null>(null);
  const [statementLoading, setStatementLoading] = useState(false);

  const openStatement = async (supplier: SupplierRow) => {
    setStatementTarget(supplier);
    setStatement(null);
    setStatementLoading(true);
    try {
      const result = await api.get<SupplierStatement>(`/finance/suppliers/${supplier._id}/statement`);
      setStatement(result);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setStatementLoading(false);
    }
  };

  /* ------------------------- الموردون ------------------------- */
  const [supplierFormOpen, setSupplierFormOpen] = useState(false);
  const [supplierEdit, setSupplierEdit] = useState<SupplierRow | null>(null);
  const [supplierForm, setSupplierForm] = useState({
    name: '',
    type: 'local_wholesale',
    contactPerson: '',
    phone: '',
    email: '',
    paymentTerms: '',
    city: '',
    notes: '',
  });

  const openSupplierForm = (supplier?: SupplierRow) => {
    setSupplierEdit(supplier ?? null);
    setSupplierForm({
      name: supplier?.name ?? '',
      type: supplier?.type ?? 'local_wholesale',
      contactPerson: supplier?.contactPerson ?? '',
      phone: supplier?.phone ?? '',
      email: supplier?.email ?? '',
      paymentTerms: supplier?.paymentTerms ?? '',
      city: supplier?.address?.city ?? '',
      notes: supplier?.notes ?? '',
    });
    setSupplierFormOpen(true);
  };

  const submitSupplier = async () => {
    if (supplierForm.name.trim().length < 2) return toast.error('اسم المورد قصير جدًا');
    setSaving(true);
    try {
      const payload = {
        name: supplierForm.name.trim(),
        type: supplierForm.type,
        contactPerson: supplierForm.contactPerson,
        phone: supplierForm.phone,
        email: supplierForm.email,
        paymentTerms: supplierForm.paymentTerms,
        address: { city: supplierForm.city },
        notes: supplierForm.notes,
      };
      if (supplierEdit) {
        await api.patch(`/suppliers/${supplierEdit._id}`, payload);
        toast.success('تم تحديث المورد');
      } else {
        await api.post('/suppliers', payload);
        toast.success('تم إضافة المورد');
      }
      setSupplierFormOpen(false);
      await mutate((key) => typeof key === 'string' && key.startsWith('/suppliers'));
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const canManage = hasPermission('purchase:manage');
  const canReceive = hasPermission('purchase:receive');
  const canPay = hasPermission('supplier_payment:record');

  return (
    <div>
      <PageHeader
        title="المشتريات والموردون"
        subtitle="أوامر الشراء، الاستلام، الوارد المتوقع، وسداد الموردين"
        actions={
          canManage ? (
            <button type="button" className="btn-primary" onClick={openCreate}>
              <Plus size={16} /> أمر شراء جديد
            </button>
          ) : null
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="إجمالي أوامر الشراء"
          value={formatNumber(orders?.meta.total ?? 0)}
          icon={<ShoppingCart size={18} />}
          tone="info"
        />
        <StatCard
          label="المتبقي على الموردين"
          value={formatMoney(orders?.meta.dueEgp ?? payables?.totalDueEgp ?? 0)}
          hint={`${formatNumber(payables?.suppliersCount ?? 0)} مورد عليهم مستحقات`}
          icon={<Wallet size={18} />}
          tone={(payables?.totalDueEgp ?? 0) > 0 ? 'warning' : 'success'}
        />
        <StatCard
          label="أوامر قيد التوريد"
          value={formatNumber(
            orders?.meta.byStatus?.find((s) => s.status === 'ordered')?.count ?? 0,
          )}
          hint="معتمدة ولم تُستلم بعد"
          icon={<Truck size={18} />}
          tone="default"
        />
        <StatCard
          label="الموردون النشطون"
          value={formatNumber(suppliersData?.meta.total ?? 0)}
          icon={<Building2 size={18} />}
        />
      </div>

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-3 py-2">
          {[
            ['orders', 'أوامر الشراء'],
            ['payables', 'مستحقات الموردين'],
            ['suppliers', 'دليل الموردين'],
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

        {tab === 'orders' ? (
          <div className="grid gap-3 p-4 sm:grid-cols-3">
            <div className="relative sm:col-span-2">
              <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400" />
              <input
                className="input pr-9"
                placeholder="ابحث برقم أمر الشراء أو فاتورة المورد…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <select
              className="input"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">كل الحالات</option>
              {Object.entries(PO_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        ) : tab === 'suppliers' ? (
          <div className="p-4">
            <div className="relative">
              <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400" />
              <input
                className="input pr-9"
                placeholder="ابحث بالاسم أو الهاتف أو الشخص المسؤول…"
                value={supplierSearch}
                onChange={(e) => setSupplierSearch(e.target.value)}
              />
            </div>
          </div>
        ) : null}
      </Card>

      {ordersError ? (
        <Card className="mb-4 border-red-200 bg-red-50 p-4 text-sm text-red-700">{errorMessage(ordersError)}</Card>
      ) : null}

      {tab === 'orders' ? (
        <Card>
          {ordersLoading ? (
            <LoadingBlock rows={7} />
          ) : orders?.items.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>أمر الشراء</th>
                    <th>المورد</th>
                    <th>الحالة</th>
                    <th>التاريخ</th>
                    <th>الإجمالي</th>
                    <th>المسدد</th>
                    <th>المتبقي</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {orders.items.map((po) => {
                    const supplier = supplierOf(po);
                    return (
                      <tr key={po._id}>
                        <td className="text-xs">
                          <p className="font-bold text-ink-800" dir="ltr">{po.poNumber}</p>
                          <p className="text-ink-400">
                            {po.lines.length} بند
                            {po.supplierInvoiceNumber ? ` — فاتورة ${po.supplierInvoiceNumber}` : ''}
                          </p>
                        </td>
                        <td className="text-xs">{supplier.name}</td>
                        <td>
                          <Badge className={PO_STATUS_COLORS[po.status] ?? 'border-ink-200 bg-ink-100 text-ink-700'}>
                            {PO_STATUS_LABELS[po.status] ?? po.status}
                          </Badge>
                        </td>
                        <td className="text-xs">{formatDate(po.createdAt)}</td>
                        <td className="num text-xs font-semibold">{formatMoney(po.totals.totalEgp)}</td>
                        <td className="num text-xs text-emerald-700">{formatMoney(po.totals.paidEgp)}</td>
                        <td className={`num text-xs font-bold ${po.totals.dueEgp > 0 ? 'text-red-700' : 'text-ink-400'}`}>
                          {formatMoney(po.totals.dueEgp)}
                        </td>
                        <td>
                          <div className="flex flex-wrap items-center gap-1">
                            <button type="button" className="btn-ghost px-2 py-1 text-[11px]" onClick={() => void openDetails(po)}>
                              تفاصيل
                            </button>
                            {po.status === 'draft' && canManage ? (
                              <button
                                type="button"
                                className="btn-secondary px-2 py-1 text-[11px]"
                                disabled={busy === po._id}
                                onClick={() => void orderPo(po)}
                              >
                                <CheckCircle2 size={13} /> اعتماد
                              </button>
                            ) : null}
                            {['ordered', 'partially_received'].includes(po.status) && canReceive ? (
                              <button
                                type="button"
                                className="btn-secondary px-2 py-1 text-[11px]"
                                onClick={() => openReceive(po)}
                              >
                                <PackagePlus size={13} /> استلام
                              </button>
                            ) : null}
                            {po.totals.dueEgp > 0 && ['ordered', 'partially_received', 'received'].includes(po.status) && canPay ? (
                              <button
                                type="button"
                                className="btn-ghost px-2 py-1 text-[11px]"
                                onClick={() =>
                                  openPayment({
                                    supplierId: supplier.id,
                                    supplierName: supplier.name,
                                    purchaseOrderId: po._id,
                                    poNumber: po.poNumber,
                                    dueEgp: po.totals.dueEgp,
                                  })
                                }
                              >
                                <Wallet size={13} /> سداد
                              </button>
                            ) : null}
                            {['draft', 'ordered', 'partially_received'].includes(po.status) && canManage ? (
                              <button
                                type="button"
                                className="btn-ghost px-2 py-1 text-[11px] text-red-600"
                                onClick={() => {
                                  setCancelTarget(po);
                                  setCancelReason('');
                                }}
                              >
                                إلغاء
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <Pager meta={orders.meta} onPage={setPage} />
            </div>
          ) : (
            <EmptyState
              title="لا توجد أوامر شراء"
              description="ابدأ بإنشاء أمر شراء لتوريد قطع الغيار"
              icon={<ShoppingCart size={20} />}
              action={
                canManage ? (
                  <button type="button" className="btn-primary" onClick={openCreate}>
                    <Plus size={16} /> أمر شراء جديد
                  </button>
                ) : null
              }
            />
          )}
        </Card>
      ) : null}

      {tab === 'payables' ? (
        <Card>
          {payablesLoading ? (
            <LoadingBlock rows={5} />
          ) : payables?.items.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>المورد</th>
                    <th>عدد الأوامر</th>
                    <th>إجمالي المشتريات</th>
                    <th>المسدد</th>
                    <th>المستحق</th>
                    <th>أقدم أمر</th>
                    <th>آخر سداد</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {payables.items.map((row) => (
                    <tr key={row.supplierId}>
                      <td className="text-xs">
                        <p className="font-semibold text-ink-800">{row.supplierName}</p>
                        <p className="text-ink-400" dir="ltr">{row.supplierPhone}</p>
                      </td>
                      <td className="num text-xs">{row.orders}</td>
                      <td className="num text-xs">{formatMoney(row.totalEgp)}</td>
                      <td className="num text-xs text-emerald-700">{formatMoney(row.paidEgp)}</td>
                      <td className="num text-xs font-bold text-red-700">{formatMoney(row.dueEgp)}</td>
                      <td className="text-xs">{formatDate(row.oldestOrderAt)}</td>
                      <td className="text-xs">{formatDate(row.lastPaymentAt)}</td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          <button
                            type="button"
                            className="btn-ghost px-2 py-1 text-[11px]"
                            onClick={() =>
                              void openStatement({
                                _id: row.supplierId,
                                name: row.supplierName,
                                phone: row.supplierPhone,
                              })
                            }
                          >
                            <FileText size={13} /> كشف حساب
                          </button>
                          {canPay ? (
                            <button
                              type="button"
                              className="btn-ghost px-2 py-1 text-[11px]"
                              onClick={() =>
                                openPayment({
                                  supplierId: row.supplierId,
                                  supplierName: row.supplierName,
                                  dueEgp: row.dueEgp,
                                })
                              }
                            >
                              <Wallet size={13} /> سداد
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="لا توجد مستحقات للموردين" icon={<Wallet size={20} />} />
          )}
        </Card>
      ) : null}

      {tab === 'suppliers' ? (
        <Card>
          <CardHeader
            title="دليل الموردين"
            subtitle={`${formatNumber(suppliersData?.meta.total ?? 0)} مورد`}
            icon={<Building2 size={18} />}
            action={
              hasPermission('supplier:manage') ? (
                <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => openSupplierForm()}>
                  <Plus size={14} /> مورد جديد
                </button>
              ) : null
            }
          />
          {suppliersLoading ? (
            <LoadingBlock rows={5} />
          ) : suppliers.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>المورد</th>
                    <th>النوع</th>
                    <th>التواصل</th>
                    <th>شروط الدفع</th>
                    <th>الحالة</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {suppliers.map((supplier) => (
                    <tr key={supplier._id}>
                      <td className="text-xs">
                        <p className="font-semibold text-ink-800">{supplier.name}</p>
                        <p className="text-ink-400" dir="ltr">{supplier.code || '—'}</p>
                      </td>
                      <td className="text-xs">{SUPPLIER_TYPE_LABELS[supplier.type ?? ''] ?? supplier.type ?? '—'}</td>
                      <td className="text-xs">
                        <p dir="ltr">{supplier.phone || '—'}</p>
                        <p className="text-ink-400">{supplier.contactPerson || supplier.email || ''}</p>
                      </td>
                      <td className="text-xs">{supplier.paymentTerms || '—'}</td>
                      <td>
                        <Badge
                          className={
                            supplier.isActive === false
                              ? 'border-red-200 bg-red-50 text-red-700'
                              : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          }
                        >
                          {supplier.isActive === false ? 'موقوف' : 'نشط'}
                        </Badge>
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          <button
                            type="button"
                            className="btn-ghost px-2 py-1 text-[11px]"
                            onClick={() => void openStatement(supplier)}
                          >
                            <FileText size={13} /> كشف حساب
                          </button>
                          {hasPermission('supplier:manage') ? (
                            <button
                              type="button"
                              className="btn-ghost px-2 py-1 text-[11px]"
                              onClick={() => openSupplierForm(supplier)}
                            >
                              تعديل
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="لا يوجد موردون"
              description="أضف المورد الأول لبدء دورة الشراء"
              icon={<Building2 size={20} />}
              action={
                hasPermission('supplier:manage') ? (
                  <button type="button" className="btn-primary" onClick={() => openSupplierForm()}>
                    <Plus size={16} /> مورد جديد
                  </button>
                ) : null
              }
            />
          )}
        </Card>
      ) : null}

      {/* ===================== مودال إنشاء أمر شراء ===================== */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="أمر شراء جديد"
        subtitle="يُحفظ كمسودة — الاعتماد هو ما يحتسب الوارد المتوقع"
        size="xl"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setCreateOpen(false)} disabled={saving}>
              إلغاء
            </button>
            <button type="button" className="btn-primary" onClick={() => void submitCreate()} disabled={saving}>
              {saving ? 'جارٍ الحفظ…' : 'حفظ المسودة'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="المورد" required>
              <select className="input" value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>
                <option value="">اختر المورد…</option>
                {suppliers.map((supplier) => (
                  <option key={supplier._id} value={supplier._id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="فرع الاستلام">
              <select className="input" value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>
                <option value="">الفرع النشط</option>
                {availableBranches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="موعد التوريد المتوقع">
              <input
                type="date"
                className="input"
                value={form.expectedAt}
                onChange={(e) => setForm({ ...form, expectedAt: e.target.value })}
              />
            </Field>
            <Field label="رقم فاتورة المورد">
              <input
                className="input"
                value={form.supplierInvoiceNumber}
                onChange={(e) => setForm({ ...form, supplierInvoiceNumber: e.target.value })}
              />
            </Field>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-bold text-ink-800">بنود الأمر</p>
              <button
                type="button"
                className="btn-ghost px-2 py-1 text-xs"
                onClick={() => setLines((prev) => [...prev, { partId: '', quantityOrdered: '1', unitCostEgp: '0' }])}
              >
                <Plus size={14} /> إضافة بند
              </button>
            </div>
            <div className="space-y-2">
              {lines.map((line, index) => (
                <div key={index} className="grid gap-2 rounded-lg border border-ink-100 p-2 sm:grid-cols-[1fr_90px_120px_140px_36px]">
                  <select className="input" value={line.partId} onChange={(e) => pickPart(index, e.target.value)}>
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
                    placeholder="الكمية"
                    value={line.quantityOrdered}
                    onChange={(e) => setLine(index, { quantityOrdered: e.target.value })}
                  />
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="input"
                    placeholder="سعر الوحدة"
                    value={line.unitCostEgp}
                    onChange={(e) => setLine(index, { unitCostEgp: e.target.value })}
                  />
                  <div className="flex items-center rounded-lg bg-ink-50 px-3 text-xs font-semibold text-ink-700">
                    {formatMoney((Number(line.quantityOrdered) || 0) * (Number(line.unitCostEgp) || 0))}
                  </div>
                  <button
                    type="button"
                    className="btn-ghost px-2 text-red-600"
                    onClick={() => setLines((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)))}
                    aria-label="حذف البند"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="خصم (ج.م)">
              <input
                type="number"
                min={0}
                step="0.01"
                className="input"
                value={form.discountEgp}
                onChange={(e) => setForm({ ...form, discountEgp: e.target.value })}
              />
            </Field>
            <Field label="نسبة الضريبة %">
              <input
                type="number"
                min={0}
                max={100}
                className="input"
                value={form.taxRatePct}
                onChange={(e) => setForm({ ...form, taxRatePct: e.target.value })}
              />
            </Field>
            <Field label="ملاحظات">
              <input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
          </div>

          <div className="rounded-xl border border-ink-100 bg-ink-50 p-3 text-xs">
            <div className="flex items-center justify-between py-0.5">
              <span className="text-ink-500">الإجمالي قبل الخصم</span>
              <span className="num font-semibold">{formatMoney(createTotals.subtotal)}</span>
            </div>
            <div className="flex items-center justify-between py-0.5">
              <span className="text-ink-500">الخصم</span>
              <span className="num font-semibold">- {formatMoney(createTotals.discount)}</span>
            </div>
            <div className="flex items-center justify-between py-0.5">
              <span className="text-ink-500">الضريبة</span>
              <span className="num font-semibold">{formatMoney(createTotals.tax)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between border-t border-ink-200 pt-1.5 text-sm">
              <span className="font-bold text-ink-800">الإجمالي المستحق</span>
              <span className="num font-bold text-brand-800">{formatMoney(createTotals.total)}</span>
            </div>
          </div>
        </div>
      </Modal>

      {/* ===================== مودال الاستلام ===================== */}
      <Modal
        open={Boolean(receiveTarget)}
        onClose={() => setReceiveTarget(null)}
        title={`استلام ${receiveTarget?.poNumber ?? ''}`}
        subtitle="أدخل الكميات المستلمة فعليًا — يمكن الاستلام على دفعات"
        size="lg"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setReceiveTarget(null)} disabled={saving}>
              إلغاء
            </button>
            <button type="button" className="btn-primary" onClick={() => void submitReceive()} disabled={saving}>
              {saving ? 'جارٍ التسجيل…' : 'تسجيل الاستلام'}
            </button>
          </>
        }
      >
        <div className="space-y-2">
          {receiveTarget?.lines.map((line) => {
            const remaining = Math.max(0, line.quantityOrdered - line.quantityReceived);
            const row = receiveRows[line._id] ?? { quantity: '0', unitCostEgp: String(line.unitCostEgp), batchCode: '' };
            return (
              <div key={line._id} className="rounded-lg border border-ink-100 p-2.5">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-ink-800">{line.description}</span>
                  <span className="text-ink-500">
                    المطلوب {formatNumber(line.quantityOrdered)} — المستلم {formatNumber(line.quantityReceived)} — المتبقي{' '}
                    <strong className="text-ink-800">{formatNumber(remaining)}</strong>
                  </span>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <label className="block">
                    <span className="label">الكمية المستلمة</span>
                    <input
                      type="number"
                      min={0}
                      max={remaining}
                      className="input"
                      value={row.quantity}
                      onChange={(e) =>
                        setReceiveRows((prev) => ({
                          ...prev,
                          [line._id]: { ...row, quantity: e.target.value },
                        }))
                      }
                    />
                  </label>
                  <label className="block">
                    <span className="label">تكلفة الوحدة</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className="input"
                      value={row.unitCostEgp}
                      onChange={(e) =>
                        setReceiveRows((prev) => ({
                          ...prev,
                          [line._id]: { ...row, unitCostEgp: e.target.value },
                        }))
                      }
                    />
                  </label>
                  <label className="block">
                    <span className="label">كود الدفعة (اختياري)</span>
                    <input
                      className="input"
                      placeholder="تلقائي"
                      value={row.batchCode}
                      onChange={(e) =>
                        setReceiveRows((prev) => ({
                          ...prev,
                          [line._id]: { ...row, batchCode: e.target.value },
                        }))
                      }
                    />
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      </Modal>

      {/* ===================== مودال السداد ===================== */}
      <Modal
        open={Boolean(paymentTarget)}
        onClose={() => setPaymentTarget(null)}
        title="سداد مورد"
        subtitle={
          paymentTarget?.purchaseOrderId
            ? `${paymentTarget.supplierName} — ${paymentTarget.poNumber}`
            : paymentTarget?.supplierName
        }
        size="sm"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setPaymentTarget(null)} disabled={saving}>
              إلغاء
            </button>
            <button type="button" className="btn-primary" onClick={() => void submitPayment()} disabled={saving}>
              {saving ? 'جارٍ التسجيل…' : 'تسجيل السداد'}
            </button>
          </>
        }
      >
        {paymentTarget ? (
          <div className="space-y-3">
            {!paymentTarget.purchaseOrderId ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                السداد من هذه الشاشة مرتبط بأمر شراء. اختر «سداد» من داخل أمر شراء محدد لتسجيل الدفعة.
              </p>
            ) : null}
            <Field label="المبلغ" required>
              <input
                type="number"
                min={0.01}
                step="0.01"
                className="input"
                value={paymentForm.amountEgp}
                onChange={(e) => setPaymentForm({ ...paymentForm, amountEgp: e.target.value })}
              />
            </Field>
            <Field label="طريقة السداد" required>
              <select
                className="input"
                value={paymentForm.method}
                onChange={(e) => setPaymentForm({ ...paymentForm, method: e.target.value })}
              >
                {PAYMENT_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {PAYMENT_METHOD_LABELS[method]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="المرجع / رقم التحويل">
              <input
                className="input"
                value={paymentForm.reference}
                onChange={(e) => setPaymentForm({ ...paymentForm, reference: e.target.value })}
              />
            </Field>
            <Field label="ملاحظات">
              <input
                className="input"
                value={paymentForm.notes}
                onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
              />
            </Field>
          </div>
        ) : null}
      </Modal>

      {/* ===================== كشف حساب مورد ===================== */}
      <Modal
        open={Boolean(statementTarget)}
        onClose={() => {
          setStatementTarget(null);
          setStatement(null);
        }}
        title={`كشف حساب — ${statementTarget?.name ?? ''}`}
        subtitle={statement ? `من ${formatDate(statement.period.from)} إلى ${formatDate(statement.period.to)}` : undefined}
        size="lg"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => window.print()}>
              <Printer size={15} /> طباعة
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                setStatementTarget(null);
                setStatement(null);
              }}
            >
              إغلاق
            </button>
          </>
        }
      >
        {statementLoading ? (
          <LoadingBlock rows={6} />
        ) : statement ? (
          <div id="print-area" className="space-y-3">
            <div className="grid gap-2 rounded-xl border border-ink-100 bg-ink-50 p-3 text-xs sm:grid-cols-3">
              <div>
                <p className="text-ink-500">رصيد افتتاحي</p>
                <p className="num mt-0.5 font-bold">{formatMoney(statement.openingBalanceEgp)}</p>
              </div>
              <div>
                <p className="text-ink-500">إجمالي المدين (مشتريات)</p>
                <p className="num mt-0.5 font-bold">{formatMoney(statement.entries.reduce((a, e) => a + e.debitEgp, 0))}</p>
              </div>
              <div>
                <p className="text-ink-500">الرصيد الختامي</p>
                <p className="num mt-0.5 font-bold text-red-700">{formatMoney(statement.closingBalanceEgp)}</p>
              </div>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>التاريخ</th>
                    <th>المستند</th>
                    <th>البيان</th>
                    <th>مدين</th>
                    <th>دائن</th>
                    <th>الرصيد</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.entries.length ? (
                    statement.entries.map((entry, index) => (
                      <tr key={`${entry.reference}-${index}`}>
                        <td className="text-xs">{formatDate(entry.date)}</td>
                        <td className="text-xs font-medium" dir="ltr">{entry.reference}</td>
                        <td className="text-xs">{entry.description}</td>
                        <td className="num text-xs">{entry.debitEgp ? formatMoney(entry.debitEgp) : '—'}</td>
                        <td className="num text-xs text-emerald-700">{entry.creditEgp ? formatMoney(entry.creditEgp) : '—'}</td>
                        <td className="num text-xs font-semibold">{formatMoney(entry.balanceEgp)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6}>
                        <EmptyState title="لا توجد حركات في الفترة" icon={<FileText size={20} />} />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* ===================== تفاصيل أمر شراء ===================== */}
      <Modal
        open={Boolean(detailsTarget)}
        onClose={() => {
          setDetailsTarget(null);
          setDetails(null);
        }}
        title={`تفاصيل ${detailsTarget?.poNumber ?? ''}`}
        subtitle={detailsTarget ? supplierOf(detailsTarget).name : undefined}
        size="lg"
      >
        {detailsTarget ? (
          <div className="space-y-4">
            <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
              <Info label="الحالة" value={PO_STATUS_LABELS[detailsTarget.status] ?? detailsTarget.status} />
              <Info label="تاريخ الإنشاء" value={formatDate(detailsTarget.createdAt)} />
              <Info label="التوريد المتوقع" value={formatDate(detailsTarget.expectedAt)} />
              <Info label="فاتورة المورد" value={detailsTarget.supplierInvoiceNumber || '—'} />
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>البند</th>
                    <th>المطلوب</th>
                    <th>المستلم</th>
                    <th>سعر الوحدة</th>
                    <th>الإجمالي</th>
                  </tr>
                </thead>
                <tbody>
                  {detailsTarget.lines.map((line) => (
                    <tr key={line._id}>
                      <td className="text-xs">{line.description}</td>
                      <td className="num text-xs">{formatNumber(line.quantityOrdered)}</td>
                      <td className="num text-xs">{formatNumber(line.quantityReceived)}</td>
                      <td className="num text-xs">{formatMoney(line.unitCostEgp)}</td>
                      <td className="num text-xs font-semibold">{formatMoney(line.totalEgp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="rounded-xl border border-ink-100 bg-ink-50 p-3 text-xs">
              <Row label="الإجمالي قبل الخصم" value={formatMoney(detailsTarget.totals.subtotalEgp)} />
              <Row label="الخصم" value={`- ${formatMoney(detailsTarget.totals.discountEgp)}`} />
              <Row label={`الضريبة (${detailsTarget.totals.taxRatePct}%)`} value={formatMoney(detailsTarget.totals.taxEgp)} />
              <Row label="الإجمالي" value={formatMoney(detailsTarget.totals.totalEgp)} strong />
              <Row label="المسدد" value={formatMoney(detailsTarget.totals.paidEgp)} />
              <Row label="المتبقي" value={formatMoney(detailsTarget.totals.dueEgp)} strong />
            </div>
            <div>
              <p className="mb-2 text-sm font-bold text-ink-800">سجل المدفوعات</p>
              {detailsLoading ? (
                <LoadingBlock rows={2} />
              ) : details?.payments.length ? (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>الإيصال</th>
                        <th>التاريخ</th>
                        <th>الطريقة</th>
                        <th>المبلغ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {details.payments.map((payment) => (
                        <tr key={payment._id}>
                          <td className="text-xs" dir="ltr">{payment.receiptNumber}</td>
                          <td className="text-xs">{formatDateTime(payment.paidAt)}</td>
                          <td className="text-xs">{PAYMENT_METHOD_LABELS[payment.method as keyof typeof PAYMENT_METHOD_LABELS] ?? payment.method}</td>
                          <td className="num text-xs font-semibold">{formatMoney(payment.amountEgp)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="rounded-lg border border-ink-100 px-3 py-2 text-xs text-ink-500">لا توجد مدفوعات بعد.</p>
              )}
            </div>
          </div>
        ) : null}
      </Modal>

      {/* ===================== مودال مورد ===================== */}
      <Modal
        open={supplierFormOpen}
        onClose={() => setSupplierFormOpen(false)}
        title={supplierEdit ? 'تعديل المورد' : 'مورد جديد'}
        size="md"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setSupplierFormOpen(false)} disabled={saving}>
              إلغاء
            </button>
            <button type="button" className="btn-primary" onClick={() => void submitSupplier()} disabled={saving}>
              {saving ? 'جارٍ الحفظ…' : 'حفظ المورد'}
            </button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="اسم المورد" required>
            <input className="input" value={supplierForm.name} onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })} />
          </Field>
          <Field label="النوع">
            <select className="input" value={supplierForm.type} onChange={(e) => setSupplierForm({ ...supplierForm, type: e.target.value })}>
              {Object.entries(SUPPLIER_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="الشخص المسؤول">
            <input
              className="input"
              value={supplierForm.contactPerson}
              onChange={(e) => setSupplierForm({ ...supplierForm, contactPerson: e.target.value })}
            />
          </Field>
          <Field label="الهاتف">
            <input className="input" value={supplierForm.phone} onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })} />
          </Field>
          <Field label="البريد الإلكتروني">
            <input
              type="email"
              className="input"
              value={supplierForm.email}
              onChange={(e) => setSupplierForm({ ...supplierForm, email: e.target.value })}
            />
          </Field>
          <Field label="المدينة">
            <input className="input" value={supplierForm.city} onChange={(e) => setSupplierForm({ ...supplierForm, city: e.target.value })} />
          </Field>
          <Field label="شروط الدفع">
            <input
              className="input"
              placeholder="مثال: 30 يومًا من الاستلام"
              value={supplierForm.paymentTerms}
              onChange={(e) => setSupplierForm({ ...supplierForm, paymentTerms: e.target.value })}
            />
          </Field>
          <Field label="ملاحظات">
            <input className="input" value={supplierForm.notes} onChange={(e) => setSupplierForm({ ...supplierForm, notes: e.target.value })} />
          </Field>
        </div>
      </Modal>

      {cancelTarget ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink-900/40 p-4" dir="rtl">
          <div className="card w-full max-w-md p-4">
            <p className="mb-2 text-sm font-bold text-ink-800">سبب إلغاء {cancelTarget.poNumber}</p>
            <textarea
              className="input h-20"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="مثال: تأخر المورد / تغيّر الطلب"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setCancelTarget(null)}>
                تراجع
              </button>
              <button type="button" className="btn-danger" onClick={() => void cancelPo()} disabled={busy === cancelTarget._id}>
                {busy === cancelTarget._id ? 'جارٍ الإلغاء…' : 'تأكيد الإلغاء'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ============================ عناصر مساعدة ============================ */

function Pager({
  meta,
  onPage,
}: {
  meta: { page: number; pages: number; total: number };
  onPage: (page: number) => void;
}) {
  if (meta.pages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-ink-100 px-4 py-2 text-xs text-ink-500">
      <span>
        صفحة {meta.page} من {meta.pages} — {formatNumber(meta.total)} سجل
      </span>
      <div className="flex gap-1">
        <button type="button" className="btn-ghost px-2 py-1" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>
          السابق
        </button>
        <button type="button" className="btn-ghost px-2 py-1" disabled={meta.page >= meta.pages} onClick={() => onPage(meta.page + 1)}>
          التالي
        </button>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-ink-100 px-3 py-2">
      <p className="text-ink-500">{label}</p>
      <p className="mt-0.5 font-semibold text-ink-800">{value}</p>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-0.5 ${strong ? 'font-bold text-ink-900' : 'text-ink-600'}`}>
      <span>{label}</span>
      <span className="num">{value}</span>
    </div>
  );
}
