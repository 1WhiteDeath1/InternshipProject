import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import api, { getErrorMessage } from '@/lib/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Printer, FileEdit } from 'lucide-react';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/currency';

/* Printable documents in the mess's own paper formats:
   - BillPrintView: the "DRAFT BILL (For Office Use Only)" layout (Ser /
     Details / Amount table, PA No / Rank / Name / Room No header, GR NCO /
     Catering NCO / Mess JCO signature row) + QR code. Everything settles at
     checkout (or monthly via the Mess Bill for HRA) - no advance/pre-payment.
     A stay with both a room and a mess invoice gets a Room / Mess / Combined
     tab set: Room and Mess each show that invoice's own detailed rows
     (DraftBill), Combined row-merges both via the master-invoice endpoint
     (MergedBill) - never two separate paper forms stacked in one dialog.
   - PaymentReceiptView: the cash receipt ("Received from ... the sum of
     Rupees ... by Cash/Cheque ... Mess Secretary") + QR code. */

export interface BillItem { id: number; description: string; quantity: number; unit_price: number; total_price: number; }
export interface BillInvoice {
  id: number; invoice_number: string; bill_type: string; issue_date: string;
  subtotal: number; total_amount: number; amount_paid: number; balance_due: number;
  status: string; items: BillItem[]; is_complimentary?: boolean;
}
interface BillBooking {
  guest_name: string; rank: string | null; pa_number: string | null; unit_address: string | null;
  reference_person?: string | null;
  room_number: string | null; check_in: string; check_out: string;
  source: string; online_voucher_no: string | null; advance_payment_amount: number; booking_reference: string;
}
interface MessIdentity { name: string; address: string; phone: string; }
interface PrintData { invoice: BillInvoice; booking: BillBooking | null; mess: MessIdentity; qr_svg: string; verify_hash?: string; }

const BILL_LABELS: Record<string, string> = { room: 'ROOM BILL', mess: 'MESS / FOOD BILL', combined: 'BILL' };

// Fixed Ser rows of the paper "DRAFT BILL" form - rendered on room/combined
// bills in this order, with amounts filled from matching invoice items and a
// dash where nothing was charged. Unmatched items are appended after.
const PAPER_BILL_HEADS = [
  'Extra Messing',
  'Sui Gas Charges on Messing',
  'Dhobi',
  'Guest Room Charges',
  'Allied Charges',
  'Extra Mattress',
  'Breakage',
  'Dental Kit',
];

function paperRows(items: BillItem[]) {
  const remaining = [...items];
  const takeMatch = (head: string) => {
    const idx = remaining.findIndex(it => it.description.toLowerCase().startsWith(head.toLowerCase()));
    return idx === -1 ? null : remaining.splice(idx, 1)[0];
  };
  const fixed = PAPER_BILL_HEADS.map(head => ({ head, item: takeMatch(head) }));
  return { fixed, extra: remaining };
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function rupeesInWords(n: number): string {
  n = Math.round(n);
  if (n <= 0) return 'Zero';
  const two = (x: number) => x < 20 ? ONES[x] : `${TENS[Math.floor(x / 10)]}${x % 10 ? ' ' + ONES[x % 10] : ''}`;
  const three = (x: number) => `${x >= 100 ? ONES[Math.floor(x / 100)] + ' Hundred' + (x % 100 ? ' ' : '') : ''}${x % 100 ? two(x % 100) : ''}`;
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) parts.push(`${two(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (n) parts.push(three(n));
  return parts.join(' ');
}

const fmtD = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
};

/* The printable copy lives in a body-level portal, NOT inside the dialog:
   the dialog is centered with a CSS transform, and a transformed ancestor
   becomes the containing block for position:fixed/absolute - printing from
   inside it anchored the bill to the dialog (big top offset, rows clipped
   at the dialog edge, broken page breaks). The portal copy is hidden on
   screen (print:block) and positioned from the real page origin. */
const PRINT_STYLE = `
  @media print {
    body * { visibility: hidden; }
    #bill-print-area, #bill-print-area * { visibility: visible; }
    #bill-print-area { display: block !important; position: absolute; top: 0; left: 0; width: 100%; }
    html, body { height: auto !important; overflow: visible !important; }
    .bill-page { page-break-after: always; break-inside: avoid; }
    .bill-page:last-child { page-break-after: auto; }
    .bill-page tr { break-inside: avoid; }
  }
`;

/** Screen preview inside the dialog + the print-only copy portaled to <body>. */
function PrintArea({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="space-y-4">{children}</div>
      {createPortal(
        <div id="bill-print-area" className="hidden print:block">{children}</div>,
        document.body,
      )}
    </>
  );
}

function DottedField({ label, value, grow }: { label: string; value?: string | number | null; grow?: boolean }) {
  return (
    <span className={`inline-flex items-baseline gap-1 ${grow ? 'flex-1' : ''}`}>
      <span className="whitespace-nowrap">{label}</span>
      <span className={`border-b border-dotted border-gray-500 px-1 min-w-16 font-medium ${grow ? 'flex-1' : ''}`}>
        {value ?? ''}
      </span>
    </span>
  );
}

function DraftBill({ data }: { data: PrintData }) {
  const inv = data.invoice;
  const b = data.booking;
  const alreadyPaid = inv.amount_paid;
  // Room and combined bills reproduce the paper form's fixed Ser rows;
  // the mess/food bill lists its (dynamic) meal items directly.
  const usePaperForm = inv.bill_type !== 'mess';
  const { fixed, extra } = usePaperForm ? paperRows(inv.items) : { fixed: [], extra: inv.items };
  return (
    <div className="bill-page border border-gray-400 rounded-sm p-4 text-[13px] text-gray-900 bg-white space-y-2.5">
      <div className="flex justify-between items-start">
        <div className="flex-1">
          <p className="text-[11px] text-gray-600">{data.mess.name} · {data.mess.address} · {data.mess.phone}</p>
          <p className="text-center font-bold underline decoration-2 text-sm mt-1">
            DRAFT BILL (For Office Use Only) — {BILL_LABELS[inv.bill_type] || 'BILL'}
          </p>
          {inv.is_complimentary && (
            <p className="text-center font-bold text-emerald-700 text-xs mt-0.5">★ COMPLIMENTARY — NO CHARGE ★</p>
          )}
        </div>
        <div className="w-16 h-16 shrink-0 ml-2 [&>svg]:w-full [&>svg]:h-full" dangerouslySetInnerHTML={{ __html: data.qr_svg }} />
      </div>

      <div className="flex justify-between gap-4">
        <DottedField label="Online V/No." value={b?.online_voucher_no || '—'} grow />
        {b?.source === 'online' && <DottedField label="Advance Paid" value={formatCurrency(b.advance_payment_amount)} />}
        <DottedField label="S/No." value={inv.invoice_number} />
      </div>
      <div className="flex gap-4">
        <DottedField label="PA No:" value={b?.pa_number || '—'} />
        <DottedField label="Rank:" value={b?.rank || '—'} />
        <DottedField label="Name" value={b?.guest_name} grow />
      </div>
      <div className="flex gap-4">
        <DottedField label="Room No:" value={b?.room_number} />
        <DottedField label="Address" value={b?.unit_address || '—'} grow />
        {b?.reference_person && <DottedField label="C/O" value={b.reference_person} />}
      </div>

      <table className="w-full border-collapse mt-1">
        <thead>
          <tr>
            <th className="border border-gray-500 px-2 py-1 w-10 text-left">Ser</th>
            <th className="border border-gray-500 px-2 py-1 text-left">Details</th>
            <th className="border border-gray-500 px-2 py-1 w-32 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {fixed.map(({ head, item }, i) => (
            <tr key={head}>
              <td className="border border-gray-500 px-2 py-1">{i + 1}</td>
              <td className="border border-gray-500 px-2 py-1">{item ? item.description : head}</td>
              <td className="border border-gray-500 px-2 py-1 text-right font-mono whitespace-nowrap">{item ? formatCurrency(item.total_price) : '—'}</td>
            </tr>
          ))}
          {extra.map((it, i) => (
            <tr key={`x${i}`}>
              <td className="border border-gray-500 px-2 py-1">{fixed.length + i + 1}</td>
              <td className="border border-gray-500 px-2 py-1">{it.description}{it.quantity > 1 ? ` × ${it.quantity}` : ''}</td>
              <td className="border border-gray-500 px-2 py-1 text-right font-mono whitespace-nowrap">{formatCurrency(it.total_price)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2} className="border border-gray-500 px-2 py-1 font-bold text-right">Total</td>
            <td className="border border-gray-500 px-2 py-1 text-right font-bold font-mono whitespace-nowrap">{formatCurrency(inv.total_amount)}</td>
          </tr>
          {alreadyPaid > 0 && (
            <>
              <tr>
                <td colSpan={2} className="border border-gray-500 px-2 py-1 text-right">Less: Amount Paid</td>
                <td className="border border-gray-500 px-2 py-1 text-right font-mono whitespace-nowrap">− {formatCurrency(alreadyPaid)}</td>
              </tr>
              <tr>
                <td colSpan={2} className="border border-gray-500 px-2 py-1 font-bold text-right">Balance {inv.balance_due > 0 ? 'Due' : ''}</td>
                <td className="border border-gray-500 px-2 py-1 text-right font-bold font-mono whitespace-nowrap">{formatCurrency(inv.balance_due)}</td>
              </tr>
            </>
          )}
        </tfoot>
      </table>

      <p className="text-[11px] text-gray-500">
        {b ? `Stay: ${fmtD(b.check_in)} to ${fmtD(b.check_out)} · Ref ${b.booking_reference} · ` : ''}
        Issued {fmtD(inv.issue_date)}
        {data.verify_hash ? ` · Verify: ${data.verify_hash}` : ''}
      </p>

      <div className="grid grid-cols-2 gap-6 pt-6">
        <p className="border-t border-gray-500 pt-1 text-center text-[12px]">GR NCO Sign</p>
        <p className="border-t border-gray-500 pt-1 text-center text-[12px]">Catering NCO Sign</p>
      </div>
      <div className="grid grid-cols-2 gap-6 pt-4">
        <p className="border-t border-gray-500 pt-1 text-center text-[12px]">Mess JCO Sign</p>
        <p className="border-t border-gray-500 pt-1 text-center text-[12px]">Mess Secretary</p>
      </div>
    </div>
  );
}

/** Clerk-side half of the bill-correction workflow: proposes a fix to one
    line on an already-generated invoice (wrong rate/charge entered). The
    request sits pending until a Manager approves/rejects it on the
    Approvals page - this dialog only submits, it never applies the change
    itself. Scoped to one invoice's own items, so it's only offered on a
    single (non-merged) bill view. */
function RequestCorrectionDialog({ items, invoiceNumber, open, onClose, onSubmitted }: {
  items: BillItem[]; invoiceNumber: string; open: boolean; onClose: () => void; onSubmitted: () => void;
}) {
  const [itemId, setItemId] = useState('');
  const [description, setDescription] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Reset happens on every close path (Cancel, backdrop/Esc via
  // onOpenChange, and after a successful submit) rather than in an effect
  // watching `open` - keeps the reset tied to the user action that closes
  // the dialog instead of a render-triggered side effect.
  const close = () => {
    setItemId(''); setDescription(''); setUnitPrice(''); setReason('');
    onClose();
  };

  const selected = items.find(i => String(i.id) === itemId);

  const pickItem = (id: string) => {
    setItemId(id);
    const it = items.find(i => String(i.id) === id);
    if (it) { setDescription(it.description); setUnitPrice(String(it.unit_price)); }
  };

  const submit = async () => {
    if (!selected || !description.trim() || !unitPrice || !reason.trim()) {
      toast.error('Select the line, the corrected amount, and a reason');
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/billing/invoice-items/${selected.id}/edit-request`, {
        proposed_description: description.trim(), proposed_unit_price: Number(unitPrice), reason: reason.trim(),
      });
      toast.success('Correction request sent for Manager approval');
      onSubmitted();
      close();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to submit correction request')); }
    finally { setSubmitting(false); }
  };

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) close(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Request Bill Correction — {invoiceNumber}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Line item</Label>
            <Select value={itemId} onValueChange={pickItem}>
              <SelectTrigger><SelectValue placeholder="Select the line to correct" /></SelectTrigger>
              <SelectContent>
                {items.map(it => (
                  <SelectItem key={it.id} value={String(it.id)}>{it.description} — {formatCurrency(it.unit_price)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selected && (
            <>
              <div className="space-y-1.5">
                <Label>Corrected description</Label>
                <Input value={description} onChange={e => setDescription(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Corrected amount (Rs)</Label>
                <Input type="number" min="0" step="0.01" value={unitPrice} onChange={e => setUnitPrice(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Reason for correction</Label>
                <Textarea rows={2} value={reason} onChange={e => setReason(e.target.value)}
                  placeholder="e.g. Wrong room rate entered at checkout" />
              </div>
            </>
          )}
        </div>
        <div className="flex gap-2 pt-2">
          <Button className="flex-1" disabled={!selected || submitting} onClick={submit}>Submit for Approval</Button>
          <Button variant="ghost" onClick={close}>Cancel</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface BillPrintViewProps {
  invoiceIds: number[] | null;
  onClose: () => void;
  /** Show "Pay Together" / per-bill payment actions for unpaid bills. */
  allowPayments?: boolean;
  onPaymentsChanged?: () => void;
  /** Enables the whole-stay discount action (Clerk-only, applies to every
      live invoice for this booking at once) and, when the booking has more
      than one live invoice, the row-merged single document. */
  bookingId?: number;
}

const PAYMENT_METHODS = ['Cash', 'Bank Transfer', 'Cheque', 'Online'];

type ViewMode = 'room' | 'mess' | 'combined';

export function BillPrintView({ invoiceIds, onClose, allowPayments = false, onPaymentsChanged, bookingId }: BillPrintViewProps) {
  const [bills, setBills] = useState<PrintData[]>([]);
  const [masterData, setMasterData] = useState<MasterInvoiceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  const [method, setMethod] = useState(PAYMENT_METHODS[0]);
  const [applyingDiscount, setApplyingDiscount] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('combined');
  const [pendingCorrectionItemIds, setPendingCorrectionItemIds] = useState<Set<number>>(new Set());
  const [correctionOpen, setCorrectionOpen] = useState(false);

  const fetchBills = (ids: number[]) =>
    Promise.all(ids.map(id => api.get(`/billing/invoices/${id}/print-data`).then(r => r.data as PrintData)))
      .then(setBills)
      .catch(err => toast.error(getErrorMessage(err, 'Failed to load bill')));

  // When a stay has both a room and a mess invoice, the Clerk gets three
  // views over them - Room only, Mess only (each keeps its own detailed
  // rows), and Combined (the master-invoice's row-merged, source-tagged
  // list) - never two separate paper forms stacked in the same dialog.
  const refresh = async (ids: number[]) => {
    await fetchBills(ids);
    if (ids.length > 1 && bookingId) {
      try {
        const res = await api.get(`/billing/bookings/${bookingId}/master-invoice`);
        setMasterData(res.data as MasterInvoiceData);
      } catch (err) { toast.error(getErrorMessage(err, 'Failed to load master invoice')); }
    } else {
      setMasterData(null);
    }
    if (allowPayments) {
      // Best-effort: surfaces "correction pending" so a Clerk doesn't submit
      // a duplicate request for the same line while one is already queued.
      try {
        const er = await api.get('/billing/edit-requests?status=pending');
        setPendingCorrectionItemIds(new Set((er.data as { invoice_item_id: number }[]).map(r => r.invoice_item_id)));
      } catch { /* non-critical - the Request Correction button just won't show the pending state */ }
    }
  };

  useEffect(() => {
    queueMicrotask(() => {
      if (!invoiceIds || invoiceIds.length === 0) { setBills([]); setMasterData(null); return; }
      setLoading(true);
      setViewMode('combined');
      refresh(invoiceIds).finally(() => setLoading(false));
    });
  }, [invoiceIds, bookingId]);

  const roomBill = bills.find(b => b.invoice.bill_type === 'room');
  const messBill = bills.find(b => b.invoice.bill_type === 'mess');
  const hasBothSides = !!roomBill && !!messBill;
  // The single invoice a line-item correction would target - undefined on
  // the merged Combined view, since a correction always belongs to one
  // invoice's own item, never a cross-invoice merged row.
  const activeBill = hasBothSides ? (viewMode === 'room' ? roomBill : viewMode === 'mess' ? messBill : undefined) : bills[0];
  const activeBillHasPendingCorrection = !!activeBill?.invoice.items.some(it => pendingCorrectionItemIds.has(it.id));

  const unpaid = bills.filter(b => b.invoice.balance_due > 0.005 && b.invoice.status !== 'void');
  const unpaidTotal = unpaid.reduce((s, b) => s + b.invoice.balance_due, 0);
  // Discount only makes sense before anything's been paid against the bill.
  const discountEligible = bills.filter(b => b.invoice.amount_paid < 0.005 && b.invoice.status !== 'void' && b.invoice.status !== 'paid');

  // The one discount action for the final bill - whole-stay so it works
  // whether the booking has one combined invoice or a room + mess pair; a
  // 100% discount is what "complimentary" looks like, no separate action.
  const applyDiscount = async () => {
    if (!bookingId) return;
    const rateStr = prompt('Discount % on the final bill (leave blank to enter a flat Rs amount instead):');
    if (rateStr === null) return;
    let discount_rate: number | undefined; let discount_amount: number | undefined;
    if (rateStr.trim()) { discount_rate = Number(rateStr); }
    else {
      const amtStr = prompt('Flat discount amount (Rs), split proportionally across the room and mess bills:');
      if (!amtStr) return;
      discount_amount = Number(amtStr);
    }
    const reason = prompt('Reason for this discount:');
    if (!reason) return;
    setApplyingDiscount(true);
    try {
      await api.post(`/billing/bookings/${bookingId}/master-invoice/discount`, { discount_rate, discount_amount, reason });
      toast.success('Discount applied');
      if (invoiceIds) await refresh(invoiceIds);
      onPaymentsChanged?.();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to apply discount')); }
    finally { setApplyingDiscount(false); }
  };

  const payInvoices = async (targets: PrintData[]) => {
    setPaying(true);
    try {
      for (const b of targets) {
        await api.post(`/billing/invoices/${b.invoice.id}/payments`, { amount: b.invoice.balance_due, method });
      }
      toast.success(targets.length > 1
        ? `Both bills settled together — ${formatCurrency(targets.reduce((s, b) => s + b.invoice.balance_due, 0))} by ${method}`
        : `${BILL_LABELS[targets[0].invoice.bill_type] || 'Bill'} settled — ${formatCurrency(targets[0].invoice.balance_due)} by ${method}`);
      if (invoiceIds) await refresh(invoiceIds);
      onPaymentsChanged?.();
    } catch (err) { toast.error(getErrorMessage(err, 'Payment failed')); }
    finally { setPaying(false); }
  };

  if (!invoiceIds) return null;
  const titles: Record<ViewMode, string> = { room: 'Room Bill', mess: 'Mess / Food Bill', combined: 'Master Invoice (Room + Mess Combined)' };
  const printLabels: Record<ViewMode, string> = { room: 'Room Bill', mess: 'Mess Bill', combined: 'Master Invoice' };
  return (
    <Fragment>
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <style>{PRINT_STYLE}</style>
        <DialogHeader>
          <DialogTitle>{hasBothSides ? titles[viewMode] : 'Bill'}</DialogTitle>
        </DialogHeader>
        {loading && <p className="text-sm text-gray-500">Loading bill…</p>}
        {/* Three views over the same stay: Room-only and Mess-only keep
            each invoice's own detailed rows; Combined row-merges both via
            the master-invoice endpoint. Only shown when both exist. */}
        {hasBothSides && (
          <Tabs value={viewMode} onValueChange={v => setViewMode(v as ViewMode)}>
            <TabsList>
              <TabsTrigger value="room">Room</TabsTrigger>
              <TabsTrigger value="mess">Mess</TabsTrigger>
              <TabsTrigger value="combined">Combined</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
        <PrintArea>
          {hasBothSides
            ? viewMode === 'combined'
              ? (masterData ? <MergedBill data={masterData} /> : <p className="text-sm text-gray-500">Loading…</p>)
              : <DraftBill data={(viewMode === 'room' ? roomBill : messBill) as PrintData} />
            : bills.map(bd => <DraftBill key={bd.invoice.id} data={bd} />)}
        </PrintArea>

        {allowPayments && bookingId && discountEligible.filter(b => !b.invoice.is_complimentary).length > 0 && (
          <div className="rounded-lg border p-3 space-y-2">
            <p className="text-sm font-medium">Discount</p>
            <Button size="sm" variant="outline" disabled={applyingDiscount} onClick={applyDiscount}>
              Apply Discount
            </Button>
          </div>
        )}

        {/* Corrects a wrong line already on the bill (bad rate/charge
            entered) - distinct from a discount, and gated by Manager
            approval since it's editing what was actually charged. Only
            offered on a single invoice's own view, never the merged one. */}
        {allowPayments && activeBill && activeBill.invoice.status !== 'void' && (
          <div className="rounded-lg border p-3 space-y-2">
            <p className="text-sm font-medium">Line Item Correction</p>
            {activeBillHasPendingCorrection ? (
              <p className="text-xs text-amber-600">A correction on this bill is pending Manager approval</p>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setCorrectionOpen(true)}>
                <FileEdit size={14} className="mr-1" /> Request Correction
              </Button>
            )}
          </div>
        )}

        {allowPayments && unpaid.length > 0 && (
          <div className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Settle payment</p>
              <select className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={method} onChange={e => setMethod(e.target.value)}>
                {PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div className="flex flex-wrap gap-2">
              {unpaid.length > 1 && (
                <Button size="sm" disabled={paying} onClick={() => payInvoices(unpaid)}>
                  Pay Together — {formatCurrency(unpaidTotal)}
                </Button>
              )}
              {unpaid.map(b => (
                <Button key={b.invoice.id} size="sm" variant={unpaid.length > 1 ? 'outline' : 'default'} disabled={paying}
                  onClick={() => payInvoices([b])}>
                  Pay {BILL_LABELS[b.invoice.bill_type] || 'Bill'} — {formatCurrency(b.invoice.balance_due)}
                </Button>
              ))}
            </div>
            {unpaid.length > 1 && <p className="text-[11px] text-gray-500">"Pay Together" settles both bills in one action; the individual buttons clear each bill separately.</p>}
          </div>
        )}
        {allowPayments && !loading && bills.length > 0 && unpaid.length === 0 && (
          <p className="text-sm text-emerald-600 font-medium">All bills settled ✓</p>
        )}

        <div className="flex gap-2 pt-2">
          <Button onClick={() => window.print()} className="flex-1" disabled={loading || bills.length === 0}>
            <Printer size={16} className="mr-1" /> Print {hasBothSides ? printLabels[viewMode] : 'Invoice'}
          </Button>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
    {activeBill && (
      <RequestCorrectionDialog items={activeBill.invoice.items} invoiceNumber={activeBill.invoice.invoice_number}
        open={correctionOpen} onClose={() => setCorrectionOpen(false)}
        onSubmitted={() => { if (invoiceIds) refresh(invoiceIds); }} />
    )}
    </Fragment>
  );
}

interface MasterInvoiceItem { source: string; source_label: string; description: string; quantity: number; unit_price: number; total_price: number; }
interface MasterInvoiceData {
  booking: BillBooking; source_invoices: { id: number; invoice_number: string; bill_type: string }[];
  items: MasterInvoiceItem[]; subtotal: number; tax_amount: number; discount: number;
  total_amount: number; amount_paid: number; balance_due: number; is_complimentary: boolean;
  mess: MessIdentity; qr_svg: string; verify_hash: string;
}

/** One combined document merging a stay's separately generated room + mess
    invoices into a single bill with a row-level, source-tagged item list
    and one grand total - the "final bill" a Clerk settles/prints, never
    two separate paper forms for the same stay. */
function MergedBill({ data }: { data: MasterInvoiceData }) {
  return (
    <div className="bill-page border border-gray-400 rounded-sm p-4 text-[13px] text-gray-900 bg-white space-y-2.5">
      <div className="flex justify-between items-start">
        <div className="flex-1">
          <p className="text-[11px] text-gray-600">{data.mess.name} · {data.mess.address} · {data.mess.phone}</p>
          <p className="text-center font-bold underline decoration-2 text-sm mt-1">MASTER INVOICE (Room + Mess Combined)</p>
          {data.is_complimentary && <p className="text-center font-bold text-emerald-700 text-xs mt-0.5">★ COMPLIMENTARY — NO CHARGE ★</p>}
        </div>
        <div className="w-16 h-16 shrink-0 ml-2 [&>svg]:w-full [&>svg]:h-full" dangerouslySetInnerHTML={{ __html: data.qr_svg }} />
      </div>

      <div className="flex gap-4">
        <DottedField label="Rank:" value={data.booking.rank || '—'} />
        <DottedField label="Name" value={data.booking.guest_name} grow />
      </div>
      <div className="flex gap-4">
        <DottedField label="Room No:" value={data.booking.room_number} />
        <DottedField label="Combines" value={data.source_invoices.map(i => i.invoice_number).join(' + ')} grow />
      </div>

      <table className="w-full border-collapse mt-1">
        <thead>
          <tr>
            <th className="border border-gray-500 px-2 py-1 w-10 text-left">Ser</th>
            <th className="border border-gray-500 px-2 py-1 text-left">Details</th>
            <th className="border border-gray-500 px-2 py-1 w-20 text-left">Bill</th>
            <th className="border border-gray-500 px-2 py-1 w-32 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((it, i) => (
            <tr key={i}>
              <td className="border border-gray-500 px-2 py-1">{i + 1}</td>
              <td className="border border-gray-500 px-2 py-1">{it.description}{it.quantity > 1 ? ` × ${it.quantity}` : ''}</td>
              <td className="border border-gray-500 px-2 py-1 text-[11px] text-gray-500">{it.source_label}</td>
              <td className="border border-gray-500 px-2 py-1 text-right font-mono whitespace-nowrap">{formatCurrency(it.total_price)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3} className="border border-gray-500 px-2 py-1 font-bold text-right">Grand Total</td>
            <td className="border border-gray-500 px-2 py-1 text-right font-bold font-mono whitespace-nowrap">{formatCurrency(data.total_amount)}</td>
          </tr>
          {data.amount_paid > 0 && (
            <>
              <tr>
                <td colSpan={3} className="border border-gray-500 px-2 py-1 text-right">Less: Amount Paid</td>
                <td className="border border-gray-500 px-2 py-1 text-right font-mono whitespace-nowrap">− {formatCurrency(data.amount_paid)}</td>
              </tr>
              <tr>
                <td colSpan={3} className="border border-gray-500 px-2 py-1 font-bold text-right">Balance Due</td>
                <td className="border border-gray-500 px-2 py-1 text-right font-bold font-mono whitespace-nowrap">{formatCurrency(data.balance_due)}</td>
              </tr>
            </>
          )}
        </tfoot>
      </table>

      <p className="text-[11px] text-gray-500">
        Ref {data.booking.booking_reference} · Verify: {data.verify_hash}
      </p>

      <div className="grid grid-cols-2 gap-6 pt-6">
        <p className="border-t border-gray-500 pt-1 text-center text-[12px]">GR NCO Sign</p>
        <p className="border-t border-gray-500 pt-1 text-center text-[12px]">Catering NCO Sign</p>
      </div>
      <div className="grid grid-cols-2 gap-6 pt-4">
        <p className="border-t border-gray-500 pt-1 text-center text-[12px]">Mess JCO Sign</p>
        <p className="border-t border-gray-500 pt-1 text-center text-[12px]">Mess Secretary</p>
      </div>
    </div>
  );
}

interface ReceiptData {
  receipt_no: number; date: string; received_from: string; amount: number; method: string;
  on_account_of: string | null; invoice_number: string | null; room_number: string | null;
  mess: MessIdentity; qr_svg: string;
}

export function PaymentReceiptView({ paymentId, onClose }: { paymentId: number | null; onClose: () => void }) {
  const [data, setData] = useState<ReceiptData | null>(null);

  useEffect(() => {
    queueMicrotask(() => {
      if (!paymentId) { setData(null); return; }
      api.get(`/billing/payments/${paymentId}/receipt-data`)
        .then(r => setData(r.data))
        .catch(err => toast.error(getErrorMessage(err, 'Failed to load receipt')));
    });
  }, [paymentId]);

  if (!paymentId) return null;
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <style>{PRINT_STYLE}</style>
        <DialogHeader><DialogTitle>Payment Receipt</DialogTitle></DialogHeader>
        {data && (
          <PrintArea>
            <div className="bill-page border border-gray-400 rounded-sm p-5 text-[13px] text-gray-900 bg-white space-y-3">
              <p className="text-right text-[11px] text-gray-600">{data.mess.phone}</p>
              <div className="text-center">
                <p className="font-bold text-lg tracking-wide uppercase">{data.mess.name}</p>
                <p className="text-[11px] text-gray-600">{data.mess.address}</p>
              </div>
              <div className="flex justify-between items-end gap-4">
                <DottedField label="No." value={data.receipt_no} />
                <div className="w-14 h-14 shrink-0 [&>svg]:w-full [&>svg]:h-full" dangerouslySetInnerHTML={{ __html: data.qr_svg }} />
                <DottedField label="Date" value={fmtD(data.date)} />
              </div>
              <div className="space-y-2.5 pt-1">
                <div className="flex"><DottedField label="Received from" value={data.received_from} grow /></div>
                <div className="flex"><DottedField label="the sum of Rupees" value={`${rupeesInWords(data.amount)} only`} grow /></div>
                <div className="flex"><DottedField label="on account of" value={data.on_account_of || 'Mess Bill'} grow /></div>
                <div className="flex"><DottedField label="by Cash / Cheque No." value={data.method} grow /></div>
              </div>
              <div className="flex justify-between items-end pt-6">
                <p className="font-bold text-base">Rs. <span className="border-b border-gray-500 px-2 font-mono">{data.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></p>
                <div className="text-right">
                  <p className="text-[12px] font-semibold">For {data.mess.name}</p>
                  <p className="border-t border-gray-500 mt-8 pt-1 text-[12px] text-center">Mess Secretary</p>
                </div>
              </div>
            </div>
          </PrintArea>
        )}
        <div className="flex gap-2 pt-2">
          <Button onClick={() => window.print()} className="flex-1" disabled={!data}><Printer size={16} className="mr-1" /> Print Receipt</Button>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
