import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { selectClass, ROOM_CHARGE_HEADS, MESS_CHARGE_HEADS, CUSTOM_CHARGE_HEAD, type Room } from '@/pages/bookings/shared';
import { formatCurrency } from '@/lib/currency';

interface QuickChargeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Global "+ Log Charge" shortcut - search any occupied room or guest by
    name, log an incidental against their live folio, done. Reuses the same
    POST /billing/bookings/{id}/charges call GuestChargePanel makes. */
export function QuickChargeModal({ open, onOpenChange }: QuickChargeModalProps) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Room | null>(null);
  const [isMess, setIsMess] = useState(false);
  const [head, setHead] = useState(ROOM_CHARGE_HEADS[0]);
  const [customLabel, setCustomLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setSearch(''); setSelected(null); setIsMess(false);
    setHead(ROOM_CHARGE_HEADS[0]); setCustomLabel(''); setAmount(''); setReason('');
  };

  useEffect(() => {
    if (!open) return;
    queueMicrotask(async () => {
      setLoading(true);
      try { const res = await api.get('/bookings/rooms'); setRooms(res.data.items.filter((r: Room) => r.current_booking_id)); }
      catch { toast.error('Failed to load occupied rooms'); }
      finally { setLoading(false); }
    });
  }, [open]);

  const q = search.trim().toLowerCase();
  const matches = q.length < 1 ? [] : rooms.filter(r =>
    r.room_number.toLowerCase().includes(q) || (r.current_guest || '').toLowerCase().includes(q)).slice(0, 8);

  const presetHeads = isMess ? MESS_CHARGE_HEADS : ROOM_CHARGE_HEADS;

  const handleSave = async () => {
    if (!selected?.current_booking_id) return;
    const label = head === CUSTOM_CHARGE_HEAD ? customLabel.trim() : head;
    const amt = Number(amount);
    if (!label) { toast.error('Enter a charge description'); return; }
    if (!amt || amt <= 0) { toast.error('Enter a charge amount'); return; }
    if (label === 'Allied Charges' && reason.trim().length < 3) { toast.error('A reason (at least 3 characters) is required for Allied Charges'); return; }
    setSaving(true);
    try {
      await api.post(`/billing/bookings/${selected.current_booking_id}/charges`, { head: label, amount: amt, is_mess_charge: isMess, reason: reason.trim() || undefined });
      toast.success(`${label} — ${formatCurrency(amt)} logged for Room ${selected.room_number}`);
      onOpenChange(false);
      reset();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to log charge')); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={v => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Quick-Log Incidental Charge</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {!selected ? (
            <div>
              <Input placeholder="Search room or guest name…" value={search} onChange={e => setSearch(e.target.value)} autoFocus />
              {loading && <p className="text-xs text-muted-foreground mt-2">Loading occupied rooms…</p>}
              {!loading && q.length > 0 && (
                <div className="mt-2 max-h-56 overflow-y-auto rounded-md border divide-y">
                  {matches.length === 0 && <p className="text-xs text-muted-foreground p-2">No matching occupied room or guest</p>}
                  {matches.map(r => (
                    <button key={r.id} type="button" className="w-full text-left px-3 py-2 hover:bg-accent"
                      onClick={() => setSelected(r)}>
                      <span className="font-medium">Room {r.room_number}</span>
                      <span className="text-muted-foreground text-xs"> — {r.current_guest}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                <span><span className="font-medium">Room {selected.room_number}</span> — {selected.current_guest}</span>
                <button type="button" className="text-xs text-blue-600 hover:underline" onClick={() => setSelected(null)}>Change</button>
              </div>

              <div className="flex rounded-md border overflow-hidden text-xs">
                {([[false, 'Room Charge'], [true, 'Mess Charge']] as const).map(([val, label]) => (
                  <button key={label} type="button"
                    className={`flex-1 py-1.5 ${isMess === val ? 'bg-primary text-primary-foreground font-medium' : 'bg-transparent text-muted-foreground hover:text-foreground'}`}
                    onClick={() => { setIsMess(val); setHead((val ? MESS_CHARGE_HEADS[0] : ROOM_CHARGE_HEADS[0]) ?? CUSTOM_CHARGE_HEAD); }}>
                    {label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <select className={selectClass} value={head} onChange={e => setHead(e.target.value)}>
                  {presetHeads.map(h => <option key={h} value={h}>{h}</option>)}
                  <option value={CUSTOM_CHARGE_HEAD}>Custom…</option>
                </select>
                <Input type="number" min={1} placeholder="Rs" value={amount} onChange={e => setAmount(e.target.value.replace(/^0+(?=\d)/, ''))} />
              </div>
              {head === CUSTOM_CHARGE_HEAD && (
                <Input placeholder="Charge description" value={customLabel} onChange={e => setCustomLabel(e.target.value)} />
              )}
              <Input placeholder={head === 'Allied Charges' ? 'Reason / Description (required)' : 'Reason / Description (optional)'} value={reason} onChange={e => setReason(e.target.value)} />

              <Button className="w-full" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Charge'}</Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
