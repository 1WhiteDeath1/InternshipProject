import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { ArrowLeft, IdCard } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';

interface MemberDetail {
  id: number; service_number: string; full_name: string; rank: string; unit: string | null;
  mess_category: string; client_category: string; is_womens_bloc: boolean;
  status: string; current_room_id: number | null; current_room_number: string | null;
}

interface Residency {
  id: number; room_id: number; room_number: string | null; room_type: string | null;
  check_in: string; check_out: string; status: string;
}

interface MessBill {
  id: number; month: number; year: number; man_days: number; stay_amount: number;
  base_menu_amount: number; extra_meals_amount: number; ala_carte_amount: number;
  discount_amount: number; total_amount: number; status: string;
}

interface DiningHistoryRow { date: string; meal_type: string; item_name: string; price: number; status: string; }

const monthLabel = (m: number) => new Date(2000, m - 1).toLocaleString('default', { month: 'short' });

const statusBadge = (status: string) => {
  const colors: Record<string, string> = { active: 'bg-green-100 text-green-800', transferred: 'bg-amber-100 text-amber-800', left: 'bg-muted text-muted-foreground' };
  return <Badge className={colors[status] || ''}>{status}</Badge>;
};

const billStatusBadge = (status: string) => {
  const colors: Record<string, string> = { draft: 'bg-muted text-muted-foreground', issued: 'bg-blue-100 text-blue-800', paid: 'bg-green-100 text-green-800' };
  return <Badge className={colors[status] || ''}>{status}</Badge>;
};

export default function MemberLedger() {
  // useParams always yields a string - parse once up front and use the
  // numeric memberId everywhere below, since this is the first parameterized
  // route in this app and has no existing string-vs-number precedent to lean on.
  const { id } = useParams<{ id: string }>();
  const memberId = parseInt(id ?? '', 10);
  const navigate = useNavigate();

  const [member, setMember] = useState<MemberDetail | null>(null);
  const [residencies, setResidencies] = useState<Residency[]>([]);
  const [bills, setBills] = useState<MessBill[]>([]);
  const [diningHistory, setDiningHistory] = useState<DiningHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!Number.isFinite(memberId)) return;
    queueMicrotask(() => {
      setLoading(true);
      Promise.all([
        api.get(`/members/${memberId}`),
        api.get(`/members/${memberId}/residencies`),
        api.get(`/mess-billing/bills?member_id=${memberId}&page_size=100`),
      ]).then(([m, r, b]) => {
        setMember(m.data);
        setResidencies(r.data);
        setBills(b.data.items);
      }).catch(err => toast.error(getErrorMessage(err, 'Failed to load member ledger')))
        .finally(() => setLoading(false));
      // Fetched separately, non-blocking - permission-gated slightly
      // differently (kitchen:view/members:view/clerk_desk:view/billing:view)
      // than the ledger's own core data, so a 403 here shouldn't break the page.
      api.get(`/kitchen/order-history?member_id=${memberId}`)
        .then(h => setDiningHistory(h.data))
        .catch(() => { /* dining history is a secondary section */ });
    });
  }, [memberId]);

  if (!Number.isFinite(memberId)) {
    return <p className="text-muted-foreground">Invalid member.</p>;
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate('/members')}><ArrowLeft size={16} className="mr-1" /> Back to Members</Button>

      <Card>
        <CardContent className="p-5">
          {loading && !member && <p className="text-muted-foreground">Loading...</p>}
          {member && (
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><IdCard size={22} /> {member.full_name}</h1>
                <p className="text-sm text-muted-foreground">{member.rank} · {member.service_number} · {member.unit || 'No unit'}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge className="capitalize bg-blue-100 text-blue-800">{member.mess_category}</Badge>
                {member.is_womens_bloc && <Badge className="bg-pink-100 text-pink-800">Women's Bloc</Badge>}
                {statusBadge(member.status)}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="room">
        <TabsList className="grid w-full grid-cols-2 max-w-xs">
          <TabsTrigger value="room">Room Allocation</TabsTrigger>
          <TabsTrigger value="dining">Dining & Mess Account</TabsTrigger>
        </TabsList>

        <TabsContent value="room" className="space-y-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Room</TableHead><TableHead>Type</TableHead><TableHead>Check-In</TableHead><TableHead>Check-Out</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>
                  {residencies.map(r => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.room_number || '-'}</TableCell>
                      <TableCell className="capitalize">{r.room_type || '-'}</TableCell>
                      <TableCell>{r.check_in}</TableCell>
                      <TableCell>{r.status === 'checked_in' ? 'Ongoing' : r.check_out}</TableCell>
                      <TableCell className="capitalize">{r.status.replace('_', ' ')}</TableCell>
                    </TableRow>
                  ))}
                  {!loading && residencies.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No HRA residency on record</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Period</TableHead><TableHead>Room/HRA Charge</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>
                  {bills.map(b => (
                    <TableRow key={b.id}>
                      <TableCell>{monthLabel(b.month)} {b.year}</TableCell>
                      <TableCell className="font-semibold">{formatCurrency(b.stay_amount)}</TableCell>
                      <TableCell>{billStatusBadge(b.status)}</TableCell>
                    </TableRow>
                  ))}
                  {!loading && bills.length === 0 && <TableRow><TableCell colSpan={3} className="text-center py-8 text-muted-foreground">No mess bills yet</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="dining">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Period</TableHead><TableHead>Menu</TableHead><TableHead>Extras</TableHead><TableHead>A La Carte</TableHead><TableHead>Discount</TableHead><TableHead>Total</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>
                  {bills.map(b => (
                    <TableRow key={b.id}>
                      <TableCell>{monthLabel(b.month)} {b.year}</TableCell>
                      <TableCell>{formatCurrency(b.base_menu_amount)}</TableCell>
                      <TableCell>{formatCurrency(b.extra_meals_amount)}</TableCell>
                      <TableCell>{formatCurrency(b.ala_carte_amount)}</TableCell>
                      <TableCell className="text-muted-foreground">{formatCurrency(b.discount_amount)}</TableCell>
                      <TableCell className="font-semibold">{formatCurrency(b.total_amount)}</TableCell>
                      <TableCell>{billStatusBadge(b.status)}</TableCell>
                    </TableRow>
                  ))}
                  {!loading && bills.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No mess bills yet</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardContent className="p-4 space-y-2">
              <p className="text-sm font-semibold">Meal History</p>
              <p className="text-xs text-muted-foreground">Every meal attended and à la carte order this member has ever had - the day-to-day detail behind the monthly totals above.</p>
              <div className="max-h-96 overflow-y-auto rounded-md border">
                <Table>
                  <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Meal</TableHead><TableHead>Item</TableHead><TableHead className="text-right">Price</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {diningHistory.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell>{new Date(r.date).toLocaleDateString()}</TableCell>
                        <TableCell className="capitalize">{r.meal_type.replace(/_/g, ' ')}</TableCell>
                        <TableCell>{r.item_name}</TableCell>
                        <TableCell className="text-right font-mono">{formatCurrency(r.price)}</TableCell>
                        <TableCell className="text-muted-foreground capitalize">{r.status.replace(/_/g, ' ')}</TableCell>
                      </TableRow>
                    ))}
                    {diningHistory.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">No meal history on record</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
