import { deriveBillStatus, BILL_STATUS_STYLES, type BillStatusInput } from '@/lib/billStyles';

/** A small pill conveying a bill's state (accruing / made now / overdue /
    issued / settled), derived from whatever of {status, balance_due, overdue,
    issued_today, checking_out_now, accruing} is available. Shared across the
    Clerk Desk pages so the visual language of bill state is consistent. */
export function BillStatusBadge({ input, className = '' }: { input: BillStatusInput; className?: string }) {
  const style = BILL_STATUS_STYLES[deriveBillStatus(input)];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${style.className} ${className}`}>
      {style.label}
    </span>
  );
}
