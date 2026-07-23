import { type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Wallet, CalendarDays, AlertTriangle, DoorOpen, LogOut, UtensilsCrossed, IdCard } from 'lucide-react';
import { ChargeSplitBar } from '@/components/ChargeSplitBar';
import { useClerkDesk } from './context';

const bigMoney = (n: number | null | undefined) => `Rs ${Math.round(n && !Number.isNaN(n) ? n : 0).toLocaleString('en-US')}`;

const PAYMENT_METHOD_COLORS: Record<string, string> = {
  Cash: 'bg-emerald-500', 'Bank Transfer': 'bg-blue-500', Cheque: 'bg-amber-500', Online: 'bg-violet-500',
};

function Tile({ label, value, sub, icon: Icon, tone, alert }: {
  label: string; value: ReactNode; sub?: ReactNode; icon: typeof Wallet; tone: string; alert?: boolean;
}) {
  return (
    <Card className={alert ? 'border-red-400 ring-1 ring-red-200 dark:ring-red-900' : ''}>
      <CardContent className="p-5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${tone}`}><Icon size={18} /></div>
        </div>
        <p className={`text-2xl xl:text-3xl font-bold tracking-tight mt-1.5 ${alert ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>{value}</p>
        {sub && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function CategoryCard({ label, count, amount, unit, icon: Icon, tone, onClick }: {
  label: string; count: number; amount: number; unit: string; icon: typeof DoorOpen; tone: string; onClick: () => void;
}) {
  return (
    <Card className="cursor-pointer hover:shadow-md transition-all" onClick={onClick}>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${tone}`}><Icon size={20} /></div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm">{label}</p>
          <p className="text-xs text-gray-500">{count} {unit}</p>
        </div>
        <p className="font-bold font-mono text-sm shrink-0">{bigMoney(amount)}</p>
      </CardContent>
    </Card>
  );
}

export default function Overview() {
  const { desk, messOnly, memberBills, stats, loading } = useClerkDesk();
  const navigate = useNavigate();

  const liveGuests = desk.items.filter(g => g.status === 'checked_in');
  const pendingCheckout = desk.items.filter(g => g.status === 'checked_out');
  const deskDue = desk.unsettled_invoices.reduce((s, i) => s + i.balance_due, 0);
  const messDue = messOnly.unsettled_invoices.reduce((s, i) => s + i.balance_due, 0);
  const outstanding = deskDue + messDue;
  const overdueCount = [...desk.unsettled_invoices, ...messOnly.unsettled_invoices].filter(i => i.overdue).length;

  const liveAccruing = liveGuests.reduce((s, g) => s + g.balance.balance_due, 0);
  const messUnbilled = messOnly.items.reduce((s, g) => s + g.balance.mess_bill_total, 0);
  const memberUnpaid = memberBills.filter(b => b.status !== 'paid');
  const memberDue = memberUnpaid.reduce((s, b) => s + b.total_amount, 0);

  const paymentSegments = (stats?.payment_methods_today ?? []).map(p => ({
    label: p.method, amount: p.amount, colorClass: PAYMENT_METHOD_COLORS[p.method] || 'bg-gray-400',
  }));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Tile label="Today's Collections" value={loading ? '—' : bigMoney(stats?.today_collections)}
          sub="Received today" icon={Wallet} tone="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600" />
        <Tile label="This Month's Collections" value={loading ? '—' : bigMoney(stats?.month_collections)}
          sub="Received month-to-date" icon={CalendarDays} tone="bg-blue-100 dark:bg-blue-900/30 text-blue-600" />
        <Tile label="Outstanding to Collect" value={loading ? '—' : bigMoney(outstanding)}
          sub={outstanding > 0 ? 'On generated bills' : 'All collected'} icon={AlertTriangle}
          tone="bg-purple-100 dark:bg-purple-900/30 text-purple-600" alert={outstanding > 0} />
        <Tile label="Overdue Bills" value={loading ? '—' : overdueCount}
          sub={overdueCount > 0 ? 'Past due date' : 'None overdue'} icon={AlertTriangle}
          tone="bg-red-100 dark:bg-red-900/30 text-red-600" alert={overdueCount > 0} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <CategoryCard label="Live Guests" count={liveGuests.length} unit="in-house" amount={liveAccruing}
          icon={DoorOpen} tone="bg-purple-100 dark:bg-purple-900/30 text-purple-600" onClick={() => navigate('/clerk-desk/live')} />
        <CategoryCard label="Checkout" count={pendingCheckout.length + desk.unsettled_invoices.length} unit="to settle" amount={deskDue}
          icon={LogOut} tone="bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600" onClick={() => navigate('/clerk-desk/checkout')} />
        <CategoryCard label="Mess-Only" count={messOnly.items.length + messOnly.unsettled_invoices.length} unit="walk-ins" amount={messUnbilled + messDue}
          icon={UtensilsCrossed} tone="bg-teal-100 dark:bg-teal-900/30 text-teal-600" onClick={() => navigate('/clerk-desk/mess-only')} />
        <CategoryCard label="Members" count={memberUnpaid.length} unit="unpaid bills" amount={memberDue}
          icon={IdCard} tone="bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600" onClick={() => navigate('/clerk-desk/members')} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base font-semibold">Payments Collected — Today</CardTitle></CardHeader>
          <CardContent>
            {paymentSegments.length > 0
              ? <ChargeSplitBar className="py-1" segments={paymentSegments} />
              : <p className="text-sm text-gray-400">No payments recorded yet today</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base font-semibold">Room vs Mess — Billed Today</CardTitle></CardHeader>
          <CardContent>
            <ChargeSplitBar className="py-1" segments={[
              { label: 'Room', amount: stats?.today_room_revenue ?? 0, colorClass: 'bg-purple-500' },
              { label: 'Food', amount: stats?.today_mess_revenue ?? 0, colorClass: 'bg-orange-500' },
            ]} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
