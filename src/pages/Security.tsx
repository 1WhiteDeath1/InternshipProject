import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';

interface SecurityLog {
  event_type: string;
  guest_name: string | null;
  room_number: string | null;
  timestamp: string;
  processed_by: number | null;
}

interface IncidentReport {
  id: number;
  title: string;
  location: string | null;
  severity: string;
  status: string;
  created_at: string;
}

export default function Security() {
  const [logs, setLogs] = useState<SecurityLog[]>([]);
  const [incidents, setIncidents] = useState<IncidentReport[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', location: '', category: 'other', severity: 'low' });

  const fetchLogs = async () => {
    try { const res = await api.get('/security/logs'); setLogs(res.data.items); } catch { toast.error('Failed to load security logs'); }
  };

  const fetchIncidents = async () => {
    try { const res = await api.get('/security/incidents'); setIncidents(res.data.items); } catch { toast.error('Failed to load incidents'); }
  };

  useEffect(() => { queueMicrotask(() => { fetchLogs(); fetchIncidents(); }); }, []);

  // Refresh if the global "+ Report Incident" top-bar shortcut is used
  // while this page is already mounted.
  useEffect(() => {
    window.addEventListener('incidents:changed', fetchIncidents);
    return () => window.removeEventListener('incidents:changed', fetchIncidents);
  }, []);

  const handleCreate = async () => {
    try { await api.post('/security/incidents', form); toast.success('Incident reported'); setDialogOpen(false); fetchIncidents(); }
    catch { toast.error('Failed'); }
  };

  const severityBadge = (sev: string) => {
    const colors: Record<string, string> = { low: 'bg-blue-100 text-blue-800', medium: 'bg-amber-100 text-amber-800', high: 'bg-orange-100 text-orange-800', critical: 'bg-red-100 text-red-800' };
    return <Badge className={colors[sev] || ''}>{sev}</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Security</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild><Button><Plus size={16} className="mr-1" /> Report Incident</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Security Incident Report</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Input placeholder="Title" value={form.title} onChange={e => setForm({...form, title: e.target.value})} />
              <textarea className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px]" placeholder="Description" value={form.description} onChange={e => setForm({...form, description: e.target.value})} />
              <Input placeholder="Location" value={form.location} onChange={e => setForm({...form, location: e.target.value})} />
              <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.severity} onChange={e => setForm({...form, severity: e.target.value})}>
                <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
              </select>
              <Button onClick={handleCreate} className="w-full">Submit Report</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="logs">
        <TabsList className="grid w-full grid-cols-2 max-w-xs"><TabsTrigger value="logs">Check-in/out Log</TabsTrigger><TabsTrigger value="incidents">Incidents</TabsTrigger></TabsList>

        <TabsContent value="logs">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Event</TableHead><TableHead>Guest</TableHead><TableHead>Room</TableHead><TableHead>Time</TableHead><TableHead>Processed By</TableHead></TableRow></TableHeader>
                <TableBody>
                  {logs.map((log, i) => (
                    <TableRow key={i}>
                      <TableCell><Badge variant={log.event_type === 'check_in' ? 'default' : 'secondary'}>{log.event_type}</Badge></TableCell>
                      <TableCell>{log.guest_name}</TableCell>
                      <TableCell>{log.room_number}</TableCell>
                      <TableCell>{new Date(log.timestamp).toLocaleString()}</TableCell>
                      <TableCell>#{log.processed_by}</TableCell>
                    </TableRow>
                  ))}
                  {logs.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No security logs</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="incidents">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Title</TableHead><TableHead>Location</TableHead><TableHead>Severity</TableHead><TableHead>Status</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
                <TableBody>
                  {incidents.map(inc => (
                    <TableRow key={inc.id}>
                      <TableCell className="font-medium">{inc.title}</TableCell>
                      <TableCell>{inc.location}</TableCell>
                      <TableCell>{severityBadge(inc.severity)}</TableCell>
                      <TableCell><Badge variant={inc.status === 'open' ? 'destructive' : 'outline'}>{inc.status}</Badge></TableCell>
                      <TableCell>{new Date(inc.created_at).toLocaleDateString()}</TableCell>
                    </TableRow>
                  ))}
                  {incidents.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No incidents reported</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
