'use client';

import { useState } from 'react';
import Link from 'next/link';
import { KeyRound } from 'lucide-react';
import { api } from '@/lib/api';

interface ForgotResponse {
  message: string;
  /** يُعاد في بيئة التطوير فقط لإتمام التدفق بلا بريد فعلي */
  resetToken?: string;
}

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<ForgotResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const data = await api.post<ForgotResponse>('/auth/forgot-password', { email: email.trim().toLowerCase() });
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إرسال طلب الاستعادة');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-900 via-brand-800 to-ink-900 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-brand-100 text-brand-700">
          <KeyRound size={22} />
        </span>
        <h1 className="mt-4 text-center text-xl font-bold text-ink-900">استعادة كلمة المرور</h1>
        <p className="mt-1 text-center text-sm text-ink-500">
          أدخل بريدك الإلكتروني وسنرسل لك رمزًا لإعادة تعيين كلمة المرور (صالح 30 دقيقة).
        </p>

        {result ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
              {result.message}
            </div>
            {/* في بيئة التطوير يُعاد الرمز مباشرة لأن الإرسال البريدي غير مربوط بعد */}
            {result.resetToken ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                <p className="font-bold">(وضع التطوير) الرمز متاح مباشرة:</p>
                <Link
                  href={`/reset-password?token=${encodeURIComponent(result.resetToken)}`}
                  className="mt-2 inline-block font-bold text-brand-700 underline"
                >
                  الانتقال لصفحة إعادة التعيين ←
                </Link>
              </div>
            ) : null}
            <Link href="/login" className="btn-secondary w-full">
              العودة لتسجيل الدخول
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <label className="block">
              <span className="label">البريد الإلكتروني</span>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="owner@mobilecare-eg.com"
                autoComplete="email"
                required
                dir="ltr"
              />
            </label>

            {error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</div>
            ) : null}

            <button type="submit" className="btn-primary w-full" disabled={isSubmitting}>
              {isSubmitting ? 'جارٍ الإرسال…' : 'إرسال رمز الاستعادة'}
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
