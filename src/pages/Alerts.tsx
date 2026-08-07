import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/useAuth';
import { hasPermission } from '@/contexts/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  Bell, AlertTriangle, CheckCircle, ShieldAlert, RotateCw,
  ClipboardCheck, CheckCircle2, XCircle, FileEdit, UtensilsCrossed,
} from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import { ConfirmDialog, type ConfirmRequest } from '@/components/ConfirmDialog';
import { AnomalyMiniChart, type AnomalyDetail } from '@/components/AnomalyMiniChart';
import {
  Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip, Cell,
} from 'recharts';

interface AlertRow {
  id: number;
  title: string;
  message: string;
  severity: string;
  status: string;
  module: string;
  entity_type: string | null;
  detail: AnomalyDetail | Record<string, string | number | null> | null;
  created_at: string;
}

interface EditRequest {
  id: number; invoice_id: number; invoice_item_id: number; bill_type: string;
  original_description: string; original_unit_price: number;
  proposed_description: string; proposed_unit_price: number;
  reason: string; status: string;
  requested_by_name: string | null; requested_at: string;
  guest_name: string | null; room_number: string | null;
}

interface MenuEditRequest {
  id: number; is_new_item: boolean;
  original_name: string | null; original_price: number | null;
  proposed_name: string; proposed_price: number; proposed_meal_type: string; proposed_day_of_week: string | null;
  reason: string | null; status: string;
  requested_by_name: string | null; requested_at: string;
}

const BILL_LABELS: Record<string, string> = { room: 'Room Bill', mess: 'Mess Bill', combined: 'Bill' };
const SEVERITY_COLORS: Record<string, string> = {
  low: 'hsl(var(--chart-2))', medium: 'hsl(var(--chart-3))', warning: 'hsl(43 96% 56%)',
  high: 'hsl(217 91% 55%)', critical: 'hsl(var(--destructive))',
};

function severityBadge(sev: string) {
  const colors: Record<string, string> = {
    low: 'bg-blue-100 text-blue-800', medium: 'bg-amber-100 text-amber-800', warning: 'bg-yellow-100 text-yellow-800',
    high: 'bg-orange-100 text-orange-800', critical: 'bg-red-100 text-red-800',
  };
  return <Badge className={colors[sev] || ''}>{sev}</Badge>;
}

function statusBadge(status: string) {
  const colors: Record<string, string> = {
    new: 'bg-red-100 text-red-800 animate-pulse', acknowledged: 'bg-blue-100 text-blue-800',
    resolved: 'bg-green-100 text-green-800', dismissed: 'bg-muted text-muted-foreground',
  };
  return <Badge className={colors[status] || ''}>{status}</Badge>;
}

function AlertsTab() {
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [detailAlert, setDetailAlert] = useState<AlertRow | null>(null);
  const [moduleFilter, setModuleFilter] = useState('all');

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

  // By-severity breakdown, computed client-side from the already-fetched
  // list - a quick "where's the heat" glance to sit next to the status
  // counts below, rather than a whole separate reporting endpoint.
  const severityData = useMemo(() => {
    const counts: Record<string, number> = { low: 0, medium: 0, warning: 0, high: 0, critical: 0 };
    for (const a of alerts) counts[a.severity] = (counts[a.severity] || 0) + 1;
    return Object.entries(counts).map(([severity, count]) => ({ severity, count }));
  }, [alerts]);

  const moduleOptions = useMemo(() => Array.from(new Set(alerts.map(a => a.module))).sort(), [alerts]);
  const filteredAlerts = useMemo(() => moduleFilter === 'all' ? alerts : alerts.filter(a => a.module === moduleFilter), [alerts, moduleFilter]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Alerts</h2>
          {unreadCount > 0 && <Badge variant="destructive" className="animate-pulse">{unreadCount} new</Badge>}
        </div>
        <div className="flex items-center gap-2">
          <select className="h-9 rounded-md border border-input bg-background px-3 text-sm capitalize" value={moduleFilter} onChange={e => setModuleFilter(e.target.value)}>
            <option value="all">All Types</option>
            {moduleOptions.map(m => <option key={m} value={m} className="capitalize">{m}</option>)}
          </select>
          <Button variant="outline" onClick={runChecks}><RotateCw size={16} className="mr-1" /> Run Checks</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {['new', 'acknowledged', 'resolved', 'all'].map(status => {
          const count = status === 'all' ? alerts.length : alerts.filter(a => a.status === status).length;
          const icons = { new: Bell, acknowledged: CheckCircle, resolved: ShieldAlert, all: AlertTriangle };
          const Icon = icons[status as keyof typeof icons];
          return (
            <Card key={status}>
              <CardContent className="p-5 flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                  <Icon size={20} className="text-muted-foreground" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground capitalize">{status}</p>
                  <p className="text-2xl font-bold">{count}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
        <Card className="col-span-2 lg:col-span-1">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground mb-1">By severity</p>
            <div className="h-16">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={severityData} margin={{ top: 2, right: 4, left: 4, bottom: 0 }}>
                  <XAxis dataKey="severity" tick={{ fontSize: 9 }} interval={0} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                    {severityData.map(d => <Cell key={d.severity} fill={SEVERITY_COLORS[d.severity]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Title</TableHead><TableHead>Message</TableHead><TableHead>Severity</TableHead><TableHead>Status</TableHead><TableHead>Module</TableHead><TableHead>Created</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {filteredAlerts.map(alert => (
                <TableRow
                  key={alert.id}
                  className={`cursor-pointer ${alert.status === 'new' ? 'bg-red-50/50 dark:bg-red-950/10' : ''}`}
                  onClick={() => setDetailAlert(alert)}
                >
                  <TableCell className="font-medium">{alert.title}</TableCell>
                  <TableCell className="max-w-[300px] truncate">{alert.message}</TableCell>
                  <TableCell>{severityBadge(alert.severity)}</TableCell>
                  <TableCell>{statusBadge(alert.status)}</TableCell>
                  <TableCell className="capitalize">{alert.module}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{new Date(alert.created_at).toLocaleString()}</TableCell>
                  <TableCell>
                    <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                      {alert.status === 'new' && <Button size="sm" variant="ghost" onClick={() => handleAcknowledge(alert.id)}><CheckCircle size={16} className="text-blue-600" /></Button>}
                      {alert.status !== 'resolved' && <Button size="sm" variant="ghost" onClick={() => handleResolve(alert.id)}><ShieldAlert size={16} className="text-green-600" /></Button>}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {filteredAlerts.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No alerts{moduleFilter === 'all' ? '' : ` for ${moduleFilter}`}</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!detailAlert} onOpenChange={open => { if (!open) setDetailAlert(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{detailAlert?.title}</DialogTitle></DialogHeader>
          {detailAlert && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                {severityBadge(detailAlert.severity)}
                {statusBadge(detailAlert.status)}
                <Badge variant="outline" className="capitalize">{detailAlert.module}</Badge>
              </div>
              <p className="text-sm">{detailAlert.message}</p>
              <p className="text-xs text-muted-foreground">Created {new Date(detailAlert.created_at).toLocaleString()}</p>

              {detailAlert.detail && 'kind' in detailAlert.detail && (
                <AnomalyMiniChart detail={detailAlert.detail as AnomalyDetail} />
              )}
              {detailAlert.detail && !('kind' in detailAlert.detail) && (
                <div className="rounded-md border p-3 text-sm space-y-1">
                  {Object.entries(detailAlert.detail).map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-3">
                      <span className="text-muted-foreground capitalize">{k.replace(/_/g, ' ')}</span>
                      <span className="font-medium">{String(v)}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                {detailAlert.status === 'new' && (
                  <Button size="sm" variant="outline" onClick={() => { handleAcknowledge(detailAlert.id); setDetailAlert(null); }}>
                    <CheckCircle size={14} className="mr-1" /> Acknowledge
                  </Button>
                )}
                {detailAlert.status !== 'resolved' && (
                  <Button size="sm" onClick={() => { handleResolve(detailAlert.id); setDetailAlert(null); }}>
                    <ShieldAlert size={14} className="mr-1" /> Resolve
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ApprovalsTab() {
  const { user } = useAuth();
  const [editRequests, setEditRequests] = useState<EditRequest[]>([]);
  const [menuRequests, setMenuRequests] = useState<MenuEditRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState<number | null>(null);
  const [decidingMenu, setDecidingMenu] = useState<number | null>(null);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);

  const canApproveBillEdits = hasPermission(user, 'billing', 'approve');
  const canApproveMenu = hasPermission(user, 'menu', 'approve');

  const fetchPending = async () => {
    setLoading(true);
    try {
      const [editRes, menuRes] = await Promise.all([
        canApproveBillEdits ? api.get('/billing/edit-requests?status=pending') : Promise.resolve({ data: [] }),
        canApproveMenu ? api.get('/kitchen/menu/edit-requests?status=pending') : Promise.resolve({ data: [] }),
      ]);
      setEditRequests(editRes.data || []);
      setMenuRequests(menuRes.data || []);
    } catch {
      toast.error('Failed to load approvals');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { queueMicrotask(fetchPending); }, []);

  const approveEdit = async (req: EditRequest) => {
    setDeciding(req.id);
    try {
      await api.post(`/billing/edit-requests/${req.id}/approve`);
      toast.success('Correction approved and applied to the bill');
      fetchPending();
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setDeciding(null);
    }
  };

  const rejectEdit = (req: EditRequest) => {
    setConfirmRequest({
      title: 'Reject this correction?',
      description: `${req.proposed_description} — ${formatCurrency(req.proposed_unit_price)}`,
      confirmLabel: 'Reject',
      destructive: true,
      reasonLabel: 'Reason for rejecting this correction',
      reasonRequired: true,
      reasonMinLength: 10,
      onConfirm: async (reason) => {
        setDeciding(req.id);
        try {
          await api.post(`/billing/edit-requests/${req.id}/reject`, { reason });
          toast.success('Correction rejected');
          fetchPending();
        } catch (e) {
          toast.error(getErrorMessage(e));
        } finally {
          setDeciding(null);
        }
      },
    });
  };

  const approveMenu = async (req: MenuEditRequest) => {
    setDecidingMenu(req.id);
    try {
      await api.post(`/kitchen/menu/edit-requests/${req.id}/approve`);
      toast.success('Menu change approved');
      fetchPending();
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setDecidingMenu(null);
    }
  };

  const rejectMenu = (req: MenuEditRequest) => {
    setConfirmRequest({
      title: 'Reject this menu change?',
      description: `${req.proposed_name} — ${formatCurrency(req.proposed_price)}`,
      confirmLabel: 'Reject',
      destructive: true,
      reasonLabel: 'Reason for rejecting this menu change',
      reasonRequired: true,
      reasonMinLength: 10,
      onConfirm: async (reason) => {
        setDecidingMenu(req.id);
        try {
          await api.post(`/kitchen/menu/edit-requests/${req.id}/reject`, { reason });
          toast.success('Menu change rejected');
          fetchPending();
        } catch (e) {
          toast.error(getErrorMessage(e));
        } finally {
          setDecidingMenu(null);
        }
      },
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold">Approvals</h2>
        {editRequests.length > 0 && <Badge variant="destructive">{editRequests.length} bill correction{editRequests.length > 1 ? 's' : ''} pending</Badge>}
        {menuRequests.length > 0 && <Badge variant="destructive">{menuRequests.length} menu change{menuRequests.length > 1 ? 's' : ''} pending</Badge>}
      </div>

      {canApproveBillEdits && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <FileEdit size={18} /> Bill Corrections
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Guest</TableHead>
                  <TableHead>Bill</TableHead>
                  <TableHead>Change</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Requested by</TableHead>
                  <TableHead className="text-right">Decision</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {editRequests.map(req => (
                  <TableRow key={req.id}>
                    <TableCell className="font-medium">
                      {req.guest_name || '—'}
                      {req.room_number && <span className="text-muted-foreground"> · Room {req.room_number}</span>}
                    </TableCell>
                    <TableCell>{BILL_LABELS[req.bill_type] || 'Bill'}</TableCell>
                    <TableCell className="text-sm">
                      <p className="text-muted-foreground line-through">{req.original_description} — {formatCurrency(req.original_unit_price)}</p>
                      <p className="font-medium">{req.proposed_description} — {formatCurrency(req.proposed_unit_price)}</p>
                    </TableCell>
                    <TableCell className="text-sm max-w-xs">{req.reason}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{req.requested_by_name || '—'}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button size="sm" disabled={deciding === req.id} onClick={() => approveEdit(req)} className="mr-1.5">
                        <CheckCircle2 size={14} className="mr-1" /> Approve
                      </Button>
                      <Button size="sm" variant="outline" disabled={deciding === req.id} onClick={() => rejectEdit(req)}>
                        <XCircle size={14} className="mr-1" /> Reject
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!loading && editRequests.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                    No bill corrections awaiting approval ✓
                  </TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {canApproveMenu && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <UtensilsCrossed size={18} /> Menu Changes
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Change</TableHead>
                  <TableHead>Meal</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Requested by</TableHead>
                  <TableHead className="text-right">Decision</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {menuRequests.map(req => (
                  <TableRow key={req.id}>
                    <TableCell className="text-sm">
                      {req.is_new_item ? (
                        <p className="font-medium">New item: {req.proposed_name} — {formatCurrency(req.proposed_price)}</p>
                      ) : (
                        <>
                          <p className="text-muted-foreground line-through">{req.original_name} — {formatCurrency(req.original_price || 0)}</p>
                          <p className="font-medium">{req.proposed_name} — {formatCurrency(req.proposed_price)}</p>
                        </>
                      )}
                    </TableCell>
                    <TableCell className="text-sm capitalize">{req.proposed_meal_type}{req.proposed_day_of_week && ` · ${req.proposed_day_of_week}`}</TableCell>
                    <TableCell className="text-sm max-w-xs">{req.reason || '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{req.requested_by_name || '—'}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button size="sm" disabled={decidingMenu === req.id} onClick={() => approveMenu(req)} className="mr-1.5">
                        <CheckCircle2 size={14} className="mr-1" /> Approve
                      </Button>
                      <Button size="sm" variant="outline" disabled={decidingMenu === req.id} onClick={() => rejectMenu(req)}>
                        <XCircle size={14} className="mr-1" /> Reject
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!loading && menuRequests.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
                    No menu changes awaiting approval ✓
                  </TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {!canApproveBillEdits && !canApproveMenu && (
        <Card>
          <CardContent className="text-center py-10 text-muted-foreground">Nothing to approve for your role.</CardContent>
        </Card>
      )}

      <ConfirmDialog request={confirmRequest} onClose={() => setConfirmRequest(null)} />
    </div>
  );
}

export default function Alerts() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const canViewAlerts = hasPermission(user, 'alerts', 'view');
  const canApprove = hasPermission(user, 'billing', 'approve') || hasPermission(user, 'menu', 'approve');

  const requested = searchParams.get('tab');
  const tab = requested === 'approvals' && canApprove ? 'approvals' : requested === 'alerts' && canViewAlerts ? 'alerts' : canViewAlerts ? 'alerts' : 'approvals';

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><ClipboardCheck size={24} /> Alerts & Approvals</h1>

      <Tabs value={tab} onValueChange={v => setSearchParams(v === 'alerts' ? {} : { tab: v })}>
        <TabsList>
          {canViewAlerts && <TabsTrigger value="alerts">Alerts</TabsTrigger>}
          {canApprove && <TabsTrigger value="approvals">Approvals</TabsTrigger>}
        </TabsList>
        {canViewAlerts && <TabsContent value="alerts"><AlertsTab /></TabsContent>}
        {canApprove && <TabsContent value="approvals"><ApprovalsTab /></TabsContent>}
      </Tabs>
    </div>
  );
}
