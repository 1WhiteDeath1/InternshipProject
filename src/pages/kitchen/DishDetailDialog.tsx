import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Flame, XCircle, ChevronRight } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';

/** Everything about one dish at one meal, in one place: who's eating it,
    what it costs, and the cook action. Previously these were three separate
    surfaces - an inline expander for the eaters, a Fuel-icon dialog for the
    pricing, and a button on the card - which is what made the board busy.
    Clicking any dish card opens this instead.

    Clicking a person here opens their own order history (the board passes
    that up), so every card on the board leads somewhere with more detail. */

export interface DishPerson { kind: 'member' | 'booking' | 'guest'; id: number; name: string }
export interface DishDetail {
  menu_item_id: number; name: string; menu_price: number; headcount: number;
  eaters: DishPerson[]; order_id: number | null; status: string | null;
  price_override: number | null; gas_amount: number | null;
}

export function DishDetailDialog({
  dish, date, mealType, mealLabel, locked, onOpenChange, onChanged, onPersonClick,
}: {
  dish: DishDetail | null;
  date: string;
  /** API value ("hitea"); mealLabel is only ever for display ("Hi-Tea"). */
  mealType: string;
  mealLabel: string;
  locked: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
  onPersonClick: (p: DishPerson) => void;
}) {
  const [priceInput, setPriceInput] = useState('');
  const [gasInput, setGasInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!dish) return;
    setPriceInput(dish.price_override !== null ? String(dish.price_override) : '');
    setGasInput(dish.gas_amount !== null ? String(dish.gas_amount) : '');
  }, [dish]);

  if (!dish) return null;

  const savePricing = async () => {
    setSaving(true);
    try {
      await api.put('/kitchen/dish-pricing', {
        date, meal_type: mealType, menu_item_id: dish.menu_item_id,
        price_override: priceInput.trim() === '' ? null : Number(priceInput),
        gas_amount: gasInput.trim() === '' ? null : Number(gasInput),
      });
      toast.success(`${dish.name} pricing updated`);
      onChanged();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to update pricing')); }
    finally { setSaving(false); }
  };

  const markCooked = async () => {
    setWorking(true);
    try {
      await api.post('/kitchen/meal-board/dish-cooked', {
        date, meal_type: mealType, menu_item_id: dish.menu_item_id,
      });
      toast.success(`${dish.name} marked cooked`);
      onChanged();
      onOpenChange(false);
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to mark cooked')); }
    finally { setWorking(false); }
  };

  const removeEater = async (p: DishPerson) => {
    const entries = dish.eaters.filter(e => !(e.kind === p.kind && e.id === p.id)).map(e => ({ kind: e.kind, id: e.id }));
    try {
      await api.post('/attendance/matrix/assign-item', {
        date, meal_type: mealType, menu_item_id: dish.menu_item_id, entries,
      });
      toast.success(`${p.name} removed from ${dish.name}`);
      onChanged();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to remove')); }
  };

  return (
    <Dialog open={!!dish} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {dish.name}
            {dish.status === 'served'
              ? <Badge className="bg-green-100 text-green-800">Cooked</Badge>
              : <Badge className="bg-amber-100 text-amber-800">To cook</Badge>}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {mealLabel} · {date} · <b className="text-foreground">{dish.headcount}</b> eating
          </p>

          <div className="rounded-lg border p-3 space-y-2">
            <p className="text-sm font-medium">Price per head</p>
            <p className="text-xs text-muted-foreground">
              Set once for this dish — everyone eating it at this meal is charged the same, member or guest.
              Leave blank to use the menu price ({formatCurrency(dish.menu_price)}) and no gas charge.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Food (Rs)</Label>
                <Input type="number" min={0} placeholder={`${dish.menu_price} (menu)`}
                  value={priceInput} onChange={e => setPriceInput(e.target.value.replace(/^0+(?=\d)/, ''))} />
              </div>
              <div>
                <Label className="text-xs">Gas (Rs)</Label>
                <Input type="number" min={0} placeholder="0"
                  value={gasInput} onChange={e => setGasInput(e.target.value.replace(/^0+(?=\d)/, ''))} />
              </div>
            </div>
            <Button size="sm" onClick={savePricing} disabled={saving}>{saving ? 'Saving…' : 'Save price'}</Button>
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-medium">Who's eating this ({dish.eaters.length})</p>
            {dish.eaters.length === 0 && <p className="text-xs text-muted-foreground">Nobody assigned yet</p>}
            {dish.eaters.map(e => (
              <div key={`${e.kind}-${e.id}`} className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5">
                <button type="button" className="flex items-center gap-1 text-sm hover:underline text-left min-w-0"
                  onClick={() => onPersonClick(e)}>
                  <span className="truncate">{e.name}</span>
                  <ChevronRight size={13} className="text-muted-foreground shrink-0" />
                </button>
                {!locked && (
                  <button type="button" title="Remove from this dish" className="text-muted-foreground hover:text-red-600 shrink-0"
                    onClick={() => removeEater(e)}>
                    <XCircle size={14} />
                  </button>
                )}
              </div>
            ))}
            <p className="text-[11px] text-muted-foreground">Tap a name to see everything they've ordered.</p>
          </div>

          {dish.status !== 'served' && (
            <Button className="w-full bg-orange-600 hover:bg-orange-700" onClick={markCooked} disabled={working}>
              <Flame size={15} className="mr-1" /> Mark cooked
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
