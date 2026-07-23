// Shared colour + status vocabulary for the Clerk Desk pages, so a bill's
// type (room / mess / member / walk-in) and its state (accruing / made now /
// overdue / issued / settled) read consistently everywhere they appear.

interface TypeStyle { label: string; badge: string; dot: string; bar: string; }

// room & combined = purple, mess/food = orange (both already the convention in
// ChargeSplitBar/CheckoutSheet), member = indigo, walk-in mess-only = teal.
export const BILL_TYPE_STYLES: Record<string, TypeStyle> = {
  room:     { label: 'Room',    badge: 'bg-purple-50 text-purple-800 dark:bg-purple-950 dark:text-purple-200', dot: 'bg-purple-500', bar: 'bg-purple-500' },
  combined: { label: 'Bill',    badge: 'bg-purple-50 text-purple-800 dark:bg-purple-950 dark:text-purple-200', dot: 'bg-purple-500', bar: 'bg-purple-500' },
  mess:     { label: 'Mess',    badge: 'bg-orange-50 text-orange-800 dark:bg-orange-950 dark:text-orange-200', dot: 'bg-orange-500', bar: 'bg-orange-500' },
  member:   { label: 'Member',  badge: 'bg-indigo-50 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200', dot: 'bg-indigo-500', bar: 'bg-indigo-500' },
  walkin:   { label: 'Walk-in', badge: 'bg-teal-50 text-teal-800 dark:bg-teal-950 dark:text-teal-200',         dot: 'bg-teal-500',   bar: 'bg-teal-500' },
};

export function billTypeStyle(t: string | null | undefined): TypeStyle {
  return BILL_TYPE_STYLES[t || 'combined'] || BILL_TYPE_STYLES.combined;
}

export type BillStatusKey = 'accruing' | 'made_now' | 'overdue' | 'issued' | 'settled';

export interface BillStatusInput {
  status?: string;            // invoice status: draft | issued | paid | void
  balance_due?: number;
  overdue?: boolean;          // server-derived: past due_date with balance owing
  issued_today?: boolean;     // server-derived: issue_date == today
  checking_out_now?: boolean; // guest at the desk right now
  accruing?: boolean;         // live folio, not yet billed
}

export function deriveBillStatus(x: BillStatusInput): BillStatusKey {
  if (x.accruing) return 'accruing';
  if (x.status === 'paid' || (typeof x.balance_due === 'number' && x.balance_due <= 0.01 && !!x.status)) return 'settled';
  if (x.overdue) return 'overdue';
  if (x.issued_today || x.checking_out_now) return 'made_now';
  return 'issued';
}

interface StatusStyle { label: string; className: string; }

export const BILL_STATUS_STYLES: Record<BillStatusKey, StatusStyle> = {
  accruing: { label: 'Accruing', className: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
  made_now: { label: 'Made now', className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 ring-1 ring-emerald-300 dark:ring-emerald-800' },
  issued:   { label: 'Issued',   className: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300' },
  overdue:  { label: 'Overdue',  className: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300 ring-1 ring-red-300 dark:ring-red-800 animate-pulse' },
  settled:  { label: 'Settled',  className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300' },
};
