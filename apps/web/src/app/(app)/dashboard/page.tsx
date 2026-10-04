'use client';

import { useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  AlertTriangle,
  BadgeDollarSign,
  ClipboardList,
  Clock,
  Package,
  ShieldCheck,
  Smartphone,
  Users,
  Wrench,
} from 'lucide-react';
import { api, fetcher, qs, errorMessage } from '@/lib/api';
import { formatMoney, formatNumber, formatPercent, timeAgo } from '@/lib/format';
import { STATUS_COLORS, statusLabel, type Priority, type RepairStatus } from '@/lib/constants';
import { Card, CardHeader, EmptyState, LoadingBlock, PageHeader, StatCard } from '@/components/ui';
import type { StatusDistribution, TrendPoint } from '@/components/dashboard/DashboardCharts';

/**
 * الرسوم تُحمَّل كchunk منفصل بعد ظهور المؤشرات، بدل تحميل recharts مع أول فتح للصفحة.
 * `ssr: false` لأن الرسوم لا تُرسم إلا في المتصفح.
 */
const DashboardCharts = dynamic(() => import('@/components/dashboard/DashboardCharts'), {
  ssr: false,
  loading: () => (
    <div className="mt-5 grid gap-4 xl:grid-cols-3">
      <Card className="xl:col-span-2">
        <div className="card-pad h-72">
          <LoadingBlock rows={5} />
        </div>
      </Card>
      <Card>
        <div className="card-pad h-72">
          <LoadingBlock rows={4} />
        </div>
      </Card>
    </div>
  ),
});

interface DashboardData {
  operations: {
    openTickets: number;
    overdueTickets: number;
    readyForPickup: number;
    waitingApproval: number;
    waitingParts: number;
    inRepair: number;
    newTicketsInRange: number;
    deliveredInRange: number;
  };
  customers: { total: number };
  devices: { total: number };
  finance: { revenueEgp: number; receivablesEgp: number; pendingInvoices: number };
  inventory: { lowStockCount: number };
  quality: {
    checksInRange: number;
    firstTimePassInRange: number;
    firstTimePassRatePct: number;
    warrantyClaimsInRange: number;
  };
  team: { activeTechnicians: number };
  currency: string;
}

interface TrendsData {
  daily: TrendPoint[];
}

interface BoardData {
  columns: { status: RepairStatus; label: string; count: number; tickets: BoardTicket[] }[];
  totals: { active: number; overdue: number; unassigned: number };
}

interface BoardTicket {
  _id: string;
  ticketNumber: string;
  status: RepairStatus;
  priority: Priority;
  createdAt: string;
  isOverdue?: boolean;
  customerId?: { fullName: string; phone: string } | null;
  deviceId?: { brand: string; model: string } | null;
  assignedTechnicianId?: { fullName: string } | null;
}

export default function DashboardPage() {
  const [period, setPeriod] = useState<'today' | 'week' | 'month' | 'last30'>('last30');

  const { data, error, isLoading } = useSWR<DashboardData>(
    `/analytics/dashboard${qs({ period })}`,
    fetcher,
    { refreshInterval: 60_000 },
  );
  const { data: trends } = useSWR<TrendsData>(`/analytics/trends${qs({ period })}`, fetcher);
  const { data: board } = useSWR<BoardData>('/tickets/board', fetcher, { refreshInterval: 45_000 });
  const { data: distribution } = useSWR<StatusDistribution[]>(
    `/analytics/status-distribution${qs({ period })}`,
    fetcher,
  );

  const overdueRate = data ? (data.operations.openTickets ? (data.operations.overdueTickets / data.operations.openTickets) * 100 : 0) : 0;

  return (
    <div>
      <PageHeader
        title="لوحة التحكم"
        subtitle="نظرة فورية على التشغيل والجودة والمال — تتحدث تلقائيًا"
        actions={
          <select className="input w-auto" value={period} onChange={(e) => setPeriod(e.target.value as typeof period)}>
            <option value="today">اليوم</option>
            <option value="week">هذا الأسبوع</option>
            <option value="month">هذا الشهر</option>
            <option value="last30">آخر 30 يومًا</option>
          </select>
        }
      />

      {error ? (
        <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">{errorMessage(error)}</Card>
      ) : null}

      {isLoading || !data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="card card-pad">
              <div className="skeleton h-3 w-24" />
              <div className="skeleton mt-3 h-7 w-16" />
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* مؤشرات التشغيل */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="تذاكر مفتوحة"
              value={formatNumber(data.operations.openTickets)}
              hint={`${formatNumber(data.operations.newTicketsInRange)} جديدة في الفترة`}
              icon={<Wrench size={18} />}
              tone="info"
            />
            <StatCard
              label="متأخرة عن الموعد (SLA)"
              value={formatNumber(data.operations.overdueTickets)}
              hint={`${formatPercent(overdueRate)} من التذاكر المفتوحة`}
              icon={<AlertTriangle size={18} />}
              tone={data.operations.overdueTickets > 0 ? 'danger' : 'success'}
            />
            <StatCard
              label="جاهزة للاستلام"
              value={formatNumber(data.operations.readyForPickup)}
              hint={`${formatNumber(data.operations.waitingApproval)} بانتظار موافقة العميل`}
              icon={<Clock size={18} />}
              tone="success"
            />
            <StatCard
              label="الإيراد المحصّل"
              value={formatMoney(data.finance.revenueEgp)}
              hint={`مستحقات: ${formatMoney(data.finance.receivablesEgp)}`}
              icon={<BadgeDollarSign size={18} />}
              tone="success"
            />
          </div>

          {/* مؤشرات ثانوية */}
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="بانتظار قطع غيار"
              value={formatNumber(data.operations.waitingParts)}
              hint={`${formatNumber(data.operations.inRepair)} جهاز قيد الإصلاح`}
              icon={<Package size={18} />}
              tone="warning"
            />
            <StatCard
              label="اجتياز الجودة من أول مرة"
              value={formatPercent(data.quality.firstTimePassRatePct)}
              hint={`${formatNumber(data.quality.checksInRange)} فحص في الفترة`}
              icon={<ShieldCheck size={18} />}
              tone={data.quality.firstTimePassRatePct >= 85 ? 'success' : 'warning'}
            />
            <StatCard
              label="قطع تحت حد إعادة الطلب"
              value={formatNumber(data.inventory.lowStockCount)}
              hint="تحتاج أمر شراء"
              icon={<Package size={18} />}
              tone={data.inventory.lowStockCount > 0 ? 'warning' : 'success'}
            />
            <StatCard
              label="عوائد الضمان"
              value={formatNumber(data.quality.warrantyClaimsInRange)}
              hint={`${formatNumber(data.team.activeTechnicians)} فني نشط`}
              icon={<ShieldCheck size={18} />}
              tone="default"
            />
          </div>

          {/* الرسوم — chunk منفصل يُحمَّل بعد ظهور المؤشرات */}
          <DashboardCharts trends={trends?.daily} distribution={distribution} />

          {/* لوحة الحالات + بيانات أساسية */}
          <div className="mt-5 grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader
                title="حالة التشغيل الآن"
                subtitle={`${formatNumber(board?.totals.active ?? 0)} تذكرة نشطة · ${formatNumber(
                  board?.totals.overdue ?? 0,
                )} متأخرة · ${formatNumber(board?.totals.unassigned ?? 0)} بدون فني`}
                icon={<ClipboardList size={18} />}
                action={
                  <Link href="/tickets" className="btn-secondary text-xs">
                    فتح اللوحة
                  </Link>
                }
              />
              <div className="card-pad">
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {board?.columns
                    ?.filter((column) => column.count > 0)
                    .slice(0, 10)
                    .map((column) => (
                      <Link
                        key={column.status}
                        href={`/tickets?status=${column.status}`}
                        className="flex items-center justify-between rounded-lg border border-ink-200 px-3 py-2.5 transition hover:border-brand-400 hover:bg-brand-50/50"
                      >
                        <span className={`badge border ${STATUS_COLORS[column.status]}`}>{column.label}</span>
                        <span className="text-sm font-bold text-ink-800 num">{formatNumber(column.count)}</span>
                      </Link>
                    ))}
                  {!board?.columns?.some((c) => c.count > 0) ? (
                    <p className="text-sm text-ink-500">لا توجد تذاكر نشطة حاليًا.</p>
                  ) : null}
                </div>
              </div>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader title="أحدث التذاكر" icon={<Wrench size={18} />} />
                <div className="divide-y divide-ink-100">
                  {board?.columns
                    ?.flatMap((c) => c.tickets)
                    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                    .slice(0, 6)
                    .map((ticket) => (
                      <Link
                        key={ticket._id}
                        href={`/tickets/${ticket._id}`}
                        className="flex items-center justify-between gap-2 px-4 py-2.5 transition hover:bg-ink-50"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-xs font-bold text-ink-800" dir="ltr">
                            {ticket.ticketNumber}
                          </p>
                          <p className="truncate text-[11px] text-ink-500">
                            {ticket.deviceId ? `${ticket.deviceId.brand} ${ticket.deviceId.model}` : '—'}
                          </p>
                        </div>
                        <div className="shrink-0 text-left">
                          <span className={`badge border ${STATUS_COLORS[ticket.status]}`}>
                            {statusLabel(ticket.status)}
                          </span>
                          <p className="mt-1 text-[10px] text-ink-400">{timeAgo(ticket.createdAt)}</p>
                        </div>
                      </Link>
                    ))}
                  {!board?.columns?.length ? (
                    <EmptyState title="لا توجد بيانات" icon={<Wrench size={20} />} />
                  ) : null}
                </div>
              </Card>

              <Card>
                <CardHeader title="ملخص سريع" icon={<Users size={18} />} />
                <dl className="card-pad space-y-2.5 text-sm">
                  <div className="flex items-center justify-between">
                    <dt className="flex items-center gap-2 text-ink-500">
                      <Users size={15} /> إجمالي العملاء
                    </dt>
                    <dd className="font-bold text-ink-800 num">{formatNumber(data.customers.total)}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="flex items-center gap-2 text-ink-500">
                      <Smartphone size={15} /> الأجهزة المسجلة
                    </dt>
                    <dd className="font-bold text-ink-800 num">{formatNumber(data.devices.total)}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="flex items-center gap-2 text-ink-500">
                      <ClipboardList size={15} /> فواتير غير مسددة
                    </dt>
                    <dd className="font-bold text-ink-800 num">{formatNumber(data.finance.pendingInvoices)}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="flex items-center gap-2 text-ink-500">
                      <Wrench size={15} /> تم تسليمها في الفترة
                    </dt>
                    <dd className="font-bold text-ink-800 num">{formatNumber(data.operations.deliveredInRange)}</dd>
                  </div>
                </dl>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
