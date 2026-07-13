import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';
import { LayoutGrid, DoorOpen, IdCard, Receipt, Wallet, BedDouble, UtensilsCrossed } from 'lucide-react';
import { CheckoutSheet, type CheckoutGuest, type RunningBalance } from '@/components/CheckoutSheet';
import { BillPrintView } from '@/components/BillPrint';
import { formatCurrency } from '@/lib/currency';

interface DeskGuest extends CheckoutGuest {
  booking_reference: string;
  balance: RunningBalance;
}

interface UnsettledInvoice {
  id: number;
  invoice_number: string;
  bill_type: string;
  total_amount: number;
  amount_paid: number;
  balance_due: number;
  booking_id: number | null;
  guest_name: string | null;
  rank: string | null;
  room_number: string | null;
  issue_date: string;
  checking_out_now: boolean;
}

interface Member {
  id: number;
  full_name: string;
  service_number: string;
}

export default function ClerkDesk() {
  const [guests, setGuests] = useState<DeskGuest[]>([]);
  const [unsettled, setUnsettled] = useState<UnsettledInvoice[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkoutGuest, setCheckoutGuest] = useState<CheckoutGuest | null>(null);
  const [settleInvoiceIds, setSettleInvoiceIds] = useState<number[] | null>(null);
  const navigate = useNavigate();

  const fetchAll = useCallback(async () => {
    try {
      // /billing/desk is the whole worklist in one request: checked-in
      // guests (HRA residents excluded - they settle via the monthly Mess
      // Bill), every checked-out booking still missing a bill, and every
      // generated-but-unpaid invoice (guests checking out today first).
      const [deskRes, membersRes] = await Promise.all([
        api.get('/billing/desk'),
        api.get('/members?status=active&page_size=100'),
      ]);
      setGuests(deskRes.data.items);
      setUnsettled(deskRes.data.unsettled_invoices || []);
      setMembers(membersRes.data.items);
    } catch { toast.error('Failed to load Clerk Desk'); }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      setLoading(true);
      fetchAll().finally(() => setLoading(false));
    });
  }, [fetchAll]);

  // One settle row per guest, so their room + mess bills are collected in a
  // single Pay action. Insertion order preserves the backend's priority:
  // guests checking out right now come first.
  const settleGroups = useMemo(() => {
    const groups = new Map<string, UnsettledInvoice[]>();
    for (const inv of unsettled) {
      const key = String(inv.booking_id ?? `inv-${inv.id}`);
      const g = groups.get(key);
      if (g) g.push(inv); else groups.set(key, [inv]);
    }
    return [...groups.values()];
  }, [unsettled]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2"><LayoutGrid size={24} /> Clerk Desk</h1>

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
              return (
                <Card key={first.id} className={first.checking_out_now ? 'border-emerald-400 ring-1 ring-emerald-200 dark:ring-emerald-900' : ''}>
                  <CardContent className="p-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold truncate">
                        {first.rank ? `${first.rank} ` : ''}{first.guest_name || '—'}
                        {first.checking_out_now && (
                          <span className="ml-2 text-[10px] font-medium uppercase tracking-wide text-emerald-700 bg-emerald-50 dark:bg-emerald-950 dark:text-emerald-300 rounded px-1.5 py-0.5 align-middle">
                            Checking out now
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-gray-500">Room {first.room_number || '—'} · {group.map(i => i.invoice_number).join(' · ')}</p>
                    </div>
                    <div className="flex gap-1.5 text-xs">
                      {group.map(i => (
                        <span key={i.id} className={`flex items-center gap-1 rounded px-2 py-1 ${i.bill_type === 'room'
                          ? 'bg-purple-50 dark:bg-purple-950 text-purple-800 dark:text-purple-200'
                          : 'bg-orange-50 dark:bg-orange-950 text-orange-800 dark:text-orange-200'}`}>
                          {i.bill_type === 'room' ? <BedDouble size={12} /> : <UtensilsCrossed size={12} />}
                          {formatCurrency(i.balance_due)}
                          {i.amount_paid > 0 && <span className="opacity-60">left</span>}
                        </span>
                      ))}
                    </div>
                    <p className="text-lg font-bold font-mono">{formatCurrency(balance)}</p>
                    <Button size="sm" onClick={() => setSettleInvoiceIds(group.map(i => i.id))}>
                      <Wallet size={14} className="mr-1" /> Settle & Print
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2"><DoorOpen size={18} /> Guests</h2>
        {loading && <p className="text-sm text-gray-500">Loading…</p>}
        {!loading && guests.length === 0 && <p className="text-sm text-gray-500">No checked-in guests</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {guests.map(g => {
            const bal = g.balance;
            return (
              <Card key={g.id} className="cursor-pointer hover:shadow-md transition-all" onClick={() => setCheckoutGuest(g)}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-bold">{g.rank ? `${g.rank} ` : ''}{g.guest_name}</p>
                      <p className="text-xs text-gray-500">Room {g.room_number}</p>
                      {g.status === 'checked_out' && <p className="text-xs text-amber-600">Checked out — bill pending</p>}
                    </div>
                    <div className="text-right">
                      <p className="text-xl font-bold">{formatCurrency(bal.balance_due)}</p>
                    </div>
                  </div>
                  <div className="flex gap-2 text-xs">
                    <span className="flex-1 rounded bg-purple-50 dark:bg-purple-950 text-purple-800 dark:text-purple-200 px-2 py-1">Room {bal.room_billed ? 'billed' : formatCurrency(bal.room_bill_total)}</span>
                    <span className="flex-1 rounded bg-orange-50 dark:bg-orange-950 text-orange-800 dark:text-orange-200 px-2 py-1">Food {bal.mess_billed ? 'billed' : formatCurrency(bal.mess_bill_total)}</span>
                  </div>
                  {bal.unpriced_items.length > 0 && <p className="text-xs text-amber-600">Needs pricing: {bal.unpriced_items.join(', ')}</p>}
                  <Button size="sm" className="w-full" onClick={e => { e.stopPropagation(); setCheckoutGuest(g); }}>
                    <Receipt size={14} className="mr-1" />
                    {g.status === 'checked_out' ? 'Generate Remaining Bill' : 'Checkout & Bill'}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2"><IdCard size={18} /> Members</h2>
        <p className="text-xs text-gray-500 mb-2">Members and HRA residents settle through the monthly Mess Bill, not checkout.</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {members.map(m => (
            <Card key={m.id} className="cursor-pointer hover:shadow-md transition-all" onClick={() => navigate('/mess-billing')}>
              <CardContent className="p-4 text-center">
                <IdCard size={20} className="mx-auto mb-2 opacity-60" />
                <p className="font-medium text-sm truncate">{m.full_name}</p>
                <p className="text-xs text-gray-500">{m.service_number}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <CheckoutSheet guest={checkoutGuest}
        onOpenChange={v => { if (!v) setCheckoutGuest(null); }}
        onDone={fetchAll} />

      <BillPrintView invoiceIds={settleInvoiceIds} onClose={() => setSettleInvoiceIds(null)}
        allowPayments onPaymentsChanged={fetchAll} />
    </div>
  );
}
