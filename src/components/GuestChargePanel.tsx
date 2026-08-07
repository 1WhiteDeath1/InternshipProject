import { useCallback, useEffect, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import { ROOM_CHARGE_HEADS, MESS_CHARGE_HEADS, CUSTOM_CHARGE_HEAD, type BookingCharge } from '@/pages/bookings/shared';

/** Where charges get logged as a guest incurs them (Clerk for room charges via
    the Billing page's quick action) - a running tally only, no invoice or
    checkout action here. The Clerk turns this into a bill later. Mess
    charges (Extra Messing/Sui Gas) are no longer logged this way - they're
    computed automatically at checkout from what was actually ordered (see
    backend/services/mess_charge_calc.py) - so isMess mode only ever offers
    "Custom..." for a genuinely separate ad-hoc mess charge. */
export function GuestChargePanel({ bookingId, isMess, title, onChanged, onTotalsChange }: {
  bookingId: number; isMess: boolean; title?: string; onChanged?: () => void; onTotalsChange?: (total: number) => void;
}) {
  const presetHeads = isMess ? MESS_CHARGE_HEADS : ROOM_CHARGE_HEADS;
  const [charges, setCharges] = useState<BookingCharge[]>([]);
  const [loading, setLoading] = useState(true);
  const [head, setHead] = useState(presetHeads[0] ?? CUSTOM_CHARGE_HEAD);
  const [customLabel, setCustomLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  const fetchCharges = useCallback(async () => {
    try { const res = await api.get(`/billing/bookings/${bookingId}/charges`); setCharges(res.data); }
    catch { toast.error('Failed to load charges'); }
  }, [bookingId]);

  useEffect(() => { queueMicrotask(() => { setLoading(true); fetchCharges().finally(() => setLoading(false)); }); }, [fetchCharges]);

  const handleAdd = async () => {
    const label = head === CUSTOM_CHARGE_HEAD ? customLabel.trim() : head;
    const amt = Number(amount);
    if (!label) { toast.error('Enter a charge description'); return; }
    if (!amt || amt <= 0) { toast.error('Enter a charge amount'); return; }
    if (label === 'Allied Charges' && reason.trim().length < 3) { toast.error('A reason (at least 3 characters) is required for Allied Charges'); return; }
    try {
      await api.post(`/billing/bookings/${bookingId}/charges`, { head: label, amount: amt, is_mess_charge: isMess, reason: reason.trim() || undefined });
      toast.success(`${label} — ${formatCurrency(amt)} logged`);
      setAmount(''); setCustomLabel(''); setReason('');
      fetchCharges();
      onChanged?.();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to add charge')); }
  };

  const handleDelete = async (id: number) => {
    try { await api.delete(`/billing/charges/${id}`); toast.success('Charge removed'); fetchCharges(); onChanged?.(); }
    catch (err) { toast.error(getErrorMessage(err, 'Failed to remove charge')); }
  };

  const live = charges.filter(c => c.is_mess_charge === isMess && !c.invoiced);
  const total = live.reduce((s, c) => s + c.amount, 0);

  useEffect(() => { onTotalsChange?.(total); }, [total, onTotalsChange]);

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <p className="text-sm font-semibold">{title || (isMess ? 'Mess Charges' : 'Room Charges')}</p>
      {loading && <p className="text-xs text-muted-foreground">Loading…</p>}
      {!loading && live.length === 0 && <p className="text-xs text-muted-foreground">No charges logged yet</p>}
      {!loading && live.map(c => (
        <div key={c.id} className="flex items-center justify-between text-sm" title={c.reason || undefined}>
          <span className="truncate">{c.head}{c.reason && <span className="text-muted-foreground"> — {c.reason}</span>}</span>
          <span className="flex items-center gap-1.5 shrink-0">
            <span className="font-mono">{formatCurrency(c.amount)}</span>
            <button type="button" className="text-red-400 hover:text-red-600" onClick={() => handleDelete(c.id)}><Trash2 size={13} /></button>
          </span>
        </div>
      ))}
      {live.length > 0 && (
        <div className="flex justify-between border-t pt-1.5 text-sm font-bold">
          <span>Running total</span><span className="font-mono">{formatCurrency(total)}</span>
        </div>
      )}

      <div className="flex gap-1.5 pt-1">
        <select className="h-9 rounded-md border border-input bg-background px-2 text-xs flex-1 min-w-0" value={head} onChange={e => setHead(e.target.value)}>
          {presetHeads.map(h => <option key={h} value={h}>{h}</option>)}
          <option value={CUSTOM_CHARGE_HEAD}>Custom…</option>
        </select>
      </div>
      {head === CUSTOM_CHARGE_HEAD && (
        <Input placeholder="Charge description" className="h-9 text-xs" value={customLabel} onChange={e => setCustomLabel(e.target.value)} />
      )}
      <Input placeholder={head === 'Allied Charges' ? 'Reason / Description (required)' : 'Reason / Description (optional)'} className="h-9 text-xs" value={reason} onChange={e => setReason(e.target.value)} />
      <div className="flex gap-1.5">
        <Input type="number" min={1} placeholder="Rs" className="flex-1 h-9 text-xs" value={amount} onChange={e => setAmount(e.target.value.replace(/^0+(?=\d)/, ''))} />
        <Button size="sm" className="h-9" onClick={handleAdd}>Add</Button>
      </div>
    </div>
  );
}
