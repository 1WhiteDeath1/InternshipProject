import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { getErrorMessage } from '@/lib/api';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { CalendarDays, Users, MapPin } from 'lucide-react';

interface EventBrief { id: number; title: string; event_date: string; headcount: number; hall_name: string; status: string; }
interface WidgetData { today: EventBrief[]; upcoming: EventBrief[]; upcoming_total: number; }

interface EventFull extends EventBrief {
  guest_name: string | null; guest_phone: string | null; capacity: number;
  requirements: string | null; arrangement: string | null; billing_type: string;
}

const STATUS_LABELS: Record<string, string> = {
  booked: 'Booked', menu_set: 'Menu Set', preparing: 'Preparing', completed: 'Completed', cancelled: 'Cancelled',
};
const STATUS_COLORS: Record<string, string> = {
  booked: 'bg-blue-100 text-blue-800', menu_set: 'bg-amber-100 text-amber-800',
  preparing: 'bg-orange-100 text-orange-800', completed: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-red-100 text-red-800',
};

const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

function EventRow({ e }: { e: EventBrief }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="text-sm truncate min-w-0">{e.title}</span>
      <span className="text-xs text-gray-500 shrink-0">{fmtDate(e.event_date)}</span>
    </div>
  );
}

function EventsDetailDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [events, setEvents] = useState<EventFull[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    queueMicrotask(async () => {
      setLoading(true);
      try {
        const res = await api.get('/events');
        const today = new Date().toISOString().slice(0, 10);
        setEvents((res.data.items || []).filter((e: EventFull) => e.status !== 'cancelled' && e.event_date >= today)
          .sort((a: EventFull, b: EventFull) => a.event_date.localeCompare(b.event_date)));
      } catch (err) { toast.error(getErrorMessage(err, 'Failed to load events')); }
      finally { setLoading(false); }
    });
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><CalendarDays size={20} /> Upcoming Events</DialogTitle></DialogHeader>

        {loading && <p className="text-sm text-gray-500 py-8 text-center">Loading…</p>}
        {!loading && events.length === 0 && <p className="text-sm text-gray-500 py-8 text-center">No upcoming events booked.</p>}

        <div className="space-y-3">
          {events.map(e => (
            <div key={e.id} className="rounded-lg border p-3 space-y-1.5 text-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="font-bold">{e.title}</p>
                <Badge className={STATUS_COLORS[e.status]}>{STATUS_LABELS[e.status] || e.status}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-gray-600 dark:text-gray-300">
                <p className="flex items-center gap-1.5"><CalendarDays size={13} className="text-gray-400" /> {fmtDate(e.event_date)}</p>
                <p className="flex items-center gap-1.5"><Users size={13} className="text-gray-400" /> {e.headcount} people</p>
                <p className="flex items-center gap-1.5 col-span-2"><MapPin size={13} className="text-gray-400" /> {e.hall_name} (capacity {e.capacity})</p>
              </div>
              <p className="text-xs text-gray-500">Organizer: {e.guest_name}{e.guest_phone ? ` · ${e.guest_phone}` : ''} · {e.billing_type === 'split' ? 'Cost split among guests' : 'One person pays'}</p>
              {e.requirements && <p className="text-xs"><span className="text-gray-400">Requirements:</span> {e.requirements}</p>}
              {e.arrangement && <p className="text-xs"><span className="text-gray-400">Arrangement:</span> {e.arrangement}</p>}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function EventsWidget() {
  const navigate = useNavigate();
  const [data, setData] = useState<WidgetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailOpen, setDetailOpen] = useState(false);

  useEffect(() => {
    queueMicrotask(async () => {
      try { const res = await api.get('/events/dashboard-widget'); setData(res.data); }
      catch { toast.error('Failed to load events'); }
      finally { setLoading(false); }
    });
  }, []);

  const extra = data ? Math.max(data.upcoming_total - data.upcoming.length, 0) : 0;
  const nothing = !loading && data && data.today.length === 0 && data.upcoming.length === 0;

  return (
    <>
      {/* py-0 cancels Card's own py-6 - CardContent's p-5 below is this
          widget's only vertical padding. */}
      <Card className="cursor-pointer hover:shadow-lg transition-all py-0" onClick={() => setDetailOpen(true)}>
        <CardContent className="p-4">
          <p className="text-base text-gray-500 dark:text-gray-400 flex items-center gap-1.5 mb-2"><CalendarDays size={16} /> Events</p>

          {loading && <p className="text-sm text-gray-400">Loading…</p>}
          {nothing && <p className="text-sm text-gray-400">No upcoming events</p>}

          {!loading && data && data.today.length > 0 && (
            <div className="mb-2">
              <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide mb-0.5">Today</p>
              {data.today.map(e => <EventRow key={e.id} e={e} />)}
            </div>
          )}

          {!loading && data && data.upcoming.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Upcoming</p>
              {data.upcoming.map(e => <EventRow key={e.id} e={e} />)}
            </div>
          )}

          {extra > 0 && <p className="text-xs text-gray-500 mt-1.5">+{extra} more</p>}

          {!nothing && (
            <button type="button" className="text-xs text-blue-600 hover:underline mt-2" onClick={e => { e.stopPropagation(); navigate('/events'); }}>
              Open Events
            </button>
          )}
        </CardContent>
      </Card>
      <EventsDetailDialog open={detailOpen} onClose={() => setDetailOpen(false)} />
    </>
  );
}
