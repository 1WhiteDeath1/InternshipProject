import { useEffect, useMemo, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/useAuth';
import { hasPermission } from '@/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from 'sonner';
import {
  CalendarDays, Plus, Users, MapPin, Wallet, UtensilsCrossed, Trash2,
  CheckCircle2, ChefHat, Clock, Ban, Receipt, CalendarClock, ChevronLeft, ChevronRight, List, LayoutGrid,
} from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import { todayISO, fmtDay } from './bookings/shared';

interface MenuItem { id: number; dish_name: string; estimated_price: number; quantity: number; }

interface EventItem {
  id: number; title: string;
  guest_id: number; guest_name: string | null; guest_phone: string | null;
  hall_name: string; capacity: number; headcount: number;
  event_date: string; requirements: string | null; arrangement: string | null;
  billing_type: 'split' | 'single_payer'; status: string;
  total_estimated_amount: number; menu_items: MenuItem[];
  invoice_id: number | null; invoice_number: string | null; invoice_amount: number | null;
  actual_cost: number | null; margin: number | null;
  created_at: string;
}

const STATUS_LABELS: Record<string, string> = {
  booked: 'Booked', menu_set: 'Menu Set', preparing: 'Preparing', completed: 'Completed', cancelled: 'Cancelled',
};
const STATUS_COLORS: Record<string, string> = {
  booked: 'bg-blue-100 text-blue-800', menu_set: 'bg-amber-100 text-amber-800',
  preparing: 'bg-orange-100 text-orange-800', completed: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-red-100 text-red-800',
};
const STATUS_DOT: Record<string, string> = {
  booked: 'bg-blue-500', menu_set: 'bg-amber-500', preparing: 'bg-orange-500',
  completed: 'bg-emerald-500', cancelled: 'bg-red-500',
};
const STATUS_FLOW = ['booked', 'menu_set', 'preparing', 'completed'];

function addMonths(iso: string, n: number): string {
  const [y, m] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1 + n, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-01`;
}
function startOfMonth(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  return `${y}-${String(m).padStart(2, '0')}-01`;
}
function daysInMonth(iso: string): string[] {
  const [y, m] = iso.split('-').map(Number);
  const count = new Date(y, m, 0).getDate();
  return Array.from({ length: count }, (_, i) => `${y}-${String(m).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`);
}

// Month grid matching the visual layout of the Bookings module's
// CalendarTab (nav row, Today button, weekday header, day-cell popovers) -
// grouped client-side from the already-fetched `events` list rather than a
// dedicated endpoint, since Events has no per-room capacity dimension to
// aggregate server-side.
function EventsCalendarView({ events, onOpenEvent }: { events: EventItem[]; onOpenEvent: (id: number) => void }) {
  const [anchor, setAnchor] = useState(todayISO());
  const today = todayISO();

  const byDate = useMemo(() => {
    const map = new Map<string, EventItem[]>();
    for (const e of events) {
      const key = e.event_date.slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return map;
  }, [events]);

  const monthStart = startOfMonth(anchor);
  const days = daysInMonth(monthStart);
  const leadingBlanks = new Date(Number(monthStart.split('-')[0]), Number(monthStart.split('-')[1]) - 1, 1).getDay();
  const periodLabel = useMemo(() => {
    const [y, m] = monthStart.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  }, [monthStart]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="outline" onClick={() => setAnchor(addMonths(anchor, -1))}><ChevronLeft size={16} /></Button>
          <Button size="sm" variant="outline" onClick={() => setAnchor(todayISO())}>Today</Button>
          <Button size="sm" variant="outline" onClick={() => setAnchor(addMonths(anchor, 1))}><ChevronRight size={16} /></Button>
          <p className="text-sm font-semibold ml-2">{periodLabel}</p>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-1">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => <div key={d} className="text-center text-xs text-muted-foreground font-medium">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: leadingBlanks }).map((_, i) => <div key={`b${i}`} />)}
        {days.map(day => {
          const dayEvents = byDate.get(day) || [];
          const dayNum = Number(day.split('-')[2]);
          const shown = dayEvents.slice(0, 2);
          const overflow = dayEvents.length - shown.length;
          return (
            <Popover key={day}>
              <PopoverTrigger asChild>
                <button type="button" disabled={dayEvents.length === 0}
                  className={`min-h-20 rounded-md border p-1.5 text-left flex flex-col gap-0.5 transition-colors ${dayEvents.length > 0 ? 'hover:bg-accent' : ''} ${day === today ? 'ring-2 ring-primary' : 'border-border'}`}>
                  <span className="text-xs font-medium">{dayNum}</span>
                  <div className="flex-1 space-y-0.5 overflow-hidden">
                    {shown.map(e => (
                      <p key={e.id} className="text-[10px] leading-tight truncate flex items-center gap-1">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[e.status] || 'bg-gray-400'}`} />
                        {e.title}
                      </p>
                    ))}
                    {overflow > 0 && <p className="text-[10px] leading-tight text-muted-foreground">+{overflow} more</p>}
                  </div>
                </button>
              </PopoverTrigger>
              {dayEvents.length > 0 && (
                <PopoverContent className="w-72">
                  <p className="text-sm font-medium mb-1.5">{fmtDay(day)}</p>
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {dayEvents.map(e => (
                      <button key={e.id} type="button" onClick={() => onOpenEvent(e.id)}
                        className="w-full flex items-center justify-between gap-2 text-xs px-2 py-1.5 rounded hover:bg-accent text-left">
                        <span className="truncate flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[e.status] || 'bg-gray-400'}`} />
                          {e.title}
                        </span>
                        <span className="text-muted-foreground shrink-0">{e.hall_name} · {STATUS_LABELS[e.status]}</span>
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              )}
            </Popover>
          );
        })}
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
        {Object.entries(STATUS_DOT).map(([status, cls]) => (
          <span key={status} className="flex items-center gap-1">
            <span className={`w-3 h-3 rounded-sm inline-block ${cls}`} /> {STATUS_LABELS[status]}
          </span>
        ))}
      </div>
    </div>
  );
}

const emptyForm = () => ({
  title: '', guest_name: '', guest_phone: '', hall_name: '', capacity: '', headcount: '',
  event_date: '', requirements: '', arrangement: '', billing_type: 'split' as 'split' | 'single_payer',
});

function NewEventDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!form.title.trim() || !form.guest_name.trim() || !form.hall_name.trim() || !form.capacity || !form.headcount || !form.event_date) {
      toast.error('Title, contact, hall, capacity, headcount and date are required');
      return;
    }
    setSaving(true);
    try {
      const res = await api.post('/events', {
        ...form, capacity: Number(form.capacity), headcount: Number(form.headcount),
      });
      toast.success('Event booked');
      if (res.data.capacity_warning) toast.warning(res.data.capacity_warning);
      setForm(emptyForm());
      onCreated();
      onClose();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to book event')); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Book a Hall / Function</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Event Title</Label><Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. Retirement Dinner" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Contact / Organizer Name</Label><Input value={form.guest_name} onChange={e => setForm({ ...form, guest_name: e.target.value })} /></div>
            <div><Label>Contact Phone</Label><Input value={form.guest_phone} onChange={e => setForm({ ...form, guest_phone: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Hall / Area</Label><Input value={form.hall_name} onChange={e => setForm({ ...form, hall_name: e.target.value })} placeholder="e.g. Lawn" /></div>
            <div><Label>Capacity</Label><Input type="number" min={1} value={form.capacity} onChange={e => setForm({ ...form, capacity: e.target.value.replace(/^0+(?=\d)/, '') })} /></div>
            <div><Label>Headcount</Label><Input type="number" min={1} value={form.headcount} onChange={e => setForm({ ...form, headcount: e.target.value.replace(/^0+(?=\d)/, '') })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Event Date</Label><Input type="date" value={form.event_date} onChange={e => setForm({ ...form, event_date: e.target.value })} /></div>
            <div>
              <Label>Billing</Label>
              <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={form.billing_type} onChange={e => setForm({ ...form, billing_type: e.target.value as 'split' | 'single_payer' })}>
                <option value="split">Cost split among guests</option>
                <option value="single_payer">One person pays</option>
              </select>
            </div>
          </div>
          <div><Label>Requirements / Requests</Label><Textarea rows={2} value={form.requirements} onChange={e => setForm({ ...form, requirements: e.target.value })} placeholder="e.g. sound system, extra chairs" /></div>
          <div><Label>Arrangement</Label><Textarea rows={2} value={form.arrangement} onChange={e => setForm({ ...form, arrangement: e.target.value })} placeholder="e.g. round tables of 10, stage on the north side" /></div>
          <p className="text-xs text-muted-foreground">No fixed hall catalog - pick whatever area fits and set its capacity here. If it turns out too small, postpone or cancel from the event's detail view.</p>
          <Button className="w-full" onClick={handleCreate} disabled={saving}>{saving ? 'Booking…' : 'Book Event'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PostponeDialog({ event, onClose, onDone }: { event: EventItem | null; onClose: () => void; onDone: () => void }) {
  const [newDate, setNewDate] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!event || !newDate || !reason.trim()) { toast.error('A new date and reason are required'); return; }
    setSaving(true);
    try {
      await api.post(`/events/${event.id}/postpone`, { new_date: newDate, reason });
      toast.success('Event postponed');
      onDone();
      onClose();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to postpone')); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={!!event} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Postpone — {event?.title}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>New Date</Label><Input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} /></div>
          <div><Label>Reason</Label><Input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. hall too small for the headcount" /></div>
          <Button className="w-full" onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Postpone Event'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EventDetailDialog({ event, onClose, onChanged }: { event: EventItem | null; onClose: () => void; onChanged: () => void }) {
  const { user } = useAuth();
  const canManageBooking = hasPermission(user, 'events', 'create');
  const canManageKitchen = hasPermission(user, 'events', 'edit') && !canManageBooking;
  const canInvoice = hasPermission(user, 'clerk_desk', 'create');
  const canLogCost = hasPermission(user, 'clerk_desk', 'edit');

  const [dishName, setDishName] = useState('');
  const [dishPrice, setDishPrice] = useState('');
  // Lazy initializer only - the parent remounts this component (via `key`)
  // whenever the selected event changes, so this naturally resets per event
  // without needing an effect to re-sync it.
  const [dishQty, setDishQty] = useState(() => event ? String(event.headcount) : '');
  const [costInput, setCostInput] = useState(() => event?.actual_cost != null ? String(event.actual_cost) : '');
  const [busy, setBusy] = useState(false);
  const [postponing, setPostponing] = useState(false);

  if (!event) return null;

  const addDish = async () => {
    if (!dishName.trim() || !dishPrice || !dishQty) { toast.error('Dish name, price and quantity are required'); return; }
    setBusy(true);
    try {
      await api.post(`/events/${event.id}/menu-items`, { dish_name: dishName, estimated_price: Number(dishPrice), quantity: Number(dishQty) });
      setDishName(''); setDishPrice(''); setDishQty(String(event.headcount));
      onChanged();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to add dish')); }
    finally { setBusy(false); }
  };

  const removeDish = async (id: number) => {
    try { await api.delete(`/events/menu-items/${id}`); onChanged(); }
    catch (err) { toast.error(getErrorMessage(err, 'Failed to remove dish')); }
  };

  const advanceStatus = async (status: string) => {
    setBusy(true);
    try { await api.post(`/events/${event.id}/status`, { status }); toast.success(`Marked ${STATUS_LABELS[status]}`); onChanged(); }
    catch (err) { toast.error(getErrorMessage(err, 'Failed to update status')); }
    finally { setBusy(false); }
  };

  const cancelEvent = async () => {
    setBusy(true);
    try { await api.post(`/events/${event.id}/status`, { status: 'cancelled' }); toast.success('Event cancelled'); onChanged(); }
    catch (err) { toast.error(getErrorMessage(err, 'Failed to cancel')); }
    finally { setBusy(false); }
  };

  const generateInvoice = async () => {
    setBusy(true);
    try {
      const res = await api.post(`/events/${event.id}/generate-invoice`);
      toast.success(`Invoice ${res.data.invoice_number} generated — ${formatCurrency(res.data.total_amount)}`);
      onChanged();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to generate invoice')); }
    finally { setBusy(false); }
  };

  const saveActualCost = async () => {
    if (!costInput || Number(costInput) < 0) { toast.error('Enter the actual cost'); return; }
    setBusy(true);
    try {
      await api.put(`/events/${event.id}/actual-cost`, { actual_cost: Number(costInput) });
      toast.success('Actual cost logged');
      onChanged();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to log actual cost')); }
    finally { setBusy(false); }
  };

  const currentIdx = STATUS_FLOW.indexOf(event.status);
  const nextStatus = currentIdx >= 0 && currentIdx < STATUS_FLOW.length - 1 ? STATUS_FLOW[currentIdx + 1] : null;

  return (
    <>
      <Dialog open={!!event} onOpenChange={v => { if (!v) onClose(); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              {event.title}
              <Badge className={STATUS_COLORS[event.status]}>{STATUS_LABELS[event.status]}</Badge>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <p className="flex items-center gap-1.5"><CalendarDays size={15} className="text-muted-foreground" /> {new Date(event.event_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
              <p className="flex items-center gap-1.5"><Users size={15} className="text-muted-foreground" /> {event.headcount} people (capacity {event.capacity})</p>
              <p className="flex items-center gap-1.5"><MapPin size={15} className="text-muted-foreground" /> {event.hall_name}</p>
              <p className="flex items-center gap-1.5"><Wallet size={15} className="text-muted-foreground" /> {event.billing_type === 'split' ? 'Cost split among guests' : 'One person pays'}</p>
            </div>
            <p className="text-muted-foreground">Organizer: <span className="font-medium text-foreground">{event.guest_name}</span>{event.guest_phone ? ` · ${event.guest_phone}` : ''}</p>
            {event.requirements && <p><span className="text-muted-foreground">Requirements:</span> {event.requirements}</p>}
            {event.arrangement && <p><span className="text-muted-foreground">Arrangement:</span> {event.arrangement}</p>}
          </div>

          <div className="rounded-lg border p-3 space-y-2">
            <p className="text-sm font-semibold flex items-center gap-1.5"><UtensilsCrossed size={15} /> Menu</p>
            {event.menu_items.length === 0 && <p className="text-xs text-muted-foreground">No dishes added yet</p>}
            {event.menu_items.map(mi => (
              <div key={mi.id} className="flex items-center justify-between text-sm">
                <span>{mi.dish_name} <span className="text-muted-foreground text-xs">× {mi.quantity}</span></span>
                <span className="flex items-center gap-2">
                  <span className="font-mono">{formatCurrency(mi.estimated_price * mi.quantity)}</span>
                  {canManageKitchen && <button type="button" onClick={() => removeDish(mi.id)} className="text-red-400 hover:text-red-600"><Trash2 size={13} /></button>}
                </span>
              </div>
            ))}
            {event.menu_items.length > 0 && (
              <div className="flex justify-between border-t pt-1.5 text-sm font-bold">
                <span>Estimated Total</span><span className="font-mono">{formatCurrency(event.total_estimated_amount)}</span>
              </div>
            )}
            {canManageKitchen && (
              <div className="flex gap-1.5 pt-1">
                <Input placeholder="Dish" className="h-9 text-xs flex-1" value={dishName} onChange={e => setDishName(e.target.value)} />
                <Input type="number" placeholder="Rs/unit" className="h-9 text-xs w-24" value={dishPrice} onChange={e => setDishPrice(e.target.value.replace(/^0+(?=\d)/, ''))} />
                <Input type="number" placeholder="Qty" className="h-9 text-xs w-20" value={dishQty} onChange={e => setDishQty(e.target.value.replace(/^0+(?=\d)/, ''))} />
                <Button size="sm" className="h-9" onClick={addDish} disabled={busy}>Add</Button>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {canManageKitchen && event.status !== 'cancelled' && event.status !== 'completed' && nextStatus && (
              <Button size="sm" disabled={busy} onClick={() => advanceStatus(nextStatus)}>
                {nextStatus === 'menu_set' && <ChefHat size={14} className="mr-1" />}
                {nextStatus === 'preparing' && <Clock size={14} className="mr-1" />}
                {nextStatus === 'completed' && <CheckCircle2 size={14} className="mr-1" />}
                Mark {STATUS_LABELS[nextStatus]}
              </Button>
            )}
            {canManageBooking && event.status !== 'cancelled' && event.status !== 'completed' && (
              <>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setPostponing(true)}>
                  <CalendarClock size={14} className="mr-1" /> Postpone
                </Button>
                <Button size="sm" variant="destructive" disabled={busy} onClick={cancelEvent}>
                  <Ban size={14} className="mr-1" /> Cancel Event
                </Button>
              </>
            )}
            {canInvoice && event.status === 'completed' && !event.invoice_id && (
              <Button size="sm" disabled={busy} onClick={generateInvoice}>
                <Receipt size={14} className="mr-1" /> Generate Invoice
              </Button>
            )}
            {event.invoice_id && (
              <span className="text-xs text-emerald-600 flex items-center gap-1"><CheckCircle2 size={13} /> Invoiced — {event.invoice_number}</span>
            )}
          </div>

          {(canLogCost || event.actual_cost != null) && (
            <div className="rounded-lg border p-3 space-y-2">
              <p className="text-sm font-semibold flex items-center gap-1.5"><Wallet size={15} /> Cost &amp; Margin</p>
              {event.invoice_id && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Invoiced (billed to guest)</span>
                  <span className="font-mono">{formatCurrency(event.invoice_amount ?? 0)}</span>
                </div>
              )}
              {canLogCost ? (
                <div className="flex items-center gap-1.5">
                  <Input type="number" placeholder="Actual cost (Rs)" className="h-9 text-xs flex-1" value={costInput} onChange={e => setCostInput(e.target.value.replace(/^0+(?=\d)/, ''))} />
                  <Button size="sm" className="h-9" disabled={busy} onClick={saveActualCost}>{event.actual_cost != null ? 'Update' : 'Log Cost'}</Button>
                </div>
              ) : event.actual_cost != null && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Actual cost</span>
                  <span className="font-mono">{formatCurrency(event.actual_cost)}</span>
                </div>
              )}
              {event.margin != null && (
                <div className={`flex justify-between border-t pt-1.5 text-sm font-bold ${event.margin >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  <span>{event.margin >= 0 ? 'Profit' : 'Loss'}</span>
                  <span className="font-mono">{formatCurrency(Math.abs(event.margin))}</span>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
      <PostponeDialog event={postponing ? event : null} onClose={() => setPostponing(false)} onDone={onChanged} />
    </>
  );
}

export default function Events() {
  const { user } = useAuth();
  const canCreate = hasPermission(user, 'events', 'create');
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newOpen, setNewOpen] = useState(false);
  // The id, not the object - the object is derived fresh from `events` below
  // on every render, so the open detail dialog automatically sees the latest
  // copy after fetchEvents() re-runs, no synchronizing effect needed.
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const fetchEvents = async () => {
    try { const res = await api.get('/events'); setEvents(res.data.items || []); }
    catch { toast.error('Failed to load events'); }
  };

  useEffect(() => { queueMicrotask(() => { setLoading(true); fetchEvents().finally(() => setLoading(false)); }); }, []);

  const selected = selectedId !== null ? (events.find(e => e.id === selectedId) ?? null) : null;

  const active = events.filter(e => e.status !== 'cancelled' && e.status !== 'completed');
  const completed = events.filter(e => e.status === 'completed');
  const cancelled = events.filter(e => e.status === 'cancelled');

  const EventCard = ({ e }: { e: EventItem }) => (
    <Card className="cursor-pointer hover:shadow-md transition-all" onClick={() => setSelectedId(e.id)}>
      <CardContent className="p-4 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <p className="font-bold truncate">{e.title}</p>
          <Badge className={STATUS_COLORS[e.status]}>{STATUS_LABELS[e.status]}</Badge>
        </div>
        <p className="text-xs text-muted-foreground flex items-center gap-1.5"><CalendarDays size={13} /> {new Date(e.event_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
        <p className="text-xs text-muted-foreground flex items-center gap-1.5"><MapPin size={13} /> {e.hall_name} · <Users size={13} /> {e.headcount}</p>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><CalendarDays size={24} /> Events</h1>
        {canCreate && <Button onClick={() => setNewOpen(true)}><Plus size={16} className="mr-1" /> New Event</Button>}
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!loading && (
        <Tabs defaultValue="list">
          <TabsList>
            <TabsTrigger value="list"><List size={14} className="mr-1" /> List</TabsTrigger>
            <TabsTrigger value="calendar"><LayoutGrid size={14} className="mr-1" /> Calendar</TabsTrigger>
          </TabsList>

          <TabsContent value="list" className="space-y-6 mt-4">
            {events.length === 0 && <p className="text-sm text-muted-foreground">No events booked yet.</p>}

            {active.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {active.map(e => <EventCard key={e.id} e={e} />)}
              </div>
            )}

            {completed.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold mb-2 text-emerald-700 dark:text-emerald-400">Completed</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {completed.map(e => <EventCard key={e.id} e={e} />)}
                </div>
              </div>
            )}

            {cancelled.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold mb-2 text-muted-foreground">Cancelled</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {cancelled.map(e => <EventCard key={e.id} e={e} />)}
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="calendar" className="mt-4">
            <EventsCalendarView events={events} onOpenEvent={setSelectedId} />
          </TabsContent>
        </Tabs>
      )}

      <NewEventDialog open={newOpen} onClose={() => setNewOpen(false)} onCreated={fetchEvents} />
      <EventDetailDialog key={selectedId ?? 'none'} event={selected} onClose={() => setSelectedId(null)} onChanged={fetchEvents} />
    </div>
  );
}
