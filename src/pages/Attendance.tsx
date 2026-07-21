import { useCallback, useEffect, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { UtensilsCrossed, XCircle, Lock } from 'lucide-react';
import { MealAttendanceOmnibar } from '@/components/MealAttendanceOmnibar';

interface AttendeeRow {
  attendance_id: number;
  kind: 'member' | 'booking' | 'guest';
  name: string;
  sub_label: string | null;
  recipe_name: string | null;
  status: string;
}

interface RecipeOption { id: number; name: string; }
interface CutoffInfo { cutoff: string; locked: boolean; }

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner'];
const MEAL_LABELS: Record<string, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' };
const KIND_LABEL: Record<AttendeeRow['kind'], string> = { member: 'Member', booking: 'Guest', guest: 'Guest' };

function defaultMeal(): string {
  const hour = new Date().getHours();
  if (hour < 11) return 'breakfast';
  if (hour < 17) return 'lunch';
  return 'dinner';
}

function formatTime12h(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

export default function Attendance() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [mealType, setMealType] = useState<string>(defaultMeal());
  const [attendeesByMeal, setAttendeesByMeal] = useState<Record<string, AttendeeRow[]>>({});
  const [cutoffs, setCutoffs] = useState<Record<string, CutoffInfo>>({});
  const [loading, setLoading] = useState(true);
  const [recipes, setRecipes] = useState<RecipeOption[]>([]);
  const [menuRecipeId, setMenuRecipeId] = useState(0);

  const isPast = new Date(date) < new Date(new Date().toDateString());

  const fetchAttendees = useCallback(async () => {
    setLoading(true);
    try {
      const [attendeeResults, cutoffRes] = await Promise.all([
        Promise.all(
          // Explicit no-cache: this reflects live headcounts (people are added/
          // removed constantly), and the browser has no way to know that on its
          // own for a same-shaped GET - without this a cached response for an
          // identical date/meal query can quietly show a stale list.
          MEAL_TYPES.map(mt => api.get(`/attendance/attendees?date=${date}&meal_type=${mt}`, { headers: { 'Cache-Control': 'no-cache' } }).then(res => [mt, res.data] as const))
        ),
        api.get(`/attendance/cutoffs?date=${date}`, { headers: { 'Cache-Control': 'no-cache' } }),
      ]);
      const next: Record<string, AttendeeRow[]> = {};
      for (const [mt, rows] of attendeeResults) next[mt] = Array.isArray(rows) ? rows : [];
      setAttendeesByMeal(next);
      setCutoffs(cutoffRes.data);
    } catch { toast.error('Failed to load attendance'); }
    finally { setLoading(false); }
  }, [date]);

  const fetchRecipes = useCallback(async () => {
    try { const res = await api.get(`/recipes?menu_category=${mealType}`); setRecipes(res.data.items); }
    catch { toast.error('Failed to load recipes'); }
  }, [mealType]);

  useEffect(() => {
    queueMicrotask(() => { fetchAttendees(); });
  }, [date, fetchAttendees]);

  useEffect(() => {
    queueMicrotask(() => { setMenuRecipeId(0); fetchRecipes(); });
  }, [mealType, fetchRecipes]);

  const handleRemove = async (row: AttendeeRow) => {
    let reason: string | undefined;
    if (isPast) {
      reason = prompt('This is a past date — enter a reason for this correction:') || undefined;
      if (!reason) return;
    }
    try {
      await api.post(`/attendance/${row.attendance_id}/mark`, { status: 'cancelled', reason });
      toast.success(`Removed ${row.name}`);
      fetchAttendees();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to remove')); }
  };

  const currentAttendees = attendeesByMeal[mealType] ?? [];
  const lockedMeals: Record<string, boolean> = {};
  for (const mt of MEAL_TYPES) lockedMeals[mt] = cutoffs[mt]?.locked ?? false;
  // Hard-lock (no override) only applies to today once its cutoff passes -
  // a genuinely past date keeps using the existing reason-required
  // correction flow below, matching the backend's own distinction.
  const currentLocked = !isPast && lockedMeals[mealType];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2"><UtensilsCrossed size={24} /> Meal Attendance</h1>
        <div className="flex items-center gap-2">
          <Label className="text-sm text-gray-500 whitespace-nowrap">Date</Label>
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-40" />
        </div>
      </div>

      {/* Meal selector - the cards double as the view, no separate tab bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {MEAL_TYPES.map(mt => {
          const rows = attendeesByMeal[mt] ?? [];
          const names = rows.map(r => r.name);
          const isActive = mt === mealType;
          const locked = lockedMeals[mt];
          const cutoff = cutoffs[mt]?.cutoff;
          return (
            <Card
              key={mt}
              className={`cursor-pointer transition-colors ${isActive ? 'ring-2 ring-primary border-primary' : 'hover:border-gray-300 dark:hover:border-gray-600'}`}
              onClick={() => setMealType(mt)}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-semibold text-sm">{MEAL_LABELS[mt]}</p>
                  <Badge className="bg-green-100 text-green-800">{loading ? '…' : names.length}</Badge>
                </div>
                <p className="text-xs text-gray-500 leading-relaxed min-h-8">
                  {loading ? 'Loading…' : names.length === 0 ? 'No one confirmed yet' : (
                    names.length <= 4 ? names.join(', ') : `${names.slice(0, 4).join(', ')} +${names.length - 4} more`
                  )}
                </p>
                {cutoff && (
                  <p className={`text-xs mt-2 flex items-center gap-1 ${locked ? 'text-amber-600 font-medium' : 'text-gray-400'}`}>
                    {locked ? <><Lock size={11} /> Final — closed at {formatTime12h(cutoff)}</> : `Closes at ${formatTime12h(cutoff)}`}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Add anyone - member or non-member, same box, same button */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-end gap-3 flex-wrap">
            <div className="min-w-52 max-w-xs">
              <Label className="text-xs text-gray-500">Today's menu item <span className="text-gray-400">(optional)</span></Label>
              <select className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={menuRecipeId} onChange={e => setMenuRecipeId(Number(e.target.value))}>
                <option value="0">Not specified</option>
                {recipes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div className="flex-1" />
            <Badge className="bg-green-100 text-green-800">{currentAttendees.length} confirmed for {MEAL_LABELS[mealType]}</Badge>
          </div>
          <MealAttendanceOmnibar
            date={date} mealType={mealType} recipeId={menuRecipeId} onAdded={fetchAttendees}
            mealTypes={MEAL_TYPES} mealLabels={MEAL_LABELS} lockedMeals={lockedMeals}
          />
        </CardContent>
      </Card>

      {isPast && <p className="text-xs text-amber-600">Editing a past date — removals will ask for a correction reason.</p>}

      {/* Attendees */}
      <Card>
        <CardContent className="p-0">
          {loading && <p className="text-center py-8 text-gray-500">Loading…</p>}
          {!loading && currentAttendees.length === 0 && (
            <p className="text-center py-8 text-gray-500">No one confirmed for {MEAL_LABELS[mealType]} yet — add someone above.</p>
          )}
          {!loading && currentAttendees.map(row => (
            <div key={row.attendance_id} className="flex items-center justify-between gap-3 px-4 py-3 border-b last:border-0 border-gray-100 dark:border-gray-800">
              <div>
                <p className="font-medium text-sm">{row.name} <span className="text-xs text-gray-400">({KIND_LABEL[row.kind]})</span></p>
                <p className="text-xs text-gray-500">{row.sub_label}{row.recipe_name ? ` · ${row.recipe_name}` : ''}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge className={row.status === 'attended' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}>{row.status}</Badge>
                {currentLocked ? (
                  <span title="Final — this meal's booking window is closed" className="text-gray-300 dark:text-gray-600">
                    <Lock size={16} />
                  </span>
                ) : (
                  <button onClick={() => handleRemove(row)} className="text-gray-400 hover:text-red-500" title="Remove">
                    <XCircle size={18} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
