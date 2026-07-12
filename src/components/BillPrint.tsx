import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Printer } from 'lucide-react';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/currency';

/* Printable documents in the mess's own paper formats:
   - BillPrintView: the "DRAFT BILL (For Office Use Only)" layout (Ser /
     Details / Amount table, PA No / Rank / Name / Room No header, GR NCO /
     Catering NCO / Mess JCO signature row) + QR code. Everything settles at
     checkout (or monthly via the Mess Bill for HRA) - no advance/pre-payment.
   - PaymentReceiptView: the cash receipt ("Received from ... the sum of
     Rupees ... by Cash/Cheque ... Mess Secretary") + QR code. */

export interface BillItem { description: string; quantity: number; unit_price: number; total_price: number; }
export interface BillInvoice {
  id: number; invoice_number: string; bill_type: string; issue_date: string;
  subtotal: number; total_amount: number; amount_paid: number; balance_due: number;
  status: string; items: BillItem[];
}
interface BillBooking {
  guest_name: string; rank: string | null; pa_number: string | null; unit_address: string | null;
  reference_person?: string | null;
  room_number: string | null; check_in: string; check_out: string;
  source: string; online_voucher_no: string | null; booking_reference: string;
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

const PRINT_STYLE = `
  @media print {
    body * { visibility: hidden; }
    #bill-print-area, #bill-print-area * { visibility: visible; }
    #bill-print-area { position: fixed; top: 0; left: 0; width: 100%; }
    .bill-page { page-break-after: always; }
    .bill-page:last-child { page-break-after: auto; }
  }
`;

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
          <p className="text-[11px] text-gray-600">{data.mess.name} · {data.mess.address}</p>
          <p className="text-center font-bold underline decoration-2 text-sm mt-1">
            DRAFT BILL (For Office Use Only) — {BILL_LABELS[inv.bill_type] || 'BILL'}
          </p>
        </div>
        <div className="w-16 h-16 shrink-0 ml-2 [&>svg]:w-full [&>svg]:h-full" dangerouslySetInnerHTML={{ __html: data.qr_svg }} />
      </div>

      <div className="flex justify-between gap-4">
        <DottedField label="Online V/No." value={b?.online_voucher_no || '—'} grow />
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
            <th className="border border-gray-500 px-2 py-1 w-28 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {fixed.map(({ head, item }, i) => (
            <tr key={head}>
              <td className="border border-gray-500 px-2 py-1">{i + 1}</td>
              <td className="border border-gray-500 px-2 py-1">{item ? item.description : head}</td>
              <td className="border border-gray-500 px-2 py-1 text-right font-mono">{item ? formatCurrency(item.total_price) : '—'}</td>
            </tr>
          ))}
          {extra.map((it, i) => (
            <tr key={`x${i}`}>
              <td className="border border-gray-500 px-2 py-1">{fixed.length + i + 1}</td>
              <td className="border border-gray-500 px-2 py-1">{it.description}{it.quantity > 1 ? ` × ${it.quantity}` : ''}</td>
              <td className="border border-gray-500 px-2 py-1 text-right font-mono">{formatCurrency(it.total_price)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2} className="border border-gray-500 px-2 py-1 font-bold text-right">Total</td>
            <td className="border border-gray-500 px-2 py-1 text-right font-bold font-mono">{formatCurrency(inv.total_amount)}</td>
          </tr>
          {alreadyPaid > 0 && (
            <>
              <tr>
                <td colSpan={2} className="border border-gray-500 px-2 py-1 text-right">Less: Amount Paid</td>
                <td className="border border-gray-500 px-2 py-1 text-right font-mono">− {formatCurrency(alreadyPaid)}</td>
              </tr>
              <tr>
                <td colSpan={2} className="border border-gray-500 px-2 py-1 font-bold text-right">Balance {inv.balance_due > 0 ? 'Due' : ''}</td>
                <td className="border border-gray-500 px-2 py-1 text-right font-bold font-mono">{formatCurrency(inv.balance_due)}</td>
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
        <p className="text-[11px] text-gray-500 self-end text-right">{data.mess.phone}</p>
      </div>
    </div>
  );
}

interface BillPrintViewProps {
  invoiceIds: number[] | null;
  onClose: () => void;
  /** Show "Pay Together" / per-bill payment actions for unpaid bills. */
  allowPayments?: boolean;
  onPaymentsChanged?: () => void;
}

const PAYMENT_METHODS = ['Cash', 'Bank Transfer', 'Cheque', 'Online'];

export function BillPrintView({ invoiceIds, onClose, allowPayments = false, onPaymentsChanged }: BillPrintViewProps) {
  const [bills, setBills] = useState<PrintData[]>([]);
  const [loading, setLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  const [method, setMethod] = useState(PAYMENT_METHODS[0]);

  const fetchBills = (ids: number[]) =>
    Promise.all(ids.map(id => api.get(`/billing/invoices/${id}/print-data`).then(r => r.data as PrintData)))
      .then(setBills)
      .catch(err => toast.error(getErrorMessage(err, 'Failed to load bill')));

  useEffect(() => {
    queueMicrotask(() => {
      if (!invoiceIds || invoiceIds.length === 0) { setBills([]); return; }
      setLoading(true);
      fetchBills(invoiceIds).finally(() => setLoading(false));
    });
  }, [invoiceIds]);

  const unpaid = bills.filter(b => b.invoice.balance_due > 0.005 && b.invoice.status !== 'void');
  const unpaidTotal = unpaid.reduce((s, b) => s + b.invoice.balance_due, 0);

  const payInvoices = async (targets: PrintData[]) => {
    setPaying(true);
    try {
      for (const b of targets) {
        await api.post(`/billing/invoices/${b.invoice.id}/payments`, { amount: b.invoice.balance_due, method });
      }
      toast.success(targets.length > 1
        ? `Both bills settled together — ${formatCurrency(targets.reduce((s, b) => s + b.invoice.balance_due, 0))} by ${method}`
        : `${BILL_LABELS[targets[0].invoice.bill_type] || 'Bill'} settled — ${formatCurrency(targets[0].invoice.balance_due)} by ${method}`);
      if (invoiceIds) await fetchBills(invoiceIds);
      onPaymentsChanged?.();
    } catch (err) { toast.error(getErrorMessage(err, 'Payment failed')); }
    finally { setPaying(false); }
  };

  if (!invoiceIds) return null;
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <style>{PRINT_STYLE}</style>
        <DialogHeader>
          <DialogTitle>{bills.length > 1 ? `Bills (${bills.map(x => BILL_LABELS[x.invoice.bill_type] || 'Bill').join(' + ')})` : 'Bill'}</DialogTitle>
        </DialogHeader>
        {loading && <p className="text-sm text-gray-500">Loading bill…</p>}
        <div id="bill-print-area" className="space-y-4">
          {bills.map(bd => <DraftBill key={bd.invoice.id} data={bd} />)}
        </div>

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
            <Printer size={16} className="mr-1" /> Print {bills.length > 1 ? 'Both Bills' : 'Invoice'}
          </Button>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
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
          <div id="bill-print-area">
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
          </div>
        )}
        <div className="flex gap-2 pt-2">
          <Button onClick={() => window.print()} className="flex-1" disabled={!data}><Printer size={16} className="mr-1" /> Print Receipt</Button>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
