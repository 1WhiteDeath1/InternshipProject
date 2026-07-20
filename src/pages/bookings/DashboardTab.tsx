import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';
import { LogIn, LogOut, Sparkles, MessageSquare, Copy, Check, RefreshCw, TimerOff, ChevronLeft, ChevronRight } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { formatCurrency } from '@/lib/currency';
import { useTheme } from '@/contexts/useTheme';
import { ConfirmDialog, type ConfirmRequest } from '@/components/ConfirmDialog';
import { RoomStatusDonut } from '@/components/RoomStatusDonut';
import { type OccupancyData, type SmsOutboxItem, type CalendarMonthSummary } from './shared';

interface DashboardTabProps {
  onOpenRoom: (roomId: number) => void;
  onChanged: () => void;
}

// Same monthly-bars pattern the Calendar tab's Year view used, now living here
// instead - informational only, no drill-down into another tab.
function YearlyAnalytics() {
  const { darkMode } = useTheme();
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [months, setMonths] = useState<CalendarMonthSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    queueMicrotask(async () => {
      setLoading(true);
      try {
        const res = await api.get(`/bookings/calendar-summary?start=${year}-01-01&end=${year + 1}-01-01&granularity=month`);
        setMonths(res.data.months);
      } catch { toast.error('Failed to load yearly analytics'); }
      finally { setLoading(false); }
    });
  }, [year]);

  const data = useMemo(() => months.map(m => ({
    ...m,
    label: new Date(Number(m.month.split('-')[0]), Number(m.month.split('-')[1]) - 1, 1).toLocaleDateString('en-GB', { month: 'short' }),
  })), [months]);

  const gridStroke = darkMode ? '#374151' : '#E5E7EB';
  const tickFill = darkMode ? '#9CA3AF' : '#6B7280';
  const tooltipStyle = {
    backgroundColor: darkMode ? '#111827' : '#FFFFFF',
    border: `1px solid ${gridStroke}`, borderRadius: 8,
    color: darkMode ? '#F9FAFB' : '#111827', fontSize: 15,
  };

  const chart = (title: string, dataKey: 'occupancy_rate' | 'bookings_count' | 'revenue', color: string, formatter?: (v: number) => string) => (
    <div className="rounded-lg border p-4">
      <p className="text-base font-semibold mb-2">{title}</p>
      <ResponsiveContainer width="100%" height={190}>
        <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 14, fill: tickFill }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 14, fill: tickFill }} width={48} axisLine={false} tickLine={false}
            tickFormatter={(v: number) => v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)} />
          <Tooltip contentStyle={tooltipStyle} formatter={formatter ? ((v: number) => formatter(v)) : undefined}
            cursor={{ fill: darkMode ? '#1F2937' : '#F3F4F6' }} />
          <Bar dataKey={dataKey} name={title} fill={color} radius={[4, 4, 0, 0]} maxBarSize={40} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-lg font-semibold">Yearly Analytics</p>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="outline" onClick={() => setYear(y => y - 1)}><ChevronLeft size={14} /></Button>
          <span className="text-base font-medium w-14 text-center">{year}</span>
          <Button size="sm" variant="outline" onClick={() => setYear(y => y + 1)}><ChevronRight size={14} /></Button>
        </div>
      </div>
      {loading ? <p className="text-base text-gray-500">Loading…</p> : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {chart('Occupancy Rate (%)', 'occupancy_rate', '#0D7377', v => `${v}%`)}
          {chart('Bookings', 'bookings_count', '#6366F1')}
          {chart('Revenue', 'revenue', '#2563EB', v => formatCurrency(v))}
        </div>
      )}
    </div>
  );
}

export default function DashboardTab({ onOpenRoom, onChanged }: DashboardTabProps) {
  const navigate = useNavigate();
  const [occupancy, setOccupancy] = useState<OccupancyData | null>(null);
  const [smsOutbox, setSmsOutbox] = useState<SmsOutboxItem[]>([]);
  const [copiedSmsId, setCopiedSmsId] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  const fetchOccupancy = useCallback(async () => {
    try { const res = await api.get('/bookings/occupancy'); setOccupancy(res.data); }
    catch { toast.error('Failed to load dashboard'); }
  }, []);

  const fetchSmsOutbox = useCallback(async () => {
    try {
      const res = await api.get('/bookings/sms-outbox?page_size=50');
      setSmsOutbox((res.data.items as SmsOutboxItem[]).filter(m => m.status !== 'sent'));
    } catch { /* outbox is auxiliary - don't block the dashboard on it */ }
  }, []);

  useEffect(() => { queueMicrotask(() => { fetchOccupancy(); fetchSmsOutbox(); }); }, [fetchOccupancy, fetchSmsOutbox]);

  const refresh = useCallback(() => { fetchOccupancy(); fetchSmsOutbox(); onChanged(); }, [fetchOccupancy, fetchSmsOutbox, onChanged]);

  const handleCheckIn = async (id: number) => {
    try { await api.post(`/bookings/${id}/check-in`); toast.success('Checked in'); refresh(); }
    catch (err) { toast.error(getErrorMessage(err, 'Failed')); }
  };
  const handleVoidExpired = (bookingId: number, guestName: string) => setConfirm({
    title: 'Void this booking?',
    description: `${guestName} did not arrive by the deadline. Voiding frees the room for tonight.`,
    confirmLabel: 'Void Booking', destructive: true,
    onConfirm: async () => {
      try { const res = await api.post(`/bookings/${bookingId}/void-expired`); toast.success(res.data.message); refresh(); }
      catch (err) { toast.error(getErrorMessage(err, 'Failed to void')); }
    },
  });
  const handleCopySms = async (m: SmsOutboxItem) => {
    try {
      await navigator.clipboard.writeText(m.body);
      setCopiedSmsId(m.id);
      setTimeout(() => setCopiedSmsId(null), 2000);
    } catch { toast.error('Copy failed - select the text manually'); }
  };
  const handleMarkSmsSent = async (id: number) => {
    try { await api.post(`/bookings/sms/${id}/mark-sent`); toast.success('Marked sent'); fetchSmsOutbox(); }
    catch (err) { toast.error(getErrorMessage(err, 'Failed')); }
  };
  const handleRetrySms = async (id: number) => {
    try {
      const res = await api.post(`/bookings/sms/${id}/retry`);
      if (res.data.status === 'sent') toast.success('SMS sent via gateway');
      else toast.error(res.data.error || 'Gateway send failed');
      fetchSmsOutbox();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed')); }
  };

  const overdueCount = occupancy?.departures.filter(d => d.overdue).length ?? 0;

  return (
    <div className="space-y-6">
      {/* Live room-state donut + today's actionable movement, side by side */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-5">
            <p className="text-lg font-semibold mb-3">Rooms Right Now</p>
            <RoomStatusDonut counts={occupancy} />
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-emerald-500">
          <CardContent className="p-5">
            <div className="flex items-baseline gap-2 mb-2">
              <span className="text-4xl font-bold text-gray-900 dark:text-white">{occupancy?.arrivals.length ?? 0}</span>
              <span className="text-base text-gray-500">Today's arrivals</span>
            </div>
            {(occupancy?.arrivals.length ?? 0) === 0 && <p className="text-base text-gray-400">No arrivals expected today</p>}
            {occupancy?.arrivals.map(a => (
              <div key={a.booking_id} className="flex items-center justify-between text-base py-1.5 border-b last:border-0">
                <button type="button" className="text-left hover:underline" onClick={() => onOpenRoom(a.room_id)}>
                  {a.guest_name} <span className="text-gray-400 text-sm">Room {a.room_number}</span>
                  {a.arrival_deadline && (
                    <span className={`block text-sm ${a.arrival_overdue ? 'text-red-600 font-medium' : 'text-gray-400'}`}>
                      {a.arrival_overdue ? 'Overdue — did not arrive by ' : 'Arrive by '}
                      {new Date(a.arrival_deadline).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </button>
                <span className="flex">
                  {a.arrival_overdue && (
                    <Button size="sm" variant="ghost" title="Void — guest did not arrive by deadline" onClick={() => handleVoidExpired(a.booking_id, a.guest_name)}>
                      <TimerOff size={17} className="text-red-500" />
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" title="Check in" onClick={() => handleCheckIn(a.booking_id)}><LogIn size={17} className="text-green-600" /></Button>
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className={`border-l-4 ${overdueCount > 0 ? 'border-l-red-500' : 'border-l-blue-500'}`}>
          <CardContent className="p-5">
            <div className="flex items-baseline gap-2 mb-2">
              <span className="text-4xl font-bold text-gray-900 dark:text-white">{occupancy?.departures.length ?? 0}</span>
              <span className="text-base text-gray-500">Today's departures</span>
              {overdueCount > 0 && <span className="text-sm font-semibold text-red-600">{overdueCount} overdue</span>}
            </div>
            {(occupancy?.departures.length ?? 0) === 0 && <p className="text-base text-gray-400">No departures expected today</p>}
            {occupancy?.departures.map(d => (
              <div key={d.booking_id} className="flex items-center justify-between text-base py-1.5 border-b last:border-0">
                <button type="button" className="text-left hover:underline" onClick={() => onOpenRoom(d.room_id)}>
                  {d.guest_name} <span className="text-gray-400 text-sm">Room {d.room_number}</span>
                  {d.overdue && (
                    <span className="block text-sm text-red-600 font-medium">
                      Overdue — should have left {d.days_overdue === 1 ? 'yesterday' : `${d.days_overdue} days ago`}
                    </span>
                  )}
                </button>
                <Button size="sm" variant="ghost" title="Send to Clerk Desk to bill"
                  onClick={() => navigate('/clerk-desk')}>
                  <LogOut size={17} className={d.overdue ? 'text-red-600' : 'text-blue-600'} />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Housekeeping queue - each room is one tap from its panel */}
      {(occupancy?.housekeeping_queue.length ?? 0) > 0 && (
        <Card className="border-l-4 border-l-amber-500">
          <CardContent className="p-5">
            <div className="flex items-baseline gap-2 mb-2">
              <span className="text-4xl font-bold text-gray-900 dark:text-white">{occupancy?.housekeeping_queue.length}</span>
              <span className="text-base text-gray-500">Rooms waiting for housekeeping</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {occupancy?.housekeeping_queue.map(h => (
                <button key={h.room_id} type="button" onClick={() => onOpenRoom(h.room_id)}
                  className="flex items-center gap-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 px-3 py-2 text-base hover:border-amber-500 transition-colors">
                  <Sparkles size={16} className="text-amber-500" />
                  <span className="font-medium">Room {h.room_number}</span>
                  <span className="text-sm text-amber-700 dark:text-amber-300 capitalize">{h.housekeeping_status}</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {smsOutbox.length > 0 && (
        <Card>
          <CardContent className="p-5">
            <p className="text-base font-semibold mb-2 flex items-center gap-1.5">
              <MessageSquare size={17} className="text-blue-600" /> SMS outbox — {smsOutbox.length} unsent guest message{smsOutbox.length > 1 ? 's' : ''}
            </p>
            <p className="text-sm text-gray-400 mb-2">No SMS gateway on this network? Copy the text, send it from any phone, then mark it sent.</p>
            {smsOutbox.map(m => (
              <div key={m.id} className="flex items-start justify-between gap-3 text-base py-2 border-b last:border-0">
                <div className="min-w-0">
                  <p className="font-medium">
                    {m.guest_name || 'Guest'} <span className="text-gray-400 text-sm">{m.phone}{m.booking_reference ? ` · ${m.booking_reference}` : ''}</span>
                    {m.status === 'failed' && <span className="text-red-500 text-sm ml-1.5" title={m.error || ''}>gateway failed</span>}
                  </p>
                  <p className="text-sm text-gray-500 line-clamp-2">{m.body}</p>
                </div>
                <span className="flex shrink-0">
                  <Button size="sm" variant="ghost" title="Copy message text" onClick={() => handleCopySms(m)}>
                    {copiedSmsId === m.id ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
                  </Button>
                  <Button size="sm" variant="ghost" title="Retry via SMS gateway" onClick={() => handleRetrySms(m.id)}><RefreshCw size={16} className="text-blue-600" /></Button>
                  <Button size="sm" variant="ghost" title="Mark as sent (sent manually from a phone)" onClick={() => handleMarkSmsSent(m.id)}><Check size={16} className="text-green-600" /></Button>
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <YearlyAnalytics />

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
