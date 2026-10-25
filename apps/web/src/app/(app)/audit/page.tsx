'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Search, ShieldCheck } from 'lucide-react';
import { errorMessage, fetcher, qs } from '@/lib/api';
import { formatDateTime, formatNumber } from '@/lib/format';
import { Badge, Card, EmptyState, LoadingBlock, PageHeader, StatCard } from '@/components/ui';

interface AuditLogRow {
  _id: string;
  action: string;
  resource: string;
  resourceId?: string | null;
  summary: string;
  severity: 'info' | 'warning' | 'critical';
  actorName?: string;
  actorRole?: string;
  ip?: string;
  method?: string;
  path?: string;
  occurredAt: string;
  changes?: { field: string; before: unknown; after: unknown }[];
}

const ACTION_LABELS: Record<string, string> = {
  create: 'إضافة',
  update: 'تعديل',
  delete: 'حذف',
  login: 'تسجيل دخول',
  logout: 'تسجيل خروج',
  login_failed: 'فشل دخول',
  password_change: 'تغيير كلمة المرور',
  two_factor_enabled: 'تفعيل التحقق بخطوتين',
  two_factor_disabled: 'إيقاف التحقق بخطوتين',
  two_factor_recovery_regenerated: 'تجديد رموز استرداد',
  permission_change: 'تغيير صلاحيات',
  status_transition: 'تغيير حالة',
  approve: 'موافقة',
  reject: 'رفض',
  export: 'تصدير',
  import: 'استيراد',
  print: 'طباعة',
  file_upload: 'رفع ملف',
  file_download: 'تنزيل ملف',
  stock_adjust: 'تعديل مخزون',
  purchase_order: 'أمر شراء',
  order: 'اعتماد أمر شراء',
  receive: 'استلام',
  cancel: 'إلغاء',
  stock_count: 'جرد مخزون',
  supplier_payment: 'سداد مورد',
  payment: 'تحصيل',
  refund: 'استرداد',
  void: 'إلغاء فاتورة',
};

const SEVERITY_LABELS: Record<string, string> = {
  info: 'معلومة',
  warning: 'تحذير',
  critical: 'حرج',
};

const SEVERITY_COLORS: Record<string, string> = {
  info: 'border-sky-200 bg-sky-50 text-sky-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  critical: 'border-red-200 bg-red-50 text-red-700',
};

const RESOURCES = [
  'RepairTicket',
  'Invoice',
  'Payment',
  'Expense',
  'Customer',
  'Device',
  'Part',
  'Supplier',
  'PurchaseOrder',
  'StockCount',
  'StockTransfer',
  'User',
  'Organization',
  'Branch',
  'Estimate',
  'WarrantyClaim',
  'QualityCheck',
];

export default function AuditPage() {
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [resource, setResource] = useState('');
  const [severity, setSeverity] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  const key = `/audit-logs${qs({
    q: search || undefined,
    action: action || undefined,
    resource: resource || undefined,
    severity: severity || undefined,
    from: from || undefined,
    to: to || undefined,
    page,
    limit: 40,
  })}`;

  const { data, error, isLoading } = useSWR<{
    items: AuditLogRow[];
    meta: { page: number; pages: number; total: number };
  }>(key, fetcher);

  const items = data?.items ?? [];
  const criticalCount = items.filter((row) => row.severity === 'critical').length;
  const warningCount = items.filter((row) => row.severity === 'warning').length;

  return (
    <div>
      <PageHeader title="سجل التدقيق" subtitle="كل عملية حساسة: من فعلها، على ماذا، ومتى ومن أي جهاز" />

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatCard label="إجمالي السجلات" value={formatNumber(data?.meta.total ?? 0)} icon={<ShieldCheck size={18} />} tone="info" />
        <StatCard label="تحذيرات في الصفحة" value={formatNumber(warningCount)} tone={warningCount ? 'warning' : 'default'} />
        <StatCard label="أحداث حرجة في الصفحة" value={formatNumber(criticalCount)} tone={criticalCount ? 'danger' : 'success'} />
      </div>

      <Card className="mb-4">
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative sm:col-span-2">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              className="input pr-9"
              placeholder="ابحث في الوصف أو اسم المستخدم أو المورد…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <select
            className="input"
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(1);
            }}
          >
            <option value="">كل الإجراءات</option>
            {Object.entries(ACTION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            className="input"
            value={resource}
            onChange={(e) => {
              setResource(e.target.value);
              setPage(1);
            }}
          >
            <option value="">كل الموارد</option>
            {RESOURCES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <select
            className="input"
            value={severity}
            onChange={(e) => {
              setSeverity(e.target.value);
              setPage(1);
            }}
          >
            <option value="">كل المستويات</option>
            {Object.entries(SEVERITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <label className="block">
            <span className="label">من تاريخ</span>
            <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">إلى تاريخ</span>
            <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
      </Card>

      {error ? <Card className="mb-4 border-red-200 bg-red-50 p-4 text-sm text-red-700">{errorMessage(error)}</Card> : null}

      <Card>
        {isLoading ? (
          <LoadingBlock rows={8} />
        ) : items.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>الوقت</th>
                  <th>الإجراء</th>
                  <th>المورد</th>
                  <th>الوصف</th>
                  <th>المستخدم</th>
                  <th>المستوى</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row._id}>
                    <td className="whitespace-nowrap text-xs">{formatDateTime(row.occurredAt)}</td>
                    <td>
                      <Badge className="border-ink-200 bg-ink-50 text-ink-700">{ACTION_LABELS[row.action] ?? row.action}</Badge>
                    </td>
                    <td className="text-xs">
                      <p className="font-medium text-ink-800">{row.resource}</p>
                      <p className="text-ink-400" dir="ltr">
                        {row.resourceId ? String(row.resourceId).slice(-8) : '—'}
                      </p>
                    </td>
                    <td className="max-w-md text-xs text-ink-600">{row.summary || '—'}</td>
                    <td className="text-xs">
                      <p className="font-medium text-ink-800">{row.actorName || '—'}</p>
                      <p className="text-ink-400">{row.actorRole || ''}</p>
                    </td>
                    <td>
                      <Badge className={SEVERITY_COLORS[row.severity] ?? 'border-ink-200 bg-ink-50 text-ink-700'}>
                        {SEVERITY_LABELS[row.severity] ?? row.severity}
                      </Badge>
                    </td>
                    <td className="text-xs text-ink-500" dir="ltr">
                      {row.ip || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data && data.meta.pages > 1 ? (
              <div className="flex items-center justify-between border-t border-ink-100 px-4 py-2 text-xs text-ink-500">
                <span>
                  صفحة {data.meta.page} من {data.meta.pages} — {formatNumber(data.meta.total)} سجل
                </span>
                <div className="flex gap-1">
                  <button type="button" className="btn-ghost px-2 py-1" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    السابق
                  </button>
                  <button
                    type="button"
                    className="btn-ghost px-2 py-1"
                    disabled={page >= data.meta.pages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    التالي
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <EmptyState title="لا توجد أحداث مطابقة" description="جرّب توسيع الفترة أو إزالة الفلاتر" icon={<ShieldCheck size={20} />} />
        )}
      </Card>
    </div>
  );
}
