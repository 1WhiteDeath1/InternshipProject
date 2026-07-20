import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Search, LogIn, LogOut, Ban, UserX, TimerOff, Globe } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import { ConfirmDialog, type ConfirmRequest } from '@/components/ConfirmDialog';
import { todayISO, type Booking } from './shared';
import { StatusBadge } from './badges';

interface BookingsListTabProps {
  onChanged: () => void;
}

export default function BookingsListTab({ onChanged }: BookingsListTabProps) {
  const navigate = useNavigate();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  const fetchBookings = useCallback(async () => {
    try { const res = await api.get(`/bookings?search=${encodeURIComponent(search)}`); setBookings(res.data.items); }
    catch { toast.error('Failed to load bookings'); }
  }, [search]);

  useEffect(() => {
    queueMicrotask(() => {
      setLoading(true);
      fetchBookings().finally(() => setLoading(false));
    });
  }, [fetchBookings]);

  const refresh = useCallback(() => { fetchBookings(); onChanged(); }, [fetchBookings, onChanged]);

  const handleCheckIn = async (id: number) => {
    try { await api.post(`/bookings/${id}/check-in`); toast.success('Checked in'); refresh(); }
    catch (err) { toast.error(getErrorMessage(err, 'Failed')); }
  };
  const handleCancel = (b: Booking) => setConfirm({
    title: `Cancel booking ${b.booking_reference}?`,
    description: `${b.guest_name}'s reservation for Room ${b.room_number} will be cancelled and the room freed for those dates.`,
    confirmLabel: 'Cancel Booking', destructive: true,
    reasonLabel: 'Reason (optional)',
    onConfirm: async (reason) => {
      try { await api.post(`/bookings/${b.id}/cancel`, { reason: reason || undefined }); toast.success('Booking cancelled'); refresh(); }
      catch (err) { toast.error(getErrorMessage(err, 'Failed')); }
    },
  });
  const handleNoShow = (b: Booking) => setConfirm({
    title: `Mark ${b.booking_reference} as no-show?`,
    description: `${b.guest_name} never arrived for their ${b.check_in} stay. The booking will be closed and the room freed.`,
    confirmLabel: 'Mark No-Show', destructive: true,
    onConfirm: async () => {
      try { await api.post(`/bookings/${b.id}/no-show`); toast.success('Marked as no-show'); refresh(); }
      catch (err) { toast.error(getErrorMessage(err, 'Failed')); }
    },
  });
  const handleVoidExpired = (bookingId: number, guestName: string) => setConfirm({
    title: 'Void this booking?',
    description: `${guestName} did not arrive by the deadline. Voiding frees the room for tonight.`,
    confirmLabel: 'Void Booking', destructive: true,
    onConfirm: async () => {
      try { const res = await api.post(`/bookings/${bookingId}/void-expired`); toast.success(res.data.message); refresh(); }
      catch (err) { toast.error(getErrorMessage(err, 'Failed to void')); }
    },
  });

  const today = useMemo(() => todayISO(), []);
  const initials = (name: string) => name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();

  return (
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
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200 flex items-center justify-center text-[10px] font-semibold shrink-0">
                        {initials(b.guest_name)}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate">
                          {b.rank ? `${b.rank} ` : ''}{b.guest_name}
                          {b.source === 'online' && (
                            <span className="inline-flex items-center gap-0.5 ml-1.5 text-[10px] font-medium text-blue-700 bg-blue-50 dark:bg-blue-950 dark:text-blue-300 rounded px-1 py-0.5 align-middle" title={b.online_voucher_no ? `Online V/No ${b.online_voucher_no}` : 'Booked via online portal'}>
                              <Globe size={10} /> Online
                            </span>
                          )}
                        </p>
                        {b.member_name && <span className="block text-xs text-gray-500 truncate">Member: {b.member_name}</span>}
                        {b.arrival_overdue && <span className="block text-xs text-red-600 font-medium">Overdue arrival</span>}
                      </div>
                    </div>
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
                      {b.status === 'checked_in' && b.nature_of_duty !== 'hra' && (
                        <Button size="sm" variant="ghost" title="Send to Clerk Desk to bill"
                          onClick={() => navigate('/clerk-desk')}>
                          <LogOut size={16} className="text-blue-600" />
                        </Button>
                      )}
                      {b.arrival_overdue && <Button size="sm" variant="ghost" title="Void — guest did not arrive by deadline" onClick={() => handleVoidExpired(b.id, b.guest_name)}><TimerOff size={16} className="text-red-500" /></Button>}
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

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
