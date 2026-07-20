import { useEffect, useRef, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Search, Plus, Camera, UserCircle2 } from 'lucide-react';

interface Attendant {
  id: number;
  full_name: string;
  phone: string | null;
  email: string | null;
  shift: string | null;
  is_active: boolean;
  on_duty: boolean;
  photo_url: string | null;
  room_count: number;
}

const emptyForm = { full_name: '', phone: '', email: '', shift: '' };

export default function Attendants() {
  const [attendants, setAttendants] = useState<Attendant[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const fileInputs = useRef<Record<number, HTMLInputElement | null>>({});

  const fetchAttendants = async () => {
    try { const res = await api.get('/attendants'); setAttendants(res.data); }
    catch { toast.error('Failed to load attendants'); }
  };

  useEffect(() => {
    queueMicrotask(() => { setLoading(true); fetchAttendants().finally(() => setLoading(false)); });
  }, []);

  const filtered = attendants.filter(a =>
    !search.trim() || a.full_name.toLowerCase().includes(search.toLowerCase()) || (a.phone || '').includes(search));

  const openCreate = () => { setEditingId(null); setForm(emptyForm); setDialogOpen(true); };
  const openEdit = (a: Attendant) => {
    setEditingId(a.id);
    setForm({ full_name: a.full_name, phone: a.phone || '', email: a.email || '', shift: a.shift || '' });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    try {
      if (editingId) {
        await api.put(`/attendants/${editingId}`, form);
        toast.success('Attendant updated');
      } else {
        await api.post('/attendants', form);
        toast.success('Attendant added');
      }
      setDialogOpen(false);
      fetchAttendants();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to save attendant')); }
  };

  const handleToggleDuty = async (a: Attendant) => {
    try {
      await api.put(`/attendants/${a.id}/duty`, { on_duty: !a.on_duty });
      toast.success(a.on_duty ? `${a.full_name} clocked out` : `${a.full_name} clocked in`);
      fetchAttendants();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to update duty status')); }
  };

  const handlePhotoUpload = async (id: number, file: File) => {
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api.post(`/attendants/${id}/photo`, fd, { headers: { 'Content-Type': undefined } });
      toast.success('Photo updated');
      fetchAttendants();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to upload photo')); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2"><UserCircle2 size={24} /> Attendant Directory</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild><Button onClick={openCreate}><Plus size={16} className="mr-1" /> Add Attendant</Button></DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>{editingId ? 'Edit Attendant' : 'Add Attendant'}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Input placeholder="Full Name" value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} />
              <Input placeholder="Phone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
              <Input placeholder="Email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
              <div>
                <Label className="text-xs">Shift</Label>
                <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.shift} onChange={e => setForm({ ...form, shift: e.target.value })}>
                  <option value="">—</option>
                  <option value="morning">Morning</option>
                  <option value="evening">Evening</option>
                  <option value="night">Night</option>
                </select>
              </div>
              <Button onClick={handleSave} className="w-full">{editingId ? 'Save Changes' : 'Add Attendant'}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
        <Input placeholder="Search attendants..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Photo</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Shift</TableHead>
                <TableHead>Rooms Assigned</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>On Duty</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={8} className="text-center py-8 text-gray-500">Loading attendants...</TableCell></TableRow>}
              {!loading && filtered.map(a => (
                <TableRow key={a.id} className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-900" onClick={() => openEdit(a)}>
                  <TableCell onClick={e => e.stopPropagation()}>
                    <div className="relative w-10 h-10 group">
                      <Avatar className="w-10 h-10">
                        {a.photo_url && <AvatarImage src={a.photo_url} alt={a.full_name} />}
                        <AvatarFallback>{a.full_name.slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <button
                        type="button"
                        className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => fileInputs.current[a.id]?.click()}
                        title="Upload photo"
                      >
                        <Camera size={14} className="text-white" />
                      </button>
                      <input
                        ref={el => { fileInputs.current[a.id] = el; }}
                        type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                        onChange={e => { const f = e.target.files?.[0]; if (f) handlePhotoUpload(a.id, f); e.target.value = ''; }}
                      />
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">{a.full_name}</TableCell>
                  <TableCell>{a.phone || '—'}</TableCell>
                  <TableCell>{a.email || '—'}</TableCell>
                  <TableCell className="capitalize">{a.shift || '—'}</TableCell>
                  <TableCell><Badge variant="secondary">{a.room_count}</Badge></TableCell>
                  <TableCell><Badge className={a.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}>{a.is_active ? 'Active' : 'Inactive'}</Badge></TableCell>
                  <TableCell onClick={e => e.stopPropagation()}>
                    <Button size="sm" variant={a.on_duty ? 'default' : 'outline'} className={a.on_duty ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
                      onClick={() => handleToggleDuty(a)}>
                      {a.on_duty ? 'Clock Out' : 'Clock In'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && filtered.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-8 text-gray-500">No attendants found</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
