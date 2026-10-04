'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Wrench, ShieldCheck, ClipboardCheck, Cpu, Building2 } from 'lucide-react';
import { useAuth, getStoredUser } from '@/lib/auth';
import { homePathForRole } from '@/lib/routePermissions';
import { useToast } from '@/components/ui/Toast';

const FEATURES = [
  { icon: <Wrench size={16} />, text: 'دورة حياة الجهاز من الاستلام حتى الضمان' },
  { icon: <ShieldCheck size={16} />, text: 'توثيق رقمي كامل وأدلة قابلة للمراجعة' },
  { icon: <ClipboardCheck size={16} />, text: 'فحص جودة إلزامي قبل التسليم' },
  { icon: <Cpu size={16} />, text: 'تحليلات الضمان وجودة القطع' },
];

export default function LoginPage() {
  const router = useRouter();
  const { login, isAuthenticated, isLoading, user } = useAuth();
  const toast = useToast();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [organizationSlug, setOrganizationSlug] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // كل دور يهبط على شاشته الرئيسية: الفني على شاشة الورشة، والباقي على لوحة التحكم
  useEffect(() => {
    if (!isLoading && isAuthenticated) router.replace(homePathForRole(user?.role));
  }, [isAuthenticated, isLoading, router, user?.role]);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login(identifier.trim(), password, organizationSlug.trim() || undefined);
      toast.success('تم تسجيل الدخول بنجاح');
      router.replace(homePathForRole(getStoredUser()?.role));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'تعذر تسجيل الدخول';
      setError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const fillDemo = (user: string, pass: string) => {
    setIdentifier(user);
    setPassword(pass);
    setError(null);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-900 via-brand-800 to-ink-900 p-4">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl lg:grid-cols-[1.1fr_1fr]">
        {/* اللوحة التعريفية */}
        <div className="hidden flex-col justify-between bg-brand-800 p-8 text-white lg:flex">
          <div>
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 text-base font-bold">
                MR
              </span>
              <div>
                <p className="text-lg font-bold">Mobile Repair OS</p>
                <p className="text-xs text-brand-100">نظام تشغيل مراكز صيانة الموبايل</p>
              </div>
            </div>

            <h1 className="mt-8 text-2xl font-bold leading-snug">
              الجهاز هو محور البيانات.
              <br />
              والصيانة عملية قابلة للتتبع والقياس.
            </h1>

            <ul className="mt-6 space-y-3">
              {FEATURES.map((feature) => (
                <li key={feature.text} className="flex items-center gap-2.5 text-sm text-brand-50">
                  <span className="rounded-md bg-white/15 p-1.5">{feature.icon}</span>
                  {feature.text}
                </li>
              ))}
            </ul>
          </div>

          <p className="mt-8 text-[11px] leading-relaxed text-brand-200">
            مبنية على MongoDB + Express للـAPI وNext.js للواجهة — عزل بيانات كامل لكل مركز، صلاحيات بالأدوار، وسجل تدقيق لكل
            عملية.
          </p>
        </div>

        {/* نموذج الدخول */}
        <div className="p-6 sm:p-9">
          <div className="mb-6 lg:hidden">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-700 text-sm font-bold text-white">
              MR
            </span>
          </div>

          <h2 className="text-xl font-bold text-ink-900">تسجيل الدخول</h2>
          <p className="mt-1 text-sm text-ink-500">ادخل بيانات حسابك للوصول إلى لوحة التشغيل.</p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <label className="block">
              <span className="label">اسم المستخدم أو البريد الإلكتروني</span>
              <input
                className="input"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="owner"
                autoComplete="username"
                required
                dir="ltr"
              />
            </label>

            <label className="block">
              <span className="label">كلمة المرور</span>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
                dir="ltr"
              />
            </label>

            <label className="block">
              <span className="label">معرّف المركز (اختياري)</span>
              <input
                className="input"
                value={organizationSlug}
                onChange={(e) => setOrganizationSlug(e.target.value)}
                placeholder="mobile-care-eg"
                dir="ltr"
              />
              <span className="mt-1 block text-xs text-ink-400">
                يُستخدم فقط لو نفس اسم المستخدم موجود في أكثر من مركز.
              </span>
            </label>

            {error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</div>
            ) : null}

            <button type="submit" className="btn-primary w-full" disabled={isSubmitting}>
              {isSubmitting ? 'جارٍ التحقق…' : 'دخول'}
            </button>
          </form>

          {/* إنشاء حساب مركز جديد */}
          <div className="mt-6 border-t border-ink-200 pt-5">
            <p className="text-center text-xs text-ink-500">صاحب مركز صيانة وليس لديك حساب؟</p>
            <Link
              href="/register"
              className="btn-secondary mt-3 w-full border-brand-600 text-brand-700 hover:bg-brand-50"
            >
              <Building2 size={16} />
              إنشاء حساب مركز جديد — تجربة مجانية
            </Link>
            <p className="mt-2 text-center text-[11px] text-ink-400">
              حتى 5 مستخدمين وفرعين و300 تذكرة شهريًا، بدون بطاقة بنكية.
            </p>
          </div>

          <div className="mt-7 rounded-xl border border-ink-200 bg-ink-50 p-4">
            <p className="mb-2 text-xs font-bold text-ink-600">حسابات تجريبية (بعد تشغيل seed)</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'مالك المركز', user: 'owner', pass: 'Owner@1234' },
                { label: 'مدير فرع', user: 'manager', pass: 'Manager@1234' },
                { label: 'استقبال', user: 'reception', pass: 'Reception@1234' },
                { label: 'فني', user: 'tech.ahmed', pass: 'Tech@1234' },
              ].map((account) => (
                <button
                  key={account.user}
                  type="button"
                  onClick={() => fillDemo(account.user, account.pass)}
                  className="rounded-lg border border-ink-200 bg-white px-2.5 py-2 text-right text-[11px] transition hover:border-brand-400 hover:bg-brand-50"
                >
                  <span className="block font-bold text-ink-700">{account.label}</span>
                  <span className="block text-ink-500" dir="ltr">
                    {account.user}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
