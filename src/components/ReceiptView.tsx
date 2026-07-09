import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Printer } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';

export interface ReceiptItem { description: string; quantity: number; unit_price: number; total_price: number; }
export interface ReceiptData {
  invoice_number: string;
  guest_name?: string | null;
  room_number?: string | null;
  items: ReceiptItem[];
  total_amount: number;
  unpriced_items?: string[];
}

interface Props {
  receipt: ReceiptData | null;
  onClose: () => void;
}

export default function ReceiptView({ receipt, onClose }: Props) {
  if (!receipt) return null;

  return (
    <Dialog open={!!receipt} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <style>{`
          @media print {
            body * { visibility: hidden; }
            #receipt-print-area, #receipt-print-area * { visibility: visible; }
            #receipt-print-area { position: fixed; top: 0; left: 0; width: 100%; }
          }
        `}</style>
        <DialogHeader><DialogTitle>Receipt — {receipt.invoice_number}</DialogTitle></DialogHeader>
        <div id="receipt-print-area" className="space-y-3 text-sm">
          {(receipt.guest_name || receipt.room_number) && (
            <div>
              {receipt.guest_name && <p className="font-medium">{receipt.guest_name}</p>}
              {receipt.room_number && <p className="text-gray-500">Room {receipt.room_number}</p>}
            </div>
          )}
          <div className="border-t border-b divide-y">
            {receipt.items.map((item, idx) => (
              <div key={idx} className="flex justify-between py-1.5">
                <span>{item.description} {item.quantity > 1 ? `×${item.quantity}` : ''}</span>
                <span className="font-mono">{formatCurrency(item.total_price)}</span>
              </div>
            ))}
          </div>
          <div className="flex justify-between font-bold text-base">
            <span>Total</span>
            <span className="font-mono">{formatCurrency(receipt.total_amount)}</span>
          </div>
          {receipt.unpriced_items && receipt.unpriced_items.length > 0 && (
            <p className="text-xs text-amber-600">
              Not included (needs pricing): {receipt.unpriced_items.join(', ')}
            </p>
          )}
        </div>
        <div className="flex gap-2 pt-2">
          <Button onClick={() => window.print()} className="flex-1"><Printer size={16} className="mr-1" /> Print</Button>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
