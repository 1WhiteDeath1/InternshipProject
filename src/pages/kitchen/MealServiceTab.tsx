import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';
import { Search, UtensilsCrossed, RotateCw } from 'lucide-react';
import { defaultMealForNow } from '@/lib/mealDefaults';

interface LookupResult {
  kind: 'member' | 'booking';
  id: number;
  name: string;
  sub_label: string | null;
  menu_item_id: number | null;
  attendance_id: number | null;
  attendance_status: string | null;
}

const MEAL_OPTIONS = ['breakfast', 'lunch', 'hitea', 'dinner'];

function IntentPill({ status }: { status: string | null }) {
  if (status === 'no_show') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300">
        <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-red-500" /> No-Show
      </span>
    );
  }
  if (status === 'booked' || status === 'attended') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
        <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-emerald-500" /> Intent Confirmed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
      <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-amber-500" /> No Intent Marked
    </span>
  );
}

interface MealServiceTabProps {
  onSpecialOrder: (kind: 'member' | 'booking', id: number) => void;
}

export function MealServiceTab({ onSpecialOrder }: MealServiceTabProps) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [meal, setMeal] = useState<string>(defaultMealForNow());
  const [q, setQ] = useState('');
  const [results, setResults] = useState<LookupResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced server search - mirrors the guest-search pattern in
  // RoomSection.tsx (plain useEffect + setTimeout, min-length 2).
  useEffect(() => {
    if (q.trim().length < 2) { queueMicrotask(() => setResults([])); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.get(`/attendance/lookup?q=${encodeURIComponent(q.trim())}&date=${date}&meal_type=${meal}`);
        setResults(res.data);
      } catch (err) { toast.error(getErrorMessage(err, 'Search failed')); }
      finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [q, date, meal]);

  const serveMeal = async (r: LookupResult) => {
    try {
      const res = await api.post('/attendance/serve', {
        member_id: r.kind === 'member' ? r.id : undefined,
        booking_id: r.kind === 'booking' ? r.id : undefined,
        date, meal_type: meal, menu_item_id: r.menu_item_id ?? undefined,
      });
      // Patch just this row in place - do not clear the search string or
      // refetch, so the omnibar's focus and query survive back-to-back serves.
      setResults(prev => prev.map(x => (x.kind === r.kind && x.id === r.id)
        ? { ...x, attendance_id: res.data.id, attendance_status: res.data.status }
        : x));
      toast.success(`Served ${r.name}`);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 409) {
        const reason = err.response.data?.detail;
        if (reason === 'cancelled' || reason === 'excluded') {
          toast.warning(reason === 'cancelled'
            ? 'Cannot Serve: this person explicitly cancelled this meal.'
            : 'Cannot Serve: this person is on leave.');
        } else {
          toast.error(getErrorMessage(err, 'Could not serve this meal'));
        }
      } else {
        toast.error(getErrorMessage(err, 'Could not serve this meal'));
      }
    }
    inputRef.current?.focus();
  };

  const runNoShowCheck = async () => {
    setSweeping(true);
    try {
      const res = await api.post(`/attendance/no-show-sweep?date=${date}&meal_type=${meal}`);
      toast.success(res.data.count > 0 ? `${res.data.count} no-show(s) recorded` : 'No stale bookings to sweep');
      const swept = new Set(res.data.items.map((it: LookupResult) => `${it.kind}-${it.id}`));
      setResults(prev => prev.map(x => swept.has(`${x.kind}-${x.id}`) ? { ...x, attendance_status: 'no_show' } : x));
    } catch (err) { toast.error(getErrorMessage(err, 'No-show check failed')); }
    finally { setSweeping(false); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-40" />
            <div className="flex rounded-md border overflow-hidden text-sm">
              {MEAL_OPTIONS.map(mt => (
                <button key={mt} type="button"
                  className={`flex-1 px-3 py-2 capitalize ${meal === mt ? 'bg-primary text-primary-foreground font-medium' : 'bg-transparent text-gray-500 hover:text-gray-700'}`}
                  onClick={() => setMeal(mt)}>
                  {mt}
                </button>
              ))}
            </div>
            <div className="flex-1" />
            <Button variant="outline" onClick={runNoShowCheck} disabled={sweeping}>
              <RotateCw size={16} className="mr-1" /> Run No-Show Check
            </Button>
          </div>

          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <Input ref={inputRef} placeholder="Search room, member ID, or name…" value={q}
              onChange={e => setQ(e.target.value)} className="pl-10" autoFocus />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {searching && <p className="text-sm text-gray-500">Searching…</p>}
        {!searching && q.trim().length >= 2 && results.length === 0 && (
          <p className="text-sm text-gray-500">No matches for "{q}"</p>
        )}
        {results.map(r => (
          <Card key={`${r.kind}-${r.id}`}>
            <CardContent className="p-3 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="font-medium">{r.name}</p>
                <p className="text-xs text-gray-500">{r.sub_label || (r.kind === 'member' ? 'Member' : 'Guest')}</p>
              </div>
              <div className="flex items-center gap-2">
                <IntentPill status={r.attendance_status} />
                <Button size="sm" onClick={() => serveMeal(r)}>Serve Meal</Button>
                <Button size="sm" variant="outline" onClick={() => onSpecialOrder(r.kind, r.id)}>
                  <UtensilsCrossed size={14} className="mr-1" /> Special Order
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
