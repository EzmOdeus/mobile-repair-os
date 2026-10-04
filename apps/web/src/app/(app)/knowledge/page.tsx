'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { BookOpen, Lightbulb, Plus, Search, Wrench } from 'lucide-react';
import { api, errorMessage, fetcher, qs } from '@/lib/api';
import { Badge, Card, CardHeader, EmptyState, Field, LoadingBlock, PageHeader } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/lib/auth';

interface Article {
  _id: string;
  title: string;
  slug: string;
  brand: string;
  models: string[];
  category: string;
  symptom: string;
  difficulty: string;
  estimatedMinutes: number;
  status: string;
  tags: string[];
  createdAt: string;
  authorId?: { fullName: string } | null;
  outcomes?: { timesApplied?: number; successRatePct?: number; avgMinutes?: number };
  diagnosticSteps?: { step: number; instruction: string; expectedResult?: string; toolRequired?: string }[];
  knownCauses?: { cause: string; likelihood: string; verifyBy?: string }[];
  repairNotes?: string;
  riskWarnings?: string[];
}

interface Suggestion {
  id: string;
  title: string;
  symptom: string;
  category: string;
  difficulty: string;
  estimatedMinutes: number;
  diagnosticSteps: { step: number; instruction: string; expectedResult?: string; toolRequired?: string }[];
  knownCauses: { cause: string; likelihood: string; verifyBy?: string }[];
  repairNotes: string;
  riskWarnings: string[];
  historicalSuccessRatePct: number;
  timesApplied: number;
}

const CATEGORY_LABELS: Record<string, string> = {
  display: 'شاشة',
  power: 'باور',
  charging: 'شحن',
  audio: 'صوت',
  camera: 'كاميرا',
  network: 'شبكة',
  software: 'برمجيات',
  board_level: 'بوردة',
  water_damage: 'سوائل',
  biometrics: 'بصمة',
  other: 'أخرى',
};

const DIFFICULTY_LABELS: Record<string, string> = {
  easy: 'سهل',
  medium: 'متوسط',
  hard: 'صعب',
  expert: 'خبير',
};

export default function KnowledgePage() {
  const toast = useToast();
  const { hasPermission } = useAuth();
  const [tab, setTab] = useState<'browse' | 'suggest'>('browse');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [selected, setSelected] = useState<Article | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [symptom, setSymptom] = useState('');
  const [model, setModel] = useState('');
  const [suggestQuery, setSuggestQuery] = useState('');

  const key = `/knowledge${qs({ q: search || undefined, category: categoryFilter || undefined, status: 'published', limit: 30 })}`;
  const { data, error, isLoading } = useSWR<{ items: Article[]; meta: { total: number } }>(
    tab === 'browse' ? key : null,
    fetcher,
  );

  const { data: suggestions, isLoading: suggestLoading } = useSWR<{ suggestions: Suggestion[]; disclaimer: string }>(
    tab === 'suggest' && suggestQuery ? `/knowledge/suggest${suggestQuery}` : null,
    fetcher,
  );

  const runSuggest = () => {
    const params = qs({ symptom: symptom || undefined, model: model || undefined });
    if (!params) {
      toast.error('أدخل العَرَض أو الموديل');
      return;
    }
    setSuggestQuery(params);
  };

  const recordOutcome = async (articleId: string, successful: boolean) => {
    try {
      await api.post(`/knowledge/${articleId}/outcome`, { successful });
      toast.success('تم تحديث نتائج المقال');
      await mutate(key);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div>
      <PageHeader
        title="قاعدة المعرفة الفنية"
        subtitle="تنظيم: الماركة → الموديل → التصنيف → العَرَض → خطوات التشخيص → الأسباب → النتائج"
        actions={
          hasPermission('knowledge:write') ? (
            <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
              <Plus size={16} /> مقال جديد
            </button>
          ) : null
        }
      />

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-3 py-2">
          {[
            ['browse', 'تصفح المقالات'],
            ['suggest', 'اقتراحات تشخيص'],
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

        {tab === 'browse' ? (
          <div className="grid gap-3 p-4 sm:grid-cols-3">
            <div className="relative sm:col-span-2">
              <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400" />
              <input
                className="input pr-9"
                placeholder="ابحث بالعَرَض أو العطل أو الموديل…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select className="input" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">كل التصنيفات</option>
              {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto]">
            <input
              className="input"
              placeholder="العَرَض: مثال لا يشحن / الشاشة مكسورة"
              value={symptom}
              onChange={(e) => setSymptom(e.target.value)}
            />
            <input
              className="input"
              placeholder="الموديل: مثال Galaxy A15"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
            <button type="button" className="btn-primary" onClick={runSuggest}>
              <Lightbulb size={16} /> ابحث
            </button>
          </div>
        )}
      </Card>

      {error ? <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">{errorMessage(error)}</Card> : null}

      {tab === 'browse' ? (
        isLoading ? (
          <Card>
            <LoadingBlock rows={6} />
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data?.items?.length ? (
              data.items.map((article) => (
                <Card key={article._id} className="flex flex-col">
                  <div className="flex-1 card-pad">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-bold leading-snug text-ink-900">{article.title}</h3>
                      <Badge className="shrink-0 border-brand-200 bg-brand-50 text-brand-700">
                        {CATEGORY_LABELS[article.category] ?? article.category}
                      </Badge>
                    </div>
                    <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-ink-600">{article.symptom}</p>

                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <Badge className="border-ink-200 bg-ink-50 text-ink-600">
                        {DIFFICULTY_LABELS[article.difficulty] ?? article.difficulty}
                      </Badge>
                      {article.estimatedMinutes ? (
                        <Badge className="border-ink-200 bg-ink-50 text-ink-600">{article.estimatedMinutes} دقيقة</Badge>
                      ) : null}
                      {article.outcomes?.successRatePct ? (
                        <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">
                          نجاح {article.outcomes.successRatePct}%
                        </Badge>
                      ) : null}
                    </div>

                    {article.models?.length ? (
                      <p className="mt-2 text-[11px] text-ink-400">
                        موديلات: {article.models.slice(0, 3).join('، ')}
                        {article.models.length > 3 ? ` +${article.models.length - 3}` : ''}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex items-center justify-between border-t border-ink-100 px-4 py-2.5">
                    <span className="text-[11px] text-ink-400">
                      {article.outcomes?.timesApplied ? `طُبِّق ${article.outcomes.timesApplied} مرة` : 'لم يُطبَّق بعد'}
                    </span>
                    <button type="button" className="btn-ghost text-xs" onClick={() => setSelected(article)}>
                      التفاصيل
                    </button>
                  </div>
                </Card>
              ))
            ) : (
              <Card className="md:col-span-2 xl:col-span-3">
                <EmptyState
                  title="لا توجد مقالات منشورة"
                  description="ابدأ بتوثيق أول إصلاح في قاعدة المعرفة"
                  icon={<BookOpen size={22} />}
                />
              </Card>
            )}
          </div>
        )
      ) : (
        <Card>
          <CardHeader
            title="اقتراحات مبنية على قاعدة المعرفة"
            subtitle="النتائج اقتراحات معرفية، والفحص الفني هو المرجع النهائي"
            icon={<Lightbulb size={18} />}
          />
          <div className="card-pad space-y-4">
            {suggestLoading ? (
              <LoadingBlock rows={5} />
            ) : suggestions?.suggestions?.length ? (
              <>
                {suggestions.suggestions.map((item) => (
                  <div key={item.id} className="rounded-xl border border-ink-200 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h3 className="text-sm font-bold text-ink-900">{item.title}</h3>
                      <div className="flex gap-1.5">
                        <Badge className="border-brand-200 bg-brand-50 text-brand-700">
                          {CATEGORY_LABELS[item.category] ?? item.category}
                        </Badge>
                        {item.historicalSuccessRatePct ? (
                          <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">
                            نجاح تاريخي {item.historicalSuccessRatePct}%
                          </Badge>
                        ) : null}
                      </div>
                    </div>

                    <p className="mt-2 text-xs text-ink-600">{item.symptom}</p>

                    {item.diagnosticSteps?.length ? (
                      <div className="mt-3">
                        <p className="label">خطوات التشخيص</p>
                        <ol className="space-y-1.5">
                          {item.diagnosticSteps.map((step) => (
                            <li key={step.step} className="flex gap-2 text-xs text-ink-700">
                              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[10px] font-bold text-brand-800">
                                {step.step}
                              </span>
                              <span>
                                {step.instruction}
                                {step.expectedResult ? (
                                  <span className="block text-[11px] text-emerald-700">النتيجة المتوقعة: {step.expectedResult}</span>
                                ) : null}
                                {step.toolRequired ? (
                                  <span className="block text-[11px] text-ink-400">الأداة: {step.toolRequired}</span>
                                ) : null}
                              </span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    ) : null}

                    {item.knownCauses?.length ? (
                      <div className="mt-3">
                        <p className="label">الأسباب المحتملة</p>
                        <ul className="space-y-1">
                          {item.knownCauses.map((cause) => (
                            <li key={cause.cause} className="flex items-center gap-2 text-xs text-ink-700">
                              <Badge
                                className={
                                  cause.likelihood === 'high'
                                    ? 'border-red-200 bg-red-50 text-red-700'
                                    : cause.likelihood === 'medium'
                                      ? 'border-amber-200 bg-amber-50 text-amber-800'
                                      : 'border-ink-200 bg-ink-50 text-ink-600'
                                }
                              >
                                {cause.likelihood === 'high' ? 'مرتفع' : cause.likelihood === 'medium' ? 'متوسط' : 'منخفض'}
                              </Badge>
                              {cause.cause}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {item.repairNotes ? (
                      <div className="mt-3">
                        <p className="label">ملاحظات الإصلاح</p>
                        <p className="text-xs leading-relaxed text-ink-600">{item.repairNotes}</p>
                      </div>
                    ) : null}

                    {item.riskWarnings?.length ? (
                      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
                        <p className="text-[11px] font-bold text-amber-800">تحذيرات</p>
                        <ul className="mt-1 list-inside list-disc space-y-0.5 text-[11px] text-amber-800">
                          {item.riskWarnings.map((warning) => (
                            <li key={warning}>{warning}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {hasPermission('knowledge:write') ? (
                      <div className="mt-3 flex gap-2">
                        <button type="button" className="btn-secondary text-xs" onClick={() => void recordOutcome(item.id, true)}>
                          طبّقتها ونجحت
                        </button>
                        <button type="button" className="btn-ghost text-xs" onClick={() => void recordOutcome(item.id, false)}>
                          لم تنجح
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
                <p className="rounded-lg bg-ink-50 p-3 text-[11px] text-ink-500">{suggestions.disclaimer}</p>
              </>
            ) : suggestQuery ? (
              <EmptyState title="لا توجد اقتراحات مطابقة" description="جرّب صياغة مختلفة للعَرَض" icon={<Search size={22} />} />
            ) : (
              <EmptyState
                title="ابحث عن اقتراحات تشخيص"
                description="أدخل عَرَض العطل و/أو الموديل للحصول على خطوات تشخيص موثقة"
                icon={<Lightbulb size={22} />}
              />
            )}
          </div>
        </Card>
      )}

      <ArticleModal
        article={selected}
        onClose={() => setSelected(null)}
        onOutcome={recordOutcome}
        canRecord={hasPermission('knowledge:write')}
      />

      <CreateArticleModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onDone={async () => {
          setCreateOpen(false);
          await mutate(key);
          toast.success('تمت إضافة المقال');
        }}
        onError={(message) => toast.error(message)}
      />
    </div>
  );
}

function ArticleModal({
  article,
  onClose,
  onOutcome,
  canRecord,
}: {
  article: Article | null;
  onClose: () => void;
  onOutcome: (id: string, successful: boolean) => void | Promise<void>;
  canRecord: boolean;
}) {
  if (!article) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title={article.title}
      subtitle={`${CATEGORY_LABELS[article.category] ?? article.category} · ${DIFFICULTY_LABELS[article.difficulty] ?? article.difficulty}`}
      size="lg"
      footer={
        canRecord ? (
          <>
            <button type="button" className="btn-secondary" onClick={() => void onOutcome(article._id, false)}>
              لم تنجح
            </button>
            <button type="button" className="btn-primary" onClick={() => void onOutcome(article._id, true)}>
              طبّقتها ونجحت
            </button>
          </>
        ) : null
      }
    >
      <div className="space-y-4">
        <div>
          <p className="label">العَرَض</p>
          <p className="rounded-lg bg-ink-50 p-3 text-sm text-ink-700">{article.symptom}</p>
        </div>

        {article.diagnosticSteps?.length ? (
          <div>
            <p className="label">خطوات التشخيص</p>
            <ol className="space-y-2">
              {article.diagnosticSteps.map((step) => (
                <li key={step.step} className="flex gap-2.5 text-sm text-ink-700">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-800">
                    {step.step}
                  </span>
                  <span>
                    {step.instruction}
                    {step.expectedResult ? (
                      <span className="block text-xs text-emerald-700">النتيجة المتوقعة: {step.expectedResult}</span>
                    ) : null}
                    {step.toolRequired ? (
                      <span className="block text-xs text-ink-400">الأداة: {step.toolRequired}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        {article.knownCauses?.length ? (
          <div>
            <p className="label">الأسباب المحتملة</p>
            <div className="space-y-1.5">
              {article.knownCauses.map((cause) => (
                <div key={cause.cause} className="rounded-lg border border-ink-200 px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-ink-700">{cause.cause}</span>
                    <Badge
                      className={
                        cause.likelihood === 'high'
                          ? 'border-red-200 bg-red-50 text-red-700'
                          : cause.likelihood === 'medium'
                            ? 'border-amber-200 bg-amber-50 text-amber-800'
                            : 'border-ink-200 bg-ink-50 text-ink-600'
                      }
                    >
                      {cause.likelihood === 'high' ? 'مرتفع' : cause.likelihood === 'medium' ? 'متوسط' : 'منخفض'}
                    </Badge>
                  </div>
                  {cause.verifyBy ? <p className="mt-1 text-xs text-ink-500">التحقق: {cause.verifyBy}</p> : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {article.repairNotes ? (
          <div>
            <p className="label">ملاحظات الإصلاح</p>
            <p className="rounded-lg bg-ink-50 p-3 text-sm leading-relaxed text-ink-700">{article.repairNotes}</p>
          </div>
        ) : null}

        {article.riskWarnings?.length ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs font-bold text-amber-800">تحذيرات السلامة</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-amber-800">
              {article.riskWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {article.outcomes ? (
          <div className="grid grid-cols-3 gap-3 rounded-lg border border-ink-200 p-3 text-center">
            <div>
              <p className="text-[11px] text-ink-500">مرات التطبيق</p>
              <p className="num text-lg font-bold text-ink-800">{article.outcomes.timesApplied ?? 0}</p>
            </div>
            <div>
              <p className="text-[11px] text-ink-500">نسبة النجاح</p>
              <p className="num text-lg font-bold text-emerald-700">{article.outcomes.successRatePct ?? 0}%</p>
            </div>
            <div>
              <p className="text-[11px] text-ink-500">متوسط الزمن</p>
              <p className="num text-lg font-bold text-ink-800">{article.outcomes.avgMinutes ?? 0} د</p>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function CreateArticleModal({
  open,
  onClose,
  onDone,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState({
    title: '',
    brand: '',
    models: '',
    category: 'other',
    symptom: '',
    steps: '',
    causes: '',
    repairNotes: '',
    riskWarnings: '',
    difficulty: 'medium',
    estimatedMinutes: '30',
    status: 'published',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async () => {
    if (!form.title.trim() || !form.symptom.trim()) {
      onError('العنوان والعَرَض مطلوبان');
      return;
    }
    setIsSubmitting(true);
    try {
      await api.post('/knowledge', {
        title: form.title,
        brand: form.brand,
        models: form.models
          .split(',')
          .map((m) => m.trim())
          .filter(Boolean),
        category: form.category,
        symptom: form.symptom,
        diagnosticSteps: form.steps
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((instruction, index) => ({ step: index + 1, instruction })),
        knownCauses: form.causes
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((cause) => ({ cause, likelihood: 'medium' })),
        repairNotes: form.repairNotes,
        riskWarnings: form.riskWarnings
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
        difficulty: form.difficulty,
        estimatedMinutes: Number(form.estimatedMinutes) || 0,
        status: form.status,
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
      open={open}
      onClose={onClose}
      title="مقال معرفة جديد"
      size="lg"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            إلغاء
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={isSubmitting}>
            {isSubmitting ? 'جارٍ الحفظ…' : 'حفظ المقال'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="عنوان المقال" required>
          <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="الماركة">
            <input className="input" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
          </Field>
          <Field label="الموديلات (مفصولة بفاصلة)">
            <input className="input" value={form.models} onChange={(e) => setForm({ ...form, models: e.target.value })} />
          </Field>
          <Field label="التصنيف">
            <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="العَرَض" required>
          <textarea className="input min-h-[3rem]" value={form.symptom} onChange={(e) => setForm({ ...form, symptom: e.target.value })} />
        </Field>

        <Field label="خطوات التشخيص (كل خطوة في سطر)">
          <textarea
            className="input min-h-[5rem]"
            value={form.steps}
            onChange={(e) => setForm({ ...form, steps: e.target.value })}
            placeholder={'افحص منفذ الشحن بصريًا\nقياس جهد الشحن على أطراف المنفذ\nفحص مسار الشحن على البوردة'}
          />
        </Field>

        <Field label="الأسباب المحتملة (كل سبب في سطر)">
          <textarea
            className="input min-h-[4rem]"
            value={form.causes}
            onChange={(e) => setForm({ ...form, causes: e.target.value })}
            placeholder={'تلف منفذ الشحن\nعطل في IC الشحن\nبطارية تالفة'}
          />
        </Field>

        <Field label="ملاحظات الإصلاح">
          <textarea
            className="input min-h-[4rem]"
            value={form.repairNotes}
            onChange={(e) => setForm({ ...form, repairNotes: e.target.value })}
          />
        </Field>

        <Field label="تحذيرات (كل تحذير في سطر)">
          <textarea
            className="input min-h-[3rem]"
            value={form.riskWarnings}
            onChange={(e) => setForm({ ...form, riskWarnings: e.target.value })}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="الصعوبة">
            <select className="input" value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value })}>
              {Object.entries(DIFFICULTY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="الزمن المتوقع (دقيقة)">
            <input
              className="input"
              type="number"
              min={0}
              value={form.estimatedMinutes}
              onChange={(e) => setForm({ ...form, estimatedMinutes: e.target.value })}
            />
          </Field>
          <Field label="الحالة">
            <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="published">منشور</option>
              <option value="draft">مسودة</option>
              <option value="review">للمراجعة</option>
            </select>
          </Field>
        </div>
      </div>
    </Modal>
  );
}

void Wrench;
