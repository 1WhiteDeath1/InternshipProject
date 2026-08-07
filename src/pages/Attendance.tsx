import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { getErrorMessage } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { UtensilsCrossed, Lock } from 'lucide-react';
import { MealAttendanceOmnibar } from '@/components/MealAttendanceOmnibar';
import { ConfirmDialog, type ConfirmRequest } from '@/components/ConfirmDialog';
import { defaultMealForNow } from '@/lib/mealDefaults';

interface MatrixRow {
  kind: 'member' | 'booking';
  id: number;
  name: string;
  sub_label: string | null;
  present: boolean;
  status: string | null;
  on_leave: boolean;
  attendance_id: number | null;
}
interface Matrix {
  date: string; meal_type: string; locked: boolean; has_saved_records: boolean;
  dining: MatrixRow[]; non_dining: MatrixRow[]; guests: MatrixRow[];
}

interface MenuItemOption { id: number; name: string; }
interface CutoffInfo { cutoff: string; locked: boolean; }

const MEAL_TYPES = ['breakfast', 'lunch', 'hitea', 'dinner'];
const MEAL_LABELS: Record<string, string> = { breakfast: 'Breakfast', lunch: 'Lunch', hitea: 'Hi-Tea', dinner: 'Dinner' };

function rowKey(r: { kind: string; id: number }) { return `${r.kind}-${r.id}`; }

function formatTime12h(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

// Module-level (not defined inside Attendance) so React keeps a stable
// component identity across renders of the parent.
interface AttendanceGroupProps {
  title: string;
  rows: MatrixRow[];
  isRowDisabled: (r: MatrixRow) => boolean;
  onToggle: (r: MatrixRow) => void;
  onSpecialOrder: (r: MatrixRow) => void;
}

function AttendanceGroup({ title, rows, isRowDisabled, onToggle, onSpecialOrder }: AttendanceGroupProps) {
  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <h3 className="text-sm font-semibold text-muted-foreground">{title} ({rows.length})</h3>
        {rows.length === 0 && <p className="text-xs text-muted-foreground">None</p>}
        {rows.map(r => (
          <div key={rowKey(r)} className="flex items-center justify-between gap-3 py-1.5 border-b last:border-0">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{r.name}</p>
              <p className="text-xs text-muted-foreground truncate">{r.sub_label || '-'}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {r.on_leave && <Badge variant="outline" className="text-xs">On Leave</Badge>}
              {r.status === 'attended' && <Badge className="bg-emerald-100 text-emerald-800 text-xs">Served</Badge>}
              {r.status === 'no_show' && <Badge className="bg-red-100 text-red-800 text-xs">No-Show</Badge>}
              <Button size="sm" variant="ghost" title="Special order for this person" onClick={() => onSpecialOrder(r)}>
                <UtensilsCrossed size={14} />
              </Button>
              <Switch checked={r.present} disabled={isRowDisabled(r)} onCheckedChange={() => onToggle(r)} />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function Attendance() {
  const navigate = useNavigate();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [meal, setMeal] = useState<string>(defaultMealForNow());
  const [matrixByMeal, setMatrixByMeal] = useState<Record<string, Matrix>>({});
  const [cutoffs, setCutoffs] = useState<Record<string, CutoffInfo>>({});
  const [loading, setLoading] = useState(true);
  const [menuItems, setMenuItems] = useState<MenuItemOption[]>([]);
  const [selectedMenuItemId, setSelectedMenuItemId] = useState(0);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);

  const isPast = new Date(date) < new Date(new Date().toDateString());

  const fetchMatrixFor = useCallback(async (mt: string) => {
    // Explicit no-cache: this reflects live headcounts, and a same-shaped
    // GET can otherwise return a stale cached list for the same date/meal.
    const res = await api.get(`/attendance/matrix?date=${date}&meal_type=${mt}`, { headers: { 'Cache-Control': 'no-cache' } });
    return [mt, res.data as Matrix] as const;
  }, [date]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [results, cutoffRes] = await Promise.all([
        Promise.all(MEAL_TYPES.map(mt => fetchMatrixFor(mt))),
        api.get(`/attendance/cutoffs?date=${date}`, { headers: { 'Cache-Control': 'no-cache' } }),
      ]);
      const next: Record<string, Matrix> = {};
      for (const [mt, data] of results) next[mt] = data;
      setMatrixByMeal(next);
      setCutoffs(cutoffRes.data);
    } catch { toast.error('Failed to load attendance'); }
    finally { setLoading(false); }
  }, [date, fetchMatrixFor]);

  const refreshMeal = useCallback(async (mt: string) => {
    try {
      const [, data] = await fetchMatrixFor(mt);
      setMatrixByMeal(prev => ({ ...prev, [mt]: data }));
    } catch { toast.error('Failed to refresh attendance'); }
  }, [fetchMatrixFor]);

  const fetchMenuItems = useCallback(async () => {
    try { const res = await api.get(`/kitchen/menu?meal_type=${meal}`); setMenuItems(res.data); }
    catch { toast.error('Failed to load menu items'); }
  }, [meal]);

  useEffect(() => {
    queueMicrotask(() => { fetchAll(); });
  }, [date, fetchAll]);

  useEffect(() => {
    queueMicrotask(() => { setSelectedMenuItemId(0); fetchMenuItems(); });
  }, [meal, fetchMenuItems]);

  const currentMatrix = matrixByMeal[meal];
  const lockedMeals: Record<string, boolean> = {};
  for (const mt of MEAL_TYPES) lockedMeals[mt] = cutoffs[mt]?.locked ?? false;
  const mealLocked = currentMatrix?.locked ?? false;

  const commitToggle = async (r: MatrixRow, present: boolean) => {
    try {
      await api.post('/attendance/matrix', { date, meal_type: meal, entries: [{ kind: r.kind, id: r.id, present }] });
      refreshMeal(meal);
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to update attendance')); }
  };

  const removeViaMark = async (attendanceId: number, reason: string) => {
    try {
      await api.post(`/attendance/${attendanceId}/mark`, { status: 'cancelled', reason });
      toast.success('Removed');
      refreshMeal(meal);
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to remove')); }
  };

  const handleToggle = (r: MatrixRow) => {
    if (r.status === 'attended') return;
    if (r.present) {
      if (!mealLocked) { commitToggle(r, false); return; }
      // Hard-lock (today past cutoff) has no override - only a genuinely
      // past date with an actual saved record can be corrected, and only
      // with a reason, matching the backend's own distinction.
      if (isPast && r.attendance_id) {
        setConfirmRequest({
          title: 'Remove past attendance record?',
          description: `${r.name} — ${date}`,
          confirmLabel: 'Remove',
          destructive: true,
          reasonLabel: 'Reason for this correction',
          reasonRequired: true,
          reasonMinLength: 10,
          onConfirm: (reason) => removeViaMark(r.attendance_id!, reason),
        });
      }
      return;
    }
    if (mealLocked) return;
    commitToggle(r, true);
  };

  const isRowDisabled = (r: MatrixRow) => {
    if (r.status === 'attended') return true;
    if (r.present) return mealLocked && !(isPast && r.attendance_id);
    return mealLocked;
  };

  const handleSpecialOrder = (r: MatrixRow) => {
    navigate('/kitchen', { state: { openAlaCarte: true, presetConsumerKind: r.kind, presetConsumerId: r.id } });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><UtensilsCrossed size={24} /> Meal Attendance</h1>
        <div className="flex items-center gap-2">
          <Label className="text-sm text-muted-foreground whitespace-nowrap">Date</Label>
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-40" />
        </div>
      </div>

      {/* Meal selector - the cards double as the view, no separate tab bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {MEAL_TYPES.map(mt => {
          const matrix = matrixByMeal[mt];
          const presentRows = matrix ? [...matrix.dining, ...matrix.non_dining, ...matrix.guests].filter(r => r.present) : [];
          const names = presentRows.map(r => r.name);
          const isActive = mt === meal;
          const locked = lockedMeals[mt];
          const cutoff = cutoffs[mt]?.cutoff;
          return (
            <Card
              key={mt}
              className={`cursor-pointer transition-colors ${isActive ? 'ring-2 ring-primary border-primary' : 'hover:border-gray-300 dark:hover:border-gray-600'}`}
              onClick={() => setMeal(mt)}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-semibold text-sm">{MEAL_LABELS[mt]}</p>
                  <Badge className="bg-green-100 text-green-800">{loading ? '…' : names.length}</Badge>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed min-h-8">
                  {loading ? 'Loading…' : names.length === 0 ? 'No one confirmed yet' : (
                    names.length <= 4 ? names.join(', ') : `${names.slice(0, 4).join(', ')} +${names.length - 4} more`
                  )}
                </p>
                {cutoff && (
                  <p className={`text-xs mt-2 flex items-center gap-1 ${locked ? 'text-amber-600 font-medium' : 'text-muted-foreground'}`}>
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
              <Label className="text-xs text-muted-foreground">Today's menu item <span className="text-muted-foreground">(optional)</span></Label>
              <select className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={selectedMenuItemId} onChange={e => setSelectedMenuItemId(Number(e.target.value))}>
                <option value="0">Not specified</option>
                {menuItems.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          </div>
          <MealAttendanceOmnibar
            date={date} mealType={meal} menuItemId={selectedMenuItemId} onAdded={fetchAll}
            mealTypes={MEAL_TYPES} mealLabels={MEAL_LABELS} lockedMeals={lockedMeals}
          />
        </CardContent>
      </Card>

      {isPast && <p className="text-xs text-amber-600">Editing a past date — removals will ask for a correction reason.</p>}
      {!mealLocked && !currentMatrix?.has_saved_records && !loading && (
        <p className="text-xs text-muted-foreground">Showing default attendance for {MEAL_LABELS[meal]} (nothing saved yet) - Dining ON, Non-Dining and Room Guests OFF. Toggle to adjust.</p>
      )}
      {mealLocked && !isPast && (
        <p className="text-xs text-red-600 flex items-center gap-1.5"><Lock size={13} /> {MEAL_LABELS[meal]}'s attendance window has closed - toggles are locked.</p>
      )}

      {/* Roster - every Dining member (default ON), Non-Dining member (default
          OFF), and non-member checked-in room guest (default OFF), divided
          into groups so the NCO can scan each population at a glance. */}
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!loading && currentMatrix && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <AttendanceGroup title="Dining Members" rows={currentMatrix.dining} isRowDisabled={isRowDisabled} onToggle={handleToggle} onSpecialOrder={handleSpecialOrder} />
          <AttendanceGroup title="Non-Dining Members" rows={currentMatrix.non_dining} isRowDisabled={isRowDisabled} onToggle={handleToggle} onSpecialOrder={handleSpecialOrder} />
          <AttendanceGroup title="Active Room Guests" rows={currentMatrix.guests} isRowDisabled={isRowDisabled} onToggle={handleToggle} onSpecialOrder={handleSpecialOrder} />
        </div>
      )}

      <ConfirmDialog request={confirmRequest} onClose={() => setConfirmRequest(null)} />
    </div>
  );
}
