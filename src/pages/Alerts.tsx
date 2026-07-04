import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Bell, AlertTriangle, CheckCircle, ShieldAlert, RotateCw } from 'lucide-react';

interface Alert {
  id: number;
  title: string;
  message: string;
  severity: string;
  status: string;
  module: string;
  created_at: string;
}

export default function Alerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchAlerts = async () => {
    try {
      const res = await api.get('/alerts');
      setAlerts(res.data.items);
    } catch { toast.error('Failed to load alerts'); }
  };

  const fetchUnread = async () => {
    try { const res = await api.get('/alerts/unread-count'); setUnreadCount(res.data.count); } catch { /* badge just stays at its last known value */ }
  };

  useEffect(() => { queueMicrotask(() => { fetchAlerts(); fetchUnread(); }); }, []);

  const handleAcknowledge = async (id: number) => {
    try { await api.post(`/alerts/${id}/acknowledge`); toast.success('Acknowledged'); fetchAlerts(); fetchUnread(); } catch { toast.error('Failed to acknowledge alert'); }
  };

  const handleResolve = async (id: number) => {
    try { await api.post(`/alerts/${id}/resolve`); toast.success('Resolved'); fetchAlerts(); fetchUnread(); } catch { toast.error('Failed to resolve alert'); }
  };

  const runChecks = async () => {
    try { await api.post('/alerts/run-checks'); toast.success('Alert checks completed'); fetchAlerts(); fetchUnread(); } catch { toast.error('Failed to run checks'); }
  };

  const severityBadge = (sev: string) => {
    const colors: Record<string, string> = {
      low: 'bg-blue-100 text-blue-800', medium: 'bg-amber-100 text-amber-800',
      high: 'bg-orange-100 text-orange-800', critical: 'bg-red-100 text-red-800',
    };
    return <Badge className={colors[sev] || ''}>{sev}</Badge>;
  };

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      new: 'bg-red-100 text-red-800 animate-pulse', acknowledged: 'bg-blue-100 text-blue-800',
      resolved: 'bg-green-100 text-green-800', dismissed: 'bg-gray-100 text-gray-800',
    };
    return <Badge className={colors[status] || ''}>{status}</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Alerts</h1>
          {unreadCount > 0 && <Badge variant="destructive" className="animate-pulse">{unreadCount} new</Badge>}
        </div>
        <Button variant="outline" onClick={runChecks}><RotateCw size={16} className="mr-1" /> Run Checks</Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {['new', 'acknowledged', 'resolved', 'all'].map(status => {
          const count = status === 'all' ? alerts.length : alerts.filter(a => a.status === status).length;
          const icons = { new: Bell, acknowledged: CheckCircle, resolved: ShieldAlert, all: AlertTriangle };
          const Icon = icons[status as keyof typeof icons];
          return (
            <Card key={status} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => {}}>
              <CardContent className="p-5 flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                  <Icon size={20} className="text-gray-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-500 capitalize">{status}</p>
                  <p className="text-2xl font-bold">{count}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Title</TableHead><TableHead>Message</TableHead><TableHead>Severity</TableHead><TableHead>Status</TableHead><TableHead>Module</TableHead><TableHead>Created</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {alerts.map(alert => (
                <TableRow key={alert.id} className={alert.status === 'new' ? 'bg-red-50/50 dark:bg-red-950/10' : ''}>
                  <TableCell className="font-medium">{alert.title}</TableCell>
                  <TableCell className="max-w-[300px] truncate">{alert.message}</TableCell>
                  <TableCell>{severityBadge(alert.severity)}</TableCell>
                  <TableCell>{statusBadge(alert.status)}</TableCell>
                  <TableCell className="capitalize">{alert.module}</TableCell>
                  <TableCell className="text-sm text-gray-500">{new Date(alert.created_at).toLocaleString()}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {alert.status === 'new' && <Button size="sm" variant="ghost" onClick={() => handleAcknowledge(alert.id)}><CheckCircle size={16} className="text-blue-600" /></Button>}
                      {alert.status !== 'resolved' && <Button size="sm" variant="ghost" onClick={() => handleResolve(alert.id)}><ShieldAlert size={16} className="text-green-600" /></Button>}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {alerts.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-8 text-gray-500">No alerts</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
