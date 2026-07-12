import { useCallback, useEffect, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { toast } from 'sonner';
import { BedDouble, Receipt, Trash2, UtensilsCrossed } from 'lucide-react';
import { BillPrintView } from '@/components/BillPrint';
import { formatCurrency } from '@/lib/currency';

// The one checkout surface for the whole app: checking a guest out always
// means reviewing and generating their bill(s) here - there is no
// status-flip-only checkout anywhere (the backend endpoint for that was
// removed). Opened from Clerk Desk, the Bookings dashboard/list, and the
// room panel.

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

interface Charge { id: number; head: string; amount: number; is_mess_charge: boolean; invoiced: boolean; }

type BillTypeSel = ('room' | 'mess')[];

// Standard charge heads from the paper draft bill, split by which bill they
// land on. "Custom…" always appears too, for anything not on the list.
const ROOM_CHARGE_HEADS = ['Dhobi', 'Allied Charges', 'Breakage', 'Dental Kit'];
const MESS_CHARGE_HEADS = ['Extra Messing', 'Sui Gas Charges on Messing'];
const CUSTOM_HEAD = '__custom__';

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

function ChargePanel({
  title, accent, presetHeads, isMess, head, setHead, customLabel, setCustomLabel, amount, setAmount, onAdd, charges, onDelete,
}: {
  title: string; accent: string; presetHeads: string[]; isMess: boolean;
  head: string; setHead: (v: string) => void;
  customLabel: string; setCustomLabel: (v: string) => void;
  amount: string; setAmount: (v: string) => void;
  onAdd: () => void; charges: Charge[]; onDelete: (id: number) => void;
}) {
  return (
    <div className={`flex-1 rounded-lg border p-3 space-y-2 min-w-0 ${accent}`}>
      <p className="text-sm font-medium">{title}</p>
      <select className="w-full h-9 rounded-md border border-input bg-background px-2 text-xs" value={head} onChange={e => setHead(e.target.value)}>
        {presetHeads.map(h => <option key={h} value={h}>{h}</option>)}
        <option value={CUSTOM_HEAD}>Custom…</option>
      </select>
      {head === CUSTOM_HEAD && (
        <Input placeholder="Charge description" className="h-9 text-xs" value={customLabel} onChange={e => setCustomLabel(e.target.value)} />
      )}
      <div className="flex gap-1.5">
        <Input type="number" min={1} placeholder="Rs" className="flex-1 h-9 text-xs" value={amount} onChange={e => setAmount(e.target.value)} />
        <Button size="sm" className="h-9" onClick={onAdd}>Add</Button>
      </div>
      {charges.filter(c => c.is_mess_charge === isMess && !c.invoiced).map(c => (
        <div key={c.id} className="flex items-center justify-between text-xs">
          <span className="truncate">{c.head}</span>
          <span className="flex items-center gap-1 shrink-0">
            <span className="font-mono">{formatCurrency(c.amount)}</span>
            <button type="button" className="text-red-400 hover:text-red-600" onClick={() => onDelete(c.id)}><Trash2 size={13} /></button>
          </span>
        </div>
      ))}
    </div>
  );
}

export function CheckoutSheet({ guest, onOpenChange, onDone }: {
  guest: CheckoutGuest | null;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}) {
  const [balance, setBalance] = useState<RunningBalance | null>(null);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [genRoom, setGenRoom] = useState(true);
  const [genMess, setGenMess] = useState(true);
  const [checkingOut, setCheckingOut] = useState(false);
  const [printInvoiceIds, setPrintInvoiceIds] = useState<number[] | null>(null);
  const [roomChargeHead, setRoomChargeHead] = useState(ROOM_CHARGE_HEADS[0]);
  const [roomChargeCustom, setRoomChargeCustom] = useState('');
  const [roomChargeAmount, setRoomChargeAmount] = useState('');
  const [messChargeHead, setMessChargeHead] = useState(MESS_CHARGE_HEADS[0]);
  const [messChargeCustom, setMessChargeCustom] = useState('');
  const [messChargeAmount, setMessChargeAmount] = useState('');

  const guestId = guest?.id;

  const fetchBalance = useCallback(async (initial = false) => {
    if (!guestId) return;
    try {
      const [balRes, chargesRes] = await Promise.all([
        api.get(`/billing/bookings/${guestId}/running-balance`),
        api.get(`/billing/bookings/${guestId}/charges`),
      ]);
      setBalance(balRes.data);
      setCharges(chargesRes.data);
      if (initial) {
        setGenRoom(!balRes.data.room_billed);
        setGenMess(!balRes.data.mess_billed);
      }
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to load the guest\'s balance')); }
  }, [guestId]);

  useEffect(() => {
    queueMicrotask(() => {
      if (!guestId) { setBalance(null); setCharges([]); return; }
      setBalance(null);
      setRoomChargeAmount(''); setRoomChargeCustom('');
      setMessChargeAmount(''); setMessChargeCustom('');
      fetchBalance(true);
    });
  }, [guestId, fetchBalance]);

  const handleCheckout = async (types: BillTypeSel) => {
    if (!guest || checkingOut) return; // guard against double-clicks racing two checkouts
    if (types.length === 0) { toast.info('Both bills are already generated for this guest'); return; }
    setCheckingOut(true);
    try {
      const res = await api.post(`/billing/bookings/${guest.id}/instant-checkout`, { bill_types: types });
      const invoices: { id: number; bill_type: string }[] = res.data.invoices;
      setPrintInvoiceIds(invoices.map(i => i.id));
      toast.success(`${guest.guest_name} — ${invoices.map(i => i.bill_type).join(' & ')} bill generated`);
      if (res.data.late_checkout_fee > 0) toast.info(`Late checkout fee ${formatCurrency(res.data.late_checkout_fee)} added to the room bill`);
      if (res.data.unpriced_items?.length) toast.warning(`Not billed (needs pricing): ${res.data.unpriced_items.join(', ')}`);
      await fetchBalance();
      onDone?.();
      // Close the sheet only once nothing is left to bill; otherwise keep it
      // open (now showing the just-billed type locked) so staff can finish
      // the deferred one in the same sitting, or leave and return later.
      const otherBilled = types.includes('room') ? balance?.mess_billed : balance?.room_billed;
      if (types.length === 2 || otherBilled) onOpenChange(false);
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to generate bill')); }
    finally { setCheckingOut(false); }
  };

  const handleAddCharge = async (isMess: boolean) => {
    if (!guest) return;
    const head = isMess ? messChargeHead : roomChargeHead;
    const customLabel = (isMess ? messChargeCustom : roomChargeCustom).trim();
    const label = head === CUSTOM_HEAD ? customLabel : head;
    const amount = Number(isMess ? messChargeAmount : roomChargeAmount);
    if (!label) { toast.error('Enter a charge description'); return; }
    if (!amount || amount <= 0) { toast.error('Enter a charge amount'); return; }
    try {
      await api.post(`/billing/bookings/${guest.id}/charges`, { head: label, amount, is_mess_charge: isMess });
      toast.success(`${label} — ${formatCurrency(amount)} added to the ${isMess ? 'food' : 'room'} bill`);
      if (isMess) { setMessChargeAmount(''); setMessChargeCustom(''); }
      else { setRoomChargeAmount(''); setRoomChargeCustom(''); }
      fetchBalance();
      onDone?.();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to add charge')); }
  };

  const handleDeleteCharge = async (chargeId: number) => {
    try {
      await api.delete(`/billing/charges/${chargeId}`);
      toast.success('Charge removed');
      fetchBalance();
      onDone?.();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to remove charge')); }
  };

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
                    <div className="flex gap-3 flex-col sm:flex-row">
                      <BillBox title="Room Bill" icon={BedDouble} items={balance.room_items}
                        total={balance.room_bill_total} billed={balance.room_billed} accent="border-purple-300 dark:border-purple-800" />
                      <BillBox title="Food Bill" icon={UtensilsCrossed} items={balance.mess_items}
                        total={balance.mess_bill_total} billed={balance.mess_billed} accent="border-orange-300 dark:border-orange-800" />
                    </div>
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

                <div className="flex gap-3 flex-col sm:flex-row">
                  <ChargePanel title="Add room charge" accent="border-purple-200 dark:border-purple-900"
                    presetHeads={ROOM_CHARGE_HEADS} isMess={false}
                    head={roomChargeHead} setHead={setRoomChargeHead}
                    customLabel={roomChargeCustom} setCustomLabel={setRoomChargeCustom}
                    amount={roomChargeAmount} setAmount={setRoomChargeAmount}
                    onAdd={() => handleAddCharge(false)} charges={charges} onDelete={handleDeleteCharge} />
                  <ChargePanel title="Add food charge" accent="border-orange-200 dark:border-orange-900"
                    presetHeads={MESS_CHARGE_HEADS} isMess={true}
                    head={messChargeHead} setHead={setMessChargeHead}
                    customLabel={messChargeCustom} setCustomLabel={setMessChargeCustom}
                    amount={messChargeAmount} setAmount={setMessChargeAmount}
                    onAdd={() => handleAddCharge(true)} charges={charges} onDelete={handleDeleteCharge} />
                </div>

                <div className="rounded-lg border p-3 space-y-2">
                  <p className="text-sm font-medium">Generate bill(s)</p>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={balance?.room_billed ? true : genRoom}
                      disabled={!!balance?.room_billed} onChange={e => setGenRoom(e.target.checked)} />
                    Room Bill {balance?.room_billed && <span className="text-xs text-gray-400">(already billed)</span>}
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={balance?.mess_billed ? true : genMess}
                      disabled={!!balance?.mess_billed} onChange={e => setGenMess(e.target.checked)} />
                    Food Bill {balance?.mess_billed && <span className="text-xs text-gray-400">(already billed)</span>}
                  </label>
                  <Button className="w-full" disabled={checkingOut || !balance || (!genRoom && !genMess)}
                    onClick={() => {
                      const types: BillTypeSel = [];
                      if (genRoom && !balance?.room_billed) types.push('room');
                      if (genMess && !balance?.mess_billed) types.push('mess');
                      handleCheckout(types);
                    }}>
                    <Receipt size={15} className="mr-1.5" />
                    {checkingOut ? 'Working…'
                      : guest.status === 'checked_in' && genRoom && genMess ? 'Checkout — Generate Both Bills'
                      : genRoom && genMess ? 'Generate Both Bills'
                      : genRoom ? (guest.status === 'checked_in' ? 'Checkout — Generate Room Bill' : 'Generate Room Bill')
                      : genMess ? (guest.status === 'checked_in' ? 'Checkout — Generate Food Bill' : 'Generate Food Bill')
                      : 'Select a bill to generate'}
                  </Button>
                  {guest.status === 'checked_in' && (
                    <p className="text-xs text-gray-500">Generating a bill checks the guest out and sends the room to the housekeeping queue.</p>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <BillPrintView invoiceIds={printInvoiceIds} onClose={() => setPrintInvoiceIds(null)}
        allowPayments onPaymentsChanged={() => { fetchBalance(); onDone?.(); }} />
    </>
  );
}
