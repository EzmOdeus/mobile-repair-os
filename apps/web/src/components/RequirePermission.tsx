'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowRight, Lock, ShieldAlert } from 'lucide-react';
import { ROLE_LABELS_AR, useAuth } from '@/lib/auth';
import { PROTECTED_ROUTES, canAccessRoute, homePathForRole, permissionForPath } from '@/lib/routePermissions';

/**
 * حارس المسارات: يمنع الوصول المباشر بالرابط لصفحة لا يملك المستخدم صلاحيتها.
 *
 * مهم: لا نعرض `children` أبدًا قبل التأكد من الصلاحية، وإلا ظهرت الصفحة لحظيًا
 * (flash of unauthorized content) ثم اختفت — وهو ما يجعل الحماية شكلية.
 *
 * الترتيب: انتظار تحميل الجلسة ← التحقق من المصادقة ← التحقق من الصلاحية ← العرض.
 */
export function RequirePermission({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isLoading, isAuthenticated, hasPermission } = useAuth();

  const route = permissionForPath(pathname);
  const allowed = canAccessRoute(route, hasPermission, user?.role);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace('/login');
  }, [isLoading, isAuthenticated, router]);

  // أثناء تحميل الجلسة: هيكل تحميل بدل المحتوى (لا تسريب ولا وميض)
  if (isLoading || !isAuthenticated) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-ink-400">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-ink-200 border-t-brand-600" />
          <p className="text-sm">جارٍ التحقق من الصلاحيات…</p>
        </div>
      </div>
    );
  }

  if (allowed) return <>{children}</>;

  return <AccessDenied routeLabel={route?.label ?? 'هذه الصفحة'} requiredPermission={route!.permission} />;
}

/** شاشة «لا تملك صلاحية» — تعرض الصفحات المتاحة للمستخدم بدل طريق مسدود */
function AccessDenied({ routeLabel, requiredPermission }: { routeLabel: string; requiredPermission: string }) {
  const { user, hasPermission } = useAuth();
  const available = PROTECTED_ROUTES.filter((route) => canAccessRoute(route, hasPermission, user?.role));

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center px-4 py-14 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
        <ShieldAlert size={28} />
      </span>

      <h1 className="mt-4 text-xl font-bold text-ink-900">لا تملك صلاحية الوصول</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-500">
        دورك الحالي{' '}
        <span className="font-bold text-ink-700">({user?.role ? ROLE_LABELS_AR[user.role] : '—'})</span> لا يمنحك الوصول إلى{' '}
        <span className="font-bold text-ink-700">{routeLabel}</span>.
        <br />
        لو كنت تحتاج هذه الصفحة، اطلب من مالك المركز منحك صلاحية{' '}
        <code className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] font-bold text-ink-700" dir="ltr">
          {requiredPermission}
        </code>
        .
      </p>

      <Link href={homePathForRole(user?.role)} className="btn-primary mt-6">
        <ArrowRight size={16} className="rotate-180" />
        العودة إلى شاشتي الرئيسية
      </Link>

      {available.length ? (
        <div className="mt-10 w-full text-right">
          <p className="mb-2 flex items-center gap-2 text-xs font-bold text-ink-600">
            <Lock size={14} /> الصفحات المتاحة لك
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {available.map((route) => (
              <Link
                key={route.href}
                href={route.href}
                className="flex items-center gap-2.5 rounded-lg border border-ink-200 bg-white p-3 text-sm transition hover:border-brand-400 hover:bg-brand-50"
              >
                <span className="text-ink-400">{route.icon}</span>
                <span>
                  <span className="block font-bold text-ink-800">{route.label}</span>
                  <span className="block text-[11px] text-ink-500">{route.description}</span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * لا صلاحية لهذه الصفحة على الإطلاق (احتياطي).
 * يُستخدم لو أضفت مسارًا محميًا في `NAV_GROUPS` ونسيت إدراجه في الحارس.
 */
export function withPermissionGuard<P extends object>(
  Component: React.ComponentType<P>,
): React.ComponentType<P> {
  return function Guarded(props: P) {
    return (
      <RequirePermission>
        <Component {...props} />
      </RequirePermission>
    );
  };
}

export { NAV_GROUPS } from '@/lib/routePermissions';
