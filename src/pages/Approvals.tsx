import { Fragment, useEffect, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { CheckCircle2, ClipboardCheck, PackageCheck } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';

// The Manager/Deputy Manager decision queue. Managers don't operate the
// Procurement module (that's the Kitchen NCO's job - raising POs); they only
// sign off the spend. This surfaces exactly the POs awaiting that decision,
// nothing else operational. Discounts/comps are NOT here - those are the
// Clerk's authority, overseen after the fact via the dashboard's Discounts figure.
interface POItem { id: number; item_name: string | null; quantity_ordered: number; unit_price: number; total_price: number; }
interface PurchaseOrder {
  id: number;
  po_number: string;
  vendor_name: string | null;
  status: string;
  total_amount: number;
  expected_delivery: string | null;
  created_at: string;
  items: POItem[];
}

export default function Approvals() {
  const [pending, setPending] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);

  const fetchPending = async () => {
    setLoading(true);
    try {
      const res = await api.get('/procurement/purchase-orders?status=draft');
      setPending(res.data.items || []);
    } catch {
      toast.error('Failed to load approvals');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { queueMicrotask(fetchPending); }, []);

  const approve = async (po: PurchaseOrder) => {
    try {
      await api.post(`/procurement/purchase-orders/${po.id}/approve`);
      toast.success(`${po.po_number} approved`);
      fetchPending();
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  };

  const totalPending = pending.reduce((s, p) => s + (p.total_amount || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ClipboardCheck size={24} className="text-gray-700 dark:text-gray-300" />
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Approvals</h1>
        {pending.length > 0 && <Badge variant="destructive">{pending.length} awaiting sign-off</Badge>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
              <PackageCheck size={20} className="text-amber-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Purchase Orders Pending</p>
              <p className="text-2xl font-bold">{pending.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <CheckCircle2 size={20} className="text-emerald-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Value Awaiting Approval</p>
              <p className="text-2xl font-bold">{formatCurrency(totalPending)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PO Number</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Expected</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pending.map(po => (
                <Fragment key={po.id}>
                  <TableRow className="cursor-pointer" onClick={() => setExpanded(expanded === po.id ? null : po.id)}>
                    <TableCell className="font-medium">{po.po_number}</TableCell>
                    <TableCell>{po.vendor_name || '—'}</TableCell>
                    <TableCell className="text-sm text-gray-500">{po.expected_delivery ? new Date(po.expected_delivery).toLocaleDateString() : '—'}</TableCell>
                    <TableCell className="text-right font-mono font-semibold">{formatCurrency(po.total_amount)}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" onClick={(e) => { e.stopPropagation(); approve(po); }}>
                        <CheckCircle2 size={16} className="mr-1" /> Approve
                      </Button>
                    </TableCell>
                  </TableRow>
                  {expanded === po.id && (
                    <TableRow>
                      <TableCell colSpan={5} className="bg-gray-50 dark:bg-gray-900/40">
                        <div className="text-sm space-y-1 py-1">
                          {po.items.map(it => (
                            <div key={it.id} className="flex justify-between max-w-md">
                              <span>{it.item_name || `Item #${it.id}`} × {it.quantity_ordered}</span>
                              <span className="font-mono text-gray-500">{formatCurrency(it.total_price)}</span>
                            </div>
                          ))}
                          {po.items.length === 0 && <span className="text-gray-400">No line items</span>}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
              {!loading && pending.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center py-10 text-gray-500">
                  Nothing awaiting approval ✓
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
