import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Percent } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import { RATE_CARD_CATEGORY_LABELS } from './bookings/shared';

interface GuestRow {
  id: number;
  guest_name: string;
  rank: string | null;
  room_number: string | null;
  client_category: string | null;
  discount_rate: number;
  total_amount: number;
  check_in: string;
  check_out: string;
}

// Manager's direct discount/category authority over every currently
// checked-in (non-HRA) guest - no approval step, one small audit log entry
// per change. HRA/mess members have their own separate standing-discount
// table (Member Discounts) since they bill monthly, not per-stay.
export default function GuestDiscounts() {
  const [guests, setGuests] = useState<GuestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [draftDiscount, setDraftDiscount] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);

  const fetchGuests = async () => {
    setLoading(true);
    try {
      const res = await api.get('/bookings/current-guests');
      setGuests(res.data || []);
    } catch (e) {
      toast.error(getErrorMessage(e, 'Failed to load current guests'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { queueMicrotask(fetchGuests); }, []);

  const changeCategory = async (guest: GuestRow, category: string) => {
    try {
      await api.put(`/bookings/${guest.id}/category`, { client_category: category });
      toast.success(`Category updated to ${RATE_CARD_CATEGORY_LABELS[category] || category}`);
      fetchGuests();
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  };

  const saveDiscount = async (guest: GuestRow) => {
    const raw = draftDiscount[guest.id];
    const rate = raw === undefined ? guest.discount_rate : Number(raw);
    if (Number.isNaN(rate) || rate < 0 || rate > 100) {
      toast.error('Discount must be between 0 and 100');
      return;
    }
    setSavingId(guest.id);
    try {
      await api.put(`/bookings/${guest.id}/discount`, { discount_rate: rate });
      toast.success(`Discount set to ${rate}% for ${guest.guest_name}`);
      setDraftDiscount(prev => { const next = { ...prev }; delete next[guest.id]; return next; });
      fetchGuests();
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Percent size={24} className="text-gray-700 dark:text-gray-300" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Guest Discounts</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Every currently checked-in guest - adjust category or discount directly, no approval needed.</p>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Guest</TableHead>
                <TableHead>Room</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Discount %</TableHead>
                <TableHead className="text-right">Current Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {guests.map(g => {
                const draft = draftDiscount[g.id];
                const dirty = draft !== undefined && Number(draft) !== g.discount_rate;
                return (
                  <TableRow key={g.id}>
                    <TableCell className="font-medium">
                      {g.rank ? `${g.rank} ` : ''}{g.guest_name}
                    </TableCell>
                    <TableCell>{g.room_number || '—'}</TableCell>
                    <TableCell>
                      <Select value={g.client_category || ''} onValueChange={v => changeCategory(g, v)}>
                        <SelectTrigger className="w-40"><SelectValue placeholder="Category" /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(RATE_CARD_CATEGORY_LABELS).map(([value, label]) => (
                            <SelectItem key={value} value={value}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number" min={0} max={100} step="any" className="w-20"
                          value={draft !== undefined ? draft : String(g.discount_rate)}
                          onChange={e => setDraftDiscount(prev => ({ ...prev, [g.id]: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter') saveDiscount(g); }}
                        />
                        {dirty && (
                          <Button size="sm" disabled={savingId === g.id} onClick={() => saveDiscount(g)}>
                            {savingId === g.id ? 'Saving…' : 'Save'}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold">{formatCurrency(g.total_amount)}</TableCell>
                  </TableRow>
                );
              })}
              {!loading && guests.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center py-10 text-gray-500">
                  No guests currently checked in.
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
