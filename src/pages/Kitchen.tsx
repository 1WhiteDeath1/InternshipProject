import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/useAuth';
import { hasPermission } from '@/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { ChefHat, Plus, Flame, XCircle, Factory, AlertTriangle, UtensilsCrossed, Receipt, ClipboardList, Fuel, LogOut, CheckCircle2, Circle } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import { defaultMealForNow } from '@/lib/mealDefaults';
import { DishBreakdownDialog } from '@/components/DishBreakdownDialog';

interface MenuItem { id: number; name: string; meal_type: string; day_of_week: string | null; price: number; is_active: boolean; }
interface MenuEditRequest {
  id: number; menu_item_id: number | null; is_new_item: boolean;
  original_name: string | null; original_price: number | null;
  proposed_name: string; proposed_price: number; proposed_meal_type: string; proposed_day_of_week: string | null;
  reason: string | null; status: string; requested_by_name: string | null; requested_at: string;
}
interface KitchenOrder {
  id: number; menu_item_id: number; menu_item_name: string | null; quantity_ordered: number;
  actual_portions: number | null; status: string; notes: string | null; created_at: string;
  meal_date: string | null; meal_type: string | null; source: string | null;
  is_ala_carte: boolean; consumer_type: string | null; member_id: number | null; booking_id: number | null;
  consumer_name: string | null; sla_minutes: number | null; due_at: string | null; cooking_started_at: string | null;
  gas_amount: number | null;
  price_override: number | null;
}
interface SuggestedOrder { menu_item_id: number; menu_item_name: string | null; suggested_quantity: number; }
interface MemberOption { id: number; full_name: string; service_number: string; }
interface BookingOption { id: number; guest_name: string; room_number: string; }
interface LateOrder { id: number; menu_item_name: string | null; consumer_name: string | null; due_at: string | null; }
interface GasRate { percentage: number; updated_at: string | null; }
interface MessChargeOverviewRow {
  consumer_type: 'member' | 'guest'; consumer_id: number; name: string;
  sub_label: string | null; unbilled_mess_total: number; unbilled_gas_total: number;
  is_departing: boolean; kitchen_finalized_by_name: string | null; booking_finalized_by_name: string | null;
}
interface Departure {
  booking_id: number; guest_name: string; room_number: string | null;
  overdue: boolean; days_overdue: number;
  unbilled_mess_total: number; unbilled_gas_total: number;
  kitchen_finalized_at: string | null; kitchen_finalized_by_name: string | null;
  booking_finalized_at: string | null; booking_finalized_by_name: string | null;
}

const MEAL_TYPES = ['breakfast', 'lunch', 'hitea', 'dinner'];
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const emptyProposalForm = { name: '', price: 0, meal_type: 'lunch', day_of_week: '', reason: '' };
const emptyAlaCarteForm = { menu_item_id: 0, consumer_kind: 'guest' as 'member' | 'guest', consumer_id: 0, quantity: 1, sla_minutes: 45 };

export default function Kitchen() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canProposeMenu = hasPermission(user, 'menu', 'create') || hasPermission(user, 'menu', 'edit');
  const canEditRates = hasPermission(user, 'mess_rates', 'edit');

  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [menuMealFilter, setMenuMealFilter] = useState('all');
  const [myRequests, setMyRequests] = useState<MenuEditRequest[]>([]);
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const [proposalDialogOpen, setProposalDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [proposalForm, setProposalForm] = useState(emptyProposalForm);

  const [showManual, setShowManual] = useState(false);
  const [orderMenuItemId, setOrderMenuItemId] = useState(0);
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
  const [now, setNow] = useState(() => Date.now()); // ticks every second to redraw live countdowns

  const [gasRate, setGasRate] = useState<GasRate>({ percentage: 0, updated_at: null });
  const [gasRateInput, setGasRateInput] = useState('');

  const [pricingDialogOrder, setPricingDialogOrder] = useState<KitchenOrder | null>(null);
  const [priceInput, setPriceInput] = useState('');
  const [gasInput, setGasInput] = useState('');
  const [savingPricing, setSavingPricing] = useState(false);

  const [overviewRows, setOverviewRows] = useState<MessChargeOverviewRow[]>([]);
  const [overviewFilter, setOverviewFilter] = useState<'all' | 'member' | 'guest'>('all');
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [breakdownTarget, setBreakdownTarget] = useState<MessChargeOverviewRow | null>(null);

  const [departures, setDepartures] = useState<Departure[]>([]);
  const [departuresLoading, setDeparturesLoading] = useState(true);

  const fetchMenu = async () => {
    try { const res = await api.get('/kitchen/menu'); setMenuItems(res.data); }
    catch { toast.error('Failed to load menu'); }
  };

  const fetchMyRequests = async () => {
    if (!canProposeMenu) return;
    try { const res = await api.get('/kitchen/menu/edit-requests?status=pending'); setMyRequests(res.data); }
    catch { /* secondary */ }
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
    // Kitchen NCO has no bookings/rooms_overview permission at all (see
    // migrations/access.py), so GET /bookings always 403s for them - this
    // kitchen:view-gated slice is what actually populates the a la carte
    // dialog's Guest picker for the role that uses it.
    try { const res = await api.get('/kitchen/checked-in-guests'); setBookings(res.data); }
    catch { /* consumer picker is secondary to the core order flow */ }
  };

  const fetchLateSummary = async () => {
    try { const res = await api.get('/kitchen/orders/late-summary'); setLateOrders(res.data.items); }
    catch { /* banner is best-effort, not critical */ }
  };

  const fetchGasRate = async () => {
    try {
      const res = await api.get('/kitchen/gas-rate');
      setGasRate(res.data);
      setGasRateInput(String(res.data.percentage));
    } catch { /* view/edit both permission-gated - fine if this 403s for other roles */ }
  };

  const fetchOverview = async () => {
    setOverviewLoading(true);
    try {
      const res = await api.get(`/kitchen/mess-charges-overview?consumer_type=${overviewFilter}`);
      setOverviewRows(res.data);
    } catch { /* permission-gated for some roles, fine to silently show nothing */ }
    finally { setOverviewLoading(false); }
  };

  const fetchDepartures = async () => {
    setDeparturesLoading(true);
    try {
      // Explicit no-cache: live checkout-readiness data, same reasoning as
      // Attendance.tsx's identical header on its own frequently-changing GETs.
      const res = await api.get('/kitchen/departures', { headers: { 'Cache-Control': 'no-cache' } });
      setDepartures(res.data);
    } catch { /* permission-gated for some roles, fine to silently show nothing */ }
    finally { setDeparturesLoading(false); }
  };

  useEffect(() => {
    queueMicrotask(() => {
      setLoading(true);
      Promise.all([fetchMenu(), fetchOrders(), fetchMembers(), fetchBookings(), fetchLateSummary(), fetchMyRequests(), fetchGasRate()]).finally(() => setLoading(false));
      fetchDepartures();
    });
  }, []);

  useEffect(() => { queueMicrotask(() => { fetchOverview(); }); }, [overviewFilter]);

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

  const openProposeNew = () => {
    setEditingItem(null);
    setProposalForm(emptyProposalForm);
    setProposalDialogOpen(true);
  };

  const openProposeEdit = (item: MenuItem) => {
    setEditingItem(item);
    setProposalForm({ name: item.name, price: item.price, meal_type: item.meal_type, day_of_week: item.day_of_week || '', reason: '' });
    setProposalDialogOpen(true);
  };

  const handleSubmitProposal = async () => {
    if (!proposalForm.name.trim()) { toast.error('Item name is required'); return; }
    const body = { name: proposalForm.name, price: proposalForm.price, meal_type: proposalForm.meal_type, day_of_week: proposalForm.day_of_week || null, reason: proposalForm.reason || null };
    try {
      if (editingItem) {
        await api.put(`/kitchen/menu/${editingItem.id}`, body);
        toast.success('Change submitted for Manager approval');
      } else {
        await api.post('/kitchen/menu', body);
        toast.success('New item submitted for Manager approval');
      }
      setProposalDialogOpen(false);
      fetchMyRequests();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to submit proposal')); }
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
    if (!orderMenuItemId) { toast.error('Select a menu item to order'); return; }
    try {
      await api.post('/kitchen/orders', { menu_item_id: orderMenuItemId, quantity_ordered: orderQuantity });
      toast.success('Order added');
      setOrderMenuItemId(0);
      setOrderQuantity(1);
      setShowManual(false);
      fetchOrders();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to create order')); }
  };

  const handleCook = async (id: number) => {
    try { await api.post(`/kitchen/orders/${id}/cook`, {}); toast.success('Cooked'); fetchOrders(); }
    catch (err) { toast.error(getErrorMessage(err, 'Failed to cook order')); }
  };

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
    toast[fail ? 'warning' : 'success'](`Cooked ${ok} order(s)${fail ? `, ${fail} failed` : ''}`);
    setBusy(false);
    fetchOrders();
  };

  const handleCancelOrder = async (id: number) => {
    try { await api.post(`/kitchen/orders/${id}/cancel`); toast.success('Order cancelled'); fetchOrders(); }
    catch (err) { toast.error(getErrorMessage(err, 'Failed to cancel order')); }
  };

  const openAlaCarteDialog = (preset?: { consumer_kind: 'member' | 'guest'; consumer_id: number }) => {
    setAlaCarteForm({ ...emptyAlaCarteForm, ...preset });
    setAlaCarteDialogOpen(true);
  };

  // The Attendance page's per-row "Special Order" button deep-links here
  // with navigation state (kind is "member"|"booking" from the attendance
  // matrix, the a la carte form uses "member"|"guest") - the global "New A
  // La Carte Order" shortcut (Layout.tsx) does the same without a preset
  // consumer. Consume the state once, then clear it so a back-navigation or
  // remount doesn't reopen the dialog. The dialog is a portal overlay so it
  // opens fine regardless of which tab is active.
  useEffect(() => { queueMicrotask(() => {
    const state = location.state as { openAlaCarte?: boolean; presetConsumerKind?: 'member' | 'booking'; presetConsumerId?: number } | null;
    if (state?.openAlaCarte) {
      if (state.presetConsumerKind && state.presetConsumerId) {
        openAlaCarteDialog({ consumer_kind: state.presetConsumerKind === 'member' ? 'member' : 'guest', consumer_id: state.presetConsumerId });
      } else {
        openAlaCarteDialog();
      }
      navigate(location.pathname, { replace: true, state: null });
    }
  }); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const handleCreateAlaCarteOrder = async () => {
    if (!alaCarteForm.menu_item_id) { toast.error('Select a menu item'); return; }
    if (!alaCarteForm.consumer_id) { toast.error(`Select a ${alaCarteForm.consumer_kind}`); return; }
    try {
      await api.post('/kitchen/orders', {
        menu_item_id: alaCarteForm.menu_item_id, quantity_ordered: alaCarteForm.quantity, is_ala_carte: true,
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
    try { await api.post(`/kitchen/orders/${id}/start-cooking`); toast.success('Cooking started'); fetchOrders(); }
    catch (err) { toast.error(getErrorMessage(err, 'Failed to start cooking')); }
  };

  const handleCompleteAlaCarte = async (id: number) => {
    try { await api.post(`/kitchen/orders/${id}/complete`); toast.success('Order completed'); fetchOrders(); fetchLateSummary(); }
    catch (err) { toast.error(getErrorMessage(err, 'Failed to complete order')); }
  };

  const handleSaveGasRate = async () => {
    const percentage = Number(gasRateInput);
    if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) { toast.error('Enter a percentage between 0 and 100'); return; }
    try {
      await api.put('/kitchen/gas-rate', { percentage });
      toast.success('Gas charge percentage updated');
      fetchGasRate();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to update rate')); }
  };

  const openPricingDialog = (order: KitchenOrder) => {
    setPricingDialogOrder(order);
    setPriceInput(order.price_override !== null ? String(order.price_override) : '');
    setGasInput(order.gas_amount !== null ? String(order.gas_amount) : '');
  };

  const handleSavePricing = async () => {
    if (!pricingDialogOrder || !pricingDialogOrder.meal_date || !pricingDialogOrder.meal_type) return;
    setSavingPricing(true);
    try {
      await api.put('/kitchen/dish-pricing', {
        date: pricingDialogOrder.meal_date, meal_type: pricingDialogOrder.meal_type, menu_item_id: pricingDialogOrder.menu_item_id,
        price_override: priceInput.trim() === '' ? null : Number(priceInput),
        gas_amount: gasInput.trim() === '' ? null : Number(gasInput),
      });
      toast.success(`Pricing for ${pricingDialogOrder.menu_item_name || 'this dish'} updated`);
      setPricingDialogOrder(null);
      fetchOrders();
      fetchOverview();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to update pricing')); }
    finally { setSavingPricing(false); }
  };

  const handleFinalizeDeparture = async (bookingId: number) => {
    try {
      await api.post(`/kitchen/departures/${bookingId}/finalize`);
      toast.success('Marked mess/gas charges final — Clerk notified');
      fetchDepartures();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to finalize')); }
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
      cancelled: { cls: 'bg-muted text-muted-foreground', label: 'cancelled' },
    };
    const s = map[status] || { cls: '', label: status };
    return <Badge className={s.cls}>{s.label}</Badge>;
  };

  const requestStatusBadge = (status: string) => {
    const map: Record<string, string> = { pending: 'bg-amber-100 text-amber-800', approved: 'bg-green-100 text-green-800', rejected: 'bg-red-100 text-red-800' };
    return <Badge className={map[status] || ''}>{status}</Badge>;
  };

  const routineOrders = orders.filter(o => !o.is_ala_carte);
  const pendingCount = routineOrders.filter(o => o.status === 'pending').length;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><ChefHat size={24} /> Kitchen</h1>

      <Tabs defaultValue="production">
        <TabsList className="grid grid-cols-4 max-w-2xl">
          <TabsTrigger value="production">Production</TabsTrigger>
          <TabsTrigger value="charges">Mess Charges Overview</TabsTrigger>
          <TabsTrigger value="departures">Departures</TabsTrigger>
          <TabsTrigger value="menu">Menu</TabsTrigger>
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
              <p className="text-xs text-muted-foreground">
                {suggested.length > 0
                  ? `Booked for this meal: ${suggested.map(s => `${s.menu_item_name || `#${s.menu_item_id}`} ×${s.suggested_quantity}`).join(', ')}. "Generate" turns these into production orders (skips ones already ordered).`
                  : 'No meals booked with a menu item for this date/meal yet. You can still add a manual order below.'}
              </p>
            </CardContent>
          </Card>

          {/* Orders board */}
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Qty</TableHead><TableHead>Status</TableHead><TableHead className="w-48">Action</TableHead></TableRow></TableHeader>
                <TableBody>
                  {loading && <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>}
                  {!loading && routineOrders.map(o => (
                    <TableRow key={o.id}>
                      <TableCell className="font-medium">{o.menu_item_name || `Item #${o.menu_item_id}`}</TableCell>
                      <TableCell>{o.quantity_ordered}</TableCell>
                      <TableCell>{orderStatusBadge(o.status)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {o.status === 'pending' && (
                            <>
                              <Button size="sm" onClick={() => handleCook(o.id)} className="bg-orange-600 hover:bg-orange-700"><Flame size={14} className="mr-1" /> Mark Cooked</Button>
                              <Button size="sm" variant="ghost" onClick={() => handleCancelOrder(o.id)} title="Cancel"><XCircle size={16} className="text-red-500" /></Button>
                            </>
                          )}
                          {o.status === 'prepared' && (
                            <Button size="sm" onClick={() => handleFinishPrepared(o.id)} className="bg-orange-600 hover:bg-orange-700"><Flame size={14} className="mr-1" /> Finish</Button>
                          )}
                          {o.meal_date && o.meal_type && o.status !== 'cancelled' && (
                            <Button
                              size="sm" variant="ghost" onClick={() => openPricingDialog(o)}
                              title={(() => {
                                const parts: string[] = [];
                                if (o.price_override !== null) parts.push(`Food: ${formatCurrency(o.price_override)}`);
                                if (o.gas_amount !== null) parts.push(`Gas: ${formatCurrency(o.gas_amount)}/head`);
                                return parts.length ? `${parts.join(' · ')} - click to edit` : 'Set food price / gas charge for this dish';
                              })()}
                              className={(o.price_override !== null || o.gas_amount !== null) ? 'text-orange-600' : 'text-muted-foreground'}
                            >
                              <Fuel size={16} />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!loading && routineOrders.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No orders yet — Generate from bookings, or add a manual order</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Manual order — de-emphasized */}
          {!showManual ? (
            <button className="text-sm text-muted-foreground hover:text-foreground dark:hover:text-muted-foreground" onClick={() => setShowManual(true)}>+ Add a manual order</button>
          ) : (
            <Card>
              <CardContent className="p-4 flex items-center gap-2 flex-wrap">
                <select className="h-10 rounded-md border border-input bg-background px-3 text-sm flex-1 max-w-xs" value={orderMenuItemId} onChange={e => setOrderMenuItemId(Number(e.target.value))}>
                  <option value="0">Select item to produce</option>
                  {menuItems.filter(m => m.is_active).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
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
                {lateOrders.length} order(s) critically overdue: {lateOrders.map(o => `${o.menu_item_name || 'item'} for ${o.consumer_name || 'guest'}`).join(', ')}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {alaCarteColumns.map(col => (
                <Card key={col.key}>
                  <CardContent className="p-3 space-y-2">
                    <h3 className="text-sm font-semibold text-muted-foreground">{col.title} ({alaCarteOrders.filter(o => col.statuses.includes(o.status)).length})</h3>
                    {alaCarteOrders.filter(o => col.statuses.includes(o.status)).map(o => {
                      const { label, overdue } = countdownLabel(o.due_at);
                      const isLate = col.key === 'late';
                      return (
                        <div key={o.id} className={`rounded-md border p-2 space-y-1 ${isLate ? 'border-red-400 bg-red-50 dark:bg-red-950/20 animate-pulse' : 'border-border'}`}>
                          <p className="font-medium text-sm">{o.menu_item_name || `Item #${o.menu_item_id}`}</p>
                          <p className="text-xs text-muted-foreground">{o.consumer_name || 'Unknown'} · qty {o.quantity_ordered}</p>
                          {col.key !== 'completed' && (
                            <p className={`text-xs font-mono ${overdue ? 'text-red-600' : 'text-muted-foreground'}`}>{label}</p>
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
                    {alaCarteOrders.filter(o => col.statuses.includes(o.status)).length === 0 && <p className="text-xs text-muted-foreground">None</p>}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="charges" className="space-y-4">
          {(canEditRates || gasRate.updated_at) && (
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Flame size={18} className="text-orange-600" />
                  <p className="text-sm font-medium">Gas Charge Rate</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Extra Messing is always computed from what a member/guest actually ordered - there's nothing to set for it.
                  Sui Gas Charges on Messing is this percentage of that computed total - only used as a fallback for a
                  dish that doesn't have its own gas charge set (via the <Fuel size={12} className="inline" /> icon on a
                  production order in the Production tab).
                </p>
                <div className="max-w-xs">
                  <Label>Gas Charge (%)</Label>
                  <div className="flex gap-1.5">
                    <Input type="number" min={0} max={100} disabled={!canEditRates} value={gasRateInput} onChange={e => setGasRateInput(e.target.value.replace(/^0+(?=\d)/, ''))} />
                    {canEditRates && <Button size="sm" onClick={handleSaveGasRate}>Save</Button>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Current: {gasRate.percentage}%</p>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Receipt size={18} className="text-orange-600" />
                  <p className="text-sm font-medium">Every member and checked-in guest's unbilled mess charge, computed from what they've actually ordered - "Log Charge" adds a priced item straight to their account, pre-filled from the menu.</p>
                </div>
                <div className="flex rounded-md border overflow-hidden text-xs">
                  {([['all', 'All'], ['member', 'Members'], ['guest', 'Guests']] as const).map(([val, label]) => (
                    <button key={val} type="button"
                      className={`px-3 py-1.5 ${overviewFilter === val ? 'bg-primary text-primary-foreground font-medium' : 'bg-transparent text-muted-foreground hover:text-foreground'}`}
                      onClick={() => setOverviewFilter(val)}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Name</TableHead><TableHead>Room/Unit</TableHead><TableHead className="text-right">Unbilled Food Charge</TableHead><TableHead className="text-right">Gas Charge</TableHead><TableHead className="w-48">Action</TableHead></TableRow></TableHeader>
                <TableBody>
                  {overviewLoading && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>}
                  {!overviewLoading && overviewRows.map(r => (
                    <TableRow key={`${r.consumer_type}-${r.consumer_id}`}>
                      <TableCell className="capitalize">{r.consumer_type}</TableCell>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{r.sub_label || '-'}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(r.unbilled_mess_total)}</TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">{formatCurrency(r.unbilled_gas_total)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1 justify-end">
                          <Button size="sm" variant="outline" onClick={() => openAlaCarteDialog({ consumer_kind: r.consumer_type, consumer_id: r.consumer_id })}>Log Charge</Button>
                          {/* Guests only - a member's dining is billed monthly in
                              aggregate, not per meal, so there's no per-dish
                              breakdown to correct for them; their history lives
                              in Member Management instead (MemberLedger.tsx). */}
                          {r.consumer_type === 'guest' && (
                            <Button size="sm" variant="ghost" onClick={() => setBreakdownTarget(r)}>
                              {r.is_departing && !r.kitchen_finalized_by_name && <LogOut size={13} className="mr-1 text-blue-600" />}
                              Breakdown
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!overviewLoading && overviewRows.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Nothing to show</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {breakdownTarget && (
            <DishBreakdownDialog
              open={breakdownTarget !== null} onOpenChange={open => { if (!open) setBreakdownTarget(null); }}
              bookingId={breakdownTarget.consumer_id} guestName={breakdownTarget.name}
              isDeparting={breakdownTarget.is_departing} kitchenFinalizedByName={breakdownTarget.kitchen_finalized_by_name}
              onFinalized={() => { fetchOverview(); fetchDepartures(); setBreakdownTarget(null); }}
            />
          )}
        </TabsContent>

        <TabsContent value="departures" className="space-y-4">
          <Card>
            <CardContent className="p-4 space-y-1">
              <p className="text-sm font-medium flex items-center gap-2"><LogOut size={18} className="text-blue-600" /> Guests checking out today or overdue</p>
              <p className="text-xs text-muted-foreground">
                A narrow view of who's leaving - not the full Bookings module. Finalize once this guest's mess/gas charges are
                settled and won't change further; the Clerk is notified and sees both this and Booking NCO's own sign-off at checkout.
              </p>
            </CardContent>
          </Card>

          {departuresLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!departuresLoading && departures.length === 0 && (
            <p className="text-sm text-muted-foreground">No departures expected today.</p>
          )}
          <div className="space-y-2">
            {departures.map(d => (
              <Card key={d.booking_id}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <p className="font-medium text-sm">{d.guest_name} <span className="text-muted-foreground text-xs">Room {d.room_number || '-'}</span></p>
                      {d.overdue && <p className="text-xs text-red-600 font-medium">Overdue — should have left {d.days_overdue === 1 ? 'yesterday' : `${d.days_overdue} days ago`}</p>}
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span>Unbilled Food: <span className="font-mono">{formatCurrency(d.unbilled_mess_total)}</span></span>
                      <span>Gas: <span className="font-mono">{formatCurrency(d.unbilled_gas_total)}</span></span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        {d.kitchen_finalized_by_name ? <CheckCircle2 size={13} className="text-emerald-600" /> : <Circle size={13} />}
                        Kitchen{d.kitchen_finalized_by_name ? `: finalized by ${d.kitchen_finalized_by_name}` : ': not finalized'}
                      </span>
                      <span className="flex items-center gap-1">
                        {d.booking_finalized_by_name ? <CheckCircle2 size={13} className="text-emerald-600" /> : <Circle size={13} />}
                        Booking{d.booking_finalized_by_name ? `: finalized by ${d.booking_finalized_by_name}` : ': not finalized'}
                      </span>
                    </div>
                    <Button size="sm" disabled={!!d.kitchen_finalized_by_name} onClick={() => handleFinalizeDeparture(d.booking_id)}>
                      {d.kitchen_finalized_by_name ? 'Finalized' : 'Finalize & Notify Clerk'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="menu" className="space-y-4">
          <div className="flex justify-between items-center">
            <select className="h-10 rounded-md border border-input bg-background px-3 text-sm capitalize" value={menuMealFilter} onChange={e => setMenuMealFilter(e.target.value)}>
              <option value="all">All Meals</option>
              {MEAL_TYPES.map(mt => <option key={mt} value={mt} className="capitalize">{mt}</option>)}
            </select>
            <Dialog open={proposalDialogOpen} onOpenChange={setProposalDialogOpen}>
              {canProposeMenu && (
                <DialogTrigger asChild><Button onClick={openProposeNew}><Plus size={16} className="mr-1" /> Propose New Item</Button></DialogTrigger>
              )}
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>{editingItem ? 'Propose Change' : 'Propose New Item'}</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <Input placeholder="Dish name" value={proposalForm.name} onChange={e => setProposalForm({ ...proposalForm, name: e.target.value })} />
                  <div className="grid grid-cols-2 gap-3">
                    <select className="h-10 rounded-md border border-input bg-background px-3 text-sm capitalize" value={proposalForm.meal_type} onChange={e => setProposalForm({ ...proposalForm, meal_type: e.target.value })}>
                      {MEAL_TYPES.map(mt => <option key={mt} value={mt} className="capitalize">{mt}</option>)}
                    </select>
                    <select className="h-10 rounded-md border border-input bg-background px-3 text-sm capitalize" value={proposalForm.day_of_week} onChange={e => setProposalForm({ ...proposalForm, day_of_week: e.target.value })}>
                      <option value="">Not day-specific</option>
                      {DAYS.map(d => <option key={d} value={d} className="capitalize">{d}</option>)}
                    </select>
                  </div>
                  <div>
                    <Label>Estimated Price (Rs)</Label>
                    <Input type="number" min={0} value={proposalForm.price} onChange={e => setProposalForm({ ...proposalForm, price: Number(e.target.value) })} />
                  </div>
                  <Textarea placeholder="Reason (optional)" value={proposalForm.reason} onChange={e => setProposalForm({ ...proposalForm, reason: e.target.value })} />
                  <Button onClick={handleSubmitProposal} className="w-full">Submit for Manager Approval</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {myRequests.length > 0 && (
            <Card>
              <CardContent className="p-4 space-y-2">
                <p className="text-sm font-semibold flex items-center gap-2"><ClipboardList size={16} /> Pending Requests</p>
                {myRequests.map(r => (
                  <div key={r.id} className="flex items-center justify-between text-sm border-b last:border-0 py-1.5">
                    <span>{r.is_new_item ? 'New: ' : 'Edit: '}{r.proposed_name} — {formatCurrency(r.proposed_price)}</span>
                    {requestStatusBadge(r.status)}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Day</TableHead><TableHead>Meal</TableHead><TableHead>Name</TableHead><TableHead>Price</TableHead>{canProposeMenu && <TableHead className="w-24">Actions</TableHead>}</TableRow></TableHeader>
                <TableBody>
                  {loading && <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>}
                  {!loading && menuItems.filter(m => menuMealFilter === 'all' || m.meal_type === menuMealFilter).map(m => (
                    <TableRow key={m.id} className={canProposeMenu ? 'cursor-pointer hover:bg-accent' : ''} onClick={() => canProposeMenu && openProposeEdit(m)}>
                      <TableCell className="capitalize">{m.day_of_week || '-'}</TableCell>
                      <TableCell className="capitalize">{m.meal_type}</TableCell>
                      <TableCell className="font-medium">{m.name}</TableCell>
                      <TableCell className="font-mono">{formatCurrency(m.price)}</TableCell>
                      {canProposeMenu && <TableCell><Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); openProposeEdit(m); }}>Edit</Button></TableCell>}
                    </TableRow>
                  ))}
                  {!loading && menuItems.filter(m => menuMealFilter === 'all' || m.meal_type === menuMealFilter).length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No menu items {menuMealFilter === 'all' ? '' : `for ${menuMealFilter}`}</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Rendered outside the Tabs so it stays mounted (and thus openable from
          the Attendance tab's Special Order button) regardless of which
          tab's content is currently active - Radix unmounts inactive TabsContent. */}
      <Dialog open={alaCarteDialogOpen} onOpenChange={setAlaCarteDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>New A La Carte Order</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Menu Item</Label>
              <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={alaCarteForm.menu_item_id} onChange={e => setAlaCarteForm({ ...alaCarteForm, menu_item_id: Number(e.target.value) })}>
                <option value="0">Select item</option>
                {menuItems.filter(m => m.is_active).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              {canProposeMenu && <p className="text-xs text-muted-foreground mt-1">Don't see the dish? Propose it in the Menu tab - once a Manager approves it, it'll appear here.</p>}
            </div>

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

      <Dialog open={pricingDialogOrder !== null} onOpenChange={open => { if (!open) setPricingDialogOrder(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Pricing - {pricingDialogOrder?.menu_item_name || 'this dish'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Set once for this dish/meal - everyone marked attended for {pricingDialogOrder?.meal_type} on {pricingDialogOrder?.meal_date} who
              ate this dish is automatically charged these amounts, whether they're a member or a guest. Leave either blank to go back to
              its automatic default (the menu price, or no gas charge).
            </p>
            <div>
              <Label>Food price per head (Rs)</Label>
              <Input type="number" min={0} autoFocus placeholder="Menu price" value={priceInput} onChange={e => setPriceInput(e.target.value.replace(/^0+(?=\d)/, ''))} />
            </div>
            <div>
              <Label>Gas charge per head (Rs)</Label>
              <Input type="number" min={0} placeholder="0" value={gasInput} onChange={e => setGasInput(e.target.value.replace(/^0+(?=\d)/, ''))} />
            </div>
            <Button onClick={handleSavePricing} disabled={savingPricing} className="w-full">{savingPricing ? 'Saving…' : 'Save'}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
