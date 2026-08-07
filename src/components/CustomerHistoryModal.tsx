import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { ClipboardEdit } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';

interface Payment { id: number; amount: number; method: string | null; voucher_number: string | null; created_at: string; }
interface CustomerBill {
  id: number; invoice_number: string; bill_type: string; bill_serial_number: string | null;
  issue_date: string; status: string; total_amount: number; last_debit_balance: number;
  amount_paid: number; room_number: string | null; payments: Payment[];
}
interface CustomerHistory {
  guest: { id: number; full_name: string; phone: string | null; id_type: string | null; id_number: string | null; unit_address: string | null };
  bills: CustomerBill[];
}

const statusColors: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground', issued: 'bg-blue-100 text-blue-800',
  partially_paid: 'bg-amber-100 text-amber-800', paid: 'bg-green-100 text-green-800',
  void: 'bg-red-100 text-red-800', overdue: 'bg-amber-100 text-amber-800',
};

/** Workflow 2's Customer Summary Modal - clicking a search result shows this
    instead of jumping straight into one invoice: the persistent Guest
    identity plus every Master Bill/receipt they've ever had, across every
    stay. Opening a bill from here hands off to the existing
    MasterBillView/print flow via onOpenMasterBill/onOpenReceipt. */
export function CustomerHistoryModal({ guestId, onClose, onOpenMasterBill, onOpenReceipt }: {
  guestId: number | null; onClose: () => void;
  onOpenMasterBill: (invoiceId: number) => void; onOpenReceipt: (paymentId: number) => void;
}) {
  const [data, setData] = useState<CustomerHistory | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Nothing to reset when guestId clears - the Dialog below is closed
    // (open={!!guestId}) whenever that's the case, so stale `data` sitting
    // in state is never visible; re-fetching just needs the truthy branch.
    if (!guestId) return;
    queueMicrotask(async () => {
      setLoading(true);
      try { const res = await api.get(`/billing/customers/${guestId}/history`); setData(res.data); }
      catch (err) { toast.error(getErrorMessage(err, 'Failed to load customer history')); }
      finally { setLoading(false); }
    });
  }, [guestId]);

  if (!guestId) return null;

  return (
    <Dialog open={!!guestId} onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Customer Summary</DialogTitle></DialogHeader>
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!loading && data && (
          <div className="space-y-4">
            <div className="rounded-lg border p-3 grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-muted-foreground">Name</span><p className="font-semibold">{data.guest.full_name}</p></div>
              <div><span className="text-muted-foreground">Phone</span><p>{data.guest.phone || '—'}</p></div>
              <div><span className="text-muted-foreground">{data.guest.id_type || 'ID'}</span><p>{data.guest.id_number || '—'}</p></div>
              <div><span className="text-muted-foreground">Address / Unit</span><p>{data.guest.unit_address || '—'}</p></div>
            </div>

            <div>
              <p className="text-sm font-semibold mb-2">Full Master Bill / Payment Receipt History ({data.bills.length})</p>
              <Table>
                <TableHeader><TableRow><TableHead>Invoice #</TableHead><TableHead>Type</TableHead><TableHead>Serial #</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Paid</TableHead><TableHead>Status</TableHead><TableHead className="w-10" /></TableRow></TableHeader>
                <TableBody>
                  {data.bills.map(b => (
                    <TableRow key={b.id}>
                      <TableCell className="font-medium">{b.invoice_number}{b.room_number && <span className="block text-xs text-muted-foreground">Room {b.room_number}</span>}</TableCell>
                      <TableCell className="capitalize">{b.bill_type}</TableCell>
                      <TableCell>{b.bill_serial_number || '—'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{b.issue_date}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(b.total_amount + b.last_debit_balance)}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(b.amount_paid)}</TableCell>
                      <TableCell><Badge className={statusColors[b.status] || ''}>{b.status.replace('_', ' ')}</Badge></TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost" title="Open Master Bill" onClick={() => onOpenMasterBill(b.id)}><ClipboardEdit size={15} className="text-blue-600" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {data.bills.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-6 text-muted-foreground">No bills on record for this customer</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>

            {data.bills.some(b => b.payments.length > 0) && (
              <div>
                <p className="text-sm font-semibold mb-2">Payment Receipts</p>
                <Table>
                  <TableHeader><TableRow><TableHead>Invoice #</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Method</TableHead><TableHead>Voucher #</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {data.bills.flatMap(b => b.payments.map(p => (
                      <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => onOpenReceipt(p.id)}>
                        <TableCell>{b.invoice_number}</TableCell>
                        <TableCell className="text-right font-mono">{formatCurrency(p.amount)}</TableCell>
                        <TableCell>{p.method || '—'}</TableCell>
                        <TableCell>{p.voucher_number || '—'}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{new Date(p.created_at).toLocaleDateString()}</TableCell>
                      </TableRow>
                    )))}
                  </TableBody>
                </Table>
              </div>
            )}

            <div className="flex justify-end"><Button variant="ghost" onClick={onClose}>Close</Button></div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
