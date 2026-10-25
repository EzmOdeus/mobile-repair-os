'use client';

import Link from 'next/link';
import { WifiOff, RefreshCw } from 'lucide-react';
import { useOnlineStatus } from '@/lib/useOnlineStatus';

export default function OfflinePage() {
  const online = useOnlineStatus();

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-ink-200 bg-white p-7 text-center shadow-card">
        <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
          <WifiOff size={26} />
        </span>
        <h1 className="text-lg font-bold text-ink-900">
          {online ? 'الاتصال عاد' : 'لا يوجد اتصال بالإنترنت'}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-500">
          {online
            ? 'يمكنك متابعة العمل الآن. إن كانت لديك تذاكر محفوظة محليًا فستُزامَن تلقائيًا.'
            : 'تحقق من الشبكة ثم أعد المحاولة. التذاكر التي أُنشئت أثناء الانقطاع محفوظة على هذا الجهاز وتُرسل عند عودة الاتصال.'}
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
            <RefreshCw size={15} /> إعادة المحاولة
          </button>
          <Link href="/login" className="btn-secondary">
            العودة لتسجيل الدخول
          </Link>
        </div>
      </div>
    </div>
  );
}
