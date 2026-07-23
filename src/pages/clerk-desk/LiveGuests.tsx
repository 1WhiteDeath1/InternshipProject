import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Receipt } from 'lucide-react';
import { CheckoutSheet, type CheckoutGuest } from '@/components/CheckoutSheet';
import { ChargeSplitBar } from '@/components/ChargeSplitBar';
import { BillStatusBadge } from '@/components/BillStatusBadge';
import { formatCurrency } from '@/lib/currency';
import { useClerkDesk } from './context';

// Checked-in room guests, folio still accruing. Informational + the entry
// point to Checkout & Bill; nothing is billed until the guest actually leaves.
export default function LiveGuests() {
  const { desk, loading, refresh } = useClerkDesk();
  const [checkoutGuest, setCheckoutGuest] = useState<CheckoutGuest | null>(null);
  const guests = desk.items.filter(g => g.status === 'checked_in');

  return (
    <div>
      <p className="text-sm text-gray-500 mb-3">In-house guests with a live, accruing bill. Charges are added as the stay goes on; nothing is finalised until checkout.</p>
      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {!loading && guests.length === 0 && <p className="text-sm text-gray-500">No checked-in guests right now.</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {guests.map(g => {
          const bal = g.balance;
          return (
            <Card key={g.id} className="cursor-pointer hover:shadow-md transition-all" onClick={() => setCheckoutGuest(g)}>
              <CardContent className="p-4 space-y-2">
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <p className="font-bold truncate">{g.rank ? `${g.rank} ` : ''}{g.guest_name}</p>
                    <p className="text-xs text-gray-500">Room {g.room_number}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xl font-bold">{formatCurrency(bal.balance_due)}</p>
                    <BillStatusBadge input={{ accruing: true }} />
                  </div>
                </div>
                <ChargeSplitBar segments={[
                  { label: bal.room_billed ? 'Room (billed)' : 'Room', amount: bal.room_billed ? 0 : bal.room_bill_total, colorClass: 'bg-purple-500' },
                  { label: bal.mess_billed ? 'Food (billed)' : 'Food', amount: bal.mess_billed ? 0 : bal.mess_bill_total, colorClass: 'bg-orange-500' },
                ]} />
                {bal.unpriced_items.length > 0 && <p className="text-xs text-amber-600">Needs pricing: {bal.unpriced_items.join(', ')}</p>}
                <Button size="sm" className="w-full" onClick={e => { e.stopPropagation(); setCheckoutGuest(g); }}>
                  <Receipt size={14} className="mr-1" /> Checkout &amp; Bill
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <CheckoutSheet guest={checkoutGuest}
        onOpenChange={v => { if (!v) setCheckoutGuest(null); }}
        onDone={refresh} />
    </div>
  );
}
