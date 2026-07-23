import { useCallback, useEffect, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { toast } from 'sonner';
import { BedDouble, Receipt, UtensilsCrossed } from 'lucide-react';
import { BillPrintView } from '@/components/BillPrint';
import { ChargeSplitBar } from '@/components/ChargeSplitBar';
import { formatCurrency } from '@/lib/currency';

// The Clerk's checkout surface - the only place an invoice actually gets
// generated. Booking Staff and Mess Staff log charges elsewhere (the Room
// Charges panel in the room view, the Guest Mess Charges tab in Kitchen) as
// a guest incurs them; by the time a stay reaches here, the Clerk just
// reviews the accumulated total and generates one invoice.

export interface CheckoutGuest {
  id: number;
  guest_name: string;
  rank?: string | null;
  room_number?: string | null;
  status: string; // checked_in | checked_out (bill pending)
}

interface BalanceItem { description: string; amount: number; }

export interface RunningBalance {
  room_bill_total: number;
  mess_bill_total: number;
  room_items: BalanceItem[];
  mess_items: BalanceItem[];
  total: number;
  outstanding_invoices: number;
  balance_due: number;
  unpriced_items: string[];
  room_billed: boolean;
  mess_billed: boolean;
}

function BillBox({ title, icon: Icon, items, total, billed, accent }: {
  title: string; icon: typeof BedDouble; items: BalanceItem[]; total: number; billed: boolean; accent: string;
}) {
  return (
    <div className={`flex-1 rounded-lg border-2 ${accent} p-3 min-w-0`}>
      <p className="text-sm font-semibold flex items-center gap-1.5 mb-2"><Icon size={15} /> {title}</p>
      {billed && <p className="text-xs text-emerald-600">Already billed</p>}
      {!billed && items.length === 0 && <p className="text-xs text-gray-400">No charges yet</p>}
      <div className="space-y-1">
        {items.map((it, i) => (
          <div key={i} className="flex justify-between gap-2 text-xs">
            <span className="truncate">{it.description}</span>
            <span className="font-mono shrink-0">{formatCurrency(it.amount)}</span>
          </div>
        ))}
      </div>
      <div className="flex justify-between border-t mt-2 pt-1.5 text-sm font-bold">
        <span>Total</span><span className="font-mono">{billed ? '—' : formatCurrency(total)}</span>
      </div>
    </div>
  );
}

export function CheckoutSheet({ guest, onOpenChange, onDone }: {
  guest: CheckoutGuest | null;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}) {
  const [balance, setBalance] = useState<RunningBalance | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const [printInvoiceIds, setPrintInvoiceIds] = useState<number[] | null>(null);
  const [printBookingId, setPrintBookingId] = useState<number | null>(null);

  const guestId = guest?.id;

  const fetchBalance = useCallback(async () => {
    if (!guestId) return;
    try {
      const res = await api.get(`/billing/bookings/${guestId}/running-balance`);
      setBalance(res.data);
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to load the guest\'s balance')); }
  }, [guestId]);

  useEffect(() => {
    queueMicrotask(() => {
      if (!guestId) { setBalance(null); return; }
      setBalance(null);
      fetchBalance();
    });
  }, [guestId, fetchBalance]);

  const openExistingInvoices = async () => {
    if (!guest) return;
    try {
      const res = await api.get(`/billing/bookings/${guest.id}/master-invoice`);
      setPrintInvoiceIds((res.data.source_invoices as { id: number }[]).map(i => i.id));
      setPrintBookingId(guest.id);
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to load the existing invoice')); }
  };

  const handleGenerateInvoice = async () => {
    if (!guest || checkingOut) return; // guard against double-clicks racing two checkouts
    if (balance?.room_billed && balance?.mess_billed) { await openExistingInvoices(); return; }
    setCheckingOut(true);
    try {
      const res = await api.post(`/billing/bookings/${guest.id}/instant-checkout`, {});
      const invoices: { id: number; bill_type: string }[] = res.data.invoices;
      setPrintInvoiceIds(invoices.map(i => i.id));
      setPrintBookingId(guest.id);
      toast.success(`${guest.guest_name} — invoice generated (Rs ${res.data.grand_total.toLocaleString('en-US')})`);
      if (res.data.late_checkout_fee > 0) toast.info(`Late checkout fee ${formatCurrency(res.data.late_checkout_fee)} added to the room bill`);
      if (res.data.unpriced_items?.length) toast.warning(`Not billed (needs pricing): ${res.data.unpriced_items.join(', ')}`);
      onDone?.();
      onOpenChange(false);
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to generate invoice')); }
    finally { setCheckingOut(false); }
  };

  const alreadyFullyBilled = !!balance?.room_billed && !!balance?.mess_billed;

  return (
    <>
      <Sheet open={!!guest} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {guest && (
            <>
              <SheetHeader>
                <SheetTitle>
                  {guest.rank ? `${guest.rank} ` : ''}{guest.guest_name}
                  {guest.room_number ? ` — Room ${guest.room_number}` : ''}
                </SheetTitle>
              </SheetHeader>
              <div className="space-y-4 mt-3 px-1">
                {guest.status === 'checked_out' && (
                  <p className="text-xs rounded-md bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 px-3 py-2">
                    Guest has checked out — a bill is still pending below.
                  </p>
                )}
                {balance ? (
                  <>
                    <ChargeSplitBar segments={[
                      { label: 'Room', amount: balance.room_bill_total, colorClass: 'bg-purple-500' },
                      { label: 'Food', amount: balance.mess_bill_total, colorClass: 'bg-orange-500' },
                    ]} />
                    <div className="flex gap-3 flex-col sm:flex-row">
                      <BillBox title="Room Bill" icon={BedDouble} items={balance.room_items}
                        total={balance.room_bill_total} billed={balance.room_billed} accent="border-purple-300 dark:border-purple-800" />
                      <BillBox title="Food Bill" icon={UtensilsCrossed} items={balance.mess_items}
                        total={balance.mess_bill_total} billed={balance.mess_billed} accent="border-orange-300 dark:border-orange-800" />
                    </div>
                    <p className="text-xs text-gray-500">
                      Room and mess charges are logged by Booking Staff and Mess Staff as the stay goes on (Room Charges panel / Kitchen's Guest Mess Charges tab) — this total reflects everything logged so far.
                    </p>
                    <div className="rounded-lg border p-3 text-sm space-y-1">
                      {balance.outstanding_invoices > 0 && (
                        <div className="flex justify-between text-xs text-gray-500">
                          <span>Unpaid on bills already generated</span>
                          <span className="font-mono">{formatCurrency(balance.outstanding_invoices)}</span>
                        </div>
                      )}
                      <div className="flex justify-between font-bold"><span>Balance due at checkout</span><span className="font-mono">{formatCurrency(balance.balance_due)}</span></div>
                      {balance.unpriced_items.length > 0 && <p className="text-xs text-amber-600">Needs pricing first: {balance.unpriced_items.join(', ')}</p>}
                    </div>
                  </>
                ) : <p className="text-sm text-gray-500">Loading balance…</p>}

                <div className="rounded-lg border p-3 space-y-2">
                  <Button className="w-full" disabled={checkingOut || !balance} onClick={handleGenerateInvoice}>
                    <Receipt size={15} className="mr-1.5" />
                    {checkingOut ? 'Working…' : alreadyFullyBilled ? 'View Invoice' : guest.status === 'checked_in' ? 'Checkout — Generate Invoice' : 'Generate Invoice'}
                  </Button>
                  {guest.status === 'checked_in' && !alreadyFullyBilled && (
                    <p className="text-xs text-gray-500">Generating the invoice checks the guest out and sends the room to the housekeeping queue.</p>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <BillPrintView invoiceIds={printInvoiceIds} bookingId={printBookingId ?? undefined}
        onClose={() => { setPrintInvoiceIds(null); setPrintBookingId(null); }}
        allowPayments onPaymentsChanged={() => { fetchBalance(); onDone?.(); }} />
    </>
  );
}
