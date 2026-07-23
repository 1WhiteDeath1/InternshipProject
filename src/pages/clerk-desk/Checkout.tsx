import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Receipt, Wallet } from 'lucide-react';
import { CheckoutSheet, type CheckoutGuest } from '@/components/CheckoutSheet';
import { BillPrintView } from '@/components/BillPrint';
import { ChargeSplitBar } from '@/components/ChargeSplitBar';
import { BillStatusBadge } from '@/components/BillStatusBadge';
import { billTypeStyle } from '@/lib/billStyles';
import { formatCurrency } from '@/lib/currency';
import { useClerkDesk, type UnsettledInvoice } from './context';

// The settle/collect queue: checked-out guests whose bill still needs
// generating, plus every generated-but-unpaid room/mess invoice. Guests
// checking out right now sort first (handled server-side).
export default function Checkout() {
  const { desk, loading, refresh } = useClerkDesk();
  const [checkoutGuest, setCheckoutGuest] = useState<CheckoutGuest | null>(null);
  const [settleInvoiceIds, setSettleInvoiceIds] = useState<number[] | null>(null);
  const [settleBookingId, setSettleBookingId] = useState<number | null>(null);

  const pending = desk.items.filter(g => g.status === 'checked_out');

  // One settle row per guest, so their room + mess bills collect in one Pay.
  const settleGroups = useMemo(() => {
    const groups = new Map<string, UnsettledInvoice[]>();
    for (const inv of desk.unsettled_invoices) {
      const key = String(inv.booking_id ?? `inv-${inv.id}`);
      const g = groups.get(key);
      if (g) g.push(inv); else groups.set(key, [inv]);
    }
    return [...groups.values()];
  }, [desk.unsettled_invoices]);

  return (
    <div className="space-y-6">
      {settleGroups.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Wallet size={18} /> Bills to settle
            <span className="text-xs font-normal text-gray-500">{settleGroups.length} guest{settleGroups.length > 1 ? 's' : ''} with payment due</span>
          </h2>
          <div className="space-y-2">
            {settleGroups.map(group => {
              const first = group[0];
              const balance = group.reduce((sum, i) => sum + i.balance_due, 0);
              const alert = group.some(i => i.overdue);
              return (
                <Card key={first.id} className={
                  alert ? 'border-red-400 ring-1 ring-red-200 dark:ring-red-900'
                    : first.checking_out_now ? 'border-emerald-400 ring-1 ring-emerald-200 dark:ring-emerald-900' : ''}>
                  <CardContent className="p-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold truncate flex items-center gap-2">
                        {first.rank ? `${first.rank} ` : ''}{first.guest_name || '—'}
                        <BillStatusBadge input={first} />
                      </p>
                      <p className="text-xs text-gray-500">Room {first.room_number || '—'} · {group.map(i => i.invoice_number).join(' · ')}</p>
                    </div>
                    <div className="flex gap-1.5 text-xs">
                      {group.map(i => {
                        const st = billTypeStyle(i.bill_type);
                        return (
                          <span key={i.id} className={`flex items-center gap-1 rounded px-2 py-1 ${st.badge}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                            {formatCurrency(i.balance_due)}
                            {i.amount_paid > 0 && <span className="opacity-60">left</span>}
                          </span>
                        );
                      })}
                    </div>
                    <p className="text-lg font-bold font-mono">{formatCurrency(balance)}</p>
                    <Button size="sm" onClick={() => { setSettleInvoiceIds(group.map(i => i.id)); setSettleBookingId(first.booking_id ?? null); }}>
                      <Wallet size={14} className="mr-1" /> Settle &amp; Print
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2"><Receipt size={18} /> Checked out — bill pending</h2>
        {loading && <p className="text-sm text-gray-500">Loading…</p>}
        {!loading && pending.length === 0 && <p className="text-sm text-gray-500">No checked-out guests awaiting a bill.</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {pending.map(g => {
            const bal = g.balance;
            return (
              <Card key={g.id} className="cursor-pointer hover:shadow-md transition-all border-amber-300 dark:border-amber-900" onClick={() => setCheckoutGuest(g)}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex justify-between items-start gap-2">
                    <div className="min-w-0">
                      <p className="font-bold truncate">{g.rank ? `${g.rank} ` : ''}{g.guest_name}</p>
                      <p className="text-xs text-gray-500">Room {g.room_number}</p>
                    </div>
                    <p className="text-xl font-bold shrink-0">{formatCurrency(bal.balance_due)}</p>
                  </div>
                  <ChargeSplitBar segments={[
                    { label: bal.room_billed ? 'Room (billed)' : 'Room', amount: bal.room_billed ? 0 : bal.room_bill_total, colorClass: 'bg-purple-500' },
                    { label: bal.mess_billed ? 'Food (billed)' : 'Food', amount: bal.mess_billed ? 0 : bal.mess_bill_total, colorClass: 'bg-orange-500' },
                  ]} />
                  {bal.unpriced_items.length > 0 && <p className="text-xs text-amber-600">Needs pricing: {bal.unpriced_items.join(', ')}</p>}
                  <Button size="sm" className="w-full" onClick={e => { e.stopPropagation(); setCheckoutGuest(g); }}>
                    <Receipt size={14} className="mr-1" /> Generate Remaining Bill
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <CheckoutSheet guest={checkoutGuest}
        onOpenChange={v => { if (!v) setCheckoutGuest(null); }}
        onDone={refresh} />

      <BillPrintView invoiceIds={settleInvoiceIds} bookingId={settleBookingId ?? undefined}
        onClose={() => { setSettleInvoiceIds(null); setSettleBookingId(null); }}
        allowPayments onPaymentsChanged={refresh} />
    </div>
  );
}
