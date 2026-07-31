import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ResizableDialog } from '@/components/dashboard/ResizableDialog';
import { TrendingUp, TrendingDown, DollarSign } from 'lucide-react';
import {
  AreaChart, Area, ComposedChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { useTheme } from '@/contexts/useTheme';
import { formatCurrency } from '@/lib/currency';

interface RevenueSummary {
  sparkline: number[];
  current_week_total: number;
  last_week_comparable_total: number;
  pct_change: number;
}

interface RevenueDetail {
  labels: string[]; revenue: number[]; cost: number[]; profit: number[];
  room_revenue_total: number; mess_revenue_total: number; other_revenue_total: number;
  revenue_total: number; cost_total: number; profit_total: number;
  previous_revenue_total: number; previous_cost_total: number; previous_profit_total: number;
  revenue_pct_change: number; cost_pct_change: number; profit_pct_change: number;
}

const RANGES = [
  { key: '7', label: '1W' },
  { key: '30', label: '1M' },
  { key: '90', label: '3M' },
  { key: '365', label: '1Y' },
];

const SERIES = [
  { key: 'revenue', label: 'Revenue', color: '#2563EB' },
  { key: 'cost', label: 'Cost', color: '#DC2626' },
  { key: 'profit', label: 'Profit', color: '#059669' },
] as const;

function bigMoney(n: number | undefined) {
  return `Rs ${Math.round(n ?? 0).toLocaleString('en-US')}`;
}

function PctBadge({ pct, size = 'base' }: { pct: number; size?: 'base' | 'sm' }) {
  const up = pct >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  const cls = up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400';
  return (
    <span className={`inline-flex items-center gap-1 font-semibold ${cls} ${size === 'sm' ? 'text-xs' : 'text-sm'}`}>
      <Icon size={size === 'sm' ? 13 : 15} /> {up ? '+' : ''}{pct}%
    </span>
  );
}

function StatCard({ label, value, pct }: { label: string; value: number; pct?: number }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-lg font-bold font-mono">{bigMoney(value)}</p>
      {pct !== undefined && <PctBadge pct={pct} size="sm" />}
    </div>
  );
}

function RevenueDetailDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { darkMode } = useTheme();
  const [range, setRange] = useState('30');
  const [detail, setDetail] = useState<RevenueDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [visibleSeries, setVisibleSeries] = useState<string[]>(['revenue', 'cost', 'profit']);
  // Default to a clipped y-axis so ordinary day-to-day movement stays
  // readable even when one outlier (e.g. a big one-off procurement cost)
  // would otherwise flatten every other point against the axis.
  const [yScale, setYScale] = useState<'fit' | 'full'>('fit');

  useEffect(() => {
    if (!open) return;
    queueMicrotask(async () => {
      setLoading(true);
      try {
        const res = await api.get(`/reports/revenue-detail?days=${range}`);
        setDetail(res.data);
      } catch { toast.error('Failed to load revenue detail'); }
      finally { setLoading(false); }
    });
  }, [open, range]);

  const gridStroke = darkMode ? '#374151' : '#E5E7EB';
  const tickFill = darkMode ? '#9CA3AF' : '#6B7280';
  const tooltipStyle = {
    backgroundColor: darkMode ? '#111827' : '#FFFFFF',
    border: `1px solid ${gridStroke}`, borderRadius: 8, color: darkMode ? '#F9FAFB' : '#111827', fontSize: 13,
  };
  const chartData = detail?.labels.map((l, i) => ({
    date: range === '365' ? l.slice(0, 7) : l.slice(5),
    revenue: detail.revenue[i], cost: detail.cost[i], profit: detail.profit[i],
  })) ?? [];

  // Outlier detection: cap the y-axis near the 90th percentile of all points
  // across the visible series, then check whether the true max blows way
  // past that cap. If it does, offer a toggle instead of always flattening
  // (or always clipping) the chart.
  const sortedVals = chartData.flatMap(d => [d.revenue, d.cost, d.profit]).filter(v => v > 0).sort((a, b) => a - b);
  const p90 = sortedVals.length ? sortedVals[Math.floor(sortedVals.length * 0.9)] : 0;
  const trueMax = sortedVals.length ? sortedVals[sortedVals.length - 1] : 0;
  const fitCap = p90 * 1.4;
  const hasOutlier = fitCap > 0 && trueMax > fitCap * 1.3;
  const domainMax = hasOutlier && yScale === 'fit' ? fitCap : undefined;

  let spike: { date: string; label: string; value: number } | null = null;
  if (hasOutlier) {
    for (const d of chartData) {
      for (const s of SERIES) {
        const v = d[s.key];
        if (v > fitCap && (!spike || v > spike.value)) spike = { date: d.date, label: s.label, value: v };
      }
    }
  }

  return (
    <ResizableDialog open={open} onClose={onClose} storageKey="revenue" defaultWidth={780} defaultHeight={620}
      title={<><DollarSign size={20} /> Revenue &amp; Profit</>}>
      {({ bucket, chartHeight }) => (
        <>
          {/* Narrow: the two control groups stack, since side-by-side forces
              both to wrap into an unreadable pile of half-width chips. */}
          <div className={`flex gap-3 ${bucket === 'sm' ? 'flex-col items-start' : 'items-center justify-between flex-wrap'}`}>
            <ToggleGroup type="single" value={range} onValueChange={v => v && setRange(v)} variant="outline">
              {RANGES.map(r => <ToggleGroupItem key={r.key} value={r.key}>{r.label}</ToggleGroupItem>)}
            </ToggleGroup>
            <div className="flex items-center gap-3">
              <ToggleGroup type="multiple" value={visibleSeries} onValueChange={setVisibleSeries} variant="outline">
                {SERIES.map(s => (
                  <ToggleGroupItem key={s.key} value={s.key} style={visibleSeries.includes(s.key) ? { color: s.color } : undefined}>
                    {s.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              {hasOutlier && (
                <ToggleGroup type="single" value={yScale} onValueChange={v => v && setYScale(v as 'fit' | 'full')} variant="outline">
                  <ToggleGroupItem value="fit">Fit</ToggleGroupItem>
                  <ToggleGroupItem value="full">Full</ToggleGroupItem>
                </ToggleGroup>
              )}
            </div>
          </div>

          {loading && <p className="text-sm text-gray-500 py-8 text-center">Loading…</p>}

          {!loading && detail && (
            <>
              <ResponsiveContainer width="100%" height={chartHeight}>
                <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" vertical={false} />
                  {/* Every other tick once the series is dense and the box is
                      narrow - otherwise the date labels overlap into mush. */}
                  <XAxis dataKey="date" tick={{ fontSize: 12, fill: tickFill }} axisLine={false} tickLine={false}
                    interval={bucket === 'sm' && chartData.length > 14 ? Math.ceil(chartData.length / 7) : 'preserveStartEnd'} />
                  <YAxis tick={{ fontSize: 12, fill: tickFill }} width={bucket === 'sm' ? 44 : 64} axisLine={false} tickLine={false}
                    domain={domainMax ? [0, domainMax] : ['auto', 'auto']} allowDataOverflow={!!domainMax}
                    tickFormatter={(v: number) => Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v)} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number, name: string) => [formatCurrency(v), name]} />
                  {visibleSeries.includes('revenue') && <Line type="monotone" dataKey="revenue" name="Revenue" stroke="#2563EB" strokeWidth={2.5} dot={false} />}
                  {visibleSeries.includes('cost') && <Line type="monotone" dataKey="cost" name="Cost" stroke="#DC2626" strokeWidth={2.5} dot={false} />}
                  {visibleSeries.includes('profit') && <Line type="monotone" dataKey="profit" name="Profit" stroke="#059669" strokeWidth={2.5} dot={false} />}
                </ComposedChart>
              </ResponsiveContainer>
              {domainMax && spike && (
                <p className="text-xs text-amber-600 dark:text-amber-400 -mt-1">
                  {spike.label} spiked to {formatCurrency(spike.value)} on {spike.date} — clipped for readability.{' '}
                  <button type="button" className="underline" onClick={() => setYScale('full')}>Show full scale</button>
                </p>
              )}

              {/* Wide enough and the headline totals and the revenue split sit
                  side by side instead of the split being pushed below the fold. */}
              <div className={bucket === 'lg' ? 'grid grid-cols-2 gap-5 items-start' : 'space-y-4'}>
                <div>
                  <p className="text-sm font-semibold mb-2">Totals</p>
                  <div className={`grid gap-3 ${bucket === 'sm' ? 'grid-cols-1' : 'grid-cols-3'}`}>
                    <StatCard label="Revenue" value={detail.revenue_total} pct={detail.revenue_pct_change} />
                    <StatCard label="Cost" value={detail.cost_total} pct={detail.cost_pct_change} />
                    <StatCard label="Profit" value={detail.profit_total} pct={detail.profit_pct_change} />
                  </div>
                  <p className="text-xs text-gray-400 mt-2">vs the previous equal-length period ({RANGES.find(r => r.key === range)?.label} before that)</p>
                </div>

                <div>
                  <p className="text-sm font-semibold mb-2">Revenue by source</p>
                  <div className={`grid gap-3 ${bucket === 'sm' ? 'grid-cols-1' : 'grid-cols-3'}`}>
                    <StatCard label="Room" value={detail.room_revenue_total} />
                    <StatCard label="Mess" value={detail.mess_revenue_total} />
                    <StatCard label="Event" value={detail.other_revenue_total} />
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </ResizableDialog>
  );
}

export default function RevenueWidget() {
  const [summary, setSummary] = useState<RevenueSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailOpen, setDetailOpen] = useState(false);

  useEffect(() => {
    queueMicrotask(async () => {
      try { const res = await api.get('/reports/revenue-summary'); setSummary(res.data); }
      catch { toast.error('Failed to load revenue'); }
      finally { setLoading(false); }
    });
  }, []);

  const sparkData = summary?.sparkline.map((v, i) => ({ i, v })) ?? [];
  const up = (summary?.pct_change ?? 0) >= 0;

  return (
    <>
      {/* py-0 cancels Card's own py-6 - CardContent's p-5 below is this
          widget's only vertical padding, so the compact dashboard preview
          doesn't carry doubled top/bottom spacing. */}
      <Card className="cursor-pointer hover:shadow-lg transition-all py-0" onClick={() => setDetailOpen(true)}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-base text-gray-500 dark:text-gray-400 flex items-center gap-1.5"><DollarSign size={16} /> Revenue</p>
            {!loading && summary && <PctBadge pct={summary.pct_change} />}
          </div>
          <div className="h-16 -mx-2">
            {!loading && (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={sparkData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                  <defs>
                    <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={up ? '#059669' : '#DC2626'} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={up ? '#059669' : '#DC2626'} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey="v" stroke={up ? '#059669' : '#DC2626'} strokeWidth={2} fill="url(#sparkFill)" dot={false} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
          <p className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white mt-1">
            {loading ? <span className="inline-block h-8 w-32 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" /> : bigMoney(summary?.current_week_total)}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">This week's revenue vs the same days last week</p>
        </CardContent>
      </Card>
      <RevenueDetailDialog open={detailOpen} onClose={() => setDetailOpen(false)} />
    </>
  );
}
