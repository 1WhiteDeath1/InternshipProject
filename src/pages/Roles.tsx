import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { Plus, Shield } from 'lucide-react';

const MODULES = ['inventory', 'procurement', 'bookings', 'billing', 'security', 'users', 'reports'];
const ACTIONS = ['view', 'create', 'edit', 'approve'];

interface Permission {
  module: string;
  action: string;
}

interface Role {
  id: number;
  name: string;
  description: string;
  is_supervisor: boolean;
  permissions: Permission[];
}

export default function Roles() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', is_supervisor: false, permissions: [] as Permission[] });

  const fetchRoles = async () => {
    try { const res = await api.get('/roles'); setRoles(res.data); } catch { toast.error('Failed to load roles'); }
  };

  useEffect(() => { queueMicrotask(() => fetchRoles()); }, []);

  const handleCreate = async () => {
    try {
      await api.post('/roles', form);
      toast.success('Role created');
      setDialogOpen(false);
      fetchRoles();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed')); }
  };

  const togglePerm = (module: string, action: string) => {
    const exists = form.permissions.find(p => p.module === module && p.action === action);
    if (exists) {
      setForm({...form, permissions: form.permissions.filter(p => !(p.module === module && p.action === action))});
    } else {
      setForm({...form, permissions: [...form.permissions, { module, action }]});
    }
  };

  const hasPerm = (module: string, action: string) => form.permissions.some(p => p.module === module && p.action === action);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Role Management</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild><Button><Plus size={16} className="mr-1" /> Create Role</Button></DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Create Role</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <Input placeholder="Role name" value={form.name} onChange={e => setForm({...form, name: e.target.value})} />
              <Input placeholder="Description" value={form.description} onChange={e => setForm({...form, description: e.target.value})} />
              <div className="flex items-center gap-2"><Checkbox checked={form.is_supervisor} onCheckedChange={(c) => setForm({...form, is_supervisor: c as boolean})} /><Label>Supervisor (full access)</Label></div>
              {!form.is_supervisor && (
                <div className="border rounded-lg p-4 space-y-3">
                  <p className="font-medium">Permissions</p>
                  {MODULES.map(mod => (
                    <div key={mod} className="flex items-center gap-4">
                      <span className="w-32 text-sm font-medium capitalize">{mod}</span>
                      {ACTIONS.map(action => (
                        <label key={action} className="flex items-center gap-1.5 text-sm cursor-pointer">
                          <Checkbox checked={hasPerm(mod, action)} onCheckedChange={() => togglePerm(mod, action)} />
                          <span className="capitalize">{action}</span>
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              )}
              <Button onClick={handleCreate} className="w-full">Create Role</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Description</TableHead><TableHead>Type</TableHead><TableHead>Permissions</TableHead></TableRow></TableHeader>
            <TableBody>
              {roles.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>{r.description}</TableCell>
                  <TableCell>{r.is_supervisor ? <Badge className="bg-purple-100 text-purple-800"><Shield size={12} className="mr-1" /> Supervisor</Badge> : <Badge variant="outline">Standard</Badge>}</TableCell>
                  <TableCell>{r.permissions?.length || 0} permissions</TableCell>
                </TableRow>
              ))}
              {roles.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No roles defined</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
