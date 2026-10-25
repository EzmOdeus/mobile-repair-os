'use client';

import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import {
  ArrowRight,
  BadgeDollarSign,
  Calculator,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  Store,
  TrendingUp,
} from 'lucide-react';
import { api, errorMessage, fetcher, qs } from '@/lib/api';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import {
  CONDITION_LABELS,
  GRADE_LABELS,
  type MarketPriceList,
  type MarketPriceRow,
  type PhoneValuation,
} from '@/lib/market';
import { Badge, Card, CardHeader, EmptyState, Field, LoadingBlock, PageHeader } from '@/components/ui';

const DEFAULT_QUERY = { brand: '', model: '', storage: '', condition: 'used', grade: 'good' };

export default function MarketPricesPage() {
  const [form, setForm] = useState(DEFAULT_QUERY);
  const [valuation, setValuation] = useState<PhoneValuation | null>(null);
  const [valuing, setValuing] = useState(false);
  const [valuationError, setValuationError] = useState('');

  const [tableFilters, setTableFilters] = useState({ q: '', condition: 'used', grade: 'none' });
  const [applied, setApplied] = useState(tableFilters);

  const prices = useSWR<MarketPriceList>(
    `/market/prices${qs({ q: applied.q, condition: applied.condition, grade: applied.grade })}`,
    fetcher,
    { refreshInterval: 120_000 },
  );

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  async function evaluate(query = form) {
    if (!query.brand.trim() || !query.model.trim()) {
      setValuationError('أدخل الماركة والموديل أولًا');
      return;
    }
    setValuing(true);
    setValuationError('');
    try {
      const result = await api.get<PhoneValuation>(
        `/market/prices/valuation${qs({
          brand: query.brand,
          model: query.model,
          storage: query.storage,
          condition: query.condition,
          grade: query.condition === 'new' ? 'none' : query.grade,
        })}`,
      );
      setValuation(result);
    } catch (err) {
      setValuationError(errorMessage(err));
      setValuation(null);
    } finally {
      setValuing(false);
    }
  }

  const valueRow = (row: MarketPriceRow) => {
    const next = {
      brand: row.brand,
      model: row.model,
      storage: row.storage,
      condition: row.condition,
      grade: row.condition === 'new' ? 'none' : row.grade === 'none' ? 'good' : row.grade,
    };
    setForm(next);
    void evaluate(next);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const createLink = valuation?.available && valuation.valuation
    ? `/market/new${qs({
        brand: valuation.query.brand,
        model: valuation.query.model,
        storage: valuation.query.storage,
        condition: valuation.query.condition,
        price: valuation.valuation.suggestedPriceEgp,
      })}`
    : '/market/new';

  return (
    <div>
      <PageHeader
        title="بورصة أسعار التليفونات"
        subtitle="تقييم هجين: دليل أسعار تديره المنصة + مؤشر مباشر من إعلانات السوق العامة المعتمدة"
        breadcrumb={
          <Link href="/market" className="inline-flex items-center gap-1 hover:text-brand-700">
            <ArrowRight size={12} />
            ماركت بلس
          </Link>
        }
        actions={
          <>
            <Link href="/market" className="btn-secondary">
              <Store size={15} />
              السوق
            </Link>
            <Link href={createLink} className="btn-primary">
              <TrendingUp size={15} />
              انشر بسعر التقييم
            </Link>
          </>
        }
      />

      <div className="mb-5 grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader title="تقييم جهاز" subtitle="جديد أو مستعمل، بحسب بيانات السوق الحالية" icon={<Calculator size={18} />} />
          <form
            className="space-y-3 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              void evaluate();
            }}
          >
            <Field label="الماركة" required>
              <input
                required
                value={form.brand}
                onChange={(e) => set('brand', e.target.value)}
                className="input"
                placeholder="Apple / Samsung / Xiaomi"
              />
            </Field>
            <Field label="الموديل" required>
              <input
                required
                value={form.model}
                onChange={(e) => set('model', e.target.value)}
                className="input"
                placeholder="iPhone 13 Pro"
              />
            </Field>
            <Field label="السعة التخزينية">
              <input value={form.storage} onChange={(e) => set('storage', e.target.value)} className="input" placeholder="128GB" />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="الحالة" required>
                <select
                  value={form.condition}
                  onChange={(e) => {
                    const condition = e.target.value;
                    setForm((prev) => ({
                      ...prev,
                      condition,
                      grade: condition === 'new' ? 'none' : prev.grade === 'none' ? 'good' : prev.grade,
                    }));
                  }}
                  className="input"
                >
                  <option value="used">مستعمل</option>
                  <option value="new">جديد</option>
                </select>
              </Field>
              <Field label="درجة الحالة" hint={form.condition === 'new' ? 'الجديد بدون درجة' : undefined}>
                <select
                  value={form.grade}
                  disabled={form.condition === 'new'}
                  onChange={(e) => set('grade', e.target.value)}
                  className="input"
                >
                  {Object.entries(GRADE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {valuationError ? <p className="text-xs text-red-600">{valuationError}</p> : null}
            <button type="submit" className="btn-primary w-full" disabled={valuing}>
              {valuing ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              احسب السعر السوقي
            </button>
            <p className="text-[11px] leading-relaxed text-ink-400">
              المعادلة: 60% من دليل المنصة + 40% من مؤشر الإعلانات عند توفر 3 إعلانات على الأقل. في حال وجود دليل أساسي
              فقط، تُطبَّق درجة الحالة (ممتاز 85%، جيد 75%، مقبول 60%، قطع غيار 35%).
            </p>
          </form>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader title="نتيجة التقييم" icon={<BadgeDollarSign size={18} />} />
          {valuing ? (
            <LoadingBlock rows={5} />
          ) : !valuation ? (
            <EmptyState
              title="أدخل بيانات الجهاز لحساب السعر"
              description="نستخدم دليل المنصة ومؤشر الإعلانات المعتمدة لإعطائك نطاق سعر وسعرًا مقترحًا."
              icon={<Calculator size={24} />}
            />
          ) : !valuation.available ? (
            <EmptyState title="لا توجد بيانات كافية" description={valuation.message} icon={<TrendingUp size={24} />} />
          ) : (
            <div className="space-y-4 p-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <PriceBlock
                  title="سعر دليل المنصة"
                  tone="sky"
                  block={valuation.guide}
                  note={
                    valuation.guide
                      ? valuation.guide.basis === 'base_with_grade_factor'
                        ? `مطبّق معامل درجة الحالة × ${valuation.guide.factor}`
                        : valuation.guide.basis === 'grade_specific'
                          ? 'سعر خاص بدرجة الحالة'
                          : 'سعر أساسي بدون معامل'
                      : undefined
                  }
                />
                <PriceBlock
                  title="مؤشر إعلانات السوق"
                  tone="emerald"
                  block={valuation.market}
                  note={valuation.market ? `من ${formatNumber(valuation.market.count)} إعلانًا معتمدًا` : undefined}
                />
                <div className="rounded-lg border border-brand-200 bg-brand-50/60 p-3">
                  <p className="text-xs font-semibold text-brand-700">السعر المقترح</p>
                  <p className="mt-1 text-2xl font-bold text-brand-900 num">{formatMoney(valuation.valuation?.suggestedPriceEgp)}</p>
                  <p className="mt-1 text-[11px] text-ink-500">
                    نطاق {formatMoney(valuation.valuation?.lowEgp, false)} — {formatMoney(valuation.valuation?.highEgp)}
                  </p>
                  <p className="mt-1 text-[11px] font-semibold text-ink-600">
                    الثقة: {valuation.valuation?.confidence === 'high' ? 'عالية (دليل + سوق)' : 'متوسطة (مصدر واحد)'}
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-ink-100 bg-ink-50/50 p-3">
                <p className="text-xs font-semibold text-ink-600">
                  أساس التقييم: {valuation.valuation?.basis.join(' + ')}
                </p>
                <p className="mt-1 text-[11px] text-ink-500">
                  {valuation.query.brand} {valuation.query.model}
                  {valuation.query.storage ? ` — ${valuation.query.storage}` : ''} —{' '}
                  {valuation.query.condition === 'new' ? 'جديد' : `مستعمل / ${GRADE_LABELS[valuation.query.grade] ?? valuation.query.grade}`}
                </p>
                {valuation.guide?.sourceNote ? <p className="mt-1 text-[11px] text-ink-400">ملاحظة الدليل: {valuation.guide.sourceNote}</p> : null}
                {valuation.guide?.effectiveFrom ? (
                  <p className="mt-0.5 text-[11px] text-ink-400">سعر الدليل ساري من {formatDate(valuation.guide.effectiveFrom)}</p>
                ) : null}
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                <Link href={createLink} className="btn-primary btn-sm">
                  <TrendingUp size={14} />
                  استخدم السعر في إعلان جديد
                </Link>
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader
          title="أسعار السوق"
          subtitle="دليل المنصة ومؤشر الإعلانات جنبًا إلى جنب — الفارق يوضح فرصة البيع أو الشراء"
          icon={<TrendingUp size={18} />}
          action={
            <button type="button" className="btn-ghost btn-sm" onClick={() => void prices.mutate()}>
              <RefreshCw size={14} />
              تحديث
            </button>
          }
        />
        <div className="flex flex-wrap items-end gap-2 border-b border-ink-100 px-4 py-3">
          <div className="relative min-w-52 flex-1">
            <Search size={15} className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-ink-400" />
            <input
              value={tableFilters.q}
              onChange={(e) => setTableFilters((f) => ({ ...f, q: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setApplied(tableFilters);
                }
              }}
              placeholder="ابحث بالماركة أو الموديل…"
              className="input pr-9"
            />
          </div>
          <select
            value={tableFilters.condition}
            onChange={(e) => setTableFilters((f) => ({ ...f, condition: e.target.value }))}
            className="input w-auto"
          >
            <option value="used">مستعمل</option>
            <option value="new">جديد</option>
          </select>
          <select
            value={tableFilters.grade}
            disabled={tableFilters.condition === 'new'}
            onChange={(e) => setTableFilters((f) => ({ ...f, grade: e.target.value }))}
            className="input w-auto"
          >
            {Object.entries(GRADE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button type="button" className="btn-primary btn-sm" onClick={() => setApplied(tableFilters)}>
            <Search size={14} />
            بحث
          </button>
        </div>

        {prices.isLoading ? (
          <LoadingBlock rows={6} />
        ) : prices.error ? (
          <div className="card-pad text-sm text-red-700">تعذر تحميل الأسعار: {errorMessage(prices.error)}</div>
        ) : !prices.data?.items.length ? (
          <EmptyState
            title="لا توجد أسعار بعد"
            description={`لا يوجد دليل مطابق ولا ${formatNumber(prices.data?.meta.sampleThreshold ?? 3)} إعلانات سوق مكتملة لهذه الفئة حتى الآن.`}
            icon={<TrendingUp size={24} />}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>الجهاز</th>
                  <th>حالة الدليل</th>
                  <th>دليل المنصة (أقل — متوسط — أعلى)</th>
                  <th>مؤشر السوق (أقل — متوسط — أعلى)</th>
                  <th>عدد الإعلانات</th>
                  <th>فرق الدليل عن السوق</th>
                  <th className="text-left">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {prices.data.items.map((row) => (
                  <tr key={row.key}>
                    <td>
                      <p className="font-bold text-ink-800">
                        {row.brand} {row.model}
                      </p>
                      <p className="text-[11px] text-ink-400">
                        {row.storage || 'بدون سعة'} — {CONDITION_LABELS[row.condition]}
                      </p>
                    </td>
                    <td>
                      <Badge>{GRADE_LABELS[row.grade] ?? row.grade}</Badge>
                    </td>
                    <td className="num text-xs">
                      {row.guide ? (
                        <>
                          <p className="font-bold text-sky-800">{formatMoney(row.guide.avgEgp)}</p>
                          <p className="text-[11px] text-ink-400">
                            {formatMoney(row.guide.lowEgp, false)} — {formatMoney(row.guide.highEgp)}
                          </p>
                        </>
                      ) : (
                        <span className="text-ink-300">—</span>
                      )}
                    </td>
                    <td className="num text-xs">
                      {row.market ? (
                        <>
                          <p className="font-bold text-emerald-800">{formatMoney(row.market.avgEgp)}</p>
                          <p className="text-[11px] text-ink-400">
                            {formatMoney(row.market.lowEgp, false)} — {formatMoney(row.market.highEgp)}
                          </p>
                        </>
                      ) : (
                        <span className="text-ink-300">—</span>
                      )}
                    </td>
                    <td className="num text-xs text-ink-500">{row.market ? formatNumber(row.market.count) : '—'}</td>
                    <td>
                      {row.spreadPct === null ? (
                        <span className="text-xs text-ink-300">—</span>
                      ) : (
                        <span
                          className={
                            row.spreadPct > 5
                              ? 'text-xs font-bold text-amber-600'
                              : row.spreadPct < -5
                                ? 'text-xs font-bold text-emerald-600'
                                : 'text-xs font-semibold text-ink-500'
                          }
                        >
                          {row.spreadPct > 0 ? '+' : ''}
                          {row.spreadPct}%
                        </span>
                      )}
                    </td>
                    <td className="text-left">
                      <button type="button" className="btn-secondary btn-sm" onClick={() => valueRow(row)}>
                        تقييم
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {prices.data ? (
          <p className="border-t border-ink-100 px-4 py-2.5 text-[11px] text-ink-400">
            مؤشر السوق يُحدّث من الإعلانات العامة النشطة/المحجوزة فقط، ولا يظهر إلا عند توفر{' '}
            {formatNumber(prices.data.meta.sampleThreshold)} إعلانات على الأقل — الدليل: {formatNumber(prices.data.meta.guideCount)}،
            المؤشر: {formatNumber(prices.data.meta.marketCount)}.
          </p>
        ) : null}
      </Card>
    </div>
  );
}

function PriceBlock({
  title,
  block,
  tone,
  note,
}: {
  title: string;
  block: { lowEgp: number; avgEgp: number; highEgp: number } | null;
  tone: 'sky' | 'emerald';
  note?: string;
}) {
  const styles = tone === 'sky' ? 'border-sky-200 bg-sky-50/60' : 'border-emerald-200 bg-emerald-50/60';
  const text = tone === 'sky' ? 'text-sky-800' : 'text-emerald-800';
  return (
    <div className={`rounded-lg border p-3 ${styles}`}>
      <p className={`text-xs font-semibold ${text}`}>{title}</p>
      {block ? (
        <>
          <p className="mt-1 text-xl font-bold text-ink-900 num">{formatMoney(block.avgEgp)}</p>
          <p className="mt-1 text-[11px] text-ink-500">
            {formatMoney(block.lowEgp, false)} — {formatMoney(block.highEgp)}
          </p>
          {note ? <p className="mt-1 text-[11px] text-ink-500">{note}</p> : null}
        </>
      ) : (
        <p className="mt-2 text-xs text-ink-400">لا تتوفر بيانات</p>
      )}
    </div>
  );
}
