import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { CalendarDays, Receipt, Trash2 } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import { BillPrintView } from '@/components/BillPrint';

interface MenuItem { id: number; dish_name: string; estimated_price: number; quantity: number; }
interface EventItem {
  id: number; title: string; guest_name: string | null; hall_name: string; headcount: number;
  event_date: string; status: string; menu_items: MenuItem[]; total_estimated_amount: number;
  invoice_id: number | null; invoice_number: string | null;
}
interface CatalogItem { id: number; name: string; price: number; is_active: boolean; }
interface SettleInvoice { id: number; invoice_number: string; total_amount: number; amount_paid: number; balance_due: number; }

const PAYMENT_METHODS = ['Online/AG Branch', 'Bank Transfer', 'Cash Deposit'];
const today = new Date().toISOString().slice(0, 10);

/** Events ready to bill: scheduled for today or already past (overdue),
    completed, and not yet invoiced. Generate Bill lets the Clerk price the
    event either from the Kitchen menu catalog (auto-filled price) or a
    manual one-off entry - both just add an EventMenuItem via
    billing-items, then Generate Invoice sums whatever's on the event. */
export default function ClerkEvents() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [billEvent, setBillEvent] = useState<EventItem | null>(null);
  const [mode, setMode] = useState<'catalog' | 'manual'>('catalog');
  const [catalogItemId, setCatalogItemId] = useState(0);
  const [manualName, setManualName] = useState('');
  const [manualPrice, setManualPrice] = useState('');
  const [qty, setQty] = useState('1');
  const [busy, setBusy] = useState(false);

  // Integrated settlement - shown in the same dialog once Generate Invoice
  // succeeds, so the Clerk never has to leave the Events tab to collect
  // payment or print the receipt.
  const [settleInvoice, setSettleInvoice] = useState<SettleInvoice | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState(PAYMENT_METHODS[0]);
  const [payVoucher, setPayVoucher] = useState('');
  const [paying, setPaying] = useState(false);
  const [printInvoiceId, setPrintInvoiceId] = useState<number | null>(null);

  const fetchEvents = async () => {
    try {
      const res = await api.get('/events');
      const all: EventItem[] = res.data.items || [];
      setEvents(all.filter(e => e.status === 'completed' && !e.invoice_id && e.event_date <= today));
    } catch { toast.error('Failed to load events'); }
  };

  const fetchCatalog = async () => {
    try { const res = await api.get('/kitchen/menu'); setCatalog((res.data || []).filter((m: CatalogItem) => m.is_active)); }
    catch { /* catalog is optional - manual entry still works without it */ }
  };

  useEffect(() => { queueMicrotask(() => { setLoading(true); Promise.all([fetchEvents(), fetchCatalog()]).finally(() => setLoading(false)); }); }, []);

  const refreshBillEvent = async (id: number) => {
    const res = await api.get('/events');
    const found = (res.data.items || []).find((e: EventItem) => e.id === id);
    if (found) setBillEvent(found);
    fetchEvents();
  };

  const addItem = async () => {
    if (!billEvent) return;
    const item = mode === 'catalog' ? catalog.find(c => c.id === catalogItemId) : null;
    const name = mode === 'catalog' ? item?.name : manualName.trim();
    const price = mode === 'catalog' ? item?.price : Number(manualPrice);
    const quantity = Number(qty) || 1;
    if (!name) { toast.error(mode === 'catalog' ? 'Select a catalog item' : 'Enter an item name'); return; }
    if (!price || price <= 0) { toast.error('Enter a valid price'); return; }
    setBusy(true);
    try {
      await api.post(`/events/${billEvent.id}/billing-items`, { dish_name: name, estimated_price: price, quantity });
      setManualName(''); setManualPrice(''); setQty('1');
      await refreshBillEvent(billEvent.id);
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to add item')); }
    finally { setBusy(false); }
  };

  const removeItem = async (itemId: number) => {
    if (!billEvent) return;
    try { await api.delete(`/events/menu-items/${itemId}`); await refreshBillEvent(billEvent.id); }
    catch (err) { toast.error(getErrorMessage(err, 'Failed to remove item')); }
  };

  const generateInvoice = async () => {
    if (!billEvent) return;
    setBusy(true);
    try {
      const res = await api.post(`/events/${billEvent.id}/generate-invoice`);
      toast.success(`Invoice ${res.data.invoice_number} generated — ${formatCurrency(res.data.total_amount)}`);
      setSettleInvoice({
        id: res.data.invoice_id, invoice_number: res.data.invoice_number,
        total_amount: res.data.total_amount, amount_paid: 0, balance_due: res.data.total_amount,
      });
      setPayAmount(String(res.data.total_amount));
      fetchEvents();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to generate invoice')); }
    finally { setBusy(false); }
  };

  const recordEventPayment = async () => {
    if (!settleInvoice) return;
    const amt = Number(payAmount);
    if (!amt || amt <= 0) { toast.error('Enter a valid payment amount'); return; }
    if (payMethod === 'Online/AG Branch' && !payVoucher.trim()) { toast.error('Voucher Number is required for Online/AG Branch payments'); return; }
    setPaying(true);
    try {
      const res = await api.post(`/billing/invoices/${settleInvoice.id}/payments`, {
        amount: amt, method: payMethod, voucher_number: payVoucher.trim() || undefined,
      });
      setSettleInvoice({ ...settleInvoice, amount_paid: res.data.amount_paid, balance_due: res.data.balance_due });
      setPayAmount(String(res.data.balance_due > 0 ? res.data.balance_due : ''));
      toast.success(`${formatCurrency(amt)} recorded (${payMethod})`);
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to record payment')); }
    finally { setPaying(false); }
  };

  const closeSettlement = () => { setSettleInvoice(null); setBillEvent(null); setPayAmount(''); setPayVoucher(''); };

  const isOverdue = (e: EventItem) => e.event_date < today;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Completed events due for billing - today's or overdue, not yet invoiced.</p>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!loading && events.length === 0 && <p className="text-sm text-muted-foreground">Nothing to bill right now.</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {events.map(e => (
          <Card key={e.id} className={isOverdue(e) ? 'border-red-300' : ''}>
            <CardContent className="p-4 space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <p className="font-bold truncate">{e.title}</p>
                {isOverdue(e) && <Badge className="bg-red-100 text-red-800">Overdue</Badge>}
              </div>
              <p className="text-xs text-muted-foreground flex items-center gap-1.5"><CalendarDays size={13} /> {new Date(e.event_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · {e.hall_name}</p>
              <p className="text-xs text-muted-foreground">{e.guest_name} · {e.headcount} guests</p>
              <p className="text-sm font-mono">{formatCurrency(e.total_estimated_amount)}</p>
              <Button size="sm" className="w-full" onClick={() => setBillEvent(e)}><Receipt size={14} className="mr-1" /> Generate Bill</Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!billEvent} onOpenChange={open => { if (!open) closeSettlement(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{settleInvoice ? 'Settle & Print' : 'Generate Bill'} — {billEvent?.title}</DialogTitle></DialogHeader>
          {billEvent && !settleInvoice && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                {billEvent.menu_items.map(mi => (
                  <div key={mi.id} className="flex items-center justify-between text-sm">
                    <span>{mi.dish_name} <span className="text-muted-foreground text-xs">× {mi.quantity}</span></span>
                    <span className="flex items-center gap-2">
                      <span className="font-mono">{formatCurrency(mi.estimated_price * mi.quantity)}</span>
                      <button type="button" onClick={() => removeItem(mi.id)} className="text-red-400 hover:text-red-600"><Trash2 size={13} /></button>
                    </span>
                  </div>
                ))}
                {billEvent.menu_items.length === 0 && <p className="text-xs text-muted-foreground">No items yet</p>}
                {billEvent.menu_items.length > 0 && (
                  <div className="flex justify-between border-t pt-1.5 text-sm font-bold">
                    <span>Total</span><span className="font-mono">{formatCurrency(billEvent.total_estimated_amount)}</span>
                  </div>
                )}
              </div>

              <div className="rounded-lg border p-3 space-y-2">
                <div className="flex rounded-md border overflow-hidden text-xs">
                  {([['catalog', 'From Menu Catalog'], ['manual', 'Manual Entry']] as const).map(([val, label]) => (
                    <button key={val} type="button" className={`flex-1 py-1.5 ${mode === val ? 'bg-primary text-primary-foreground font-medium' : 'bg-transparent text-muted-foreground hover:text-foreground'}`}
                      onClick={() => setMode(val)}>{label}</button>
                  ))}
                </div>
                {mode === 'catalog' ? (
                  <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs" value={catalogItemId} onChange={e => setCatalogItemId(Number(e.target.value))}>
                    <option value="0">Select item (price auto-fills)</option>
                    {catalog.map(c => <option key={c.id} value={c.id}>{c.name} — {formatCurrency(c.price)}</option>)}
                  </select>
                ) : (
                  <div className="grid grid-cols-2 gap-1.5">
                    <Input placeholder="Item name (Hall Rent, Equipment, Decor…)" className="h-9 text-xs" value={manualName} onChange={e => setManualName(e.target.value)} />
                    <Input type="number" placeholder="Rs/unit" className="h-9 text-xs" value={manualPrice} onChange={e => setManualPrice(e.target.value.replace(/^0+(?=\d)/, ''))} />
                  </div>
                )}
                <div className="flex gap-1.5">
                  <div className="flex-1"><Label className="text-xs">Qty</Label><Input type="number" min={1} className="h-9 text-xs" value={qty} onChange={e => setQty(e.target.value.replace(/^0+(?=\d)/, ''))} /></div>
                  <Button size="sm" className="h-9 self-end" disabled={busy} onClick={addItem}>Add</Button>
                </div>
              </div>

              <Button className="w-full" disabled={busy || billEvent.menu_items.length === 0} onClick={generateInvoice}>
                {busy ? 'Working…' : 'Generate Invoice'}
              </Button>
            </div>
          )}

          {settleInvoice && (
            <div className="space-y-3">
              <div className="rounded-lg border p-3 text-sm space-y-1">
                <div className="flex justify-between"><span>Invoice</span><span className="font-mono">{settleInvoice.invoice_number}</span></div>
                <div className="flex justify-between font-bold"><span>Total Price</span><span className="font-mono">{formatCurrency(settleInvoice.total_amount)}</span></div>
                <div className="flex justify-between"><span>Paid to Date</span><span className="font-mono">{formatCurrency(settleInvoice.amount_paid)}</span></div>
                <div className="flex justify-between font-bold border-t pt-1"><span>Balance Due</span><span className="font-mono">{formatCurrency(settleInvoice.balance_due)}</span></div>
              </div>

              {settleInvoice.balance_due > 0.01 ? (
                <div className="rounded-lg border p-3 space-y-2">
                  <p className="text-sm font-semibold">Record Payment</p>
                  <div className="grid grid-cols-2 gap-2">
                    <select className="h-9 rounded-md border border-input bg-background px-2 text-xs" value={payMethod} onChange={e => setPayMethod(e.target.value)}>
                      {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <div>
                      <Label className="text-xs">Total Price Paid by Customer</Label>
                      <Input type="number" min={1} placeholder="Rs" className="h-9 text-xs" value={payAmount} onChange={e => setPayAmount(e.target.value.replace(/^0+(?=\d)/, ''))} />
                    </div>
                  </div>
                  {(payMethod === 'Online/AG Branch' || payMethod === 'Bank Transfer') && (
                    <Input placeholder={payMethod === 'Online/AG Branch' ? 'Voucher Number (required)' : 'Voucher Number (optional)'} className="h-9 text-xs" value={payVoucher} onChange={e => setPayVoucher(e.target.value)} />
                  )}
                  <Button size="sm" className="h-9 w-full" disabled={paying} onClick={recordEventPayment}>{paying ? 'Recording…' : 'Record Payment'}</Button>
                </div>
              ) : (
                <p className="text-sm text-emerald-600 font-medium">Fully paid ✓</p>
              )}

              <div className="flex gap-2">
                <Button className="flex-1" onClick={() => setPrintInvoiceId(settleInvoice.id)}><Receipt size={16} className="mr-1" /> Print Event Invoice</Button>
                <Button variant="ghost" onClick={closeSettlement}>Close</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <BillPrintView invoiceIds={printInvoiceId ? [printInvoiceId] : null} onClose={() => setPrintInvoiceId(null)} />
    </div>
  );
}
