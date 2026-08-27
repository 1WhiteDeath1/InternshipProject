import { useCallback, useEffect, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Lock, Flame, RotateCcw, ChevronDown, ChevronRight, Plus, XCircle, Search } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import { defaultMealForNow } from '@/lib/mealDefaults';
import { MealAttendanceOmnibar } from '@/components/MealAttendanceOmnibar';
import { ConfirmDialog, type ConfirmRequest } from '@/components/ConfirmDialog';
import { OrderHistoryDialog } from '@/components/OrderHistoryDialog';
import { SpecialOrderDialog } from '@/components/SpecialOrderDialog';
import { DishDetailDialog, type DishDetail, type DishPerson } from '@/pages/kitchen/DishDetailDialog';

/* The merged Meals board - the old standalone Attendance page plus Kitchen's
   Production tab, in one screen organised by DISH rather than by person.

   Kept deliberately shallow: the board shows only what needs doing, and
   EVERY card opens a detail view rather than growing more controls in place.
   Dish card -> DishDetailDialog (eaters + pricing + cook). Person -> their
   full order history. That's why the cards themselves carry almost nothing. */

const MEAL_TYPES = ['breakfast', 'lunch', 'hitea', 'dinner'];
const MEAL_LABELS: Record<string, string> = { breakfast: 'Breakfast', lunch: 'Lunch', hitea: 'Hi-Tea', dinner: 'Dinner' };

interface BoardDish extends DishDetail { quantity_ordered: number | null }
interface BoardSpecial {
  id: number; menu_item_id: number; name: string; consumer_name: string | null;
  quantity_ordered: number; status: string; due_at: string | null; cooking_started_at: string | null;
}
interface MenuOption { id: number; name: string; price: number }
interface MealBoardData {
  date: string; meal_type: string; locked: boolean; cutoff: string;
  dishes: BoardDish[]; special_orders: BoardSpecial[]; menu_options: MenuOption[];
}
interface MatrixRow {
  kind: 'member' | 'booking'; id: number; name: string; sub_label: string | null;
  present: boolean; status: string | null; on_leave: boolean; attendance_id: number | null;
  menu_item_id: number | null; menu_item_name: string | null;
}
interface Matrix { dining: MatrixRow[]; non_dining: MatrixRow[]; guests: MatrixRow[]; has_saved_records: boolean }
interface CutoffInfo { cutoff: string; locked: boolean }

function fmtTime12h(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${period}`;
}

export function MealsBoard() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [meal, setMeal] = useState<string>(defaultMealForNow());
  const [board, setBoard] = useState<MealBoardData | null>(null);
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [cutoffs, setCutoffs] = useState<Record<string, CutoffInfo>>({});
  const [mealCounts, setMealCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [addDishId, setAddDishId] = useState(0);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [rosterSearch, setRosterSearch] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const [specialOpen, setSpecialOpen] = useState(false);
  const [detailDish, setDetailDish] = useState<BoardDish | null>(null);
  const [historyPerson, setHistoryPerson] = useState<DishPerson | null>(null);

  const isPast = new Date(date) < new Date(new Date().toDateString());

  const fetchBoard = useCallback(async () => {
    try {
      const res = await api.get(`/kitchen/meal-board?date=${date}&meal_type=${meal}`, { headers: { 'Cache-Control': 'no-cache' } });
      setBoard(res.data);
      // Keep an open detail dialog in sync after an edit rather than closing it.
      setDetailDish(prev => prev ? (res.data.dishes.find((d: BoardDish) => d.menu_item_id === prev.menu_item_id) ?? null) : null);
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to load the meal board')); }
  }, [date, meal]);

  const fetchMatrix = useCallback(async () => {
    try {
      const res = await api.get(`/attendance/matrix?date=${date}&meal_type=${meal}`, { headers: { 'Cache-Control': 'no-cache' } });
      setMatrix(res.data);
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to load attendance')); }
  }, [date, meal]);

  const fetchMealCounts = useCallback(async () => {
    try {
      const results = await Promise.all(MEAL_TYPES.map(mt =>
        api.get(`/attendance/matrix?date=${date}&meal_type=${mt}`, { headers: { 'Cache-Control': 'no-cache' } })
          .then(r => [mt, r.data as Matrix] as const)));
      const next: Record<string, number> = {};
      for (const [mt, m] of results) next[mt] = [...m.dining, ...m.non_dining, ...m.guests].filter(r => r.present).length;
      setMealCounts(next);
    } catch { /* chip counts are informational */ }
  }, [date]);

  const fetchCutoffs = useCallback(async () => {
    try {
      const res = await api.get(`/attendance/cutoffs?date=${date}`, { headers: { 'Cache-Control': 'no-cache' } });
      setCutoffs(res.data);
    } catch { /* the board carries its own lock state too */ }
  }, [date]);

  const refresh = useCallback(async () => {
    await Promise.all([fetchBoard(), fetchMatrix(), fetchMealCounts(), fetchCutoffs()]);
  }, [fetchBoard, fetchMatrix, fetchMealCounts, fetchCutoffs]);

  useEffect(() => {
    queueMicrotask(() => { setLoading(true); refresh().finally(() => setLoading(false)); });
  }, [refresh]);

  useEffect(() => { setAddDishId(0); }, [meal, date]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(() => { fetchBoard(); }, 20000);
    return () => { clearInterval(tick); clearInterval(poll); };
  }, [fetchBoard]);

  const locked = board?.locked ?? false;
  const lockedMeals: Record<string, boolean> = {};
  for (const mt of MEAL_TYPES) lockedMeals[mt] = cutoffs[mt]?.locked ?? false;

  const allRows = matrix ? [...matrix.dining, ...matrix.non_dining, ...matrix.guests] : [];
  const presentRows = allRows.filter(r => r.present);
  const unassigned = presentRows.filter(r => !r.menu_item_id);

  const countdown = (dueAt: string | null): { label: string; overdue: boolean } => {
    if (!dueAt) return { label: '—', overdue: false };
    const utc = dueAt.endsWith('Z') || dueAt.includes('+') ? dueAt : `${dueAt}Z`;
    const diff = new Date(utc).getTime() - now;
    const overdue = diff <= 0;
    const sec = Math.floor(Math.abs(diff) / 1000);
    if (sec >= 86400) return { label: `${Math.floor(sec / 86400)}d overdue`, overdue };
    if (sec >= 3600) return { label: `${Math.floor(sec / 3600)}h ${overdue ? 'overdue' : 'left'}`, overdue };
    return { label: `${overdue ? '-' : ''}${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`, overdue };
  };

  /** assign-item takes the FULL set of eaters for a dish (it diffs to decide
      who to clear), so send everyone already on it plus the newcomer. */
  const assignToDish = async (person: { kind: string; id: number }, dishId: number) => {
    const dish = board?.dishes.find(d => d.menu_item_id === dishId);
    const entries = [...(dish?.eaters ?? []).map(e => ({ kind: e.kind, id: e.id })), { kind: person.kind, id: person.id }];
    try {
      await api.post('/attendance/matrix/assign-item', { date, meal_type: meal, menu_item_id: dishId, entries });
      await refresh();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to assign the dish')); }
  };

  const handleCopyLast = async () => {
    setBusy(true);
    try {
      const entries = presentRows.map(r => ({ kind: r.kind, id: r.id }));
      const res = await api.post('/kitchen/meal-board/copy-last', { date, meal_type: meal, entries });
      if (!res.data.source_date) toast.info(`No earlier ${MEAL_LABELS[meal]} with dishes to copy from`);
      else if (res.data.filled === 0) toast.info('Everyone already has a dish');
      else toast.success(`Filled ${res.data.filled} from ${res.data.source_date}`);
      await refresh();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to copy the last meal')); }
    finally { setBusy(false); }
  };

  const handleDishCooked = async (dish: BoardDish) => {
    try {
      await api.post('/kitchen/meal-board/dish-cooked', { date, meal_type: meal, menu_item_id: dish.menu_item_id });
      toast.success(`${dish.name} marked cooked`);
      await fetchBoard();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to mark cooked')); }
  };

  const handleSpecial = async (o: BoardSpecial, action: 'start-cooking' | 'complete' | 'cancel') => {
    try {
      await api.post(`/kitchen/orders/${o.id}/${action}`);
      toast.success(action === 'cancel' ? 'Cancelled' : action === 'complete' ? 'Done' : 'Cooking started');
      await fetchBoard();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to update the order')); }
  };

  const commitToggle = async (r: MatrixRow, present: boolean) => {
    try {
      await api.post('/attendance/matrix', { date, meal_type: meal, entries: [{ kind: r.kind, id: r.id, present }] });
      await refresh();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to update attendance')); }
  };

  const handleToggle = (r: MatrixRow) => {
    if (r.status === 'attended') return;
    if (r.present) {
      if (!locked) { commitToggle(r, false); return; }
      if (isPast && r.attendance_id) {
        setConfirmRequest({
          title: 'Remove past attendance record?', description: `${r.name} — ${date}`,
          confirmLabel: 'Remove', destructive: true,
          reasonLabel: 'Reason for this correction', reasonRequired: true, reasonMinLength: 10,
          onConfirm: async (reason) => {
            try {
              await api.post(`/attendance/${r.attendance_id}/mark`, { status: 'cancelled', reason });
              toast.success('Removed');
              await refresh();
            } catch (err) { toast.error(getErrorMessage(err, 'Failed to remove')); }
          },
        });
      }
      return;
    }
    if (locked) return;
    commitToggle(r, true);
  };

  const rowDisabled = (r: MatrixRow) => {
    if (r.status === 'attended') return true;
    if (r.present) return locked && !(isPast && r.attendance_id);
    return locked;
  };

  const toCook = board?.dishes.filter(d => d.status !== 'served') ?? [];
  const done = board?.dishes.filter(d => d.status === 'served') ?? [];
  const specialPending = board?.special_orders.filter(o => o.status === 'pending') ?? [];
  const specialCooking = board?.special_orders.filter(o => o.status === 'cooking' || o.status === 'late') ?? [];
  const specialDone = board?.special_orders.filter(o => o.status === 'served') ?? [];
  const doneCount = done.length + specialDone.length;

  const q = rosterSearch.trim().toLowerCase();
  const filterRoster = (rows: MatrixRow[]) => !q ? rows
    : rows.filter(r => r.name.toLowerCase().includes(q) || (r.sub_label || '').toLowerCase().includes(q));
  const rosterMatches = matrix
    ? filterRoster(matrix.dining).length + filterRoster(matrix.non_dining).length + filterRoster(matrix.guests).length
    : 0;

  /* Cards carry only a name, a count, a price and one action - anything more
     goes in the detail dialog the whole card opens. */
  const DishCard = ({ d }: { d: BoardDish }) => (
    <div className="rounded-md border bg-card hover:border-primary/60 transition-colors">
      <button type="button" className="w-full text-left p-2.5 space-y-0.5" onClick={() => setDetailDish(d)}>
        <div className="flex items-start justify-between gap-2">
          <span className="font-semibold text-sm leading-tight">{d.name}</span>
          <Badge className="bg-emerald-100 text-emerald-800 shrink-0">{d.headcount}</Badge>
        </div>
        <span className="block text-xs text-muted-foreground">
          {formatCurrency(d.price_override ?? d.menu_price)}/head
          {d.gas_amount !== null && ` · gas ${formatCurrency(d.gas_amount)}`}
        </span>
        <span className="block text-[11px] text-muted-foreground">Tap for details</span>
      </button>
      {d.status !== 'served' && (
        <div className="px-2.5 pb-2.5">
          <Button size="sm" className="w-full h-7 bg-orange-600 hover:bg-orange-700" onClick={() => handleDishCooked(d)}>
            <Flame size={13} className="mr-1" /> Cooked
          </Button>
        </div>
      )}
    </div>
  );

  const SpecialCard = ({ o }: { o: BoardSpecial }) => {
    const { label, overdue } = countdown(o.due_at);
    const isLate = o.status === 'late';
    return (
      <div className={`rounded-md border-l-4 border p-2.5 space-y-1 ${isLate ? 'border-red-400 border-l-red-500 bg-red-50 dark:bg-red-950/20' : 'border-l-fuchsia-500 bg-card'}`}>
        <p className="text-[10px] font-bold uppercase tracking-wide text-fuchsia-700 dark:text-fuchsia-400">Special order</p>
        <p className="font-semibold text-sm leading-tight">{o.name}</p>
        <p className="text-xs text-muted-foreground">{o.consumer_name || 'Unknown'} · qty {o.quantity_ordered}</p>
        {o.status !== 'served' && <p className={`text-xs font-mono ${overdue ? 'text-red-600' : 'text-muted-foreground'}`}>{label}</p>}
        <div className="flex gap-1">
          {(o.status === 'pending' || (isLate && !o.cooking_started_at)) && (
            <Button size="sm" className="flex-1 h-7 bg-orange-600 hover:bg-orange-700" onClick={() => handleSpecial(o, 'start-cooking')}>
              <Flame size={13} className="mr-1" /> Start
            </Button>
          )}
          {(o.status === 'cooking' || (isLate && o.cooking_started_at)) && (
            <Button size="sm" className="flex-1 h-7 bg-green-600 hover:bg-green-700" onClick={() => handleSpecial(o, 'complete')}>Done</Button>
          )}
          {o.status !== 'served' && (
            <Button size="sm" variant="ghost" className="h-7" title="Cancel" onClick={() => handleSpecial(o, 'cancel')}>
              <XCircle size={14} className="text-red-500" />
            </Button>
          )}
        </div>
      </div>
    );
  };

  const RosterGroup = ({ title, rows }: { title: string; rows: MatrixRow[] }) => {
    const shown = filterRoster(rows);
    return (
      <Card>
        <CardContent className="p-3 space-y-1.5">
          <h4 className="text-xs font-semibold text-muted-foreground">{title} ({shown.length}{q && rows.length !== shown.length ? ` of ${rows.length}` : ''})</h4>
          {shown.length === 0 && <p className="text-xs text-muted-foreground">{q ? 'No match' : 'None'}</p>}
          {shown.map(r => (
            <div key={`${r.kind}-${r.id}`} className="flex items-center justify-between gap-2 py-1 border-b last:border-0">
              <button type="button" className="min-w-0 text-left hover:underline"
                onClick={() => setHistoryPerson({ kind: r.kind, id: r.id, name: r.name })}>
                <span className="block text-sm truncate">{r.name}</span>
                <span className="block text-xs text-muted-foreground truncate">
                  {r.sub_label || '-'}
                  {r.present && (r.menu_item_name
                    ? <span className="ml-1 text-emerald-700 dark:text-emerald-400">· {r.menu_item_name}</span>
                    : <span className="ml-1 text-amber-600">· no dish</span>)}
                </span>
              </button>
              <div className="flex items-center gap-1.5 shrink-0">
                {r.on_leave && <Badge variant="outline" className="text-[10px]">On Leave</Badge>}
                {r.status === 'attended' && <Badge className="bg-emerald-100 text-emerald-800 text-[10px]">Served</Badge>}
                <Switch checked={r.present} disabled={rowDisabled(r)} onCheckedChange={() => handleToggle(r)} />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      {/* Meal + date, then the two things you might do to the whole meal */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex rounded-md border overflow-hidden">
          {MEAL_TYPES.map(mt => (
            <button key={mt} type="button" onClick={() => setMeal(mt)}
              className={`px-3 py-2 text-sm flex items-center gap-1.5 ${meal === mt ? 'bg-primary text-primary-foreground font-semibold' : 'bg-transparent text-muted-foreground hover:text-foreground'}`}>
              {lockedMeals[mt] && <Lock size={11} />}
              {MEAL_LABELS[mt]}
              {mealCounts[mt] !== undefined && (
                <span className={`text-[10px] rounded-full px-1.5 ${meal === mt ? 'bg-black/20' : 'bg-muted'}`}>{mealCounts[mt]}</span>
              )}
            </button>
          ))}
        </div>
        <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-40" />
        <div className="flex-1" />
        <Button variant="outline" size="sm" disabled={busy || locked} onClick={handleCopyLast}
          title="Give everyone present the dish they had last time this meal ran">
          <RotateCcw size={14} className="mr-1" /> Same as last time
        </Button>
        <Button size="sm" onClick={() => setSpecialOpen(true)}><Plus size={14} className="mr-1" /> Special Order</Button>
      </div>

      <p className="text-sm">
        <b>{presentRows.length} attending</b>
        {unassigned.length > 0 && <span className="text-amber-600"> · {unassigned.length} need a dish</span>}
        {board && (
          <span className={`ml-2 text-xs ${locked ? 'text-amber-600 font-medium' : 'text-muted-foreground'}`}>
            {locked ? `Final — closed ${fmtTime12h(board.cutoff)}` : `Closes ${fmtTime12h(board.cutoff)}`}
          </span>
        )}
      </p>

      {/* One row: who, and what they're eating. No second meal picker. */}
      {!locked && (
        <Card>
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium">Add someone eating</span>
              <select className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={addDishId} onChange={e => setAddDishId(Number(e.target.value))}>
                <option value="0">— pick a dish —</option>
                {board?.menu_options.map(m => <option key={m.id} value={m.id}>{m.name} ({formatCurrency(m.price)})</option>)}
              </select>
            </div>
            <MealAttendanceOmnibar
              date={date} mealType={meal} menuItemId={addDishId} onAdded={refresh}
              mealTypes={MEAL_TYPES} mealLabels={MEAL_LABELS} lockedMeals={lockedMeals} hideMealPicker
            />
          </CardContent>
        </Card>
      )}

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!loading && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex justify-between">
              <span>To cook</span><span>{toCook.length + specialPending.length}</span>
            </h3>

            {/* "Needs a dish" is work to do, so it lives in the work column
                instead of a separate warning banner further up the page. */}
            {unassigned.length > 0 && !locked && (
              <div className="rounded-md border border-amber-300 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20 p-2.5 space-y-1.5">
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">{unassigned.length} need a dish</p>
                {unassigned.map(r => (
                  <div key={`${r.kind}-${r.id}`} className="flex items-center justify-between gap-1.5">
                    <span className="text-xs truncate">{r.name}</span>
                    <select className="h-6 rounded border border-input bg-background px-1 text-[11px] shrink-0" defaultValue="0"
                      onChange={e => { const id = Number(e.target.value); if (id) assignToDish(r, id); }}>
                      <option value="0">pick…</option>
                      {board?.menu_options.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            )}

            {toCook.map(d => <DishCard key={d.menu_item_id} d={d} />)}
            {specialPending.map(o => <SpecialCard key={o.id} o={o} />)}
            {toCook.length + specialPending.length === 0 && unassigned.length === 0 && (
              <p className="text-xs text-muted-foreground">Nothing waiting</p>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex justify-between">
              <span>Cooking</span><span>{specialCooking.length}</span>
            </h3>
            {specialCooking.map(o => <SpecialCard key={o.id} o={o} />)}
            {specialCooking.length === 0 && <p className="text-xs text-muted-foreground">Only special orders pass through here</p>}
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex justify-between">
              <span>Done</span><span>{doneCount}</span>
            </h3>
            {doneCount === 0 && <p className="text-xs text-muted-foreground">Nothing done yet</p>}
            {doneCount > 0 && !showDone && (
              <button type="button" onClick={() => setShowDone(true)}
                className="w-full rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground hover:text-foreground text-left">
                ▸ {doneCount} done — {[...done.map(d => d.name), ...specialDone.map(o => o.name)].slice(0, 3).join(', ')}{doneCount > 3 ? '…' : ''}
              </button>
            )}
            {showDone && (
              <>
                <button type="button" onClick={() => setShowDone(false)} className="text-xs text-muted-foreground hover:text-foreground">▾ collapse</button>
                {done.map(d => <DishCard key={d.menu_item_id} d={d} />)}
                {specialDone.map(o => <SpecialCard key={o.id} o={o} />)}
              </>
            )}
          </div>
        </div>
      )}

      {/* Full roster - searchable, and every name opens that person's history */}
      <div>
        <button type="button" onClick={() => setRosterOpen(o => !o)}
          className="text-sm font-semibold flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
          {rosterOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          Who's attending ({presentRows.length})
        </button>
        {rosterOpen && (
          <div className="mt-2 space-y-2">
            <div className="relative max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={15} />
              <Input className="pl-9 h-9" placeholder="Search members & guests…"
                value={rosterSearch} onChange={e => setRosterSearch(e.target.value)} />
            </div>
            {q && <p className="text-xs text-muted-foreground">{rosterMatches} match{rosterMatches === 1 ? '' : 'es'}</p>}
            {matrix && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <RosterGroup title="Dining Members" rows={matrix.dining} />
                <RosterGroup title="Non-Dining Members" rows={matrix.non_dining} />
                <RosterGroup title="Room Guests" rows={matrix.guests} />
              </div>
            )}
            {!locked && !matrix?.has_saved_records && (
              <p className="text-xs text-muted-foreground">
                Showing defaults for {MEAL_LABELS[meal]} — Dining ON, Non-Dining and Room Guests OFF.
              </p>
            )}
          </div>
        )}
      </div>

      <DishDetailDialog
        dish={detailDish} date={date} mealType={meal} mealLabel={MEAL_LABELS[meal]} locked={locked}
        onOpenChange={open => { if (!open) setDetailDish(null); }}
        onChanged={refresh}
        onPersonClick={p => { setDetailDish(null); setHistoryPerson(p); }}
      />

      <OrderHistoryDialog
        open={historyPerson !== null}
        onOpenChange={open => { if (!open) setHistoryPerson(null); }}
        memberId={historyPerson?.kind === 'member' ? historyPerson.id : undefined}
        bookingId={historyPerson?.kind === 'booking' ? historyPerson.id : undefined}
        guestId={historyPerson?.kind === 'guest' ? historyPerson.id : undefined}
        personName={historyPerson?.name}
      />

      <SpecialOrderDialog open={specialOpen} onOpenChange={setSpecialOpen} onCreated={refresh} />
      <ConfirmDialog request={confirmRequest} onClose={() => setConfirmRequest(null)} />
    </div>
  );
}
