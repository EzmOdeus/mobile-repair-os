'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Eye,
  EyeOff,
  Lock,
  ShieldCheck,
  Store,
  UserRound,
  XCircle,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/ui/Toast';

const GOVERNORATES = [
  'القاهرة',
  'الجيزة',
  'الإسكندرية',
  'الدقهلية',
  'الشرقية',
  'المنوفية',
  'القليوبية',
  'البحيرة',
  'الغربية',
  'بورسعيد',
  'دمياط',
  'الإسماعيلية',
  'السويس',
  'كفر الشيخ',
  'الفيوم',
  'بني سويف',
  'المنيا',
  'أسيوط',
  'سوهاج',
  'قنا',
  'الأقصر',
  'أسوان',
  'البحر الأحمر',
  'مطروح',
  'شمال سيناء',
  'جنوب سيناء',
  'الوادي الجديد',
];

const PLAN_FEATURES = [
  'تجربة مجانية بدون بطاقة بنكية',
  'حتى 5 مستخدمين وفرعين',
  '300 تذكرة صيانة شهريًا',
  'جواز الجهاز ودورة العمل الكاملة',
  'فحص الجودة والضمان',
  'التقارير ولوحات المعلومات',
];

type Step = 'org' | 'owner';

interface FieldErrors {
  [key: string]: string;
}

/** قوة كلمة المرور: 0–4 */
function passwordScore(password: string): number {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[A-Za-z]/.test(password) && /\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  return Math.min(4, score);
}

const SCORE_LABELS = ['ضعيفة جدًا', 'ضعيفة', 'مقبولة', 'جيدة', 'قوية'];
const SCORE_COLORS = ['bg-red-500', 'bg-red-500', 'bg-amber-500', 'bg-emerald-500', 'bg-emerald-600'];

/** تحويل أسماء عربية إلى اسم مستخدم مقترح صالح */
function suggestUsername(fullName: string): string {
  const cleaned = fullName
    .trim()
    .replace(/[^\p{L}\p{N}\s._-]/gu, '')
    .replace(/\s+/g, '.')
    .toLowerCase();
  const latinOnly = cleaned.replace(/[^\x00-\x7F]/g, '');
  return (latinOnly || 'owner').slice(0, 30);
}

export default function RegisterPage() {
  const router = useRouter();
  const toast = useToast();
  const { registerOrganization, isAuthenticated, isLoading } = useAuth();

  const [step, setStep] = useState<Step>('org');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [branchNameTouched, setBranchNameTouched] = useState(false);

  const [form, setForm] = useState({
    orgName: '',
    orgNameEn: '',
    orgPhone: '',
    orgEmail: '',
    governorate: '',
    city: '',
    branchName: '',
    branchCode: 'MAIN',
    ownerFullName: '',
    ownerUsername: '',
    ownerEmail: '',
    ownerPhone: '',
    password: '',
    confirmPassword: '',
  });

  useEffect(() => {
    if (!isLoading && isAuthenticated) router.replace('/dashboard');
  }, [isAuthenticated, isLoading, router]);

  const update = (key: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setFormError(null);
  };

  /** تعديل اسم الفرع يدويًا يوقف الملء التلقائي من اسم المركز */
  const updateBranchName = (value: string) => {
    setBranchNameTouched(true);
    update('branchName', value);
  };

  // اقتراح اسم المستخدم من الاسم الكامل واسم المركز
  useEffect(() => {
    if (usernameTouched) return;
    const source = form.ownerFullName.trim() || form.orgName.trim();
    if (!source) return;
    const suggestion = suggestUsername(source);
    if (suggestion && suggestion !== form.ownerUsername) {
      setForm((prev) => ({ ...prev, ownerUsername: suggestion }));
    }
  }, [form.ownerFullName, form.orgName, usernameTouched, form.ownerUsername]);

  // نملأ اسم الفرع الرئيسي تلقائيًا باسم المركز ما دام المستخدم لم يكتبه بنفسه
  useEffect(() => {
    if (branchNameTouched) return;
    setForm((prev) => {
      if (!prev.orgName.trim()) return prev;
      return { ...prev, branchName: prev.orgName };
    });
  }, [form.orgName, branchNameTouched]);

  const score = useMemo(() => passwordScore(form.password), [form.password]);

  const passwordsMatch = form.confirmPassword.length > 0 && form.password === form.confirmPassword;

  const orgStepValid =
    form.orgName.trim().length >= 2 && form.branchName.trim().length >= 2 && form.branchCode.trim().length >= 2;

  const ownerStepValid =
    form.ownerFullName.trim().length >= 3 &&
    /^[a-z0-9._-]{3,40}$/.test(form.ownerUsername) &&
    score >= 2 &&
    passwordsMatch &&
    acceptedTerms;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);

    if (!orgStepValid || !ownerStepValid) {
      setFormError('راجع الحقول المطلوبة قبل إنشاء الحساب');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await registerOrganization({
        organization: {
          name: form.orgName.trim(),
          nameEn: form.orgNameEn.trim() || undefined,
          phone: form.orgPhone.trim() || undefined,
          email: form.orgEmail.trim() || undefined,
          governorate: form.governorate || undefined,
          city: form.city.trim() || undefined,
        },
        owner: {
          fullName: form.ownerFullName.trim(),
          username: form.ownerUsername.trim().toLowerCase(),
          password: form.password,
          email: form.ownerEmail.trim() || undefined,
          phone: form.ownerPhone.trim() || undefined,
        },
        branch: {
          name: form.branchName.trim(),
          code: form.branchCode.trim().toUpperCase(),
        },
      });

      toast.success(`تم إنشاء مركز «${result.organizationName}» — أهلاً بك!`);
      router.replace('/dashboard');
    } catch (err) {
      const error = err as Error & { code?: string; details?: unknown };
      setFormError(error.message);

      // نربط أخطاء التحقق بالحقول لعرضها أسفل كل حقل
      if (error.code === 'VALIDATION_ERROR' && Array.isArray(error.details)) {
        const mapped: FieldErrors = {};
        const fieldMap: Record<string, keyof typeof form> = {
          'organization.name': 'orgName',
          'organization.phone': 'orgPhone',
          'organization.email': 'orgEmail',
          'owner.fullName': 'ownerFullName',
          'owner.username': 'ownerUsername',
          'owner.password': 'password',
          'owner.email': 'ownerEmail',
          'owner.phone': 'ownerPhone',
          'branch.name': 'branchName',
          'branch.code': 'branchCode',
        };
        for (const detail of error.details as { field: string; message: string }[]) {
          const key = fieldMap[detail.field];
          if (key) mapped[key] = detail.message;
        }
        setFieldErrors(mapped);
        if (Object.keys(mapped).some((k) => k.startsWith('org') || k.startsWith('branch'))) {
          setStep('org');
        }
      }

      toast.error(error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-900 via-brand-800 to-ink-900 p-3 sm:p-6" dir="rtl">
      <div className="mx-auto grid w-full max-w-6xl overflow-hidden rounded-2xl bg-white shadow-2xl lg:grid-cols-[1fr_1.25fr]">
        {/* اللوحة التعريفية */}
        <aside className="hidden flex-col justify-between bg-brand-800 p-8 text-white lg:flex">
          <div>
            <Link href="/login" className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 text-base font-bold">
                MR
              </span>
              <span>
                <span className="block text-lg font-bold">Mobile Repair OS</span>
                <span className="block text-xs text-brand-100">نظام تشغيل مراكز صيانة الموبايل</span>
              </span>
            </Link>

            <h1 className="mt-8 text-2xl font-bold leading-snug">
              افتح حساب مركزك
              <br />
              وابدأ التشغيل في دقائق.
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-brand-100">
              حساب واحد يكفي: أنشئ المركز، وسجّل أول تذكرة صيانة، ووثّق حالة الجهاز بالصور والتوقيع من أول يوم.
            </p>

            <ul className="mt-7 space-y-2.5">
              {PLAN_FEATURES.map((feature) => (
                <li key={feature} className="flex items-start gap-2.5 text-sm text-brand-50">
                  <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-brand-200" />
                  {feature}
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-8 rounded-xl bg-white/10 p-4">
            <p className="flex items-center gap-2 text-xs font-bold text-white">
              <ShieldCheck size={14} /> بياناتك معزولة تمامًا
            </p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-brand-100">
              كل مركز يحصل على مساحة بيانات مستقلة مفروضة على مستوى قاعدة البيانات نفسها — لا يمكن لأي مركز آخر الوصول
              لبياناتك، ولا حتى بمعرّف صحيح.
            </p>
          </div>
        </aside>

        {/* النموذج */}
        <main className="p-5 sm:p-8">
          <div className="mb-5 flex items-center justify-between lg:hidden">
            <Link href="/login" className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-700 text-xs font-bold text-white">
                MR
              </span>
              <span className="text-sm font-bold text-ink-900">Mobile Repair OS</span>
            </Link>
          </div>

          <h2 className="text-xl font-bold text-ink-900">إنشاء حساب مركز جديد</h2>
          <p className="mt-1 text-sm text-ink-500">
            املأ البيانات وسيصبح حسابك جاهزًا فورًا كمالك للمركز بكل الصلاحيات.
          </p>

          {/* خطوات */}
          <div className="mt-5 flex items-center gap-2 text-xs">
            {(['org', 'owner'] as const).map((s, index) => (
              <div key={s} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setStep(s)}
                  className={`flex h-6 w-6 items-center justify-center rounded-full font-bold transition ${
                    step === s ? 'bg-brand-700 text-white' : 'bg-ink-200 text-ink-600'
                  }`}
                >
                  {index + 1}
                </button>
                <button
                  type="button"
                  onClick={() => setStep(s)}
                  className={`transition ${step === s ? 'font-bold text-ink-800' : 'text-ink-500'}`}
                >
                  {s === 'org' ? 'بيانات المركز' : 'حساب المالك'}
                </button>
                {index === 0 ? <span className="text-ink-300">—</span> : null}
              </div>
            ))}
          </div>

          <form onSubmit={submit} className="mt-5 space-y-4">
            {formError ? (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
                <XCircle size={17} className="mt-0.5 shrink-0" />
                <span>{formError}</span>
              </div>
            ) : null}

            {/* الخطوة 1: بيانات المركز */}
            {step === 'org' ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 border-b border-ink-100 pb-2">
                  <Building2 size={16} className="text-brand-700" />
                  <h3 className="text-sm font-bold text-ink-800">بيانات المركز</h3>
                </div>

                <Field label="اسم المركز" required error={fieldErrors.orgName} hint="سيظهر في الفواتير ورسائل العملاء">
                  <input
                    className={`input ${fieldErrors.orgName ? 'border-red-400' : ''}`}
                    value={form.orgName}
                    onChange={(e) => update('orgName', e.target.value)}
                    placeholder="مثال: موبايل كير - مركز صيانة"
                    autoFocus
                  />
                </Field>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="الاسم بالإنجليزية" hint="اختياري — يظهر في التقارير">
                    <input
                      className="input"
                      value={form.orgNameEn}
                      onChange={(e) => update('orgNameEn', e.target.value)}
                      placeholder="Mobile Care"
                      dir="ltr"
                    />
                  </Field>
                  <Field label="هاتف المركز" error={fieldErrors.orgPhone}>
                    <input
                      className="input"
                      value={form.orgPhone}
                      onChange={(e) => update('orgPhone', e.target.value)}
                      placeholder="01122334455"
                      dir="ltr"
                    />
                  </Field>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="المحافظة">
                    <select className="input" value={form.governorate} onChange={(e) => update('governorate', e.target.value)}>
                      <option value="">اختر المحافظة</option>
                      {GOVERNORATES.map((gov) => (
                        <option key={gov} value={gov}>
                          {gov}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="المدينة / المنطقة">
                    <input
                      className="input"
                      value={form.city}
                      onChange={(e) => update('city', e.target.value)}
                      placeholder="مدينة نصر"
                    />
                  </Field>
                </div>

                <Field label="بريد المركز" error={fieldErrors.orgEmail}>
                  <input
                    className="input"
                    value={form.orgEmail}
                    onChange={(e) => update('orgEmail', e.target.value)}
                    placeholder="info@example.com"
                    dir="ltr"
                  />
                </Field>

                <div className="flex items-center gap-2 border-b border-ink-100 pb-2 pt-2">
                  <Store size={16} className="text-brand-700" />
                  <h3 className="text-sm font-bold text-ink-800">الفرع الرئيسي</h3>
                </div>
                <p className="-mt-1 text-xs text-ink-500">
                  يمكنك إضافة فروع أخرى لاحقًا من صفحة الإعدادات (حسب باقتك).
                </p>

                <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
                  <Field label="اسم الفرع" required error={fieldErrors.branchName}>
                    <input
                      className={`input ${fieldErrors.branchName ? 'border-red-400' : ''}`}
                      value={form.branchName}
                      onChange={(e) => updateBranchName(e.target.value)}
                      placeholder="الفرع الرئيسي"
                    />
                  </Field>
                  <Field label="كود الفرع" required error={fieldErrors.branchCode} hint="حروف إنجليزية">
                    <input
                      className={`input ${fieldErrors.branchCode ? 'border-red-400' : ''}`}
                      value={form.branchCode}
                      onChange={(e) => update('branchCode', e.target.value.toUpperCase())}
                      placeholder="MAIN"
                      dir="ltr"
                      maxLength={10}
                    />
                  </Field>
                </div>

                <button
                  type="button"
                  className="btn-primary w-full"
                  onClick={() => {
                    const errors: FieldErrors = {};
                    if (!form.orgName.trim()) errors.orgName = 'اسم المركز مطلوب';
                    if (!form.branchName.trim()) errors.branchName = 'اسم الفرع مطلوب';
                    if (form.branchCode.trim().length < 2) errors.branchCode = 'كود الفرع حرفان على الأقل';

                    if (Object.keys(errors).length) {
                      setFieldErrors(errors);
                      setFormError('أكمل بيانات المركز قبل المتابعة');
                      return;
                    }

                    setFieldErrors({});
                    setFormError(null);
                    setStep('owner');
                  }}
                >
                  التالي: حساب المالك <ArrowRight size={16} className="rotate-180" />
                </button>
              </div>
            ) : null}

            {/* الخطوة 2: حساب المالك */}
            {step === 'owner' ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 border-b border-ink-100 pb-2">
                  <UserRound size={16} className="text-brand-700" />
                  <h3 className="text-sm font-bold text-ink-800">حساب المالك</h3>
                </div>
                <p className="-mt-1 text-xs text-ink-500">
                  هذا الحساب سيكون مالك المركز بكل الصلاحيات، ومنه تُضيف باقي الموظفين والفنيين.
                </p>

                <Field label="الاسم الكامل" required error={fieldErrors.ownerFullName}>
                  <input
                    className={`input ${fieldErrors.ownerFullName ? 'border-red-400' : ''}`}
                    value={form.ownerFullName}
                    onChange={(e) => update('ownerFullName', e.target.value)}
                    placeholder="مثال: أحمد عبدالله"
                    autoFocus
                  />
                </Field>

                <Field
                  label="اسم المستخدم"
                  required
                  error={fieldErrors.ownerUsername}
                  hint="حروف إنجليزية صغيرة وأرقام و . _ - فقط (للدخول)"
                >
                  <input
                    className={`input ${fieldErrors.ownerUsername ? 'border-red-400' : ''}`}
                    value={form.ownerUsername}
                    onChange={(e) => {
                      setUsernameTouched(true);
                      update('ownerUsername', e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''));
                    }}
                    placeholder="owner"
                    dir="ltr"
                  />
                </Field>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="البريد الإلكتروني" error={fieldErrors.ownerEmail} hint="اختياري — للدخول وللاستعادة">
                    <input
                      className="input"
                      value={form.ownerEmail}
                      onChange={(e) => update('ownerEmail', e.target.value)}
                      placeholder="you@example.com"
                      dir="ltr"
                    />
                  </Field>
                  <Field label="رقم الموبايل" error={fieldErrors.ownerPhone}>
                    <input
                      className="input"
                      value={form.ownerPhone}
                      onChange={(e) => update('ownerPhone', e.target.value)}
                      placeholder="01012345678"
                      dir="ltr"
                    />
                  </Field>
                </div>

                <Field label="كلمة المرور" required error={fieldErrors.password} hint="8 أحرف على الأقل، وتحتوي حرفًا ورقمًا">
                  <div className="relative">
                    <input
                      className={`input pl-10 ${fieldErrors.password ? 'border-red-400' : ''}`}
                      type={showPassword ? 'text' : 'password'}
                      value={form.password}
                      onChange={(e) => update('password', e.target.value)}
                      placeholder="••••••••"
                      dir="ltr"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400 transition hover:text-ink-700"
                      aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                    >
                      {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </div>
                </Field>

                {form.password ? (
                  <div className="-mt-1">
                    <div className="flex gap-1">
                      {[0, 1, 2, 3].map((index) => (
                        <span
                          key={index}
                          className={`h-1.5 flex-1 rounded-full transition ${index < score ? SCORE_COLORS[score] : 'bg-ink-200'}`}
                        />
                      ))}
                    </div>
                    <p className="mt-1 text-[11px] text-ink-500">قوة كلمة المرور: {SCORE_LABELS[score]}</p>
                  </div>
                ) : null}

                <Field label="تأكيد كلمة المرور" required error={!passwordsMatch && form.confirmPassword ? 'كلمتا المرور غير متطابقتين' : undefined}>
                  <div className="relative">
                    <input
                      className={`input pl-10 ${
                        !passwordsMatch && form.confirmPassword ? 'border-red-400' : ''
                      }`}
                      type={showConfirm ? 'text' : 'password'}
                      value={form.confirmPassword}
                      onChange={(e) => update('confirmPassword', e.target.value)}
                      placeholder="••••••••"
                      dir="ltr"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm((v) => !v)}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400 transition hover:text-ink-700"
                      aria-label={showConfirm ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                    >
                      {showConfirm ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </div>
                </Field>

                <div className="flex items-start gap-2 text-xs leading-relaxed text-ink-600">
                  <input
                    id="accept-terms"
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-ink-300"
                    checked={acceptedTerms}
                    onChange={(e) => setAcceptedTerms(e.target.checked)}
                  />
                  <label htmlFor="accept-terms">
                    أوافق على شروط الاستخدام وسياسة الخصوصية، وأقر بأنني مسؤول عن بيانات العملاء التي أُدخلها على النظام.
                  </label>
                </div>

                <div className="flex gap-2">
                  <button type="button" className="btn-secondary shrink-0" onClick={() => setStep('org')}>
                    السابق
                  </button>
                  <button type="submit" className="btn-primary flex-1" disabled={isSubmitting || !ownerStepValid}>
                    <Lock size={16} />
                    {isSubmitting ? 'جارٍ إنشاء الحساب…' : 'إنشاء الحساب والدخول'}
                  </button>
                </div>
              </div>
            ) : null}
          </form>

          <p className="mt-6 text-center text-sm text-ink-500">
            لديك حساب بالفعل؟{' '}
            <Link href="/login" className="font-bold text-brand-700 hover:underline">
              تسجيل الدخول
            </Link>
          </p>
        </main>
      </div>
    </div>
  );
}

/**
 * حقل نموذج موحّد.
 * نستخدم div + label مرتبط بـhtmlFor (وليس label يلفّ الـinput) لأن لفّ عناصر
 * like select/input داخل label يُنتج HTML غير صالح ويكسر ربط التسمية بالحقل.
 */
function Field({
  label,
  children,
  hint,
  error,
  required,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  error?: string;
  required?: boolean;
}) {
  return (
    <div className="block">
      <span className="label">
        {label} {required ? <span className="text-red-600">*</span> : null}
      </span>
      {children}
      {error ? (
        <span className="mt-1 block text-[11px] font-medium text-red-600">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-[11px] text-ink-400">{hint}</span>
      ) : null}
    </div>
  );
}
