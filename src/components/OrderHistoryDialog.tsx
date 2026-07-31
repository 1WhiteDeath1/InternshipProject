import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/currency';

interface OrderHistoryRow { date: string; meal_type: string; item_name: string; price: number; status: string; }

/** Everything a member/guest has ordered, billed and unbilled alike - so
    front-desk/kitchen staff can answer "what did I actually order" when a
    customer asks about their bill, without digging through invoices. */
export function OrderHistoryDialog({ open, onOpenChange, memberId, bookingId, guestId, personName }: {
  open: boolean; onOpenChange: (open: boolean) => void;
  memberId?: number; bookingId?: number; guestId?: number; personName?: string;
}) {
  const [rows, setRows] = useState<OrderHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Order History{personName ? ` — ${personName}` : ''}</DialogTitle>
        </DialogHeader>
        <div className="max-h-96 overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Date</TableHead><TableHead>Meal</TableHead><TableHead>Item</TableHead><TableHead className="text-right">Price</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={4} className="text-center py-8 text-gray-500">Loading…</TableCell></TableRow>}
              {!loading && rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell>{new Date(r.date).toLocaleDateString()}</TableCell>
                  <TableCell className="capitalize">{r.meal_type.replace(/_/g, ' ')}</TableCell>
                  <TableCell>{r.item_name}</TableCell>
                  <TableCell className="text-right font-mono">{formatCurrency(r.price)}</TableCell>
                </TableRow>
              ))}
              {!loading && rows.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-8 text-gray-500">No orders on record</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
