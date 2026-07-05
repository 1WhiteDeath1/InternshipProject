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
import { ChefHat, Plus, Trash2, Flame, CheckCircle2, XCircle, Factory } from 'lucide-react';
import { defaultMealForNow } from '@/lib/mealDefaults';

interface Ingredient { id?: number; item_id: number; quantity: number; unit: string; item_name?: string | null; }
interface Recipe { id: number; name: string; description: string | null; menu_category: string | null; portions: number; is_active: boolean; ingredients: Ingredient[]; }
interface InventoryItemOption { id: number; name: string; unit: string; }
interface KitchenOrder {
  id: number; recipe_id: number; recipe_name: string | null; quantity_ordered: number;
  actual_portions: number | null; food_cost: number | null; status: string; notes: string | null; created_at: string;
}
interface SuggestedOrder { recipe_id: number; recipe_name: string | null; suggested_quantity: number; }

const MEAL_TYPES = ['breakfast', 'lunch', 'hitea', 'dinner'];
const emptyRecipeForm = { name: '', description: '', menu_category: 'breakfast', portions: 1 };

export default function Kitchen() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [items, setItems] = useState<InventoryItemOption[]>([]);
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const [recipeDialogOpen, setRecipeDialogOpen] = useState(false);
  const [editingRecipeId, setEditingRecipeId] = useState<number | null>(null);
  const [recipeForm, setRecipeForm] = useState(emptyRecipeForm);
  const [recipeIngredients, setRecipeIngredients] = useState<Ingredient[]>([]);

  const [orderRecipeId, setOrderRecipeId] = useState(0);
  const [orderQuantity, setOrderQuantity] = useState(1);

  const [consumptionDate, setConsumptionDate] = useState(new Date().toISOString().slice(0, 10));
  const [consumptionMeal, setConsumptionMeal] = useState<string>(defaultMealForNow());
  const [suggested, setSuggested] = useState<SuggestedOrder[]>([]);
  const [generating, setGenerating] = useState(false);

  const fetchRecipes = async () => {
    try {
      const res = await api.get('/recipes?page_size=100');
      setRecipes(res.data.items);
    } catch { toast.error('Failed to load recipes'); }
  };

  const fetchItems = async () => {
    try {
      const res = await api.get('/inventory/items?page_size=100');
      setItems(res.data.items);
    } catch { toast.error('Failed to load inventory items'); }
  };

  const fetchOrders = async () => {
    try {
      const res = await api.get('/kitchen/orders?page_size=100');
      setOrders(res.data.items);
    } catch { toast.error('Failed to load kitchen orders'); }
  };

  const fetchSuggested = async () => {
    try {
      const res = await api.get(`/kitchen/suggested-orders?date=${consumptionDate}&meal_type=${consumptionMeal}`);
      setSuggested(res.data);
    } catch { toast.error('Failed to load suggested orders'); }
  };

  useEffect(() => {
    queueMicrotask(() => {
      setLoading(true);
      Promise.all([fetchRecipes(), fetchItems(), fetchOrders()]).finally(() => setLoading(false));
    });
  }, []);

  useEffect(() => {
    queueMicrotask(() => { fetchSuggested(); });
  }, [consumptionDate, consumptionMeal]);

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

  const addIngredientRow = () => {
    setRecipeIngredients([...recipeIngredients, { item_id: 0, quantity: 0, unit: '' }]);
  };

  const updateIngredientRow = (idx: number, patch: Partial<Ingredient>) => {
    setRecipeIngredients(recipeIngredients.map((ing, i) => i === idx ? { ...ing, ...patch } : ing));
  };

  const removeIngredientRow = (idx: number) => {
    setRecipeIngredients(recipeIngredients.filter((_, i) => i !== idx));
  };

  const handleSaveRecipe = async () => {
    if (!recipeForm.name.trim()) {
      toast.error('Recipe name is required');
      return;
    }
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
    try {
      await api.delete(`/recipes/${id}`);
      toast.success('Recipe deactivated');
      fetchRecipes();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed')); }
  };

  const handleGenerateOrders = async () => {
    setGenerating(true);
    try {
      const res = await api.post(`/kitchen/orders/generate?date=${consumptionDate}&meal_type=${consumptionMeal}`);
      const created = res.data.created.length as number;
      const skipped = res.data.skipped.length as number;
      if (created === 0 && skipped === 0) {
        toast.info('No booked menu items to produce for this date/meal');
      } else {
        toast.success(`Created ${created} production order(s)${skipped ? `, skipped ${skipped} already ordered` : ''}`);
      }
      fetchOrders();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to generate orders')); }
    finally { setGenerating(false); }
  };

  const handleCreateOrder = async () => {
    if (!orderRecipeId) {
      toast.error('Select a recipe to order');
      return;
    }
    try {
      await api.post('/kitchen/orders', { recipe_id: orderRecipeId, quantity_ordered: orderQuantity });
      toast.success('Kitchen order created');
      setOrderRecipeId(0);
      setOrderQuantity(1);
      fetchOrders();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to create order')); }
  };

  const handlePrepare = async (id: number) => {
    try {
      await api.post(`/kitchen/orders/${id}/prepare`, {});
      toast.success('Order prepared - inventory deducted');
      fetchOrders();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to prepare order')); }
  };

  const handleServe = async (id: number) => {
    try {
      await api.post(`/kitchen/orders/${id}/serve`);
      toast.success('Order served');
      fetchOrders();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to serve order')); }
  };

  const handleCancelOrder = async (id: number) => {
    try {
      await api.post(`/kitchen/orders/${id}/cancel`);
      toast.success('Order cancelled');
      fetchOrders();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to cancel order')); }
  };

  const orderStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      pending: 'bg-amber-100 text-amber-800', prepared: 'bg-blue-100 text-blue-800',
      served: 'bg-green-100 text-green-800', cancelled: 'bg-gray-100 text-gray-800',
    };
    return <Badge className={colors[status] || ''}>{status}</Badge>;
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2"><ChefHat size={24} /> Kitchen Module</h1>

      <Tabs defaultValue="consumption">
        <TabsList className="grid grid-cols-3 max-w-lg">
          <TabsTrigger value="consumption">Today's Consumption</TabsTrigger>
          <TabsTrigger value="orders">Orders</TabsTrigger>
          <TabsTrigger value="recipes">Recipes</TabsTrigger>
        </TabsList>

        <TabsContent value="consumption" className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <Input type="date" value={consumptionDate} onChange={e => setConsumptionDate(e.target.value)} className="w-40" />
            <select className="h-10 rounded-md border border-input bg-background px-3 text-sm capitalize" value={consumptionMeal} onChange={e => setConsumptionMeal(e.target.value)}>
              {MEAL_TYPES.map(mt => <option key={mt} value={mt} className="capitalize">{mt}</option>)}
            </select>
            <Button onClick={handleGenerateOrders} disabled={generating || suggested.length === 0}>
              <Factory size={16} className="mr-1" /> Generate Production Orders
            </Button>
          </div>
          <p className="text-sm text-gray-500">
            Combined headcount of members and hotel guests booked for this meal, grouped by menu item.
            One click turns these into pending kitchen orders — re-running skips menu items already ordered. Bookings lock at each meal's cutoff.
          </p>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Menu Item</TableHead><TableHead>Suggested Quantity</TableHead></TableRow></TableHeader>
                <TableBody>
                  {suggested.map(s => (
                    <TableRow key={s.recipe_id}>
                      <TableCell className="font-medium">{s.recipe_name || `Recipe #${s.recipe_id}`}</TableCell>
                      <TableCell>{s.suggested_quantity}</TableCell>
                    </TableRow>
                  ))}
                  {suggested.length === 0 && <TableRow><TableCell colSpan={2} className="text-center py-8 text-gray-500">No meals booked for this date/meal yet</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="orders" className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <select className="h-10 rounded-md border border-input bg-background px-3 text-sm flex-1 max-w-xs" value={orderRecipeId} onChange={e => setOrderRecipeId(Number(e.target.value))}>
              <option value="0">Select recipe to produce</option>
              {recipes.filter(r => r.is_active).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <Input type="number" min={1} value={orderQuantity} onChange={e => setOrderQuantity(Number(e.target.value))} className="w-28" placeholder="Qty" />
            <Button onClick={handleCreateOrder}><Plus size={16} className="mr-1" /> Create Order</Button>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Recipe</TableHead><TableHead>Qty Ordered</TableHead><TableHead>Actual Portions</TableHead><TableHead>Status</TableHead><TableHead className="w-48">Actions</TableHead></TableRow></TableHeader>
                <TableBody>
                  {loading && <TableRow><TableCell colSpan={5} className="text-center py-8 text-gray-500">Loading...</TableCell></TableRow>}
                  {!loading && orders.map(o => (
                    <TableRow key={o.id}>
                      <TableCell className="font-medium">{o.recipe_name || `Recipe #${o.recipe_id}`}</TableCell>
                      <TableCell>{o.quantity_ordered}</TableCell>
                      <TableCell>{o.actual_portions ?? '-'}</TableCell>
                      <TableCell>{orderStatusBadge(o.status)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {o.status === 'pending' && (
                            <>
                              <Button size="sm" variant="ghost" onClick={() => handlePrepare(o.id)} title="Prepare (deducts inventory)"><Flame size={16} className="text-orange-600" /></Button>
                              <Button size="sm" variant="ghost" onClick={() => handleCancelOrder(o.id)}><XCircle size={16} className="text-red-500" /></Button>
                            </>
                          )}
                          {o.status === 'prepared' && (
                            <>
                              <Button size="sm" variant="ghost" onClick={() => handleServe(o.id)}><CheckCircle2 size={16} className="text-green-600" /></Button>
                              <Button size="sm" variant="ghost" onClick={() => handleCancelOrder(o.id)}><XCircle size={16} className="text-red-500" /></Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!loading && orders.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-8 text-gray-500">No kitchen orders yet</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
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
                    {recipeIngredients.map((ing, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <select className="h-9 rounded-md border border-input bg-background px-2 text-sm flex-1" value={ing.item_id} onChange={e => {
                          const item = items.find(i => i.id === Number(e.target.value));
                          updateIngredientRow(idx, { item_id: Number(e.target.value), unit: item?.unit || ing.unit });
                        }}>
                          <option value="0">Select item</option>
                          {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                        </select>
                        <Input type="number" min={0} step="0.01" placeholder="Qty" value={ing.quantity} onChange={e => updateIngredientRow(idx, { quantity: Number(e.target.value) })} className="w-24" />
                        <Input placeholder="Unit" value={ing.unit} onChange={e => updateIngredientRow(idx, { unit: e.target.value })} className="w-20" />
                        <Button size="sm" variant="ghost" onClick={() => removeIngredientRow(idx)}><Trash2 size={16} className="text-red-500" /></Button>
                      </div>
                    ))}
                    {recipeIngredients.length === 0 && <p className="text-sm text-gray-500">No ingredients added - order/prepare will still work but won't deduct inventory.</p>}
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
