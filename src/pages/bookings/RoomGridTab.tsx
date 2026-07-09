import { useCallback, useEffect, useMemo, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { DoorOpen, Zap, CalendarDays } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import {
  ROOM_TYPE_LABELS, todayISO, addDays, fmtDay, selectClass, roomStatusColor,
  type Room, type AvailableRoom,
} from './shared';
import { HraBadge } from './badges';
import type { InitialBooking } from './RoomSection';

interface RoomGridTabProps {
  rooms: Room[];
  onOpenRoom: (roomId: number, initialBooking?: InitialBooking) => void;
}

type SortBy = 'availability' | 'room_number' | 'room_type';

interface GridCard {
  id: number;
  room_number: string;
  room_type: string;
  floor: number;
  available: boolean;
  statusLabel: string;
  housekeeping_status: string;
  guestLine?: string;
  priceLine?: string;
  isHra?: boolean;
}

export default function RoomGridTab({ rooms, onOpenRoom }: RoomGridTabProps) {
  const [mode, setMode] = useState<'instant' | 'future'>('instant');
  const [futureIn, setFutureIn] = useState(addDays(todayISO(), 1));
  const [futureOut, setFutureOut] = useState(addDays(todayISO(), 2));
  const [futureRooms, setFutureRooms] = useState<AvailableRoom[]>([]);
  const [futureLoading, setFutureLoading] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>('availability');
  const [hideUnavailable, setHideUnavailable] = useState(false);

  const futureValid = futureIn && futureOut && futureOut > futureIn;

  const fetchFuture = useCallback(async () => {
    if (!futureValid) { setFutureRooms([]); return; }
    setFutureLoading(true);
    try {
      const res = await api.get(`/bookings/availability?check_in=${futureIn}&check_out=${futureOut}&include_booked=true`);
      setFutureRooms(res.data.items);
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to check availability')); }
    finally { setFutureLoading(false); }
  }, [futureIn, futureOut, futureValid]);

  useEffect(() => { if (mode === 'future') queueMicrotask(() => fetchFuture()); }, [mode, fetchFuture]);

  const handleCardClick = (card: GridCard) => {
    if (mode === 'instant') {
      onOpenRoom(card.id, card.statusLabel === 'vacant' ? { check_in: todayISO(), check_out: addDays(todayISO(), 1), check_in_now: true } : undefined);
    } else {
      onOpenRoom(card.id, card.available ? { check_in: futureIn, check_out: futureOut, check_in_now: futureIn === todayISO() } : undefined);
    }
  };

  const cards: GridCard[] = useMemo(() => {
    if (mode === 'instant') {
      return rooms.map(r => ({
        id: r.id, room_number: r.room_number, room_type: r.room_type, floor: r.floor,
        available: r.status === 'vacant', statusLabel: r.status, housekeeping_status: r.housekeeping_status,
        guestLine: r.current_guest ? r.current_guest : r.arrival_guest ? `Arriving: ${r.arrival_guest}` : undefined,
        isHra: r.current_nature_of_duty === 'hra' || r.arrival_nature_of_duty === 'hra',
      }));
    }
    return futureRooms.map(r => ({
      id: r.id, room_number: r.room_number, room_type: r.room_type, floor: r.floor,
      available: r.available, housekeeping_status: r.housekeeping_status,
      statusLabel: r.available ? 'vacant' : (r.unavailable_reason === 'maintenance' ? 'maintenance' : 'reserved'),
      guestLine: !r.available ? r.unavailable_reason || undefined : (r.next_booking_start ? `Next booking ${fmtDay(r.next_booking_start)}` : 'No upcoming bookings'),
      priceLine: r.available ? (r.pricing.pricing_mode === 'hra_monthly' ? (r.pricing.monthly_total ? `${formatCurrency(r.pricing.monthly_total)}/month` : 'HRA monthly') : `${formatCurrency(r.pricing.nightly_total)}/night · ${formatCurrency(r.pricing.total)}`) : undefined,
    }));
  }, [mode, rooms, futureRooms]);

  const floorGroups = useMemo(() => {
    const filtered = hideUnavailable ? cards.filter(c => c.available) : cards;
    const byFloor = new Map<number, GridCard[]>();
    for (const c of filtered) {
      if (!byFloor.has(c.floor)) byFloor.set(c.floor, []);
      byFloor.get(c.floor)!.push(c);
    }
    const sorters: Record<SortBy, (a: GridCard, b: GridCard) => number> = {
      availability: (a, b) => (b.available ? 1 : 0) - (a.available ? 1 : 0) || a.room_number.localeCompare(b.room_number, undefined, { numeric: true }),
      room_number: (a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true }),
      room_type: (a, b) => (ROOM_TYPE_LABELS[a.room_type] || a.room_type).localeCompare(ROOM_TYPE_LABELS[b.room_type] || b.room_type) || a.room_number.localeCompare(b.room_number, undefined, { numeric: true }),
    };
    return [...byFloor.entries()]
      .sort(([a], [b]) => a - b)
      .map(([floor, list]) => [floor, [...list].sort(sorters[sortBy])] as const);
  }, [cards, sortBy, hideUnavailable]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-md border overflow-hidden">
              <button type="button" onClick={() => setMode('instant')}
                className={`px-4 py-2 text-sm flex items-center gap-1.5 ${mode === 'instant' ? 'bg-blue-100 text-blue-800 font-medium dark:bg-blue-900 dark:text-blue-100' : 'text-gray-500'}`}>
                <Zap size={14} /> Instant Check-In
              </button>
              <button type="button" onClick={() => setMode('future')}
                className={`px-4 py-2 text-sm flex items-center gap-1.5 border-l ${mode === 'future' ? 'bg-blue-100 text-blue-800 font-medium dark:bg-blue-900 dark:text-blue-100' : 'text-gray-500'}`}>
                <CalendarDays size={14} /> Future Booking
              </button>
            </div>
            {mode === 'future' && (
              <div className="flex items-center gap-2">
                <Input type="date" className="w-36" value={futureIn} min={todayISO()} onChange={e => { setFutureIn(e.target.value); if (futureOut <= e.target.value) setFutureOut(addDays(e.target.value, 1)); }} />
                <span className="text-gray-400 text-sm">→</span>
                <Input type="date" className="w-36" value={futureOut} min={addDays(futureIn, 1)} onChange={e => setFutureOut(e.target.value)} />
                {futureLoading && <span className="text-xs text-gray-400">Checking…</span>}
              </div>
            )}
            <div className="ml-auto flex items-center gap-3">
              <select className={`${selectClass} w-44`} value={sortBy} onChange={e => setSortBy(e.target.value as SortBy)}>
                <option value="availability">Sort: Availability first</option>
                <option value="room_number">Sort: Room number</option>
                <option value="room_type">Sort: Room type</option>
              </select>
              <label className="text-xs text-gray-500 flex items-center gap-1.5 whitespace-nowrap">
                <input type="checkbox" checked={hideUnavailable} onChange={e => setHideUnavailable(e.target.checked)} /> Hide unavailable
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

      {floorGroups.map(([floor, list]) => (
        <div key={floor}>
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Floor {floor}</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-4">
            {list.map(card => (
              <Card key={card.id} onClick={() => handleCardClick(card)}
                className={`cursor-pointer hover:shadow-md transition-all ${roomStatusColor(card.statusLabel)} ${!card.available && mode === 'future' ? 'opacity-60' : ''}`}>
                <CardContent className="p-4 text-center">
                  <DoorOpen size={24} className="mx-auto mb-2 opacity-60" />
                  <p className="font-bold text-lg">{card.room_number}</p>
                  <p className="text-xs capitalize">{ROOM_TYPE_LABELS[card.room_type] || card.room_type}</p>
                  <p className="text-xs font-medium mt-1 capitalize">{card.statusLabel}</p>
                  {card.isHra && <div className="mt-1 flex justify-center"><HraBadge /></div>}
                  {card.guestLine && <p className="text-[11px] mt-1 truncate opacity-75">{card.guestLine}</p>}
                  {card.priceLine && <p className="text-[11px] mt-1 font-medium">{card.priceLine}</p>}
                  {mode === 'instant' && card.housekeeping_status !== 'clean' && (
                    <p className="text-[11px] mt-1 font-medium text-amber-700">{card.housekeeping_status === 'cleaning' ? 'Cleaning' : 'Needs cleaning'}</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}
      {floorGroups.length === 0 && <p className="text-sm text-gray-500 text-center py-8">No rooms match the current filters.</p>}
    </div>
  );
}
