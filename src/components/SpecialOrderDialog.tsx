import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/currency';

/** A one-off order for a single person, off the routine batch menu - what the
    system used to call "à la carte". Stored the same way (KitchenOrder with
    is_ala_carte), just named the way the mess actually speaks and reachable
    from the same places the routine flow is, rather than its own screen.

    The SLA timer keeps its own default and is tucked behind "Advanced" - it
    matters (a special order is individual and urgent) but it should never be
    a field someone has to fill in to place one. */
export interface SpecialOrderPreset { consumer_kind: 'member' | 'guest'; consumer_id: number }

interface MenuItem { id: number; name: string; price: number; is_active: boolean }
interface MemberOption { id: number; full_name: string; service_number: string }
interface BookingOption { id: number; guest_name: string; room_number: string | null }

const emptyForm = { menu_item_id: 0, consumer_kind: 'guest' as 'member' | 'guest', consumer_id: 0, quantity: 1, sla_minutes: 45 };

export function SpecialOrderDialog({ open, onOpenChange, onCreated, preset }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  preset?: SpecialOrderPreset | null;
}) {
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [bookings, setBookings] = useState<BookingOption[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [advanced, setAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      setForm({ ...emptyForm, ...(preset ?? {}) });
      setAdvanced(false);
      api.get('/kitchen/menu').then(r => setMenuItems(r.data)).catch(() => toast.error('Failed to load the menu'));
      api.get('/members?status=active&page_size=100').then(r => setMembers(r.data.items)).catch(() => { /* picker is secondary */ });
      // Kitchen NCO has no bookings permission - this kitchen:view-gated
      // slice is what populates the guest picker for the role that uses it.
      api.get('/kitchen/checked-in-guests').then(r => setBookings(r.data)).catch(() => { /* picker is secondary */ });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, preset?.consumer_kind, preset?.consumer_id]);

  const handleCreate = async () => {
    if (!form.menu_item_id) { toast.error('Pick what they want'); return; }
    if (!form.consumer_id) { toast.error(`Pick a ${form.consumer_kind}`); return; }
    setSaving(true);
    try {
      await api.post('/kitchen/orders', {
        menu_item_id: form.menu_item_id, quantity_ordered: form.quantity, is_ala_carte: true,
        member_id: form.consumer_kind === 'member' ? form.consumer_id : undefined,
        booking_id: form.consumer_kind === 'guest' ? form.consumer_id : undefined,
        sla_minutes: form.sla_minutes,
      });
      toast.success('Special order started');
      onOpenChange(false);
      onCreated();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to start the order')); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>New Special Order</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Something off the routine menu, for one person — it shows up on the Meals board tagged as a special order,
            with its own timer, and lands on their bill like any other item.
          </p>

          <div>
            <Label>What they want</Label>
            <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.menu_item_id} onChange={e => setForm({ ...form, menu_item_id: Number(e.target.value) })}>
              <option value="0">Select a dish</option>
              {menuItems.filter(m => m.is_active).map(m => (
                <option key={m.id} value={m.id}>{m.name} — {formatCurrency(m.price)}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>For</Label>
              <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.consumer_kind}
                onChange={e => setForm({ ...form, consumer_kind: e.target.value as 'member' | 'guest', consumer_id: 0 })}>
                <option value="guest">Guest (checked in)</option>
                <option value="member">Member</option>
              </select>
            </div>
            <div>
              <Label>{form.consumer_kind === 'member' ? 'Member' : 'Guest'}</Label>
              <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.consumer_id} onChange={e => setForm({ ...form, consumer_id: Number(e.target.value) })}>
                <option value="0">Select {form.consumer_kind}</option>
                {form.consumer_kind === 'member'
                  ? members.map(m => <option key={m.id} value={m.id}>{m.full_name} ({m.service_number})</option>)
                  : bookings.map(b => <option key={b.id} value={b.id}>{b.guest_name}{b.room_number ? ` (Room ${b.room_number})` : ''}</option>)}
              </select>
            </div>
          </div>

          <div className="max-w-32">
            <Label>Quantity</Label>
            <Input type="number" min={1} value={form.quantity}
              onChange={e => setForm({ ...form, quantity: Math.max(1, Number(e.target.value) || 1) })} />
          </div>

          {!advanced ? (
            <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setAdvanced(true)}>
              Advanced — timer is {form.sla_minutes} min
            </button>
          ) : (
            <div className="max-w-40">
              <Label>Timer (minutes)</Label>
              <Input type="number" min={1} value={form.sla_minutes}
                onChange={e => setForm({ ...form, sla_minutes: Math.max(1, Number(e.target.value) || 1) })} />
            </div>
          )}

          <Button onClick={handleCreate} disabled={saving} className="w-full">
            {saving ? 'Starting…' : 'Start Order'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
