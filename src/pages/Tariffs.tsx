import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/useAuth';
import { hasPermission } from '@/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Plus, Trash2, TrendingUp } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import { RANKS, ROOM_TYPE_LABELS, RATE_CARD_CATEGORY_LABELS, selectClass } from './bookings/shared';
import GuestDiscountsPanel from './tariffs/GuestDiscountsPanel';
import MemberDiscountsPanel from './tariffs/MemberDiscountsPanel';

interface TariffRate {
  id: number;
  rank: string;
  room_type: string;
  stay_type: string;
  nightly_rate: number;
  updated_at: string;
}

interface RoomRateRow {
  room_type: string;
  guest_category: string;
  rent: number;
  electricity: number;
  generator: number;
  gas: number;
  internet: number;
}

interface DutyRateRow { rank_band: string; label: string; da_amount: number; }
interface HraRankRateRow { rank_band: string; label: string; monthly_amount: number; }
interface HraUtilityRateRow { room_type: string; monthly_amount: number; }

const STAY_TYPES = ['official', 'private', 'family'];
const emptyForm = { rank: RANKS[0], room_type: 'standard', stay_type: 'official', nightly_rate: 0 };

const UTILITY_LABELS: Record<string, string> = {
  standard: 'Standard / VIP GRs', suite_1ac: 'Suite (1x AC)', suite_2ac: 'Suite (2x AC)', dg_suite: 'DG Suite',
  out_of_mess: 'Out-of-Mess Resident (Flat)',
};

const roomRateKey = (r: { room_type: string; guest_category: string }) => `${r.room_type}|${r.guest_category}`;

export default function Tariffs() {
  const { user } = useAuth();
  const canEditRates = hasPermission(user, 'tariffs', 'edit');
  // Guest/Member Discounts folded in as tabs here (same pricing-policy
  // authority, same people who touch it) to declutter the sidebar - each
  // tab keeps its own original permission gate rather than inheriting
  // tariffs:view, so who sees what is unchanged from when they were
  // separate pages.
  const canGuestDiscounts = hasPermission(user, 'bookings', 'approve');
  const canMemberDiscounts = canGuestDiscounts && hasPermission(user, 'members', 'edit');

  const [rows, setRows] = useState<TariffRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const [roomRates, setRoomRates] = useState<Record<string, RoomRateRow>>({});
  const [dutyRates, setDutyRates] = useState<Record<string, DutyRateRow>>({});
  const [hraRankRates, setHraRankRates] = useState<Record<string, HraRankRateRow>>({});
  const [utilityRates, setUtilityRates] = useState<Record<string, HraUtilityRateRow>>({});
  const [rateCardLoading, setRateCardLoading] = useState(true);

  const fetchTariffs = async () => {
    try { const res = await api.get('/tariffs'); setRows(res.data); }
    catch { toast.error('Failed to load tariffs'); }
  };

  const fetchRateCard = async () => {
    try {
      const [roomRes, dutyRes, hraRes, utilRes] = await Promise.all([
        api.get('/rate-card/room-rates'),
        api.get('/rate-card/duty-rates'),
        api.get('/rate-card/hra-rank-rates'),
        api.get('/rate-card/hra-utility-rates'),
      ]);
      setRoomRates(Object.fromEntries((roomRes.data as RoomRateRow[]).map(r => [roomRateKey(r), r])));
      setDutyRates(Object.fromEntries((dutyRes.data as DutyRateRow[]).map(r => [r.rank_band, r])));
      setHraRankRates(Object.fromEntries((hraRes.data as HraRankRateRow[]).map(r => [r.rank_band, r])));
      setUtilityRates(Object.fromEntries((utilRes.data as HraUtilityRateRow[]).map(r => [r.room_type, r])));
    } catch { toast.error('Failed to load rate card'); }
  };

  useEffect(() => {
    queueMicrotask(() => {
      setLoading(true);
      fetchTariffs().finally(() => setLoading(false));
      setRateCardLoading(true);
      fetchRateCard().finally(() => setRateCardLoading(false));
    });
  }, []);

  const [savingTariff, setSavingTariff] = useState(false);
  const [justSavedKey, setJustSavedKey] = useState<string | null>(null);

  const handleSave = async () => {
    setSavingTariff(true);
    try {
      await api.put('/tariffs', form);
      toast.success(`Tariff saved — ${form.rank} · ${ROOM_TYPE_LABELS[form.room_type] || form.room_type} · ${form.stay_type} now bills at ${formatCurrency(form.nightly_rate)}/night`);
      setDialogOpen(false);
      setJustSavedKey(`${form.rank}|${form.room_type}|${form.stay_type}`);
      setTimeout(() => setJustSavedKey(null), 4000);
      setForm(emptyForm);
      fetchTariffs();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to save tariff')); }
    finally { setSavingTariff(false); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Remove this tariff rate?')) return;
    try { await api.delete(`/tariffs/${id}`); toast.success('Tariff removed'); fetchTariffs(); }
    catch (err) { toast.error(getErrorMessage(err, 'Failed to remove tariff')); }
  };

  const saveRoomRate = async (row: RoomRateRow) => {
    try {
      await api.put('/rate-card/room-rates', row);
      toast.success('Room rate saved');
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to save room rate')); }
  };

  const saveDutyRate = async (row: DutyRateRow) => {
    try {
      await api.put('/rate-card/duty-rates', row);
      toast.success('Duty rate saved');
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to save duty rate')); }
  };

  const saveHraRankRate = async (row: HraRankRateRow) => {
    try {
      await api.put('/rate-card/hra-rank-rates', row);
      toast.success('HRA rank rate saved');
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to save HRA rate')); }
  };

  const saveUtilityRate = async (row: HraUtilityRateRow) => {
    try {
      await api.put('/rate-card/hra-utility-rates', row);
      toast.success('Utility rate saved');
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to save utility rate')); }
  };

  const roomRateTotal = (r: RoomRateRow) => r.rent + r.electricity + r.generator + r.gas + r.internet;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><TrendingUp size={24} /> Tariffs</h1>

      <Tabs defaultValue="rate-card">
        <TabsList>
          <TabsTrigger value="rate-card">Rate Card</TabsTrigger>
          <TabsTrigger value="overrides">Custom Overrides</TabsTrigger>
          {canGuestDiscounts && <TabsTrigger value="guest-discounts">Guest Discounts</TabsTrigger>}
          {canMemberDiscounts && <TabsTrigger value="member-discounts">Member Discounts</TabsTrigger>}
        </TabsList>

        <TabsContent value="rate-card" className="space-y-6">
          <p className="text-sm text-muted-foreground">
            The official rate card - what a booking is actually charged when no custom override (other tab) matches. Editable here since the mess revises these figures by official letter from time to time.
          </p>

          <Card>
            <CardHeader><CardTitle className="text-base">Guest Room Charges</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Room Type</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Rent</TableHead>
                    <TableHead>Elec</TableHead>
                    <TableHead>Gen</TableHead>
                    <TableHead>Gas</TableHead>
                    <TableHead>Internet</TableHead>
                    <TableHead>Total</TableHead>
                    {canEditRates && <TableHead className="w-20">Save</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rateCardLoading && <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>}
                  {!rateCardLoading && Object.values(roomRates).map(row => (
                    <TableRow key={roomRateKey(row)}>
                      <TableCell className="font-medium">{ROOM_TYPE_LABELS[row.room_type] || row.room_type}</TableCell>
                      <TableCell>{RATE_CARD_CATEGORY_LABELS[row.guest_category] || row.guest_category}</TableCell>
                      {(['rent', 'electricity', 'generator', 'gas', 'internet'] as const).map(field => (
                        <TableCell key={field}>
                          {canEditRates ? (
                            <Input type="number" min={0} className="w-24 h-8" value={row[field]}
                              onChange={e => setRoomRates({ ...roomRates, [roomRateKey(row)]: { ...row, [field]: Number(e.target.value) } })} />
                          ) : formatCurrency(row[field])}
                        </TableCell>
                      ))}
                      <TableCell className="font-mono">{formatCurrency(roomRateTotal(row))}</TableCell>
                      {canEditRates && (
                        <TableCell><Button size="sm" onClick={() => saveRoomRate(row)}>Save</Button></TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-base">GRs Charges on Official Duty</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rank</TableHead>
                      <TableHead>1 DA Rate</TableHead>
                      <TableHead>1&#189; DA Rate</TableHead>
                      {canEditRates && <TableHead className="w-20">Save</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rateCardLoading && <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>}
                    {!rateCardLoading && Object.values(dutyRates).map(row => (
                      <TableRow key={row.rank_band}>
                        <TableCell className="font-medium">{row.label}</TableCell>
                        <TableCell>
                          {canEditRates ? (
                            <Input type="number" min={0} className="w-28 h-8" value={row.da_amount}
                              onChange={e => setDutyRates({ ...dutyRates, [row.rank_band]: { ...row, da_amount: Number(e.target.value) } })} />
                          ) : formatCurrency(row.da_amount)}
                        </TableCell>
                        <TableCell className="font-mono text-muted-foreground">{formatCurrency(row.da_amount * 1.5)}</TableCell>
                        {canEditRates && (
                          <TableCell><Button size="sm" onClick={() => saveDutyRate(row)}>Save</Button></TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">HRA Revised Rate</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rank</TableHead>
                      <TableHead>Monthly Rate</TableHead>
                      {canEditRates && <TableHead className="w-20">Save</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rateCardLoading && <TableRow><TableCell colSpan={3} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>}
                    {!rateCardLoading && Object.values(hraRankRates).map(row => (
                      <TableRow key={row.rank_band}>
                        <TableCell className="font-medium">{row.label}</TableCell>
                        <TableCell>
                          {canEditRates ? (
                            <Input type="number" min={0} className="w-28 h-8" value={row.monthly_amount}
                              onChange={e => setHraRankRates({ ...hraRankRates, [row.rank_band]: { ...row, monthly_amount: Number(e.target.value) } })} />
                          ) : formatCurrency(row.monthly_amount)}
                        </TableCell>
                        {canEditRates && (
                          <TableCell><Button size="sm" onClick={() => saveHraRankRate(row)}>Save</Button></TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">HRA Utility Charges (Monthly)</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Room Class</TableHead>
                      <TableHead>Monthly Charge</TableHead>
                      {canEditRates && <TableHead className="w-20">Save</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rateCardLoading && <TableRow><TableCell colSpan={3} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>}
                    {!rateCardLoading && Object.values(utilityRates).map(row => (
                      <TableRow key={row.room_type}>
                        <TableCell className="font-medium">{UTILITY_LABELS[row.room_type] || row.room_type}</TableCell>
                        <TableCell>
                          {canEditRates ? (
                            <Input type="number" min={0} className="w-28 h-8" value={row.monthly_amount}
                              onChange={e => setUtilityRates({ ...utilityRates, [row.room_type]: { ...row, monthly_amount: Number(e.target.value) } })} />
                          ) : formatCurrency(row.monthly_amount)}
                        </TableCell>
                        {canEditRates && (
                          <TableCell><Button size="sm" onClick={() => saveUtilityRate(row)}>Save</Button></TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="overrides" className="space-y-6">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground max-w-2xl">
              When a booking's rank, room type, and stay type all match a row below, this rate overrides the rate card. Bookings without a match are unaffected.
            </p>
            {canEditRates && (
              <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogTrigger asChild><Button onClick={() => setForm(emptyForm)}><Plus size={16} className="mr-1" /> Add / Update Rate</Button></DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader><DialogTitle>Tariff Rate</DialogTitle></DialogHeader>
                  <div className="space-y-3">
                    <div>
                      <Label className="text-xs">Rank</Label>
                      <select className={selectClass} value={form.rank} onChange={e => setForm({ ...form, rank: e.target.value })}>
                        {RANKS.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs">Room Type</Label>
                      <select className={selectClass} value={form.room_type} onChange={e => setForm({ ...form, room_type: e.target.value })}>
                        {Object.entries(ROOM_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs">Stay Type</Label>
                      <select className={selectClass} value={form.stay_type} onChange={e => setForm({ ...form, stay_type: e.target.value })}>
                        {STAY_TYPES.map(s => <option key={s} value={s} className="capitalize">{s}</option>)}
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs">Nightly Rate (Rs)</Label>
                      <Input type="number" min={0} value={form.nightly_rate} onChange={e => setForm({ ...form, nightly_rate: Number(e.target.value) })} />
                    </div>
                    <Button onClick={handleSave} disabled={savingTariff} className="w-full">{savingTariff ? 'Saving…' : 'Save Rate'}</Button>
                    <p className="text-xs text-muted-foreground">Saving an existing rank/room type/stay type combination updates its rate in place.</p>
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rank</TableHead>
                    <TableHead>Room Type</TableHead>
                    <TableHead>Stay Type</TableHead>
                    <TableHead>Nightly Rate</TableHead>
                    {canEditRates && <TableHead className="w-16">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading tariffs...</TableCell></TableRow>}
                  {!loading && rows.map(r => (
                    <TableRow key={r.id} className={justSavedKey === `${r.rank}|${r.room_type}|${r.stay_type}` ? 'bg-emerald-50 dark:bg-emerald-950/30 transition-colors' : ''}>
                      <TableCell className="font-medium">{r.rank}</TableCell>
                      <TableCell>{ROOM_TYPE_LABELS[r.room_type] || r.room_type}</TableCell>
                      <TableCell className="capitalize">{r.stay_type}</TableCell>
                      <TableCell className="font-mono">{formatCurrency(r.nightly_rate)}</TableCell>
                      {canEditRates && (
                        <TableCell>
                          <Button size="sm" variant="ghost" onClick={() => handleDelete(r.id)}><Trash2 size={16} className="text-red-600" /></Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                  {!loading && rows.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No tariff rates configured yet</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {canGuestDiscounts && (
          <TabsContent value="guest-discounts">
            <GuestDiscountsPanel />
          </TabsContent>
        )}
        {canMemberDiscounts && (
          <TabsContent value="member-discounts">
            <MemberDiscountsPanel />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
