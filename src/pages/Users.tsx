import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Search, Plus, Unlock, UserX } from 'lucide-react';
import { ConfirmDialog, type ConfirmRequest } from '@/components/ConfirmDialog';

interface User {
  id: number;
  username: string;
  full_name: string;
  email: string;
  role_name: string;
  status: string;
  last_login: string;
  is_supervisor: boolean;
}

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState('');
  const [roles, setRoles] = useState<{id: number; name: string}[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ username: '', email: '', full_name: '', password: '', role_id: 0 });
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);

  const fetchUsers = async () => {
    try {
      const res = await api.get(`/users?search=${search}`);
      setUsers(res.data.items);
    } catch { toast.error('Failed to load users'); }
  };

  const fetchRoles = async () => {
    try { const res = await api.get('/roles'); setRoles(res.data); } catch { toast.error('Failed to load roles'); }
  };

  useEffect(() => { queueMicrotask(() => { fetchUsers(); fetchRoles(); }); }, [search]);

  const handleCreate = async () => {
    try {
      await api.post('/users', form);
      toast.success('User created');
      setDialogOpen(false);
      fetchUsers();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed')); }
  };

  const handleUnlock = async (id: number) => {
    try { await api.post(`/users/${id}/unlock`); toast.success('User unlocked'); fetchUsers(); }
    catch { toast.error('Failed'); }
  };

  const handleDelete = (u: User) => {
    setConfirmRequest({
      title: `Delete "${u.full_name}"?`,
      description: `${u.username} - this deactivates the account (blocks login) rather than erasing their history; audit and record ownership are preserved.`,
      confirmLabel: 'Delete User',
      destructive: true,
      reasonLabel: 'Reason for deleting this user',
      reasonRequired: true,
      reasonMinLength: 10,
      onConfirm: async (reason) => {
        try {
          await api.delete(`/users/${u.id}?reason=${encodeURIComponent(reason)}`);
          toast.success('User deleted');
          fetchUsers();
        } catch (err) { toast.error(getErrorMessage(err, 'Failed to delete user')); }
      },
    });
  };

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = { active: 'bg-green-100 text-green-800', inactive: 'bg-muted text-muted-foreground', suspended: 'bg-amber-100 text-amber-800', locked: 'bg-red-100 text-red-800' };
    return <Badge className={colors[status] || ''}>{status}</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">User Management</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild><Button><Plus size={16} className="mr-1" /> Add User</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create User</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Input placeholder="Full name" value={form.full_name} onChange={e => setForm({...form, full_name: e.target.value})} />
              <Input placeholder="Username" value={form.username} onChange={e => setForm({...form, username: e.target.value})} />
              <Input placeholder="Email" type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} />
              <Input placeholder="Password" type="password" value={form.password} onChange={e => setForm({...form, password: e.target.value})} />
              <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.role_id} onChange={e => setForm({...form, role_id: Number(e.target.value)})}>
                <option value="0">Select role</option>
                {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <Button onClick={handleCreate} className="w-full">Create User</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative max-w-sm"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} /><Input placeholder="Search users..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" /></div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Username</TableHead><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead>Status</TableHead><TableHead>Last Login</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {users.map(u => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.full_name}</TableCell>
                  <TableCell>{u.username}</TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell><Badge variant={u.is_supervisor ? 'default' : 'secondary'}>{u.role_name}</Badge></TableCell>
                  <TableCell>{statusBadge(u.status)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{u.last_login ? new Date(u.last_login).toLocaleDateString() : 'Never'}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {u.status === 'locked' && <Button size="sm" variant="ghost" title="Unlock" onClick={() => handleUnlock(u.id)}><Unlock size={16} className="text-green-600" /></Button>}
                      {u.status !== 'inactive' && u.id !== currentUser?.id && (
                        <Button size="sm" variant="ghost" title="Delete User" onClick={() => handleDelete(u)}><UserX size={16} className="text-red-600" /></Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {users.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No users found</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ConfirmDialog request={confirmRequest} onClose={() => setConfirmRequest(null)} />
    </div>
  );
}
