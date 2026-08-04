import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, fmtDay, type CalendarData, type CalendarStay } from './shared';
import type { BookingFormState } from './RoomSection';

interface RoomCalendarMiniProps {
  data: CalendarData | null;
  ym: { year: number; month: number };
  setYm: (updater: (ym: { year: number; month: number }) => { year: number; month: number }) => void;
  today: string;
  formOpen: boolean;
  form: BookingFormState;
  setForm: (updater: BookingFormState | ((f: BookingFormState) => BookingFormState)) => void;
}

/** Month calendar with click-and-drag date-range selection, feeding the
    booking form's dates directly - extracted as-is from the original
    inline implementation, just relocated under the gateway-first layout. */
export function RoomCalendarMini({ data, ym, setYm, today, formOpen, form, setForm }: RoomCalendarMiniProps) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  // Click-and-drag date-range selection: dragAnchor is where the pointer
  // went down, dragHover tracks the day currently under the pointer
  // (clamped so the live-highlighted range never crosses an
  // occupied/reserved day or a past date).
  const [dragAnchor, setDragAnchor] = useState<string | null>(null);
  const [dragHover, setDragHover] = useState<string | null>(null);

  const upcoming = data?.stays.filter(s => s.status === 'confirmed' && s.check_in > today) || [];

  const monthName = new Date(ym.year, ym.month - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const daysInMonth = new Date(ym.year, ym.month, 0).getDate();
  const firstDow = new Date(ym.year, ym.month - 1, 1).getDay();
  const pad = (n: number) => String(n).padStart(2, '0');
  const STAY_PRIORITY: Record<string, number> = { checked_in: 3, confirmed: 2, checked_out: 1 };
  const stayForIso = (iso: string): CalendarStay | undefined =>
    data?.stays
      .filter(s => s.check_in <= iso && iso < s.check_out)
      .sort((a, b) => (STAY_PRIORITY[b.status] || 0) - (STAY_PRIORITY[a.status] || 0))[0];
  const stayFor = (day: number) => stayForIso(`${ym.year}-${pad(ym.month)}-${pad(day)}`);
  const stayColor = (s: CalendarStay) =>
    s.status === 'checked_in' ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100'
      : s.status === 'confirmed' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100'
        : 'bg-gray-100 text-muted-foreground dark:bg-gray-800 dark:text-muted-foreground';

  const handleDayClick = (iso: string) => {
    setSelectedDay(iso);
    if (formOpen) {
      setForm(f => ({
        ...f, check_in: iso,
        check_out: f.check_out > iso ? f.check_out : addDays(iso, 1),
        check_in_now: iso === today ? f.check_in_now : false,
      }));
    }
  };

  // A day can anchor a drag when the booking form is open, it's a dated stay
  // (not HRA - HRA only has a single move-in date), it's today or later, and
  // it isn't already covered by an existing stay.
  const isDraggableDay = (iso: string) => formOpen && form.nature_of_duty !== 'hra' && iso >= today && !stayForIso(iso);

  const startDrag = (iso: string, e: React.PointerEvent<HTMLButtonElement>) => {
    if (!isDraggableDay(iso)) return;
    setDragAnchor(iso);
    setDragHover(iso);
    setSelectedDay(null);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* unsupported for this pointer type - drag still works via document.elementFromPoint */ }
  };

  // Walks day-by-day from the anchor toward `candidate`, stopping at the last
  // free day before hitting a past date or an existing stay - so the live
  // preview can never span across a booked day.
  const furthestFreeDay = (anchor: string, candidate: string): string => {
    if (candidate === anchor) return anchor;
    const dir = candidate < anchor ? -1 : 1;
    let cursor = anchor;
    let result = anchor;
    while (cursor !== candidate) {
      cursor = addDays(cursor, dir);
      if (cursor < today || stayForIso(cursor)) break;
      result = cursor;
    }
    return result;
  };

  const moveDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragAnchor) return;
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const iso = el?.dataset.day;
    if (!iso) return;
    setDragHover(furthestFreeDay(dragAnchor, iso));
  };

  const endDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    // Releasing capture can throw if the browser already released it (common
    // for touch, or if the pointer left the window) - must never block the
    // selection from committing below.
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    if (!dragAnchor || !dragHover) { setDragAnchor(null); setDragHover(null); return; }
    const lo = dragHover < dragAnchor ? dragHover : dragAnchor;
    const hi = dragHover < dragAnchor ? dragAnchor : dragHover;
    setForm(f => ({
      ...f, check_in: lo, check_out: addDays(hi, 1),
      check_in_now: lo === today ? f.check_in_now : false,
    }));
    setDragAnchor(null);
    setDragHover(null);
  };

  const dragging = dragAnchor !== null && dragHover !== null;
  const dragLo = dragging ? (dragHover! < dragAnchor! ? dragHover! : dragAnchor!) : null;
  const dragHi = dragging ? (dragHover! < dragAnchor! ? dragAnchor! : dragHover!) : null;
  const dragNights = dragging ? Math.round((new Date(dragHi!).getTime() - new Date(dragLo!).getTime()) / 86400000) + 1 : 0;

  return (
    <>
      <div>
        <div className="flex items-center justify-between mb-1">
          <Button size="sm" variant="ghost" onClick={() => setYm(({ year, month }) => month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 })}><ChevronLeft size={16} /></Button>
          <p className="text-sm font-medium">{monthName}</p>
          <Button size="sm" variant="ghost" onClick={() => setYm(({ year, month }) => month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 })}><ChevronRight size={16} /></Button>
        </div>
        <div className="grid grid-cols-7 gap-0.5 text-center">
          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => <div key={d} className="text-[11px] text-muted-foreground py-1">{d}</div>)}
          {Array.from({ length: firstDow }).map((_, i) => <div key={`b${i}`} />)}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const iso = `${ym.year}-${pad(ym.month)}-${pad(day)}`;
            const stay = stayFor(day);
            const draggable = isDraggableDay(iso);
            const inDragRange = dragging && dragLo! <= iso && iso <= dragHi!;
            const props = draggable
              ? { onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => startDrag(iso, e), onPointerMove: moveDrag, onPointerUp: endDrag }
              : { onClick: () => handleDayClick(iso) };
            return (
              <button type="button" key={day} data-day={iso} {...props}
                className={`text-xs rounded py-1.5 select-none touch-none
                  ${inDragRange ? 'bg-blue-500 text-white font-semibold ring-2 ring-blue-700 dark:ring-blue-400'
                    : stay ? stayColor(stay) + ' font-medium' : ''}
                  ${iso === today ? 'ring-1 ring-gray-500' : ''}
                  ${draggable && !inDragRange ? 'hover:bg-blue-50 dark:hover:bg-blue-950 cursor-pointer' : ''}`}>
                {day}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground min-h-4 mt-1.5">
          {dragging
            ? <span className="text-blue-700 dark:text-blue-300 font-medium">{fmtDay(dragLo!)} → {fmtDay(dragHi!)} · {dragNights} night{dragNights > 1 ? 's' : ''}</span>
            : selectedDay
              ? (() => {
                const s = stayFor(Number(selectedDay.split('-')[2]));
                return s ? `${s.guest_name} · ${s.status.replace(/_/g, ' ')} · ${fmtDay(s.check_in)}–${fmtDay(s.check_out)} (${s.booking_reference})` : formOpen ? `${fmtDay(selectedDay)} · set as check-in` : `${fmtDay(selectedDay)} · free`;
              })()
              : formOpen && form.nature_of_duty !== 'hra' ? 'Click and drag across days to select your stay, or tap a single day'
                : formOpen ? 'Tap the move-in day' : 'Tap a day to see its booking'}
        </p>
        <div className="flex gap-3 text-[11px] text-muted-foreground mt-1">
          <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-200 align-middle mr-1" />In-house</span>
          <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-blue-200 align-middle mr-1" />Reserved</span>
          <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-gray-200 align-middle mr-1" />Past stay</span>
        </div>
      </div>

      {upcoming.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-1">Upcoming</p>
          {upcoming.map(s => (
            <div key={s.id} className="flex justify-between text-sm border rounded-md px-2.5 py-1.5 mb-1">
              <span>{s.guest_name} <span className="text-muted-foreground text-xs">{s.booking_reference}</span></span>
              <span className="text-blue-700 dark:text-blue-300">{fmtDay(s.check_in)}–{fmtDay(s.check_out)}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
