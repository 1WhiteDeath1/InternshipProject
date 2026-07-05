import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { ChefHat, Plus, Trash2, Flame, XCircle, Factory } from 'lucide-react';
import { defaultMealForNow } from '@/lib/mealDefaults';

interface Ingredient { id?: number; item_id: number; quantity: number; unit: string; item_name?: string | null; }
interface Recipe { id: number; name: string; description: string | null; menu_category: string | null; portions: number; is_active: boolean; ingredients: Ingredient[]; }
interface InventoryItemOption { id: number; name: string; unit: string; ingredient_type: string | null; }
interface KitchenOrder {
  id: number; recipe_id: number; recipe_name: string | null; quantity_ordered: number;
  actual_portions: number | null; food_cost: number | null; status: string; notes: string | null; created_at: string;
}
interface SuggestedOrder { recipe_id: number; recipe_name: string | null; suggested_quantity: number; }

const MEAL_TYPES = ['breakfast', 'lunch', 'hitea', 'dinner'];
const emptyRecipeForm = { name: '', description: '', menu_category: 'breakfast', portions: 1 };

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

export default function Kitchen() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [items, setItems] = useState<InventoryItemOption[]>([]);
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const [recipeDialogOpen, setRecipeDialogOpen] = useState(false);
  const [editingRecipeId, setEditingRecipeId] = useState<number | null>(null);
  const [recipeForm, setRecipeForm] = useState(emptyRecipeForm);
  const [recipeIngredients, setRecipeIngredients] = useState<Ingredient[]>([]);

  const [showManual, setShowManual] = useState(false);
  const [orderRecipeId, setOrderRecipeId] = useState(0);
  const [orderQuantity, setOrderQuantity] = useState(1);

  const [prodDate, setProdDate] = useState(new Date().toISOString().slice(0, 10));
  const [prodMeal, setProdMeal] = useState<string>(defaultMealForNow());
  const [suggested, setSuggested] = useState<SuggestedOrder[]>([]);
  const [busy, setBusy] = useState(false);

  const fetchRecipes = async () => {
    try { const res = await api.get('/recipes?page_size=100'); setRecipes(res.data.items); }
    catch { toast.error('Failed to load recipes'); }
  };

  const fetchItems = async () => {
    try { const res = await api.get('/inventory/items?page_size=100'); setItems(res.data.items); }
    catch { toast.error('Failed to load inventory items'); }
  };

  const fetchOrders = async () => {
    try { const res = await api.get('/kitchen/orders?page_size=100'); setOrders(res.data.items); }
    catch { toast.error('Failed to load kitchen orders'); }
  };

  const fetchSuggested = async () => {
    try {
      const res = await api.get(`/kitchen/suggested-orders?date=${prodDate}&meal_type=${prodMeal}`);
      setSuggested(res.data);
    } catch { toast.error('Failed to load booked meals'); }
  };

  useEffect(() => {
    queueMicrotask(() => {
      setLoading(true);
      Promise.all([fetchRecipes(), fetchItems(), fetchOrders()]).finally(() => setLoading(false));
    });
  }, []);

  useEffect(() => {
    queueMicrotask(() => { fetchSuggested(); });
  }, [prodDate, prodMeal]);

  const openCreateRecipe = () => {
    setEditingRecipeId(null);
    setRecipeForm(emptyRecipeForm);
    setRecipeIngredients([]);
    setRecipeDialogOpen(true);
  };

  const openEditRecipe = (r: Recipe) => {
    setEditingRecipeId(r.id);
    setRecipeForm({ name: r.name, description: r.description || '', menu_category: r.menu_category || 'breakfast', portions: r.portions });
    setRecipeIngredients(r.ingredients.map(i => ({ item_id: i.item_id, quantity: i.quantity, unit: i.unit })));
    setRecipeDialogOpen(true);
  };

  const addIngredientRow = () => setRecipeIngredients([...recipeIngredients, { item_id: 0, quantity: 0, unit: '' }]);
  const updateIngredientRow = (idx: number, patch: Partial<Ingredient>) => setRecipeIngredients(recipeIngredients.map((ing, i) => i === idx ? { ...ing, ...patch } : ing));
  const removeIngredientRow = (idx: number) => setRecipeIngredients(recipeIngredients.filter((_, i) => i !== idx));

  const handleSaveRecipe = async () => {
    if (!recipeForm.name.trim()) { toast.error('Recipe name is required'); return; }
    const ingredients = recipeIngredients.filter(i => i.item_id && i.quantity > 0);
    try {
      if (editingRecipeId) {
        await api.put(`/recipes/${editingRecipeId}`, { ...recipeForm, ingredients });
        toast.success('Recipe updated');
      } else {
        await api.post('/recipes', { ...recipeForm, ingredients });
        toast.success('Recipe created');
      }
      setRecipeDialogOpen(false);
      fetchRecipes();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to save recipe')); }
  };

  const handleDeactivateRecipe = async (id: number) => {
    if (!confirm('Deactivate this recipe?')) return;
    try { await api.delete(`/recipes/${id}`); toast.success('Recipe deactivated'); fetchRecipes(); }
    catch (err) { toast.error(getErrorMessage(err, 'Failed')); }
  };

  const handleGenerateOrders = async () => {
    setBusy(true);
    try {
      const res = await api.post(`/kitchen/orders/generate?date=${prodDate}&meal_type=${prodMeal}`);
      const created = res.data.created.length as number;
      const skipped = res.data.skipped.length as number;
      if (created === 0 && skipped === 0) toast.info('No booked menu items to produce for this date/meal');
      else toast.success(`Created ${created} production order(s)${skipped ? `, skipped ${skipped} already ordered` : ''}`);
      fetchOrders();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to generate orders')); }
    finally { setBusy(false); }
  };

  const handleCreateOrder = async () => {
    if (!orderRecipeId) { toast.error('Select a recipe to order'); return; }
    try {
      await api.post('/kitchen/orders', { recipe_id: orderRecipeId, quantity_ordered: orderQuantity });
      toast.success('Order added');
      setOrderRecipeId(0);
      setOrderQuantity(1);
      setShowManual(false);
      fetchOrders();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to create order')); }
  };

  const handleCook = async (id: number) => {
    try { await api.post(`/kitchen/orders/${id}/cook`, {}); toast.success('Cooked — inventory deducted'); fetchOrders(); }
    catch (err) { toast.error(getErrorMessage(err, 'Failed to cook order')); }
  };

  // Legacy "prepared" orders (created before one-tap cooking) already had their
  // inventory deducted at prepare time, so finishing them just flips to served -
  // never re-run the deduction via /cook, which would double-count stock.
  const handleFinishPrepared = async (id: number) => {
    try { await api.post(`/kitchen/orders/${id}/serve`); toast.success('Order finished'); fetchOrders(); }
    catch (err) { toast.error(getErrorMessage(err, 'Failed to finish order')); }
  };

  const handleCookAllPending = async () => {
    const pending = orders.filter(o => o.status === 'pending');
    if (pending.length === 0) { toast.info('No pending orders to cook'); return; }
    setBusy(true);
    let ok = 0; let fail = 0;
    for (const o of pending) {
      try { await api.post(`/kitchen/orders/${o.id}/cook`, {}); ok++; }
      catch { fail++; }
    }
    toast[fail ? 'warning' : 'success'](`Cooked ${ok} order(s)${fail ? `, ${fail} failed (check stock)` : ''}`);
    setBusy(false);
    fetchOrders();
  };

  const handleCancelOrder = async (id: number) => {
    try { await api.post(`/kitchen/orders/${id}/cancel`); toast.success('Order cancelled'); fetchOrders(); }
    catch (err) { toast.error(getErrorMessage(err, 'Failed to cancel order')); }
  };

  const orderStatusBadge = (status: string) => {
    const map: Record<string, { cls: string; label: string }> = {
      pending: { cls: 'bg-amber-100 text-amber-800', label: 'to cook' },
      prepared: { cls: 'bg-blue-100 text-blue-800', label: 'prepared' },
      served: { cls: 'bg-green-100 text-green-800', label: 'cooked' },
      cancelled: { cls: 'bg-gray-100 text-gray-800', label: 'cancelled' },
    };
    const s = map[status] || { cls: '', label: status };
    return <Badge className={s.cls}>{s.label}</Badge>;
  };

  const pendingCount = orders.filter(o => o.status === 'pending').length;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2"><ChefHat size={24} /> Kitchen</h1>

      <Tabs defaultValue="production">
        <TabsList className="grid grid-cols-2 max-w-xs">
          <TabsTrigger value="production">Production</TabsTrigger>
          <TabsTrigger value="recipes">Recipes</TabsTrigger>
        </TabsList>

        <TabsContent value="production" className="space-y-4">
          {/* Plan the meal: what's booked + turn it into orders */}
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <Input type="date" value={prodDate} onChange={e => setProdDate(e.target.value)} className="w-40" />
                <select className="h-10 rounded-md border border-input bg-background px-3 text-sm capitalize" value={prodMeal} onChange={e => setProdMeal(e.target.value)}>
                  {MEAL_TYPES.map(mt => <option key={mt} value={mt} className="capitalize">{mt}</option>)}
                </select>
                <Button onClick={handleGenerateOrders} disabled={busy || suggested.length === 0}>
                  <Factory size={16} className="mr-1" /> Generate from bookings
                </Button>
                <div className="flex-1" />
                <Button onClick={handleCookAllPending} disabled={busy || pendingCount === 0} className="bg-orange-600 hover:bg-orange-700">
                  <Flame size={16} className="mr-1" /> Cook all pending ({pendingCount})
                </Button>
              </div>
              <p className="text-xs text-gray-500">
                {suggested.length > 0
                  ? `Booked for this meal: ${suggested.map(s => `${s.recipe_name || `#${s.recipe_id}`} ×${s.suggested_quantity}`).join(', ')}. "Generate" turns these into production orders (skips ones already ordered).`
                  : 'No meals booked with a menu item for this date/meal yet. You can still add a manual order below.'}
              </p>
            </CardContent>
          </Card>

          {/* Orders board */}
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Recipe</TableHead><TableHead>Qty</TableHead><TableHead>Status</TableHead><TableHead className="w-48">Action</TableHead></TableRow></TableHeader>
                <TableBody>
                  {loading && <TableRow><TableCell colSpan={4} className="text-center py-8 text-gray-500">Loading…</TableCell></TableRow>}
                  {!loading && orders.map(o => (
                    <TableRow key={o.id}>
                      <TableCell className="font-medium">{o.recipe_name || `Recipe #${o.recipe_id}`}</TableCell>
                      <TableCell>{o.quantity_ordered}</TableCell>
                      <TableCell>{orderStatusBadge(o.status)}</TableCell>
                      <TableCell>
                        {o.status === 'pending' && (
                          <div className="flex gap-1">
                            <Button size="sm" onClick={() => handleCook(o.id)} className="bg-orange-600 hover:bg-orange-700"><Flame size={14} className="mr-1" /> Mark Cooked</Button>
                            <Button size="sm" variant="ghost" onClick={() => handleCancelOrder(o.id)} title="Cancel"><XCircle size={16} className="text-red-500" /></Button>
                          </div>
                        )}
                        {o.status === 'prepared' && (
                          <Button size="sm" onClick={() => handleFinishPrepared(o.id)} className="bg-orange-600 hover:bg-orange-700"><Flame size={14} className="mr-1" /> Finish</Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!loading && orders.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-8 text-gray-500">No orders yet — Generate from bookings, or add a manual order</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Manual order — de-emphasized */}
          {!showManual ? (
            <button className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300" onClick={() => setShowManual(true)}>+ Add a manual order</button>
          ) : (
            <Card>
              <CardContent className="p-4 flex items-center gap-2 flex-wrap">
                <select className="h-10 rounded-md border border-input bg-background px-3 text-sm flex-1 max-w-xs" value={orderRecipeId} onChange={e => setOrderRecipeId(Number(e.target.value))}>
                  <option value="0">Select recipe to produce</option>
                  {recipes.filter(r => r.is_active).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                <Input type="number" min={1} value={orderQuantity} onChange={e => setOrderQuantity(Number(e.target.value))} className="w-24" placeholder="Qty" />
                <Button onClick={handleCreateOrder}><Plus size={16} className="mr-1" /> Add</Button>
                <Button variant="ghost" onClick={() => setShowManual(false)}>Cancel</Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="recipes" className="space-y-4">
          <div className="flex justify-end">
            <Dialog open={recipeDialogOpen} onOpenChange={setRecipeDialogOpen}>
              <DialogTrigger asChild><Button onClick={openCreateRecipe}><Plus size={16} className="mr-1" /> Add Recipe</Button></DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader><DialogTitle>{editingRecipeId ? 'Edit Recipe' : 'Add Recipe'}</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Input placeholder="Recipe Name" value={recipeForm.name} onChange={e => setRecipeForm({...recipeForm, name: e.target.value})} />
                    <select className="h-10 rounded-md border border-input bg-background px-3 text-sm capitalize" value={recipeForm.menu_category} onChange={e => setRecipeForm({...recipeForm, menu_category: e.target.value})}>
                      {MEAL_TYPES.map(mt => <option key={mt} value={mt} className="capitalize">{mt}</option>)}
                    </select>
                  </div>
                  <Input placeholder="Description" value={recipeForm.description} onChange={e => setRecipeForm({...recipeForm, description: e.target.value})} />
                  <div>
                    <Label>Portions per Batch</Label>
                    <Input type="number" min={1} value={recipeForm.portions} onChange={e => setRecipeForm({...recipeForm, portions: Number(e.target.value)})} />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Ingredients</Label>
                      <Button size="sm" variant="outline" onClick={addIngredientRow}><Plus size={14} className="mr-1" /> Add Ingredient</Button>
                    </div>
                    {recipeIngredients.map((ing, idx) => {
                      const selectedItem = items.find(i => i.id === ing.item_id);
                      const unitChoices = unitChoicesFor(selectedItem, ing.unit);
                      return (
                      <div key={idx} className="flex items-center gap-2">
                        <select className="h-9 rounded-md border border-input bg-background px-2 text-sm flex-1" value={ing.item_id} onChange={e => {
                          const item = items.find(i => i.id === Number(e.target.value));
                          updateIngredientRow(idx, { item_id: Number(e.target.value), unit: unitChoicesFor(item, ing.unit)[0] });
                        }}>
                          <option value="0">Select item</option>
                          {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                        </select>
                        <Input type="number" min={0} step="0.01" placeholder="Qty" value={ing.quantity} onChange={e => updateIngredientRow(idx, { quantity: Number(e.target.value) })} className="w-24" />
                        <select className="h-9 rounded-md border border-input bg-background px-2 text-sm w-24" value={ing.unit} onChange={e => updateIngredientRow(idx, { unit: e.target.value })}>
                          {unitChoices.map(u => <option key={u} value={u}>{u}</option>)}
                        </select>
                        <Button size="sm" variant="ghost" onClick={() => removeIngredientRow(idx)}><Trash2 size={16} className="text-red-500" /></Button>
                      </div>
                      );
                    })}
                    {recipeIngredients.length === 0 && <p className="text-sm text-gray-500">No ingredients added - order/cook will still work but won't deduct inventory.</p>}
                  </div>

                  <Button onClick={handleSaveRecipe} className="w-full">{editingRecipeId ? 'Save Changes' : 'Create Recipe'}</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Category</TableHead><TableHead>Portions</TableHead><TableHead>Ingredients</TableHead><TableHead className="w-24">Actions</TableHead></TableRow></TableHeader>
                <TableBody>
                  {loading && <TableRow><TableCell colSpan={5} className="text-center py-8 text-gray-500">Loading...</TableCell></TableRow>}
                  {!loading && recipes.map(r => (
                    <TableRow key={r.id} className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-900" onClick={() => openEditRecipe(r)}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="capitalize">{r.menu_category || '-'}</TableCell>
                      <TableCell>{r.portions}</TableCell>
                      <TableCell className="text-sm text-gray-500">{r.ingredients.length} item(s)</TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); handleDeactivateRecipe(r.id); }}><Trash2 size={16} className="text-red-500" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!loading && recipes.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-8 text-gray-500">No recipes yet</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
