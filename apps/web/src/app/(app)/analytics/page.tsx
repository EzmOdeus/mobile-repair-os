'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, BarChart3, Clock, HardHat, Target, TrendingUp } from 'lucide-react';
import { errorMessage, fetcher, qs } from '@/lib/api';
import { formatMoney, formatNumber, formatPercent } from '@/lib/format';
import { Card, CardHeader, EmptyState, LoadingBlock, PageHeader, ProgressBar, StatCard } from '@/components/ui';

interface Kpi {
  key: string;
  label: string;
  value: number;
  unit: string;
  target?: number;
  samples?: number;
  inverted?: boolean;
}

interface Turnaround {
  avgTotalRepairHours: number;
  deliveredCount: number;
  byStage: { stage: string; stageLabel: string; avgHours: number; samples: number }[];
  sla: { breached: number; onTime: number; breachRatePct: number };
}

interface FaultAnalysis {
  byFaultCategory: { faultCategory: string; tickets: number; avgCostEgp: number }[];
  byDeviceModel: { deviceId: string | null; device: string; tickets: number; avgCostEgp: number }[];
  bySeverity: { severity: string; tickets: number }[];
}

interface TechPerf {
  technicianId: string;
  name: string;
  skillLevel: string;
  totalTickets: number;
  deliveredTickets: number;
  avgRepairHours: number | null;
  revenueEgp: number;
  laborValueEgp: number;
  qcPassRatePct: number | null;
  warrantyReturns: number;
  warrantyReturnRatePct: number | null;
  note: string;
}

interface BranchPerf {
  branchId: string;
  name: string;
  code: string;
  tickets: number;
  openTickets: number;
  deliveredTickets: number;
  overdueTickets: number;
  repairRevenueEgp: number;
  collectedEgp: number;
  receivablesEgp: number;
}

interface Trends {
  daily: { date: string; newTickets: number; delivered: number; revenueEgp: number; profitEgp: number }[];
  monthly: { month: string; tickets: number; revenueEgp: number }[];
}

const COLORS = ['#0f766e', '#0ea5e9', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6', '#64748b', '#f97316'];

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<'month' | 'quarter' | 'year' | 'last30'>('last30');
  const [tab, setTab] = useState<'kpis' | 'timing' | 'faults' | 'team'>('kpis');

  const { data: kpis, error: kpiError } = useSWR<{ kpis: Kpi[] }>(`/analytics/pilot-kpis${qs({ period })}`, fetcher);
  const { data: turnaround } = useSWR<Turnaround>(`/analytics/turnaround${qs({ period })}`, fetcher);
  const { data: faults } = useSWR<FaultAnalysis>(`/analytics/fault-analysis${qs({ period })}`, fetcher);
  const { data: technicians } = useSWR<TechPerf[]>(`/analytics/technicians/performance${qs({ period })}`, fetcher);
  const { data: branches } = useSWR<BranchPerf[]>(`/analytics/branches/performance${qs({ period })}`, fetcher);
  const { data: trends } = useSWR<Trends>(`/analytics/trends${qs({ period })}`, fetcher);

  return (
    <div>
      <PageHeader
        title="التحليلات ولوحات المعلومات"
        subtitle="مؤشرات الأداء، أزمنة التشغيل، تحليل الأعطال، وأداء الفنيين والفروع"
        actions={
          <select className="input w-auto" value={period} onChange={(e) => setPeriod(e.target.value as typeof period)}>
            <option value="last30">آخر 30 يومًا</option>
            <option value="month">هذا الشهر</option>
            <option value="quarter">هذا الربع</option>
            <option value="year">هذه السنة</option>
          </select>
        }
      />

      {kpiError ? <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">{errorMessage(kpiError)}</Card> : null}

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-3 py-2">
          {[
            ['kpis', 'مؤشرات التجربة (Pilot KPIs)'],
            ['timing', 'أزمنة التشغيل والالتزام'],
            ['faults', 'تحليل الأعطال'],
            ['team', 'الفنيون والفروع'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value as typeof tab)}
              className={`btn px-3 py-1.5 text-xs ${tab === value ? 'bg-brand-700 text-white' : 'text-ink-600 hover:bg-ink-100'}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="card-pad">
          {tab === 'kpis' ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {kpis?.kpis?.length ? (
                kpis.kpis.map((kpi) => {
                  const good = kpi.inverted ? kpi.value <= (kpi.target ?? 0) : kpi.value >= (kpi.target ?? 0);
                  const progress = kpi.target ? Math.min(100, (kpi.value / kpi.target) * 100) : 0;
                  return (
                    <div key={kpi.key} className="rounded-xl border border-ink-200 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-semibold text-ink-600">{kpi.label}</p>
                        <Target size={15} className={good ? 'text-emerald-600' : 'text-amber-600'} />
                      </div>
                      <p className={`mt-2 text-2xl font-bold num ${good ? 'text-emerald-700' : 'text-amber-700'}`}>
                        {kpi.unit === '%' ? formatPercent(kpi.value) : `${formatNumber(kpi.value, 1)} ${kpi.unit}`}
                      </p>
                      <p className="mt-1 text-[11px] text-ink-400">
                        المستهدف: {kpi.unit === '%' ? formatPercent(kpi.target ?? 0) : `${kpi.target ?? 0} ${kpi.unit}`}
                        {kpi.samples !== undefined ? ` · عينة ${formatNumber(kpi.samples)}` : ''}
                      </p>
                      <div className="mt-2">
                        <ProgressBar value={progress} tone={good ? 'emerald' : 'amber'} />
                      </div>
                      <p className="mt-1.5 text-[10px] text-ink-400">
                        {kpi.inverted ? 'مؤشر معكوس: الأقل أفضل' : 'الأعلى أفضل'}
                      </p>
                    </div>
                  );
                })
              ) : (
                <LoadingBlock rows={6} />
              )}
            </div>
          ) : null}

          {tab === 'timing' ? (
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-3">
                <StatCard
                  label="متوسط زمن الإصلاح الكامل"
                  value={`${turnaround?.avgTotalRepairHours ?? 0} ساعة`}
                  hint={`من ${formatNumber(turnaround?.deliveredCount ?? 0)} إصلاح مُسلَّم`}
                  icon={<Clock size={18} />}
                  tone="info"
                />
                <StatCard
                  label="تجاوز الموعد (SLA)"
                  value={formatPercent(turnaround?.sla.breachRatePct ?? 0)}
                  hint={`${formatNumber(turnaround?.sla.breached ?? 0)} متأخرة`}
                  icon={<Activity size={18} />}
                  tone={(turnaround?.sla.breachRatePct ?? 0) > 15 ? 'danger' : 'success'}
                />
                <StatCard
                  label="الالتزام بالموعد"
                  value={formatNumber(turnaround?.sla.onTime ?? 0)}
                  hint="تذاكر في الموعد"
                  icon={<TrendingUp size={18} />}
                  tone="success"
                />
              </div>

              <div className="h-72">
                {turnaround?.byStage?.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={turnaround.byStage} layout="vertical" margin={{ left: 40, right: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} orientation="bottom" reversed />
                      <YAxis
                        type="category"
                        dataKey="stageLabel"
                        tick={{ fontSize: 11, fill: '#334155' }}
                        width={110}
                        orientation="right"
                      />
                      <Tooltip
                        contentStyle={{ direction: 'rtl', fontSize: 12, borderRadius: 10, border: '1px solid #e2e8f0' }}
                        formatter={(value: number) => [`${value} ساعة`, 'متوسط الزمن']}
                      />
                      <Bar dataKey="avgHours" fill="#0f766e" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <LoadingBlock rows={5} />
                )}
              </div>
              <p className="text-xs text-ink-500">
                الرسم يوضح متوسط الزمن الذي يقضيه الجهاز في كل مرحلة من دورة الصيانة (مبنيًا على سلسلة الأحداث الفعلية).
              </p>
            </div>
          ) : null}

          {tab === 'faults' ? (
            <div className="grid gap-5 lg:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm font-bold text-ink-800">الأعطال الأكثر شيوعًا</h3>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>التصنيف</th>
                        <th>عدد التذاكر</th>
                        <th>متوسط التكلفة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {faults?.byFaultCategory?.length ? (
                        faults.byFaultCategory.map((row) => (
                          <tr key={row.faultCategory}>
                            <td className="text-xs font-medium">{row.faultCategory}</td>
                            <td className="num text-xs">{row.tickets}</td>
                            <td className="num text-xs">{formatMoney(row.avgCostEgp)}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={3}>
                            <EmptyState title="لا بيانات" icon={<BarChart3 size={20} />} />
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-bold text-ink-800">توزيع درجات الخطورة</h3>
                <div className="h-64">
                  {faults?.bySeverity?.length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={faults.bySeverity} dataKey="tickets" nameKey="severity" innerRadius="40%" outerRadius="75%">
                          {faults.bySeverity.map((entry, index) => (
                            <Cell key={entry.severity} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Legend formatter={(value: string) => (value === 'minor' ? 'بسيط' : value === 'moderate' ? 'متوسط' : value === 'major' ? 'كبير' : 'حرج')} />
                        <Tooltip contentStyle={{ direction: 'rtl', fontSize: 12, borderRadius: 10 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <LoadingBlock rows={4} />
                  )}
                </div>
              </div>

              <div className="lg:col-span-2">
                <h3 className="mb-2 text-sm font-bold text-ink-800">أكثر الموديلات دخولًا للصيانة</h3>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>الجهاز</th>
                        <th>عدد التذاكر</th>
                        <th>متوسط التكلفة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {faults?.byDeviceModel?.slice(0, 12).map((row) => (
                        <tr key={row.deviceId ?? row.device}>
                          <td className="text-xs font-medium">{row.device}</td>
                          <td className="num text-xs">{row.tickets}</td>
                          <td className="num text-xs">{formatMoney(row.avgCostEgp)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : null}

          {tab === 'team' ? (
            <div className="space-y-5">
              <div>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-ink-800">
                  <HardHat size={16} /> أداء الفنيين
                </h3>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>الفني</th>
                        <th>المستوى</th>
                        <th>تذاكر</th>
                        <th>تسليمات</th>
                        <th>متوسط ساعات الإصلاح</th>
                        <th>قيمة العمل</th>
                        <th>اجتياز QC</th>
                        <th>عوائد الضمان</th>
                      </tr>
                    </thead>
                    <tbody>
                      {technicians?.length ? (
                        technicians.map((tech) => (
                          <tr key={tech.technicianId}>
                            <td className="text-xs font-medium">{tech.name}</td>
                            <td className="text-xs">
                              {tech.skillLevel === 'lead'
                                ? 'قائد'
                                : tech.skillLevel === 'senior'
                                  ? 'خبير'
                                  : tech.skillLevel === 'mid'
                                    ? 'متوسط'
                                    : 'مبتدئ'}
                            </td>
                            <td className="num text-xs">{tech.totalTickets}</td>
                            <td className="num text-xs">{tech.deliveredTickets}</td>
                            <td className="num text-xs">{tech.avgRepairHours ?? '—'}</td>
                            <td className="num text-xs">{formatMoney(tech.laborValueEgp)}</td>
                            <td className="num text-xs">{tech.qcPassRatePct !== null ? `${tech.qcPassRatePct}%` : '—'}</td>
                            <td className="num text-xs">
                              {tech.warrantyReturns}
                              {tech.warrantyReturnRatePct !== null ? (
                                <span className="text-ink-400"> ({tech.warrantyReturnRatePct}%)</span>
                              ) : null}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={8}>
                            <LoadingBlock rows={4} />
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[11px] leading-relaxed text-amber-800">
                  تنبيه: المؤشرات سياقية بطبيعتها — تعقيد الأعطال يختلف من فني لآخر، ولا يجب استخدامها كأداة عقابية آلية.
                </p>
              </div>

              {branches?.length ? (
                <div>
                  <h3 className="mb-2 text-sm font-bold text-ink-800">أداء الفروع</h3>
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>الفرع</th>
                          <th>تذاكر</th>
                          <th>مفتوحة</th>
                          <th>مُسلَّمة</th>
                          <th>متأخرة</th>
                          <th>إيراد الإصلاح</th>
                          <th>محصّل</th>
                          <th>مستحقات</th>
                        </tr>
                      </thead>
                      <tbody>
                        {branches.map((branch) => (
                          <tr key={branch.branchId}>
                            <td className="text-xs font-medium">
                              {branch.name} <span className="text-ink-400">({branch.code})</span>
                            </td>
                            <td className="num text-xs">{branch.tickets}</td>
                            <td className="num text-xs text-amber-700">{branch.openTickets}</td>
                            <td className="num text-xs">{branch.deliveredTickets}</td>
                            <td className="num text-xs text-red-600">{branch.overdueTickets}</td>
                            <td className="num text-xs">{formatMoney(branch.repairRevenueEgp)}</td>
                            <td className="num text-xs text-emerald-700">{formatMoney(branch.collectedEgp)}</td>
                            <td className="num text-xs">{formatMoney(branch.receivablesEgp)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </Card>

      {trends?.monthly?.length ? (
        <Card>
          <CardHeader title="الأداء الشهري" subtitle="عدد التذاكر والإيراد التراكمي" icon={<TrendingUp size={18} />} />
          <div className="card-pad h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trends.monthly} margin={{ top: 6, right: 10, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#64748b' }} reversed />
                <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#64748b' }} orientation="right" width={40} />
                <YAxis yAxisId="right" orientation="left" tick={{ fontSize: 10, fill: '#64748b' }} width={60} />
                <Tooltip
                  contentStyle={{ direction: 'rtl', fontSize: 12, borderRadius: 10, border: '1px solid #e2e8f0' }}
                  formatter={(value: number, name: string) => [name === 'revenueEgp' ? formatMoney(value) : formatNumber(value), name === 'tickets' ? 'تذاكر' : 'إيراد']}
                />
                <Legend formatter={(value: string) => (value === 'tickets' ? 'تذاكر' : 'إيراد')} />
                <Line yAxisId="left" type="monotone" dataKey="tickets" stroke="#0f766e" strokeWidth={2} />
                <Line yAxisId="right" type="monotone" dataKey="revenueEgp" stroke="#0ea5e9" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
