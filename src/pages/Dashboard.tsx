import { useEffect, useState, type ReactNode } from 'react';
import api from '@/lib/api';
import { useAuth } from '@/contexts/useAuth';
import { hasPermission } from '@/contexts/auth-context';
import { useTheme } from '@/contexts/useTheme';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  TrendingUp, Package, AlertTriangle, Receipt, DollarSign, Trash2,
  BedDouble, LogIn, LogOut, Wallet, ArrowRight, ShieldAlert, UtensilsCrossed,
  Truck, ChefHat, IdCard, LayoutGrid, ClipboardCheck, CalendarDays,
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
  open_incidents: number;
  attendance_present_today: number;
  attendance_absent_today: number;
  active_vendor_count: number;
  avg_vendor_accuracy: number;
  recipes_below_margin: number;
  mess_revenue_month: number;
  unpaid_mess_bills: number;
  active_member_count: number;
  invoices_finalized_today: number;
  discounts_month: number;
  outstanding_balance: number;
  unsettled_invoice_count: number;
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

interface BillingStats {
  today_revenue: number; today_invoice_count: number; month_revenue: number; overdue_invoices: number;
  today_collections: number; month_collections: number; payment_methods_today: { method: string; amount: number }[];
  today_room_revenue: number; today_mess_revenue: number; today_discounts: number;
}

interface MemberBillLite { status: string; total_amount: number; }

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
  const [billingStats, setBillingStats] = useState<BillingStats | null>(null);
  const [memberBills, setMemberBills] = useState<MemberBillLite[]>([]);
  const [revenueTrend, setRevenueTrend] = useState<{ labels: string[]; values: number[] } | null>(null);
  const [occupancyTrend, setOccupancyTrend] = useState<{ labels: string[]; values: number[] } | null>(null);
  const [months, setMonths] = useState<MonthSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const isClerk = hasPermission(user, 'clerk_desk', 'view');

  useEffect(() => {
    queueMicrotask(() => {
      setLoading(true);
      const now = new Date();
      const mStart = new Date(now.getFullYear(), now.getMonth() - 5, 1).toLocaleDateString('en-CA');
      const mEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).toLocaleDateString('en-CA');
      const canSeeDesk = hasPermission(user, 'billing', 'view') || hasPermission(user, 'clerk_desk', 'view');
      const common = [
        api.get('/bookings/occupancy').then(res => setOccupancy(res.data)),
        ...(canSeeDesk ? [api.get('/billing/desk').then(res => setUnsettled(res.data.unsettled_invoices || []))] : []),
        // The Clerk's own cashier figures (collections today/month) - not part
        // of the cross-module reports.view board, so fetched separately, gated
        // on the same billing.view Clerk has. Member bills are folded in too so
        // "Outstanding"/"Pending" read as one true total across room, mess and
        // member billing rather than just the guest side.
        ...(isClerk ? [
          api.get('/billing/dashboard-stats').then(res => setBillingStats(res.data)),
          api.get('/mess-billing/bills?page_size=100').then(res => setMemberBills(res.data.items || [])),
        ] : []),
      ];
      const supervisor = hasPermission(user, 'reports', 'view') ? [
        api.get('/reports/dashboard').then(res => setStats(res.data)),
        api.get('/reports/revenue-trend?days=14').then(res => setRevenueTrend(res.data)),
        api.get('/reports/occupancy-trend?days=14').then(res => setOccupancyTrend(res.data)),
        api.get(`/bookings/calendar-summary?start=${mStart}&end=${mEnd}&granularity=month`).then(res => setMonths(res.data.months)),
      ] : [];
      Promise.all([...common, ...supervisor])
        .catch(() => toast.error('Failed to load dashboard data'))
        .finally(() => setLoading(false));
    });
  }, [user, isClerk]);

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

  // ---- Clerk view: a compact, one-screen "financial pulse" - just enough to
  // know what's going on, nothing to scroll through. Room/mess split, payment
  // mix, and the guest-by-guest bill list all live one click away on Clerk
  // Desk instead of on the face of this page. clerk_desk permission is
  // exclusive to the Clerk role, so this check alone identifies them. ----
  if (isClerk && !hasPermission(user, 'reports', 'view')) {
    const memberIssued = memberBills.filter(b => b.status === 'issued');
    const memberDraftCount = memberBills.filter(b => b.status === 'draft').length;
    const memberIssuedDue = memberIssued.reduce((s, b) => s + b.total_amount, 0);
    const outstandingAll = billsAmount + memberIssuedDue;
    const pendingCount = billGroups.length + memberDraftCount + memberIssued.length;
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Welcome, {user?.full_name}</h1>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <HeroTile label="Today's Collections" value={<StatValue loading={loading} value={bigMoney(billingStats?.today_collections)} />}
            sub="Payments actually received today"
            icon={Wallet} tone="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600" />
          <HeroTile label="This Month's Collections" value={<StatValue loading={loading} value={bigMoney(billingStats?.month_collections)} />}
            sub="Received month-to-date"
            icon={CalendarDays} tone="bg-blue-100 dark:bg-blue-900/30 text-blue-600" />
          <HeroTile label="Outstanding to Collect" value={<StatValue loading={loading} value={bigMoney(outstandingAll)} />}
            sub="Room, mess & member bills"
            icon={AlertTriangle} tone="bg-purple-100 dark:bg-purple-900/30 text-purple-600" onClick={() => navigate('/clerk-desk')} alert={outstandingAll > 0} />
          <HeroTile label="Bills Pending Action" value={<StatValue loading={loading} value={pendingCount} />}
            sub={pendingCount > 0 ? 'Tap to open Clerk Desk' : 'Nothing waiting on you'}
            icon={ClipboardCheck} tone="bg-red-100 dark:bg-red-900/30 text-red-600" onClick={() => navigate('/clerk-desk')} alert={pendingCount > 0} />
        </div>
      </div>
    );
  }

  // ---- Operations-only view: anyone without the cross-module reports permission ----
  if (!hasPermission(user, 'reports', 'view')) {
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

  // ---- Full analytics board: Manager / Deputy Manager (anyone with reports.view) ----
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
        <p className="text-base text-gray-500 dark:text-gray-400">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
      </div>

      {/* Hero row: the four figures that matter, readable from across the room.
          These are informational summaries - the Manager/Deputy don't drill into
          operational pages from here (that's not their job), so no navigation. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <HeroTile
          label="Today's Revenue"
          value={<StatValue loading={loading} value={bigMoney(stats?.today_revenue)} />}
          sub="Bills issued & paid today"
          icon={DollarSign} tone="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600"
        />
        <HeroTile
          label="Occupancy"
          value={<><StatValue loading={loading} value={stats?.occupancy_rate || 0} />%</>}
          sub={`${occupancy?.occupied ?? 0} of ${occupancy?.total_rooms ?? 0} rooms occupied`}
          icon={BedDouble} tone="bg-blue-100 dark:bg-blue-900/30 text-blue-600"
        />
        <HeroTile
          label="To Collect"
          value={<StatValue loading={loading} value={bigMoney(stats?.outstanding_balance)} />}
          sub={(stats?.unsettled_invoice_count ?? 0) > 0 ? `${stats?.unsettled_invoice_count} unsettled invoice${(stats?.unsettled_invoice_count ?? 0) > 1 ? 's' : ''}` : 'All bills collected'}
          icon={Wallet} tone="bg-purple-100 dark:bg-purple-900/30 text-purple-600"
          alert={(stats?.outstanding_balance ?? 0) > 0}
        />
        <HeroTile
          label="Open Alerts"
          value={<StatValue loading={loading} value={stats?.open_alerts || 0} />}
          sub={stats?.pending_approvals ? `${stats.pending_approvals} PO${stats.pending_approvals > 1 ? 's' : ''} awaiting sign-off` : 'Nothing awaiting approval'}
          icon={AlertTriangle} tone="bg-red-100 dark:bg-red-900/30 text-red-600"
          onClick={hasPermission(user, 'alerts', 'view') ? () => navigate('/alerts') : undefined}
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

      {/* Occupancy movement - aggregate trend, no guest-level detail */}
      <div className="grid grid-cols-1 gap-4">
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
            icon={Package} tone="bg-amber-100 dark:bg-amber-900/30 text-amber-600" />
          <HeroTile label="Low Stock" value={<StatValue loading={loading} value={stats?.low_stock_count || 0} />}
            sub={stats?.low_stock_count ? 'Items need reorder' : 'Levels healthy'}
            icon={TrendingUp} tone="bg-pink-100 dark:bg-pink-900/30 text-pink-600" />
          <HeroTile label="Waste (Month)" value={<StatValue loading={loading} value={bigMoney(stats?.waste_cost_month)} />}
            icon={Trash2} tone="bg-red-100 dark:bg-red-900/30 text-red-600" />
          <HeroTile label="POs to Approve" value={<StatValue loading={loading} value={stats?.pending_approvals || 0} />}
            sub="Awaiting your sign-off"
            icon={ClipboardCheck} tone="bg-orange-100 dark:bg-orange-900/30 text-orange-600"
            onClick={() => navigate('/approvals')} alert={(stats?.pending_approvals ?? 0) > 0} />
        </div>
      </div>

      {/* Cross-module snapshot - aggregate insight into every department. These are
          read-only summaries: the Manager/Deputy don't drill into operational
          pages (not their job), so no navigation except to what they can act on. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <HeroTile label="Open Incidents" value={<StatValue loading={loading} value={stats?.open_incidents || 0} />}
          icon={ShieldAlert} tone="bg-red-100 dark:bg-red-900/30 text-red-600"
          alert={(stats?.open_incidents ?? 0) > 0} />
        <HeroTile label="Attendance Today" value={<StatValue loading={loading} value={stats?.attendance_present_today || 0} />}
          sub={stats?.attendance_absent_today ? `${stats.attendance_absent_today} no-shows` : 'No no-shows'}
          icon={UtensilsCrossed} tone="bg-teal-100 dark:bg-teal-900/30 text-teal-600" />
        <HeroTile label="Active Vendors" value={<StatValue loading={loading} value={stats?.active_vendor_count || 0} />}
          sub={`${stats?.avg_vendor_accuracy || 0}% avg delivery accuracy`}
          icon={Truck} tone="bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600" />
        <HeroTile label="Recipes Below Margin" value={<StatValue loading={loading} value={stats?.recipes_below_margin || 0} />}
          icon={ChefHat} tone="bg-orange-100 dark:bg-orange-900/30 text-orange-600"
          alert={(stats?.recipes_below_margin ?? 0) > 0} />
        <HeroTile label="Mess Revenue (Month)" value={<StatValue loading={loading} value={bigMoney(stats?.mess_revenue_month)} />}
          sub={stats?.unpaid_mess_bills ? `${stats.unpaid_mess_bills} unpaid bills` : 'All settled'}
          icon={Wallet} tone="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600" />
        <HeroTile label="Active Members" value={<StatValue loading={loading} value={stats?.active_member_count || 0} />}
          icon={IdCard} tone="bg-blue-100 dark:bg-blue-900/30 text-blue-600"
          onClick={hasPermission(user, 'members', 'view') ? () => navigate('/members') : undefined} />
        <HeroTile label="Invoices Finalized Today" value={<StatValue loading={loading} value={stats?.invoices_finalized_today || 0} />}
          icon={LayoutGrid} tone="bg-purple-100 dark:bg-purple-900/30 text-purple-600" />
        <HeroTile label="Discounts (Month)" value={<StatValue loading={loading} value={bigMoney(stats?.discounts_month)} />}
          icon={Receipt} tone="bg-pink-100 dark:bg-pink-900/30 text-pink-600" />
      </div>

      <p className="sr-only">Guests in house: {stats?.total_guests_today ?? 0}</p>
    </div>
  );
}
