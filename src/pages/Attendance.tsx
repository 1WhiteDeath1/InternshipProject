import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { UtensilsCrossed, Plus, XCircle, CheckCheck, UserPlus } from 'lucide-react';
import { defaultMealForNow } from '@/lib/mealDefaults';

interface RosterMember {
  member_id: number;
  full_name: string;
  service_number: string;
  status: 'present' | 'absent' | 'on_leave';
}

interface RosterGuest {
  id: number;
  booking_id: number;
  guest_name: string | null;
  recipe_name: string | null;
  status: string;
}

interface MemberOption { id: number; full_name: string; service_number: string; }
interface BookingOption { id: number; guest_name: string; room_number: string; }
interface RecipeOption { id: number; name: string; }

interface Leave {
  id: number;
  member_id: number;
  member_name: string | null;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: string;
}

const MEAL_TYPES = ['breakfast', 'lunch', 'hitea', 'dinner'];

export default function Attendance() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [mealType, setMealType] = useState<string>(defaultMealForNow());
  const [rosterMembers, setRosterMembers] = useState<RosterMember[]>([]);
  const [guests, setGuests] = useState<RosterGuest[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [checkedInBookings, setCheckedInBookings] = useState<BookingOption[]>([]);
  const [recipes, setRecipes] = useState<RecipeOption[]>([]);
  const [menuRecipeId, setMenuRecipeId] = useState(0);
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');

  const [guestDialogOpen, setGuestDialogOpen] = useState(false);
  const [guestBookingId, setGuestBookingId] = useState(0);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [leaveForm, setLeaveForm] = useState({ member_id: 0, start_date: '', end_date: '', reason: '' });

  const isPast = new Date(date) < new Date(new Date().toDateString());

  const fetchRoster = async () => {
    try {
      const res = await api.get(`/attendance/roster?date=${date}&meal_type=${mealType}`);
      setRosterMembers(res.data.members);
      setGuests(res.data.guests);
    } catch { toast.error('Failed to load roster'); }
  };

  const fetchMembers = async () => {
    try { const res = await api.get('/members?status=active&page_size=100'); setMembers(res.data.items); }
    catch { toast.error('Failed to load members'); }
  };

  const fetchCheckedInBookings = async () => {
    try { const res = await api.get('/bookings?status=checked_in'); setCheckedInBookings(res.data.items); }
    catch { toast.error('Failed to load checked-in guests'); }
  };

  const fetchRecipes = async () => {
    try { const res = await api.get(`/recipes?menu_category=${mealType}`); setRecipes(res.data.items); }
    catch { toast.error('Failed to load recipes'); }
  };

  const fetchLeaves = async () => {
    try { const res = await api.get('/attendance/leaves?status=active'); setLeaves(res.data); }
    catch { toast.error('Failed to load leaves'); }
  };

  useEffect(() => {
    queueMicrotask(() => {
      setLoading(true);
      setMenuRecipeId(0);
      Promise.all([fetchRoster(), fetchMembers(), fetchCheckedInBookings(), fetchRecipes(), fetchLeaves()]).finally(() => setLoading(false));
    });
  }, [date, mealType]);

  const askReasonIfPast = (): string | undefined | false => {
    if (!isPast) return undefined;
    const reason = prompt('This is a past date — enter a reason for this correction:') || undefined;
    return reason || false; // false = user cancelled
  };

  const setPresence = async (memberIds: number[], present: boolean) => {
    if (memberIds.length === 0) return;
    let reason: string | undefined;
    if (present) {
      const r = askReasonIfPast();
      if (r === false) return;
      reason = r;
    }
    setBusy(true);
    try {
      await api.post('/attendance/roster', {
        date, meal_type: mealType, member_ids: memberIds, present,
        recipe_id: present && menuRecipeId ? menuRecipeId : null, reason,
      });
      fetchRoster();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to update attendance')); }
    finally { setBusy(false); }
  };

  const handleToggle = (m: RosterMember) => {
    if (m.status === 'on_leave') return;
    setPresence([m.member_id], m.status !== 'present');
  };

  const handleMarkAllPresent = async () => {
    const ids = rosterMembers.filter(m => m.status !== 'on_leave').map(m => m.member_id);
    await setPresence(ids, true);
    toast.success('Marked all present');
  };

  const handleAddGuestMeal = async () => {
    if (!guestBookingId) { toast.error('Select a checked-in guest'); return; }
    try {
      // Guests: create a booking-based attendance row, then mark attended.
      const res = await api.post('/attendance', {
        member_id: null, booking_id: guestBookingId,
        recipe_id: menuRecipeId || null, date, meal_type: mealType,
      });
      await api.post(`/attendance/${res.data.id}/mark`, { status: 'attended' });
      toast.success('Guest meal recorded');
      setGuestDialogOpen(false);
      setGuestBookingId(0);
      fetchRoster();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to add guest meal')); }
  };

  const handleRemoveGuest = async (id: number) => {
    try { await api.post(`/attendance/${id}/mark`, { status: 'cancelled' }); toast.success('Guest meal removed'); fetchRoster(); }
    catch (err) { toast.error(getErrorMessage(err, 'Failed')); }
  };

  const handleCreateLeave = async () => {
    try {
      await api.post('/attendance/leaves', leaveForm);
      toast.success('Leave recorded');
      setLeaveDialogOpen(false);
      setLeaveForm({ member_id: 0, start_date: '', end_date: '', reason: '' });
      fetchLeaves();
      fetchRoster();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to record leave')); }
  };

  const handleCancelLeave = async (id: number) => {
    try { await api.post(`/attendance/leaves/${id}/cancel`); toast.success('Leave cancelled'); fetchLeaves(); fetchRoster(); }
    catch (err) { toast.error(getErrorMessage(err, 'Failed')); }
  };

  const presentCount = rosterMembers.filter(m => m.status === 'present').length;
  const leaveCount = rosterMembers.filter(m => m.status === 'on_leave').length;
  const filtered = rosterMembers.filter(m =>
    m.full_name.toLowerCase().includes(search.toLowerCase()) || m.service_number.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2"><UtensilsCrossed size={24} /> Meal Attendance</h1>

      <Tabs value={mealType} onValueChange={setMealType}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <TabsList className="grid grid-cols-4 max-w-md">
            {MEAL_TYPES.map(mt => <TabsTrigger key={mt} value={mt} className="capitalize">{mt}</TabsTrigger>)}
          </TabsList>
          <div className="flex items-center gap-2">
            <Label className="text-sm text-gray-500 whitespace-nowrap">Meal date</Label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-40" />
          </div>
        </div>

        {MEAL_TYPES.map(mt => (
          <TabsContent key={mt} value={mt} className="space-y-4">
            {/* Action bar */}
            <Card>
              <CardContent className="p-4 flex items-end gap-3 flex-wrap">
                <div className="min-w-52 max-w-xs">
                  <Label className="text-xs text-gray-500">Today's menu item <span className="text-gray-400">(optional)</span></Label>
                  <select className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={menuRecipeId} onChange={e => setMenuRecipeId(Number(e.target.value))}>
                    <option value="0">Not specified</option>
                    {recipes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </div>
                <Button onClick={handleMarkAllPresent} disabled={busy || loading}>
                  <CheckCheck size={16} className="mr-1" /> Mark all present
                </Button>
                <Dialog open={guestDialogOpen} onOpenChange={setGuestDialogOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline"><UserPlus size={16} className="mr-1" /> Add guest meal</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>Add Guest Meal — {mt}, {date}</DialogTitle></DialogHeader>
                    <div className="space-y-3">
                      <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={guestBookingId} onChange={e => setGuestBookingId(Number(e.target.value))}>
                        <option value="0">Select checked-in guest…</option>
                        {checkedInBookings.map(b => <option key={b.id} value={b.id}>{b.guest_name} (Room {b.room_number})</option>)}
                      </select>
                      <Button onClick={handleAddGuestMeal} className="w-full">Record Guest Meal</Button>
                    </div>
                  </DialogContent>
                </Dialog>
                <div className="flex-1" />
                <div className="text-sm flex items-center gap-2 flex-wrap">
                  <Badge className="bg-green-100 text-green-800">{presentCount} present</Badge>
                  <Badge className="bg-amber-100 text-amber-800">{leaveCount} on leave</Badge>
                  <Badge className="bg-blue-100 text-blue-800">{guests.length} guests</Badge>
                </div>
              </CardContent>
            </Card>

            {isPast && <p className="text-xs text-amber-600">Editing a past date — you'll be asked for a correction reason.</p>}

            <div className="relative max-w-sm">
              <Input placeholder="Search members…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>

            {/* Roster */}
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow><TableHead className="w-24">Present</TableHead><TableHead>Member</TableHead><TableHead>Service #</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {loading && <TableRow><TableCell colSpan={4} className="text-center py-8 text-gray-500">Loading roster…</TableCell></TableRow>}
                    {!loading && filtered.map(m => (
                      <TableRow key={m.member_id} className={m.status === 'on_leave' ? 'opacity-60' : 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-900'} onClick={() => handleToggle(m)}>
                        <TableCell>
                          <input type="checkbox" className="h-5 w-5 rounded border-gray-300 cursor-pointer disabled:cursor-not-allowed"
                            checked={m.status === 'present'} disabled={m.status === 'on_leave' || busy}
                            onChange={() => handleToggle(m)} onClick={e => e.stopPropagation()} />
                        </TableCell>
                        <TableCell className="font-medium">{m.full_name}</TableCell>
                        <TableCell className="text-sm text-gray-500">{m.service_number}</TableCell>
                        <TableCell>
                          {m.status === 'present' && <Badge className="bg-green-100 text-green-800">present</Badge>}
                          {m.status === 'on_leave' && <Badge className="bg-amber-100 text-amber-800">on leave</Badge>}
                          {m.status === 'absent' && <span className="text-sm text-gray-400">—</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                    {!loading && filtered.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-8 text-gray-500">No active members</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Guests */}
            {guests.length > 0 && (
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader><TableRow><TableHead>Guest</TableHead><TableHead>Menu Item</TableHead><TableHead className="w-20">Remove</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {guests.map(g => (
                        <TableRow key={g.id}>
                          <TableCell className="font-medium">{g.guest_name} <span className="text-xs text-gray-400">(Guest)</span></TableCell>
                          <TableCell className="text-sm text-gray-500">{g.recipe_name || '-'}</TableCell>
                          <TableCell><Button size="sm" variant="ghost" onClick={() => handleRemoveGuest(g.id)}><XCircle size={16} className="text-red-500" /></Button></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        ))}
      </Tabs>

      {/* Member Leaves — secondary */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-600 dark:text-gray-300">Member Leaves <span className="text-xs font-normal text-gray-400">(auto-excludes from the roster)</span></h2>
            <Dialog open={leaveDialogOpen} onOpenChange={setLeaveDialogOpen}>
              <DialogTrigger asChild><Button size="sm" variant="outline"><Plus size={14} className="mr-1" /> Record Leave</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Record Member Leave</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={leaveForm.member_id} onChange={e => setLeaveForm({...leaveForm, member_id: Number(e.target.value)})}>
                    <option value="0">Select member</option>
                    {members.map(m => <option key={m.id} value={m.id}>{m.full_name} ({m.service_number})</option>)}
                  </select>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Start Date</Label><Input type="date" value={leaveForm.start_date} onChange={e => setLeaveForm({...leaveForm, start_date: e.target.value})} /></div>
                    <div><Label>End Date</Label><Input type="date" value={leaveForm.end_date} onChange={e => setLeaveForm({...leaveForm, end_date: e.target.value})} /></div>
                  </div>
                  <Input placeholder="Reason" value={leaveForm.reason} onChange={e => setLeaveForm({...leaveForm, reason: e.target.value})} />
                  <Button onClick={handleCreateLeave} className="w-full">Record Leave</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
          <Table>
            <TableHeader><TableRow><TableHead>Member</TableHead><TableHead>Start</TableHead><TableHead>End</TableHead><TableHead>Reason</TableHead><TableHead className="w-20">Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {leaves.map(l => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{l.member_name}</TableCell>
                  <TableCell>{l.start_date}</TableCell>
                  <TableCell>{l.end_date}</TableCell>
                  <TableCell>{l.reason || '-'}</TableCell>
                  <TableCell><Button size="sm" variant="ghost" onClick={() => handleCancelLeave(l.id)}><XCircle size={16} className="text-red-500" /></Button></TableCell>
                </TableRow>
              ))}
              {leaves.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-6 text-gray-500">No active leaves</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
