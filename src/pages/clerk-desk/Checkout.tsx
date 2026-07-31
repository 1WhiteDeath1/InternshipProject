import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Wallet, History } from 'lucide-react';
import { BillPrintView } from '@/components/BillPrint';
import { BillStatusBadge } from '@/components/BillStatusBadge';
import { billTypeStyle } from '@/lib/billStyles';
import { formatCurrency } from '@/lib/currency';
import { OrderHistoryDialog } from '@/components/OrderHistoryDialog';
import { useClerkDesk, type UnsettledInvoice } from './context';

// The settle/collect queue: every generated-but-unpaid room/mess invoice.
// Checkout always bills everything owed in one shot (walk-ins pay room+mess
// together on the spot; online guests prepaid the room, so only mess is due
// at checkout) - a checked-in guest's bill is generated from Live Guests, so
// there's no separate "checked out but still unbilled" state to work here.
// Guests checking out right now sort first (handled server-side).
export default function Checkout() {
  const { desk, refresh } = useClerkDesk();
  const [settleInvoiceIds, setSettleInvoiceIds] = useState<number[] | null>(null);
  const [settleBookingId, setSettleBookingId] = useState<number | null>(null);
  const [historyBooking, setHistoryBooking] = useState<{ id: number; name: string } | null>(null);

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
      <div>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <Wallet size={18} /> Bills to settle
          <span className="text-xs font-normal text-gray-500">{settleGroups.length} guest{settleGroups.length === 1 ? '' : 's'} with payment due</span>
        </h2>
        {settleGroups.length === 0 && <p className="text-sm text-gray-500">Nothing waiting on payment right now.</p>}
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
                  {first.booking_id && (
                    <Button size="sm" variant="outline" onClick={() => setHistoryBooking({ id: first.booking_id as number, name: first.guest_name || 'Guest' })}>
                      <History size={14} className="mr-1" /> Order History
                    </Button>
                  )}
                  <Button size="sm" onClick={() => { setSettleInvoiceIds(group.map(i => i.id)); setSettleBookingId(first.booking_id ?? null); }}>
                    <Wallet size={14} className="mr-1" /> Settle &amp; Print
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <BillPrintView invoiceIds={settleInvoiceIds} bookingId={settleBookingId ?? undefined}
        onClose={() => { setSettleInvoiceIds(null); setSettleBookingId(null); }}
        allowPayments onPaymentsChanged={refresh} />

      <OrderHistoryDialog
        open={historyBooking !== null} onOpenChange={open => { if (!open) setHistoryBooking(null); }}
        bookingId={historyBooking?.id} personName={historyBooking?.name}
      />
    </div>
  );
}
