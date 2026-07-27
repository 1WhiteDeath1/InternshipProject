import { useCallback, useEffect, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import { ROOM_CHARGE_HEADS, MESS_CHARGE_HEADS, CUSTOM_CHARGE_HEAD, type BookingCharge } from '@/pages/bookings/shared';

/** Where charges get logged as a guest incurs them (Clerk for room charges via
    the Billing page's quick action, Kitchen/Mess Staff for mess charges) - a
    running tally only, no invoice or checkout action here. The Clerk turns
    this into a bill later. */
export function GuestChargePanel({ bookingId, isMess, title, onChanged, onTotalsChange }: {
  bookingId: number; isMess: boolean; title?: string; onChanged?: () => void; onTotalsChange?: (total: number) => void;
}) {
  const presetHeads = isMess ? MESS_CHARGE_HEADS : ROOM_CHARGE_HEADS;
  const [charges, setCharges] = useState<BookingCharge[]>([]);
  const [loading, setLoading] = useState(true);
  const [head, setHead] = useState(presetHeads[0]);
  const [customLabel, setCustomLabel] = useState('');
  const [amount, setAmount] = useState('');

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
    try {
      await api.post(`/billing/bookings/${bookingId}/charges`, { head: label, amount: amt, is_mess_charge: isMess });
      toast.success(`${label} — ${formatCurrency(amt)} logged`);
      setAmount(''); setCustomLabel('');
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
      {loading && <p className="text-xs text-gray-400">Loading…</p>}
      {!loading && live.length === 0 && <p className="text-xs text-gray-400">No charges logged yet</p>}
      {!loading && live.map(c => (
        <div key={c.id} className="flex items-center justify-between text-sm">
          <span className="truncate">{c.head}</span>
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
      <div className="flex gap-1.5">
        <Input type="number" min={1} placeholder="Rs" className="flex-1 h-9 text-xs" value={amount} onChange={e => setAmount(e.target.value)} />
        <Button size="sm" className="h-9" onClick={handleAdd}>Add</Button>
      </div>
    </div>
  );
}
