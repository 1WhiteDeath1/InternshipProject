import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { getErrorMessage } from '@/lib/api';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ROOM_TYPE_LABELS, selectClass, todayISO, addDays, type AvailableRoom } from '@/pages/bookings/shared';

interface QuickBookingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Global "+ New Booking" shortcut - bypasses the room grid: pick a room
    type and dates, and the first available clean room of that type is
    auto-assigned. The actual guest-registration form is not duplicated
    here - we hand off to the proven RoomSection booking form via a route
    state, the same way every other room-first flow in this app works. */
export function QuickBookingModal({ open, onOpenChange }: QuickBookingModalProps) {
  const navigate = useNavigate();
  const [roomType, setRoomType] = useState('standard');
  const [checkIn, setCheckIn] = useState(todayISO());
  const [checkOut, setCheckOut] = useState(addDays(todayISO(), 1));
  const [searching, setSearching] = useState(false);
  const [noRoomReason, setNoRoomReason] = useState<string | null>(null);

  const reset = () => {
    setRoomType('standard');
    setCheckIn(todayISO());
    setCheckOut(addDays(todayISO(), 1));
    setNoRoomReason(null);
  };

  const handleFind = async () => {
    if (!checkIn || !checkOut || checkOut <= checkIn) { toast.error('Check-out must be after check-in'); return; }
    setSearching(true);
    setNoRoomReason(null);
    try {
      const res = await api.get(`/bookings/availability?check_in=${checkIn}&check_out=${checkOut}&room_type=${roomType}`);
      const items: AvailableRoom[] = res.data.items;
      const room = items.find(r => r.available && r.housekeeping_status === 'clean') || items.find(r => r.available);
      if (!room) {
        setNoRoomReason(`No ${ROOM_TYPE_LABELS[roomType] || roomType} rooms are free for those dates.`);
        return;
      }
      onOpenChange(false);
      reset();
      navigate('/bookings', {
        state: {
          openRoomId: room.id,
          initialBooking: { check_in: checkIn, check_out: checkOut, check_in_now: checkIn === todayISO() },
        },
      });
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to search for a room')); }
    finally { setSearching(false); }
  };

  return (
    <Dialog open={open} onOpenChange={v => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Booking</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Room Type</Label>
            <select className={selectClass} value={roomType} onChange={e => { setRoomType(e.target.value); setNoRoomReason(null); }}>
              {Object.entries(ROOM_TYPE_LABELS).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Check In</Label>
              <Input type="date" value={checkIn} min={todayISO()}
                onChange={e => { setCheckIn(e.target.value); setCheckOut(c => c > e.target.value ? c : addDays(e.target.value, 1)); setNoRoomReason(null); }} />
            </div>
            <div>
              <Label className="text-xs">Check Out</Label>
              <Input type="date" value={checkOut} min={addDays(checkIn, 1)} onChange={e => { setCheckOut(e.target.value); setNoRoomReason(null); }} />
            </div>
          </div>
          {noRoomReason && <p className="text-sm text-red-600">{noRoomReason}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleFind} disabled={searching}>{searching ? 'Finding a room…' : 'Find & Book'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
