'use client';

import { Activity, TrendingUp } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMoney, formatNumber } from '@/lib/format';
import { Card, CardHeader, LoadingBlock } from '@/components/ui';

export interface TrendPoint {
  date: string;
  newTickets: number;
  delivered: number;
  revenueEgp: number;
  profitEgp: number;
}

export interface StatusDistribution {
  status: string;
  label: string;
  count: number;
  [key: string]: string | number;
}

const PIE_COLORS = ['#0f766e', '#0ea5e9', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#64748b', '#f97316'];

/**
 * رسوم لوحة التحكم — منفصلة في chunk يُحمَّل عند الطلب.
 * مكتبة recharts ثقيلة (~100KB+)، وفصلها يجعل أول فتح للوحة أسرع بكثير
 * بينما بقية المؤشرات تظهر فورًا.
 */
export default function DashboardCharts({
  trends,
  distribution,
}: {
  trends?: TrendPoint[];
  distribution?: StatusDistribution[];
}) {
  return (
    <div className="mt-5 grid gap-4 xl:grid-cols-3">
      <Card className="xl:col-span-2">
        <CardHeader
          title="اتجاه التشغيل والإيراد"
          subtitle="تذاكر جديدة مقابل تسليمات وإيراد محصّل"
          icon={<TrendingUp size={18} />}
        />
        <div className="card-pad h-72">
          {trends?.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trends} margin={{ top: 6, right: 6, left: 6, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradTickets" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0f766e" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#0f766e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: '#64748b' }}
                  tickFormatter={(v: string) => v.slice(5)}
                  reversed
                />
                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} orientation="right" width={38} />
                <Tooltip
                  contentStyle={{ direction: 'rtl', fontSize: 12, borderRadius: 10, border: '1px solid #e2e8f0' }}
                  labelFormatter={(v) => `التاريخ: ${v}`}
                  formatter={(value: number, name: string) => [
                    name === 'revenueEgp' ? formatMoney(value) : formatNumber(value),
                    name === 'newTickets' ? 'تذاكر جديدة' : name === 'delivered' ? 'تسليمات' : 'إيراد',
                  ]}
                />
                <Area type="monotone" dataKey="newTickets" stroke="#0f766e" fill="url(#gradTickets)" strokeWidth={2} />
                <Area type="monotone" dataKey="delivered" stroke="#f59e0b" fill="none" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <LoadingBlock rows={5} />
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="توزيع التذاكر على الحالات" icon={<Activity size={18} />} />
        <div className="card-pad h-72">
          {distribution?.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={distribution.slice(0, 8)}
                  dataKey="count"
                  nameKey="label"
                  innerRadius="45%"
                  outerRadius="78%"
                  paddingAngle={2}
                >
                  {distribution.slice(0, 8).map((entry, index) => (
                    <Cell key={entry.status} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ direction: 'rtl', fontSize: 12, borderRadius: 10, border: '1px solid #e2e8f0' }}
                  formatter={(value: number, name: string) => [formatNumber(value), name]}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <LoadingBlock rows={4} />
          )}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1.5 px-4 pb-4">
          {distribution?.slice(0, 8).map((entry, index) => (
            <span key={entry.status} className="flex items-center gap-1.5 text-[11px] text-ink-600">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }}
              />
              {entry.label} ({entry.count})
            </span>
          ))}
        </div>
      </Card>
    </div>
  );
}
