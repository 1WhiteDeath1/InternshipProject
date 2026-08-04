import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import api from '@/lib/api';
import { toast } from 'sonner';
import { LayoutGrid, DoorOpen, LogOut, UtensilsCrossed, IdCard } from 'lucide-react';
import type { ClerkDeskContext, DeskFeed, MemberBill } from './context';

// The Clerk Desk is split into purpose-built pages by bill type. This layout
// fetches the feeds once and shares them (via Outlet context) with the four
// category pages, so switching tabs never refetches and every page/badge
// sees the same numbers. There's no separate Overview/dashboard tab here -
// that lives on the main /dashboard page instead, so Live Guests is the
// landing tab.

const EMPTY_FEED: DeskFeed = { items: [], unsettled_invoices: [] };

const TABS = [
  { to: '/clerk-desk/live', end: true, label: 'Live Guests', icon: DoorOpen },
  { to: '/clerk-desk/checkout', label: 'Checkout', icon: LogOut },
  { to: '/clerk-desk/mess-only', label: 'Mess-Only', icon: UtensilsCrossed },
  { to: '/clerk-desk/members', label: 'Members', icon: IdCard },
];

export default function ClerkDeskLayout() {
  const [desk, setDesk] = useState<DeskFeed>(EMPTY_FEED);
  const [messOnly, setMessOnly] = useState<DeskFeed>(EMPTY_FEED);
  const [memberBills, setMemberBills] = useState<MemberBill[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [deskRes, messRes, billsRes] = await Promise.all([
        api.get('/billing/desk'),
        api.get('/billing/mess-only-desk'),
        api.get('/mess-billing/bills?page_size=100'),
      ]);
      setDesk(deskRes.data);
      setMessOnly(messRes.data);
      setMemberBills(billsRes.data.items || []);
    } catch { toast.error('Failed to load Clerk Desk'); }
  }, []);

  useEffect(() => {
    queueMicrotask(() => { setLoading(true); refresh().finally(() => setLoading(false)); });
  }, [refresh]);

  const ctx: ClerkDeskContext = { desk, messOnly, memberBills, loading, refresh };

  // Per-tab count badges give the clerk an at-a-glance sense of where work is.
  // Members' badge is drafts only - freshly generated bills nobody has looked
  // at yet - not the whole unpaid book, so it reads as "new" rather than
  // "always non-zero".
  const liveCount = desk.items.filter(g => g.status === 'checked_in').length;
  const checkoutCount = desk.unsettled_invoices.length;
  const messCount = messOnly.items.length + messOnly.unsettled_invoices.length;
  const memberCount = memberBills.filter(b => b.status === 'draft').length;
  const counts: Record<string, number> = {
    '/clerk-desk/live': liveCount,
    '/clerk-desk/checkout': checkoutCount,
    '/clerk-desk/mess-only': messCount,
    '/clerk-desk/members': memberCount,
  };

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
        <LayoutGrid size={24} /> Clerk Desk
      </h1>

      <div className="flex gap-1 overflow-x-auto border-b border-border -mx-1 px-1">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const count = counts[tab.to];
          return (
            <NavLink key={tab.to} to={tab.to} end={tab.end}
              className={({ isActive }) => `flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${isActive
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-muted-foreground hover:text-foreground dark:hover:text-gray-200'}`}>
              <Icon size={16} /> {tab.label}
              {count ? <span className="ml-0.5 rounded-full bg-muted text-foreground text-[11px] font-semibold px-1.5 min-w-5 text-center">{count}</span> : null}
            </NavLink>
          );
        })}
      </div>

      <Outlet context={ctx} />
    </div>
  );
}
