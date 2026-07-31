import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  todayISO, addDays, fmtDay, cellKind, isOpenEnded, OCCUPANCY_META,
  type CalendarDaySummary, type RoomWeekData, type RoomWeekRoom, type OccupancyKind,
} from './shared';

type ViewMode = 'week' | 'month' | 'room-month';

interface RoomGridData {
  dates: string[];
  rooms: RoomWeekRoom[];
}

interface CalendarTabProps {
  onOpenRoom: (roomId: number) => void;
}

// Which kinds get a legend entry in the grid views, in reading order.
const GRID_LEGEND: OccupancyKind[] = [
  'guest', 'hra', 'indefinite', 'official_duty', 'leave', 'reserved', 'departed', 'maintenance',
];
// The month view only ever aggregates these four buckets (see the backend's
// kind_counts) - official_duty/leave fold into 'guest' there.
const MONTH_MIX: OccupancyKind[] = ['hra', 'indefinite', 'guest', 'reserved'];

function LegendSwatch({ kind, faded }: { kind: OccupancyKind; faded?: boolean }) {
  const meta = OCCUPANCY_META[kind];
  return (
    <span className="flex items-center gap-1">
      <span className="w-3 h-3 rounded-sm inline-block"
        style={faded
          ? { background: `linear-gradient(to right, ${meta.hex}, transparent)` }
          : { background: meta.hex }} />
      {faded ? 'Continues (no end date)' : meta.label}
    </span>
  );
}

function addMonths(iso: string, n: number): string {
  const [y, m] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1 + n, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-01`;
}
function startOfWeek(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return addDays(iso, -new Date(y, m - 1, d).getDay());
}
function startOfMonth(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  return `${y}-${String(m).padStart(2, '0')}-01`;
}

// occupied/total -> a read-at-a-glance intensity bucket, shared by every month day cell
function intensity(occupied: number, total: number): string {
  if (!total || occupied === 0) return 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-800';
  const pct = occupied / total;
  if (pct < 0.5) return 'bg-emerald-50 dark:bg-emerald-950 border-emerald-200 dark:border-emerald-900';
  if (pct < 0.85) return 'bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-900';
  return 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-900';
}

// Shared by the Week view (7 columns) and the Room Month view (1..31 columns)
// - both are just a room-rows x date-columns grid, differing only in the
// date range fetched.
function RoomWeekGrid({ data, onOpenRoom }: { data: RoomGridData; onOpenRoom: (roomId: number) => void }) {
  const today = todayISO();

  const floorGroups = useMemo(() => {
    const byFloor = new Map<number, RoomWeekRoom[]>();
    for (const r of data.rooms) {
      if (!byFloor.has(r.floor)) byFloor.set(r.floor, []);
      byFloor.get(r.floor)!.push(r);
    }
    return [...byFloor.entries()].sort(([a], [b]) => a - b);
  }, [data]);

  return (
    <Card>
      <CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b">
              <th className="text-left font-medium text-gray-500 text-xs py-2 px-3 sticky left-0 bg-white dark:bg-gray-950">Room</th>
              {data.dates.map(d => (
                <th key={d} className={`text-center font-medium text-xs py-2 px-2 min-w-20 ${d === today ? 'text-gray-900 dark:text-white' : 'text-gray-500'}`}>{fmtDay(d)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {floorGroups.map(([floor, rooms]) => (
              <Fragment key={floor}>
                <tr>
                  <td colSpan={data.dates.length + 1} className="bg-gray-50 dark:bg-gray-900 text-xs font-medium text-gray-400 uppercase tracking-wide py-1 px-3">Floor {floor}</td>
                </tr>
                {rooms.map(r => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-1.5 px-3 font-medium sticky left-0 bg-white dark:bg-gray-950 cursor-pointer hover:underline" onClick={() => onOpenRoom(r.id)}>
                      {r.room_number}
                    </td>
                    {r.cells.map((c, i) => {
                      const kind = cellKind(c);
                      const meta = OCCUPANCY_META[kind];
                      // A run with no real end date gets its trailing edge
                      // faded rather than stopping in a hard line - the stay
                      // genuinely continues past whatever the window shows,
                      // so a crisp edge would be asserting a departure date
                      // nobody has agreed to.
                      const next = r.cells[i + 1];
                      const fadeEdge = isOpenEnded(c)
                        && (!next || !isOpenEnded(next) || next.booking_reference !== c.booking_reference);
                      const openEnded = isOpenEnded(c);
                      return (
                        <td key={c.date}
                          title={c.guest_name
                            ? `${c.guest_name}${c.booking_reference ? ` (${c.booking_reference})` : ''} — ${meta.label}${openEnded ? ', no end date set' : ''}`
                            : meta.label}
                          onClick={() => onOpenRoom(r.id)}
                          className={`p-0 cursor-pointer max-w-20 ${c.date === today ? 'ring-1 ring-inset ring-gray-400' : ''}`}>
                          <div
                            className={`text-center text-[11px] py-1.5 px-1 truncate ${fadeEdge ? '' : meta.cell}`}
                            style={fadeEdge ? { background: `linear-gradient(to right, ${meta.hex}, transparent)` } : undefined}>
                            {c.guest_name ? c.guest_name.split(' ')[0] : ''}
                            {fadeEdge && <span className="text-gray-500 dark:text-gray-300"> ›</span>}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

/** The day's occupancy split as one thin stacked bar. The intensity wash
    behind a month cell says HOW full the mess was; this says WHAT of - a
    day that's full of long-term residents is a completely different
    business day from one full of two-night guests, and the ratio alone
    could never show that. */
function MixBar({ counts, total }: { counts: CalendarDaySummary['kind_counts']; total: number }) {
  const kinds = MONTH_MIX.filter(k => (counts?.[k as keyof typeof counts] ?? 0) > 0);
  if (!total || kinds.length === 0) return <div className="h-1" />;
  return (
    <div className="flex h-1 w-full rounded-sm overflow-hidden bg-gray-200/60 dark:bg-gray-700/60">
      {kinds.map(k => (
        <span key={k}
          style={{ background: OCCUPANCY_META[k].hex, width: `${(counts[k as keyof typeof counts] / total) * 100}%` }} />
      ))}
    </div>
  );
}

function guestKind(g: CalendarDaySummary['guests'][number]): OccupancyKind {
  if (g.nature_of_duty === 'hra') return 'hra';
  if (g.status === 'checked_out') return 'departed';
  if (g.is_indefinite) return 'indefinite';
  if (g.status === 'confirmed') return 'reserved';
  if (g.nature_of_duty === 'official_duty') return 'official_duty';
  if (g.nature_of_duty === 'leave') return 'leave';
  return 'guest';
}

function DayCell({ day, isToday, onOpenRoom }: { day: CalendarDaySummary; isToday: boolean; onOpenRoom: (roomId: number) => void }) {
  const [open, setOpen] = useState(false);
  const dayNum = Number(day.date.split('-')[2]);
  const shown = day.guests.slice(0, 2);
  const overflow = day.guests.length - shown.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button"
          className={`min-h-24 rounded-md border p-1.5 text-left flex flex-col gap-0.5 transition-colors hover:opacity-80 ${intensity(day.occupied, day.total_rooms)} ${isToday ? 'ring-2 ring-primary' : ''}`}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">{dayNum}</span>
            {day.total_rooms > 0 && <span className="text-[10px] text-gray-600 dark:text-gray-300">{day.occupied}/{day.total_rooms}</span>}
          </div>
          <MixBar counts={day.kind_counts} total={day.total_rooms} />
          <div className="flex-1 space-y-0.5 overflow-hidden">
            {shown.map((g, i) => (
              <p key={i} className="text-[10px] leading-tight truncate flex items-center gap-1 text-gray-700 dark:text-gray-300">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: OCCUPANCY_META[guestKind(g)].hex }} />
                {g.guest_name}
              </p>
            ))}
            {overflow > 0 && <p className="text-[10px] leading-tight text-gray-400">+{overflow} more</p>}
          </div>
          {(day.arrivals > 0 || day.departures > 0) && (
            <span className="text-[10px] text-gray-400">
              {day.arrivals > 0 && <>A{day.arrivals} </>}
              {day.departures > 0 && <>D{day.departures}</>}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <p className="text-sm font-medium mb-1">{fmtDay(day.date)}</p>
        {day.kind_counts && day.occupied + day.reserved > 0 && (
          <p className="text-xs text-gray-500 mb-2 flex flex-wrap gap-x-2 gap-y-0.5">
            {MONTH_MIX.filter(k => day.kind_counts[k as keyof typeof day.kind_counts] > 0).map(k => (
              <span key={k} className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full" style={{ background: OCCUPANCY_META[k].hex }} />
                {day.kind_counts[k as keyof typeof day.kind_counts]} {OCCUPANCY_META[k].label.toLowerCase()}
              </span>
            ))}
          </p>
        )}
        {day.guests.length === 0 && <p className="text-xs text-gray-400">No bookings this day</p>}
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {day.guests.map((g, i) => {
            const k = guestKind(g);
            return (
              <button key={i} type="button" onClick={() => onOpenRoom(g.room_id)}
                className="w-full flex items-center justify-between gap-2 text-xs px-2 py-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-left">
                <span className="truncate flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: OCCUPANCY_META[k].hex }} />
                  {g.rank ? `${g.rank} ` : ''}{g.guest_name}
                  {(k === 'hra' || k === 'indefinite') && <span className="text-gray-400 shrink-0">›</span>}
                </span>
                <span className="text-gray-400 shrink-0">Rm {g.room_number} · {OCCUPANCY_META[k].label}</span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function MonthGrid({ days, onOpenRoom }: { days: CalendarDaySummary[]; onOpenRoom: (roomId: number) => void }) {
  const today = todayISO();
  const leadingBlanks = days.length > 0
    ? new Date(Number(days[0].date.split('-')[0]), Number(days[0].date.split('-')[1]) - 1, Number(days[0].date.split('-')[2])).getDay()
    : 0;

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => <div key={d} className="text-center text-xs text-gray-400 font-medium">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: leadingBlanks }).map((_, i) => <div key={`b${i}`} />)}
        {days.map(day => <DayCell key={day.date} day={day} isToday={day.date === today} onOpenRoom={onOpenRoom} />)}
      </div>
    </div>
  );
}

export default function CalendarTab({ onOpenRoom }: CalendarTabProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [anchor, setAnchor] = useState(todayISO());
  const [weekData, setWeekData] = useState<RoomWeekData | null>(null);
  const [monthDays, setMonthDays] = useState<CalendarDaySummary[]>([]);
  const [roomMonthData, setRoomMonthData] = useState<RoomGridData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      if (viewMode === 'week') {
        const start = startOfWeek(anchor);
        const res = await api.get(`/bookings/room-week?start=${start}`);
        setWeekData(res.data);
      } else if (viewMode === 'room-month') {
        const [y, m] = startOfMonth(anchor).split('-').map(Number);
        const res = await api.get(`/bookings/room-month?year=${y}&month=${m}`);
        setRoomMonthData({ dates: res.data.dates, rooms: res.data.rooms });
      } else {
        const start = startOfMonth(anchor);
        const end = addMonths(start, 1);
        const res = await api.get(`/bookings/calendar-summary?start=${start}&end=${end}&granularity=day`);
        setMonthDays(res.data.days);
      }
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to load the calendar')); }
    finally { setLoading(false); }
  }, [viewMode, anchor]);

  useEffect(() => { queueMicrotask(() => fetchData()); }, [fetchData]);

  const stepBack = () => setAnchor(viewMode === 'week' ? addDays(anchor, -7) : addMonths(anchor, -1));
  const stepForward = () => setAnchor(viewMode === 'week' ? addDays(anchor, 7) : addMonths(anchor, 1));
  const viewLabels: Record<ViewMode, string> = { week: 'Week', month: 'Month', 'room-month': 'Rooms (Month)' };

  const periodLabel = useMemo(() => {
    if (viewMode === 'week') {
      const start = startOfWeek(anchor);
      return `${fmtDay(start)} – ${fmtDay(addDays(start, 6))}, ${start.split('-')[0]}`;
    }
    const [y, m] = anchor.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  }, [viewMode, anchor]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="outline" onClick={stepBack}><ChevronLeft size={16} /></Button>
          <Button size="sm" variant="outline" onClick={() => setAnchor(todayISO())}>Today</Button>
          <Button size="sm" variant="outline" onClick={stepForward}><ChevronRight size={16} /></Button>
          <p className="text-sm font-semibold ml-2">{periodLabel}</p>
        </div>
        <div className="flex rounded-md border overflow-hidden">
          {(['week', 'month', 'room-month'] as ViewMode[]).map(m => (
            <button key={m} type="button" onClick={() => setViewMode(m)}
              className={`px-3 py-1.5 text-xs font-medium whitespace-nowrap ${viewMode === m ? 'bg-black text-white dark:bg-white dark:text-black' : 'bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
              {viewLabels[m]}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {!loading && viewMode === 'week' && weekData && <RoomWeekGrid data={weekData} onOpenRoom={onOpenRoom} />}
      {!loading && viewMode === 'month' && <MonthGrid days={monthDays} onOpenRoom={onOpenRoom} />}
      {!loading && viewMode === 'room-month' && roomMonthData && <RoomWeekGrid data={roomMonthData} onOpenRoom={onOpenRoom} />}

      {!loading && viewMode === 'month' && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
            <span className="text-gray-400">Cell shade = how full:</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 inline-block" /> Empty</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-900 inline-block" /> Low occupancy</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-900 inline-block" /> Busy</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 inline-block" /> Full</span>
            <span>A = arrivals, D = departures</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
            <span className="text-gray-400">Bar &amp; dots = what of:</span>
            {MONTH_MIX.map(k => <LegendSwatch key={k} kind={k} />)}
          </div>
        </div>
      )}
      {!loading && (viewMode === 'week' || viewMode === 'room-month') && (
        <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
          {GRID_LEGEND.map(k => <LegendSwatch key={k} kind={k} />)}
          <LegendSwatch kind="indefinite" faded />
        </div>
      )}
    </div>
  );
}
