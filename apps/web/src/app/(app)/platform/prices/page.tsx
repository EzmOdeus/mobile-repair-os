'use client';

import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import { BadgeDollarSign, Loader2, Pencil, Plus, RefreshCw, Search, ShieldCheck, Tag, XCircle } from 'lucide-react';
import { api, errorMessage, fetcher, qs, type Paginated } from '@/lib/api';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { CONDITION_LABELS, GRADE_LABELS, type PlatformPriceGuide } from '@/lib/market';
import { Badge, Card, CardHeader, EmptyState, Field, LoadingBlock, PageHeader, StatCard } from '@/components/ui';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';

interface PlatformMarketStats {
  pending: number;
  active: number;
  priceGuides: number;
}

const EMPTY_FORM = {
  brand: '',
  model: '',
  storage: '',
  condition: 'used' as 'used' | 'new',
  grade: 'good',
  lowEgp: '',
  avgEgp: '',
  highEgp: '',
  sourceNote: '',
  isActive: true,
};

export default function PlatformPricesPage() {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [condition, setCondition] = useState('');
  const [active, setActive] = useState('');
  const [editing, setEditing] = useState<PlatformPriceGuide | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deactivateFor, setDeactivateFor] = useState<PlatformPriceGuide | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');

  const stats = useSWR<PlatformMarketStats>('/platform/market/stats', fetcher, { refreshInterval: 60_000 });
  const guides = useSWR<Paginated<PlatformPriceGuide>>(
    `/platform/market/prices${qs({ q: query, condition, active, limit: 200 })}`,
    fetcher,
    { refreshInterval: 120_000 },
  );

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((prev) => ({ ...prev, [key]: value }));

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setFormOpen(true);
  }

  function openEdit(guide: PlatformPriceGuide) {
    setEditing(guide);
    setForm({
      brand: guide.brand,
      model: guide.model,
      storage: guide.storage,
      condition: guide.condition,
      grade: guide.grade === 'none' ? 'good' : guide.grade,
      lowEgp: String(guide.lowEgp),
      avgEgp: String(guide.avgEgp),
      highEgp: String(guide.highEgp),
      sourceNote: guide.sourceNote,
      isActive: guide.isActive,
    });
    setFormError('');
    setFormOpen(true);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const low = Number(form.lowEgp);
    const avg = Number(form.avgEgp);
    const high = Number(form.highEgp);
    if (!(low > 0) || !(avg > 0) || !(high > 0)) {
      setFormError('كل الأسعار يجب أن تكون أكبر من صفر');
      return;
    }
    if (low > avg || avg > high) {
      setFormError('ترتيب الأسعار يجب أن يكون: الأقل ≤ المتوسط ≤ الأعلى');
      return;
    }
    setBusy(true);
    setFormError('');
    const payload = {
      brand: form.brand.trim(),
      model: form.model.trim(),
      storage: form.storage.trim(),
      condition: form.condition,
      grade: form.condition === 'new' ? 'none' : form.grade,
      lowEgp: low,
      avgEgp: avg,
      highEgp: high,
      sourceNote: form.sourceNote.trim(),
      isActive: form.isActive,
    };
    try {
      if (editing) {
        await api.patch(`/platform/market/prices/${editing.id}`, payload);
        toast.success('تم تحديث سعر الدليل');
      } else {
        await api.post('/platform/market/prices', payload);
        toast.success('تم حفظ سعر الدليل');
      }
      setFormOpen(false);
      void guides.mutate();
      void stats.mutate();
    } catch (err) {
      const message = errorMessage(err);
      setFormError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  async function deactivate(guide: PlatformPriceGuide) {
    setBusy(true);
    try {
      await api.del(`/platform/market/prices/${guide.id}`);
      toast.success('تم تعطيل سعر الدليل — لن يظهر للمراكز');
      setDeactivateFor(null);
      void guides.mutate();
      void stats.mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="دليل أسعار المنصة"
        subtitle="الأسعار المركزية الجديدة والمستعملة — تُدمج مع مؤشر الإعلانات في بورصة الأسعار"
        actions={
          <>
            <Link href="/platform/market" className="btn-secondary">
              <ShieldCheck size={15} />
              مراجعة السوق
            </Link>
            <button type="button" className="btn-primary" onClick={openCreate}>
              <Plus size={15} />
              إضافة سعر
            </button>
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="أسعار دليل نشطة" value={formatNumber(stats.data?.priceGuides)} icon={<Tag size={20} />} tone="info" />
        <StatCard label="إعلانات بانتظار المراجعة" value={formatNumber(stats.data?.pending)} icon={<ShieldCheck size={20} />} tone="warning" />
        <StatCard label="إعلانات عامة نشطة" value={formatNumber(stats.data?.active)} icon={<BadgeDollarSign size={20} />} tone="success" />
      </div>

      <Card>
        <CardHeader
          title="الأسعار المسجّلة"
          subtitle={guides.data ? `${formatNumber(guides.data.meta.total)} سعرًا — تشمل المعطّلة` : undefined}
          icon={<Tag size={18} />}
          action={
            <button type="button" className="btn-ghost btn-sm" onClick={() => void guides.mutate()}>
              <RefreshCw size={14} />
              تحديث
            </button>
          }
        />
        <div className="flex flex-wrap items-end gap-2 border-b border-ink-100 px-4 py-3">
          <div className="relative min-w-52 flex-1">
            <Search size={15} className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-ink-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && setQuery(search)}
              placeholder="بحث بالماركة أو الموديل…"
              className="input pr-9"
            />
          </div>
          <select value={condition} onChange={(e) => setCondition(e.target.value)} className="input w-auto">
            <option value="">جديد ومستعمل</option>
            <option value="new">جديد</option>
            <option value="used">مستعمل</option>
          </select>
          <select value={active} onChange={(e) => setActive(e.target.value)} className="input w-auto">
            <option value="">كل الحالات</option>
            <option value="true">نشط</option>
            <option value="false">معطّل</option>
          </select>
          <button type="button" className="btn-primary btn-sm" onClick={() => setQuery(search)}>
            <Search size={14} />
            بحث
          </button>
        </div>

        {guides.isLoading ? (
          <LoadingBlock rows={6} />
        ) : guides.error ? (
          <div className="card-pad text-sm text-red-700">تعذر تحميل الأسعار: {errorMessage(guides.error)}</div>
        ) : !guides.data?.items.length ? (
          <EmptyState
            title="لا توجد أسعار في الدليل"
            description="أضف أسعار السوق الجديدة والمستعملة لتستخدمها المراكز في التقييم ونشر الإعلانات."
            icon={<Tag size={24} />}
            action={
              <button type="button" className="btn-primary btn-sm" onClick={openCreate}>
                <Plus size={14} />
                إضافة أول سعر
              </button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>الجهاز</th>
                  <th>الحالة / الدرجة</th>
                  <th>أقل</th>
                  <th>متوسط</th>
                  <th>أعلى</th>
                  <th>الحالة</th>
                  <th>آخر تحديث</th>
                  <th className="text-left">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {guides.data.items.map((guide) => (
                  <tr key={guide.id}>
                    <td>
                      <p className="font-bold text-ink-800">
                        {guide.brand} {guide.model}
                      </p>
                      <p className="text-[11px] text-ink-400">{guide.storage || 'بدون سعة'}</p>
                      {guide.sourceNote ? <p className="text-[11px] text-ink-400">{guide.sourceNote}</p> : null}
                    </td>
                    <td>
                      <Badge className={guide.condition === 'new' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : ''}>
                        {CONDITION_LABELS[guide.condition]}
                      </Badge>
                      {guide.condition === 'used' ? <p className="mt-1 text-[11px] text-ink-400">{GRADE_LABELS[guide.grade] ?? guide.grade}</p> : null}
                    </td>
                    <td className="num text-xs text-ink-600">{formatMoney(guide.lowEgp, false)}</td>
                    <td className="num text-sm font-bold text-ink-800">{formatMoney(guide.avgEgp, false)}</td>
                    <td className="num text-xs text-ink-600">{formatMoney(guide.highEgp, false)}</td>
                    <td>
                      <Badge className={guide.isActive ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-ink-100 text-ink-500 border-ink-200'}>
                        {guide.isActive ? 'نشط' : 'معطّل'}
                      </Badge>
                    </td>
                    <td className="text-xs text-ink-500">{formatDate(guide.updatedAt)}</td>
                    <td>
                      <div className="flex justify-end gap-1.5">
                        <button type="button" className="btn-ghost btn-sm" onClick={() => openEdit(guide)}>
                          <Pencil size={13} />
                          تعديل
                        </button>
                        {guide.isActive ? (
                          <button type="button" className="btn-ghost btn-sm text-red-600" onClick={() => setDeactivateFor(guide)}>
                            <XCircle size={13} />
                            تعطيل
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {guides.data ? (
          <p className="border-t border-ink-100 px-4 py-2.5 text-[11px] text-ink-400">
            ملاحظة: إضافة سعر بنفس الماركة والموديل والسعة والحالة والدرجة تحدّث السعر الحالي وتجدّد تاريخ السريان.
          </p>
        ) : null}
      </Card>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'تعديل سعر الدليل' : 'إضافة سعر دليل'}
        subtitle="السعر المتوسط هو ما يظهر كسعر دليل أساسي في التقييم"
        size="md"
      >
        <form onSubmit={save} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="الماركة" required>
              <input required maxLength={60} value={form.brand} onChange={(e) => set('brand', e.target.value)} className="input" />
            </Field>
            <Field label="الموديل" required>
              <input required maxLength={60} value={form.model} onChange={(e) => set('model', e.target.value)} className="input" />
            </Field>
            <Field label="السعة التخزينية">
              <input maxLength={30} value={form.storage} onChange={(e) => set('storage', e.target.value)} className="input" placeholder="128GB" />
            </Field>
            <Field label="الحالة" required>
              <select
                value={form.condition}
                onChange={(e) => {
                  const value = e.target.value as 'used' | 'new';
                  setForm((prev) => ({ ...prev, condition: value, grade: value === 'new' ? 'none' : 'good' }));
                }}
                className="input"
              >
                <option value="used">مستعمل</option>
                <option value="new">جديد</option>
              </select>
            </Field>
            <Field label="درجة الحالة">
              <select
                value={form.grade}
                disabled={form.condition === 'new'}
                onChange={(e) => set('grade', e.target.value)}
                className="input"
              >
                {Object.entries(GRADE_LABELS)
                  .filter(([value]) => value !== 'none')
                  .map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="الترتيب" hint={form.condition === 'new' ? 'الجديد بدون درجة' : 'الدرجة تحدد نوع السعر'}>
              <div className="input flex items-center bg-ink-50 text-xs text-ink-500">{form.condition === 'new' ? 'جديد' : GRADE_LABELS[form.grade]}</div>
            </Field>
            <Field label="أقل سعر (ج.م)" required>
              <input required type="number" min={1} step="0.01" value={form.lowEgp} onChange={(e) => set('lowEgp', e.target.value)} className="input" />
            </Field>
            <Field label="متوسط السعر (ج.م)" required>
              <input required type="number" min={1} step="0.01" value={form.avgEgp} onChange={(e) => set('avgEgp', e.target.value)} className="input" />
            </Field>
            <Field label="أعلى سعر (ج.م)" required>
              <input required type="number" min={1} step="0.01" value={form.highEgp} onChange={(e) => set('highEgp', e.target.value)} className="input" />
            </Field>
            <Field label="ملاحظة المصدر">
              <input maxLength={300} value={form.sourceNote} onChange={(e) => set('sourceNote', e.target.value)} className="input" placeholder="متوسط السوق — أكتوبر 2026" />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input type="checkbox" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} className="h-4 w-4 accent-brand-700" />
            سعر نشط ويظهر للمراكز
          </label>
          {formError ? <p className="text-xs text-red-600">{formError}</p> : null}
          <div className="flex justify-end gap-2 border-t border-ink-100 pt-3">
            <button type="button" className="btn-secondary" onClick={() => setFormOpen(false)} disabled={busy}>
              إلغاء
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : null}
              حفظ السعر
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deactivateFor)}
        title="تعطيل سعر الدليل"
        message={`لن يظهر سعر «${deactivateFor?.brand ?? ''} ${deactivateFor?.model ?? ''}» للمراكز بعد التعطيل، ويمكن إعادة تفعيله بالتعديل.`}
        confirmLabel="تعطيل"
        onCancel={() => setDeactivateFor(null)}
        onConfirm={() => deactivateFor && void deactivate(deactivateFor)}
        isLoading={busy}
      />
    </div>
  );
}
