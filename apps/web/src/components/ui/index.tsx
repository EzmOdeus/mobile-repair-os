import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('card', className)}>{children}</div>;
}

export function CardHeader({
  title,
  subtitle,
  action,
  icon,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-ink-100 px-4 py-3 sm:px-5">
      <div className="flex items-start gap-2.5">
        {icon ? <span className="mt-0.5 text-brand-700">{icon}</span> : null}
        <div>
          <h2 className="text-sm font-bold text-ink-800 sm:text-base">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs text-ink-500">{subtitle}</p> : null}
        </div>
      </div>
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'info';
}) {
  const tones = {
    default: 'text-ink-800',
    success: 'text-emerald-700',
    warning: 'text-amber-700',
    danger: 'text-red-700',
    info: 'text-sky-700',
  } as const;

  const iconTones = {
    default: 'bg-ink-100 text-ink-600',
    success: 'bg-emerald-50 text-emerald-700',
    warning: 'bg-amber-50 text-amber-700',
    danger: 'bg-red-50 text-red-700',
    info: 'bg-sky-50 text-sky-700',
  } as const;

  return (
    <div className="card card-pad">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-ink-500">{label}</p>
          <p className={clsx('mt-1.5 text-2xl font-bold num', tones[tone])}>{value}</p>
          {hint ? <p className="mt-1 text-xs text-ink-500">{hint}</p> : null}
        </div>
        {icon ? <span className={clsx('rounded-lg p-2', iconTones[tone])}>{icon}</span> : null}
      </div>
    </div>
  );
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={clsx('badge border', className)}>{children}</span>;
}

export function EmptyState({
  title,
  description,
  icon,
  action,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      {icon ? <span className="rounded-full bg-ink-100 p-3 text-ink-400">{icon}</span> : null}
      <div>
        <p className="text-sm font-semibold text-ink-700">{title}</p>
        {description ? <p className="mt-1 text-xs text-ink-500">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function LoadingBlock({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: rows }).map((_, idx) => (
        <div key={idx} className="skeleton h-5 w-full" style={{ width: `${90 - idx * 8}%` }} />
      ))}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  breadcrumb,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {breadcrumb ? <div className="mb-1 text-xs text-ink-500">{breadcrumb}</div> : null}
        <h1 className="text-xl font-bold text-ink-900 sm:text-2xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-ink-500">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
  required,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="label">
        {label} {required ? <span className="text-red-600">*</span> : null}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-ink-400">{hint}</span> : null}
    </label>
  );
}

export function ProgressBar({ value, tone = 'brand' }: { value: number; tone?: 'brand' | 'amber' | 'red' | 'emerald' }) {
  const tones = {
    brand: 'bg-brand-600',
    amber: 'bg-amber-500',
    red: 'bg-red-500',
    emerald: 'bg-emerald-600',
  } as const;

  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-ink-200">
      <div className={clsx('h-full rounded-full transition-all', tones[tone])} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}
