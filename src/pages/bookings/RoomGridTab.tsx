import { useCallback, useEffect, useMemo, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { DoorOpen, Zap, CalendarDays, Search, Sparkles } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import {
  ROOM_TYPE_LABELS, todayISO, addDays, fmtDay, selectClass, ROOM_STATUS_META,
  type Room, type AvailableRoom,
} from './shared';
import { HraBadge, HousekeepingBadge, RoomStatusPill } from './badges';
import type { InitialBooking } from './RoomSection';

interface RoomGridTabProps {
  rooms: Room[];
  onOpenRoom: (roomId: number, initialBooking?: InitialBooking) => void;
}

type SortBy = 'smart' | 'availability' | 'room_number' | 'room_type' | 'price' | 'capacity';

// Preset quick filters. The instant-mode set covers day-to-day desk triage;
// the future-mode set is simpler since there's no housekeeping/HRA concept
// for a prospective stay.
type StatusFilter = 'all' | 'vacant' | 'occupied' | 'reserved' | 'checkout_due' | 'needs_cleaning' | 'hra' | 'available' | 'unavailable';

interface GridCard {
  id: number;
  room_number: string;
  room_type: string;
  floor: number;
  capacity: number;
  price: number;
  available: boolean;
  statusLabel: string;
  housekeeping_status: string;
  guestLine?: string;
  priceLine?: string;
  isHra?: boolean;
  checkoutDue?: boolean;
  arriving?: boolean;
}

const STATUS_PRIORITY: Record<string, number> = { vacant: 0, reserved: 1, occupied: 2, maintenance: 3 };

const SORT_LABELS: Record<SortBy, string> = {
  smart: 'Smart (needs attention first)',
  availability: 'Availability first',
  room_number: 'Room number',
  room_type: 'Room type',
  price: 'Price (low to high)',
  capacity: 'Capacity (largest first)',
};

const INSTANT_CHIPS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All Rooms' },
  { value: 'vacant', label: 'Vacant' },
  { value: 'occupied', label: 'Occupied' },
  { value: 'reserved', label: 'Reserved' },
  { value: 'checkout_due', label: 'Checkout Due' },
  { value: 'needs_cleaning', label: 'Needs Cleaning' },
  { value: 'hra', label: 'HRA' },
];

const FUTURE_CHIPS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All Rooms' },
  { value: 'available', label: 'Available' },
  { value: 'unavailable', label: 'Unavailable' },
];

export default function RoomGridTab({ rooms, onOpenRoom }: RoomGridTabProps) {
  const [mode, setMode] = useState<'instant' | 'future'>('instant');
  const [futureIn, setFutureIn] = useState(addDays(todayISO(), 1));
  const [futureOut, setFutureOut] = useState(addDays(todayISO(), 2));
  const [futureRooms, setFutureRooms] = useState<AvailableRoom[]>([]);
  const [futureLoading, setFutureLoading] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>('smart');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [roomTypeFilter, setRoomTypeFilter] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  const toggleRoomType = (t: string) => setRoomTypeFilter(prev => {
    const next = new Set(prev);
    if (next.has(t)) next.delete(t); else next.add(t);
    return next;
  });

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
  // A filter chip picked for one mode ("Checkout Due", "HRA"...) doesn't mean
  // anything in the other mode - reset to avoid an empty-looking grid.
  useEffect(() => { queueMicrotask(() => setStatusFilter('all')); }, [mode]);

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
        capacity: r.capacity, price: r.base_price,
        available: r.status === 'vacant', statusLabel: r.status, housekeeping_status: r.housekeeping_status,
        guestLine: r.current_guest ? r.current_guest : r.arrival_guest ? `Arriving: ${r.arrival_guest}` : undefined,
        priceLine: `${formatCurrency(r.base_price)}/night`,
        isHra: r.current_nature_of_duty === 'hra' || r.arrival_nature_of_duty === 'hra',
        checkoutDue: r.checkout_due,
        arriving: !!r.arrival_guest,
      }));
    }
    return futureRooms.map(r => ({
      id: r.id, room_number: r.room_number, room_type: r.room_type, floor: r.floor,
      capacity: r.capacity, price: r.pricing?.nightly_total ?? 0,
      available: r.available, housekeeping_status: r.housekeeping_status,
      statusLabel: r.available ? 'vacant' : (r.unavailable_reason === 'maintenance' ? 'maintenance' : 'reserved'),
      guestLine: !r.available ? r.unavailable_reason || undefined : (r.next_booking_start ? `Next booking ${fmtDay(r.next_booking_start)}` : 'No upcoming bookings'),
      priceLine: r.available ? (r.pricing.pricing_mode === 'hra_monthly' ? (r.pricing.monthly_total ? `${formatCurrency(r.pricing.monthly_total)}/month` : 'HRA monthly') : `${formatCurrency(r.pricing.nightly_total)}/night · ${formatCurrency(r.pricing.total)}`) : undefined,
    }));
  }, [mode, rooms, futureRooms]);

  const matchesFilter = useCallback((c: GridCard) => {
    if (roomTypeFilter.size > 0 && !roomTypeFilter.has(c.room_type)) return false;
    switch (statusFilter) {
      case 'all': return true;
      case 'vacant': return c.statusLabel === 'vacant';
      case 'occupied': return c.statusLabel === 'occupied';
      case 'reserved': return c.statusLabel === 'reserved';
      case 'checkout_due': return !!c.checkoutDue;
      case 'needs_cleaning': return c.housekeeping_status !== 'clean';
      case 'hra': return !!c.isHra;
      case 'available': return c.available;
      case 'unavailable': return !c.available;
      default: return true;
    }
  }, [statusFilter, roomTypeFilter]);

  const availableTypes = useMemo(() => [...new Set(cards.map(c => c.room_type))]
    .sort((a, b) => (ROOM_TYPE_LABELS[a] || a).localeCompare(ROOM_TYPE_LABELS[b] || b)), [cards]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cards.filter(c =>
      matchesFilter(c) &&
      (!q || c.room_number.toLowerCase().includes(q) ||
        (ROOM_TYPE_LABELS[c.room_type] || c.room_type).toLowerCase().includes(q) ||
        (c.guestLine || '').toLowerCase().includes(q)));
  }, [cards, matchesFilter, search]);

  const sorters: Record<SortBy, (a: GridCard, b: GridCard) => number> = {
    smart: (a, b) => {
      // Rooms that need a decision surface first: overdue checkouts, then
      // today's arrivals, then sellable/actionable rooms by status, then
      // whatever's left - tiebroken by floor and room number.
      const score = (c: GridCard) => c.checkoutDue ? 0 : c.arriving ? 1 : (STATUS_PRIORITY[c.statusLabel] ?? 9) + 2;
      return score(a) - score(b) || a.floor - b.floor || a.room_number.localeCompare(b.room_number, undefined, { numeric: true });
    },
    availability: (a, b) => (b.available ? 1 : 0) - (a.available ? 1 : 0) || a.room_number.localeCompare(b.room_number, undefined, { numeric: true }),
    room_number: (a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true }),
    room_type: (a, b) => (ROOM_TYPE_LABELS[a.room_type] || a.room_type).localeCompare(ROOM_TYPE_LABELS[b.room_type] || b.room_type) || a.room_number.localeCompare(b.room_number, undefined, { numeric: true }),
    price: (a, b) => a.price - b.price || a.room_number.localeCompare(b.room_number, undefined, { numeric: true }),
    capacity: (a, b) => b.capacity - a.capacity || a.room_number.localeCompare(b.room_number, undefined, { numeric: true }),
  };

  // Smart sort is meant to surface what needs attention across the WHOLE
  // property, so it renders as one flat prioritized list; every other sort
  // keeps the familiar floor-grouped layout.
  const flatSorted = useMemo(() => [...filtered].sort(sorters[sortBy]), [filtered, sortBy]); // eslint-disable-line react-hooks/exhaustive-deps

  const floorGroups = useMemo(() => {
    const byFloor = new Map<number, GridCard[]>();
    for (const c of filtered) {
      if (!byFloor.has(c.floor)) byFloor.set(c.floor, []);
      byFloor.get(c.floor)!.push(c);
    }
    return [...byFloor.entries()]
      .sort(([a], [b]) => a - b)
      .map(([floor, list]) => [floor, [...list].sort(sorters[sortBy])] as const);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sortBy]);

  const renderCard = (card: GridCard) => {
    const accent = (ROOM_STATUS_META[card.statusLabel] || ROOM_STATUS_META.maintenance).border;
    return (
      <Card key={card.id} onClick={() => handleCardClick(card)}
        className={`cursor-pointer hover:shadow-md transition-all border-l-4 ${accent} ${!card.available && mode === 'future' ? 'opacity-60' : ''} ${card.checkoutDue && mode === 'instant' ? 'ring-2 ring-red-500 animate-pulse' : ''}`}>
        <CardContent className="p-4">
          {card.checkoutDue && mode === 'instant' && (
            <p className="text-[10px] font-bold text-white bg-red-600 rounded px-1.5 py-0.5 mb-2 text-center leading-tight">
              Action Required: Extend or Checkout
            </p>
          )}
          <div className="flex items-start justify-between gap-1">
            <div className="min-w-0">
              <p className="font-bold text-lg leading-tight">{card.room_number}</p>
              <p className="text-xs text-gray-500 capitalize truncate">{ROOM_TYPE_LABELS[card.room_type] || card.room_type} · {card.capacity} guests</p>
            </div>
            <DoorOpen size={18} className="text-gray-300 dark:text-gray-600 shrink-0 mt-0.5" />
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            <RoomStatusPill status={card.statusLabel} />
            {card.isHra && <HraBadge />}
          </div>
          {card.guestLine && <p className="text-xs mt-2 truncate text-gray-600 dark:text-gray-300">{card.guestLine}</p>}
          {card.priceLine && <p className="text-xs mt-1 font-semibold">{card.priceLine}</p>}
          {mode === 'instant' && card.housekeeping_status !== 'clean' && (
            <div className="mt-1.5"><HousekeepingBadge status={card.housekeeping_status} /></div>
          )}
        </CardContent>
      </Card>
    );
  };

  const chips = mode === 'instant' ? INSTANT_CHIPS : FUTURE_CHIPS;

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
            <div className="relative ml-auto w-52">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" size={15} />
              <Input placeholder="Search room, type, guest…" className="pl-8 h-9" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <select className={`${selectClass} w-56`} value={sortBy} onChange={e => setSortBy(e.target.value as SortBy)}>
              {(Object.keys(SORT_LABELS) as SortBy[]).map(k => <option key={k} value={k}>{SORT_LABELS[k]}</option>)}
            </select>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {chips.map(chip => (
              <button key={chip.value} type="button" onClick={() => setStatusFilter(chip.value)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${statusFilter === chip.value
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-transparent text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-blue-400'}`}>
                {chip.label}
              </button>
            ))}
          </div>

          {availableTypes.length > 1 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-2 border-t">
              <span className="text-xs font-medium text-gray-400 shrink-0">Room Type</span>
              {availableTypes.map(t => (
                <label key={t} className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300 cursor-pointer select-none">
                  <input type="checkbox" className="rounded border-gray-300 dark:border-gray-600" checked={roomTypeFilter.has(t)} onChange={() => toggleRoomType(t)} />
                  {ROOM_TYPE_LABELS[t] || t}
                </label>
              ))}
              {roomTypeFilter.size > 0 && (
                <button type="button" onClick={() => setRoomTypeFilter(new Set())} className="text-xs text-blue-600 hover:underline">Clear</button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {sortBy === 'smart' ? (
        <div>
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1">
            <Sparkles size={12} /> Sorted by what needs attention
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-4">
            {flatSorted.map(renderCard)}
          </div>
        </div>
      ) : (
        floorGroups.map(([floor, list]) => (
          <div key={floor}>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Floor {floor}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-4">
              {list.map(renderCard)}
            </div>
          </div>
        ))
      )}
      {filtered.length === 0 && <p className="text-sm text-gray-500 text-center py-8">No rooms match the current filters.</p>}
    </div>
  );
}
