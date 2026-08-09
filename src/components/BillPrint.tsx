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
import { Printer, FileEdit, ClipboardEdit } from 'lucide-react';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/currency';
import { MasterBillView } from '@/components/MasterBillView';

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
  bill_serial_number?: string | null;
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

export function rupeesInWords(n: number): string {
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
export const PRINT_STYLE = `
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
export function PrintArea({ children }: { children: ReactNode }) {
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

export function DottedField({ label, value, grow }: { label: string; value?: string | number | null; grow?: boolean }) {
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
    <div className="bill-page border border-gray-400 rounded-sm p-4 text-[13px] text-foreground bg-white space-y-2.5">
      <div className="flex justify-between items-start">
        <div className="flex-1">
          <p className="text-[11px] text-muted-foreground">{data.mess.name} · {data.mess.address} · {data.mess.phone}</p>
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

      <p className="text-[11px] text-muted-foreground">
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
const HEAD_PREFIX = 'head:';

function RequestCorrectionDialog({ invoiceId, items, invoiceNumber, open, onClose, onSubmitted }: {
  invoiceId: number; items: BillItem[]; invoiceNumber: string; open: boolean; onClose: () => void; onSubmitted: () => void;
}) {
  const [itemId, setItemId] = useState('');
  const [description, setDescription] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Fixed paper-form heads not yet charged on this bill (rendered as "—" in
  // DraftBill, same matching rule as paperRows()) - offered alongside real
  // items so a correction can add a charge under one of these, not just
  // fix an existing line.
  const unmatchedHeads = PAPER_BILL_HEADS.filter(
    head => !items.some(it => it.description.toLowerCase().startsWith(head.toLowerCase())),
  );

  // Reset happens on every close path (Cancel, backdrop/Esc via
  // onOpenChange, and after a successful submit) rather than in an effect
  // watching `open` - keeps the reset tied to the user action that closes
  // the dialog instead of a render-triggered side effect.
  const close = () => {
    setItemId(''); setDescription(''); setUnitPrice(''); setReason('');
    onClose();
  };

  const isHead = itemId.startsWith(HEAD_PREFIX);
  const selectedItem = !isHead ? items.find(i => String(i.id) === itemId) : undefined;
  const selectedHead = isHead ? itemId.slice(HEAD_PREFIX.length) : undefined;
  const hasSelection = !!selectedItem || !!selectedHead;

  const pick = (id: string) => {
    setItemId(id);
    if (id.startsWith(HEAD_PREFIX)) {
      setDescription(id.slice(HEAD_PREFIX.length));
      setUnitPrice('');
      return;
    }
    const it = items.find(i => String(i.id) === id);
    if (it) { setDescription(it.description); setUnitPrice(String(it.unit_price)); }
  };

  const submit = async () => {
    if (!hasSelection || !description.trim() || !unitPrice || !reason.trim()) {
      toast.error('Select the line, the amount, and a reason');
      return;
    }
    setSubmitting(true);
    try {
      const payload = { proposed_description: description.trim(), proposed_unit_price: Number(unitPrice), reason: reason.trim() };
      if (selectedItem) {
        await api.post(`/billing/invoice-items/${selectedItem.id}/edit-request`, payload);
      } else {
        await api.post(`/billing/invoices/${invoiceId}/edit-request`, payload);
      }
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
            <Select value={itemId} onValueChange={pick}>
              <SelectTrigger><SelectValue placeholder="Select the line to correct, or a head to charge" /></SelectTrigger>
              <SelectContent>
                {items.map(it => (
                  <SelectItem key={it.id} value={String(it.id)}>{it.description} — {formatCurrency(it.unit_price)}</SelectItem>
                ))}
                {unmatchedHeads.map(head => (
                  <SelectItem key={head} value={`${HEAD_PREFIX}${head}`}>{head} — not yet charged</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {hasSelection && (
            <>
              <div className="space-y-1.5">
                <Label>{selectedHead ? 'Description' : 'Corrected description'}</Label>
                <Input value={description} onChange={e => setDescription(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{selectedHead ? 'Amount (Rs)' : 'Corrected amount (Rs)'}</Label>
                <Input type="number" min="0" step="0.01" value={unitPrice} onChange={e => setUnitPrice(e.target.value.replace(/^0+(?=\d)/, ''))} />
              </div>
              <div className="space-y-1.5">
                <Label>Reason</Label>
                <Textarea rows={2} value={reason} onChange={e => setReason(e.target.value)}
                  placeholder={selectedHead ? 'e.g. Dhobi charge missed at checkout' : 'e.g. Wrong room rate entered at checkout'} />
              </div>
            </>
          )}
        </div>
        <div className="flex gap-2 pt-2">
          <Button className="flex-1" disabled={!hasSelection || submitting} onClick={submit}>Submit for Approval</Button>
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
  /** Enables the Room / Mess / Combined view over the whole stay (not just
      the invoices passed in `invoiceIds`) - always shown once set, even
      when one side has no invoice at all (rendered as a zero bill). */
  bookingId?: number;
}

const PAYMENT_METHODS = ['Online/AG Branch', 'Bank Transfer', 'Cash Deposit'];

type ViewMode = 'room' | 'mess' | 'combined';

/** A side (room or mess) with no invoice at all for this stay - rendered as
    a Rs 0 bill rather than hiding the tab, so Room/Mess/Combined are always
    all three present once bookingId is set. */
function zeroBill(billType: 'room' | 'mess', master: MasterInvoiceData): PrintData {
  return {
    invoice: {
      id: 0, invoice_number: '—', bill_type: billType, issue_date: new Date().toISOString().slice(0, 10),
      subtotal: 0, total_amount: 0, amount_paid: 0, balance_due: 0, status: 'draft', items: [],
    },
    booking: master.booking,
    mess: master.mess,
    qr_svg: '',
  };
}

export function BillPrintView({ invoiceIds, onClose, allowPayments = false, onPaymentsChanged, bookingId }: BillPrintViewProps) {
  const [bills, setBills] = useState<PrintData[]>([]);
  // Other live invoices for this same booking that aren't in `invoiceIds`
  // (e.g. one side was already settled separately) - fetched for display
  // only, never touched by the payment/correction actions below, which stay
  // scoped to `bills`.
  const [extraBills, setExtraBills] = useState<PrintData[]>([]);
  const [masterData, setMasterData] = useState<MasterInvoiceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  const [method, setMethod] = useState(PAYMENT_METHODS[0]);
  const [voucherNumber, setVoucherNumber] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('combined');
  const [pendingCorrectionItemIds, setPendingCorrectionItemIds] = useState<Set<number>>(new Set());
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [serialInput, setSerialInput] = useState('');
  // Same Interactive Table members already get on Mess Billing/Clerk Desk
  // Members (MasterBillView, source="invoice" here) - freely editable line
  // items + ad-hoc heads + payment recording while bill_made_at is unset,
  // locking only once "Make Bill" is clicked. Request Correction (below)
  // stays for AFTER that lock - the backend already drew this line the same
  // way for both invoices and mess bills, this view just never opened the
  // pre-lock table for guest invoices before.
  const [masterBillOpen, setMasterBillOpen] = useState(false);
  // One cash receipt per settled invoice (Room and Mess are separate ledger
  // entries even when "Pay Together" settles both in one click) - shown one
  // at a time, same pattern as Billing.tsx offering the receipt right after
  // recording a payment there.
  const [receiptQueue, setReceiptQueue] = useState<number[]>([]);

  const fetchBills = (ids: number[]) =>
    Promise.all(ids.map(id => api.get(`/billing/invoices/${id}/print-data`).then(r => r.data as PrintData)))
      .then(setBills)
      .catch(err => toast.error(getErrorMessage(err, 'Failed to load bill')));

  // Whenever bookingId is known, the Clerk always gets three views over the
  // whole stay - Room only, Mess only (each keeps its own detailed rows),
  // and Combined (the master-invoice's row-merged, fixed-head list) - never
  // two separate paper forms stacked in the same dialog, and never hidden
  // just because one side happens to have no charge.
  const refresh = async (ids: number[]) => {
    await fetchBills(ids);
    let extra: PrintData[] = [];
    if (bookingId) {
      try {
        const res = await api.get(`/billing/bookings/${bookingId}/master-invoice`);
        const master = res.data as MasterInvoiceData;
        setMasterData(master);
        const missingIds = master.source_invoices.map(si => si.id).filter(id => !ids.includes(id));
        if (missingIds.length) {
          extra = await Promise.all(missingIds.map(id => api.get(`/billing/invoices/${id}/print-data`).then(r => r.data as PrintData)));
        }
      } catch (err) { setMasterData(null); toast.error(getErrorMessage(err, 'Failed to load master invoice')); }
    } else {
      setMasterData(null);
    }
    setExtraBills(extra);
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
      if (!invoiceIds || invoiceIds.length === 0) { setBills([]); setExtraBills([]); setMasterData(null); return; }
      setLoading(true);
      setViewMode('combined');
      refresh(invoiceIds).finally(() => setLoading(false));
    });
  }, [invoiceIds, bookingId]);

  const showTabs = !!bookingId;
  const displayBills = [...bills, ...extraBills];
  const roomBill = displayBills.find(b => b.invoice.bill_type === 'room') ?? (showTabs && masterData ? zeroBill('room', masterData) : undefined);
  const messBill = displayBills.find(b => b.invoice.bill_type === 'mess') ?? (showTabs && masterData ? zeroBill('mess', masterData) : undefined);
  // The single invoice a line-item correction would target - undefined on
  // the merged Combined view (a correction always belongs to one invoice's
  // own item, never a cross-invoice merged row) and on a synthesized zero
  // bill (invoice.id 0 - nothing real to attach a correction to).
  const activeBill = showTabs ? (viewMode === 'room' ? roomBill : viewMode === 'mess' ? messBill : undefined) : bills[0];
  const activeBillHasPendingCorrection = !!activeBill?.invoice.items.some(it => pendingCorrectionItemIds.has(it.id));

  useEffect(() => {
    setSerialInput(activeBill?.invoice.bill_serial_number || '');
  }, [activeBill?.invoice.id]);

  const saveSerialNumber = async () => {
    if (!activeBill || activeBill.invoice.id <= 0) return;
    const trimmed = serialInput.trim();
    if (trimmed === (activeBill.invoice.bill_serial_number || '')) return;
    try {
      await api.put(`/billing/invoices/${activeBill.invoice.id}/serial-number`, { bill_serial_number: trimmed });
      activeBill.invoice.bill_serial_number = trimmed || null;
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to save bill serial number')); }
  };

  const unpaid = bills.filter(b => b.invoice.balance_due > 0.005 && b.invoice.status !== 'void');
  const unpaidTotal = unpaid.reduce((s, b) => s + b.invoice.balance_due, 0);

  const payInvoices = async (targets: PrintData[]) => {
    if (method === 'Online/AG Branch' && !voucherNumber.trim()) { toast.error('Voucher Number is required for Online/AG Branch payments'); return; }
    setPaying(true);
    try {
      const paymentIds: number[] = [];
      for (const b of targets) {
        const res = await api.post(`/billing/invoices/${b.invoice.id}/payments`, { amount: b.invoice.balance_due, method, voucher_number: voucherNumber.trim() || undefined });
        paymentIds.push(res.data.id);
      }
      toast.success(targets.length > 1
        ? `Both bills settled together — ${formatCurrency(targets.reduce((s, b) => s + b.invoice.balance_due, 0))} by ${method}`
        : `${BILL_LABELS[targets[0].invoice.bill_type] || 'Bill'} settled — ${formatCurrency(targets[0].invoice.balance_due)} by ${method}`);
      setReceiptQueue(paymentIds);
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
          <div className="flex items-start justify-between gap-3 pr-6">
            <DialogTitle>{showTabs ? titles[viewMode] : 'Bill'}</DialogTitle>
            {allowPayments && activeBill && activeBill.invoice.id > 0 && (
              <div className="flex flex-col items-end gap-1 print:hidden">
                <Label htmlFor="bill-serial-number" className="text-[11px] text-muted-foreground font-normal">Bill Serial No.</Label>
                <Input id="bill-serial-number" className="h-8 w-32 text-sm" value={serialInput}
                  onChange={e => setSerialInput(e.target.value)} onBlur={saveSerialNumber} placeholder="e.g. 1045" />
              </div>
            )}
          </div>
        </DialogHeader>
        {loading && <p className="text-sm text-muted-foreground">Loading bill…</p>}
        {/* Three views over the same stay: Room-only and Mess-only keep
            each invoice's own detailed rows; Combined row-merges both via
            the master-invoice endpoint. Always shown once bookingId is
            known, even when a side has no invoice (rendered as Rs 0). */}
        {showTabs && (
          <Tabs value={viewMode} onValueChange={v => setViewMode(v as ViewMode)}>
            <TabsList>
              <TabsTrigger value="room">Room</TabsTrigger>
              <TabsTrigger value="mess">Mess</TabsTrigger>
              <TabsTrigger value="combined">Combined</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
        <PrintArea>
          {showTabs
            ? viewMode === 'combined'
              ? (masterData ? <MergedBill data={masterData} /> : <p className="text-sm text-muted-foreground">Loading…</p>)
              : ((viewMode === 'room' ? roomBill : messBill)
                  ? <DraftBill data={(viewMode === 'room' ? roomBill : messBill) as PrintData} />
                  : <p className="text-sm text-muted-foreground">Loading…</p>)
            : bills.map(bd => <DraftBill key={bd.invoice.id} data={bd} />)}
        </PrintArea>

        {/* Corrects a wrong line already on the bill, or adds a charge under
            a head that's currently zero (wrong rate entered, or a charge
            that was simply missed) - gated by Manager approval since it's
            editing what was actually charged. Only offered on a single real
            invoice's own view, never the merged one or a synthesized zero
            bill with nothing to attach a correction to. */}
        {allowPayments && activeBill && activeBill.invoice.id > 0 && activeBill.invoice.status !== 'void' && (
          <div className="rounded-lg border p-3 space-y-2">
            <p className="text-sm font-medium">Line Item Correction</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setMasterBillOpen(true)}>
                <ClipboardEdit size={14} className="mr-1" /> Master Bill / Interactive Table
              </Button>
              {activeBillHasPendingCorrection ? (
                <p className="text-xs text-amber-600 self-center">A correction on this bill is pending Manager approval</p>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setCorrectionOpen(true)}>
                  <FileEdit size={14} className="mr-1" /> Request Correction
                </Button>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Freely edit line items, add charges, or record payment in the Interactive Table until "Make Bill" locks it - Request Correction is for after that lock.
            </p>
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
            {(method === 'Online/AG Branch' || method === 'Bank Transfer') && (
              <Input placeholder={method === 'Online/AG Branch' ? 'Voucher Number (required)' : 'Voucher Number (optional)'} className="h-8 text-xs" value={voucherNumber} onChange={e => setVoucherNumber(e.target.value)} />
            )}
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
            {unpaid.length > 1 && <p className="text-[11px] text-muted-foreground">"Pay Together" settles both bills in one action; the individual buttons clear each bill separately.</p>}
          </div>
        )}
        {allowPayments && !loading && bills.length > 0 && unpaid.length === 0 && (
          <p className="text-sm text-emerald-600 font-medium">All bills settled ✓</p>
        )}

        <div className="flex gap-2 pt-2">
          <Button onClick={() => window.print()} className="flex-1" disabled={loading || (!showTabs && bills.length === 0)}>
            <Printer size={16} className="mr-1" /> Print {showTabs ? printLabels[viewMode] : 'Invoice'}
          </Button>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
    {activeBill && activeBill.invoice.id > 0 && (
      <RequestCorrectionDialog invoiceId={activeBill.invoice.id} items={activeBill.invoice.items} invoiceNumber={activeBill.invoice.invoice_number}
        open={correctionOpen} onClose={() => setCorrectionOpen(false)}
        onSubmitted={() => { if (invoiceIds) refresh(invoiceIds); }} />
    )}
    {masterBillOpen && activeBill && activeBill.invoice.id > 0 && (
      <MasterBillView source="invoice" sourceId={activeBill.invoice.id}
        onClose={() => { setMasterBillOpen(false); if (invoiceIds) refresh(invoiceIds); }} />
    )}
    <PaymentReceiptView paymentId={receiptQueue[0] ?? null} onClose={() => setReceiptQueue(q => q.slice(1))} />
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

/** Same fixed-Ser-head matching as paperRows(), but over the master
    invoice's merged room+mess item list - the Combined bill's row set is
    the union of the room bill's heads and the mess bill's heads, so a head
    that's zero on both still gets its own "—" row instead of the whole
    line silently disappearing from the final printed document. */
function masterPaperRows(items: MasterInvoiceItem[]) {
  const remaining = [...items];
  const takeMatch = (head: string) => {
    const idx = remaining.findIndex(it => it.description.toLowerCase().startsWith(head.toLowerCase()));
    return idx === -1 ? null : remaining.splice(idx, 1)[0];
  };
  const fixed = PAPER_BILL_HEADS.map(head => ({ head, item: takeMatch(head) }));
  return { fixed, extra: remaining };
}

/** One combined document merging a stay's separately generated room + mess
    invoices into a single bill with a row-level, source-tagged item list
    and one grand total - the "final bill" a Clerk settles/prints, never
    two separate paper forms for the same stay. */
function MergedBill({ data }: { data: MasterInvoiceData }) {
  const { fixed, extra } = masterPaperRows(data.items);
  return (
    <div className="bill-page border border-gray-400 rounded-sm p-4 text-[13px] text-foreground bg-white space-y-2.5">
      <div className="flex justify-between items-start">
        <div className="flex-1">
          <p className="text-[11px] text-muted-foreground">{data.mess.name} · {data.mess.address} · {data.mess.phone}</p>
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
          {fixed.map(({ head, item }, i) => (
            <tr key={head}>
              <td className="border border-gray-500 px-2 py-1">{i + 1}</td>
              <td className="border border-gray-500 px-2 py-1">{item ? item.description : head}</td>
              <td className="border border-gray-500 px-2 py-1 text-[11px] text-muted-foreground">{item ? item.source_label : '—'}</td>
              <td className="border border-gray-500 px-2 py-1 text-right font-mono whitespace-nowrap">{item ? formatCurrency(item.total_price) : '—'}</td>
            </tr>
          ))}
          {extra.map((it, i) => (
            <tr key={`x${i}`}>
              <td className="border border-gray-500 px-2 py-1">{fixed.length + i + 1}</td>
              <td className="border border-gray-500 px-2 py-1">{it.description}{it.quantity > 1 ? ` × ${it.quantity}` : ''}</td>
              <td className="border border-gray-500 px-2 py-1 text-[11px] text-muted-foreground">{it.source_label}</td>
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

      <p className="text-[11px] text-muted-foreground">
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

export function PaymentReceiptView({ paymentId, onClose, kind = 'invoice' }: { paymentId: number | null; onClose: () => void; kind?: 'invoice' | 'mess_bill' }) {
  const [data, setData] = useState<ReceiptData | null>(null);

  useEffect(() => {
    queueMicrotask(() => {
      if (!paymentId) { setData(null); return; }
      const path = kind === 'mess_bill' ? `/mess-billing/payments/${paymentId}/receipt-data` : `/billing/payments/${paymentId}/receipt-data`;
      api.get(path)
        .then(r => setData(r.data))
        .catch(err => toast.error(getErrorMessage(err, 'Failed to load receipt')));
    });
  }, [paymentId, kind]);

  if (!paymentId) return null;
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <style>{PRINT_STYLE}</style>
        <DialogHeader><DialogTitle>Payment Receipt</DialogTitle></DialogHeader>
        {data && (
          <PrintArea>
            <div className="bill-page border border-gray-400 rounded-sm p-5 text-[13px] text-foreground bg-white space-y-3">
              <div className="flex justify-between items-start gap-4">
                <p className="font-bold text-base border border-gray-500 rounded-sm px-2 py-1 shrink-0">{data.receipt_no}</p>
                <div className="text-center flex-1">
                  <p className="font-bold text-lg tracking-wide uppercase">{data.mess.name}</p>
                  <p className="text-[11px] text-muted-foreground">{data.mess.address} | {data.mess.phone}</p>
                </div>
                <div className="w-14 h-14 shrink-0 [&>svg]:w-full [&>svg]:h-full" dangerouslySetInnerHTML={{ __html: data.qr_svg }} />
              </div>
              <div className="flex justify-end">
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
