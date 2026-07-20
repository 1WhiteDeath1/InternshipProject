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
import { ChefHat, Plus, Trash2, Flame, XCircle, Factory, AlertTriangle, UtensilsCrossed, Receipt } from 'lucide-react';
import { defaultMealForNow } from '@/lib/mealDefaults';
import RecipeIngredientEditor, { type Ingredient, type InventoryItemOption } from '@/components/RecipeIngredientEditor';
import { GuestChargePanel } from '@/components/GuestChargePanel';
import { MealServiceTab } from '@/pages/kitchen/MealServiceTab';

interface Recipe { id: number; name: string; description: string | null; menu_category: string | null; portions: number; is_active: boolean; ingredients: Ingredient[]; }
interface KitchenOrder {
  id: number; recipe_id: number; recipe_name: string | null; quantity_ordered: number;
  actual_portions: number | null; food_cost: number | null; status: string; notes: string | null; created_at: string;
  is_ala_carte: boolean; consumer_type: string | null; member_id: number | null; booking_id: number | null;
  consumer_name: string | null; sla_minutes: number | null; due_at: string | null; cooking_started_at: string | null;
}
interface SuggestedOrder { recipe_id: number; recipe_name: string | null; suggested_quantity: number; }
interface MemberOption { id: number; full_name: string; service_number: string; }
interface BookingOption { id: number; guest_name: string; room_number: string; }
interface LateOrder { id: number; recipe_name: string | null; consumer_name: string | null; due_at: string | null; }

const MEAL_TYPES = ['breakfast', 'lunch', 'hitea', 'dinner'];
const emptyRecipeForm = { name: '', description: '', menu_category: 'breakfast', portions: 1 };
const emptyAlaCarteForm = { recipe_id: 0, consumer_kind: 'guest' as 'member' | 'guest', consumer_id: 0, quantity: 1, sla_minutes: 45 };

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

  // A la carte custom orders: consumer picker + timer
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [bookings, setBookings] = useState<BookingOption[]>([]);
  const [lateOrders, setLateOrders] = useState<LateOrder[]>([]);
  const [alaCarteDialogOpen, setAlaCarteDialogOpen] = useState(false);
  const [alaCarteForm, setAlaCarteForm] = useState(emptyAlaCarteForm);
  const [showNewRecipeInline, setShowNewRecipeInline] = useState(false);
  const [newRecipeForm, setNewRecipeForm] = useState(emptyRecipeForm);
  const [newRecipeIngredients, setNewRecipeIngredients] = useState<Ingredient[]>([]);
  const [now, setNow] = useState(() => Date.now()); // ticks every second to redraw live countdowns
  const [chargeBookingId, setChargeBookingId] = useState(0);

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

  const fetchMembers = async () => {
    try { const res = await api.get('/members?status=active&page_size=100'); setMembers(res.data.items); }
    catch { /* consumer picker is secondary to the core order flow */ }
  };

  const fetchBookings = async () => {
    try { const res = await api.get('/bookings?status=checked_in'); setBookings(res.data.items); }
    catch { /* consumer picker is secondary to the core order flow */ }
  };

  const fetchLateSummary = async () => {
    try { const res = await api.get('/kitchen/orders/late-summary'); setLateOrders(res.data.items); }
    catch { /* banner is best-effort, not critical */ }
  };

  useEffect(() => {
    queueMicrotask(() => {
      setLoading(true);
      Promise.all([fetchRecipes(), fetchItems(), fetchOrders(), fetchMembers(), fetchBookings(), fetchLateSummary()]).finally(() => setLoading(false));
    });
  }, []);

  useEffect(() => {
    queueMicrotask(() => { fetchSuggested(); });
  }, [prodDate, prodMeal]);

  // Lazy SLA recompute happens server-side on every GET /kitchen/orders - this
  // poll (plus the 1s countdown tick) is what keeps the a la carte board and
  // late banner live without a background scheduler.
  useEffect(() => {
    const poll = setInterval(() => { fetchOrders(); fetchLateSummary(); }, 20000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, []);

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
    const pending = orders.filter(o => o.status === 'pending' && !o.is_ala_carte);
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

  const openAlaCarteDialog = (preset?: { consumer_kind: 'member' | 'guest'; consumer_id: number }) => {
    setAlaCarteForm({ ...emptyAlaCarteForm, ...preset });
    setShowNewRecipeInline(false);
    setNewRecipeForm(emptyRecipeForm);
    setNewRecipeIngredients([]);
    setAlaCarteDialogOpen(true);
  };

  // Meal Service tab's "Special Order" button - kind is "member"|"booking"
  // from the omnibar lookup, the a la carte form uses "member"|"guest".
  const openSpecialOrderFor = (kind: 'member' | 'booking', id: number) => {
    openAlaCarteDialog({ consumer_kind: kind === 'member' ? 'member' : 'guest', consumer_id: id });
  };

  const handleCreateRecipeInline = async () => {
    if (!newRecipeForm.name.trim()) { toast.error('Recipe name is required'); return; }
    const ingredients = newRecipeIngredients.filter(i => i.item_id && i.quantity > 0);
    try {
      const res = await api.post('/recipes', { ...newRecipeForm, ingredients });
      toast.success('Recipe created');
      await fetchRecipes();
      setAlaCarteForm({ ...alaCarteForm, recipe_id: res.data.id });
      setShowNewRecipeInline(false);
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to create recipe')); }
  };

  const handleCreateAlaCarteOrder = async () => {
    if (!alaCarteForm.recipe_id) { toast.error('Select or create a recipe'); return; }
    if (!alaCarteForm.consumer_id) { toast.error(`Select a ${alaCarteForm.consumer_kind}`); return; }
    try {
      await api.post('/kitchen/orders', {
        recipe_id: alaCarteForm.recipe_id, quantity_ordered: alaCarteForm.quantity, is_ala_carte: true,
        member_id: alaCarteForm.consumer_kind === 'member' ? alaCarteForm.consumer_id : undefined,
        booking_id: alaCarteForm.consumer_kind === 'guest' ? alaCarteForm.consumer_id : undefined,
        sla_minutes: alaCarteForm.sla_minutes,
      });
      toast.success('A la carte order started');
      setAlaCarteDialogOpen(false);
      fetchOrders();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to create order')); }
  };

  const handleStartCooking = async (id: number) => {
    try { await api.post(`/kitchen/orders/${id}/start-cooking`); toast.success('Cooking started — inventory deducted'); fetchOrders(); }
    catch (err) { toast.error(getErrorMessage(err, 'Failed to start cooking')); }
  };

  const handleCompleteAlaCarte = async (id: number) => {
    try { await api.post(`/kitchen/orders/${id}/complete`); toast.success('Order completed'); fetchOrders(); fetchLateSummary(); }
    catch (err) { toast.error(getErrorMessage(err, 'Failed to complete order')); }
  };

  const countdownLabel = (dueAt: string | null): { label: string; overdue: boolean } => {
    if (!dueAt) return { label: '—', overdue: false };
    // Backend sends naive UTC timestamps (no trailing Z) - without it, `new Date()`
    // parses the string as local time, throwing the countdown off by the browser's
    // UTC offset. Force UTC interpretation explicitly.
    const utcDueAt = dueAt.endsWith('Z') || dueAt.includes('+') ? dueAt : `${dueAt}Z`;
    const diffMs = new Date(utcDueAt).getTime() - now;
    const overdue = diffMs <= 0;
    const totalSec = Math.floor(Math.abs(diffMs) / 1000);
    const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
    const ss = String(totalSec % 60).padStart(2, '0');
    return { label: `${overdue ? '-' : ''}${mm}:${ss}`, overdue };
  };

  const alaCarteOrders = orders.filter(o => o.is_ala_carte);
  const alaCarteColumns: { key: string; title: string; statuses: string[] }[] = [
    { key: 'pending', title: 'Pending', statuses: ['pending'] },
    { key: 'cooking', title: 'Cooking', statuses: ['cooking'] },
    { key: 'completed', title: 'Completed', statuses: ['served'] },
    { key: 'late', title: 'Late', statuses: ['late'] },
  ];

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

  const routineOrders = orders.filter(o => !o.is_ala_carte);
  const pendingCount = routineOrders.filter(o => o.status === 'pending').length;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2"><ChefHat size={24} /> Kitchen</h1>

      <Tabs defaultValue="service">
        <TabsList className="grid grid-cols-4 max-w-2xl">
          <TabsTrigger value="service">Meal Service</TabsTrigger>
          <TabsTrigger value="production">Production</TabsTrigger>
          <TabsTrigger value="charges">Guest Mess Charges</TabsTrigger>
          <TabsTrigger value="recipes">Recipes</TabsTrigger>
        </TabsList>

        <TabsContent value="service" className="space-y-4">
          <MealServiceTab onSpecialOrder={openSpecialOrderFor} />
        </TabsContent>

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
                  {!loading && routineOrders.map(o => (
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
                  {!loading && routineOrders.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-8 text-gray-500">No orders yet — Generate from bookings, or add a manual order</TableCell></TableRow>}
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

          {/* A la carte custom orders: Pending -> Cooking -> Completed/Late with a live SLA timer */}
          <div className="pt-2 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-lg font-semibold flex items-center gap-2"><UtensilsCrossed size={18} /> A La Carte Orders</h2>
              <Button onClick={() => openAlaCarteDialog()}><Plus size={16} className="mr-1" /> New A La Carte Order</Button>
            </div>

            {lateOrders.length > 0 && (
              <div className="flex items-center gap-2 rounded-md border border-red-300 bg-red-50 dark:bg-red-950/20 px-3 py-2 text-sm text-red-800 dark:text-red-300">
                <AlertTriangle size={16} className="animate-pulse" />
                {lateOrders.length} order(s) critically overdue: {lateOrders.map(o => `${o.recipe_name || 'item'} for ${o.consumer_name || 'guest'}`).join(', ')}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {alaCarteColumns.map(col => (
                <Card key={col.key}>
                  <CardContent className="p-3 space-y-2">
                    <h3 className="text-sm font-semibold text-gray-500">{col.title} ({alaCarteOrders.filter(o => col.statuses.includes(o.status)).length})</h3>
                    {alaCarteOrders.filter(o => col.statuses.includes(o.status)).map(o => {
                      const { label, overdue } = countdownLabel(o.due_at);
                      const isLate = col.key === 'late';
                      return (
                        <div key={o.id} className={`rounded-md border p-2 space-y-1 ${isLate ? 'border-red-400 bg-red-50 dark:bg-red-950/20 animate-pulse' : 'border-gray-200 dark:border-gray-700'}`}>
                          <p className="font-medium text-sm">{o.recipe_name || `Recipe #${o.recipe_id}`}</p>
                          <p className="text-xs text-gray-500">{o.consumer_name || 'Unknown'} · qty {o.quantity_ordered}</p>
                          {col.key !== 'completed' && (
                            <p className={`text-xs font-mono ${overdue ? 'text-red-600' : 'text-gray-500'}`}>{label}</p>
                          )}
                          {col.key === 'pending' && <Button size="sm" className="w-full bg-orange-600 hover:bg-orange-700" onClick={() => handleStartCooking(o.id)}><Flame size={14} className="mr-1" /> Start Cooking</Button>}
                          {col.key === 'cooking' && <Button size="sm" className="w-full bg-green-600 hover:bg-green-700" onClick={() => handleCompleteAlaCarte(o.id)}>Complete</Button>}
                          {col.key === 'late' && (
                            <div className="flex gap-1">
                              {o.status === 'late' && o.cooking_started_at ? (
                                <Button size="sm" className="flex-1 bg-green-600 hover:bg-green-700" onClick={() => handleCompleteAlaCarte(o.id)}>Complete</Button>
                              ) : (
                                <Button size="sm" className="flex-1 bg-orange-600 hover:bg-orange-700" onClick={() => handleStartCooking(o.id)}><Flame size={14} className="mr-1" /> Start Cooking</Button>
                              )}
                              <Button size="sm" variant="ghost" onClick={() => handleCancelOrder(o.id)}><XCircle size={16} className="text-red-500" /></Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {alaCarteOrders.filter(o => col.statuses.includes(o.status)).length === 0 && <p className="text-xs text-gray-400">None</p>}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="charges" className="space-y-4">
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Receipt size={18} className="text-orange-600" />
                <p className="text-sm font-medium">Log mess charges as a guest incurs them (Extra Messing, Sui Gas...). The Clerk turns this into a bill at checkout.</p>
              </div>
              <select className="h-10 w-full max-w-sm rounded-md border border-input bg-background px-3 text-sm"
                value={chargeBookingId} onChange={e => setChargeBookingId(Number(e.target.value))}>
                <option value="0">Select a checked-in guest</option>
                {bookings.map(b => <option key={b.id} value={b.id}>{b.guest_name} (Room {b.room_number})</option>)}
              </select>
            </CardContent>
          </Card>

          {chargeBookingId > 0 && (
            <GuestChargePanel bookingId={chargeBookingId} isMess title="Mess Charges" />
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

                  <RecipeIngredientEditor items={items} ingredients={recipeIngredients} onChange={setRecipeIngredients} />

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

      {/* Rendered outside the Tabs so it stays mounted (and thus openable from
          the Meal Service tab's Special Order button) regardless of which
          tab's content is currently active - Radix unmounts inactive TabsContent. */}
      <Dialog open={alaCarteDialogOpen} onOpenChange={setAlaCarteDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>New A La Carte Order</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {!showNewRecipeInline ? (
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Label>Recipe</Label>
                  <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={alaCarteForm.recipe_id} onChange={e => setAlaCarteForm({ ...alaCarteForm, recipe_id: Number(e.target.value) })}>
                    <option value="0">Select recipe</option>
                    {recipes.filter(r => r.is_active).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </div>
                <Button variant="outline" type="button" onClick={() => setShowNewRecipeInline(true)}>+ Create new recipe</Button>
              </div>
            ) : (
              <Card>
                <CardContent className="p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>New Recipe</Label>
                    <Button size="sm" variant="ghost" type="button" onClick={() => setShowNewRecipeInline(false)}>Cancel</Button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Input placeholder="Recipe Name" value={newRecipeForm.name} onChange={e => setNewRecipeForm({ ...newRecipeForm, name: e.target.value })} />
                    <select className="h-10 rounded-md border border-input bg-background px-3 text-sm capitalize" value={newRecipeForm.menu_category} onChange={e => setNewRecipeForm({ ...newRecipeForm, menu_category: e.target.value })}>
                      {MEAL_TYPES.map(mt => <option key={mt} value={mt} className="capitalize">{mt}</option>)}
                    </select>
                  </div>
                  <RecipeIngredientEditor items={items} ingredients={newRecipeIngredients} onChange={setNewRecipeIngredients} />
                  <Button size="sm" type="button" onClick={handleCreateRecipeInline}>Save Recipe & Use It</Button>
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>For</Label>
                <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={alaCarteForm.consumer_kind} onChange={e => setAlaCarteForm({ ...alaCarteForm, consumer_kind: e.target.value as 'member' | 'guest', consumer_id: 0 })}>
                  <option value="guest">Guest (checked-in booking)</option>
                  <option value="member">Member</option>
                </select>
              </div>
              <div>
                <Label>{alaCarteForm.consumer_kind === 'member' ? 'Member' : 'Guest'}</Label>
                <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={alaCarteForm.consumer_id} onChange={e => setAlaCarteForm({ ...alaCarteForm, consumer_id: Number(e.target.value) })}>
                  <option value="0">Select {alaCarteForm.consumer_kind === 'member' ? 'member' : 'guest'}</option>
                  {alaCarteForm.consumer_kind === 'member'
                    ? members.map(m => <option key={m.id} value={m.id}>{m.full_name} ({m.service_number})</option>)
                    : bookings.map(b => <option key={b.id} value={b.id}>{b.guest_name} (Room {b.room_number})</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Quantity</Label>
                <Input type="number" min={1} value={alaCarteForm.quantity} onChange={e => setAlaCarteForm({ ...alaCarteForm, quantity: Number(e.target.value) })} />
              </div>
              <div>
                <Label>SLA Timer (minutes)</Label>
                <Input type="number" min={1} value={alaCarteForm.sla_minutes} onChange={e => setAlaCarteForm({ ...alaCarteForm, sla_minutes: Number(e.target.value) })} />
              </div>
            </div>

            <Button onClick={handleCreateAlaCarteOrder} className="w-full">Start Order</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
