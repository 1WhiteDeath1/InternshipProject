import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/useAuth';
import { hasPermission } from '@/contexts/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { ClipboardCheck, CheckCircle2, XCircle, FileEdit, UtensilsCrossed } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import { ConfirmDialog, type ConfirmRequest } from '@/components/ConfirmDialog';

// The Manager/Deputy Manager decision queue. There's no procurement
// approval here - the mess buys and restocks itself (Kitchen NCO logs it
// via Daily Stock Intake), no PO to sign off on. Discounts/comps aren't
// here either - those are the Manager's own direct authority via the
// Guest Discounts / Member Discounts pages, no approval step. What IS
// here: a Clerk's request to CORRECT a line item on an already-generated
// bill (wrong rate/charge entered) - a different, rarer action than a
// routine discount - and Kitchen NCO's proposed menu/price changes.
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

export default function Approvals() {
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
        <ClipboardCheck size={24} className="text-muted-foreground" />
        <h1 className="text-2xl font-bold text-foreground">Approvals</h1>
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
