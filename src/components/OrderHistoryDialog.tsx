import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import api, { getErrorMessage } from '@/lib/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Printer, Download } from 'lucide-react';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/currency';

interface OrderHistoryRow { date: string; meal_type: string; item_name: string; price: number; status: string; }

/* Print-portal recipe copied from MessBillPrint.tsx (itself copied from
   BillPrint.tsx) rather than imported, to keep this shared kitchen/clerk
   component decoupled from the mess-billing domain. One shared portal target
   - which table lands in it depends on which Print button was clicked. */
const PRINT_STYLE = `
  @media print {
    body * { visibility: hidden; }
    #order-history-print-area, #order-history-print-area * { visibility: visible; }
    #order-history-print-area { display: block !important; position: absolute; top: 0; left: 0; width: 100%; }
    html, body { height: auto !important; overflow: visible !important; }
  }
`;

function toCsv(rows: OrderHistoryRow[]): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const header = 'Date,Meal,Item,Price,Status';
  const body = rows.map(r => [
    new Date(r.date).toLocaleDateString('en-CA'), r.meal_type.replace(/_/g, ' '), esc(r.item_name), r.price, r.status,
  ].join(','));
  return [header, ...body].join('\n');
}

function downloadCsv(rows: OrderHistoryRow[], filename: string) {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function HistoryTable({ rows, emptyLabel }: { rows: OrderHistoryRow[]; emptyLabel: string }) {
  return (
    <Table>
      <TableHeader>
        <TableRow><TableHead>Date</TableHead><TableHead>Meal</TableHead><TableHead>Item</TableHead><TableHead className="text-right">Price</TableHead><TableHead>Status</TableHead></TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={i}>
            <TableCell>{new Date(r.date).toLocaleDateString()}</TableCell>
            <TableCell className="capitalize">{r.meal_type.replace(/_/g, ' ')}</TableCell>
            <TableCell>{r.item_name}</TableCell>
            <TableCell className="text-right font-mono">{formatCurrency(r.price)}</TableCell>
            <TableCell className="capitalize text-muted-foreground">{r.status.replace(/_/g, ' ')}</TableCell>
          </TableRow>
        ))}
        {rows.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">{emptyLabel}</TableCell></TableRow>}
      </TableBody>
    </Table>
  );
}

/** One printable/exportable section: a heading, Print + Export CSV actions,
    and the table itself. `printing` tells it whether it's the section
    currently targeted at the shared print portal. */
function HistorySection({
  title, rows, emptyLabel, personName, printing, onPrint, exportFilename,
}: {
  title: string; rows: OrderHistoryRow[]; emptyLabel: string; personName?: string;
  printing: boolean; onPrint: () => void; exportFilename: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{title}</p>
        <div className="flex gap-1.5">
          <Button size="sm" variant="ghost" disabled={rows.length === 0} onClick={() => downloadCsv(rows, exportFilename)}>
            <Download size={14} className="mr-1" /> Export CSV
          </Button>
          <Button size="sm" variant="ghost" disabled={rows.length === 0} onClick={onPrint}>
            <Printer size={14} className="mr-1" /> Print
          </Button>
        </div>
      </div>
      <div className="max-h-72 overflow-y-auto rounded-md border">
        <HistoryTable rows={rows} emptyLabel={emptyLabel} />
      </div>
      {printing && createPortal(
        <div id="order-history-print-area" className="hidden print:block p-4 text-[13px] text-foreground bg-white">
          <p className="text-center font-bold underline decoration-2 text-sm mb-2">{title.toUpperCase()}{personName ? ` — ${personName}` : ''}</p>
          <HistoryTable rows={rows} emptyLabel={emptyLabel} />
        </div>,
        document.body,
      )}
    </div>
  );
}

/** Everything a member/guest has ordered, billed and unbilled alike - split
    into two independently printable/exportable tables (regular meal
    attendance vs à la carte orders) so front-desk/clerk staff can answer
    "what did I actually order" or hand over a receipt without digging
    through invoices. */
export function OrderHistoryDialog({ open, onOpenChange, memberId, bookingId, guestId, personName }: {
  open: boolean; onOpenChange: (open: boolean) => void;
  memberId?: number; bookingId?: number; guestId?: number; personName?: string;
}) {
  const [rows, setRows] = useState<OrderHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState<'attendance' | 'alacarte' | null>(null);

  useEffect(() => {
    if (!open) return;
    queueMicrotask(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (memberId) params.set('member_id', String(memberId));
        else if (bookingId) params.set('booking_id', String(bookingId));
        else if (guestId) params.set('guest_id', String(guestId));
        const res = await api.get(`/kitchen/order-history?${params.toString()}`);
        setRows(res.data);
      } catch (err) { toast.error(getErrorMessage(err, 'Failed to load order history')); }
      finally { setLoading(false); }
    });
  }, [open, memberId, bookingId, guestId]);

  const attendanceRows = useMemo(() => rows.filter(r => r.meal_type !== 'a_la_carte'), [rows]);
  const alaCarteRows = useMemo(() => rows.filter(r => r.meal_type === 'a_la_carte'), [rows]);

  const printSection = (target: 'attendance' | 'alacarte') => {
    setPrinting(target);
    // Let the portal render into the DOM before the print dialog snapshots it.
    setTimeout(() => window.print(), 50);
  };

  const fileSafeName = (personName || 'consumer').replace(/[^a-z0-9]+/gi, '_').toLowerCase();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <style>{PRINT_STYLE}</style>
        <DialogHeader>
          <DialogTitle>Order History{personName ? ` — ${personName}` : ''}</DialogTitle>
        </DialogHeader>
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!loading && (
          <div className="space-y-5">
            <HistorySection
              title="Attendance History" rows={attendanceRows} emptyLabel="No meal attendance on record"
              personName={personName} printing={printing === 'attendance'} onPrint={() => printSection('attendance')}
              exportFilename={`attendance_history_${fileSafeName}.csv`}
            />
            <HistorySection
              title="À La Carte Orders" rows={alaCarteRows} emptyLabel="No à la carte orders on record"
              personName={personName} printing={printing === 'alacarte'} onPrint={() => printSection('alacarte')}
              exportFilename={`ala_carte_orders_${fileSafeName}.csv`}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
