import { useEffect, useState, type ReactNode } from 'react';
import api from '@/lib/api';
import { useAuth } from '@/contexts/useAuth';
import { hasPermission } from '@/contexts/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertTriangle, BedDouble, LogIn, LogOut, Wallet, ArrowRight, ClipboardCheck, CalendarDays,
  ChefHat, PackageX, Utensils, Clock, Star,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, CartesianGrid, XAxis, YAxis, Tooltip, Legend,
} from 'recharts';
import { RoomStatusDonut } from '@/components/RoomStatusDonut';
import RevenueWidget from '@/components/dashboard/RevenueWidget';
import OccupancyWidget from '@/components/dashboard/OccupancyWidget';
import CostRevenueSankeyWidget from '@/components/dashboard/CostRevenueSankeyWidget';
import EventsWidget from '@/components/dashboard/EventsWidget';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '@/contexts/useTheme';
import { toast } from 'sonner';

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

interface BillingStats {
  today_revenue: number; today_invoice_count: number; month_revenue: number; overdue_invoices: number;
  today_collections: number; month_collections: number; payment_methods_today: { method: string; amount: number }[];
  today_room_revenue: number; today_mess_revenue: number; today_discounts: number;
}

interface MemberBillLite { status: string; total_amount: number; }

interface KitchenOrderLite {
  id: number; recipe_name: string | null; quantity_ordered: number; status: string;
  consumer_name: string | null; is_ala_carte: boolean;
}

interface LowStockItemLite {
  id: number; name: string; unit: string; total_stock: number; reorder_level: number;
}

interface AttendanceLite { meal_type: string; status: string; }

const MEAL_TYPE_LABELS: Record<string, string> = {
  breakfast: 'Breakfast', lunch: 'Lunch', hitea: 'Hi-Tea', dinner: 'Dinner',
};

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
  icon: typeof Wallet; tone: string; onClick?: () => void; alert?: boolean;
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
  const navigate = useNavigate();
  const [occupancy, setOccupancy] = useState<OccupancyData | null>(null);
  const [unsettled, setUnsettled] = useState<UnsettledInvoice[]>([]);
  const [billingStats, setBillingStats] = useState<BillingStats | null>(null);
  const [memberBills, setMemberBills] = useState<MemberBillLite[]>([]);
  const [kitchenOrders, setKitchenOrders] = useState<KitchenOrderLite[]>([]);
  const [lateOrderCount, setLateOrderCount] = useState(0);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [lowStockItems, setLowStockItems] = useState<LowStockItemLite[]>([]);
  const [todayAttendance, setTodayAttendance] = useState<AttendanceLite[]>([]);
  const [weeklyMealVolume, setWeeklyMealVolume] = useState<{ date: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const { darkMode } = useTheme();

  const isClerk = hasPermission(user, 'clerk_desk', 'view');
  // kitchen.view is exclusive to the Kitchen NCO role (see backend/migrations/
  // access.py) - the clerk_desk/billing exclusions just guard against that
  // ever changing under a future role that also touches the kitchen module.
  const isKitchen = hasPermission(user, 'kitchen', 'view')
    && !hasPermission(user, 'clerk_desk', 'view') && !hasPermission(user, 'billing', 'view');

  useEffect(() => {
    queueMicrotask(() => {
      setLoading(true);
      const canSeeDesk = hasPermission(user, 'billing', 'view') || hasPermission(user, 'clerk_desk', 'view');
      const todayStr = new Date().toISOString().slice(0, 10);
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
        // Kitchen NCO has no reports/alerts access, so this board is built
        // straight off the same kitchen/inventory/attendance endpoints the
        // module pages themselves use, rather than the cross-module alerts feed.
        ...(isKitchen ? [
          api.get('/kitchen/orders', { params: { date: todayStr, page_size: 100 } })
            .then(res => setKitchenOrders(res.data.items || [])),
          api.get('/kitchen/orders/late-summary').then(res => setLateOrderCount(res.data.count || 0)),
          api.get('/inventory/dashboard').then(res => setLowStockCount(res.data.low_stock_count || 0)),
          api.get('/inventory/items', { params: { low_stock: true, page_size: 6 } })
            .then(res => setLowStockItems(res.data.items || [])),
          api.get('/attendance', { params: { date: todayStr, page_size: 100 } })
            .then(res => setTodayAttendance(res.data.items || [])),
          // Weekly volume chart - one lightweight call per of the last 7 days
          // rather than a wide date_from/date_to range, since /attendance's
          // page_size caps at 100 and a week across every meal/member could
          // exceed that in one page.
          Promise.all(
            Array.from({ length: 7 }, (_, i) => {
              const d = new Date();
              d.setDate(d.getDate() - (6 - i));
              return d.toISOString().slice(0, 10);
            }).map(dateStr => api.get('/attendance', { params: { date: dateStr, page_size: 100 } })
              .then(res => ({
                date: dateStr,
                count: (res.data.items || []).filter((a: AttendanceLite) => a.status === 'booked' || a.status === 'attended').length,
              })))
          ).then(setWeeklyMealVolume),
        ] : []),
      ];
      Promise.all(common)
        .catch(() => toast.error('Failed to load dashboard data'))
        .finally(() => setLoading(false));
    });
  }, [user, isClerk, isKitchen]);

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

  // ---- Kitchen NCO view: the kitchen queue, special (à la carte) orders,
  // stock health, and today's meal volume - the things that actually drive
  // what happens on the line. No revenue/billing figures - that's the
  // Clerk's board, not this one. ----
  if (isKitchen) {
    const activeOrders = kitchenOrders.filter(o => o.status === 'pending' || o.status === 'cooking' || o.status === 'prepared');
    const specialOrders = activeOrders.filter(o => o.is_ala_carte);
    const mealCounts = Object.keys(MEAL_TYPE_LABELS).map(mealType => ({
      mealType,
      count: todayAttendance.filter(a => a.meal_type === mealType && (a.status === 'booked' || a.status === 'attended')).length,
    }));
    const mealsToday = mealCounts.reduce((s, m) => s + m.count, 0);

    const gridStroke = darkMode ? '#374151' : '#E5E7EB';
    const tickFill = darkMode ? '#9CA3AF' : '#6B7280';
    const tooltipStyle = {
      backgroundColor: darkMode ? '#111827' : '#FFFFFF',
      border: `1px solid ${gridStroke}`, borderRadius: 8, color: darkMode ? '#F9FAFB' : '#111827', fontSize: 13,
    };
    const weekdayLabel = (dateStr: string) => new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short' });
    const weeklyChartData = weeklyMealVolume.map(w => ({ day: weekdayLabel(w.date), meals: w.count }));
    const mealTypeColors: Record<string, string> = { breakfast: '#F59E0B', lunch: '#10B981', hitea: '#8B5CF6', dinner: '#3B82F6' };
    const donutData = mealCounts.filter(m => m.count > 0).map(m => ({ key: m.mealType, name: MEAL_TYPE_LABELS[m.mealType], value: m.count }));

    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Welcome, {user?.full_name}</h1>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          <HeroTile label="Meals Booked Today" value={<StatValue loading={loading} value={mealsToday} />}
            sub="Members & guests, all meals"
            icon={Utensils} tone="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600" onClick={() => navigate('/attendance')} />
          <HeroTile label="Special Orders" value={<StatValue loading={loading} value={specialOrders.length} />}
            sub={specialOrders.length > 0 ? 'À la carte requests in queue' : 'None right now'}
            icon={Star} tone="bg-amber-100 dark:bg-amber-900/30 text-amber-600" onClick={() => navigate('/kitchen')} alert={specialOrders.length > 0} />
          <HeroTile label="Orders in Kitchen" value={<StatValue loading={loading} value={activeOrders.length} />}
            sub={activeOrders.length > 0 ? 'Pending, cooking or prepared' : 'Queue is clear'}
            icon={ChefHat} tone="bg-blue-100 dark:bg-blue-900/30 text-blue-600" onClick={() => navigate('/kitchen')} />
          <HeroTile label="Orders Overdue" value={<StatValue loading={loading} value={lateOrderCount} />}
            sub={lateOrderCount > 0 ? 'Past their SLA deadline' : 'Nothing running late'}
            icon={Clock} tone="bg-red-100 dark:bg-red-900/30 text-red-600" onClick={() => navigate('/kitchen')} alert={lateOrderCount > 0} />
          <HeroTile label="Low Stock Items" value={<StatValue loading={loading} value={lowStockCount} />}
            sub={lowStockCount > 0 ? 'At or below reorder level' : 'Stock levels healthy'}
            icon={PackageX} tone="bg-purple-100 dark:bg-purple-900/30 text-purple-600" onClick={() => navigate('/inventory')} alert={lowStockCount > 0} />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <SectionCard title="Weekly Meal Volume">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeklyChartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 12, fill: tickFill }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 12, fill: tickFill }} width={32} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v} meals`, 'Booked']} />
                  <Bar dataKey="meals" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>

          <SectionCard title="Today's Meals by Type">
            <div className="h-56">
              {donutData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-base text-gray-400">No meals booked yet today</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={donutData} dataKey="value" nameKey="name" innerRadius={52} outerRadius={78} paddingAngle={2}
                      stroke={darkMode ? '#111827' : '#FFFFFF'} strokeWidth={2}>
                      {donutData.map(d => <Cell key={d.key} fill={mealTypeColors[d.key]} />)}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number, name: string) => [`${v} meals`, name]} />
                    <Legend verticalAlign="bottom" height={24} formatter={(v: string) => <span style={{ color: tickFill, fontSize: 12 }}>{v}</span>} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </SectionCard>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <SectionCard title="Kitchen Queue"
            action={<button className="text-sm text-blue-600 hover:underline flex items-center gap-1" onClick={() => navigate('/kitchen')}>Kitchen <ArrowRight size={15} /></button>}>
            {activeOrders.length === 0 && <p className="text-base text-gray-400">Nothing in the queue right now</p>}
            <div className="space-y-2">
              {activeOrders.slice(0, 6).map(o => (
                <button key={o.id} type="button" onClick={() => navigate('/kitchen')}
                  className="w-full flex items-center justify-between gap-2 rounded-lg border px-3 py-2 hover:border-blue-400 transition-colors text-left">
                  <span className="min-w-0">
                    <span className="text-base font-medium flex items-center gap-1.5 truncate">
                      {o.is_ala_carte && <Star size={13} className="text-amber-500 shrink-0" />}
                      {o.recipe_name || '—'}
                    </span>
                    <span className="text-sm text-gray-500">
                      {o.is_ala_carte ? (o.consumer_name || 'À la carte') : `${o.quantity_ordered} portions`}
                    </span>
                  </span>
                  <span className="text-sm font-medium capitalize shrink-0 text-gray-500">{o.status}</span>
                </button>
              ))}
              {activeOrders.length > 6 && <p className="text-sm text-gray-500">+ {activeOrders.length - 6} more in Kitchen</p>}
            </div>
          </SectionCard>

          <SectionCard title="Low Stock Items"
            action={<button className="text-sm text-blue-600 hover:underline flex items-center gap-1" onClick={() => navigate('/inventory')}>Inventory <ArrowRight size={15} /></button>}>
            {lowStockItems.length === 0 && <p className="text-base text-gray-400">Nothing below reorder level ✓</p>}
            <div className="space-y-2">
              {lowStockItems.slice(0, 6).map(it => (
                <button key={it.id} type="button" onClick={() => navigate('/inventory')}
                  className="w-full flex items-center justify-between gap-2 rounded-lg border px-3 py-2 hover:border-red-400 transition-colors text-left">
                  <span className="text-base font-medium truncate">{it.name}</span>
                  <span className="text-sm font-medium text-red-600 shrink-0">{it.total_stock} / {it.reorder_level} {it.unit}</span>
                </button>
              ))}
              {lowStockCount > lowStockItems.length && <p className="text-sm text-gray-500">+ {lowStockCount - lowStockItems.length} more below reorder level</p>}
            </div>
          </SectionCard>
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

  // ---- Manager / Deputy Manager: exactly 3 widgets, each a click away from
  // its own detailed popup. Everything else that used to live on this board
  // (stock, waste, vendors, incidents, attendance, etc.) is intentionally
  // gone - those all still surface through their own module pages. ----
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
        <p className="text-base text-gray-500 dark:text-gray-400">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
      </div>

      {/* 2-up, not 4-up: RevenueWidget's sparkline and the Sankey diagram both
          need real horizontal room to read (the Sankey especially - its node
          labels sit in fixed-width margins on either side of the flow). At
          xl:grid-cols-4 each widget was squeezed to ~1/4 width and the charts
          read as illegible slivers; capping at 2 columns keeps every widget
          at a readable width on any screen down to tablet. Kept compact
          (space-y-4/gap-4, no py-6 double-padding in the widgets below) so
          the whole board fits a laptop screen without scrolling. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RevenueWidget />
        <CostRevenueSankeyWidget />
        <OccupancyWidget />
        <EventsWidget />
      </div>
    </div>
  );
}
