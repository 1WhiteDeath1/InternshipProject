import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Wallet, RefreshCw, CheckCircle, DollarSign, Percent, Plus } from 'lucide-react';
import { defaultMealForNow } from '@/lib/mealDefaults';

interface MessBill {
  id: number;
  member_id: number;
  member_name: string | null;
  month: number;
  year: number;
  man_days: number;
  per_head_rate: number;
  base_menu_amount: number;
  stay_amount: number;
  extra_meals_amount: number;
  applied_discount_rate: number;
  discount_amount: number;
  discount_reason: string | null;
  total_amount: number;
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

  const handleIssue = async (id: number) => {
    try { await api.post(`/mess-billing/bills/${id}/issue`); toast.success('Bill issued'); fetchBills(); }
    catch (err) { toast.error(getErrorMessage(err, 'Failed to issue bill')); }
  };

  const handleMarkPaid = async (id: number) => {
    try { await api.post(`/mess-billing/bills/${id}/mark-paid`); toast.success('Bill marked paid'); fetchBills(); }
    catch (err) { toast.error(getErrorMessage(err, 'Failed to mark paid')); }
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
    const colors: Record<string, string> = { draft: 'bg-gray-100 text-gray-800', issued: 'bg-blue-100 text-blue-800', paid: 'bg-green-100 text-green-800' };
    return <Badge className={colors[status] || ''}>{status}</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2"><Wallet size={24} /> Mess Billing</h1>
        <div className="flex items-center gap-2">
          <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={month} onChange={e => setMonth(Number(e.target.value))}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{new Date(2000, m - 1).toLocaleString('default', { month: 'long' })}</option>)}
          </select>
          <Input type="number" className="w-24" value={year} onChange={e => setYear(Number(e.target.value))} />
          <Button onClick={handleGenerate}><RefreshCw size={16} className="mr-1" /> Generate Bills</Button>
        </div>
      </div>

      <Tabs defaultValue="bills">
        <TabsList className="grid w-full grid-cols-2 max-w-xs"><TabsTrigger value="bills">Bills</TabsTrigger><TabsTrigger value="guest-charges">Guest Meal Charges</TabsTrigger></TabsList>

        <TabsContent value="bills">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Member</TableHead><TableHead>Man-Days</TableHead><TableHead>Menu</TableHead><TableHead>Stay</TableHead><TableHead>Extras</TableHead><TableHead>Discount</TableHead><TableHead>Total</TableHead><TableHead>Status</TableHead><TableHead className="w-32">Actions</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {loading && <TableRow><TableCell colSpan={9} className="text-center py-8 text-gray-500">Loading bills...</TableCell></TableRow>}
                  {!loading && bills.map(b => (
                    <TableRow key={b.id}>
                      <TableCell className="font-medium">{b.member_name}</TableCell>
                      <TableCell>{b.man_days}</TableCell>
                      <TableCell>${b.base_menu_amount.toFixed(2)}</TableCell>
                      <TableCell>${b.stay_amount.toFixed(2)}</TableCell>
                      <TableCell>${b.extra_meals_amount.toFixed(2)}</TableCell>
                      <TableCell className="text-sm text-gray-500">{b.applied_discount_rate}% (${b.discount_amount.toFixed(2)})</TableCell>
                      <TableCell className="font-semibold">${b.total_amount.toFixed(2)}</TableCell>
                      <TableCell>{statusBadge(b.status)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {b.status === 'draft' && <Button size="sm" variant="ghost" onClick={() => handleIssue(b.id)}><CheckCircle size={16} className="text-blue-600" /></Button>}
                          {b.status === 'issued' && <Button size="sm" variant="ghost" onClick={() => handleMarkPaid(b.id)}><DollarSign size={16} className="text-green-600" /></Button>}
                          {user?.is_supervisor && b.status !== 'paid' && (
                            <Button size="sm" variant="ghost" onClick={() => { setDiscountBill(b); setDiscountRate(b.applied_discount_rate); setDiscountReason(''); }}>
                              <Percent size={16} className="text-purple-600" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!loading && bills.length === 0 && <TableRow><TableCell colSpan={9} className="text-center py-8 text-gray-500">No bills for this period - click Generate Bills</TableCell></TableRow>}
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
                      <TableCell>${c.amount.toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                  {charges.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-8 text-gray-500">No guest meal charges recorded</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Apply Discount dialog - renders only for supervisors; authorization is
          entirely server-side (check_permission against the session), there is
          no client-side "authorization id" field anywhere in this form. */}
      {user?.is_supervisor && (
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
    </div>
  );
}
