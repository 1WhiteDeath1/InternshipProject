import { useCallback, useEffect, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { BedDouble, Receipt, UtensilsCrossed, CheckCircle2, Circle, ChevronRight, X, Plus } from 'lucide-react';
import { BillPrintView } from '@/components/BillPrint';
import { ChargeSplitBar } from '@/components/ChargeSplitBar';
import { formatCurrency } from '@/lib/currency';
import { ROOM_CHARGE_HEADS, MESS_CHARGE_HEADS, CUSTOM_CHARGE_HEAD, selectClass } from '@/pages/bookings/shared';

// The Clerk's checkout surface - the only place an invoice actually gets
// generated. Charges accrue elsewhere first (the Clerk's own global "+ Log
// Charge" quick action, or the Guest Mess Charges tab in Kitchen) as a guest
// incurs them; by the time a stay reaches here, the Clerk just reviews the
// accumulated total and generates one invoice.

export interface CheckoutGuest {
  id: number;
  guest_name: string;
  rank?: string | null;
  room_number?: string | null;
  status: string; // checked_in | checked_out (bill pending)
  source?: string; // walk_in | online - online pays the room charge in advance
}

interface BalanceItem {
  description: string;
  amount: number;
  // component_key: a computed rate line (rent/electricity/mess_total/gas_total/...)
  // - individually correctable. charge_id: an ad-hoc BookingCharge - removable.
  // Neither set: a fixed structural line (Extra Mattress/Late Checkout Fee).
  component_key: string | null;
  charge_id: number | null;
}

export interface RunningBalance {
  room_bill_total: number;
  mess_bill_total: number;
  mess_charge_amount: number; // computed "Extra Messing" total (sum of everything ordered)
  gas_charge_amount: number; // computed "Sui Gas Charges on Messing" (gas % of mess_charge_amount)
  room_items: BalanceItem[];
  mess_items: BalanceItem[];
  total: number;
  outstanding_invoices: number;
  balance_due: number;
  unpriced_items: string[];
  room_billed: boolean;
  mess_billed: boolean;
  advance_credit_applied: number;
  // Checkout-readiness sign-off - informational only, doesn't gate checkout.
  kitchen_finalized_at: string | null;
  kitchen_finalized_by_name: string | null;
  booking_finalized_at: string | null;
  booking_finalized_by_name: string | null;
}

function BillSummaryCard({ title, icon: Icon, total, billed, accent, onClick }: {
  title: string; icon: typeof BedDouble; total: number; billed: boolean; accent: string; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick}
      className={`flex-1 rounded-lg border-2 ${accent} p-3 min-w-0 text-left hover:brightness-95 dark:hover:brightness-125 transition`}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold flex items-center gap-1.5"><Icon size={15} /> {title}</p>
        <ChevronRight size={15} className="text-muted-foreground" />
      </div>
      {billed && <p className="text-xs text-emerald-600 mt-1">Already billed</p>}
      <p className="text-lg font-bold font-mono mt-1">{billed ? '—' : formatCurrency(total)}</p>
      {!billed && <p className="text-xs text-muted-foreground">Tap to review / correct</p>}
    </button>
  );
}

/** The editable line-item table for one side (Room or Food) of the bill -
    opened by tapping its summary card. Computed rate components (rent,
    electricity, Extra Messing, Sui Gas...) get an inline override input;
    ad-hoc BookingCharge rows (Dhobi, Breakage, a logged Extra Messing
    correction...) can be removed; structural lines (Extra Mattress, Late
    Checkout Fee) are read-only. "Add line" reuses the same
    POST /bookings/{id}/charges the global "+ Log Charge" action uses, so a
    charge added here shows up everywhere else too. */
function BillLineDialog({ open, onOpenChange, title, icon: Icon, items, isMess, bookingId, billed,
  overrideInputs, onOverrideInputsChange, reason, onReasonChange, requireReason, onChanged }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; icon: typeof BedDouble;
  items: BalanceItem[]; isMess: boolean; bookingId: number; billed: boolean;
  overrideInputs: Record<string, string>; onOverrideInputsChange: (next: Record<string, string>) => void;
  reason?: string; onReasonChange?: (v: string) => void; requireReason?: boolean;
  onChanged: () => void;
}) {
  const [addingLine, setAddingLine] = useState(false);
  const presetHeads = isMess ? MESS_CHARGE_HEADS : ROOM_CHARGE_HEADS;
  const [newHead, setNewHead] = useState(presetHeads[0] ?? CUSTOM_CHARGE_HEAD);
  const [newCustomLabel, setNewCustomLabel] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newReason, setNewReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);

  const dirtyKeys = Object.keys(overrideInputs).filter(k => {
    const original = items.find(i => i.component_key === k)?.amount;
    return original !== undefined && Number(overrideInputs[k]) !== original;
  });

  const handleAddLine = async () => {
    const label = newHead === CUSTOM_CHARGE_HEAD ? newCustomLabel.trim() : newHead;
    const amt = Number(newAmount);
    if (!label) { toast.error('Enter a charge description'); return; }
    if (!amt || amt <= 0) { toast.error('Enter a charge amount'); return; }
    if (label === 'Allied Charges' && newReason.trim().length < 3) { toast.error('A reason (at least 3 characters) is required for Allied Charges'); return; }
    setSaving(true);
    try {
      await api.post(`/bookings/${bookingId}/charges`, { head: label, amount: amt, is_mess_charge: isMess, reason: newReason.trim() || undefined });
      toast.success(`${label} — ${formatCurrency(amt)} added`);
      setAddingLine(false);
      setNewHead(presetHeads[0] ?? CUSTOM_CHARGE_HEAD);
      setNewCustomLabel(''); setNewAmount(''); setNewReason('');
      onChanged();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to add line')); }
    finally { setSaving(false); }
  };

  const handleRemove = async (chargeId: number) => {
    setRemovingId(chargeId);
    try { await api.delete(`/billing/charges/${chargeId}`); toast.success('Line removed'); onChanged(); }
    catch (err) { toast.error(getErrorMessage(err, 'Failed to remove line')); }
    finally { setRemovingId(null); }
  };

  const total = items.reduce((sum, it) => {
    if (it.component_key && overrideInputs[it.component_key] !== undefined) {
      const v = Number(overrideInputs[it.component_key]);
      return sum + (Number.isFinite(v) ? v : it.amount);
    }
    return sum + it.amount;
  }, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Icon size={17} /> {title}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {billed ? (
            <p className="text-sm text-emerald-600">Already billed — nothing left to correct here.</p>
          ) : (
            <>
              <Table>
                <TableHeader><TableRow><TableHead>Line</TableHead><TableHead className="text-right w-36">Amount (Rs)</TableHead><TableHead className="w-12" /></TableRow></TableHeader>
                <TableBody>
                  {items.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground text-sm py-4">Nothing yet</TableCell></TableRow>}
                  {items.map((it, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-sm">{it.description}</TableCell>
                      <TableCell className="text-right">
                        {it.component_key ? (
                          <Input type="number" min={0} className="h-8 text-right font-mono ml-auto"
                            value={overrideInputs[it.component_key] ?? String(it.amount)}
                            onChange={e => onOverrideInputsChange({ ...overrideInputs, [it.component_key as string]: e.target.value.replace(/^0+(?=\d)/, '') })} />
                        ) : (
                          <span className="font-mono text-sm">{formatCurrency(it.amount)}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {it.charge_id != null && (
                          <Button size="sm" variant="ghost" disabled={removingId === it.charge_id} onClick={() => handleRemove(it.charge_id as number)} title="Remove line">
                            <X size={14} className="text-red-500" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {requireReason && dirtyKeys.length > 0 && onReasonChange && (
                <div>
                  <Label className="text-xs">Reason for correction *</Label>
                  <Input placeholder="Required — why is this different?" value={reason || ''} onChange={e => onReasonChange(e.target.value)}
                    className={!reason?.trim() ? 'border-red-400' : ''} />
                </div>
              )}

              <div className="flex justify-between font-bold text-sm border-t pt-2">
                <span>Total</span><span className="font-mono">{formatCurrency(total)}</span>
              </div>

              {!addingLine ? (
                <button type="button" className="text-sm text-blue-600 hover:underline flex items-center gap-1" onClick={() => setAddingLine(true)}>
                  <Plus size={14} /> Add a line
                </button>
              ) : (
                <div className="rounded-md border p-3 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <select className={selectClass} value={newHead} onChange={e => setNewHead(e.target.value)}>
                      {presetHeads.map(h => <option key={h} value={h}>{h}</option>)}
                      <option value={CUSTOM_CHARGE_HEAD}>Custom…</option>
                    </select>
                    <Input type="number" min={1} placeholder="Rs" value={newAmount} onChange={e => setNewAmount(e.target.value.replace(/^0+(?=\d)/, ''))} />
                  </div>
                  {newHead === CUSTOM_CHARGE_HEAD && (
                    <Input placeholder="Charge description" value={newCustomLabel} onChange={e => setNewCustomLabel(e.target.value)} />
                  )}
                  <Input placeholder={newHead === 'Allied Charges' ? 'Reason (required)' : 'Reason (optional)'} value={newReason} onChange={e => setNewReason(e.target.value)} />
                  <div className="flex gap-2">
                    <Button size="sm" className="flex-1" onClick={handleAddLine} disabled={saving}>{saving ? 'Saving…' : 'Save Line'}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setAddingLine(false)}>Cancel</Button>
                  </div>
                </div>
              )}
            </>
          )}
          <Button variant="outline" className="w-full" onClick={() => onOpenChange(false)}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
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

  const [roomDialogOpen, setRoomDialogOpen] = useState(false);
  const [messDialogOpen, setMessDialogOpen] = useState(false);
  const [roomOverrideInputs, setRoomOverrideInputs] = useState<Record<string, string>>({});
  const [messOverrideInputs, setMessOverrideInputs] = useState<Record<string, string>>({});
  const [roomOverrideReason, setRoomOverrideReason] = useState('');

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
      setRoomOverrideInputs({}); setMessOverrideInputs({}); setRoomOverrideReason('');
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

  // Only components the Clerk actually changed (differs from the computed
  // baseline) get sent as an override - untouched lines stay exactly as
  // _gather_unbilled_items would compute them anyway.
  const dirtyRoomOverrides = (): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const key of Object.keys(roomOverrideInputs)) {
      const original = balance?.room_items.find(i => i.component_key === key)?.amount;
      const v = Number(roomOverrideInputs[key]);
      if (original !== undefined && Number.isFinite(v) && v !== original) out[key] = v;
    }
    return out;
  };
  const roomOverridesToSend = dirtyRoomOverrides();
  const roomOverrideDirty = Object.keys(roomOverridesToSend).length > 0;

  const handleGenerateInvoice = async () => {
    if (!guest || checkingOut) return; // guard against double-clicks racing two checkouts
    if (balance?.room_billed && balance?.mess_billed) { await openExistingInvoices(); return; }
    if (roomOverrideDirty && !roomOverrideReason.trim()) {
      toast.error('A reason is required to override a room charge');
      return;
    }
    setCheckingOut(true);
    try {
      const messOverride = balance && !balance.mess_billed
        ? Number(messOverrideInputs['mess_total'] ?? balance.mess_charge_amount) : undefined;
      const gasOverride = balance && !balance.mess_billed
        ? Number(messOverrideInputs['gas_total'] ?? balance.gas_charge_amount) : undefined;
      const body = {
        ...(balance?.mess_billed ? {} : { mess_charge_override: messOverride ?? 0, gas_charge_override: gasOverride ?? 0 }),
        ...(!balance?.room_billed && roomOverrideDirty ? {
          room_component_overrides: roomOverridesToSend,
          room_override_reason: roomOverrideReason.trim(),
        } : {}),
      };
      const res = await api.post(`/billing/bookings/${guest.id}/instant-checkout`, body);
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
              {balance && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 px-1 mt-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    {balance.kitchen_finalized_by_name
                      ? <CheckCircle2 size={13} className="text-emerald-600" />
                      : <Circle size={13} />}
                    Kitchen{balance.kitchen_finalized_by_name ? `: finalized by ${balance.kitchen_finalized_by_name}` : ': not finalized'}
                  </span>
                  <span className="flex items-center gap-1">
                    {balance.booking_finalized_by_name
                      ? <CheckCircle2 size={13} className="text-emerald-600" />
                      : <Circle size={13} />}
                    Booking{balance.booking_finalized_by_name ? `: finalized by ${balance.booking_finalized_by_name}` : ': not finalized'}
                  </span>
                </div>
              )}
              <div className="space-y-4 mt-3 px-1">
                {balance ? (
                  <>
                    <ChargeSplitBar segments={[
                      { label: 'Room', amount: balance.room_bill_total, colorClass: 'bg-purple-500' },
                      { label: 'Food', amount: balance.mess_bill_total, colorClass: 'bg-orange-500' },
                    ]} />
                    <div className="flex gap-3 flex-col sm:flex-row">
                      <BillSummaryCard title="Room Bill" icon={BedDouble} total={balance.room_bill_total} billed={balance.room_billed}
                        accent="border-purple-300 dark:border-purple-800" onClick={() => setRoomDialogOpen(true)} />
                      <BillSummaryCard title="Food Bill" icon={UtensilsCrossed} total={balance.mess_bill_total} billed={balance.mess_billed}
                        accent="border-orange-300 dark:border-orange-800" onClick={() => setMessDialogOpen(true)} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Tap either card to see and correct its line items — room rent/electricity/etc are broken out individually, and Extra
                      Messing/Sui Gas are computed from everything ordered through the kitchen. Corrections take effect at checkout.
                    </p>

                    <div className="rounded-lg border p-3 text-sm space-y-1">
                      {balance.advance_credit_applied > 0 && (
                        <div className="flex justify-between text-xs text-emerald-600 dark:text-emerald-400">
                          <span>Online booking — advance already paid, applied to the room bill</span>
                          <span className="font-mono">− {formatCurrency(balance.advance_credit_applied)}</span>
                        </div>
                      )}
                      {balance.outstanding_invoices > 0 && (
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>Unpaid on bills already generated</span>
                          <span className="font-mono">{formatCurrency(balance.outstanding_invoices)}</span>
                        </div>
                      )}
                      <div className="flex justify-between font-bold"><span>Balance due at checkout</span><span className="font-mono">{formatCurrency(balance.balance_due)}</span></div>
                      {balance.unpriced_items.length > 0 && <p className="text-xs text-amber-600">Needs pricing first: {balance.unpriced_items.join(', ')}</p>}
                    </div>
                  </>
                ) : <p className="text-sm text-muted-foreground">Loading balance…</p>}

                <div className="rounded-lg border p-3 space-y-2">
                  <Button className="w-full" disabled={checkingOut || !balance || (roomOverrideDirty && !roomOverrideReason.trim())} onClick={handleGenerateInvoice}>
                    <Receipt size={15} className="mr-1.5" />
                    {checkingOut ? 'Working…' : alreadyFullyBilled ? 'View Invoice' : 'Checkout — Generate Invoice'}
                  </Button>
                  {!alreadyFullyBilled && (
                    <p className="text-xs text-muted-foreground">Generating the invoice checks the guest out and sends the room to the housekeeping queue.</p>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {guest && balance && (
        <>
          <BillLineDialog
            open={roomDialogOpen} onOpenChange={setRoomDialogOpen} title="Room Bill" icon={BedDouble}
            items={balance.room_items} isMess={false} bookingId={guest.id} billed={balance.room_billed}
            overrideInputs={roomOverrideInputs} onOverrideInputsChange={setRoomOverrideInputs}
            reason={roomOverrideReason} onReasonChange={setRoomOverrideReason} requireReason
            onChanged={fetchBalance}
          />
          <BillLineDialog
            open={messDialogOpen} onOpenChange={setMessDialogOpen} title="Food Bill" icon={UtensilsCrossed}
            items={balance.mess_items} isMess bookingId={guest.id} billed={balance.mess_billed}
            overrideInputs={messOverrideInputs} onOverrideInputsChange={setMessOverrideInputs}
            onChanged={fetchBalance}
          />
        </>
      )}

      <BillPrintView invoiceIds={printInvoiceIds} bookingId={printBookingId ?? undefined}
        onClose={() => { setPrintInvoiceIds(null); setPrintBookingId(null); }}
        allowPayments onPaymentsChanged={() => { fetchBalance(); onDone?.(); }} />
    </>
  );
}
