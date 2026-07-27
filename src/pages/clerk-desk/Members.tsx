import { useEffect, useMemo, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/useAuth';
import { hasPermission } from '@/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  IdCard, CheckCircle2, DollarSign, Percent, FileText, Printer,
  ChevronDown, ChevronRight, Sparkles, Clock, BadgeCheck,
} from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import { RoomLeaseDispatchView, DietInvoiceView } from '@/components/MessBillPrint';
import { useClerkDesk, type MemberBill } from './context';

// Member billing, merged in from the old standalone Mess Billing page (Clerk
// now works this entirely from Clerk Desk). Clerk holds full mess_billing
// access (view/create/edit/approve) - the standalone Mess Billing page is
// still where bills get generated and guest meal charges get logged (this
// tab intentionally excludes both); this tab picks up from there: issue,
// collect, discount, print.

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const MESS_CATEGORY: Record<string, { label: string; className: string }> = {
  officers: { label: 'Officer', className: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300' },
  jcos: { label: 'JCO', className: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300' },
  ors: { label: 'OR', className: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
};

const today = new Date();

interface MemberOption { id: number; full_name: string; }
interface GuestCharge { id: number; sponsor_member_id: number; guest_name: string; date: string; meal_type: string; amount: number; }

function TypeBadges({ bill }: { bill: MemberBill }) {
  const cat = bill.member_mess_category ? MESS_CATEGORY[bill.member_mess_category] : null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {cat && <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cat.className}`}>{cat.label}</span>}
      {bill.member_is_womens_bloc && (
        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-fuchsia-50 text-fuchsia-700 dark:bg-fuchsia-950 dark:text-fuchsia-300">Women's Bloc</span>
      )}
    </div>
  );
}

function BreakdownRow({ label, amount }: { label: string; amount: number }) {
  if (!amount) return null;
  return (
    <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
      <span>{label}</span><span className="font-mono">{formatCurrency(amount)}</span>
    </div>
  );
}

export default function Members() {
  const { user } = useAuth();
  const { refresh: refreshDesk } = useClerkDesk();
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear] = useState(today.getFullYear());
  const [bills, setBills] = useState<MemberBill[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [issuingAll, setIssuingAll] = useState(false);

  const [members, setMembers] = useState<MemberOption[]>([]);
  const [charges, setCharges] = useState<GuestCharge[]>([]);
  const [chargesOpen, setChargesOpen] = useState(false);
  const [paidOpen, setPaidOpen] = useState(false);

  const [discountBill, setDiscountBill] = useState<MemberBill | null>(null);
  const [discountRate, setDiscountRate] = useState(0);
  const [discountReason, setDiscountReason] = useState('');

  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [dietInvoiceBillId, setDietInvoiceBillId] = useState<number | null>(null);

  const canApprove = hasPermission(user, 'mess_billing', 'approve');
  const canEdit = hasPermission(user, 'mess_billing', 'edit');

  const fetchBills = async () => {
    try {
      const res = await api.get(`/mess-billing/bills?month=${month}&year=${year}&page_size=100`);
      setBills(res.data.items || []);
    } catch { toast.error('Failed to load member bills'); }
  };

  useEffect(() => {
    queueMicrotask(() => { setLoading(true); fetchBills().finally(() => setLoading(false)); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, year]);

  useEffect(() => { queueMicrotask(() => {
    api.get('/members?status=active&page_size=100').then(res => setMembers(res.data.items)).catch(() => {});
    api.get('/mess-billing/guest-charges').then(res => setCharges(res.data)).catch(() => {});
  }); }, []);

  const monthCharges = useMemo(
    () => charges.filter(c => { const d = new Date(c.date); return d.getMonth() + 1 === month && d.getFullYear() === year; }),
    [charges, month, year],
  );

  const draftBills = bills.filter(b => b.status === 'draft');
  const issuedBills = bills.filter(b => b.status === 'issued');
  const paidBills = bills.filter(b => b.status === 'paid');

  const totalBilled = issuedBills.reduce((s, b) => s + b.total_amount, 0) + paidBills.reduce((s, b) => s + b.total_amount, 0);
  const collected = paidBills.reduce((s, b) => s + b.total_amount, 0);
  const outstanding = issuedBills.reduce((s, b) => s + b.total_amount, 0);

  const afterAction = async () => { await fetchBills(); refreshDesk(); };

  const handleIssue = async (id: number) => {
    setBusyId(id);
    try { await api.post(`/mess-billing/bills/${id}/issue`); toast.success('Bill issued — now awaiting payment'); await afterAction(); }
    catch (err) { toast.error(getErrorMessage(err, 'Failed to issue bill')); }
    finally { setBusyId(null); }
  };

  const handleMarkPaid = async (id: number) => {
    setBusyId(id);
    try { await api.post(`/mess-billing/bills/${id}/mark-paid`); toast.success('Marked as paid'); await afterAction(); }
    catch (err) { toast.error(getErrorMessage(err, 'Failed to mark paid')); }
    finally { setBusyId(null); }
  };

  const handleIssueAll = async () => {
    setIssuingAll(true);
    try {
      const res = await api.post(`/mess-billing/issue-all?month=${month}&year=${year}`);
      if (res.data.issued.length === 0) toast.info('No newly-generated bills to issue');
      else toast.success(`Issued ${res.data.issued.length} bill(s)`);
      await afterAction();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to issue bills')); }
    finally { setIssuingAll(false); }
  };

  const handleApplyDiscount = async () => {
    if (!discountBill || !discountReason.trim()) { toast.error('A reason is required to apply a discount'); return; }
    try {
      await api.post(`/mess-billing/bills/${discountBill.id}/apply-discount`, { discount_rate: discountRate, reason: discountReason });
      toast.success('Discount applied');
      setDiscountBill(null);
      setDiscountReason('');
      await afterAction();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to apply discount')); }
  };

  const memberOf = (id: number) => members.find(m => m.id === id)?.full_name || `Member #${id}`;

  function BillCard({ bill }: { bill: MemberBill }) {
    const busy = busyId === bill.id;
    return (
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-bold truncate">{bill.member_name || `Member #${bill.member_id}`}</p>
              <p className="text-xs text-gray-500">
                {bill.member_rank ? `${bill.member_rank}` : ''}{bill.member_rank && bill.member_service_number ? ' · ' : ''}{bill.member_service_number || ''}
              </p>
              <div className="mt-1.5"><TypeBadges bill={bill} /></div>
            </div>
            <p className="text-xl font-bold font-mono shrink-0">{formatCurrency(bill.total_amount)}</p>
          </div>

          <div className="rounded-lg bg-gray-50 dark:bg-gray-900/50 p-2.5 space-y-0.5">
            <BreakdownRow label="Menu (dining)" amount={bill.base_menu_amount} />
            <BreakdownRow label="Room / HRA" amount={bill.stay_amount} />
            <BreakdownRow label="Extra sponsored meals" amount={bill.extra_meals_amount} />
            <BreakdownRow label="À la carte" amount={bill.ala_carte_amount} />
            {bill.discount_amount > 0 && (
              <div className="flex justify-between text-xs text-emerald-600 dark:text-emerald-400 pt-0.5 border-t border-gray-200 dark:border-gray-800 mt-1">
                <span>Discount applied ({bill.applied_discount_rate}%){bill.discount_reason ? ` — ${bill.discount_reason}` : ''}</span>
                <span className="font-mono">− {formatCurrency(bill.discount_amount)}</span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {bill.status === 'draft' && canApprove && (
              <Button size="sm" disabled={busy} onClick={() => handleIssue(bill.id)}>
                <CheckCircle2 size={14} className="mr-1" /> Issue Bill
              </Button>
            )}
            {bill.status === 'issued' && canEdit && (
              <Button size="sm" disabled={busy} onClick={() => handleMarkPaid(bill.id)}>
                <DollarSign size={14} className="mr-1" /> Mark as Paid
              </Button>
            )}
            {bill.status !== 'paid' && canApprove && (
              <Button size="sm" variant="outline" disabled={busy}
                onClick={() => { setDiscountBill(bill); setDiscountRate(bill.applied_discount_rate); setDiscountReason(''); }}>
                <Percent size={14} className="mr-1" /> Apply Discount
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setDietInvoiceBillId(bill.id)}>
              <FileText size={14} className="mr-1" /> Print Diet Invoice
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-sm text-gray-500">Monthly member mess bills — generated by the front desk each period, finalized and collected here.</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="h-9 rounded-md border border-input bg-background px-2.5 text-sm" value={month} onChange={e => setMonth(Number(e.target.value))}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{MONTHS[m]}</option>)}
          </select>
          <Input type="number" className="w-24 h-9" value={year} onChange={e => setYear(Number(e.target.value))} />
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card><CardContent className="p-3.5"><p className="text-xs text-gray-500">Total Billed</p><p className="text-lg font-bold">{formatCurrency(totalBilled)}</p></CardContent></Card>
        <Card><CardContent className="p-3.5"><p className="text-xs text-gray-500">Collected</p><p className="text-lg font-bold text-emerald-600">{formatCurrency(collected)}</p></CardContent></Card>
        <Card><CardContent className="p-3.5"><p className="text-xs text-gray-500">Outstanding</p><p className="text-lg font-bold text-amber-600">{formatCurrency(outstanding)}</p></CardContent></Card>
        <Card><CardContent className="p-3.5"><p className="text-xs text-gray-500">Newly Generated</p><p className="text-lg font-bold">{draftBills.length}</p></CardContent></Card>
      </div>

      <div className="flex flex-wrap gap-2">
        {canApprove && (
          <Button variant="outline" onClick={handleIssueAll} disabled={draftBills.length === 0 || issuingAll}>
            <CheckCircle2 size={16} className="mr-1" /> Issue All Newly-Generated ({draftBills.length})
          </Button>
        )}
        <Button variant="outline" onClick={() => setDispatchOpen(true)} disabled={bills.length === 0}>
          <Printer size={16} className="mr-1" /> Print Room-Lease Dispatch
        </Button>
      </div>

      {loading && <p className="text-sm text-gray-500">Loading…</p>}

      {!loading && bills.length === 0 && (
        <Card><CardContent className="p-6 text-center text-sm text-gray-500">
          No bills generated yet for {MONTHS[month]} {year}. The front desk generates each period's bills on the Mess Billing page — once that's done, they'll show up here to issue and collect.
        </CardContent></Card>
      )}

      {draftBills.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-2 text-amber-700 dark:text-amber-400">
            <Sparkles size={16} /> Newly Generated — Needs Review
            <span className="text-xs font-normal text-gray-500">Not yet issued to the member</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {draftBills.map(b => <BillCard key={b.id} bill={b} />)}
          </div>
        </div>
      )}

      {issuedBills.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-2 text-blue-700 dark:text-blue-400">
            <Clock size={16} /> Issued — Awaiting Payment
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {issuedBills.map(b => <BillCard key={b.id} bill={b} />)}
          </div>
        </div>
      )}

      {paidBills.length > 0 && (
        <div>
          <button type="button" onClick={() => setPaidOpen(v => !v)}
            className="text-sm font-semibold mb-2 flex items-center gap-2 text-emerald-700 dark:text-emerald-400 hover:underline">
            {paidOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <BadgeCheck size={16} /> Paid — Settled ({paidBills.length})
          </button>
          {paidOpen && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {paidBills.map(b => <BillCard key={b.id} bill={b} />)}
            </div>
          )}
        </div>
      )}

      <div>
        <button type="button" onClick={() => setChargesOpen(v => !v)}
          className="text-sm font-semibold flex items-center gap-2 text-gray-600 dark:text-gray-300 hover:underline">
          {chargesOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <IdCard size={16} /> Guest meal charges this month ({monthCharges.length})
        </button>
        {chargesOpen && (
          <Card className="mt-2">
            <CardContent className="p-0">
              {monthCharges.length === 0
                ? <p className="text-sm text-gray-500 p-4">No sponsored guest meals recorded for {MONTHS[month]} {year}.</p>
                : (
                  <div className="divide-y divide-gray-100 dark:divide-gray-800">
                    {monthCharges.map(c => (
                      <div key={c.id} className="flex items-center justify-between px-4 py-2 text-sm">
                        <span className="min-w-0 truncate">{c.guest_name} <span className="text-gray-400">· sponsored by {memberOf(c.sponsor_member_id)}</span></span>
                        <span className="flex items-center gap-3 shrink-0 text-gray-500">
                          <span className="capitalize">{c.meal_type}</span><span>{c.date}</span>
                          <span className="font-mono font-medium text-gray-800 dark:text-gray-200">{formatCurrency(c.amount)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              <p className="text-xs text-gray-400 px-4 py-2 border-t border-gray-100 dark:border-gray-800">Logged by the front desk on the Mess Billing page — feeds each sponsor's "Extra sponsored meals" line above.</p>
            </CardContent>
          </Card>
        )}
      </div>

      {canApprove && (
        <Dialog open={!!discountBill} onOpenChange={(open) => { if (!open) setDiscountBill(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Apply Discount — {discountBill?.member_name}</DialogTitle></DialogHeader>
            {discountBill && (
              <div className="space-y-3">
                <p className="text-xs text-gray-500">Reduces this member's dining (menu) charge only — room/HRA, extra sponsored meals and à la carte are unaffected.</p>
                <div><Label>Discount Rate (%)</Label><Input type="number" min={0} max={100} value={discountRate} onChange={e => setDiscountRate(Number(e.target.value))} /></div>
                <div><Label>Reason (required)</Label><Input value={discountReason} onChange={e => setDiscountReason(e.target.value)} placeholder="e.g. Hardship case, command directive" /></div>
                <Button onClick={handleApplyDiscount} className="w-full">Apply Discount</Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}

      {dispatchOpen && <RoomLeaseDispatchView month={month} year={year} onClose={() => setDispatchOpen(false)} />}
      <DietInvoiceView billId={dietInvoiceBillId} onClose={() => setDietInvoiceBillId(null)} />
    </div>
  );
}
