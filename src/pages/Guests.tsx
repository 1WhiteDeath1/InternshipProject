import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/useAuth';
import { hasPermission } from '@/contexts/auth-context';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Search, Users as UsersIcon, Eye } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import { BillPrintView } from '@/components/BillPrint';

const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: 'serving_officer', label: 'Serving Officer' },
  { value: 'retired_officer', label: 'Retired Officer' },
  { value: 'civilian', label: 'Civilian' },
  { value: 'permanent_member', label: 'Member' },
  { value: 'non_member_civilian', label: 'Non-Member Civilian' },
  { value: 'non_member_non_civilian', label: 'Non-Member Non-Civilian' },
];

interface GuestListItem {
  id: number;
  full_name: string;
  id_number: string | null;
  phone: string | null;
  classification: string | null;
  rank: string | null;
  last_arrival_date: string | null;
  total_arrivals: number;
}

interface GuestBookingSummary {
  id: number;
  booking_reference: string;
  room_number: string | null;
  check_in: string;
  check_out: string;
  status: string;
  rank: string | null;
  client_category: string;
  total_amount: number | null;
}

interface GuestInvoiceSummary {
  id: number;
  invoice_number: string;
  bill_type: string;
  issue_date: string;
  total_amount: number;
  amount_paid: number;
  status: string;
  is_complimentary: boolean;
}

interface GuestProfile {
  id: number;
  full_name: string;
  phone: string | null;
  id_type: string | null;
  id_number: string | null;
  unit_address: string | null;
  created_at: string;
  updated_at: string;
  bookings: GuestBookingSummary[];
  invoices: GuestInvoiceSummary[];
}

const classificationLabel = (c: string | null) => {
  if (!c) return '—';
  const labels: Record<string, string> = {
    permanent_member: 'Member', non_member_civilian: 'Civilian', non_member_non_civilian: 'Non-Civilian',
    serving_officer: 'Serving Officer', retired_officer: 'Retired Officer',
  };
  return labels[c] || c;
};

export default function Guests() {
  const { user } = useAuth();
  const canOverrideCategory = hasPermission(user, 'bookings', 'approve');
  const [guests, setGuests] = useState<GuestListItem[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [profile, setProfile] = useState<GuestProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [previewInvoiceIds, setPreviewInvoiceIds] = useState<number[] | null>(null);
  const [updatingCategoryId, setUpdatingCategoryId] = useState<number | null>(null);

  const overrideCategory = async (bookingId: number, client_category: string) => {
    setUpdatingCategoryId(bookingId);
    try {
      await api.put(`/bookings/${bookingId}/category`, { client_category });
      toast.success('Category updated and bill re-priced');
      if (selectedId) await openProfile(selectedId);
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to update category')); }
    finally { setUpdatingCategoryId(null); }
  };

  const fetchGuests = async () => {
    try {
      const res = await api.get(`/guests?q=${encodeURIComponent(search)}&page_size=50`);
      setGuests(res.data.items);
      setTotal(res.data.total);
    } catch { toast.error('Failed to load guests'); }
  };

  useEffect(() => {
    queueMicrotask(() => {
      setLoading(true);
      fetchGuests().finally(() => setLoading(false));
    });
  }, [search]);

  const openProfile = async (id: number) => {
    setSelectedId(id);
    setProfile(null);
    setProfileLoading(true);
    try {
      const res = await api.get(`/guests/${id}`);
      setProfile(res.data);
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to load guest profile')); }
    finally { setProfileLoading(false); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><UsersIcon size={24} /> Customer Directory</h1>
        <p className="text-sm text-muted-foreground">{total} guest{total === 1 ? '' : 's'}</p>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
        <Input placeholder="Search by name, phone, or CNIC..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer ID</TableHead>
                <TableHead>Full Name</TableHead>
                <TableHead>Role / Classification</TableHead>
                <TableHead>CNIC Number</TableHead>
                <TableHead>Last Arrival</TableHead>
                <TableHead>Total Arrivals</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading guests...</TableCell></TableRow>}
              {!loading && guests.map(g => (
                <TableRow key={g.id} className="cursor-pointer hover:bg-accent" onClick={() => openProfile(g.id)}>
                  <TableCell className="font-medium">#{g.id}</TableCell>
                  <TableCell>{g.full_name}</TableCell>
                  <TableCell>
                    <span className="capitalize">{classificationLabel(g.classification)}</span>
                    {g.rank && <span className="text-muted-foreground"> · {g.rank}</span>}
                  </TableCell>
                  <TableCell>{g.id_number || '—'}</TableCell>
                  <TableCell>{g.last_arrival_date || '—'}</TableCell>
                  <TableCell><Badge variant="secondary">{g.total_arrivals}</Badge></TableCell>
                </TableRow>
              ))}
              {!loading && guests.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No guests found</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={selectedId !== null} onOpenChange={(open) => { if (!open) { setSelectedId(null); setProfile(null); } }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Guest Profile</DialogTitle></DialogHeader>
          {profileLoading && <p className="text-center py-8 text-muted-foreground">Loading...</p>}
          {!profileLoading && profile && (
            <div className="space-y-5">
              <div>
                <h3 className="text-lg font-semibold">{profile.full_name}</h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 text-sm">
                  <p><span className="text-muted-foreground">Phone:</span> {profile.phone || '—'}</p>
                  <p><span className="text-muted-foreground">ID Type:</span> {profile.id_type || '—'}</p>
                  <p><span className="text-muted-foreground">ID Number:</span> {profile.id_number || '—'}</p>
                  <p><span className="text-muted-foreground">Unit/Address:</span> {profile.unit_address || '—'}</p>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-muted-foreground mb-2">Stay History ({profile.bookings.length})</h4>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {profile.bookings.length === 0 && <p className="text-sm text-muted-foreground">No stays recorded</p>}
                  {profile.bookings.map(b => (
                    <div key={b.id} className="flex items-center justify-between text-sm border rounded-md px-3 py-2 gap-2">
                      <span>Room {b.room_number || '—'} <span className="text-muted-foreground">· {b.check_in} → {b.check_out}</span></span>
                      <span className="flex items-center gap-2">
                        {canOverrideCategory && b.status !== 'checked_out' && b.status !== 'cancelled' && b.status !== 'no_show' ? (
                          <Select value={b.client_category} disabled={updatingCategoryId === b.id}
                            onValueChange={(v) => overrideCategory(b.id, v)}>
                            <SelectTrigger className="h-7 w-[168px] text-xs" title="Manager override: changing this re-prices the bill">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {CATEGORY_OPTIONS.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="capitalize text-muted-foreground">{classificationLabel(b.client_category)}</span>
                        )}
                        <Badge variant="outline" className="capitalize">{b.status.replace('_', ' ')}</Badge>
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-muted-foreground mb-2">Invoicing & Financial History ({profile.invoices.length})</h4>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {profile.invoices.length === 0 && <p className="text-sm text-muted-foreground">No invoices recorded</p>}
                  {profile.invoices.map(inv => (
                    <button key={inv.id} type="button"
                      className="w-full flex items-center justify-between text-sm border rounded-md px-3 py-2 hover:border-blue-400 transition-colors text-left"
                      onClick={() => setPreviewInvoiceIds([inv.id])} title="Preview this invoice">
                      <span className="flex items-center gap-1.5">
                        <Eye size={13} className="text-muted-foreground" />
                        {inv.invoice_number} <span className="text-muted-foreground capitalize">· {inv.bill_type}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        {inv.is_complimentary && <Badge className="bg-emerald-100 text-emerald-800">Complimentary</Badge>}
                        <span className="font-mono">{formatCurrency(inv.total_amount)}</span>
                        <Badge variant="outline" className="capitalize">{inv.status}</Badge>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <BillPrintView invoiceIds={previewInvoiceIds} onClose={() => setPreviewInvoiceIds(null)} />
    </div>
  );
}
