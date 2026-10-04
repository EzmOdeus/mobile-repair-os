'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { homePathForRole } from '@/lib/routePermissions';

/**
 * بوابة الدخول: توجيه حسب الدور — الفني إلى شاشة الفني، وباقي الأدوار إلى لوحة التحكم.
 * (كانت redirect ثابتة للوحة التحكم، فيصطدم الفني بشاشة ممنوعة عليه.)
 */
export default function HomePage() {
  const router = useRouter();
  const { user, isLoading, isAuthenticated } = useAuth();

  useEffect(() => {
    if (isLoading) return;
    router.replace(isAuthenticated ? homePathForRole(user?.role) : '/login');
  }, [isLoading, isAuthenticated, user?.role, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50">
      <div className="flex flex-col items-center gap-3 text-ink-400">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-ink-200 border-t-brand-600" />
        <p className="text-sm">جارٍ التوجيه…</p>
      </div>
    </div>
  );
}
