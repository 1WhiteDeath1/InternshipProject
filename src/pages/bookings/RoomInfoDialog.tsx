import { useCallback, useEffect, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { formatCurrency } from '@/lib/currency';
import { ROOM_TYPE_LABELS, todayISO, fmtDay, type CalendarData } from './shared';
import { RoomStatusPill, HousekeepingBadge, HraBadge } from './badges';

interface RoomInfoDialogProps {
  roomId: number | null;
  open: boolean;
  onClose: () => void;
}

/** Read-only room detail for view-only surfaces (Manager/Deputy Manager's
    Rooms page) - the same underlying data RoomSection uses, minus every
    booking/checkin/maintenance action. Nothing here ever mutates anything. */
export function RoomInfoDialog({ roomId, open, onClose }: RoomInfoDialogProps) {
  const [data, setData] = useState<CalendarData | null>(null);
  const [loading, setLoading] = useState(false);
  const today = todayISO();

  const load = useCallback(async () => {
    if (!roomId) return;
    setLoading(true);
    try {
      const now = new Date();
      const res = await api.get(`/bookings/rooms/${roomId}/calendar?year=${now.getFullYear()}&month=${now.getMonth() + 1}`);
      setData(res.data);
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to load room')); }
    finally { setLoading(false); }
  }, [roomId]);

  useEffect(() => { if (open && roomId) queueMicrotask(() => load()); }, [open, roomId, load]);

  const room = data?.room;
  const current = data?.current_booking;
  const arrivalToday = data?.stays.find(s => s.status === 'confirmed' && s.check_in <= today && today < s.check_out);

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        {loading && <p className="text-sm text-muted-foreground mt-4 px-1">Loading…</p>}

        {!loading && room && (
          <div className="space-y-4 mt-2 px-1">
            <SheetHeader>
              <SheetTitle className="flex items-center justify-between pr-6">
                <span>Room {room.room_number}</span>
                <span className="flex gap-1.5">
                  {current?.nature_of_duty === 'hra' && <HraBadge />}
                  <RoomStatusPill status={room.status} />
                  <HousekeepingBadge status={room.housekeeping_status} />
                </span>
              </SheetTitle>
            </SheetHeader>

            {room.photos.length > 0 && (
              <div className="relative w-full aspect-video rounded-lg overflow-hidden border bg-muted">
                <img src={room.photos[0].url} alt={`Room ${room.room_number}`} className="w-full h-full object-cover" />
              </div>
            )}

            <p className="text-sm text-muted-foreground">
              {ROOM_TYPE_LABELS[room.room_type] || room.room_type}{room.room_type === 'suite' ? ` · ${room.ac_count || 1}×AC` : ''}
              {' · '}Floor {room.floor} · Capacity {room.capacity} guests · {formatCurrency(room.base_price)}/night
            </p>

            {room.attendant_name && (
              <p className="text-sm text-muted-foreground">Attendant: <span className="text-foreground font-medium">{room.attendant_name}</span></p>
            )}

            {room.status === 'maintenance' && (
              <div className="rounded-lg border-2 border-border bg-muted p-3">
                <p className="text-sm font-semibold">Room under maintenance</p>
                <p className="text-xs text-muted-foreground">{room.notes ? room.notes : 'Check-in is blocked until maintenance ends.'}{room.maintenance_until ? ` · Est. back ${room.maintenance_until}` : ''}</p>
              </div>
            )}
            {room.status !== 'maintenance' && room.housekeeping_status !== 'clean' && (
              <div className="rounded-lg border-2 border-amber-400 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 p-3">
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">Room needs cleaning</p>
                <p className="text-xs text-amber-800 dark:text-amber-200">Housekeeping status: {room.housekeeping_status}</p>
              </div>
            )}

            {current && (
              <div className={`rounded-lg border p-3 ${current.checkout_due ? 'border-red-400 ring-1 ring-red-300' : ''}`}>
                <div className="flex items-center gap-1.5 mb-1">
                  <p className="text-xs text-muted-foreground">{current.nature_of_duty === 'hra' ? 'HRA resident' : 'Now staying'}</p>
                  {current.nature_of_duty === 'hra' && <HraBadge />}
                  {current.nature_of_duty !== 'hra' && current.is_indefinite && (
                    <span className="text-[10px] font-medium text-violet-700 bg-violet-50 dark:bg-violet-950 dark:text-violet-300 rounded px-1 py-0.5">Open-ended</span>
                  )}
                  {current.source === 'online' && <span className="text-[10px] font-medium text-blue-700 bg-blue-50 dark:bg-blue-950 dark:text-blue-300 rounded px-1 py-0.5">Online{current.online_voucher_no ? ` · V/No ${current.online_voucher_no}` : ''}</span>}
                </div>
                <p className="font-medium">{current.rank ? `${current.rank} ` : ''}{current.guest_name}</p>
                <p className="text-xs text-muted-foreground">{current.booking_reference}{current.guest_phone ? ` · ${current.guest_phone}` : ''}</p>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  {current.client_category && <p><span className="text-muted-foreground">Category:</span> {current.client_category.replace(/_/g, ' ')}</p>}
                  {current.guest_id_number && <p><span className="text-muted-foreground">{(current.guest_id_type || 'ID').toUpperCase()}:</span> {current.guest_id_number}</p>}
                  {current.pa_number && <p><span className="text-muted-foreground">PA No:</span> {current.pa_number}</p>}
                  {current.unit_address && <p><span className="text-muted-foreground">Unit:</span> {current.unit_address}</p>}
                  {current.reference_person && <p className="col-span-2"><span className="text-muted-foreground">Reference:</span> {current.reference_person}</p>}
                  {current.special_requests && <p className="col-span-2"><span className="text-muted-foreground">Remarks:</span> {current.special_requests}</p>}
                </div>
                <div className="flex items-center justify-between mt-2 text-sm">
                  <span>
                    {current.nature_of_duty === 'hra' ? `Resident since ${fmtDay(current.check_in)}`
                      : current.is_indefinite ? `Since ${fmtDay(current.check_in)} — open-ended`
                      : `${fmtDay(current.check_in)} → ${fmtDay(current.check_out)}`}
                  </span>
                  {current.nature_of_duty !== 'hra' && <span className="font-medium">{formatCurrency(current.total_amount)}</span>}
                </div>
              </div>
            )}

            {!current && arrivalToday && (
              <div className="rounded-lg border p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <p className="text-xs text-muted-foreground">Arriving today</p>
                  {arrivalToday.nature_of_duty === 'hra' && <HraBadge />}
                </div>
                <p className="font-medium">{arrivalToday.guest_name}</p>
                <p className="text-xs text-muted-foreground">{arrivalToday.booking_reference}</p>
              </div>
            )}

            {!current && !arrivalToday && (
              <p className="text-sm text-muted-foreground">Vacant — no current occupant.</p>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
