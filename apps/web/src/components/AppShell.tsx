'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { clsx } from 'clsx';
import useSWR from 'swr';
import { LogOut, Menu, X, Building2, Bell } from 'lucide-react';
import { useAuth, ROLE_LABELS_AR } from '@/lib/auth';
import { initials } from '@/lib/format';
import { fetcher } from '@/lib/api';
import { NAV_GROUPS, canAccessRoute } from '@/lib/routePermissions';
import { OfflineStatus } from '@/components/OfflineStatus';
import { InstallAppButton } from '@/components/InstallAppButton';

/** مبدّل الفرع: يغيّر نطاق كل شاشات النظام فورًا */
function BranchSwitcher({ compact = false }: { compact?: boolean }) {
  const { user, availableBranches, activeBranchId, setActiveBranch } = useAuth();
  if (!user || availableBranches.length === 0) return null;

  const orgWide = ['owner', 'admin', 'accountant', 'viewer'].includes(user.role);

  return (
    <label
      className={clsx(
        'flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-xs text-ink-700',
        compact ? 'max-w-[190px]' : 'w-full',
      )}
      title="الفرع النشط — يحدد نطاق البيانات والعمليات"
    >
      <Building2 size={14} className="shrink-0 text-ink-400" />
      <select
        value={activeBranchId ?? ''}
        onChange={(event) => setActiveBranch(event.target.value || null)}
        className="min-w-0 flex-1 cursor-pointer bg-transparent font-medium outline-none"
      >
        {orgWide ? <option value="">كل الفروع</option> : null}
        {availableBranches.map((branch) => (
          <option key={branch.id} value={branch.id}>
            {branch.name} ({branch.code})
          </option>
        ))}
      </select>
    </label>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, organization, logout, hasPermission } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  // عدّاد الإشعارات غير المقروءة — يتحدث كل دقيقة دون إثقال الصفحة
  const { data: notifications } = useSWR<{ meta?: { unreadInApp?: number } }>(
    '/notifications?channel=in_app&limit=1',
    fetcher,
    { refreshInterval: 60_000, revalidateOnFocus: false },
  );
  const unreadNotifications = notifications?.meta?.unreadInApp ?? 0;

  const bell = (
    <Link
      href="/notifications"
      className="btn-ghost relative px-2"
      title={unreadNotifications ? `${unreadNotifications} إشعار غير مقروء` : 'الإشعارات'}
      onClick={() => setMobileOpen(false)}
    >
      <Bell size={18} />
      {unreadNotifications > 0 ? (
        <span className="absolute -top-1 -left-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
          {unreadNotifications > 9 ? '9+' : unreadNotifications}
        </span>
      ) : null}
    </Link>
  );

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  /**
   * السايد بار يعرض فقط ما يملك المستخدم صلاحيته.
   * الخريطة مشتركة مع حارس المسارات في `lib/routePermissions`، فلا يمكن أن يظهر
   * رابط لصفحة محجوبة أو يُحجب رابط لصفحة متاحة.
   */
  const nav = (
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4">
      {NAV_GROUPS.map((group) => {
        const items = group.items.filter((item) => canAccessRoute(item, hasPermission, user?.role));
        if (!items.length) return null;
        return (
          <div key={group.title}>
            <p className="mb-1.5 px-2 text-[11px] font-bold uppercase tracking-wide text-ink-400">{group.title}</p>
            <ul className="space-y-0.5">
              {items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={clsx(
                      'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition',
                      isActive(item.href)
                        ? 'bg-brand-700 text-white shadow-sm'
                        : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
                    )}
                  >
                    <span className={isActive(item.href) ? 'text-white' : 'text-ink-400'}>{item.icon}</span>
                    <span>{item.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      {/* لو لم يتبقَّ أي رابط: رسالة واضحة بدل سايد بار فارغ */}
      {NAV_GROUPS.every((group) => group.items.every((item) => !canAccessRoute(item, hasPermission, user?.role))) ? (
        <p className="px-2 text-xs leading-relaxed text-ink-400">
          دورك الحالي لا يمنحك الوصول لأي صفحة. تواصل مع مالك المركز.
        </p>
      ) : null}
    </nav>
  );

  return (
    <div className="min-h-screen bg-ink-50">
      {/* سايد بار سطح المكتب */}
      <aside className="fixed inset-y-0 right-0 hidden w-64 flex-col border-l border-ink-200 bg-white lg:flex">
        <div className="flex items-center gap-3 border-b border-ink-200 px-4 py-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-700 text-sm font-bold text-white">
            MR
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-ink-900">{organization?.name ?? 'Mobile Repair OS'}</p>
            <p className="text-[11px] text-ink-500">{user ? ROLE_LABELS_AR[user.role] : ''}</p>
          </div>
          <div className="ms-auto">{bell}</div>
        </div>

        <div className="border-b border-ink-200 px-3 py-2.5">
          <BranchSwitcher />
        </div>

        {nav}

        <div className="border-t border-ink-200 p-3">
          <div className="mb-2">
            <InstallAppButton />
          </div>
          <div className="mb-2 flex items-center gap-2.5 rounded-lg bg-ink-50 px-2.5 py-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-800">
              {user ? initials(user.fullName) : '—'}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-bold text-ink-800">{user?.fullName ?? ''}</p>
              <p className="truncate text-[11px] text-ink-500">@{user?.username ?? ''}</p>
            </div>
          </div>
          <button type="button" onClick={logout} className="btn-ghost w-full justify-start text-xs">
            <LogOut size={15} />
            تسجيل الخروج
          </button>
        </div>
      </aside>

      {/* سايد بار الجوال */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink-900/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 right-0 flex w-72 flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-ink-200 px-4 py-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-700 text-xs font-bold text-white">
                  MR
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-ink-900">{organization?.name ?? ''}</p>
                  <p className="text-[11px] text-ink-500">{user ? ROLE_LABELS_AR[user.role] : ''}</p>
                </div>
              </div>
              <button type="button" onClick={() => setMobileOpen(false)} className="btn-ghost px-2">
                <X size={18} />
              </button>
            </div>
            {nav}
            <div className="border-t border-ink-200 p-3">
              <div className="mb-2">
                <InstallAppButton />
              </div>
              <button type="button" onClick={logout} className="btn-ghost w-full justify-start text-xs">
                <LogOut size={15} />
                تسجيل الخروج
              </button>
            </div>
          </aside>
        </div>
      ) : null}

      {/* المحتوى */}
      <div className="lg:pr-64">        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-ink-200 bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
          <button type="button" onClick={() => setMobileOpen(true)} className="btn-ghost px-2">
            <Menu size={18} />
          </button>
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-700 text-[11px] font-bold text-white">
              MR
            </span>
            <span className="text-sm font-bold text-ink-900">Mobile Repair OS</span>
          </div>
          <div className="flex items-center gap-1.5">
            <BranchSwitcher compact />
            {bell}
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6">
          <OfflineStatus />
          {children}
        </main>
      </div>
    </div>
  );
}
