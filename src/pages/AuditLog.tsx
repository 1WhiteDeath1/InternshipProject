import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { ClipboardList, Download, RefreshCw } from 'lucide-react';

interface AuditEntry {
  id: number;
  user_name: string;
  action: string;
  entity_type: string;
  entity_id: number;
  reason: string;
  department: string;
  timestamp: string;
  ip_address: string;
}

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ action: '', entity_type: '', date_from: '', date_to: '' });

  const fetchLogs = async () => {
    try {
      let url = `/audit?page=${page}`;
      if (filters.action) url += `&action=${filters.action}`;
      if (filters.entity_type) url += `&entity_type=${filters.entity_type}`;
      if (filters.date_from) url += `&date_from=${filters.date_from}`;
      if (filters.date_to) url += `&date_to=${filters.date_to}`;
      const res = await api.get(url);
      setLogs(res.data.items);
      setTotal(res.data.total);
    } catch { toast.error('Failed to load audit log'); }
  };

  useEffect(() => { queueMicrotask(() => fetchLogs()); }, [page, filters]);

  const handleExport = async () => {
    try {
      const res = await api.get('/import-export/export/audit', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `audit_log_${new Date().toISOString().slice(0, 10)}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('Audit log exported');
    } catch { toast.error('Export failed'); }
  };

  const actionBadge = (action: string) => {
    const colors: Record<string, string> = {
      create: 'bg-green-100 text-green-800', update: 'bg-blue-100 text-blue-800', delete: 'bg-red-100 text-red-800',
      soft_delete: 'bg-orange-100 text-orange-800', approve: 'bg-purple-100 text-purple-800', transfer: 'bg-cyan-100 text-cyan-800',
      login: 'bg-emerald-100 text-emerald-800', logout: 'bg-gray-100 text-gray-800', override: 'bg-red-100 text-red-800',
    };
    return <Badge className={colors[action] || 'bg-gray-100'}>{action}</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2"><ClipboardList size={24} /> Audit Log</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchLogs}><RefreshCw size={16} className="mr-1" /> Refresh</Button>
          <Button variant="outline" onClick={handleExport}><Download size={16} className="mr-1" /> Export</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3 items-center">
            <Input placeholder="Action" value={filters.action} onChange={e => setFilters({...filters, action: e.target.value})} className="w-40" />
            <Input placeholder="Entity type" value={filters.entity_type} onChange={e => setFilters({...filters, entity_type: e.target.value})} className="w-40" />
            <Input type="date" value={filters.date_from} onChange={e => setFilters({...filters, date_from: e.target.value})} className="w-40" />
            <Input type="date" value={filters.date_to} onChange={e => setFilters({...filters, date_to: e.target.value})} className="w-40" />
            <Button variant="outline" onClick={() => setFilters({ action: '', entity_type: '', date_from: '', date_to: '' })}>Clear</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow><TableHead>ID</TableHead><TableHead>User</TableHead><TableHead>Action</TableHead><TableHead>Entity</TableHead><TableHead>Reason</TableHead><TableHead>Department</TableHead><TableHead>Timestamp</TableHead><TableHead>IP</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {logs.map(log => (
                <TableRow key={log.id}>
                  <TableCell className="text-gray-500">#{log.id}</TableCell>
                  <TableCell className="font-medium">{log.user_name || 'System'}</TableCell>
                  <TableCell>{actionBadge(log.action)}</TableCell>
                  <TableCell>{log.entity_type} #{log.entity_id}</TableCell>
                  <TableCell className="max-w-[200px] truncate">{log.reason || '-'}</TableCell>
                  <TableCell>{log.department || '-'}</TableCell>
                  <TableCell className="text-sm text-gray-500">{new Date(log.timestamp).toLocaleString()}</TableCell>
                  <TableCell className="text-sm text-gray-500">{log.ip_address || '-'}</TableCell>
                </TableRow>
              ))}
              {logs.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-8 text-gray-500">No audit entries found</TableCell></TableRow>}
            </TableBody>
          </Table>
          {total > 25 && (
            <div className="flex items-center justify-between p-4 border-t">
              <p className="text-sm text-gray-500">Showing {logs.length} of {total} entries</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
                <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
