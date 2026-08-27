import { useCallback, useEffect, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  Lock, Flame, Fuel, RotateCcw, ChevronDown, ChevronRight, Plus, AlertTriangle, XCircle,
} from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import { defaultMealForNow } from '@/lib/mealDefaults';
import { MealAttendanceOmnibar } from '@/components/MealAttendanceOmnibar';
import { ConfirmDialog, type ConfirmRequest } from '@/components/ConfirmDialog';
import { SpecialOrderDialog } from '@/components/SpecialOrderDialog';

/* The merged Meals board - what used to be the standalone Attendance page
   plus Kitchen's Production tab. Organised the way a kitchen actually thinks
   (by DISH: "lunch is chicken curry for 42 and dal for 8") rather than the
   way the data is stored (a roster of people on one screen, a list of orders
   on another). Marking someone present and choosing their dish is one action
   here, not two screens.

   Columns follow the real status flow: a routine batch dish is two-state
   (pending -> served), so it hops straight to Done in one tap; only a
   special (off-menu) order passes through Cooking with an SLA timer. */

const MEAL_TYPES = ['breakfast', 'lunch', 'hitea', 'dinner'];
const MEAL_LABELS: Record<string, string> = { breakfast: 'Breakfast', lunch: 'Lunch', hitea: 'Hi-Tea', dinner: 'Dinner' };

interface BoardPerson { kind: 'member' | 'booking' | 'guest'; id: number; name: string }
interface BoardDish {
  menu_item_id: number; name: string; menu_price: number; headcount: number;
  eaters: BoardPerson[]; order_id: number | null; status: string | null;
  quantity_ordered: number | null; price_override: number | null; gas_amount: number | null;
}
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
interface Matrix {
  date: string; meal_type: string; locked: boolean; has_saved_records: boolean;
  dining: MatrixRow[]; non_dining: MatrixRow[]; guests: MatrixRow[];
}
interface CutoffInfo { cutoff: string; locked: boolean }

function fmtTime12h(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
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
  const [showServed, setShowServed] = useState(false);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const [specialOpen, setSpecialOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const [pricingDish, setPricingDish] = useState<BoardDish | null>(null);
  const [priceInput, setPriceInput] = useState('');
  const [gasInput, setGasInput] = useState('');
  const [savingPricing, setSavingPricing] = useState(false);

  const isPast = new Date(date) < new Date(new Date().toDateString());

  const fetchBoard = useCallback(async () => {
    try {
      const res = await api.get(`/kitchen/meal-board?date=${date}&meal_type=${meal}`, { headers: { 'Cache-Control': 'no-cache' } });
      setBoard(res.data);
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to load the meal board')); }
  }, [date, meal]);

  const fetchMatrix = useCallback(async () => {
    try {
      const res = await api.get(`/attendance/matrix?date=${date}&meal_type=${meal}`, { headers: { 'Cache-Control': 'no-cache' } });
      setMatrix(res.data);
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to load attendance')); }
  }, [date, meal]);

  // Per-meal head counts for the selector chips - one lightweight matrix call
  // each, same source of truth as the board's own count.
  const fetchMealCounts = useCallback(async () => {
    try {
      const results = await Promise.all(MEAL_TYPES.map(mt =>
        api.get(`/attendance/matrix?date=${date}&meal_type=${mt}`, { headers: { 'Cache-Control': 'no-cache' } })
          .then(r => [mt, r.data as Matrix] as const)));
      const next: Record<string, number> = {};
      for (const [mt, m] of results) {
        next[mt] = [...m.dining, ...m.non_dining, ...m.guests].filter(r => r.present).length;
      }
      setMealCounts(next);
    } catch { /* chip counts are informational - the board itself still loads */ }
  }, [date]);

  const fetchCutoffs = useCallback(async () => {
    try {
      const res = await api.get(`/attendance/cutoffs?date=${date}`, { headers: { 'Cache-Control': 'no-cache' } });
      setCutoffs(res.data);
    } catch { /* lock state also comes from the board itself */ }
  }, [date]);

  const refresh = useCallback(async () => {
    await Promise.all([fetchBoard(), fetchMatrix(), fetchMealCounts(), fetchCutoffs()]);
  }, [fetchBoard, fetchMatrix, fetchMealCounts, fetchCutoffs]);

  useEffect(() => {
    queueMicrotask(() => { setLoading(true); refresh().finally(() => setLoading(false)); });
  }, [refresh]);

  useEffect(() => { setAddDishId(0); }, [meal, date]);

  // 1s tick redraws the special-order countdowns; the 20s poll picks up
  // server-side SLA recomputation (there's no background scheduler).
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
    // Backend sends naive UTC timestamps - force UTC or the countdown is off
    // by the browser's offset.
    const utc = dueAt.endsWith('Z') || dueAt.includes('+') ? dueAt : `${dueAt}Z`;
    const diff = new Date(utc).getTime() - now;
    const overdue = diff <= 0;
    const sec = Math.floor(Math.abs(diff) / 1000);
    // A stale order left open for days would render as "-31867:57" in raw
    // mm:ss, which reads as a glitch. Past an hour, say it in hours/days.
    if (sec >= 86400) return { label: `${Math.floor(sec / 86400)}d overdue`, overdue };
    if (sec >= 3600) {
      const h = Math.floor(sec / 3600);
      return { label: `${h}h ${overdue ? 'overdue' : 'left'}`, overdue };
    }
    return { label: `${overdue ? '-' : ''}${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`, overdue };
  };

  /** Assign one person to a dish. The endpoint takes the FULL set of eaters
      for that dish (it diffs to decide who to clear), so send everyone
      already on it plus the newcomer. */
  const assignToDish = async (person: { kind: string; id: number }, dishId: number) => {
    const dish = board?.dishes.find(d => d.menu_item_id === dishId);
    const entries = [
      ...(dish?.eaters ?? []).map(e => ({ kind: e.kind, id: e.id })),
      { kind: person.kind, id: person.id },
    ];
    try {
      await api.post('/attendance/matrix/assign-item', { date, meal_type: meal, menu_item_id: dishId, entries });
      await refresh();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to assign the dish')); }
  };

  const removeFromDish = async (person: BoardPerson, dishId: number) => {
    const dish = board?.dishes.find(d => d.menu_item_id === dishId);
    const entries = (dish?.eaters ?? [])
      .filter(e => !(e.kind === person.kind && e.id === person.id))
      .map(e => ({ kind: e.kind, id: e.id }));
    try {
      await api.post('/attendance/matrix/assign-item', { date, meal_type: meal, menu_item_id: dishId, entries });
      await refresh();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to remove from the dish')); }
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

  const handleSpecialAdvance = async (o: BoardSpecial, action: 'start-cooking' | 'complete' | 'cancel') => {
    try {
      await api.post(`/kitchen/orders/${o.id}/${action}`);
      toast.success(action === 'cancel' ? 'Special order cancelled' : action === 'complete' ? 'Special order done' : 'Cooking started');
      await fetchBoard();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to update the order')); }
  };

  const openPricing = (dish: BoardDish) => {
    setPricingDish(dish);
    setPriceInput(dish.price_override !== null ? String(dish.price_override) : '');
    setGasInput(dish.gas_amount !== null ? String(dish.gas_amount) : '');
  };

  const handleSavePricing = async () => {
    if (!pricingDish) return;
    setSavingPricing(true);
    try {
      await api.put('/kitchen/dish-pricing', {
        date, meal_type: meal, menu_item_id: pricingDish.menu_item_id,
        price_override: priceInput.trim() === '' ? null : Number(priceInput),
        gas_amount: gasInput.trim() === '' ? null : Number(gasInput),
      });
      toast.success(`Pricing for ${pricingDish.name} updated`);
      setPricingDish(null);
      await fetchBoard();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to update pricing')); }
    finally { setSavingPricing(false); }
  };

  // --- roster toggles (same rules the old Attendance page enforced) ---
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
      // A hard lock (today, past cutoff) has no override; only a genuinely
      // past date with a stored record can be corrected, and only with a reason.
      if (isPast && r.attendance_id) {
        setConfirmRequest({
          title: 'Remove past attendance record?',
          description: `${r.name} — ${date}`,
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

  const toCookDishes = board?.dishes.filter(d => d.status !== 'served') ?? [];
  const doneDishes = board?.dishes.filter(d => d.status === 'served') ?? [];
  const specialPending = board?.special_orders.filter(o => o.status === 'pending') ?? [];
  const specialCooking = board?.special_orders.filter(o => o.status === 'cooking' || o.status === 'late') ?? [];
  const specialDone = board?.special_orders.filter(o => o.status === 'served') ?? [];

  const DishCard = ({ d }: { d: BoardDish }) => {
    const [open, setOpen] = useState(false);
    const priced = d.price_override !== null || d.gas_amount !== null;
    return (
      <div className="rounded-md border bg-card p-2.5 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold text-sm leading-tight">{d.name}</p>
          <Badge className="bg-emerald-100 text-emerald-800 shrink-0">{d.headcount}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {formatCurrency(d.price_override ?? d.menu_price)}/head
          {d.gas_amount !== null && ` · gas ${formatCurrency(d.gas_amount)}`}
        </p>
        {d.eaters.length > 0 && (
          <button type="button" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            onClick={() => setOpen(o => !o)}>
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} who's eating this
          </button>
        )}
        {open && (
          <div className="space-y-0.5 pl-1">
            {d.eaters.map(e => (
              <div key={`${e.kind}-${e.id}`} className="flex items-center justify-between text-xs">
                <span className="truncate">{e.name}</span>
                {!locked && (
                  <button type="button" title="Remove from this dish" className="text-muted-foreground hover:text-red-600"
                    onClick={() => removeFromDish(e, d.menu_item_id)}>
                    <XCircle size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1 pt-0.5">
          {d.status !== 'served' && (
            <Button size="sm" className="flex-1 h-7 bg-orange-600 hover:bg-orange-700" onClick={() => handleDishCooked(d)}>
              <Flame size={13} className="mr-1" /> Cooked
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-7" title={priced ? 'Food/gas price set — click to edit' : 'Set food price / gas charge'}
            onClick={() => openPricing(d)}>
            <Fuel size={14} className={priced ? 'text-orange-600' : 'text-muted-foreground'} />
          </Button>
        </div>
      </div>
    );
  };

  const SpecialCard = ({ o }: { o: BoardSpecial }) => {
    const { label, overdue } = countdown(o.due_at);
    const isLate = o.status === 'late';
    return (
      <div className={`rounded-md border-l-4 border p-2.5 space-y-1 ${isLate ? 'border-red-400 border-l-red-500 bg-red-50 dark:bg-red-950/20' : 'border-l-fuchsia-500 bg-card'}`}>
        <p className="text-[10px] font-bold uppercase tracking-wide text-fuchsia-700 dark:text-fuchsia-400">Special order</p>
        <p className="font-semibold text-sm leading-tight">{o.name}</p>
        <p className="text-xs text-muted-foreground">{o.consumer_name || 'Unknown'} · qty {o.quantity_ordered}</p>
        {o.status !== 'served' && (
          <p className={`text-xs font-mono ${overdue ? 'text-red-600' : 'text-muted-foreground'}`}>{label}</p>
        )}
        <div className="flex gap-1">
          {o.status === 'pending' && (
            <Button size="sm" className="flex-1 h-7 bg-orange-600 hover:bg-orange-700" onClick={() => handleSpecialAdvance(o, 'start-cooking')}>
              <Flame size={13} className="mr-1" /> Start
            </Button>
          )}
          {(o.status === 'cooking' || (isLate && o.cooking_started_at)) && (
            <Button size="sm" className="flex-1 h-7 bg-green-600 hover:bg-green-700" onClick={() => handleSpecialAdvance(o, 'complete')}>Done</Button>
          )}
          {isLate && !o.cooking_started_at && (
            <Button size="sm" className="flex-1 h-7 bg-orange-600 hover:bg-orange-700" onClick={() => handleSpecialAdvance(o, 'start-cooking')}>
              <Flame size={13} className="mr-1" /> Start
            </Button>
          )}
          {o.status !== 'served' && (
            <Button size="sm" variant="ghost" className="h-7" title="Cancel" onClick={() => handleSpecialAdvance(o, 'cancel')}>
              <XCircle size={14} className="text-red-500" />
            </Button>
          )}
        </div>
      </div>
    );
  };

  const RosterGroup = ({ title, rows }: { title: string; rows: MatrixRow[] }) => (
    <Card>
      <CardContent className="p-3 space-y-1.5">
        <h4 className="text-xs font-semibold text-muted-foreground">{title} ({rows.length})</h4>
        {rows.length === 0 && <p className="text-xs text-muted-foreground">None</p>}
        {rows.map(r => (
          <div key={`${r.kind}-${r.id}`} className="flex items-center justify-between gap-2 py-1 border-b last:border-0">
            <div className="min-w-0">
              <p className="text-sm truncate">{r.name}</p>
              <p className="text-xs text-muted-foreground truncate">
                {r.sub_label || '-'}
                {r.present && (r.menu_item_name
                  ? <span className="ml-1 text-emerald-700 dark:text-emerald-400">· {r.menu_item_name}</span>
                  : <span className="ml-1 text-amber-600">· no dish</span>)}
              </p>
            </div>
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

  return (
    <div className="space-y-4">
      {/* Meal + date selector */}
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
        <Button variant="outline" size="sm" disabled={busy || locked} onClick={handleCopyLast} title="Give everyone present the dish they had last time this meal ran">
          <RotateCcw size={14} className="mr-1" /> Copy from last {MEAL_LABELS[meal]}
        </Button>
        <Button size="sm" onClick={() => setSpecialOpen(true)}>
          <Plus size={14} className="mr-1" /> Special Order
        </Button>
      </div>

      {/* Summary */}
      <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-sm">
        <span className="font-semibold">{presentRows.length} confirmed</span>
        {unassigned.length > 0 && <span className="text-amber-600">{unassigned.length} with no dish yet</span>}
        {board && (
          <span className={`text-xs flex items-center gap-1 ${locked ? 'text-amber-600 font-medium' : 'text-muted-foreground'}`}>
            {locked ? <><Lock size={12} /> Final — closed at {fmtTime12h(board.cutoff)}</> : `Closes at ${fmtTime12h(board.cutoff)}`}
          </span>
        )}
      </div>

      {/* One-step add: who + what they're eating, in the same row */}
      {!locked && (
        <Card>
          <CardContent className="p-3 space-y-2">
            <div className="flex items-end gap-2 flex-wrap">
              <div className="min-w-52">
                <Label className="text-xs text-muted-foreground">Eating</Label>
                <select className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={addDishId} onChange={e => setAddDishId(Number(e.target.value))}>
                  <option value="0">Dish not decided yet</option>
                  {board?.menu_options.map(m => <option key={m.id} value={m.id}>{m.name} — {formatCurrency(m.price)}</option>)}
                </select>
              </div>
              <p className="text-xs text-muted-foreground pb-2.5">
                Pick the dish first, then add people — they're marked present and assigned in one step.
              </p>
            </div>
            <MealAttendanceOmnibar
              date={date} mealType={meal} menuItemId={addDishId} onAdded={refresh}
              mealTypes={MEAL_TYPES} mealLabels={MEAL_LABELS} lockedMeals={lockedMeals}
            />
          </CardContent>
        </Card>
      )}

      {/* Present but no dish - the only thing that actually needs attention */}
      {unassigned.length > 0 && !locked && (
        <Card className="border-amber-300 dark:border-amber-900">
          <CardContent className="p-3 space-y-2">
            <p className="text-sm font-medium flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
              <AlertTriangle size={15} /> {unassigned.length} attending {MEAL_LABELS[meal]} with no dish assigned
            </p>
            <div className="flex flex-wrap gap-2">
              {unassigned.map(r => (
                <div key={`${r.kind}-${r.id}`} className="flex items-center gap-1.5 rounded-md border bg-card px-2 py-1">
                  <span className="text-sm">{r.name}</span>
                  <select className="h-7 rounded border border-input bg-background px-1.5 text-xs" defaultValue="0"
                    onChange={e => { const id = Number(e.target.value); if (id) assignToDish(r, id); }}>
                    <option value="0">pick dish…</option>
                    {board?.menu_options.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* The board */}
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!loading && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex justify-between">
              <span>To cook</span><span>{toCookDishes.length + specialPending.length}</span>
            </h3>
            {toCookDishes.map(d => <DishCard key={d.menu_item_id} d={d} />)}
            {specialPending.map(o => <SpecialCard key={o.id} o={o} />)}
            {toCookDishes.length + specialPending.length === 0 && <p className="text-xs text-muted-foreground">Nothing waiting</p>}
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex justify-between">
              <span>Cooking</span><span>{specialCooking.length}</span>
            </h3>
            {specialCooking.map(o => <SpecialCard key={o.id} o={o} />)}
            {specialCooking.length === 0 && (
              <p className="text-xs text-muted-foreground">Nothing cooking — batch dishes go straight to Done in one tap</p>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex justify-between">
              <span>Done</span><span>{doneDishes.length + specialDone.length}</span>
            </h3>
            {/* Collapsed by default so the board stays as long as the work
                that's LEFT, not as long as the menu (15+ dishes a service). */}
            {doneDishes.length + specialDone.length === 0 && <p className="text-xs text-muted-foreground">Nothing done yet</p>}
            {doneDishes.length + specialDone.length > 0 && !showServed && (
              <button type="button" onClick={() => setShowServed(true)}
                className="w-full rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground hover:text-foreground text-left">
                ▸ {doneDishes.length + specialDone.length} done — {[...doneDishes.map(d => d.name), ...specialDone.map(o => o.name)].slice(0, 3).join(', ')}
                {doneDishes.length + specialDone.length > 3 ? '…' : ''}
              </button>
            )}
            {showServed && (
              <>
                <button type="button" onClick={() => setShowServed(false)} className="text-xs text-muted-foreground hover:text-foreground">▾ collapse</button>
                {doneDishes.map(d => <DishCard key={d.menu_item_id} d={d} />)}
                {specialDone.map(o => <SpecialCard key={o.id} o={o} />)}
              </>
            )}
          </div>
        </div>
      )}

      {/* Full roster - secondary; the board above is the primary surface */}
      <div>
        <button type="button" onClick={() => setRosterOpen(o => !o)}
          className="text-sm font-semibold flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
          {rosterOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          Who's attending ({presentRows.length})
        </button>
        {rosterOpen && matrix && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mt-2">
            <RosterGroup title="Dining Members" rows={matrix.dining} />
            <RosterGroup title="Non-Dining Members" rows={matrix.non_dining} />
            <RosterGroup title="Room Guests" rows={matrix.guests} />
          </div>
        )}
        {rosterOpen && !locked && !matrix?.has_saved_records && (
          <p className="text-xs text-muted-foreground mt-2">
            Showing defaults for {MEAL_LABELS[meal]} (nothing saved yet) — Dining ON, Non-Dining and Room Guests OFF.
          </p>
        )}
      </div>

      <Dialog open={pricingDish !== null} onOpenChange={open => { if (!open) setPricingDish(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Pricing — {pricingDish?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Set once for this dish. Everyone who ate it at {MEAL_LABELS[meal]} on {date} is charged these amounts,
              member or guest alike. Leave blank to fall back to the menu price / no gas charge.
            </p>
            <div>
              <Label>Food price per head (Rs)</Label>
              <Input type="number" min={0} autoFocus placeholder={String(pricingDish?.menu_price ?? '')}
                value={priceInput} onChange={e => setPriceInput(e.target.value.replace(/^0+(?=\d)/, ''))} />
            </div>
            <div>
              <Label>Gas charge per head (Rs)</Label>
              <Input type="number" min={0} placeholder="0" value={gasInput} onChange={e => setGasInput(e.target.value.replace(/^0+(?=\d)/, ''))} />
            </div>
            <Button onClick={handleSavePricing} disabled={savingPricing} className="w-full">{savingPricing ? 'Saving…' : 'Save'}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <SpecialOrderDialog open={specialOpen} onOpenChange={setSpecialOpen} onCreated={fetchBoard} />
      <ConfirmDialog request={confirmRequest} onClose={() => setConfirmRequest(null)} />
    </div>
  );
}
