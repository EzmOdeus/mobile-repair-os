'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { AppShell } from '@/components/AppShell';
import { RequirePermission } from '@/components/RequirePermission';

/**
 * طبقة الصفحات المحمية.
 *
 * المسؤوليات مفصولة عن قصد:
 *   - هذا الـlayout: هل المستخدم مسجّل دخول أصلًا؟
 *   - `RequirePermission`: هل يملك صلاحية الصفحة المطلوبة؟
 * فلا يختلط التحقق من الجلسة بالتحقق من الصلاحية، وكل صفحة تُحمى بالمسار الذي تطلبه.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace('/login');
  }, [isAuthenticated, isLoading, router]);

  if (isLoading || !isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-50">
        <div className="flex flex-col items-center gap-3">
          <span className="h-9 w-9 animate-spin rounded-full border-[3px] border-brand-200 border-t-brand-700" />
          <p className="text-sm text-ink-500">جارٍ تحميل الجلسة…</p>
        </div>
      </div>
    );
  }

  return (
    <AppShell>
      <RequirePermission>{children}</RequirePermission>
    </AppShell>
  );
}
