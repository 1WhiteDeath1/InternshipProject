import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/useAuth';
import { hasPermission } from '@/contexts/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription,
} from '@/components/ui/empty';
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent, type ChartConfig,
} from '@/components/ui/chart';
import {
  ComposedChart, Bar, Line, AreaChart, Area, BarChart, LineChart, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid,
} from 'recharts';
import { toast } from 'sonner';
import {
  BarChart3, Trash2, Truck, Flame, Wallet, BedDouble, UtensilsCrossed, AlertTriangle, Package,
  Bell, Shield, Users, Percent, Ban, Clock, FileEdit, ClipboardList, TrendingUp, TrendingDown,
  ArrowRight, FileDown, ShieldAlert, CheckCircle2,
} from 'lucide-react';
import { formatCurrency } from '@/lib/currency';

const RANGE_OPTIONS = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
];

interface Kpis {
  today_revenue: number; occupancy_rate: number; total_stock_value: number; waste_cost_month: number;
  open_alerts: number; total_guests_today: number; low_stock_count: number; open_incidents: number;
  mess_revenue_month: number; unpaid_mess_bills: number; active_member_count: number;
  outstanding_balance: number; unsettled_invoice_count: number;
}

interface RevenueDetail {
  labels: string[]; revenue: number[]; cost: number[]; profit: number[];
  room_revenue_total: number; mess_revenue_total: number; other_revenue_total: number;
  revenue_total: number; cost_total: number; profit_total: number;
  revenue_pct_change: number; cost_pct_change: number; profit_pct_change: number;
}

interface OccupancyTrend {
  labels: string[]; values: number[]; avg_current: number; avg_previous: number; pct_change: number;
}

interface WasteByCategory { labels: string[]; quantities: number[]; costs: number[]; }
interface VendorPerformance { name: string; spend_30d: number; }
interface RateHistoryRow { new_percentage: number; changed_at: string; }

interface AnomalyAlert { id: number; title: string; message: string; severity: string; created_at: string; }
interface Exceptions {
  period_days: number;
  discounted_count: number; discounted_amount: number;
  void_count: number; void_amount: number;
  corrections_pending: number; corrections_period: number;
  menu_changes_pending: number;
  overdue_departures: number;
  overdue_invoices_count: number; overdue_invoices_amount: number;
  anomaly_alerts: AnomalyAlert[];
}

interface AuditSummary {
  period_days: number; total_actions: number;
  by_user: { user_name: string; count: number }[];
  by_action: { action: string; count: number }[];
}

const WASTE_COLORS = [
  'hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))',
  'hsl(var(--chart-4))', 'hsl(var(--chart-5))', 'hsl(var(--chart-1) / 0.6)',
];

const revenueChartConfig: ChartConfig = {
  revenue: { label: 'Revenue', color: 'hsl(var(--chart-1))' },
  cost: { label: 'Cost', color: 'hsl(var(--chart-3))' },
  profit: { label: 'Profit', color: 'hsl(var(--chart-2))' },
};
const occupancyChartConfig: ChartConfig = { value: { label: 'Occupancy', color: 'hsl(var(--chart-2))' } };
const wasteChartConfig: ChartConfig = { value: { label: 'Cost' } };
const vendorChartConfig: ChartConfig = { spend_30d: { label: 'Spend (30d)', color: 'hsl(var(--chart-1))' } };
const activityChartConfig: ChartConfig = { count: { label: 'Actions', color: 'hsl(var(--chart-4))' } };
const gasRateChartConfig: ChartConfig = { percentage: { label: 'Gas Charge Rate', color: 'hsl(var(--chart-4))' } };

function PctBadge({ value, invert = false }: { value: number; invert?: boolean }) {
  const isGood = invert ? value <= 0 : value >= 0;
  const Icon = value >= 0 ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${isGood ? 'text-emerald-600' : 'text-red-500'}`}>
      <Icon size={12} /> {value >= 0 ? '+' : ''}{value}%
    </span>
  );
}

function KpiTile({ label, value, sub, icon: Icon, alert, onClick }: {
  label: string; value: string | number; sub?: string; icon: typeof Wallet; alert?: boolean; onClick?: () => void;
}) {
  return (
    <Card className={onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : undefined} onClick={onClick}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{label}</p>
          <Icon size={16} className={alert ? 'text-red-500' : 'text-muted-foreground'} />
        </div>
        <p className={`text-xl font-bold mt-1 ${alert ? 'text-red-600' : 'text-foreground'}`}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function ExceptionTile({ label, value, sub, icon: Icon, alert, onClick }: {
  label: string; value: number; sub?: string; icon: typeof Percent; alert?: boolean; onClick?: () => void;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${alert ? 'border-red-200 dark:border-red-900' : ''} ${onClick ? 'cursor-pointer hover:border-blue-400 transition-colors' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon size={13} /> {label}</div>
      <p className={`text-lg font-bold mt-1 ${alert ? 'text-red-600' : 'text-foreground'}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function KpiSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
      {Array.from({ length: 9 }).map((_, i) => (
        <Card key={i}><CardContent className="p-4 space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-6 w-16" />
        </CardContent></Card>
      ))}
    </div>
  );
}

export default function Reports() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const canViewMessRates = hasPermission(user, 'mess_rates', 'view') || hasPermission(user, 'mess_rates', 'edit');

  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [revenue, setRevenue] = useState<RevenueDetail | null>(null);
  const [occupancy, setOccupancy] = useState<OccupancyTrend | null>(null);
  const [wasteData, setWasteData] = useState<WasteByCategory | null>(null);
  const [vendorPerf, setVendorPerf] = useState<VendorPerformance[]>([]);
  const [exceptions, setExceptions] = useState<Exceptions | null>(null);
  const [auditSummary, setAuditSummary] = useState<AuditSummary | null>(null);
  const [rateHistory, setRateHistory] = useState<RateHistoryRow[]>([]);

  const fetchAll = useCallback(() => {
    setLoading(true);
    // Exceptions/audit-summary cap at 90 days server-side (a "notable items"
    // list stops being useful much past a quarter) - clamp the shared range
    // control down to that rather than letting the request 422.
    const exceptionsDays = Math.min(days, 90);
    Promise.all([
      api.get('/reports/dashboard').then(res => setKpis(res.data)),
      api.get(`/reports/revenue-detail?days=${days}`).then(res => setRevenue(res.data)),
      api.get(`/reports/occupancy-trend?days=${days}`).then(res => setOccupancy(res.data)),
      api.get('/reports/waste-by-category').then(res => setWasteData(res.data)),
      api.get('/reports/vendor-performance').then(res => setVendorPerf(res.data)),
      api.get(`/reports/exceptions?days=${exceptionsDays}`).then(res => setExceptions(res.data)),
      api.get(`/reports/audit-summary?days=${exceptionsDays}`).then(res => setAuditSummary(res.data)),
      ...(canViewMessRates ? [api.get('/kitchen/gas-rate/history').then(res => setRateHistory(res.data))] : []),
    ]).catch(() => toast.error('Failed to load some reports data'))
      .finally(() => setLoading(false));
  }, [days, canViewMessRates]);

  useEffect(() => { queueMicrotask(fetchAll); }, [fetchAll]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await api.get(`/reports/export?days=${days}`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `reports_summary_${new Date().toISOString().slice(0, 10)}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('Report exported');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Export failed'));
    } finally {
      setExporting(false);
    }
  };

  const revenueChartData = revenue?.labels.map((l, i) => ({
    date: l.slice(5), revenue: revenue.revenue[i], cost: revenue.cost[i], profit: revenue.profit[i],
  })) || [];
  const occupancyChartData = occupancy?.labels.map((l, i) => ({ date: l.slice(5), value: occupancy.values[i] })) || [];
  const wasteChart = wasteData?.labels.map((l, i) => ({ name: l, value: wasteData.costs[i] || 0 })) || [];
  const gasRateChart = rateHistory.map(r => ({ date: r.changed_at.slice(0, 10), percentage: r.new_percentage }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><BarChart3 size={24} /> Reports &amp; Analytics</h1>
        <div className="flex items-center gap-2">
          <Select value={String(days)} onValueChange={v => setDays(Number(v))}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              {RANGE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" disabled={exporting} onClick={handleExport}>
            <FileDown size={14} className="mr-1" /> {exporting ? 'Exporting…' : 'Export'}
          </Button>
        </div>
      </div>

      {/* This Month at a Glance - the /reports/dashboard KPIs were computed
          server-side but never rendered anywhere in the app until now. */}
      {loading && !kpis ? <KpiSkeleton /> : kpis && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <KpiTile label="Today's Revenue" value={formatCurrency(kpis.today_revenue)} icon={Wallet} />
          <KpiTile label="Occupancy" value={`${kpis.occupancy_rate}%`} sub={`${kpis.total_guests_today} guests today`} icon={BedDouble} />
          <KpiTile label="Outstanding Balance" value={formatCurrency(kpis.outstanding_balance)}
            sub={`${kpis.unsettled_invoice_count} unsettled invoice(s)`} icon={AlertTriangle} alert={kpis.outstanding_balance > 0} />
          <KpiTile label="Mess Revenue (Month)" value={formatCurrency(kpis.mess_revenue_month)}
            sub={`${kpis.unpaid_mess_bills} unpaid bill(s)`} icon={UtensilsCrossed} alert={kpis.unpaid_mess_bills > 0} />
          <KpiTile label="Stock Value" value={formatCurrency(kpis.total_stock_value)}
            sub={`${kpis.low_stock_count} low stock`} icon={Package} alert={kpis.low_stock_count > 0} />
          <KpiTile label="Waste Cost (Month)" value={formatCurrency(kpis.waste_cost_month)} icon={Trash2} />
          <KpiTile label="Open Alerts" value={kpis.open_alerts} icon={Bell} alert={kpis.open_alerts > 0}
            onClick={() => navigate('/alerts')} />
          <KpiTile label="Open Incidents" value={kpis.open_incidents} icon={Shield} alert={kpis.open_incidents > 0} />
          <KpiTile label="Active Members" value={kpis.active_member_count} icon={Users}
            onClick={() => navigate('/members')} />
        </div>
      )}

      {/* Revenue, Cost & Profit - reuses the same revenue-detail endpoint
          the Dashboard's popup already computes, including the
          period-over-period comparison that never made it onto this page. */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 flex-wrap gap-2">
          <CardTitle className="text-sm font-medium">Revenue, Cost &amp; Profit</CardTitle>
          {revenue && (
            <div className="flex items-center gap-4 text-xs">
              <span className="flex items-center gap-1">Revenue <PctBadge value={revenue.revenue_pct_change} /></span>
              <span className="flex items-center gap-1">Cost <PctBadge value={revenue.cost_pct_change} invert /></span>
              <span className="flex items-center gap-1">Profit <PctBadge value={revenue.profit_pct_change} /></span>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {revenue ? (
            <>
              <ChartContainer config={revenueChartConfig} className="h-[280px] w-full">
                <ComposedChart data={revenueChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={48}
                    tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
                  <ChartTooltip content={<ChartTooltipContent formatter={v => formatCurrency(v as number)} />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar dataKey="revenue" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="cost" fill="hsl(var(--chart-3))" radius={[4, 4, 0, 0]} maxBarSize={28} />
                  <Line type="monotone" dataKey="profit" stroke="hsl(var(--chart-2))" strokeWidth={2.5} dot={false} />
                </ComposedChart>
              </ChartContainer>
              <div className="grid grid-cols-3 gap-3 mt-4 pt-3 border-t text-center">
                <div><p className="text-xs text-muted-foreground">Room</p><p className="font-bold font-mono">{formatCurrency(revenue.room_revenue_total)}</p></div>
                <div><p className="text-xs text-muted-foreground">Mess</p><p className="font-bold font-mono">{formatCurrency(revenue.mess_revenue_total)}</p></div>
                <div><p className="text-xs text-muted-foreground">Other</p><p className="font-bold font-mono">{formatCurrency(revenue.other_revenue_total)}</p></div>
              </div>
            </>
          ) : <Skeleton className="h-[280px] w-full" />}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Occupancy Trend - now with a period-over-period comparison the
            backend previously computed only for the Dashboard popup. */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium">Occupancy Trend</CardTitle>
            {occupancy && <PctBadge value={occupancy.pct_change} />}
          </CardHeader>
          <CardContent>
            {occupancy ? (
              <>
                <ChartContainer config={occupancyChartConfig} className="h-[220px] w-full">
                  <AreaChart data={occupancyChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={32} unit="%" />
                    <ChartTooltip content={<ChartTooltipContent formatter={v => [`${v}%`, 'Occupancy']} />} />
                    <Area type="monotone" dataKey="value" stroke="hsl(var(--chart-2))" fill="hsl(var(--chart-2))" fillOpacity={0.15} strokeWidth={2} />
                  </AreaChart>
                </ChartContainer>
                <p className="text-xs text-muted-foreground mt-2 text-center">
                  Avg {occupancy.avg_current}% this period · {occupancy.avg_previous}% previous period
                </p>
              </>
            ) : <Skeleton className="h-[220px] w-full" />}
          </CardContent>
        </Card>

        {/* Staff Activity - a "who did what" rollup over Audit Log, which
            was previously just raw filterable rows with no summary. */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium flex items-center gap-2"><ClipboardList size={16} /> Staff Activity</CardTitle>
            <button className="text-xs text-blue-600 hover:underline flex items-center gap-1" onClick={() => navigate('/audit-log')}>
              Full Audit Log <ArrowRight size={12} />
            </button>
          </CardHeader>
          <CardContent>
            {auditSummary ? (
              auditSummary.by_user.length === 0 ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon"><ClipboardList /></EmptyMedia>
                    <EmptyTitle>No activity logged</EmptyTitle>
                    <EmptyDescription>Nothing recorded in the last {auditSummary.period_days} days.</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground mb-2">{auditSummary.total_actions} actions in the last {auditSummary.period_days} days</p>
                  <ChartContainer config={activityChartConfig} className="h-[190px] w-full">
                    <BarChart data={auditSummary.by_user} layout="vertical" margin={{ left: 8, right: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <YAxis dataKey="user_name" type="category" tick={{ fontSize: 11 }} width={100} axisLine={false} tickLine={false} />
                      <ChartTooltip content={<ChartTooltipContent formatter={v => [v, 'Actions']} />} />
                      <Bar dataKey="count" fill="hsl(var(--chart-4))" radius={[0, 4, 4, 0]} maxBarSize={20} />
                    </BarChart>
                  </ChartContainer>
                </>
              )
            ) : <Skeleton className="h-[220px] w-full" />}
          </CardContent>
        </Card>
      </div>

      {/* Exceptions - things that need a Manager's attention, previously
          scattered across five different screens (or nowhere at all). */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <AlertTriangle size={16} /> Exceptions {exceptions && `(last ${exceptions.period_days} days)`}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {exceptions ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <ExceptionTile label="Discounted Bills" value={exceptions.discounted_count}
                  sub={exceptions.discounted_count > 0 ? formatCurrency(exceptions.discounted_amount) : undefined}
                  icon={Percent} alert={exceptions.discounted_count > 0} />
                <ExceptionTile label="Voided Bills" value={exceptions.void_count}
                  sub={exceptions.void_count > 0 ? formatCurrency(exceptions.void_amount) : undefined}
                  icon={Ban} alert={exceptions.void_count > 0} />
                <ExceptionTile label="Bill Corrections Pending" value={exceptions.corrections_pending}
                  icon={FileEdit} alert={exceptions.corrections_pending > 0}
                  onClick={exceptions.corrections_pending > 0 ? () => navigate('/alerts?tab=approvals') : undefined} />
                <ExceptionTile label="Menu Changes Pending" value={exceptions.menu_changes_pending}
                  icon={UtensilsCrossed} alert={exceptions.menu_changes_pending > 0}
                  onClick={exceptions.menu_changes_pending > 0 ? () => navigate('/alerts?tab=approvals') : undefined} />
                <ExceptionTile label="Guests Overdue to Leave" value={exceptions.overdue_departures}
                  icon={Clock} alert={exceptions.overdue_departures > 0} />
                <ExceptionTile label="Overdue Invoices" value={exceptions.overdue_invoices_count}
                  sub={exceptions.overdue_invoices_count > 0 ? formatCurrency(exceptions.overdue_invoices_amount) : undefined}
                  icon={AlertTriangle} alert={exceptions.overdue_invoices_count > 0} />
              </div>

              <div className="border-t pt-3">
                <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                  <ShieldAlert size={14} /> Open Procurement Anomaly Alerts
                </p>
                {exceptions.anomaly_alerts.length === 0 ? (
                  <p className="text-sm text-muted-foreground flex items-center gap-1.5"><CheckCircle2 size={14} className="text-emerald-600" /> Nothing flagged</p>
                ) : (
                  <div className="space-y-1.5">
                    {exceptions.anomaly_alerts.map(a => (
                      <button key={a.id} onClick={() => navigate('/alerts')}
                        className="w-full flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left hover:border-red-400 transition-colors">
                        <span className="text-sm truncate">{a.title}</span>
                        <Badge variant={a.severity === 'high' ? 'destructive' : 'outline'} className="shrink-0 capitalize">{a.severity}</Badge>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : <Skeleton className="h-32 w-full" />}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium flex items-center gap-2"><Trash2 size={16} /> Waste by Category (This Month)</CardTitle></CardHeader>
          <CardContent>
            {!wasteData ? <Skeleton className="h-[250px] w-full" /> : wasteChart.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon"><Trash2 /></EmptyMedia>
                  <EmptyTitle>No waste logged this month</EmptyTitle>
                </EmptyHeader>
              </Empty>
            ) : (
              <>
                <ChartContainer config={wasteChartConfig} className="h-[250px] w-full">
                  <PieChart>
                    <Pie data={wasteChart} cx="50%" cy="50%" outerRadius={80} dataKey="value" nameKey="name" label>
                      {wasteChart.map((_, i) => <Cell key={i} fill={WASTE_COLORS[i % WASTE_COLORS.length]} />)}
                    </Pie>
                    <ChartTooltip content={<ChartTooltipContent formatter={v => formatCurrency(v as number)} />} />
                  </PieChart>
                </ChartContainer>
                <div className="flex flex-wrap gap-3 justify-center mt-2">
                  {wasteChart.map((w, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-sm">
                      <div className="w-3 h-3 rounded-full" style={{ background: WASTE_COLORS[i % WASTE_COLORS.length] }} />
                      <span className="capitalize">{w.name}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm font-medium flex items-center gap-2"><Truck size={16} /> Top Vendors by Spend (30 days)</CardTitle></CardHeader>
          <CardContent>
            {vendorPerf.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon"><Truck /></EmptyMedia>
                  <EmptyTitle>No vendor-tagged purchases</EmptyTitle>
                  <EmptyDescription>Nothing logged against a vendor in the last 30 days.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ChartContainer config={vendorChartConfig} className="h-[250px] w-full">
                <BarChart data={vendorPerf} layout="vertical" margin={{ left: 8, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={v => formatCurrency(v)} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={100} axisLine={false} tickLine={false} />
                  <ChartTooltip content={<ChartTooltipContent formatter={v => formatCurrency(v as number)} />} />
                  <Bar dataKey="spend_30d" fill="hsl(var(--chart-1))" radius={[0, 4, 4, 0]} maxBarSize={22} />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {canViewMessRates && (
        <Card className="max-w-xl">
          <CardHeader><CardTitle className="text-sm font-medium flex items-center gap-2"><Flame size={16} /> Gas Charge Rate Trend</CardTitle></CardHeader>
          <CardContent>
            {gasRateChart.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-8">No rate changes recorded yet</p>
            ) : (
              <ChartContainer config={gasRateChartConfig} className="h-[200px] w-full">
                <LineChart data={gasRateChart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 12 }} axisLine={false} tickLine={false} unit="%" width={40} />
                  <ChartTooltip content={<ChartTooltipContent formatter={v => [`${v}%`, 'Rate']} />} />
                  <Line type="stepAfter" dataKey="percentage" stroke="hsl(var(--chart-4))" strokeWidth={2} dot />
                </LineChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
