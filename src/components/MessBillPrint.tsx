import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import api, { getErrorMessage } from '@/lib/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Printer } from 'lucide-react';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/currency';

/* Month-End Split printable views - Pipeline A (RoomLeaseDispatchView, an
   org-facing aggregate of every member's room/HRA charge for a period) and
   Pipeline B (DietInvoiceView, one member's dining-only breakdown). Both are
   read-only presentations over already-generated MessBill rows - nothing
   here changes what's billed or owed.

   Copies the print-portal recipe from BillPrint.tsx (PRINT_STYLE/PrintArea/
   window.print()) rather than importing it, to keep the guest-billing and
   mess-billing domains decoupled - the recipe is ~10 lines either way. */

interface MessIdentity { name: string; address: string; phone: string; }

const PRINT_STYLE = `
  @media print {
    body * { visibility: hidden; }
    #mess-bill-print-area, #mess-bill-print-area * { visibility: visible; }
    #mess-bill-print-area { display: block !important; position: absolute; top: 0; left: 0; width: 100%; }
    html, body { height: auto !important; overflow: visible !important; }
    .bill-page { page-break-after: always; break-inside: avoid; }
    .bill-page:last-child { page-break-after: auto; }
    .bill-page tr { break-inside: avoid; }
  }
`;

function PrintArea({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="space-y-4">{children}</div>
      {createPortal(
        <div id="mess-bill-print-area" className="hidden print:block">{children}</div>,
        document.body,
      )}
    </>
  );
}

interface DispatchMember { member_name: string | null; service_number: string | null; is_womens_bloc: boolean; stay_amount: number; }
interface DispatchData {
  period: { month: number; year: number; label: string };
  members: DispatchMember[];
  hra_subtotal: number; womens_bloc_subtotal: number; total: number;
  mess: MessIdentity; verify_hash: string; qr_svg: string;
}

export function RoomLeaseDispatchView({ month, year, onClose }: { month: number | null; year: number | null; onClose: () => void }) {
  const [data, setData] = useState<DispatchData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      if (!month || !year) { setData(null); return; }
      setLoading(true);
      api.get(`/mess-billing/room-lease-dispatch?month=${month}&year=${year}`).then(r => setData(r.data))
        .catch(err => toast.error(getErrorMessage(err, 'Failed to load room-lease dispatch')))
        .finally(() => setLoading(false));
    });
  }, [month, year]);

  if (!month || !year) return null;
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <style>{PRINT_STYLE}</style>
        <DialogHeader><DialogTitle>Room-Lease Dispatch</DialogTitle></DialogHeader>
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {data && (
          <PrintArea>
            <div className="bill-page border border-gray-400 rounded-sm p-4 text-[13px] text-foreground bg-white space-y-2.5">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <p className="text-[11px] text-muted-foreground">{data.mess.name} · {data.mess.address} · {data.mess.phone}</p>
                  <p className="text-center font-bold underline decoration-2 text-sm mt-1">MONTHLY ROOM-LEASE DISPATCH — {data.period.label}</p>
                </div>
                <div className="w-16 h-16 shrink-0 ml-2 [&>svg]:w-full [&>svg]:h-full" dangerouslySetInnerHTML={{ __html: data.qr_svg }} />
              </div>

              <table className="w-full border-collapse mt-1">
                <thead>
                  <tr>
                    <th className="border border-gray-500 px-2 py-1 w-10 text-left">Ser</th>
                    <th className="border border-gray-500 px-2 py-1 text-left">Member</th>
                    <th className="border border-gray-500 px-2 py-1 w-24 text-left">Wing</th>
                    <th className="border border-gray-500 px-2 py-1 w-32 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.members.map((m, i) => (
                    <tr key={i}>
                      <td className="border border-gray-500 px-2 py-1">{i + 1}</td>
                      <td className="border border-gray-500 px-2 py-1">{m.member_name} <span className="text-muted-foreground">({m.service_number})</span></td>
                      <td className="border border-gray-500 px-2 py-1 text-[11px] text-muted-foreground">{m.is_womens_bloc ? "Women's Bloc" : 'HRA'}</td>
                      <td className="border border-gray-500 px-2 py-1 text-right font-mono whitespace-nowrap">{formatCurrency(m.stay_amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} className="border border-gray-500 px-2 py-1 text-right">HRA Subtotal</td>
                    <td className="border border-gray-500 px-2 py-1 text-right font-mono whitespace-nowrap">{formatCurrency(data.hra_subtotal)}</td>
                  </tr>
                  <tr>
                    <td colSpan={3} className="border border-gray-500 px-2 py-1 text-right">Women's Bloc Subtotal</td>
                    <td className="border border-gray-500 px-2 py-1 text-right font-mono whitespace-nowrap">{formatCurrency(data.womens_bloc_subtotal)}</td>
                  </tr>
                  <tr>
                    <td colSpan={3} className="border border-gray-500 px-2 py-1 font-bold text-right">Grand Total</td>
                    <td className="border border-gray-500 px-2 py-1 text-right font-bold font-mono whitespace-nowrap">{formatCurrency(data.total)}</td>
                  </tr>
                </tfoot>
              </table>

              <p className="text-[11px] text-muted-foreground">Verify: {data.verify_hash}</p>
            </div>
          </PrintArea>
        )}
        <div className="flex gap-2 pt-2">
          <Button onClick={() => window.print()} className="flex-1" disabled={loading || !data}>
            <Printer size={16} className="mr-1" /> Print Dispatch
          </Button>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface DietInvoiceData {
  bill_id: number;
  member: { full_name: string | null; service_number: string | null };
  period: { month: number; year: number; label: string };
  man_days: number; per_head_rate: number;
  base_menu_amount: number; extra_meals_amount: number; ala_carte_amount: number; discount_amount: number;
  dining_total: number; status: string;
  mess: MessIdentity; verify_hash: string; qr_svg: string;
}

export function DietInvoiceView({ billId, onClose }: { billId: number | null; onClose: () => void }) {
  const [data, setData] = useState<DietInvoiceData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      if (!billId) { setData(null); return; }
      setLoading(true);
      api.get(`/mess-billing/bills/${billId}/diet-invoice`).then(r => setData(r.data))
        .catch(err => toast.error(getErrorMessage(err, 'Failed to load diet invoice')))
        .finally(() => setLoading(false));
    });
  }, [billId]);

  if (!billId) return null;
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <style>{PRINT_STYLE}</style>
        <DialogHeader><DialogTitle>Diet Invoice</DialogTitle></DialogHeader>
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {data && (
          <PrintArea>
            <div className="bill-page border border-gray-400 rounded-sm p-4 text-[13px] text-foreground bg-white space-y-2.5">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <p className="text-[11px] text-muted-foreground">{data.mess.name} · {data.mess.address} · {data.mess.phone}</p>
                  <p className="text-center font-bold underline decoration-2 text-sm mt-1">PERSONAL DIET INVOICE — {data.period.label}</p>
                </div>
                <div className="w-16 h-16 shrink-0 ml-2 [&>svg]:w-full [&>svg]:h-full" dangerouslySetInnerHTML={{ __html: data.qr_svg }} />
              </div>

              <p className="text-sm">{data.member.full_name} <span className="text-muted-foreground">({data.member.service_number})</span></p>

              <table className="w-full border-collapse mt-1">
                <thead>
                  <tr>
                    <th className="border border-gray-500 px-2 py-1 text-left">Details</th>
                    <th className="border border-gray-500 px-2 py-1 w-32 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td className="border border-gray-500 px-2 py-1">Standard Mess Meals ({data.man_days} man-days @ {formatCurrency(data.per_head_rate)})</td><td className="border border-gray-500 px-2 py-1 text-right font-mono whitespace-nowrap">{formatCurrency(data.base_menu_amount)}</td></tr>
                  <tr><td className="border border-gray-500 px-2 py-1">Extra Sponsored Meals</td><td className="border border-gray-500 px-2 py-1 text-right font-mono whitespace-nowrap">{formatCurrency(data.extra_meals_amount)}</td></tr>
                  <tr><td className="border border-gray-500 px-2 py-1">A La Carte</td><td className="border border-gray-500 px-2 py-1 text-right font-mono whitespace-nowrap">{formatCurrency(data.ala_carte_amount)}</td></tr>
                  {data.discount_amount > 0 && (
                    <tr><td className="border border-gray-500 px-2 py-1">Less: Discount</td><td className="border border-gray-500 px-2 py-1 text-right font-mono whitespace-nowrap">− {formatCurrency(data.discount_amount)}</td></tr>
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="border border-gray-500 px-2 py-1 font-bold text-right">Dining Total</td>
                    <td className="border border-gray-500 px-2 py-1 text-right font-bold font-mono whitespace-nowrap">{formatCurrency(data.dining_total)}</td>
                  </tr>
                </tfoot>
              </table>

              <p className="text-[11px] text-muted-foreground capitalize">Status: {data.status} · Verify: {data.verify_hash}</p>
              <p className="text-[10px] text-muted-foreground">Room/HRA charges are dispatched separately and not included here.</p>
            </div>
          </PrintArea>
        )}
        <div className="flex gap-2 pt-2">
          <Button onClick={() => window.print()} className="flex-1" disabled={loading || !data}>
            <Printer size={16} className="mr-1" /> Print Diet Invoice
          </Button>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
