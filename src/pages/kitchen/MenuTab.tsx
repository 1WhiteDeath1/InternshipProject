import { useCallback, useEffect, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/useAuth';
import { hasPermission } from '@/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Plus, ClipboardList } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';

/* The editable menu: Kitchen NCO proposes, Manager approves. Policy work
   done occasionally, not per-service - which is why it sits behind its own
   tab rather than on the Meals board. */

interface MenuItem { id: number; name: string; meal_type: string; day_of_week: string | null; price: number; is_active: boolean }
interface MenuEditRequest {
  id: number; is_new_item: boolean; proposed_name: string; proposed_price: number;
  status: string;
}

const MEAL_TYPES = ['breakfast', 'lunch', 'hitea', 'dinner'];
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const emptyForm = { name: '', price: 0, meal_type: 'lunch', day_of_week: '', reason: '' };

export function MenuTab() {
  const { user } = useAuth();
  const canPropose = hasPermission(user, 'menu', 'create') || hasPermission(user, 'menu', 'edit');

  const [items, setItems] = useState<MenuItem[]>([]);
  const [requests, setRequests] = useState<MenuEditRequest[]>([]);
  const [mealFilter, setMealFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [form, setForm] = useState(emptyForm);

  const fetchMenu = useCallback(async () => {
    try { const res = await api.get('/kitchen/menu'); setItems(res.data); }
    catch { toast.error('Failed to load the menu'); }
  }, []);

  const fetchRequests = useCallback(async () => {
    if (!canPropose) return;
    try { const res = await api.get('/kitchen/menu/edit-requests?status=pending'); setRequests(res.data); }
    catch { /* secondary */ }
  }, [canPropose]);

  useEffect(() => {
    queueMicrotask(() => { setLoading(true); Promise.all([fetchMenu(), fetchRequests()]).finally(() => setLoading(false)); });
  }, [fetchMenu, fetchRequests]);

  const openNew = () => { setEditing(null); setForm(emptyForm); setDialogOpen(true); };
  const openEdit = (item: MenuItem) => {
    setEditing(item);
    setForm({ name: item.name, price: item.price, meal_type: item.meal_type, day_of_week: item.day_of_week || '', reason: '' });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) { toast.error('Dish name is required'); return; }
    const body = {
      name: form.name, price: form.price, meal_type: form.meal_type,
      day_of_week: form.day_of_week || null, reason: form.reason || null,
    };
    try {
      if (editing) {
        await api.put(`/kitchen/menu/${editing.id}`, body);
        toast.success('Change submitted for Manager approval');
      } else {
        await api.post('/kitchen/menu', body);
        toast.success('New dish submitted for Manager approval');
      }
      setDialogOpen(false);
      fetchRequests();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to submit')); }
  };

  const shown = items.filter(m => mealFilter === 'all' || m.meal_type === mealFilter);
  const statusBadge = (s: string) => {
    const map: Record<string, string> = { pending: 'bg-amber-100 text-amber-800', approved: 'bg-green-100 text-green-800', rejected: 'bg-red-100 text-red-800' };
    return <Badge className={map[s] || ''}>{s}</Badge>;
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center gap-2 flex-wrap">
        <select className="h-10 rounded-md border border-input bg-background px-3 text-sm capitalize"
          value={mealFilter} onChange={e => setMealFilter(e.target.value)}>
          <option value="all">All meals</option>
          {MEAL_TYPES.map(mt => <option key={mt} value={mt} className="capitalize">{mt}</option>)}
        </select>
        {canPropose && <Button onClick={openNew}><Plus size={16} className="mr-1" /> Propose New Dish</Button>}
      </div>

      {requests.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <p className="text-sm font-semibold flex items-center gap-2"><ClipboardList size={16} /> Waiting on Manager</p>
            {requests.map(r => (
              <div key={r.id} className="flex items-center justify-between text-sm border-b last:border-0 py-1.5">
                <span>{r.is_new_item ? 'New: ' : 'Edit: '}{r.proposed_name} — {formatCurrency(r.proposed_price)}</span>
                {statusBadge(r.status)}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Day</TableHead><TableHead>Meal</TableHead><TableHead>Dish</TableHead>
                <TableHead>Price</TableHead>{canPropose && <TableHead className="w-24">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>}
              {!loading && shown.map(m => (
                <TableRow key={m.id} className={canPropose ? 'cursor-pointer hover:bg-accent' : ''}
                  onClick={() => canPropose && openEdit(m)}>
                  <TableCell className="capitalize">{m.day_of_week || 'Every day'}</TableCell>
                  <TableCell className="capitalize">{m.meal_type}</TableCell>
                  <TableCell className="font-medium">{m.name}</TableCell>
                  <TableCell className="font-mono">{formatCurrency(m.price)}</TableCell>
                  {canPropose && (
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={e => { e.stopPropagation(); openEdit(m); }}>Edit</Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {!loading && shown.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  No dishes {mealFilter === 'all' ? 'yet' : `for ${mealFilter}`}
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing ? 'Propose a Change' : 'Propose a New Dish'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Dish name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <select className="h-10 rounded-md border border-input bg-background px-3 text-sm capitalize"
                value={form.meal_type} onChange={e => setForm({ ...form, meal_type: e.target.value })}>
                {MEAL_TYPES.map(mt => <option key={mt} value={mt} className="capitalize">{mt}</option>)}
              </select>
              <select className="h-10 rounded-md border border-input bg-background px-3 text-sm capitalize"
                value={form.day_of_week} onChange={e => setForm({ ...form, day_of_week: e.target.value })}>
                <option value="">Every day</option>
                {DAYS.map(d => <option key={d} value={d} className="capitalize">{d}</option>)}
              </select>
            </div>
            <div>
              <Label>Price (Rs)</Label>
              <Input type="number" min={0} value={form.price} onChange={e => setForm({ ...form, price: Number(e.target.value) })} />
            </div>
            <Textarea placeholder="Reason (optional)" value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} />
            <Button onClick={handleSubmit} className="w-full">Submit for Manager Approval</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
