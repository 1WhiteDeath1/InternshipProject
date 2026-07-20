import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Plus, Trash2, TrendingUp } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import { RANKS, ROOM_TYPE_LABELS, selectClass } from './bookings/shared';

interface TariffRate {
  id: number;
  rank: string;
  room_type: string;
  stay_type: string;
  nightly_rate: number;
  updated_at: string;
}

const STAY_TYPES = ['official', 'private', 'family'];
const emptyForm = { rank: RANKS[0], room_type: 'standard', stay_type: 'official', nightly_rate: 0 };

export default function Tariffs() {
  const [rows, setRows] = useState<TariffRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const fetchTariffs = async () => {
    try { const res = await api.get('/tariffs'); setRows(res.data); }
    catch { toast.error('Failed to load tariffs'); }
  };

  useEffect(() => { queueMicrotask(() => { setLoading(true); fetchTariffs().finally(() => setLoading(false)); }); }, []);

  const handleSave = async () => {
    try {
      await api.put('/tariffs', form);
      toast.success('Tariff saved');
      setDialogOpen(false);
      setForm(emptyForm);
      fetchTariffs();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to save tariff')); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Remove this tariff rate?')) return;
    try { await api.delete(`/tariffs/${id}`); toast.success('Tariff removed'); fetchTariffs(); }
    catch (err) { toast.error(getErrorMessage(err, 'Failed to remove tariff')); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2"><TrendingUp size={24} /> Dynamic Tariff Engine</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild><Button onClick={() => setForm(emptyForm)}><Plus size={16} className="mr-1" /> Add / Update Rate</Button></DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Tariff Rate</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Rank</Label>
                <select className={selectClass} value={form.rank} onChange={e => setForm({ ...form, rank: e.target.value })}>
                  {RANKS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs">Room Type</Label>
                <select className={selectClass} value={form.room_type} onChange={e => setForm({ ...form, room_type: e.target.value })}>
                  {Object.entries(ROOM_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs">Stay Type</Label>
                <select className={selectClass} value={form.stay_type} onChange={e => setForm({ ...form, stay_type: e.target.value })}>
                  {STAY_TYPES.map(s => <option key={s} value={s} className="capitalize">{s}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs">Nightly Rate (Rs)</Label>
                <Input type="number" min={0} value={form.nightly_rate} onChange={e => setForm({ ...form, nightly_rate: Number(e.target.value) })} />
              </div>
              <Button onClick={handleSave} className="w-full">Save Rate</Button>
              <p className="text-xs text-gray-400">Saving an existing rank/room type/stay type combination updates its rate in place.</p>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <p className="text-sm text-gray-500">
        When a booking's rank, room type, and stay type all match a row below, this rate overrides the standard rate card. Bookings without a match are unaffected.
      </p>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rank</TableHead>
                <TableHead>Room Type</TableHead>
                <TableHead>Stay Type</TableHead>
                <TableHead>Nightly Rate</TableHead>
                <TableHead className="w-16">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={5} className="text-center py-8 text-gray-500">Loading tariffs...</TableCell></TableRow>}
              {!loading && rows.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.rank}</TableCell>
                  <TableCell>{ROOM_TYPE_LABELS[r.room_type] || r.room_type}</TableCell>
                  <TableCell className="capitalize">{r.stay_type}</TableCell>
                  <TableCell className="font-mono">{formatCurrency(r.nightly_rate)}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => handleDelete(r.id)}><Trash2 size={16} className="text-red-600" /></Button>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && rows.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-8 text-gray-500">No tariff rates configured yet</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
