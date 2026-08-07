import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/useAuth';
import { hasPermission } from '@/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Search, Plus, IdCard, ArrowRightLeft, Receipt } from 'lucide-react';
import { ConfirmDialog, type ConfirmRequest } from '@/components/ConfirmDialog';

interface Member {
  id: number;
  service_number: string;
  full_name: string;
  rank: string;
  unit: string | null;
  mess_category: string;
  client_category: string;
  is_womens_bloc: boolean;
  dining_status: string;
  is_hra: boolean;
  hra_stay_type: string | null;
  dorm_location: string | null;
  custom_discount_rate: number;
  phone: string | null;
  email: string | null;
  status: string;
  current_room_id: number | null;
  current_room_number: string | null;
}

const emptyForm = {
  service_number: '', full_name: '', rank: '', unit: '', mess_category: 'officers', is_womens_bloc: false,
  dining_status: 'dining', is_hra: false, hra_stay_type: '', dorm_location: '', phone: '', email: '', custom_discount_rate: 0,
};

export default function Members() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [members, setMembers] = useState<Member[]>([]);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);

  const fetchMembers = async () => {
    try {
      const res = await api.get(`/members?search=${search}`);
      setMembers(res.data.items);
    } catch { toast.error('Failed to load members'); }
  };

  useEffect(() => {
    queueMicrotask(() => {
      setLoading(true);
      fetchMembers().finally(() => setLoading(false));
    });
  }, [search]);

  // Refresh if the global "+ Add Member" top-bar shortcut is used while
  // this page is already mounted. Re-subscribed whenever `search` changes
  // so the listener always refetches with the current search term.
  useEffect(() => {
    window.addEventListener('members:changed', fetchMembers);
    return () => window.removeEventListener('members:changed', fetchMembers);
  }, [search]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (m: Member) => {
    setEditingId(m.id);
    setForm({
      service_number: m.service_number, full_name: m.full_name, rank: m.rank,
      unit: m.unit || '', mess_category: m.mess_category, is_womens_bloc: m.is_womens_bloc,
      dining_status: m.dining_status || 'dining', is_hra: m.is_hra, hra_stay_type: m.hra_stay_type || '',
      dorm_location: m.dorm_location || '', phone: m.phone || '',
      email: m.email || '', custom_discount_rate: m.custom_discount_rate,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (form.is_hra && form.hra_stay_type === 'out_of_mess' && !form.dorm_location.trim()) {
      toast.error('Dorm Location / Details is required for an out-of-mess HRA member');
      return;
    }
    try {
      if (editingId) {
        const { full_name, rank, unit, mess_category, is_womens_bloc, dining_status, is_hra, hra_stay_type, dorm_location, phone, email, custom_discount_rate } = form;
        await api.put(`/members/${editingId}`, {
          full_name, rank, unit, mess_category, is_womens_bloc, dining_status,
          is_hra, hra_stay_type: is_hra ? hra_stay_type : null, dorm_location: is_hra && hra_stay_type === 'out_of_mess' ? dorm_location : null,
          phone, email, custom_discount_rate,
        });
        toast.success('Member updated');
      } else {
        await api.post('/members', {
          ...form,
          hra_stay_type: form.is_hra ? form.hra_stay_type : null,
          dorm_location: form.is_hra && form.hra_stay_type === 'out_of_mess' ? form.dorm_location : null,
        });
        toast.success('Member created');
      }
      setDialogOpen(false);
      fetchMembers();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to save member')); }
  };

  const handleStatusChange = (id: number, status: string) => {
    const member = members.find(m => m.id === id);
    setConfirmRequest({
      title: `Mark member as "${status}"?`,
      description: member ? `${member.full_name} (${member.service_number})` : 'This member',
      confirmLabel: 'Confirm',
      reasonLabel: `Reason for marking this member as "${status}"`,
      reasonRequired: true,
      reasonMinLength: 10,
      onConfirm: async (reason) => {
        try {
          await api.post(`/members/${id}/status`, { status, reason });
          toast.success('Member status updated');
          fetchMembers();
        } catch (err) { toast.error(getErrorMessage(err, 'Failed')); }
      },
    });
  };

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = { active: 'bg-green-100 text-green-800', transferred: 'bg-amber-100 text-amber-800', left: 'bg-muted text-muted-foreground' };
    return <Badge className={colors[status] || ''}>{status}</Badge>;
  };

  const activeCount = members.filter(m => m.status === 'active').length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><IdCard size={24} /> Member Management</h1>
        <div className="flex gap-2">
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild><Button onClick={openCreate}><Plus size={16} className="mr-1" /> Add Member</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>{editingId ? 'Edit Member' : 'Add Member'}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Input placeholder="Service Number" value={form.service_number} disabled={!!editingId} onChange={e => setForm({...form, service_number: e.target.value})} />
                <Input placeholder="Full Name" value={form.full_name} onChange={e => setForm({...form, full_name: e.target.value})} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input placeholder="Rank" value={form.rank} onChange={e => setForm({...form, rank: e.target.value})} />
                <Input placeholder="Unit" value={form.unit} onChange={e => setForm({...form, unit: e.target.value})} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Mess Category</Label>
                  <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.mess_category} onChange={e => setForm({...form, mess_category: e.target.value})}>
                    <option value="officers">Officers</option>
                    <option value="jcos">JCOs</option>
                    <option value="ors">ORs</option>
                  </select>
                </div>
                <div>
                  <Label>Dining Status</Label>
                  <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.dining_status} onChange={e => setForm({...form, dining_status: e.target.value})}>
                    <option value="dining">Dining</option>
                    <option value="non_dining">Non-Dining</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input placeholder="Phone" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} />
                <Input placeholder="Email" type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} />
              </div>
              {hasPermission(user, 'members', 'edit') && (
                <div>
                  <Label>Assigned Member Discount (%)</Label>
                  <Input type="number" min={0} max={100} value={form.custom_discount_rate} onChange={e => setForm({...form, custom_discount_rate: Number(e.target.value.replace(/^0+(?=\d)/, ''))})} />
                </div>
              )}
              {hasPermission(user, 'members', 'edit') && (
                <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                  <input type="checkbox" checked={form.is_womens_bloc} onChange={e => setForm({...form, is_womens_bloc: e.target.checked})} className="h-4 w-4 rounded border-gray-300" />
                  Women's Bloc resident (uses the Women's Bloc rank rate for HRA billing instead of the standard HRA rate)
                </label>
              )}
              {hasPermission(user, 'members', 'edit') && (
                <div className="rounded-md border p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <Label>Is HRA?</Label>
                    <div className="flex rounded-md border overflow-hidden text-xs">
                      {([[true, 'Yes'], [false, 'No']] as const).map(([val, label]) => (
                        <button key={String(val)} type="button"
                          className={`px-3 py-1 ${form.is_hra === val ? 'bg-primary text-primary-foreground font-medium' : 'bg-transparent text-muted-foreground hover:text-foreground'}`}
                          onClick={() => setForm({...form, is_hra: val, hra_stay_type: val ? (form.hra_stay_type || 'in_mess') : '', dorm_location: val ? form.dorm_location : ''})}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {form.is_hra && (
                    <div>
                      <Label className="text-xs">Stay Type</Label>
                      <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                        value={form.hra_stay_type} onChange={e => setForm({...form, hra_stay_type: e.target.value, dorm_location: e.target.value === 'in_mess' ? '' : form.dorm_location})}>
                        <option value="in_mess">In-Mess Stay (internal room)</option>
                        <option value="out_of_mess">Out-of-Mess Stay (external dorm)</option>
                      </select>
                      {form.hra_stay_type === 'in_mess' && (
                        <p className="text-xs text-muted-foreground mt-1">Room is assigned via Bookings, not here - book/transfer their room from the Bookings module.</p>
                      )}
                      {form.hra_stay_type === 'out_of_mess' && (
                        <Input className="mt-1.5" placeholder="Dorm Location / Details *" value={form.dorm_location}
                          onChange={e => setForm({...form, dorm_location: e.target.value})} />
                      )}
                    </div>
                  )}
                </div>
              )}
              <Button onClick={handleSave} className="w-full">{editingId ? 'Save Changes' : 'Create Member'}</Button>
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">Active Members</p><p className="text-2xl font-bold">{activeCount}</p></CardContent></Card>
        <Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">Officers</p><p className="text-2xl font-bold">{members.filter(m => m.mess_category === 'officers').length}</p></CardContent></Card>
      </div>

      <div className="relative max-w-sm"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} /><Input placeholder="Search members..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" /></div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Service #</TableHead><TableHead>Name</TableHead><TableHead>Rank</TableHead><TableHead>Unit</TableHead><TableHead>Category</TableHead><TableHead>Dining</TableHead><TableHead>Current Room</TableHead><TableHead>Status</TableHead><TableHead className="w-24">Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Loading members...</TableCell></TableRow>}
              {!loading && members.map(m => (
                <TableRow key={m.id} className="cursor-pointer hover:bg-accent" onClick={() => openEdit(m)}>
                  <TableCell className="font-medium">{m.service_number}</TableCell>
                  <TableCell>{m.full_name}</TableCell>
                  <TableCell>{m.rank}</TableCell>
                  <TableCell>{m.unit || '-'}</TableCell>
                  <TableCell className="capitalize">{m.mess_category}</TableCell>
                  <TableCell>{m.dining_status === 'non_dining' ? <Badge variant="outline">Non-Dining</Badge> : <span className="text-muted-foreground">Dining</span>}</TableCell>
                  <TableCell>
                    {m.current_room_number ? <Badge className="bg-purple-100 text-purple-800">{m.current_room_number} (HRA)</Badge>
                      : m.is_hra && m.hra_stay_type === 'out_of_mess' ? <Badge className="bg-indigo-100 text-indigo-800">{m.dorm_location || 'Out-of-Mess'}</Badge>
                      : m.is_hra ? <Badge variant="outline">HRA - room pending</Badge>
                      : <span className="text-muted-foreground">-</span>}
                  </TableCell>
                  <TableCell>{statusBadge(m.status)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" title="View Ledger" onClick={(e) => { e.stopPropagation(); navigate(`/members/${m.id}`); }}>
                        <Receipt size={16} className="text-blue-600" />
                      </Button>
                      {m.status === 'active' && (
                        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); handleStatusChange(m.id, 'transferred'); }}>
                          <ArrowRightLeft size={16} className="text-amber-600" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && members.length === 0 && <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No members found</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ConfirmDialog request={confirmRequest} onClose={() => setConfirmRequest(null)} />
    </div>
  );
}
