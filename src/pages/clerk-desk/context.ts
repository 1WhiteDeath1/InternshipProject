import { useOutletContext } from 'react-router-dom';
import type { CheckoutGuest, RunningBalance } from '@/components/CheckoutSheet';

// Shared shapes + accessor for the data ClerkDeskLayout fetches once and hands
// to every Clerk Desk page via Outlet context. Kept in its own (component-free)
// module so the layout file can export only its component (react-refresh).

export interface DeskGuest extends CheckoutGuest {
  booking_reference?: string;
  balance: RunningBalance;
}

export interface UnsettledInvoice {
  id: number;
  invoice_number: string;
  bill_type: string;
  total_amount: number;
  amount_paid: number;
  balance_due: number;
  booking_id?: number | null;
  guest_id?: number | null;
  guest_name: string | null;
  rank: string | null;
  room_number: string | null;
  issue_date: string;
  checking_out_now: boolean;
  overdue?: boolean;
  issued_today?: boolean;
}

export interface DeskFeed { items: DeskGuest[]; unsettled_invoices: UnsettledInvoice[]; }

export interface MemberBill {
  id: number;
  member_id: number;
  member_name: string | null;
  month: number;
  year: number;
  total_amount: number;
  status: string;
}

export interface BillingStats {
  today_collections: number;
  month_collections: number;
  today_revenue: number;
  today_invoice_count: number;
  month_revenue: number;
  overdue_invoices: number;
  payment_methods_today: { method: string; amount: number }[];
  today_room_revenue: number;
  today_mess_revenue: number;
  today_discounts: number;
}

export interface ClerkDeskContext {
  desk: DeskFeed;
  messOnly: DeskFeed;
  memberBills: MemberBill[];
  stats: BillingStats | null;
  loading: boolean;
  refresh: () => void;
}

export function useClerkDesk() {
  return useOutletContext<ClerkDeskContext>();
}
