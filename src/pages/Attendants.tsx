import { useEffect, useRef, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/useAuth';
import { hasPermission } from '@/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Cell } from 'recharts';
import { toast } from 'sonner';
import { Search, Plus, Camera, UserCircle2, Trophy, TrendingDown, Clock3, Users as UsersIcon } from 'lucide-react';

interface Attendant {
  id: number;
  full_name: string;
  phone: string | null;
  email: string | null;
  shift: string | null;
  is_active: boolean;
  on_duty: boolean;
  photo_url: string | null;
  room_count: number;
}

interface ActivitySummary {
  attendant_id: number;
  full_name: string;
  photo_url: string | null;
  is_active: boolean;
  on_duty: boolean;
  total_hours: number;
  session_count: number;
  avg_session_hours: number;
  last_clock_in: string | null;
  last_clock_out: string | null;
}

interface ActivityTrend { labels: string[]; values: number[]; }

const emptyForm = { full_name: '', phone: '', email: '', shift: '' };

const PERIODS = [
  { key: '7', label: 'Last 7 days' },
  { key: '14', label: 'Last 14 days' },
  { key: '30', label: 'Last 30 days' },
  { key: '90', label: 'Last 90 days' },
];

const trendConfig: ChartConfig = {
  hours: { label: 'On-duty hours', color: 'hsl(var(--chart-1))' },
};

function formatHours(h: number) {
  const hours = Math.floor(h);
  const mins = Math.round((h - hours) * 60);
  if (hours === 0 && mins === 0) return '0h';
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function formatWhen(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function Attendants() {
  const { user } = useAuth();
  const canCreate = hasPermission(user, 'attendants', 'create');
  const canEdit = hasPermission(user, 'attendants', 'edit');

  const [attendants, setAttendants] = useState<Attendant[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const fileInputs = useRef<Record<number, HTMLInputElement | null>>({});

  // Activity History tab state
  const [period, setPeriod] = useState('30');
  const [summary, setSummary] = useState<ActivitySummary[] | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [drillDown, setDrillDown] = useState<ActivitySummary | null>(null);
  const [trend, setTrend] = useState<ActivityTrend | null>(null);
  const [trendLoading, setTrendLoading] = useState(false);

  const fetchAttendants = async () => {
    try { const res = await api.get('/attendants'); setAttendants(res.data); }
    catch { toast.error('Failed to load attendants'); }
  };

  const fetchSummary = async (days: string) => {
    setSummaryLoading(true);
    try { const res = await api.get(`/attendants/activity/summary?days=${days}`); setSummary(res.data); }
    catch { toast.error('Failed to load activity history'); }
    finally { setSummaryLoading(false); }
  };

  useEffect(() => {
    queueMicrotask(() => { setLoading(true); fetchAttendants().finally(() => setLoading(false)); });
  }, []);

  useEffect(() => {
    queueMicrotask(() => fetchSummary(period));
  }, [period]);

  // Refresh if the global "+ Add Attendant" top-bar shortcut is used while
  // this page is already mounted.
  useEffect(() => {
    window.addEventListener('attendants:changed', fetchAttendants);
    return () => window.removeEventListener('attendants:changed', fetchAttendants);
  }, []);

  useEffect(() => {
    if (!drillDown) return;
    queueMicrotask(async () => {
      setTrendLoading(true);
      try {
        const res = await api.get(`/attendants/activity/trend?days=${period}&attendant_id=${drillDown.attendant_id}`);
        setTrend(res.data);
      } catch { toast.error('Failed to load trend'); }
      finally { setTrendLoading(false); }
    });
  }, [drillDown, period]);

  const closeDrillDown = () => { setDrillDown(null); setTrend(null); };

  const filtered = attendants.filter(a =>
    !search.trim() || a.full_name.toLowerCase().includes(search.toLowerCase()) || (a.phone || '').includes(search));

  const openCreate = () => { setEditingId(null); setForm(emptyForm); setDialogOpen(true); };
  const openEdit = (a: Attendant) => {
    if (!canEdit) return;
    setEditingId(a.id);
    setForm({ full_name: a.full_name, phone: a.phone || '', email: a.email || '', shift: a.shift || '' });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    try {
      if (editingId) {
        await api.put(`/attendants/${editingId}`, form);
        toast.success('Attendant updated');
      } else {
        await api.post('/attendants', form);
        toast.success('Attendant added');
      }
      setDialogOpen(false);
      fetchAttendants();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to save attendant')); }
  };

  const handleToggleDuty = async (a: Attendant) => {
    try {
      await api.put(`/attendants/${a.id}/duty`, { on_duty: !a.on_duty });
      toast.success(a.on_duty ? `${a.full_name} clocked out` : `${a.full_name} clocked in`);
      fetchAttendants();
      fetchSummary(period);
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to update duty status')); }
  };

  const handlePhotoUpload = async (id: number, file: File) => {
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api.post(`/attendants/${id}/photo`, fd, { headers: { 'Content-Type': undefined } });
      toast.success('Photo updated');
      fetchAttendants();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to upload photo')); }
  };

  const withShifts = summary?.filter(s => s.session_count > 0) ?? [];
  const mostActive = withShifts[0];
  const leastActive = withShifts.length > 1 ? withShifts[withShifts.length - 1] : undefined;
  const totalHours = summary?.reduce((sum, s) => sum + s.total_hours, 0) ?? 0;
  const onDutyCount = summary?.filter(s => s.on_duty).length ?? 0;
  const leaderboardData = (summary ?? []).map(s => ({ name: s.full_name.split(' ')[0], hours: s.total_hours, full: s.full_name }));
  const trendData = trend?.labels.map((l, i) => ({ date: l, hours: trend.values[i] })) ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><UserCircle2 size={24} /> Attendants</h1>

      <Tabs defaultValue="directory">
        <TabsList>
          <TabsTrigger value="directory">Directory</TabsTrigger>
          <TabsTrigger value="activity">Activity History</TabsTrigger>
        </TabsList>

        <TabsContent value="directory" className="mt-4 space-y-6">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="relative max-w-sm flex-1 min-w-[16rem]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
              <Input placeholder="Search attendants..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
            </div>
            {canCreate && (
              <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogTrigger asChild><Button onClick={openCreate}><Plus size={16} className="mr-1" /> Add Attendant</Button></DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader><DialogTitle>{editingId ? 'Edit Attendant' : 'Add Attendant'}</DialogTitle></DialogHeader>
                  <div className="space-y-3">
                    <Input placeholder="Full Name" value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} />
                    <Input placeholder="Phone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
                    <Input placeholder="Email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
                    <div>
                      <Label className="text-xs">Shift</Label>
                      <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.shift} onChange={e => setForm({ ...form, shift: e.target.value })}>
                        <option value="">—</option>
                        <option value="morning">Morning</option>
                        <option value="evening">Evening</option>
                        <option value="night">Night</option>
                      </select>
                    </div>
                    <Button onClick={handleSave} className="w-full">{editingId ? 'Save Changes' : 'Add Attendant'}</Button>
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
                    <TableHead>Photo</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Shift</TableHead>
                    <TableHead>Rooms Assigned</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>On Duty</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading attendants...</TableCell></TableRow>}
                  {!loading && filtered.map(a => (
                    <TableRow key={a.id} className={canEdit ? 'cursor-pointer hover:bg-accent' : ''} onClick={() => openEdit(a)}>
                      <TableCell onClick={e => e.stopPropagation()}>
                        <div className="relative w-10 h-10 group">
                          <Avatar className="w-10 h-10">
                            {a.photo_url && <AvatarImage src={a.photo_url} alt={a.full_name} />}
                            <AvatarFallback>{a.full_name.slice(0, 2).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          {canEdit && (
                            <>
                              <button
                                type="button"
                                className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={() => fileInputs.current[a.id]?.click()}
                                title="Upload photo"
                              >
                                <Camera size={14} className="text-white" />
                              </button>
                              <input
                                ref={el => { fileInputs.current[a.id] = el; }}
                                type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                                onChange={e => { const f = e.target.files?.[0]; if (f) handlePhotoUpload(a.id, f); e.target.value = ''; }}
                              />
                            </>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">{a.full_name}</TableCell>
                      <TableCell>{a.phone || '—'}</TableCell>
                      <TableCell>{a.email || '—'}</TableCell>
                      <TableCell className="capitalize">{a.shift || '—'}</TableCell>
                      <TableCell><Badge variant="secondary">{a.room_count}</Badge></TableCell>
                      <TableCell><Badge className={a.is_active ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-400' : 'bg-muted text-muted-foreground'}>{a.is_active ? 'Active' : 'Inactive'}</Badge></TableCell>
                      <TableCell onClick={e => e.stopPropagation()}>
                        {canEdit ? (
                          <Button size="sm" variant={a.on_duty ? 'default' : 'outline'} className={a.on_duty ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
                            onClick={() => handleToggleDuty(a)}>
                            {a.on_duty ? 'Clock Out' : 'Clock In'}
                          </Button>
                        ) : (
                          <Badge className={a.on_duty ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}>
                            {a.on_duty ? 'On Duty' : 'Off Duty'}
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!loading && filtered.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No attendants found</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity" className="mt-4 space-y-6">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm text-muted-foreground">Who's carrying the most (and least) duty time, at a glance.</p>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PERIODS.map(p => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground flex items-center gap-1.5"><Trophy size={14} /> Most Active</p>
                {summaryLoading ? <Skeleton className="h-7 w-24 mt-1.5" /> : (
                  <p className="text-lg font-bold text-foreground truncate mt-0.5">{mostActive ? mostActive.full_name : '—'}</p>
                )}
                {mostActive && <p className="text-xs text-muted-foreground">{formatHours(mostActive.total_hours)}</p>}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground flex items-center gap-1.5"><TrendingDown size={14} /> Least Active</p>
                {summaryLoading ? <Skeleton className="h-7 w-24 mt-1.5" /> : (
                  <p className="text-lg font-bold text-foreground truncate mt-0.5">{leastActive ? leastActive.full_name : '—'}</p>
                )}
                {leastActive && <p className="text-xs text-muted-foreground">{formatHours(leastActive.total_hours)}</p>}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground flex items-center gap-1.5"><Clock3 size={14} /> Total On-Duty Hours</p>
                {summaryLoading ? <Skeleton className="h-7 w-20 mt-1.5" /> : (
                  <p className="text-lg font-bold text-foreground mt-0.5">{formatHours(totalHours)}</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground flex items-center gap-1.5"><UsersIcon size={14} /> Currently On Duty</p>
                {summaryLoading ? <Skeleton className="h-7 w-12 mt-1.5" /> : (
                  <p className="text-lg font-bold text-foreground mt-0.5">{onDutyCount}</p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base">Duty Hours Leaderboard</CardTitle></CardHeader>
            <CardContent>
              {summaryLoading ? (
                <Skeleton className="h-[260px] w-full" />
              ) : leaderboardData.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-10">No attendants yet</p>
              ) : (
                <ChartContainer config={trendConfig} className="h-[260px] w-full">
                  <BarChart data={leaderboardData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 12 }} axisLine={false} tickLine={false} width={40} />
                    <ChartTooltip content={<ChartTooltipContent
                      labelFormatter={(_l, p) => p?.[0]?.payload?.full ?? ''}
                      formatter={(v) => [formatHours(v as number), 'On duty']} />} />
                    <Bar dataKey="hours" radius={[4, 4, 0, 0]} maxBarSize={48}>
                      {leaderboardData.map((_, i) => (
                        <Cell key={i} fill={i === 0 ? 'hsl(var(--chart-1))' : 'hsl(var(--chart-1) / 0.55)'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Attendant</TableHead>
                    <TableHead>Total Hours</TableHead>
                    <TableHead>Sessions</TableHead>
                    <TableHead>Avg Session</TableHead>
                    <TableHead>Last Active</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summaryLoading && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading activity...</TableCell></TableRow>}
                  {!summaryLoading && (summary ?? []).map((s, i) => (
                    <TableRow key={s.attendant_id} className="cursor-pointer hover:bg-accent" onClick={() => setDrillDown(s)}>
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="w-7 h-7">
                            {s.photo_url && <AvatarImage src={s.photo_url} alt={s.full_name} />}
                            <AvatarFallback className="text-xs">{s.full_name.slice(0, 2).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <span className="font-medium">{s.full_name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">{formatHours(s.total_hours)}</TableCell>
                      <TableCell>{s.session_count}</TableCell>
                      <TableCell>{s.session_count > 0 ? formatHours(s.avg_session_hours) : '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{formatWhen(s.last_clock_in)}</TableCell>
                      <TableCell>
                        {s.on_duty ? (
                          <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-400">On Duty</Badge>
                        ) : s.session_count === 0 ? (
                          <Badge className="bg-muted text-muted-foreground">No shifts logged</Badge>
                        ) : (
                          <Badge variant="outline">Off Duty</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!summaryLoading && (summary ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No attendants found</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!drillDown} onOpenChange={open => !open && closeDrillDown()}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{drillDown?.full_name} — Daily On-Duty Hours</DialogTitle></DialogHeader>
          {trendLoading ? (
            <Skeleton className="h-[220px] w-full" />
          ) : (
            <ChartContainer config={trendConfig} className="h-[220px] w-full">
              <LineChart data={trendData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={36} />
                <ChartTooltip content={<ChartTooltipContent formatter={(v) => [formatHours(v as number), 'On duty']} />} />
                <Line type="monotone" dataKey="hours" stroke="hsl(var(--chart-1))" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ChartContainer>
          )}
          {drillDown && (
            <div className="grid grid-cols-3 gap-3 text-center pt-2">
              <div className="rounded-lg border p-2.5">
                <p className="text-xs text-muted-foreground">Total</p>
                <p className="text-base font-bold">{formatHours(drillDown.total_hours)}</p>
              </div>
              <div className="rounded-lg border p-2.5">
                <p className="text-xs text-muted-foreground">Sessions</p>
                <p className="text-base font-bold">{drillDown.session_count}</p>
              </div>
              <div className="rounded-lg border p-2.5">
                <p className="text-xs text-muted-foreground">Avg / Session</p>
                <p className="text-base font-bold">{drillDown.session_count > 0 ? formatHours(drillDown.avg_session_hours) : '—'}</p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
