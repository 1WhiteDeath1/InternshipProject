import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Search, Plus, FileText, Ban, DollarSign, Receipt, Calendar, Trash2, Wallet, UtensilsCrossed } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';

interface Invoice {
  id: number;
  invoice_number: string;
  guest_name: string;
  room_number: string;
  total_amount: number;
  amount_paid: number;
  status: string;
  issue_date: string;
  items: { description: string; quantity: number; unit_price: number }[];
}

interface BillingStats {
  today_revenue: number;
  today_invoice_count: number;
  month_revenue: number;
  overdue_invoices: number;
}

interface InvoiceLineItem {
  description: string;
  quantity: number;
  unit_price: number;
  is_meal_charge: boolean;
}

interface BookingOption {
  id: number;
  guest_name: string;
  room_number: string;
  status: string;
}

const emptyItem: InvoiceLineItem = { description: '', quantity: 1, unit_price: 0, is_meal_charge: false };
const INVOICE_DUE_DAYS = 7;

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86400000);

export default function Billing() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<BillingStats | null>(null);
  const [bookings, setBookings] = useState<BookingOption[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [paymentDialogInvoice, setPaymentDialogInvoice] = useState<Invoice | null>(null);
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [form, setForm] = useState({ booking_id: 0, issue_date: '', due_date: '', tax_amount: 0, discount: 0, notes: '', items: [{ ...emptyItem }] as InvoiceLineItem[] });

  const fetchInvoices = async () => {
    try {
      const res = await api.get(`/billing/invoices?search=${search}`);
      setInvoices(res.data.items);
    } catch { toast.error('Failed to load invoices'); }
  };

  const fetchStats = async () => {
    try { const res = await api.get('/billing/dashboard-stats'); setStats(res.data); }
    catch { toast.error('Failed to load billing stats'); }
  };

  const fetchBookings = async () => {
    try {
      const [ci, co] = await Promise.all([
        api.get('/bookings?status=checked_in&page_size=100'),
        api.get('/bookings?status=checked_out&page_size=100'),
      ]);
      setBookings([...ci.data.items, ...co.data.items]);
    } catch { toast.error('Failed to load bookings'); }
  };

  useEffect(() => {
    queueMicrotask(() => {
      setLoading(true);
      Promise.all([fetchInvoices(), fetchStats(), fetchBookings()]).finally(() => setLoading(false));
    });
  }, [search]);

  const openCreateDialog = (open: boolean) => {
    // Pre-fill the dates the clerk would otherwise type by hand: today and today + terms.
    if (open) {
      const today = new Date();
      setForm(f => ({ ...f, issue_date: f.issue_date || isoDate(today), due_date: f.due_date || isoDate(addDays(today, INVOICE_DUE_DAYS)) }));
    }
    setDialogOpen(open);
  };

  const handlePullRecordedMeals = async () => {
    if (!form.booking_id) {
      toast.error('Enter a Booking ID first');
      return;
    }
    try {
      const res = await api.get(`/attendance?booking_id=${form.booking_id}&status=attended`);
      const meals = res.data.items as { recipe_name: string | null; meal_type: string; date: string }[];
      if (meals.length === 0) {
        toast.info('No recorded meals found for this booking');
        return;
      }
      const mealItems: InvoiceLineItem[] = meals.map(m => ({
        description: `Meal: ${m.recipe_name || m.meal_type} (${m.meal_type}, ${m.date})`,
        quantity: 1, unit_price: 0, is_meal_charge: true,
      }));
      const existing = form.items.filter(i => i.description.trim() || i.quantity !== 1 || i.unit_price !== 0);
      setForm({ ...form, items: [...existing, ...mealItems] });
      toast.success(`Pulled ${meals.length} recorded meal(s) - fill in unit prices`);
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to pull recorded meals')); }
  };

  const addLineItem = () => setForm({ ...form, items: [...form.items, { ...emptyItem }] });
  const removeLineItem = (index: number) => setForm({ ...form, items: form.items.filter((_, i) => i !== index) });
  const updateLineItem = (index: number, field: keyof InvoiceLineItem, value: string | number | boolean) => {
    const items = [...form.items];
    items[index] = { ...items[index], [field]: value };
    setForm({ ...form, items });
  };
  const invoiceSubtotal = form.items.reduce((sum, i) => sum + i.quantity * i.unit_price, 0);
  const invoiceTotal = invoiceSubtotal + form.tax_amount - form.discount;

  const handleCreate = async () => {
    if (!form.booking_id) {
      toast.error('Booking ID is required');
      return;
    }
    const validItems = form.items.filter(i => i.description.trim() && i.quantity > 0 && i.unit_price >= 0);
    if (validItems.length === 0) {
      toast.error('Add at least one line item with a description, quantity, and unit price');
      return;
    }
    try {
      await api.post('/billing/invoices', { ...form, subtotal: invoiceSubtotal, total_amount: invoiceTotal, items: validItems });
      toast.success('Invoice created');
      setDialogOpen(false);
      setForm({ booking_id: 0, issue_date: '', due_date: '', tax_amount: 0, discount: 0, notes: '', items: [{ ...emptyItem }] });
      fetchInvoices();
      fetchStats();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed')); }
  };

  const handleVoid = async (id: number) => {
    const reason = prompt('Enter void reason:');
    if (!reason) return;
    try {
      await api.post(`/billing/invoices/${id}/void?reason=${encodeURIComponent(reason)}`);
      toast.success('Invoice voided');
      fetchInvoices();
      fetchStats();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed')); }
  };

  const handleRecordPayment = async () => {
    if (!paymentDialogInvoice || paymentAmount <= 0) {
      toast.error('Enter a valid payment amount');
      return;
    }
    try {
      await api.post(`/billing/invoices/${paymentDialogInvoice.id}/payments`, { amount: paymentAmount });
      toast.success('Payment recorded');
      setPaymentDialogInvoice(null);
      setPaymentAmount(0);
      fetchInvoices();
      fetchStats();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to record payment')); }
  };

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = { draft: 'bg-gray-100 text-gray-800', issued: 'bg-blue-100 text-blue-800', paid: 'bg-green-100 text-green-800', void: 'bg-red-100 text-red-800', overdue: 'bg-amber-100 text-amber-800' };
    return <Badge className={colors[status] || ''}>{status}</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Billing & Invoicing</h1>
        <Dialog open={dialogOpen} onOpenChange={openCreateDialog}>
          <DialogTrigger asChild><Button><Plus size={16} className="mr-1" /> Create Invoice</Button></DialogTrigger>
          <DialogContent className="max-w-xl">
            <DialogHeader><DialogTitle>Create Invoice</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <select className="h-10 rounded-md border border-input bg-background px-3 text-sm flex-1" value={form.booking_id} onChange={e => setForm({...form, booking_id: Number(e.target.value)})}>
                  <option value="0">Select booking…</option>
                  {bookings.map(b => <option key={b.id} value={b.id}>{b.guest_name} — Room {b.room_number} (#{b.id}{b.status === 'checked_out' ? ', out' : ''})</option>)}
                </select>
                <Button type="button" variant="outline" size="sm" onClick={handlePullRecordedMeals} title="Pull this guest's recorded meals from the Kitchen module">
                  <UtensilsCrossed size={14} className="mr-1" /> Pull Recorded Meals
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Issue Date</Label><Input type="date" value={form.issue_date} onChange={e => setForm({...form, issue_date: e.target.value})} /></div>
                <div><Label>Due Date</Label><Input type="date" value={form.due_date} onChange={e => setForm({...form, due_date: e.target.value})} /></div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Line Items</Label>
                  <Button size="sm" variant="outline" onClick={addLineItem}><Plus size={14} className="mr-1" /> Add Item</Button>
                </div>
                <div className="space-y-2">
                  {form.items.map((line, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        placeholder="Description" className="flex-1"
                        value={line.description}
                        onChange={e => updateLineItem(i, 'description', e.target.value)}
                      />
                      <Input
                        type="number" placeholder="Qty" className="w-20" min={0}
                        value={line.quantity}
                        onChange={e => updateLineItem(i, 'quantity', Number(e.target.value))}
                      />
                      <Input
                        type="number" placeholder="Unit Price" className="w-28" min={0}
                        value={line.unit_price}
                        onChange={e => updateLineItem(i, 'unit_price', Number(e.target.value))}
                      />
                      <label className="flex items-center gap-1 text-xs text-gray-500 whitespace-nowrap cursor-pointer" title="Scales this item's price by the guest's civilian/non-civilian meal multiplier">
                        <input type="checkbox" checked={line.is_meal_charge} onChange={e => updateLineItem(i, 'is_meal_charge', e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
                        Meal
                      </label>
                      <Button size="sm" variant="ghost" onClick={() => removeLineItem(i)} disabled={form.items.length === 1}>
                        <Trash2 size={16} className="text-red-500" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div><Label>Tax</Label><Input type="number" min={0} value={form.tax_amount} onChange={e => setForm({...form, tax_amount: Number(e.target.value)})} /></div>
                <div><Label>Discount</Label><Input type="number" min={0} value={form.discount} onChange={e => setForm({...form, discount: Number(e.target.value)})} /></div>
              </div>
              <p className="text-right text-sm font-semibold">Total: {formatCurrency(invoiceTotal)}</p>

              <Button onClick={handleCreate} className="w-full">Create Invoice</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Record payment dialog */}
      <Dialog open={!!paymentDialogInvoice} onOpenChange={(open) => { if (!open) { setPaymentDialogInvoice(null); setPaymentAmount(0); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Record Payment - {paymentDialogInvoice?.invoice_number}</DialogTitle></DialogHeader>
          {paymentDialogInvoice && (
            <div className="space-y-3">
              <p className="text-sm text-gray-500">
                Total: {formatCurrency(paymentDialogInvoice.total_amount)} &middot; Paid: {formatCurrency(paymentDialogInvoice.amount_paid)} &middot; Balance due: {formatCurrency(paymentDialogInvoice.total_amount - paymentDialogInvoice.amount_paid)}
              </p>
              <div><Label>Payment Amount</Label><Input type="number" min={0} value={paymentAmount || ''} onChange={e => setPaymentAmount(Number(e.target.value))} /></div>
              <Button onClick={handleRecordPayment} className="w-full">Record Payment</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[{ label: 'Today\'s Revenue', value: formatCurrency(stats.today_revenue), icon: DollarSign, color: 'text-emerald-600' }, { label: 'Invoices Today', value: stats.today_invoice_count, icon: Receipt, color: 'text-blue-600' }, { label: 'Monthly Revenue', value: formatCurrency(stats.month_revenue), icon: Calendar, color: 'text-purple-600' }, { label: 'Overdue', value: stats.overdue_invoices, icon: FileText, color: 'text-red-600' }].map((s, i) => (
            <Card key={i}><CardContent className="p-5 flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center"><s.icon size={20} className={s.color} /></div>
              <div><p className="text-xs text-gray-500">{s.label}</p><p className="text-lg font-bold">{s.value}</p></div>
            </CardContent></Card>
          ))}
        </div>
      )}

      <div className="relative max-w-sm"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} /><Input placeholder="Search invoices..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" /></div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Invoice #</TableHead><TableHead>Guest</TableHead><TableHead>Room</TableHead><TableHead>Amount</TableHead><TableHead>Paid / Balance</TableHead><TableHead>Status</TableHead><TableHead>Date</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={8} className="text-center py-8 text-gray-500">Loading invoices...</TableCell></TableRow>}
              {!loading && invoices.map(inv => (
                <TableRow key={inv.id}>
                  <TableCell className="font-medium">{inv.invoice_number}</TableCell>
                  <TableCell>{inv.guest_name}</TableCell>
                  <TableCell>{inv.room_number}</TableCell>
                  <TableCell className="font-semibold">{formatCurrency(inv.total_amount)}</TableCell>
                  <TableCell className="text-sm text-gray-500">{formatCurrency(inv.amount_paid)} / {formatCurrency(inv.total_amount - (inv.amount_paid || 0))}</TableCell>
                  <TableCell>{statusBadge(inv.status)}</TableCell>
                  <TableCell>{inv.issue_date}</TableCell>
                  <TableCell className="flex gap-1">
                    {inv.status !== 'void' && inv.status !== 'paid' && (
                      <Button size="sm" variant="ghost" onClick={() => { setPaymentDialogInvoice(inv); setPaymentAmount(0); }}><Wallet size={16} className="text-emerald-600" /></Button>
                    )}
                    {inv.status !== 'void' && <Button size="sm" variant="ghost" onClick={() => handleVoid(inv.id)}><Ban size={16} className="text-red-500" /></Button>}
                  </TableCell>
                </TableRow>
              ))}
              {!loading && invoices.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-8 text-gray-500">No invoices found</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
