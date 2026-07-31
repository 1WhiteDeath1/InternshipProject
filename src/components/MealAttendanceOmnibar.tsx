import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import api, { getErrorMessage } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Search, Plus, UserPlus, Lock } from 'lucide-react';

interface LookupResult {
  kind: 'member' | 'booking' | 'guest';
  id: number;
  name: string;
  sub_label: string | null;
  menu_item_id: number | null;
  attendance_id: number | null;
  attendance_status: string | null;
}

const KIND_LABEL: Record<LookupResult['kind'], string> = { member: 'Member', booking: 'Guest (checked in)', guest: 'Guest' };

/**
 * One search box, one "Add" action, works identically whether the person is
 * a permanent member, a checked-in hotel guest, or a standalone walk-in
 * with no room booking - the whole point being that a clerk never has to
 * think "is this a member or a non-member" before adding them to a meal.
 * Matches all three in a single query (backend /attendance/lookup); if
 * nothing matches, offers to create a brand-new walk-in guest by name on
 * the spot and add them in the same step.
 *
 * A meal-selector row lets one add action cover several meals at once (e.g.
 * a member eating both lunch and dinner today) - defaults to just the
 * currently active meal, disables any meal already past its cutoff.
 *
 * Today/past dates add via /attendance/serve (mark attended immediately -
 * the meal is happening or already happened). Future dates add via
 * POST /attendance (advance booking intent), since you can't "serve" a
 * meal that hasn't happened yet.
 */
export function MealAttendanceOmnibar({
  date, mealType, menuItemId, onAdded, mealTypes, mealLabels, lockedMeals,
}: {
  date: string;
  mealType: string;
  menuItemId: number;
  onAdded: () => void;
  mealTypes: string[];
  mealLabels: Record<string, string>;
  lockedMeals: Record<string, boolean>;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<LookupResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [creatingGuest, setCreatingGuest] = useState(false);
  const [selectedMeals, setSelectedMeals] = useState<string[]>([mealType]);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFutureDate = date > new Date().toISOString().slice(0, 10);
  const panelOpen = focused || q.trim().length > 0;

  // Reset the meal selection to just the tab being viewed whenever it
  // changes, rather than carrying a stale multi-select across meals.
  useEffect(() => {
    setSelectedMeals(lockedMeals[mealType] ? [] : [mealType]);
  }, [mealType, lockedMeals]);

  // An empty q is a deliberate "browse everyone" request (backend returns a
  // wider preview list for it), not just "no search yet" - so this fetches
  // on focus too, before a single character is typed.
  useEffect(() => {
    if (!panelOpen) return;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.get(`/attendance/lookup?q=${encodeURIComponent(q.trim())}&date=${date}&meal_type=${mealType}`);
        setResults(res.data);
      } catch (err) { toast.error(getErrorMessage(err, 'Search failed')); }
      finally { setSearching(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [q, date, mealType, panelOpen]);

  const handleFocus = () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    setFocused(true);
  };
  const handleBlur = () => {
    // Delay so a click on a result's "Add" button (which blurs the input
    // first) still lands before the panel disappears underneath it.
    blurTimer.current = setTimeout(() => setFocused(false), 150);
  };

  const toggleMeal = (mt: string) => {
    if (lockedMeals[mt]) return;
    setSelectedMeals(prev => prev.includes(mt) ? prev.filter(m => m !== mt) : [...prev, mt]);
  };

  const addToOneMeal = async (payload: { member_id?: number; booking_id?: number; guest_id?: number }, mt: string) => {
    const body = { ...payload, date, meal_type: mt, menu_item_id: mt === mealType && menuItemId ? menuItemId : undefined };
    if (isFutureDate) await api.post('/attendance', body);
    else await api.post('/attendance/serve', body);
  };

  const addToSelectedMeals = async (payload: { member_id?: number; booking_id?: number; guest_id?: number }, name: string) => {
    const targets = selectedMeals.length > 0 ? selectedMeals : [mealType];
    const outcomes = await Promise.allSettled(targets.map(mt => addToOneMeal(payload, mt)));
    const succeeded = targets.filter((_, i) => outcomes[i].status === 'fulfilled');
    const failed = targets
      .map((mt, i) => ({ mt, result: outcomes[i] }))
      .filter(x => x.result.status === 'rejected') as { mt: string; result: PromiseRejectedResult }[];

    if (succeeded.length > 0) {
      toast.success(`Added ${name} to ${succeeded.map(mt => mealLabels[mt] || mt).join(', ')}`);
    }
    for (const { mt, result } of failed) {
      const err = result.reason;
      if (axios.isAxiosError(err) && err.response?.status === 409) {
        const reason = err.response.data?.detail;
        toast.warning(
          reason === 'cancelled' ? `${name}: already cancelled ${mealLabels[mt] || mt}`
          : reason === 'excluded' ? `${name} is on leave for this date`
          : `${name}: already recorded for ${mealLabels[mt] || mt}`
        );
      } else {
        toast.error(`${name}: ${getErrorMessage(err, `failed to add to ${mealLabels[mt] || mt}`)}`);
      }
    }
    return succeeded.length > 0;
  };

  const addPerson = async (r: LookupResult) => {
    const key = `${r.kind}-${r.id}`;
    setAdding(key);
    try {
      const ok = await addToSelectedMeals({
        member_id: r.kind === 'member' ? r.id : undefined,
        booking_id: r.kind === 'booking' ? r.id : undefined,
        guest_id: r.kind === 'guest' ? r.id : undefined,
      }, r.name);
      if (ok) { setQ(''); setResults([]); onAdded(); }
    } finally {
      setAdding(null);
      inputRef.current?.focus();
    }
  };

  const addNewWalkIn = async () => {
    const name = q.trim();
    if (!name) return;
    setCreatingGuest(true);
    try {
      const res = await api.post('/guests', { full_name: name });
      const ok = await addToSelectedMeals({ guest_id: res.data.id }, name);
      if (ok) { setQ(''); setResults([]); onAdded(); }
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to add new guest'));
    } finally {
      setCreatingGuest(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (results.length > 0) addPerson(results[0]);
    else if (q.trim().length >= 2) addNewWalkIn();
  };

  const allLocked = mealTypes.every(mt => lockedMeals[mt]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-500">Add to:</span>
        {mealTypes.map(mt => {
          const locked = lockedMeals[mt];
          const checked = selectedMeals.includes(mt);
          return (
            <button
              key={mt}
              type="button"
              disabled={locked}
              onClick={() => toggleMeal(mt)}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium border transition-colors
                ${locked ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed dark:bg-gray-800 dark:border-gray-700'
                : checked ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400 dark:bg-gray-900 dark:text-gray-300 dark:border-gray-700'}`}
            >
              {locked && <Lock size={11} />} {mealLabels[mt] || mt}
            </button>
          );
        })}
      </div>

      {allLocked ? (
        <p className="text-sm text-amber-600">All meals are final for this date — no more additions.</p>
      ) : (
        <>
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <Input
              ref={inputRef}
              placeholder="Add anyone — type a name, or click to browse…"
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={handleFocus}
              onBlur={handleBlur}
              disabled={selectedMeals.length === 0}
              className="pl-10"
            />
          </div>
          {selectedMeals.length === 0 && (
            <p className="text-xs text-amber-600">Select at least one meal above to add someone.</p>
          )}
          {panelOpen && selectedMeals.length > 0 && (
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {searching && <p className="text-sm text-gray-400 px-1">{q.trim() ? 'Searching…' : 'Loading…'}</p>}
              {!searching && !q.trim() && results.length > 0 && (
                <p className="text-xs text-gray-400 px-1">All members &amp; guests — start typing to narrow down</p>
              )}
              {results.map(r => {
                const key = `${r.kind}-${r.id}`;
                const already = selectedMeals.length === 1 && (r.attendance_status === 'attended' || r.attendance_status === 'booked');
                return (
                  <div key={key} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 bg-white dark:bg-gray-900">
                    <div>
                      <p className="text-sm font-medium">{r.name}</p>
                      <p className="text-xs text-gray-500">{r.sub_label || KIND_LABEL[r.kind]}</p>
                    </div>
                    <Button
                      size="sm"
                      variant={already ? 'outline' : 'default'}
                      disabled={adding === key || already}
                      onClick={() => addPerson(r)}
                    >
                      <Plus size={14} className="mr-1" /> {already ? 'Already added' : adding === key ? 'Adding…' : 'Add'}
                    </Button>
                  </div>
                );
              })}
              {!searching && results.length === 0 && q.trim().length > 0 && (
                <button
                  type="button"
                  disabled={creatingGuest}
                  onClick={addNewWalkIn}
                  className="flex items-center gap-2 w-full rounded-md border border-dashed px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30 disabled:opacity-60"
                >
                  <UserPlus size={16} /> {creatingGuest ? 'Adding…' : `Add "${q.trim()}" as a new guest`}
                </button>
              )}
              {!searching && results.length === 0 && !q.trim() && (
                <p className="text-sm text-gray-400 px-1">No members or guests yet</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
