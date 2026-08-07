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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Wallet, RefreshCw, CheckCircle, DollarSign, Percent, Plus, Printer, FileText, ClipboardEdit } from 'lucide-react';
import { defaultMealForNow } from '@/lib/mealDefaults';
import { formatCurrency } from '@/lib/currency';
import { RoomLeaseDispatchView, DietInvoiceView } from '@/components/MessBillPrint';
import { MasterBillView } from '@/components/MasterBillView';
import { PaymentReceiptView } from '@/components/BillPrint';

interface MessBill {
  id: number;
  member_id: number;
  member_name: string | null;
  member_dining_status: string;
  month: number;
  year: number;
  man_days: number;
  per_head_rate: number;
  base_menu_amount: number;
  stay_amount: number;
  extra_meals_amount: number;
  ala_carte_amount: number;
  applied_discount_rate: number;
  discount_amount: number;
  discount_reason: string | null;
  total_amount: number;
  amount_paid?: number;
  last_debit_balance?: number;
  status: string;
}

interface MemberOption {
  id: number;
  full_name: string;
}

interface GuestCharge {
  id: number;
  sponsor_member_id: number;
  guest_name: string;
  date: string;
  meal_type: string;
  amount: number;
}

const today = new Date();
const emptyChargeForm = () => ({ sponsor_member_id: 0, guest_name: '', date: today.toISOString().slice(0, 10), meal_type: defaultMealForNow() as string, amount: 0, notes: '' });

export default function MessBilling() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear] = useState(today.getFullYear());
  const [bills, setBills] = useState<MessBill[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [charges, setCharges] = useState<GuestCharge[]>([]);
  const [loading, setLoading] = useState(true);
  const [discountBill, setDiscountBill] = useState<MessBill | null>(null);
  const [discountRate, setDiscountRate] = useState(0);
  const [discountReason, setDiscountReason] = useState('');
  const [chargeDialogOpen, setChargeDialogOpen] = useState(false);
  const [chargeForm, setChargeForm] = useState(emptyChargeForm());
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [dietInvoiceBillId, setDietInvoiceBillId] = useState<number | null>(null);
  const [masterBillId, setMasterBillId] = useState<number | null>(null);
  const [paymentBill, setPaymentBill] = useState<MessBill | null>(null);
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [receiptPaymentId, setReceiptPaymentId] = useState<number | null>(null);

  const fetchBills = async () => {
    try {
      const res = await api.get(`/mess-billing/bills?month=${month}&year=${year}`);
      setBills(res.data.items);
    } catch { toast.error('Failed to load mess bills'); }
  };

  const fetchMembers = async () => {
    try {
      const res = await api.get('/members?status=active&page_size=100');
      setMembers(res.data.items);
    } catch { toast.error('Failed to load members'); }
  };

  const fetchCharges = async () => {
    try {
      const res = await api.get('/mess-billing/guest-charges');
      setCharges(res.data);
    } catch { toast.error('Failed to load guest charges'); }
  };

  useEffect(() => {
    queueMicrotask(() => {
      setLoading(true);
      Promise.all([fetchBills(), fetchMembers(), fetchCharges()]).finally(() => setLoading(false));
    });
  }, [month, year]);

  const handleGenerate = async () => {
    try {
      const res = await api.post(`/mess-billing/generate?month=${month}&year=${year}`);
      toast.success(`Generated ${res.data.generated.length} bill(s), ${res.data.skipped_finalized.length} already finalized`);
      fetchBills();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to generate bills')); }
  };

  // The global "Generate Bills" shortcut (Layout.tsx) deep-links here with
  // navigation state - consume it once (for the current month/year already
  // loaded above), then clear the state so a back-navigation or remount
  // doesn't regenerate.
  useEffect(() => { queueMicrotask(() => {
    const state = location.state as { autoGenerate?: boolean } | null;
    if (state?.autoGenerate) {
      handleGenerate();
      navigate(location.pathname, { replace: true, state: null });
    }
  }); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const handleIssueAll = async () => {
    try {
      const res = await api.post(`/mess-billing/issue-all?month=${month}&year=${year}`);
      if (res.data.issued.length === 0) toast.info('No draft bills to issue');
      else toast.success(`Issued ${res.data.issued.length} bill(s)`);
      fetchBills();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to issue bills')); }
  };

  const handleIssue = async (id: number) => {
    try { await api.post(`/mess-billing/bills/${id}/issue`); toast.success('Bill issued'); fetchBills(); }
    catch (err) { toast.error(getErrorMessage(err, 'Failed to issue bill')); }
  };

  const handleRecordPayment = async () => {
    if (!paymentBill || paymentAmount <= 0) { toast.error('Enter a valid payment amount'); return; }
    try {
      const res = await api.post(`/mess-billing/bills/${paymentBill.id}/payments`, { amount: paymentAmount });
      toast.success('Payment recorded');
      setPaymentBill(null);
      setPaymentAmount(0);
      setReceiptPaymentId(res.data.id);
      fetchBills();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to record payment')); }
  };

  const handleApplyDiscount = async () => {
    if (!discountBill || !discountReason.trim()) {
      toast.error('A reason is required to apply a discount');
      return;
    }
    try {
      await api.post(`/mess-billing/bills/${discountBill.id}/apply-discount`, { discount_rate: discountRate, reason: discountReason });
      toast.success('Discount applied');
      setDiscountBill(null);
      setDiscountReason('');
      fetchBills();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to apply discount')); }
  };

  const handleCreateCharge = async () => {
    try {
      await api.post('/mess-billing/guest-charges', chargeForm);
      toast.success('Guest meal charge recorded');
      setChargeDialogOpen(false);
      setChargeForm(emptyChargeForm());
      fetchCharges();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to record charge')); }
  };

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = { draft: 'bg-muted text-muted-foreground', issued: 'bg-blue-100 text-blue-800', paid: 'bg-green-100 text-green-800' };
    return <Badge className={colors[status] || ''}>{status}</Badge>;
  };

  const draftCount = bills.filter(b => b.status === 'draft').length;
  const totalBilled = bills.filter(b => b.status !== 'draft').reduce((s, b) => s + b.total_amount, 0);
  const collected = bills.filter(b => b.status === 'paid').reduce((s, b) => s + b.total_amount, 0);
  const outstanding = bills.filter(b => b.status === 'issued').reduce((s, b) => s + b.total_amount, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><Wallet size={24} /> Mess Billing</h1>
        <div className="flex items-center gap-2">
          <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={month} onChange={e => setMonth(Number(e.target.value))}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{new Date(2000, m - 1).toLocaleString('default', { month: 'long' })}</option>)}
          </select>
          <Input type="number" className="w-24" value={year} onChange={e => setYear(Number(e.target.value))} />
          <Button onClick={handleGenerate}><RefreshCw size={16} className="mr-1" /> Generate Bills</Button>
          <Button variant="outline" onClick={handleIssueAll} disabled={draftCount === 0}>
            <CheckCircle size={16} className="mr-1" /> Issue All Drafts ({draftCount})
          </Button>
          <Button variant="outline" onClick={() => setDispatchOpen(true)} disabled={bills.length === 0}>
            <Printer size={16} className="mr-1" /> Print Room-Lease Dispatch
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total Billed</p><p className="text-xl font-bold">{formatCurrency(totalBilled)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Collected</p><p className="text-xl font-bold text-green-600">{formatCurrency(collected)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Outstanding</p><p className="text-xl font-bold text-amber-600">{formatCurrency(outstanding)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Drafts</p><p className="text-xl font-bold">{draftCount}</p></CardContent></Card>
      </div>

      <Tabs defaultValue="bills">
        <TabsList className="grid w-full grid-cols-2 max-w-xs"><TabsTrigger value="bills">Bills</TabsTrigger><TabsTrigger value="guest-charges">Guest Meal Charges</TabsTrigger></TabsList>

        <TabsContent value="bills">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Member</TableHead><TableHead>Dining</TableHead><TableHead>Man-Days</TableHead><TableHead>Menu</TableHead><TableHead>Stay</TableHead><TableHead>Extras</TableHead><TableHead>A La Carte</TableHead><TableHead>Discount</TableHead><TableHead>Total</TableHead><TableHead>Status</TableHead><TableHead className="w-32">Actions</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {loading && <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">Loading bills...</TableCell></TableRow>}
                  {!loading && bills.map(b => (
                    <TableRow key={b.id}>
                      <TableCell className="font-medium">{b.member_name}</TableCell>
                      <TableCell>{b.member_dining_status === 'non_dining' ? <Badge variant="outline">Non-Dining</Badge> : <span className="text-muted-foreground">Dining</span>}</TableCell>
                      <TableCell>{b.man_days}</TableCell>
                      <TableCell>{formatCurrency(b.base_menu_amount)}</TableCell>
                      <TableCell>{formatCurrency(b.stay_amount)}</TableCell>
                      <TableCell>{formatCurrency(b.extra_meals_amount)}</TableCell>
                      <TableCell>{formatCurrency(b.ala_carte_amount)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{b.applied_discount_rate}% ({formatCurrency(b.discount_amount)})</TableCell>
                      <TableCell className="font-semibold">{formatCurrency(b.total_amount)}</TableCell>
                      <TableCell>{statusBadge(b.status)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {b.status === 'draft' && <Button size="sm" variant="ghost" onClick={() => handleIssue(b.id)}><CheckCircle size={16} className="text-blue-600" /></Button>}
                          {b.status === 'issued' && (
                            <Button size="sm" variant="ghost" title="Record Payment" onClick={() => { setPaymentBill(b); setPaymentAmount(0); }}>
                              <DollarSign size={16} className="text-green-600" />
                            </Button>
                          )}
                          {hasPermission(user, 'mess_billing', 'approve') && b.status !== 'paid' && (
                            <Button size="sm" variant="ghost" onClick={() => { setDiscountBill(b); setDiscountRate(b.applied_discount_rate); setDiscountReason(''); }}>
                              <Percent size={16} className="text-purple-600" />
                            </Button>
                          )}
                          {b.status !== 'draft' && (
                            <Button size="sm" variant="ghost" title="Make Bill / Interactive Table" onClick={() => setMasterBillId(b.id)}>
                              <ClipboardEdit size={16} className="text-blue-600" />
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" title="Print Diet Invoice" onClick={() => setDietInvoiceBillId(b.id)}>
                            <FileText size={16} className="text-muted-foreground" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!loading && bills.length === 0 && <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">No bills for this period - click Generate Bills</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="guest-charges" className="space-y-4">
          <div className="flex justify-end">
            <Dialog open={chargeDialogOpen} onOpenChange={setChargeDialogOpen}>
              <DialogTrigger asChild><Button size="sm"><Plus size={14} className="mr-1" /> Record Guest Charge</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Record Guest Meal Charge</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={chargeForm.sponsor_member_id} onChange={e => setChargeForm({...chargeForm, sponsor_member_id: Number(e.target.value)})}>
                    <option value="0">Select sponsoring member</option>
                    {members.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                  </select>
                  <Input placeholder="Guest Name" value={chargeForm.guest_name} onChange={e => setChargeForm({...chargeForm, guest_name: e.target.value})} />
                  <div className="grid grid-cols-2 gap-3">
                    <Input type="date" value={chargeForm.date} onChange={e => setChargeForm({...chargeForm, date: e.target.value})} />
                    <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={chargeForm.meal_type} onChange={e => setChargeForm({...chargeForm, meal_type: e.target.value})}>
                      <option value="breakfast">Breakfast</option><option value="lunch">Lunch</option><option value="hitea">Hi-Tea</option><option value="dinner">Dinner</option>
                    </select>
                  </div>
                  <Input type="number" placeholder="Amount" min={0} value={chargeForm.amount} onChange={e => setChargeForm({...chargeForm, amount: Number(e.target.value)})} />
                  <Button onClick={handleCreateCharge} className="w-full">Record Charge</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Sponsor</TableHead><TableHead>Guest</TableHead><TableHead>Date</TableHead><TableHead>Meal</TableHead><TableHead>Amount</TableHead></TableRow></TableHeader>
                <TableBody>
                  {charges.map(c => (
                    <TableRow key={c.id}>
                      <TableCell>{members.find(m => m.id === c.sponsor_member_id)?.full_name || `#${c.sponsor_member_id}`}</TableCell>
                      <TableCell>{c.guest_name}</TableCell>
                      <TableCell>{c.date}</TableCell>
                      <TableCell className="capitalize">{c.meal_type}</TableCell>
                      <TableCell>{formatCurrency(c.amount)}</TableCell>
                    </TableRow>
                  ))}
                  {charges.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No guest meal charges recorded</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Apply Discount dialog - renders only for roles with mess_billing.approve;
          authorization is entirely server-side (check_permission against the
          session), there is no client-side "authorization id" field anywhere
          in this form. */}
      {hasPermission(user, 'mess_billing', 'approve') && (
        <Dialog open={!!discountBill} onOpenChange={(open) => { if (!open) setDiscountBill(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Apply Discount - {discountBill?.member_name}</DialogTitle></DialogHeader>
            {discountBill && (
              <div className="space-y-3">
                <div><Label>Discount Rate (%)</Label><Input type="number" min={0} max={100} value={discountRate} onChange={e => setDiscountRate(Number(e.target.value))} /></div>
                <div><Label>Reason (required)</Label><Input value={discountReason} onChange={e => setDiscountReason(e.target.value)} placeholder="e.g. Hardship case, command directive" /></div>
                <Button onClick={handleApplyDiscount} className="w-full">Apply Discount</Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}

      {dispatchOpen && (
        <RoomLeaseDispatchView month={month} year={year} onClose={() => setDispatchOpen(false)} />
      )}
      <DietInvoiceView billId={dietInvoiceBillId} onClose={() => setDietInvoiceBillId(null)} />
      <MasterBillView source="mess_bill" sourceId={masterBillId} onClose={() => { setMasterBillId(null); fetchBills(); }} />

      <Dialog open={!!paymentBill} onOpenChange={(open) => { if (!open) { setPaymentBill(null); setPaymentAmount(0); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Record Payment - {paymentBill?.member_name}</DialogTitle></DialogHeader>
          {paymentBill && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Total: {formatCurrency(paymentBill.total_amount + (paymentBill.last_debit_balance || 0))} &middot; Paid: {formatCurrency(paymentBill.amount_paid || 0)}
              </p>
              <div><Label>Payment Amount</Label><Input type="number" min={0} value={paymentAmount || ''} onChange={e => setPaymentAmount(Number(e.target.value))} /></div>
              <Button onClick={handleRecordPayment} className="w-full">Record Payment</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <PaymentReceiptView paymentId={receiptPaymentId} kind="mess_bill" onClose={() => setReceiptPaymentId(null)} />
    </div>
  );
}
