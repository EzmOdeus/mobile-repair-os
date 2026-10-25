'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { CheckCircle2, Minus, Plus, Printer, Search, ShoppingBag, Trash2, Wallet } from 'lucide-react';
import { api, errorMessage, fetcher, qs } from '@/lib/api';
import { formatMoney, formatNumber } from '@/lib/format';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from '@/lib/constants';
import { Card, CardHeader, EmptyState, Field, LoadingBlock, PageHeader } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/lib/auth';

interface PartOption {
  _id: string;
  sku: string;
  name: string;
  category?: string;
  pricing: { costEgp?: number; sellingPriceEgp?: number };
  availableQty?: number;
  stock?: { onHand?: number; reserved?: number };
}

interface CartLine {
  partId: string;
  name: string;
  sku: string;
  unitPriceEgp: number;
  quantity: number;
  available: number;
}

interface PosResult {
  invoice: {
    _id: string;
    invoiceNumber: string;
    totals: { subtotalEgp: number; discountEgp: number; taxEgp: number; totalEgp: number; taxRatePct: number };
  };
  payment: { receiptNumber: string; amountEgp: number } | null;
  changeEgp: number;
  totals: { totalEgp: number; taxEgp: number; subtotalEgp: number; discountEgp: number };
}

export default function PosPage() {
  const toast = useToast();
  const { organization, availableBranches, activeBranchId } = useAuth();

  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discountEgp, setDiscountEgp] = useState('0');
  const [method, setMethod] = useState<string>('cash');
  const [amountPaid, setAmountPaid] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<PosResult | null>(null);

  const { data: partsData, isLoading } = useSWR<{ items: PartOption[] }>(
    `/parts${qs({ q: search || undefined, limit: 60, sort: 'name' })}`,
    fetcher,
  );
  const parts = partsData?.items ?? [];
  const activeBranch = availableBranches.find((branch) => branch.id === activeBranchId);

  const settings = (organization?.settings ?? {}) as { taxRate?: number; taxInclusive?: boolean };
  const taxRatePct = Number(settings.taxRate ?? 14);
  const taxInclusive = settings.taxInclusive !== false;

  const totals = useMemo(() => {
    const subtotal = cart.reduce((acc, line) => acc + line.quantity * line.unitPriceEgp, 0);
    const discount = Math.min(subtotal, Number(discountEgp) || 0);
    const afterDiscount = subtotal - discount;
    const tax = taxRatePct > 0
      ? taxInclusive
        ? afterDiscount - afterDiscount / (1 + taxRatePct / 100)
        : (afterDiscount * taxRatePct) / 100
      : 0;
    const total = taxInclusive ? afterDiscount : afterDiscount + tax;
    return { subtotal, discount, tax, total };
  }, [cart, discountEgp, taxRatePct, taxInclusive]);

  const paidAmount = amountPaid === '' ? totals.total : Number(amountPaid) || 0;
  const change = Math.max(0, paidAmount - totals.total);

  const addPart = (part: PartOption) => {
    if (!activeBranchId) {
      toast.warning('اختر فرعًا محددًا من مبدّل الفرع أولًا');
      return;
    }
    const available = part.availableQty ?? Math.max(0, (part.stock?.onHand ?? 0) - (part.stock?.reserved ?? 0));
    if (available <= 0) {
      toast.warning('هذه القطعة غير متاحة في المخزون');
      return;
    }
    setCart((prev) => {
      const existing = prev.find((line) => line.partId === part._id);
      if (existing) {
        if (existing.quantity >= available) {
          toast.warning('وصلت للكمية المتاحة من المخزون');
          return prev;
        }
        return prev.map((line) => (line.partId === part._id ? { ...line, quantity: line.quantity + 1 } : line));
      }
      return [
        ...prev,
        {
          partId: part._id,
          name: part.name,
          sku: part.sku,
          unitPriceEgp: part.pricing?.sellingPriceEgp ?? 0,
          quantity: 1,
          available,
        },
      ];
    });
  };

  const updateLine = (partId: string, patch: Partial<CartLine>) => {
    setCart((prev) => prev.map((line) => (line.partId === partId ? { ...line, ...patch } : line)));
  };

  const removeLine = (partId: string) => {
    setCart((prev) => prev.filter((line) => line.partId !== partId));
  };

  const resetSale = () => {
    setCart([]);
    setDiscountEgp('0');
    setAmountPaid('');
    setCustomerName('');
    setCustomerPhone('');
    setNotes('');
    setMethod('cash');
    setResult(null);
  };

  const checkout = async () => {
    if (!activeBranchId) return toast.error('اختر فرعًا محددًا من مبدّل الفرع أعلى الصفحة قبل تسجيل البيع');
    if (!cart.length) return toast.error('أضف قطعة واحدة على الأقل');
    if (cart.some((line) => line.quantity > line.available)) {
      return toast.error('كمية إحدى القطع أكبر من المتاح في المخزون');
    }
    if (method !== 'credit' && paidAmount + 0.009 < totals.total) {
      return toast.error('المبلغ المدفوع أقل من الإجمالي — اختر «آجل» لتسجيل المتبقي');
    }

    setSaving(true);
    try {
      const response = await api.post<PosResult>('/finance/pos/sale', {
        customerName: customerName.trim() || undefined,
        customerPhone: customerPhone.trim() || undefined,
        items: cart.map((line) => ({
          partId: line.partId,
          description: line.name,
          quantity: line.quantity,
          unitPriceEgp: line.unitPriceEgp,
        })),
        discountEgp: Number(discountEgp) || 0,
        paymentMethod: method,
        amountPaidEgp: method === 'credit' ? 0 : paidAmount,
        notes,
      });
      setResult(response);
      toast.success('تم إتمام البيع وخصم المخزون');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  if (result) {
    return (
      <div>
        <PageHeader title="نقاط البيع" subtitle="تمت العملية بنجاح" />
        <Card className="mx-auto max-w-lg">
          <div id="print-area" className="p-5">
            <div className="mb-4 flex items-center gap-2 text-emerald-700">
              <CheckCircle2 size={22} />
              <div>
                <p className="text-base font-bold text-ink-900">تم إتمام البيع</p>
                <p className="text-xs text-ink-500">{formatMoney(result.totals.totalEgp)}</p>
              </div>
            </div>
            <div className="space-y-1.5 rounded-xl border border-ink-100 bg-ink-50 p-3 text-xs">
              <SummaryRow label="رقم الفاتورة" value={result.invoice.invoiceNumber} />
              {result.payment ? (
                <SummaryRow label="رقم الإيصال" value={result.payment.receiptNumber} />
              ) : (
                <SummaryRow label="طريقة الدفع" value="آجل — على الحساب" />
              )}
              <SummaryRow label="قبل الخصم" value={formatMoney(result.totals.subtotalEgp)} />
              <SummaryRow label="الخصم" value={`- ${formatMoney(result.totals.discountEgp)}`} />
              <SummaryRow label={`الضريبة (${result.invoice.totals.taxRatePct}%)`} value={formatMoney(result.totals.taxEgp)} />
              <SummaryRow label="الإجمالي" value={formatMoney(result.totals.totalEgp)} strong />
              <SummaryRow label="المدفوع" value={formatMoney(result.payment?.amountEgp ?? 0)} />
              <SummaryRow
                label={result.payment ? 'الباقي للعميل' : 'المتبقي على العميل'}
                value={formatMoney(result.payment ? result.changeEgp : result.totals.totalEgp)}
                strong
              />
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-ink-100 p-3">
            <button type="button" className="btn-secondary" onClick={() => window.print()}>
              <Printer size={15} /> طباعة الإيصال
            </button>
            <a href={`/invoices/${result.invoice._id}`} className="btn-secondary">
              عرض الفاتورة
            </a>
            <button type="button" className="btn-primary" onClick={resetSale}>
              <Plus size={15} /> عملية جديدة
            </button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="نقاط البيع"
        subtitle={`بيع القطع والأكسسوارات مباشرة — ${activeBranch?.name ?? 'الفرع النشط'}`}
      />

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-3">
          <Card>
            <div className="border-b border-ink-100 p-3">
              <div className="relative">
                <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400" />
                <input
                  className="input pr-9"
                  placeholder="ابحث بالاسم أو الكود…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            {isLoading ? (
              <LoadingBlock rows={5} />
            ) : parts.length ? (
              <div className="grid max-h-[65vh] gap-2 overflow-y-auto p-3 sm:grid-cols-2 xl:grid-cols-3">
                {parts.map((part) => {
                  const available = part.availableQty ?? Math.max(0, (part.stock?.onHand ?? 0) - (part.stock?.reserved ?? 0));
                  return (
                    <button
                      key={part._id}
                      type="button"
                      onClick={() => addPart(part)}
                      disabled={available <= 0}
                      className="rounded-xl border border-ink-100 bg-white p-3 text-right transition hover:border-brand-300 hover:bg-brand-50/40 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-bold text-ink-800">{part.name}</p>
                          <p className="mt-0.5 text-[11px] text-ink-400" dir="ltr">
                            {part.sku}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-semibold text-ink-600">
                          {formatNumber(available)}
                        </span>
                      </div>
                      <p className="num mt-2 text-sm font-bold text-brand-800">
                        {formatMoney(part.pricing?.sellingPriceEgp ?? 0)}
                      </p>
                    </button>
                  );
                })}
              </div>
            ) : (
              <EmptyState title="لا توجد قطع مطابقة" icon={<ShoppingBag size={20} />} />
            )}
          </Card>
        </div>

        <Card className="lg:sticky lg:top-4 lg:self-start">
          <CardHeader title="سلة البيع" subtitle={`${formatNumber(cart.length)} صنف`} icon={<ShoppingBag size={18} />} />
          <div className="max-h-[38vh] space-y-2 overflow-y-auto p-3">
            {cart.length ? (
              cart.map((line) => (
                <div key={line.partId} className="rounded-lg border border-ink-100 p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-ink-800">{line.name}</p>
                      <p className="text-[11px] text-ink-400" dir="ltr">
                        {line.sku} — متاح {formatNumber(line.available)}
                      </p>
                    </div>
                    <button type="button" className="btn-ghost px-1.5 py-0.5 text-red-600" onClick={() => removeLine(line.partId)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="btn-ghost h-7 w-7 justify-center p-0"
                        onClick={() => updateLine(line.partId, { quantity: Math.max(1, line.quantity - 1) })}
                      >
                        <Minus size={13} />
                      </button>
                      <input
                        type="number"
                        min={1}
                        max={line.available}
                        className="input h-8 w-14 px-1 text-center text-xs"
                        value={line.quantity}
                        onChange={(e) =>
                          updateLine(line.partId, {
                            quantity: Math.max(1, Math.min(line.available, Number(e.target.value) || 1)),
                          })
                        }
                      />
                      <button
                        type="button"
                        className="btn-ghost h-7 w-7 justify-center p-0"
                        onClick={() => updateLine(line.partId, { quantity: Math.min(line.available, line.quantity + 1) })}
                      >
                        <Plus size={13} />
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="input h-8 w-24 px-2 text-xs"
                        value={line.unitPriceEgp}
                        onChange={(e) => updateLine(line.partId, { unitPriceEgp: Number(e.target.value) || 0 })}
                      />
                      <span className="num min-w-20 text-left text-xs font-bold text-ink-800">
                        {formatMoney(line.quantity * line.unitPriceEgp)}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <p className="py-8 text-center text-xs text-ink-400">اضغط على قطعة لإضافتها للسلة.</p>
            )}
          </div>

          <div className="space-y-3 border-t border-ink-100 p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="اسم العميل (اختياري)">
                <input className="input" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
              </Field>
              <Field label="هاتف العميل (اختياري)">
                <input className="input" dir="ltr" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
              </Field>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="خصم (ج.م)">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="input"
                  value={discountEgp}
                  onChange={(e) => setDiscountEgp(e.target.value)}
                />
              </Field>
              <Field label="طريقة الدفع">
                <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
                  {PAYMENT_METHODS.map((item) => (
                    <option key={item} value={item}>
                      {PAYMENT_METHOD_LABELS[item]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            {method !== 'credit' ? (
              <Field label="المبلغ المدفوع">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="input"
                  placeholder={String(totals.total)}
                  value={amountPaid}
                  onChange={(e) => setAmountPaid(e.target.value)}
                />
              </Field>
            ) : null}

            <div className="rounded-xl bg-ink-50 p-3 text-xs">
              <SummaryRow label="المجموع" value={formatMoney(totals.subtotal)} />
              <SummaryRow label="الخصم" value={`- ${formatMoney(totals.discount)}`} />
              <SummaryRow label={`الضريبة (${taxRatePct}%)`} value={formatMoney(totals.tax)} />
              <SummaryRow label="الإجمالي" value={formatMoney(totals.total)} strong />
              {method !== 'credit' ? <SummaryRow label="الباقي" value={formatMoney(change)} /> : null}
            </div>

            {!activeBranchId ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[11px] leading-relaxed text-amber-800">
                أنت تعرض «كل الفروع». اختر فرعًا محددًا من مبدّل الفرع أعلى الصفحة لتسجيل بيع على مخزونه.
              </p>
            ) : null}

            <button
              type="button"
              className="btn-primary w-full justify-center"
              onClick={() => void checkout()}
              disabled={saving || !cart.length || !activeBranchId}
            >
              <Wallet size={16} />
              {saving ? 'جارٍ إتمام البيع…' : `تحصيل ${formatMoney(totals.total)}`}
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
}

function SummaryRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-0.5 ${strong ? 'text-sm font-bold text-ink-900' : 'text-ink-600'}`}>
      <span>{label}</span>
      <span className="num">{value}</span>
    </div>
  );
}
