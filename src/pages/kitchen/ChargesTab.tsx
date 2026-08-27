import { useCallback, useEffect, useMemo, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/useAuth';
import { hasPermission } from '@/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Flame, Fuel, LogOut, CheckCircle2, Circle, Search } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import { DishBreakdownDialog } from '@/components/DishBreakdownDialog';
import { OrderHistoryDialog } from '@/components/OrderHistoryDialog';
import { SpecialOrderDialog, type SpecialOrderPreset } from '@/components/SpecialOrderDialog';

/* Charges = what used to be two tabs, "Mess Charges Overview" and
   "Departures". Departures was never a different dataset - it's this same
   list filtered to who's leaving today - so it's a filter chip here instead
   of a whole tab, and the finalize action moved onto the row itself.

   Rows sort by what needs a decision (departing and not yet signed off)
   rather than alphabetically, so at 130 diners the handful that actually
   matter today stay at the top instead of being scrolled past. */

interface OverviewRow {
  consumer_type: 'member' | 'guest'; consumer_id: number; name: string;
  sub_label: string | null; unbilled_mess_total: number; unbilled_gas_total: number;
  is_departing: boolean; kitchen_finalized_by_name: string | null; booking_finalized_by_name: string | null;
  // Set only on a guest row that is actually an HRA member in a room - their
  // meals are keyed to member_id, not the booking.
  member_id?: number | null;
}
interface Departure {
  booking_id: number; guest_name: string; room_number: string | null;
  overdue: boolean; days_overdue: number;
}
interface GasRate { percentage: number; updated_at: string | null }

type Filter = 'all' | 'member' | 'guest' | 'departing';

export function ChargesTab() {
  const { user } = useAuth();
  const canEditRates = hasPermission(user, 'mess_rates', 'edit');

  const [rows, setRows] = useState<OverviewRow[]>([]);
  const [departures, setDepartures] = useState<Departure[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');

  const [gasRate, setGasRate] = useState<GasRate>({ percentage: 0, updated_at: null });
  const [gasRateInput, setGasRateInput] = useState('');
  const [ratesOpen, setRatesOpen] = useState(false);

  const [breakdownTarget, setBreakdownTarget] = useState<OverviewRow | null>(null);
  const [specialPreset, setSpecialPreset] = useState<SpecialOrderPreset | null>(null);
  const [specialOpen, setSpecialOpen] = useState(false);
  const [historyPerson, setHistoryPerson] = useState<{ memberId?: number; bookingId?: number; name: string } | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [ov, dep] = await Promise.all([
        api.get('/kitchen/mess-charges-overview?consumer_type=all', { headers: { 'Cache-Control': 'no-cache' } }),
        api.get('/kitchen/departures', { headers: { 'Cache-Control': 'no-cache' } }).catch(() => ({ data: [] })),
      ]);
      setRows(ov.data);
      setDepartures(dep.data);
    } catch { /* permission-gated for some roles - fine to show nothing */ }
    finally { setLoading(false); }
  }, []);

  const fetchGasRate = useCallback(async () => {
    try {
      const res = await api.get('/kitchen/gas-rate');
      setGasRate(res.data);
      setGasRateInput(String(res.data.percentage));
    } catch { /* view/edit both permission-gated */ }
  }, []);

  useEffect(() => { queueMicrotask(() => { fetchAll(); fetchGasRate(); }); }, [fetchAll, fetchGasRate]);

  const overdueByBooking = useMemo(() => {
    const m = new Map<number, Departure>();
    for (const d of departures) m.set(d.booking_id, d);
    return m;
  }, [departures]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matched = rows.filter(r => {
      if (filter === 'member' && r.consumer_type !== 'member') return false;
      if (filter === 'guest' && r.consumer_type !== 'guest') return false;
      if (filter === 'departing' && !r.is_departing) return false;
      if (q && !r.name.toLowerCase().includes(q) && !(r.sub_label || '').toLowerCase().includes(q)) return false;
      return true;
    });
    // Needs-a-decision first: departing and unsigned, then departing, then
    // whoever has an actual balance, then everyone else.
    const rank = (r: OverviewRow) => {
      if (r.is_departing && !r.kitchen_finalized_by_name) return 0;
      if (r.is_departing) return 1;
      if (r.unbilled_mess_total > 0 || r.unbilled_gas_total > 0) return 2;
      return 3;
    };
    return [...matched].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [rows, filter, search]);

  const departingCount = rows.filter(r => r.is_departing).length;
  const needsSignoff = rows.filter(r => r.is_departing && !r.kitchen_finalized_by_name).length;

  const handleSaveGasRate = async () => {
    const percentage = Number(gasRateInput);
    if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) { toast.error('Enter a percentage between 0 and 100'); return; }
    try {
      await api.put('/kitchen/gas-rate', { percentage });
      toast.success('Gas charge percentage updated');
      fetchGasRate();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to update the rate')); }
  };

  const handleFinalize = async (bookingId: number) => {
    try {
      await api.post(`/kitchen/departures/${bookingId}/finalize`);
      toast.success('Mess/gas charges marked final — Clerk notified');
      fetchAll();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to finalize')); }
  };

  const openSpecial = (r: OverviewRow) => {
    setSpecialPreset({ consumer_kind: r.consumer_type, consumer_id: r.consumer_id });
    setSpecialOpen(true);
  };

  const FILTERS: { key: Filter; label: string; count?: number }[] = [
    { key: 'all', label: 'All', count: rows.length },
    { key: 'departing', label: 'Departing today', count: departingCount },
    { key: 'member', label: 'Members', count: rows.filter(r => r.consumer_type === 'member').length },
    { key: 'guest', label: 'Guests', count: rows.filter(r => r.consumer_type === 'guest').length },
  ];

  return (
    <div className="space-y-4">
      {needsSignoff > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-blue-300 bg-blue-50 dark:bg-blue-950/20 px-3 py-2 text-sm text-blue-800 dark:text-blue-300">
          <LogOut size={16} />
          {needsSignoff} guest{needsSignoff === 1 ? '' : 's'} leaving today still need your sign-off.
          <button type="button" className="underline font-medium" onClick={() => setFilter('departing')}>Show them</button>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {FILTERS.map(f => (
          <button key={f.key} type="button" onClick={() => setFilter(f.key)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium border transition-colors ${
              filter === f.key ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent text-muted-foreground border-input hover:text-foreground'}`}>
            {f.label}{f.count !== undefined ? ` · ${f.count}` : ''}
          </button>
        ))}
        <div className="relative flex-1 min-w-48 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={15} />
          <Input placeholder="Search a name…" className="pl-9 h-9" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Room / Unit</TableHead>
                <TableHead className="text-right">Food</TableHead>
                <TableHead className="text-right">Gas</TableHead>
                <TableHead className="w-64">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>}
              {!loading && visible.map(r => {
                const dep = r.consumer_type === 'guest' ? overdueByBooking.get(r.consumer_id) : undefined;
                return (
                  <TableRow key={`${r.consumer_type}-${r.consumer_id}`}>
                    <TableCell>
                      <p className="font-medium flex items-center gap-1.5">
                        {/* Every name leads to that person's full order
                            history - members included, who have no Breakdown
                            button because their dining bills monthly. */}
                        <button type="button" className="hover:underline text-left"
                          onClick={() => setHistoryPerson(
                            r.consumer_type === 'member' || r.member_id
                              ? { memberId: r.consumer_type === 'member' ? r.consumer_id : (r.member_id as number), name: r.name }
                              : { bookingId: r.consumer_id, name: r.name })}>
                          {r.name}
                        </button>
                        {r.is_departing && <Badge className="bg-blue-100 text-blue-800 text-[10px]">Departing</Badge>}
                        {dep?.overdue && (
                          <Badge className="bg-red-100 text-red-800 text-[10px]">
                            Overdue {dep.days_overdue}d
                          </Badge>
                        )}
                      </p>
                      {r.is_departing && (
                        <p className="text-[11px] text-muted-foreground flex items-center gap-2 mt-0.5">
                          <span className="flex items-center gap-1">
                            {r.kitchen_finalized_by_name ? <CheckCircle2 size={11} className="text-emerald-600" /> : <Circle size={11} />} Kitchen
                          </span>
                          <span className="flex items-center gap-1">
                            {r.booking_finalized_by_name ? <CheckCircle2 size={11} className="text-emerald-600" /> : <Circle size={11} />} Booking
                          </span>
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.sub_label || '-'}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(r.unbilled_mess_total)}</TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">{formatCurrency(r.unbilled_gas_total)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1 justify-end flex-wrap">
                        <Button size="sm" variant="outline" onClick={() => openSpecial(r)}>Special Order</Button>
                        {/* Guests only - a member's dining is billed monthly in
                            aggregate, so there's no per-dish breakdown to
                            correct; theirs lives in Member Ledger. */}
                        {/* Real guests only. An HRA member shows up as a guest
                            row but bills monthly in aggregate, so there is no
                            per-dish breakdown to correct for them either. */}
                        {r.consumer_type === 'guest' && !r.member_id && (
                          <Button size="sm" variant="ghost" onClick={() => setBreakdownTarget(r)}>Breakdown</Button>
                        )}
                        {r.is_departing && (
                          <Button size="sm" disabled={!!r.kitchen_finalized_by_name} onClick={() => handleFinalize(r.consumer_id)}>
                            {r.kitchen_finalized_by_name ? 'Finalized' : 'Finalize'}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!loading && visible.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  {search.trim() ? 'Nobody matches that search' : 'Nothing to show'}
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Rate policy - set rarely, so it's tucked away rather than sitting
          above the list every day. */}
      {(canEditRates || gasRate.updated_at) && (
        <div>
          <button type="button" onClick={() => setRatesOpen(o => !o)}
            className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1.5">
            <Flame size={14} /> Gas charge fallback rate ({gasRate.percentage}%)
          </button>
          {ratesOpen && (
            <Card className="mt-2">
              <CardContent className="p-4 space-y-2 max-w-md">
                <p className="text-xs text-muted-foreground">
                  Only used for a dish with no gas charge of its own. Set a dish's real gas amount from the
                  <Fuel size={12} className="inline mx-1" />icon on the Meals board and this is ignored for it.
                </p>
                <Label>Gas charge (% of food)</Label>
                <div className="flex gap-1.5">
                  <Input type="number" min={0} max={100} disabled={!canEditRates}
                    value={gasRateInput} onChange={e => setGasRateInput(e.target.value.replace(/^0+(?=\d)/, ''))} />
                  {canEditRates && <Button size="sm" onClick={handleSaveGasRate}>Save</Button>}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {breakdownTarget && (
        <DishBreakdownDialog
          open={breakdownTarget !== null} onOpenChange={open => { if (!open) setBreakdownTarget(null); }}
          bookingId={breakdownTarget.consumer_id} guestName={breakdownTarget.name}
          isDeparting={breakdownTarget.is_departing} kitchenFinalizedByName={breakdownTarget.kitchen_finalized_by_name}
          onFinalized={() => { fetchAll(); setBreakdownTarget(null); }}
        />
      )}

      <OrderHistoryDialog
        open={historyPerson !== null}
        onOpenChange={open => { if (!open) setHistoryPerson(null); }}
        memberId={historyPerson?.memberId}
        bookingId={historyPerson?.bookingId}
        personName={historyPerson?.name}
      />

      <SpecialOrderDialog open={specialOpen} onOpenChange={setSpecialOpen} preset={specialPreset} onCreated={fetchAll} />
    </div>
  );
}
