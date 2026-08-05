import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';

interface MemberRow {
  id: number;
  service_number: string;
  full_name: string;
  rank: string;
  mess_category: string;
  is_womens_bloc: boolean;
  custom_discount_rate: number;
  status: string;
}

const MESS_CATEGORY_LABELS: Record<string, string> = { officers: 'Officers', jcos: 'JCOs', ors: 'ORs' };

// Manager's standing discount rate for mess members - Member.custom_discount_rate
// is already applied automatically to every future monthly bill by
// mess-billing's generate step; this tab is just a dedicated, focused
// place to see and set it, instead of it being buried in the general
// Members roster edit form. Kept separate from Guest Discounts because HRA/
// mess members bill monthly, not per-stay.
export default function MemberDiscountsPanel() {
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);

  const fetchMembers = async () => {
    setLoading(true);
    try {
      const res = await api.get('/members', { params: { status: 'active', page_size: 100 } });
      setMembers(res.data.items || []);
    } catch (e) {
      toast.error(getErrorMessage(e, 'Failed to load members'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { queueMicrotask(fetchMembers); }, []);

  const saveDiscount = async (member: MemberRow) => {
    const raw = draft[member.id];
    const rate = raw === undefined ? member.custom_discount_rate : Number(raw);
    if (Number.isNaN(rate) || rate < 0 || rate > 100) {
      toast.error('Discount must be between 0 and 100');
      return;
    }
    setSavingId(member.id);
    try {
      await api.put(`/members/${member.id}`, { custom_discount_rate: rate });
      toast.success(`Standing discount set to ${rate}% for ${member.full_name}`);
      setDraft(prev => { const next = { ...prev }; delete next[member.id]; return next; });
      fetchMembers();
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Standing discount rate for mess members - applied automatically to every future monthly bill.
      </p>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Service No.</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Standing Discount %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map(m => {
                const d = draft[m.id];
                const dirty = d !== undefined && Number(d) !== m.custom_discount_rate;
                return (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">
                      {m.rank} {m.full_name}
                      {m.is_womens_bloc && <Badge variant="secondary" className="ml-2">Women's Bloc</Badge>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{m.service_number}</TableCell>
                    <TableCell>{MESS_CATEGORY_LABELS[m.mess_category] || m.mess_category}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number" min={0} max={100} step="any" className="w-20"
                          value={d !== undefined ? d : String(m.custom_discount_rate)}
                          onChange={e => setDraft(prev => ({ ...prev, [m.id]: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter') saveDiscount(m); }}
                        />
                        {dirty && (
                          <Button size="sm" disabled={savingId === m.id} onClick={() => saveDiscount(m)}>
                            {savingId === m.id ? 'Saving…' : 'Save'}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!loading && members.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center py-10 text-muted-foreground">
                  No active members.
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
