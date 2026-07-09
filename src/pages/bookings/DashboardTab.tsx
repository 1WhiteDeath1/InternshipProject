import { useCallback, useEffect, useMemo, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Search, BedDouble, LogIn, LogOut, Users, Ban, UserX, Sparkles } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import { todayISO, type Booking, type OccupancyData } from './shared';
import { StatusBadge } from './badges';

interface DashboardTabProps {
  onOpenRoom: (roomId: number) => void;
  onChanged: () => void;
}

export default function DashboardTab({ onOpenRoom, onChanged }: DashboardTabProps) {
  const [occupancy, setOccupancy] = useState<OccupancyData | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchOccupancy = useCallback(async () => {
    try { const res = await api.get('/bookings/occupancy'); setOccupancy(res.data); }
    catch { toast.error('Failed to load dashboard'); }
  }, []);

  const fetchBookings = useCallback(async () => {
    try { const res = await api.get(`/bookings?search=${encodeURIComponent(search)}`); setBookings(res.data.items); }
    catch { toast.error('Failed to load bookings'); }
  }, [search]);

  useEffect(() => {
    queueMicrotask(() => {
      setLoading(true);
      Promise.all([fetchOccupancy(), fetchBookings()]).finally(() => setLoading(false));
    });
  }, [fetchOccupancy, fetchBookings]);

  const refresh = useCallback(() => { fetchOccupancy(); fetchBookings(); onChanged(); }, [fetchOccupancy, fetchBookings, onChanged]);

  const handleCheckIn = async (id: number) => {
    try { await api.post(`/bookings/${id}/check-in`); toast.success('Checked in'); refresh(); }
    catch (err) { toast.error(getErrorMessage(err, 'Failed')); }
  };
  const handleCheckOut = async (id: number) => {
    try {
      const res = await api.post(`/bookings/${id}/check-out`);
      toast.success(res.data.late_checkout_fee ? `Checked out — late checkout fee ${formatCurrency(res.data.late_checkout_fee)} added` : 'Checked out');
      refresh();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed')); }
  };
  const handleCancel = async (b: Booking) => {
    const reason = window.prompt(`Cancel ${b.booking_reference} (${b.guest_name})?\nReason:`);
    if (reason === null) return;
    try { await api.post(`/bookings/${b.id}/cancel`, { reason }); toast.success('Booking cancelled'); refresh(); }
    catch (err) { toast.error(getErrorMessage(err, 'Failed')); }
  };
  const handleNoShow = async (b: Booking) => {
    if (!window.confirm(`Mark ${b.booking_reference} (${b.guest_name}) as no-show?`)) return;
    try { await api.post(`/bookings/${b.id}/no-show`); toast.success('Marked as no-show'); refresh(); }
    catch (err) { toast.error(getErrorMessage(err, 'Failed')); }
  };

  const today = useMemo(() => todayISO(), []);

  const kpis = occupancy ? [
    { label: 'Total Rooms', value: occupancy.total_rooms, icon: BedDouble },
    { label: 'Occupied', value: occupancy.occupied, color: 'text-red-600' },
    { label: 'Vacant', value: occupancy.vacant, color: 'text-green-600' },
    { label: 'Reserved', value: occupancy.reserved, color: 'text-blue-600' },
    { label: 'Maintenance', value: occupancy.maintenance, color: 'text-gray-600' },
    { label: 'Needs Housekeeping', value: occupancy.needs_housekeeping, color: 'text-amber-600' },
    { label: 'Occupancy Rate', value: `${occupancy.occupancy_rate}%`, color: 'text-purple-600' },
  ] : [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((item, i) => (
          <Card key={i}><CardContent className="p-5 flex items-center gap-3">
            <div className={`w-11 h-11 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center ${item.color || ''}`}>
              {item.icon ? <item.icon size={22} /> : <Users size={22} />}
            </div>
            <div><p className="text-xs text-gray-500">{item.label}</p><p className={`text-xl font-bold ${item.color || 'text-gray-900 dark:text-white'}`}>{item.value}</p></div>
          </CardContent></Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm font-medium mb-2">Today's arrivals ({occupancy?.arrivals.length ?? 0})</p>
            {(occupancy?.arrivals.length ?? 0) === 0 && <p className="text-xs text-gray-400">No arrivals expected today</p>}
            {occupancy?.arrivals.map(a => (
              <div key={a.booking_id} className="flex items-center justify-between text-sm py-1.5 border-b last:border-0">
                <button type="button" className="text-left hover:underline" onClick={() => onOpenRoom(a.room_id)}>
                  {a.guest_name} <span className="text-gray-400 text-xs">Room {a.room_number}</span>
                </button>
                <Button size="sm" variant="ghost" title="Check in" onClick={() => handleCheckIn(a.booking_id)}><LogIn size={16} className="text-green-600" /></Button>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm font-medium mb-2">Today's departures ({occupancy?.departures.length ?? 0})</p>
            {(occupancy?.departures.length ?? 0) === 0 && <p className="text-xs text-gray-400">No departures expected today</p>}
            {occupancy?.departures.map(d => (
              <div key={d.booking_id} className="flex items-center justify-between text-sm py-1.5 border-b last:border-0">
                <button type="button" className="text-left hover:underline" onClick={() => onOpenRoom(d.room_id)}>
                  {d.guest_name} <span className="text-gray-400 text-xs">Room {d.room_number}</span>
                </button>
                <Button size="sm" variant="ghost" title="Check out" onClick={() => handleCheckOut(d.booking_id)}><LogOut size={16} className="text-blue-600" /></Button>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm font-medium mb-2">Housekeeping queue ({occupancy?.housekeeping_queue.length ?? 0})</p>
            {(occupancy?.housekeeping_queue.length ?? 0) === 0 && <p className="text-xs text-gray-400">All rooms clean</p>}
            {occupancy?.housekeeping_queue.map(h => (
              <button key={h.room_id} type="button" onClick={() => onOpenRoom(h.room_id)}
                className="w-full flex items-center justify-between text-sm py-1.5 border-b last:border-0 text-left hover:underline">
                <span className="flex items-center gap-1.5"><Sparkles size={14} className="text-amber-500" /> Room {h.room_number}</span>
                <span className="text-xs text-amber-700 capitalize">{h.housekeeping_status}</span>
              </button>
            ))}
          </CardContent>
        </Card>
      </div>

      <div>
        <div className="relative max-w-sm mb-4"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} /><Input placeholder="Search bookings..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" /></div>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Reference</TableHead><TableHead>Guest</TableHead><TableHead>Duty</TableHead><TableHead>Room</TableHead><TableHead>Check In</TableHead><TableHead>Check Out</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {loading && <TableRow><TableCell colSpan={9} className="text-center py-8 text-gray-500">Loading bookings...</TableCell></TableRow>}
                {!loading && bookings.map(b => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.booking_reference}</TableCell>
                    <TableCell>
                      {b.rank ? `${b.rank} ` : ''}{b.guest_name}
                      {b.member_name && <span className="block text-xs text-gray-500">Member: {b.member_name}</span>}
                    </TableCell>
                    <TableCell className="text-xs capitalize text-gray-500">{b.nature_of_duty?.replace(/_/g, ' ') || '-'}</TableCell>
                    <TableCell>{b.room_number}</TableCell>
                    <TableCell>{b.check_in}</TableCell>
                    <TableCell>{b.check_out}</TableCell>
                    <TableCell>{b.nature_of_duty === 'hra' ? <span className="text-xs text-purple-600">HRA monthly</span> : (b.total_amount != null ? formatCurrency(b.total_amount) : '-')}</TableCell>
                    <TableCell><StatusBadge status={b.status} /></TableCell>
                    <TableCell>
                      <div className="flex gap-0.5">
                        {b.status === 'confirmed' && <Button size="sm" variant="ghost" title="Check in" onClick={() => handleCheckIn(b.id)}><LogIn size={16} className="text-green-600" /></Button>}
                        {b.status === 'checked_in' && <Button size="sm" variant="ghost" title="Check out" onClick={() => handleCheckOut(b.id)}><LogOut size={16} className="text-blue-600" /></Button>}
                        {(b.status === 'confirmed' || b.status === 'pending') && <Button size="sm" variant="ghost" title="Cancel booking" onClick={() => handleCancel(b)}><Ban size={16} className="text-red-500" /></Button>}
                        {b.status === 'confirmed' && b.check_in < today && <Button size="sm" variant="ghost" title="Mark no-show" onClick={() => handleNoShow(b)}><UserX size={16} className="text-orange-500" /></Button>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {!loading && bookings.length === 0 && <TableRow><TableCell colSpan={9} className="text-center py-8 text-gray-500">No bookings found</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
