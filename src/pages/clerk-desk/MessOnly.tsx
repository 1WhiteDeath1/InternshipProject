import { useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';
import { UtensilsCrossed, Wallet, History } from 'lucide-react';
import { BillPrintView } from '@/components/BillPrint';
import { ChargeSplitBar } from '@/components/ChargeSplitBar';
import { BillStatusBadge } from '@/components/BillStatusBadge';
import { formatCurrency } from '@/lib/currency';
import { OrderHistoryDialog } from '@/components/OrderHistoryDialog';
import { useClerkDesk, type UnsettledInvoice } from './context';

// Walk-in "mess-only" guests: they ate but booked no room, so there's no
// checkout - just their unbilled meals, gathered into a single mess bill and
// settled here. Colour-coded teal to set them apart from room stays.
export default function MessOnly() {
  const { messOnly, loading, refresh } = useClerkDesk();
  const [settleInvoiceIds, setSettleInvoiceIds] = useState<number[] | null>(null);
  const [generatingId, setGeneratingId] = useState<number | null>(null);
  const [historyGuest, setHistoryGuest] = useState<{ id: number; name: string } | null>(null);

  const generate = async (guestId: number) => {
    setGeneratingId(guestId);
    try {
      const res = await api.post(`/billing/guests/${guestId}/mess-bill`, {});
      const inv = res.data.invoices[0];
      toast.success(`Mess bill generated — ${formatCurrency(res.data.grand_total)}`);
      if (res.data.unpriced_items?.length) toast.warning(`Not billed (needs pricing): ${res.data.unpriced_items.join(', ')}`);
      setSettleInvoiceIds([inv.id]);
      refresh();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to generate mess bill')); }
    finally { setGeneratingId(null); }
  };

  // One settle row per guest invoice (walk-in bills are single mess invoices).
  const settleGroups = new Map<string, UnsettledInvoice[]>();
  for (const inv of messOnly.unsettled_invoices) {
    const key = String(inv.guest_id ?? `inv-${inv.id}`);
    const g = settleGroups.get(key);
    if (g) g.push(inv); else settleGroups.set(key, [inv]);
  }

  return (
    <div className="space-y-6">
      {settleGroups.size > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Wallet size={18} /> Mess bills to settle
          </h2>
          <div className="space-y-2">
            {[...settleGroups.values()].map(group => {
              const first = group[0];
              const balance = group.reduce((s, i) => s + i.balance_due, 0);
              return (
                <Card key={first.id} className={first.overdue ? 'border-red-400 ring-1 ring-red-200 dark:ring-red-900' : ''}>
                  <CardContent className="p-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold truncate flex items-center gap-2">
                        {first.guest_name || '—'}
                        <BillStatusBadge input={first} />
                      </p>
                      <p className="text-xs text-gray-500">Walk-in · {group.map(i => i.invoice_number).join(' · ')}</p>
                    </div>
                    <p className="text-lg font-bold font-mono">{formatCurrency(balance)}</p>
                    <Button size="sm" onClick={() => setSettleInvoiceIds(group.map(i => i.id))}>
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
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2"><UtensilsCrossed size={18} /> Walk-in meals to bill</h2>
        <p className="text-sm text-gray-500 mb-3">Guests who dined without a room booking. Generate one mess bill per guest, then settle.</p>
        {loading && <p className="text-sm text-gray-500">Loading…</p>}
        {!loading && messOnly.items.length === 0 && <p className="text-sm text-gray-500">No walk-in meals awaiting billing.</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {messOnly.items.map(g => {
            const bal = g.balance;
            return (
              <Card key={g.id} className="border-teal-300 dark:border-teal-900">
                <CardContent className="p-4 space-y-2">
                  <div className="flex justify-between items-start gap-2">
                    <p className="font-bold truncate">{g.guest_name}</p>
                    <p className="text-xl font-bold shrink-0">{formatCurrency(bal.balance_due)}</p>
                  </div>
                  <ChargeSplitBar segments={[
                    { label: 'Food', amount: bal.mess_bill_total, colorClass: 'bg-teal-500' },
                  ]} />
                  {bal.unpriced_items.length > 0 && <p className="text-xs text-amber-600">Needs pricing: {bal.unpriced_items.join(', ')}</p>}
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => setHistoryGuest({ id: g.id, name: g.guest_name })}>
                      <History size={14} />
                    </Button>
                    <Button size="sm" className="flex-1" disabled={generatingId === g.id || bal.mess_bill_total <= 0}
                      onClick={() => generate(g.id)}>
                      <UtensilsCrossed size={14} className="mr-1" />
                      {generatingId === g.id ? 'Working…' : 'Generate Mess Bill'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <BillPrintView invoiceIds={settleInvoiceIds}
        onClose={() => setSettleInvoiceIds(null)}
        allowPayments onPaymentsChanged={refresh} />

      <OrderHistoryDialog
        open={historyGuest !== null} onOpenChange={open => { if (!open) setHistoryGuest(null); }}
        guestId={historyGuest?.id} personName={historyGuest?.name}
      />
    </div>
  );
}
