import { useEffect, useState, type ReactNode } from 'react';
import api from '@/lib/api';
import { useAuth } from '@/contexts/useAuth';
import { useTheme } from '@/contexts/useTheme';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  TrendingUp, Package, AlertTriangle, Receipt, DollarSign, Trash2,
  BedDouble, LogIn, LogOut, Wallet, ArrowRight
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { RoomStatusDonut } from '@/components/RoomStatusDonut';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/currency';

interface DashboardStats {
  today_revenue: number;
  occupancy_rate: number;
  total_stock_value: number;
  waste_cost_month: number;
  open_alerts: number;
  pending_approvals: number;
  total_guests_today: number;
  low_stock_count: number;
}

interface OccupancyData {
  total_rooms: number;
  occupied: number;
  reserved: number;
  vacant: number;
  maintenance: number;
  needs_housekeeping: number;
  today_arrivals: number;
  today_departures: number;
  occupancy_rate: number;
  arrivals: { booking_id: number; guest_name: string; room_number: string | null; arrival_overdue?: boolean }[];
  departures: { booking_id: number; guest_name: string; room_number: string | null; overdue?: boolean; days_overdue?: number }[];
  housekeeping_queue: { room_id: number; room_number: string }[];
}

interface UnsettledInvoice {
  id: number; booking_id: number | null; guest_name: string | null; rank: string | null;
  room_number: string | null; bill_type: string; balance_due: number; checking_out_now: boolean;
}

interface MonthSummary { month: string; occupancy_rate: number; bookings_count: number; revenue: number; }

// Hero figures drop the paise - "Rs 12,340" reads from across the room,
// "Rs 12,340.00" doesn't.
const bigMoney = (n: number | null | undefined) =>
  `Rs ${Math.round(typeof n === 'number' && !Number.isNaN(n) ? n : 0).toLocaleString('en-US')}`;

function StatValue({ loading, value }: { loading: boolean; value: string | number }) {
  if (loading) return <span className="inline-block h-10 w-28 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />;
  return <>{value}</>;
}

// A hero stat tile - the "not a chart" form for a single headline figure.
function HeroTile({ label, value, sub, icon: Icon, tone, onClick, alert }: {
  label: string; value: ReactNode; sub?: ReactNode;
  icon: typeof DollarSign; tone: string; onClick?: () => void; alert?: boolean;
}) {
  return (
    <Card
      className={`${onClick ? 'cursor-pointer hover:shadow-lg transition-all' : ''} ${alert ? 'border-red-400 ring-1 ring-red-200 dark:ring-red-900' : ''}`}
      onClick={onClick}
    >
      <CardContent className="p-5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-base text-gray-500 dark:text-gray-400">{label}</p>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${tone}`}>
            <Icon size={21} />
          </div>
        </div>
        <p className={`text-3xl xl:text-4xl font-bold tracking-tight mt-1.5 ${alert ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
          {value}
        </p>
        {sub && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function SectionCard({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-lg font-semibold">{title}</CardTitle>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const { darkMode } = useTheme();
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [occupancy, setOccupancy] = useState<OccupancyData | null>(null);
  const [unsettled, setUnsettled] = useState<UnsettledInvoice[]>([]);
  const [revenueTrend, setRevenueTrend] = useState<{ labels: string[]; values: number[] } | null>(null);
  const [occupancyTrend, setOccupancyTrend] = useState<{ labels: string[]; values: number[] } | null>(null);
  const [months, setMonths] = useState<MonthSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    queueMicrotask(() => {
      setLoading(true);
      const now = new Date();
      const mStart = new Date(now.getFullYear(), now.getMonth() - 5, 1).toLocaleDateString('en-CA');
      const mEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).toLocaleDateString('en-CA');
      const common = [
        api.get('/bookings/occupancy').then(res => setOccupancy(res.data)),
        api.get('/billing/desk').then(res => setUnsettled(res.data.unsettled_invoices || [])),
      ];
      const supervisor = user?.is_supervisor ? [
        api.get('/reports/dashboard').then(res => setStats(res.data)),
        api.get('/reports/revenue-trend?days=14').then(res => setRevenueTrend(res.data)),
        api.get('/reports/occupancy-trend?days=14').then(res => setOccupancyTrend(res.data)),
        api.get(`/bookings/calendar-summary?start=${mStart}&end=${mEnd}&granularity=month`).then(res => setMonths(res.data.months)),
      ] : [];
      Promise.all([...common, ...supervisor])
        .catch(() => toast.error('Failed to load dashboard data'))
        .finally(() => setLoading(false));
    });
  }, [user]);

  const gridStroke = darkMode ? '#374151' : '#E5E7EB';
  const tickFill = darkMode ? '#9CA3AF' : '#6B7280';
  const tooltipStyle = {
    backgroundColor: darkMode ? '#111827' : '#FFFFFF',
    border: `1px solid ${gridStroke}`, borderRadius: 8,
    color: darkMode ? '#F9FAFB' : '#111827', fontSize: 15,
  };
  const overdueDepartures = occupancy?.departures.filter(d => d.overdue) ?? [];
  const billsAmount = unsettled.reduce((s, i) => s + i.balance_due, 0);

  // Group unsettled bills per guest (room + mess settle together)
  const billGroups = (() => {
    const map = new Map<string, UnsettledInvoice[]>();
    for (const inv of unsettled) {
      const key = String(inv.booking_id ?? `inv-${inv.id}`);
      const g = map.get(key);
      if (g) g.push(inv); else map.set(key, [inv]);
    }
    return [...map.values()];
  })();

  const revenueData = revenueTrend?.labels.map((l, i) => ({ date: l.slice(5), value: revenueTrend.values[i] })) || [];
  const occupancyData = occupancyTrend?.labels.map((l, i) => ({ date: l.slice(5), value: occupancyTrend.values[i] })) || [];
  const monthData = months.map(m => ({
    label: new Date(Number(m.month.split('-')[0]), Number(m.month.split('-')[1]) - 1, 1).toLocaleDateString('en-GB', { month: 'short' }),
    revenue: m.revenue,
  }));

  // ---- Shared widgets ----

  const roomStatusDonut = (
    <SectionCard title="Rooms Right Now">
      <RoomStatusDonut counts={occupancy} />
    </SectionCard>
  );

  const deskWidget = (
    <SectionCard title="Today at the Desk"
      action={<button className="text-sm text-blue-600 hover:underline flex items-center gap-1" onClick={() => navigate('/bookings')}>Bookings <ArrowRight size={15} /></button>}>
      <div className="space-y-3">
        <div>
          <p className="text-sm font-semibold text-gray-500 dark:text-gray-400 flex items-center gap-2 mb-1.5">
            <LogIn size={16} className="text-emerald-600" /> Arrivals ({occupancy?.arrivals.length ?? 0})
          </p>
          {(occupancy?.arrivals.length ?? 0) === 0 && <p className="text-base text-gray-400 pl-6">None expected today</p>}
          {occupancy?.arrivals.slice(0, 4).map(a => (
            <p key={a.booking_id} className="text-base pl-6 py-0.5 truncate">
              {a.guest_name} <span className="text-gray-400">· Room {a.room_number}</span>
              {a.arrival_overdue && <span className="text-red-600 font-medium"> · overdue</span>}
            </p>
          ))}
        </div>
        <div className="border-t pt-3">
          <p className="text-sm font-semibold text-gray-500 dark:text-gray-400 flex items-center gap-2 mb-1.5">
            <LogOut size={16} className="text-blue-600" /> Departures ({occupancy?.departures.length ?? 0})
          </p>
          {(occupancy?.departures.length ?? 0) === 0 && <p className="text-base text-gray-400 pl-6">None due today</p>}
          {occupancy?.departures.slice(0, 4).map(d => (
            <p key={d.booking_id} className="text-base pl-6 py-0.5 truncate">
              {d.guest_name} <span className="text-gray-400">· Room {d.room_number}</span>
              {d.overdue && <span className="text-red-600 font-medium"> · {d.days_overdue}d overdue</span>}
            </p>
          ))}
        </div>
      </div>
    </SectionCard>
  );

  const billsWidget = (
    <SectionCard title="Bills to Settle"
      action={<button className="text-sm text-blue-600 hover:underline flex items-center gap-1" onClick={() => navigate('/clerk-desk')}>Clerk Desk <ArrowRight size={15} /></button>}>
      {billGroups.length === 0 && <p className="text-base text-gray-400">All bills collected ✓</p>}
      <div className="space-y-2">
        {billGroups.slice(0, 5).map(g => {
          const f = g[0];
          return (
            <button key={f.id} type="button" onClick={() => navigate('/clerk-desk')}
              className="w-full flex items-center justify-between gap-2 rounded-lg border px-3 py-2 hover:border-blue-400 transition-colors text-left">
              <span className="min-w-0">
                <span className="text-base font-medium block truncate">{f.rank ? `${f.rank} ` : ''}{f.guest_name || '—'}</span>
                <span className="text-sm text-gray-500">Room {f.room_number || '—'}{f.checking_out_now ? ' · checking out now' : ''}</span>
              </span>
              <span className="text-lg font-bold font-mono shrink-0">{bigMoney(g.reduce((s, i) => s + i.balance_due, 0))}</span>
            </button>
          );
        })}
        {billGroups.length > 5 && <p className="text-sm text-gray-500">+ {billGroups.length - 5} more on the Clerk Desk</p>}
      </div>
    </SectionCard>
  );

  // ---- Non-supervisor: operations only ----
  if (!user?.is_supervisor) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Welcome, {user?.full_name}</h1>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <HeroTile label="Rooms Occupied" value={<StatValue loading={loading} value={`${occupancy?.occupied ?? 0}/${occupancy?.total_rooms ?? 0}`} />}
            icon={BedDouble} tone="bg-blue-100 dark:bg-blue-900/30 text-blue-600" onClick={() => navigate('/bookings')} />
          <HeroTile label="Arrivals Today" value={<StatValue loading={loading} value={occupancy?.today_arrivals ?? 0} />}
            icon={LogIn} tone="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600" onClick={() => navigate('/bookings')} />
          <HeroTile label="Departures Due" value={<StatValue loading={loading} value={occupancy?.today_departures ?? 0} />}
            sub={overdueDepartures.length > 0 ? <span className="text-red-600 font-medium">{overdueDepartures.length} overdue</span> : undefined}
            icon={LogOut} tone="bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600" onClick={() => navigate('/bookings')} alert={overdueDepartures.length > 0} />
          <HeroTile label="Bills To Settle" value={<StatValue loading={loading} value={billGroups.length} />}
            sub={billGroups.length > 0 ? <span className="font-medium">{bigMoney(billsAmount)} to collect</span> : 'All collected'}
            icon={Wallet} tone="bg-purple-100 dark:bg-purple-900/30 text-purple-600" onClick={() => navigate('/clerk-desk')} alert={billGroups.length > 0} />
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {roomStatusDonut}
          {deskWidget}
          {billsWidget}
        </div>
      </div>
    );
  }

  // ---- Supervisor: full analytics board ----
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
        <p className="text-base text-gray-500 dark:text-gray-400">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
      </div>

      {/* Hero row: the four figures that matter, readable from across the room */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <HeroTile
          label="Today's Revenue"
          value={<StatValue loading={loading} value={bigMoney(stats?.today_revenue)} />}
          sub="Bills issued & paid today"
          icon={DollarSign} tone="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600"
          onClick={() => navigate('/billing')}
        />
        <HeroTile
          label="Occupancy"
          value={<><StatValue loading={loading} value={stats?.occupancy_rate || 0} />%</>}
          sub={`${occupancy?.occupied ?? 0} of ${occupancy?.total_rooms ?? 0} rooms occupied`}
          icon={BedDouble} tone="bg-blue-100 dark:bg-blue-900/30 text-blue-600"
          onClick={() => navigate('/bookings')}
        />
        <HeroTile
          label="To Collect"
          value={<StatValue loading={loading} value={bigMoney(billsAmount)} />}
          sub={billGroups.length > 0 ? `${billGroups.length} guest${billGroups.length > 1 ? 's' : ''} with bills due` : 'All bills collected'}
          icon={Wallet} tone="bg-purple-100 dark:bg-purple-900/30 text-purple-600"
          onClick={() => navigate('/clerk-desk')}
          alert={billGroups.length > 0}
        />
        <HeroTile
          label="Open Alerts"
          value={<StatValue loading={loading} value={stats?.open_alerts || 0} />}
          sub={stats?.pending_approvals ? `${stats.pending_approvals} approvals waiting` : 'Nothing awaiting approval'}
          icon={AlertTriangle} tone="bg-red-100 dark:bg-red-900/30 text-red-600"
          onClick={() => navigate('/alerts')}
          alert={(stats?.open_alerts ?? 0) > 0}
        />
      </div>

      {/* Room state donut + the money line */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {roomStatusDonut}
        <div className="xl:col-span-2">
          <SectionCard title="Revenue — Last 14 Days">
            <ResponsiveContainer width="100%" height={230}>
              <AreaChart data={revenueData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563EB" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#2563EB" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 15, fill: tickFill }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 15, fill: tickFill }} width={72} axisLine={false} tickLine={false}
                  tickFormatter={(v: number) => v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [formatCurrency(v), 'Revenue']} />
                <Area type="monotone" dataKey="value" stroke="#2563EB" strokeWidth={2.5} fill="url(#revFill)" dot={false} activeDot={{ r: 5 }} />
              </AreaChart>
            </ResponsiveContainer>
          </SectionCard>
        </div>
      </div>

      {/* Desk work + collections + occupancy movement */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {deskWidget}
        {billsWidget}
        <SectionCard title="Occupancy — Last 14 Days">
          <ResponsiveContainer width="100%" height={230}>
            <LineChart data={occupancyData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 15, fill: tickFill }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 15, fill: tickFill }} domain={[0, 100]} width={45} axisLine={false} tickLine={false}
                tickFormatter={(v: number) => `${v}%`} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v}%`, 'Occupancy']} />
              <Line type="monotone" dataKey="value" stroke="#0D7377" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </SectionCard>
      </div>

      {/* Six-month revenue + supply figures */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <SectionCard title="Monthly Revenue — Last 6 Months">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={monthData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 15, fill: tickFill }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 15, fill: tickFill }} width={72} axisLine={false} tickLine={false}
                tickFormatter={(v: number) => v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [formatCurrency(v), 'Revenue']} cursor={{ fill: darkMode ? '#1F2937' : '#F3F4F6' }} />
              <Bar dataKey="revenue" fill="#2563EB" radius={[4, 4, 0, 0]} maxBarSize={56} />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>

        <div className="grid grid-cols-2 gap-4">
          <HeroTile label="Stock Value" value={<StatValue loading={loading} value={bigMoney(stats?.total_stock_value)} />}
            icon={Package} tone="bg-amber-100 dark:bg-amber-900/30 text-amber-600" onClick={() => navigate('/inventory')} />
          <HeroTile label="Low Stock" value={<StatValue loading={loading} value={stats?.low_stock_count || 0} />}
            sub={stats?.low_stock_count ? 'Items need reorder' : 'Levels healthy'}
            icon={TrendingUp} tone="bg-pink-100 dark:bg-pink-900/30 text-pink-600" onClick={() => navigate('/inventory')} />
          <HeroTile label="Waste (Month)" value={<StatValue loading={loading} value={bigMoney(stats?.waste_cost_month)} />}
            icon={Trash2} tone="bg-red-100 dark:bg-red-900/30 text-red-600" />
          <HeroTile label="Approvals" value={<StatValue loading={loading} value={stats?.pending_approvals || 0} />}
            sub="POs awaiting sign-off"
            icon={Receipt} tone="bg-orange-100 dark:bg-orange-900/30 text-orange-600" onClick={() => navigate('/procurement')} />
        </div>
      </div>

      {/* Guests figure lives in the desk widget header row on this board */}
      <p className="sr-only">Guests in house: {stats?.total_guests_today ?? 0}</p>
    </div>
  );
}
