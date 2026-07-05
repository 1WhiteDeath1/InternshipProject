import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Trash2 } from 'lucide-react';

export interface Ingredient { id?: number; item_id: number; quantity: number; unit: string; item_name?: string | null; }
export interface InventoryItemOption { id: number; name: string; unit: string; ingredient_type: string | null; }

// Cooking units a recipe can be authored in, per ingredient density category -
// converted back to the item's own stock-tracked unit at deduction time
// (see backend/services/unit_conversion.py). Items with no ingredient_type
// set (count-based, e.g. eggs) fall back to just their own unit.
const UNIT_OPTIONS: Record<string, string[]> = {
  liquid: ['ml', 'l', 'cup', 'tbsp', 'tsp'],
  powder: ['g', 'kg', 'cup', 'tbsp', 'tsp'],
  granular: ['g', 'kg', 'cup', 'tbsp', 'tsp'],
  solid_pieces: ['g', 'kg', 'pcs'],
};
const unitChoicesFor = (item: InventoryItemOption | undefined, fallbackUnit: string): string[] =>
  (item?.ingredient_type && UNIT_OPTIONS[item.ingredient_type]) || [item?.unit ?? fallbackUnit];

interface Props {
  items: InventoryItemOption[];
  ingredients: Ingredient[];
  onChange: (ingredients: Ingredient[]) => void;
}

export default function RecipeIngredientEditor({ items, ingredients, onChange }: Props) {
  const addRow = () => onChange([...ingredients, { item_id: 0, quantity: 0, unit: '' }]);
  const updateRow = (idx: number, patch: Partial<Ingredient>) => onChange(ingredients.map((ing, i) => i === idx ? { ...ing, ...patch } : ing));
  const removeRow = (idx: number) => onChange(ingredients.filter((_, i) => i !== idx));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Ingredients</Label>
        <Button size="sm" variant="outline" type="button" onClick={addRow}><Plus size={14} className="mr-1" /> Add Ingredient</Button>
      </div>
      {ingredients.map((ing, idx) => {
        const selectedItem = items.find(i => i.id === ing.item_id);
        const unitChoices = unitChoicesFor(selectedItem, ing.unit);
        return (
          <div key={idx} className="flex items-center gap-2">
            <select className="h-9 rounded-md border border-input bg-background px-2 text-sm flex-1" value={ing.item_id} onChange={e => {
              const item = items.find(i => i.id === Number(e.target.value));
              updateRow(idx, { item_id: Number(e.target.value), unit: unitChoicesFor(item, ing.unit)[0] });
            }}>
              <option value="0">Select item</option>
              {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
            <Input type="number" min={0} step="0.01" placeholder="Qty" value={ing.quantity} onChange={e => updateRow(idx, { quantity: Number(e.target.value) })} className="w-24" />
            <select className="h-9 rounded-md border border-input bg-background px-2 text-sm w-24" value={ing.unit} onChange={e => updateRow(idx, { unit: e.target.value })}>
              {unitChoices.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
            <Button size="sm" variant="ghost" type="button" onClick={() => removeRow(idx)}><Trash2 size={16} className="text-red-500" /></Button>
          </div>
        );
      })}
      {ingredients.length === 0 && <p className="text-sm text-gray-500">No ingredients added - order/cook will still work but won't deduct inventory.</p>}
    </div>
  );
}
