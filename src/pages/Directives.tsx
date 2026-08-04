import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/useAuth';
import { hasPermission } from '@/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { MessageSquare, Send, Check } from 'lucide-react';

interface DirectiveItem {
  id: number;
  from_user_id: number;
  from_user_name: string | null;
  to_role_id: number;
  to_role_name: string | null;
  message: string;
  status: string;
  acknowledged_by_name: string | null;
  acknowledged_at: string | null;
  created_at: string;
}

interface RoleOption { id: number; name: string; }

export default function Directives() {
  const { user } = useAuth();
  const canSend = hasPermission(user, 'directives', 'create');
  const [items, setItems] = useState<DirectiveItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [toRoleId, setToRoleId] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const fetchDirectives = async () => {
    try {
      const res = await api.get('/directives?page_size=100');
      setItems(res.data.items);
    } catch { toast.error('Failed to load directives'); }
  };

  useEffect(() => {
    queueMicrotask(() => { setLoading(true); fetchDirectives().finally(() => setLoading(false)); });
  }, []);

  useEffect(() => {
    if (!canSend) return;
    queueMicrotask(() => {
      api.get('/roles').then(res => setRoles(res.data.map((r: RoleOption) => ({ id: r.id, name: r.name })))).catch(() => {});
    });
  }, [canSend]);

  const send = async () => {
    if (!toRoleId || !message.trim()) { toast.error('Pick a role and enter a message'); return; }
    setSending(true);
    try {
      await api.post('/directives', { to_role_id: Number(toRoleId), message: message.trim() });
      toast.success('Directive sent');
      setMessage('');
      setToRoleId('');
      fetchDirectives();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to send directive')); }
    finally { setSending(false); }
  };

  const acknowledge = async (id: number) => {
    try {
      await api.post(`/directives/${id}/acknowledge`);
      fetchDirectives();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to acknowledge')); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><MessageSquare size={24} /> Directives</h1>
      </div>

      {canSend && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <p className="text-sm font-semibold">Send a directive</p>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
              <div className="sm:col-span-1">
                <Label className="text-xs">To role</Label>
                <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={toRoleId} onChange={e => setToRoleId(e.target.value)}>
                  <option value="">Select role…</option>
                  {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <div className="sm:col-span-3">
                <Label className="text-xs">Message</Label>
                <Textarea rows={2} placeholder="e.g. Book Room 12 for Col Ahmed arriving tomorrow" value={message} onChange={e => setMessage(e.target.value)} />
              </div>
            </div>
            <Button size="sm" disabled={sending} onClick={send}><Send size={14} className="mr-1" /> Send</Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0 divide-y">
          {loading && <p className="text-center py-8 text-muted-foreground">Loading directives...</p>}
          {!loading && items.length === 0 && <p className="text-center py-8 text-muted-foreground">No directives</p>}
          {!loading && items.map(d => (
            <div key={d.id} className="p-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant={d.status === 'new' ? 'default' : 'outline'}>{d.to_role_name}</Badge>
                  {d.status === 'acknowledged' && <span className="text-xs text-muted-foreground">Acknowledged{d.acknowledged_by_name ? ` by ${d.acknowledged_by_name}` : ''}</span>}
                </div>
                <p className="text-sm">{d.message}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  From {d.from_user_name || 'Manager'} · {new Date(d.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              {d.status === 'new' && d.to_role_id === user?.role_id && (
                <Button size="sm" variant="outline" onClick={() => acknowledge(d.id)}><Check size={14} className="mr-1" /> Acknowledge</Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
