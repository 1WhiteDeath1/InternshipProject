import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Search, FileText, Ban, DollarSign, Receipt, Calendar, Wallet, Printer, ClipboardEdit } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import { BillPrintView, PaymentReceiptView } from '@/components/BillPrint';
import { MasterBillView } from '@/components/MasterBillView';
import { CustomerHistoryModal } from '@/components/CustomerHistoryModal';

interface Invoice {
  id: number;
  invoice_number: string;
  customer_guest_id: number | null;
  guest_name: string;
  room_number: string;
  total_amount: number;
  amount_paid: number;
  status: string;
  bill_type: string;
  issue_date: string;
  items: { description: string; quantity: number; unit_price: number }[];
}

interface BillingStats {
  today_revenue: number;
  today_invoice_count: number;
  month_revenue: number;
  overdue_invoices: number;
}

// Invoices are only created by the two flows that track what's been billed:
// guest checkout (room/mess bills) and the monthly member Mess Bill run.
// This page reviews, prints, settles, and voids them.
const BILL_TYPE_LABELS: Record<string, string> = { combined: 'Combined', room: 'Room', mess: 'Mess', event: 'Event' };

export default function Billing() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [search, setSearch] = useState('');
  const [billTypeFilter, setBillTypeFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<BillingStats | null>(null);
  const [paymentDialogInvoice, setPaymentDialogInvoice] = useState<Invoice | null>(null);
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [voidDialogInvoice, setVoidDialogInvoice] = useState<Invoice | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [printInvoiceIds, setPrintInvoiceIds] = useState<number[] | null>(null);
  const [receiptPaymentId, setReceiptPaymentId] = useState<number | null>(null);
  const [masterBillInvoiceId, setMasterBillInvoiceId] = useState<number | null>(null);
  const [historyGuestId, setHistoryGuestId] = useState<number | null>(null);

  const fetchInvoices = async () => {
    try {
      // Without page_size this took the backend default of 25, so older
      // invoices were simply invisible with no pagination control to reach them.
      const res = await api.get(`/billing/invoices?search=${encodeURIComponent(search)}&bill_type=${billTypeFilter}&page_size=100`);
      setInvoices(res.data.items);
    } catch { toast.error('Failed to load invoices'); }
  };

  const fetchStats = async () => {
    try { const res = await api.get('/billing/dashboard-stats'); setStats(res.data); }
    catch { toast.error('Failed to load billing stats'); }
  };

  useEffect(() => {
    queueMicrotask(() => {
      setLoading(true);
      Promise.all([fetchInvoices(), fetchStats()]).finally(() => setLoading(false));
    });
  }, [search, billTypeFilter]);

  const handleVoid = async () => {
    if (!voidDialogInvoice) return;
    const reason = voidReason.trim();
    if (!reason) { toast.error('A void reason is required'); return; }
    try {
      await api.post(`/billing/invoices/${voidDialogInvoice.id}/void?reason=${encodeURIComponent(reason)}`);
      toast.success(`Invoice ${voidDialogInvoice.invoice_number} voided`);
      setVoidDialogInvoice(null);
      setVoidReason('');
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
      const res = await api.post(`/billing/invoices/${paymentDialogInvoice.id}/payments`, { amount: paymentAmount });
      toast.success('Payment recorded');
      setPaymentDialogInvoice(null);
      setPaymentAmount(0);
      setReceiptPaymentId(res.data.id); // offer the printable cash receipt right away
      fetchInvoices();
      fetchStats();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to record payment')); }
  };

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = { draft: 'bg-muted text-muted-foreground', issued: 'bg-blue-100 text-blue-800', paid: 'bg-green-100 text-green-800', void: 'bg-red-100 text-red-800', overdue: 'bg-amber-100 text-amber-800' };
    return <Badge className={colors[status] || ''}>{status}</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Billing & Invoicing</h1>
        <p className="text-xs text-muted-foreground">Bills are generated at guest checkout (Clerk Desk / Bookings) and by the monthly Mess Bill run.</p>
      </div>

      {/* Record payment dialog */}
      <Dialog open={!!paymentDialogInvoice} onOpenChange={(open) => { if (!open) { setPaymentDialogInvoice(null); setPaymentAmount(0); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Record Payment - {paymentDialogInvoice?.invoice_number}</DialogTitle></DialogHeader>
          {paymentDialogInvoice && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Total: {formatCurrency(paymentDialogInvoice.total_amount)} &middot; Paid: {formatCurrency(paymentDialogInvoice.amount_paid)} &middot; Balance due: {formatCurrency(paymentDialogInvoice.total_amount - paymentDialogInvoice.amount_paid)}
              </p>
              <div><Label>Payment Amount</Label><Input type="number" min={0} value={paymentAmount || ''} onChange={e => setPaymentAmount(Number(e.target.value))} /></div>
              <Button onClick={handleRecordPayment} className="w-full">Record Payment</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Void invoice dialog */}
      <Dialog open={!!voidDialogInvoice} onOpenChange={(open) => { if (!open) { setVoidDialogInvoice(null); setVoidReason(''); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Void Invoice - {voidDialogInvoice?.invoice_number}</DialogTitle></DialogHeader>
          {voidDialogInvoice && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Voiding cancels this bill permanently ({formatCurrency(voidDialogInvoice.total_amount)} for {voidDialogInvoice.guest_name}).
                Its charges become billable again at checkout.
              </p>
              <div><Label>Reason</Label><Input placeholder="e.g. wrong charges, duplicate bill" value={voidReason} onChange={e => setVoidReason(e.target.value)} /></div>
              <Button variant="destructive" onClick={handleVoid} disabled={!voidReason.trim()} className="w-full">
                <Ban size={15} className="mr-1.5" /> Void Invoice
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[{ label: 'Today\'s Revenue', value: formatCurrency(stats.today_revenue), icon: DollarSign, color: 'text-emerald-600' }, { label: 'Invoices Today', value: stats.today_invoice_count, icon: Receipt, color: 'text-blue-600' }, { label: 'Monthly Revenue', value: formatCurrency(stats.month_revenue), icon: Calendar, color: 'text-purple-600' }, { label: 'Overdue', value: stats.overdue_invoices, icon: FileText, color: 'text-red-600' }].map((s, i) => (
            <Card key={i}><CardContent className="p-5 flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center"><s.icon size={20} className={s.color} /></div>
              <div><p className="text-xs text-muted-foreground">{s.label}</p><p className="text-lg font-bold">{s.value}</p></div>
            </CardContent></Card>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative max-w-sm flex-1 min-w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
          <Input placeholder="Search by name, rank, service #, invoice #, voucher # or bill serial #..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
        </div>
        <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={billTypeFilter} onChange={e => setBillTypeFilter(e.target.value)}>
          <option value="">All Categories</option>
          {Object.entries(BILL_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Invoice #</TableHead><TableHead>Guest</TableHead><TableHead>Room</TableHead><TableHead>Amount</TableHead><TableHead>Paid / Balance</TableHead><TableHead>Status</TableHead><TableHead>Date</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading invoices...</TableCell></TableRow>}
              {!loading && invoices.map(inv => (
                <TableRow key={inv.id}>
                  <TableCell className="font-medium">
                    {inv.invoice_number}
                    {inv.bill_type !== 'combined' && (
                      <Badge className={`ml-1.5 ${
                        inv.bill_type === 'room' ? 'bg-purple-100 text-purple-800'
                        : inv.bill_type === 'event' ? 'bg-indigo-100 text-indigo-800'
                        : 'bg-orange-100 text-orange-800'}`}>
                        {inv.bill_type === 'room' ? 'Room' : inv.bill_type === 'event' ? 'Event' : 'Mess'}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {inv.customer_guest_id ? (
                      <button type="button" className="text-blue-600 hover:underline text-left" onClick={() => setHistoryGuestId(inv.customer_guest_id)}>{inv.guest_name}</button>
                    ) : inv.guest_name}
                  </TableCell>
                  <TableCell>{inv.room_number}</TableCell>
                  <TableCell className="font-semibold">{formatCurrency(inv.total_amount)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatCurrency(inv.amount_paid)} / {formatCurrency(inv.total_amount - (inv.amount_paid || 0))}</TableCell>
                  <TableCell>{statusBadge(inv.status)}</TableCell>
                  <TableCell>{inv.issue_date}</TableCell>
                  <TableCell className="flex gap-1">
                    <Button size="sm" variant="ghost" title="Make Bill / Interactive Table" onClick={() => setMasterBillInvoiceId(inv.id)}><ClipboardEdit size={16} className="text-blue-600" /></Button>
                    <Button size="sm" variant="ghost" title="Print bill" onClick={() => setPrintInvoiceIds([inv.id])}><Printer size={16} className="text-muted-foreground" /></Button>
                    {inv.status !== 'void' && inv.status !== 'paid' && (
                      <Button size="sm" variant="ghost" title="Record payment" onClick={() => { setPaymentDialogInvoice(inv); setPaymentAmount(0); }}><Wallet size={16} className="text-emerald-600" /></Button>
                    )}
                    {inv.status !== 'void' && <Button size="sm" variant="ghost" title="Void invoice" onClick={() => { setVoidDialogInvoice(inv); setVoidReason(''); }}><Ban size={16} className="text-red-500" /></Button>}
                  </TableCell>
                </TableRow>
              ))}
              {!loading && invoices.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No invoices found</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <BillPrintView invoiceIds={printInvoiceIds} onClose={() => setPrintInvoiceIds(null)} />
      <PaymentReceiptView paymentId={receiptPaymentId} onClose={() => setReceiptPaymentId(null)} />
      <MasterBillView source="invoice" sourceId={masterBillInvoiceId} onClose={() => { setMasterBillInvoiceId(null); fetchInvoices(); }} />
      <CustomerHistoryModal
        guestId={historyGuestId}
        onClose={() => setHistoryGuestId(null)}
        onOpenMasterBill={id => { setHistoryGuestId(null); setMasterBillInvoiceId(id); }}
        onOpenReceipt={id => { setHistoryGuestId(null); setReceiptPaymentId(id); }}
      />
    </div>
  );
}
