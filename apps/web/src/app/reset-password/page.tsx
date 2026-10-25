'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';

export default function ResetPasswordPage() {
  const router = useRouter();
  const toast = useToast();

  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // نقرأ الرمز من الرابط عبر window لتجنّب متطلبات Suspense في Next 15
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('token');
    if (fromUrl) setToken(fromUrl);
  }, []);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      setError('كلمة المرور 8 أحرف على الأقل وتحتوي حرفًا ورقمًا');
      return;
    }
    if (password !== confirm) {
      setError('كلمتا المرور غير متطابقتين');
      return;
    }

    setIsSubmitting(true);
    try {
      await api.post<{ message: string }>('/auth/reset-password', { token: token.trim(), password });
      setDone(true);
      toast.success('تم تحديث كلمة المرور، سجّل الدخول من جديد');
      setTimeout(() => router.replace('/login'), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إعادة تعيين كلمة المرور');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-900 via-brand-800 to-ink-900 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-brand-100 text-brand-700">
          <ShieldCheck size={22} />
        </span>
        <h1 className="mt-4 text-center text-xl font-bold text-ink-900">إعادة تعيين كلمة المرور</h1>
        <p className="mt-1 text-center text-sm text-ink-500">اختر كلمة مرور جديدة لحسابك.</p>

        {done ? (
          <div className="mt-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            تم تحديث كلمة المرور بنجاح — جارٍ تحويلك لتسجيل الدخول…
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <label className="block">
              <span className="label">رمز الاستعادة</span>
              <input
                className="input"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="الصق الرمز هنا"
                required
                dir="ltr"
              />
            </label>

            <label className="block">
              <span className="label">كلمة المرور الجديدة</span>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                required
                dir="ltr"
              />
              <span className="mt-1 block text-xs text-ink-400">8 أحرف على الأقل، وتحتوي حرفًا ورقمًا.</span>
            </label>

            <label className="block">
              <span className="label">تأكيد كلمة المرور</span>
              <input
                className="input"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                required
                dir="ltr"
              />
            </label>

            {error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</div>
            ) : null}

            <button type="submit" className="btn-primary w-full" disabled={isSubmitting}>
              {isSubmitting ? 'جارٍ الحفظ…' : 'حفظ كلمة المرور الجديدة'}
            </button>
            <Link href="/login" className="block text-center text-xs text-ink-500 hover:text-brand-700">
              العودة لتسجيل الدخول
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
