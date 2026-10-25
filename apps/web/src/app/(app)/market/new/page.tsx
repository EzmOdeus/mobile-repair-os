'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { ArrowRight, Building2, Info, Loader2, Save, Store } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CATEGORY_LABELS, CONDITION_LABELS, type MarketListing } from '@/lib/market';
import { Card, CardHeader, Field, PageHeader } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';

interface FormState {
  scope: 'public' | 'internal';
  kind: 'sell' | 'wanted';
  category: string;
  title: string;
  description: string;
  brand: string;
  model: string;
  storage: string;
  ram: string;
  color: string;
  condition: string;
  batteryHealth: string;
  warrantyDays: string;
  includes: string;
  priceEgp: string;
  negotiable: boolean;
  quantity: string;
  expiresInDays: string;
  contactName: string;
  contactPhone: string;
  contactWhatsapp: string;
  governorate: string;
  city: string;
  area: string;
}

export default function NewMarketListingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('market:manage');

  const [form, setForm] = useState<FormState>({
    scope: 'public',
    kind: 'sell',
    category: 'smartphone',
    title: '',
    description: '',
    brand: searchParams.get('brand') ?? '',
    model: searchParams.get('model') ?? '',
    storage: searchParams.get('storage') ?? '',
    ram: '',
    color: '',
    condition: searchParams.get('condition') === 'new' ? 'new' : (searchParams.get('condition') ?? 'good'),
    batteryHealth: '',
    warrantyDays: '0',
    includes: '',
    priceEgp: searchParams.get('price') ?? '',
    negotiable: true,
    quantity: '1',
    expiresInDays: '30',
    contactName: '',
    contactPhone: '',
    contactWhatsapp: '',
    governorate: '',
    city: '',
    area: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const isUsed = form.condition !== 'new';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canManage) {
      toast.error('لا تملك صلاحية نشر إعلانات');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const listing = await api.post<MarketListing>('/market/listings', {
        scope: form.scope,
        kind: form.kind,
        category: form.category,
        title: form.title.trim(),
        description: form.description.trim(),
        brand: form.brand.trim(),
        model: form.model.trim(),
        storage: form.storage.trim(),
        ram: form.ram.trim(),
        color: form.color.trim(),
        condition: form.condition,
        batteryHealth: isUsed && form.batteryHealth ? Number(form.batteryHealth) : null,
        warrantyDays: Number(form.warrantyDays) || 0,
        includes: form.includes
          .split(/[,،]/)
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 10),
        priceEgp: Number(form.priceEgp),
        negotiable: form.negotiable,
        quantity: Number(form.quantity) || 1,
        expiresInDays: Number(form.expiresInDays) || 30,
        contactName: form.contactName.trim(),
        contactPhone: form.contactPhone.trim(),
        contactWhatsapp: form.contactWhatsapp.trim(),
        location: {
          governorate: form.governorate.trim(),
          city: form.city.trim(),
          area: form.area.trim(),
        },
      });

      toast.success(
        listing.scope === 'public'
          ? 'تم إرسال الإعلان لمراجعة المنصة قبل النشر في السوق العام'
          : 'تم نشر الإعلان في السوق الداخلي بين الفروع',
      );
      router.push(`/market/${listing.id}`);
    } catch (err) {
      const message = errorMessage(err);
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  if (!canManage) {
    return (
      <div>
        <PageHeader title="إعلان جديد" subtitle="نشر إعلان في ماركت بلس" />
        <Card className="card-pad text-sm text-red-700">لا تملك صلاحية إدارة إعلانات السوق. تواصل مع مالك المركز.</Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="إعلان جديد"
        subtitle="السوق العام يخضع لمراجعة المنصة، والسوق الداخلي يُنشر فورًا بين فروع مركزك"
        breadcrumb={
          <Link href="/market" className="inline-flex items-center gap-1 hover:text-brand-700">
            <ArrowRight size={12} />
            ماركت بلس
          </Link>
        }
      />

      <form onSubmit={submit} className="space-y-4">
        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>
        ) : null}

        <Card>
          <CardHeader
            title="نطاق الإعلان"
            subtitle="السوق العام يظهر لكل مراكز المنصة، والداخلي لفروع مركزك فقط"
            icon={<Store size={18} />}
          />
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            {(
              [
                ['public', 'السوق العام', 'بين مراكز الصيانة — يُنشر بعد مراجعة المنصة', <Store key="p" size={20} />],
                ['internal', 'السوق الداخلي', 'بين فروع مركزك — يُنشر فورًا', <Building2 key="i" size={20} />],
              ] as const
            ).map(([value, label, hint, icon]) => (
              <button
                key={value}
                type="button"
                onClick={() => set('scope', value)}
                className={
                  form.scope === value
                    ? 'flex items-start gap-3 rounded-xl border-2 border-brand-600 bg-brand-50/50 p-3 text-right'
                    : 'flex items-start gap-3 rounded-xl border border-ink-200 p-3 text-right hover:border-brand-300'
                }
              >
                <span className={form.scope === value ? 'mt-0.5 text-brand-700' : 'mt-0.5 text-ink-400'}>{icon}</span>
                <span>
                  <span className="block text-sm font-bold text-ink-800">{label}</span>
                  <span className="mt-0.5 block text-xs text-ink-500">{hint}</span>
                </span>
              </button>
            ))}
            <div className="sm:col-span-2">
              <Field label="نوع الإعلان" required>
                <div className="flex gap-3">
                  {(
                    [
                      ['sell', 'أعرض للبيع'],
                      ['wanted', 'أبحث عن جهاز'],
                    ] as const
                  ).map(([value, label]) => (
                    <label key={value} className="flex cursor-pointer items-center gap-2 text-sm text-ink-700">
                      <input
                        type="radio"
                        name="kind"
                        checked={form.kind === value}
                        onChange={() => set('kind', value)}
                        className="h-4 w-4 accent-brand-700"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </Field>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="بيانات الجهاز" icon={<Info size={18} />} />
          <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="sm:col-span-2 lg:col-span-3">
              <Field label="عنوان الإعلان" required hint="من 5 إلى 160 حرفًا — اكتب الماركة والموديل والسعة">
                <input
                  required
                  minLength={5}
                  maxLength={160}
                  value={form.title}
                  onChange={(e) => set('title', e.target.value)}
                  className="input"
                  placeholder="مثال: آيفون 13 برو 256 جيجا — حالة ممتازة"
                />
              </Field>
            </div>
            <Field label="الفئة" required>
              <select value={form.category} onChange={(e) => set('category', e.target.value)} className="input">
                {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="الماركة" required>
              <input required maxLength={60} value={form.brand} onChange={(e) => set('brand', e.target.value)} className="input" placeholder="Apple / Samsung" />
            </Field>
            <Field label="الموديل" required>
              <input required maxLength={60} value={form.model} onChange={(e) => set('model', e.target.value)} className="input" placeholder="iPhone 13 Pro" />
            </Field>
            <Field label="السعة التخزينية">
              <input maxLength={30} value={form.storage} onChange={(e) => set('storage', e.target.value)} className="input" placeholder="128GB" />
            </Field>
            <Field label="الرام">
              <input maxLength={20} value={form.ram} onChange={(e) => set('ram', e.target.value)} className="input" placeholder="6GB" />
            </Field>
            <Field label="اللون">
              <input maxLength={30} value={form.color} onChange={(e) => set('color', e.target.value)} className="input" placeholder="أسود" />
            </Field>
            <Field label="الحالة" required>
              <select value={form.condition} onChange={(e) => set('condition', e.target.value)} className="input">
                {Object.entries(CONDITION_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="صحة البطارية %" hint="اتركها فارغة إن لم تكن معروفة">
              <input
                type="number"
                min={0}
                max={100}
                disabled={!isUsed}
                value={form.batteryHealth}
                onChange={(e) => set('batteryHealth', e.target.value)}
                className="input"
              />
            </Field>
            <Field label="ضمان بالأيام">
              <input type="number" min={0} max={3650} value={form.warrantyDays} onChange={(e) => set('warrantyDays', e.target.value)} className="input" />
            </Field>
            <div className="sm:col-span-2 lg:col-span-3">
              <Field label="الملحقات المرفقة" hint="افصل بينها بفاصلة — مثال: العلبة، الشاحن، سماعة">
                <input maxLength={300} value={form.includes} onChange={(e) => set('includes', e.target.value)} className="input" />
              </Field>
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <Field label="الوصف">
                <textarea
                  rows={4}
                  maxLength={4000}
                  value={form.description}
                  onChange={(e) => set('description', e.target.value)}
                  className="input resize-y"
                  placeholder="حالة الجهاز، تاريخ الشراء، أي ملاحظات مهمة…"
                />
              </Field>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="السعر والكمية" icon={<Store size={18} />} />
          <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="السعر (ج.م)" required>
              <input
                required
                type="number"
                min={1}
                step="0.01"
                value={form.priceEgp}
                onChange={(e) => set('priceEgp', e.target.value)}
                className="input"
                placeholder="15000"
              />
            </Field>
            <Field label="الكمية المتاحة">
              <input type="number" min={1} max={999} value={form.quantity} onChange={(e) => set('quantity', e.target.value)} className="input" />
            </Field>
            <Field label="مدة الإعلان بالأيام" hint="من 1 إلى 180 يومًا">
              <input type="number" min={1} max={180} value={form.expiresInDays} onChange={(e) => set('expiresInDays', e.target.value)} className="input" />
            </Field>
            <Field label="التفاوض">
              <label className="flex h-[38px] cursor-pointer items-center gap-2 text-sm text-ink-700">
                <input
                  type="checkbox"
                  checked={form.negotiable}
                  onChange={(e) => set('negotiable', e.target.checked)}
                  className="h-4 w-4 accent-brand-700"
                />
                السعر قابل للتفاوض
              </label>
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="التواصل والموقع" subtitle="اترك بيانات التواصل فارغة لاستخدام هاتف الفرع أو المركز تلقائيًا" />
          <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="اسم جهة التواصل">
              <input maxLength={120} value={form.contactName} onChange={(e) => set('contactName', e.target.value)} className="input" placeholder="اسم المسؤول" />
            </Field>
            <Field label="رقم التواصل" hint="موبايل مصري — مثال 01012345678">
              <input
                inputMode="tel"
                maxLength={20}
                value={form.contactPhone}
                onChange={(e) => set('contactPhone', e.target.value)}
                className="input"
              />
            </Field>
            <Field label="واتساب">
              <input
                inputMode="tel"
                maxLength={20}
                value={form.contactWhatsapp}
                onChange={(e) => set('contactWhatsapp', e.target.value)}
                className="input"
              />
            </Field>
            <Field label="المحافظة">
              <input maxLength={80} value={form.governorate} onChange={(e) => set('governorate', e.target.value)} className="input" />
            </Field>
            <Field label="المدينة">
              <input maxLength={80} value={form.city} onChange={(e) => set('city', e.target.value)} className="input" />
            </Field>
            <Field label="المنطقة">
              <input maxLength={80} value={form.area} onChange={(e) => set('area', e.target.value)} className="input" />
            </Field>
          </div>
        </Card>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link href="/market" className="btn-secondary">
            إلغاء
          </Link>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {form.scope === 'public' ? 'إرسال للمراجعة' : 'نشر داخلي'}
          </button>
        </div>
      </form>
    </div>
  );
}
