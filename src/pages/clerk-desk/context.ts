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
  member_rank: string | null;
  member_service_number: string | null;
  member_mess_category: string | null;
  member_is_womens_bloc: boolean;
  month: number;
  year: number;
  man_days: number;
  per_head_rate: number;
  base_menu_amount: number;
  stay_amount: number;
  extra_meals_amount: number;
  ala_carte_amount: number;
  applied_discount_rate: number;
  discount_amount: number;
  discount_reason: string | null;
  total_amount: number;
  amount_paid: number;
  status: string;
}

export interface ClerkDeskContext {
  desk: DeskFeed;
  messOnly: DeskFeed;
  memberBills: MemberBill[];
  loading: boolean;
  refresh: () => void;
}

export function useClerkDesk() {
  return useOutletContext<ClerkDeskContext>();
}
