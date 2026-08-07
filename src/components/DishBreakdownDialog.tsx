import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/currency';

interface BreakdownRow {
  date: string; meal_type: string; menu_item_id: number | null;
  item_name: string; price: number; status: string;
  price_is_override: boolean; gas_amount: number | null;
}

function rowKey(r: BreakdownRow) { return `${r.date}-${r.meal_type}-${r.menu_item_id}`; }

/** A guest's per-meal food+gas breakdown, editable inline - "for meal A the
    food charge is this, the gas is this" (both editable, food defaults to
    the menu price automatically). Editing either writes to the shared
    per-dish KitchenOrder (PUT /kitchen/dish-pricing, same mechanism as the
    Production tab's icon) - the same amount then applies to everyone else
    who ate that exact date+meal+dish too, not just this guest. À la carte
    rows are display-only (priced per order, no gas line - see
    KitchenOrder.gas_amount/price_override's model docstrings).

    Guest-only - a member's dining is billed monthly in aggregate, not per
    meal, so there's nothing here to correct for them; their meal history
    lives in Member Management instead (see MemberLedger.tsx). */
export function DishBreakdownDialog({
  open, onOpenChange, bookingId, guestName, isDeparting, kitchenFinalizedByName, onFinalized,
}: {
  open: boolean; onOpenChange: (open: boolean) => void;
  bookingId: number; guestName: string;
  isDeparting: boolean; kitchenFinalizedByName: string | null;
  onFinalized: () => void;
}) {
  const [rows, setRows] = useState<BreakdownRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [edits, setEdits] = useState<Record<string, { price: string; gas: string }>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);

  const fetchRows = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/kitchen/order-history?booking_id=${bookingId}`);
      setRows(res.data);
      setEdits({});
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to load breakdown')); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (!open) return;
    queueMicrotask(fetchRows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bookingId]);

  const editFor = (r: BreakdownRow) => edits[rowKey(r)] ?? { price: String(r.price), gas: r.gas_amount !== null ? String(r.gas_amount) : '' };
  const setEditFor = (r: BreakdownRow, next: { price: string; gas: string }) => setEdits(prev => ({ ...prev, [rowKey(r)]: next }));

  const isDirty = (r: BreakdownRow) => {
    const e = editFor(r);
    const priceChanged = e.price.trim() !== '' && Number(e.price) !== r.price;
    const gasChanged = Number(e.gas || 0) !== (r.gas_amount ?? 0) || (e.gas.trim() === '' && r.gas_amount !== null);
    return priceChanged || gasChanged;
  };

  const handleSaveRow = async (r: BreakdownRow) => {
    if (r.menu_item_id == null) return;
    const e = editFor(r);
    setSavingKey(rowKey(r));
    try {
      await api.put('/kitchen/dish-pricing', {
        date: r.date.slice(0, 10), meal_type: r.meal_type, menu_item_id: r.menu_item_id,
        price_override: e.price.trim() === '' ? null : Number(e.price),
        gas_amount: e.gas.trim() === '' ? null : Number(e.gas),
      });
      toast.success(`${r.item_name} pricing updated`);
      fetchRows();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to update pricing')); }
    finally { setSavingKey(null); }
  };

  const handleFinalize = async () => {
    setFinalizing(true);
    try {
      await api.post(`/kitchen/departures/${bookingId}/finalize`);
      toast.success('Marked mess/gas charges final — Clerk notified');
      onFinalized();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to finalize')); }
    finally { setFinalizing(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Meal Breakdown — {guestName}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {isDeparting && (
            <div className="flex items-center justify-between gap-3 rounded-md border border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/20 px-3 py-2">
              <span className="text-sm flex items-center gap-1.5 text-blue-800 dark:text-blue-300">
                <LogOut size={15} /> Checking out today/overdue
              </span>
              <Button size="sm" disabled={!!kitchenFinalizedByName || finalizing} onClick={handleFinalize}>
                {kitchenFinalizedByName ? `Finalized by ${kitchenFinalizedByName}` : finalizing ? 'Working…' : 'Finalize & Notify Clerk'}
              </Button>
            </div>
          )}

          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!loading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead><TableHead>Meal</TableHead><TableHead>Item</TableHead>
                  <TableHead className="w-28">Food (Rs)</TableHead><TableHead className="w-28">Gas (Rs)</TableHead>
                  <TableHead>Status</TableHead><TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => {
                  const isAlaCarte = r.meal_type === 'a_la_carte';
                  const e = editFor(r);
                  return (
                    <TableRow key={i}>
                      <TableCell className="text-sm">{new Date(r.date).toLocaleDateString()}</TableCell>
                      <TableCell className="text-sm capitalize">{r.meal_type.replace(/_/g, ' ')}</TableCell>
                      <TableCell className="text-sm">{r.item_name}</TableCell>
                      <TableCell>
                        {isAlaCarte ? (
                          <span className="font-mono text-sm">{formatCurrency(r.price)}</span>
                        ) : (
                          <Input type="number" min={0} className="h-8 font-mono" value={e.price}
                            onChange={ev => setEditFor(r, { ...e, price: ev.target.value.replace(/^0+(?=\d)/, '') })} />
                        )}
                      </TableCell>
                      <TableCell>
                        {isAlaCarte ? (
                          <span className="text-muted-foreground text-sm">—</span>
                        ) : (
                          <Input type="number" min={0} className="h-8 font-mono" placeholder="0" value={e.gas}
                            onChange={ev => setEditFor(r, { ...e, gas: ev.target.value.replace(/^0+(?=\d)/, '') })} />
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground capitalize">{r.status.replace(/_/g, ' ')}</TableCell>
                      <TableCell>
                        {!isAlaCarte && isDirty(r) && (
                          <Button size="sm" disabled={savingKey === rowKey(r)} onClick={() => handleSaveRow(r)}>
                            {savingKey === rowKey(r) ? '…' : 'Save'}
                          </Button>
                        )}
                        {!isAlaCarte && r.price_is_override && !isDirty(r) && <Badge variant="outline" className="text-xs">set</Badge>}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {rows.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">No meals on record</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
          <p className="text-xs text-muted-foreground">
            Food defaults to the menu price automatically; editing it (or the gas amount, which starts at Rs 0 until set) applies to
            everyone who ate that exact dish for that date and meal, not just {guestName}.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
