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
import { UtensilsCrossed, Plus, CheckCircle, XCircle, Users } from 'lucide-react';

interface AttendanceRecord {
  id: number;
  member_id: number | null;
  member_name: string | null;
  booking_id: number | null;
  guest_name: string | null;
  recipe_id: number | null;
  recipe_name: string | null;
  date: string;
  meal_type: string;
  status: string;
  method: string;
}

interface MemberOption {
  id: number;
  full_name: string;
  service_number: string;
  status: string;
}

interface BookingOption {
  id: number;
  guest_name: string;
  room_number: string;
}

interface RecipeOption {
  id: number;
  name: string;
}

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
  const [mealType, setMealType] = useState('breakfast');
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [checkedInBookings, setCheckedInBookings] = useState<BookingOption[]>([]);
  const [recipes, setRecipes] = useState<RecipeOption[]>([]);
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [loading, setLoading] = useState(true);
  const [consumerType, setConsumerType] = useState<'member' | 'guest'>('member');
  const [bookMemberId, setBookMemberId] = useState(0);
  const [bookBookingId, setBookBookingId] = useState(0);
  const [bookRecipeId, setBookRecipeId] = useState(0);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [leaveForm, setLeaveForm] = useState({ member_id: 0, start_date: '', end_date: '', reason: '' });

  const fetchRecords = async () => {
    try {
      const res = await api.get(`/attendance?date=${date}&meal_type=${mealType}`);
      setRecords(res.data.items);
    } catch { toast.error('Failed to load attendance'); }
  };

  const fetchMembers = async () => {
    try {
      const res = await api.get('/members?status=active&page_size=100');
      setMembers(res.data.items);
    } catch { toast.error('Failed to load members'); }
  };

  const fetchCheckedInBookings = async () => {
    try {
      const res = await api.get('/bookings?status=checked_in');
      setCheckedInBookings(res.data.items);
    } catch { toast.error('Failed to load checked-in guests'); }
  };

  const fetchRecipes = async () => {
    try {
      const res = await api.get(`/recipes?menu_category=${mealType}`);
      setRecipes(res.data.items);
    } catch { toast.error('Failed to load recipes'); }
  };

  const fetchLeaves = async () => {
    try {
      const res = await api.get('/attendance/leaves?status=active');
      setLeaves(res.data);
    } catch { toast.error('Failed to load leaves'); }
  };

  useEffect(() => {
    queueMicrotask(() => {
      setLoading(true);
      setBookRecipeId(0);
      Promise.all([fetchRecords(), fetchMembers(), fetchCheckedInBookings(), fetchRecipes(), fetchLeaves()]).finally(() => setLoading(false));
    });
  }, [date, mealType]);

  const handleBook = async () => {
    if (consumerType === 'member' && !bookMemberId) {
      toast.error('Select a member to book');
      return;
    }
    if (consumerType === 'guest' && !bookBookingId) {
      toast.error('Select a checked-in guest to book');
      return;
    }
    try {
      await api.post('/attendance', {
        member_id: consumerType === 'member' ? bookMemberId : null,
        booking_id: consumerType === 'guest' ? bookBookingId : null,
        recipe_id: bookRecipeId || null,
        date, meal_type: mealType,
      });
      toast.success('Meal booked');
      setBookMemberId(0);
      setBookBookingId(0);
      setBookRecipeId(0);
      fetchRecords();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to book')); }
  };

  const handleBulkBook = async () => {
    const memberIds = members.map(m => m.id);
    if (memberIds.length === 0) return;
    try {
      const res = await api.post('/attendance/bulk', { member_ids: memberIds, date, meal_type: mealType });
      toast.success(`Booked ${res.data.booked.length} of ${memberIds.length} members`);
      fetchRecords();
    } catch (err) { toast.error(getErrorMessage(err, 'Bulk booking failed')); }
  };

  const handleMark = async (id: number, status: 'attended' | 'cancelled') => {
    let reason: string | undefined;
    if (new Date(date) < new Date(new Date().toDateString())) {
      reason = prompt('This is a past date - enter a reason for this correction:') || undefined;
      if (!reason) return;
    }
    try {
      await api.post(`/attendance/${id}/mark`, { status, reason });
      toast.success(`Marked ${status}`);
      fetchRecords();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to mark attendance')); }
  };

  const handleCreateLeave = async () => {
    try {
      await api.post('/attendance/leaves', leaveForm);
      toast.success('Leave recorded');
      setLeaveDialogOpen(false);
      setLeaveForm({ member_id: 0, start_date: '', end_date: '', reason: '' });
      fetchLeaves();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to record leave')); }
  };

  const handleCancelLeave = async (id: number) => {
    try {
      await api.post(`/attendance/leaves/${id}/cancel`);
      toast.success('Leave cancelled');
      fetchLeaves();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed')); }
  };

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      booked: 'bg-blue-100 text-blue-800', attended: 'bg-green-100 text-green-800',
      cancelled: 'bg-gray-100 text-gray-800', excluded: 'bg-amber-100 text-amber-800',
    };
    return <Badge className={colors[status] || ''}>{status}</Badge>;
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2"><UtensilsCrossed size={24} /> Meal Attendance & Booking</h1>

      <Tabs value={mealType} onValueChange={setMealType}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <TabsList className="grid grid-cols-4 max-w-md">
            {MEAL_TYPES.map(mt => <TabsTrigger key={mt} value={mt} className="capitalize">{mt}</TabsTrigger>)}
          </TabsList>
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-40" />
        </div>

        {MEAL_TYPES.map(mt => (
          <TabsContent key={mt} value={mt} className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex rounded-md border border-input overflow-hidden text-sm">
                <button className={`px-3 py-2 ${consumerType === 'member' ? 'bg-primary text-primary-foreground' : 'bg-background'}`} onClick={() => setConsumerType('member')}>Member</button>
                <button className={`px-3 py-2 ${consumerType === 'guest' ? 'bg-primary text-primary-foreground' : 'bg-background'}`} onClick={() => setConsumerType('guest')}>Guest</button>
              </div>
              {consumerType === 'member' ? (
                <select className="h-10 rounded-md border border-input bg-background px-3 text-sm flex-1 max-w-xs" value={bookMemberId} onChange={e => setBookMemberId(Number(e.target.value))}>
                  <option value="0">Select member to book</option>
                  {members.map(m => <option key={m.id} value={m.id}>{m.full_name} ({m.service_number})</option>)}
                </select>
              ) : (
                <select className="h-10 rounded-md border border-input bg-background px-3 text-sm flex-1 max-w-xs" value={bookBookingId} onChange={e => setBookBookingId(Number(e.target.value))}>
                  <option value="0">Select checked-in guest</option>
                  {checkedInBookings.map(b => <option key={b.id} value={b.id}>{b.guest_name} (Room {b.room_number})</option>)}
                </select>
              )}
              <select className="h-10 rounded-md border border-input bg-background px-3 text-sm max-w-xs" value={bookRecipeId} onChange={e => setBookRecipeId(Number(e.target.value))}>
                <option value="0">No menu item</option>
                {recipes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <Button onClick={handleBook}><Plus size={16} className="mr-1" /> Book</Button>
              {consumerType === 'member' && <Button variant="outline" onClick={handleBulkBook}><Users size={16} className="mr-1" /> Book All Active</Button>}
            </div>

            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow><TableHead>Consumer</TableHead><TableHead>Menu Item</TableHead><TableHead>Status</TableHead><TableHead>Method</TableHead><TableHead className="w-32">Actions</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {loading && <TableRow><TableCell colSpan={5} className="text-center py-8 text-gray-500">Loading...</TableCell></TableRow>}
                    {!loading && records.map(r => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">
                          {r.member_name || r.guest_name}
                          {r.booking_id != null && <span className="ml-1 text-xs text-gray-400">(Guest)</span>}
                        </TableCell>
                        <TableCell className="text-sm text-gray-500">{r.recipe_name || '-'}</TableCell>
                        <TableCell>{statusBadge(r.status)}</TableCell>
                        <TableCell className="capitalize text-sm text-gray-500">{r.method}</TableCell>
                        <TableCell>
                          {r.status === 'booked' && (
                            <div className="flex gap-1">
                              <Button size="sm" variant="ghost" onClick={() => handleMark(r.id, 'attended')}><CheckCircle size={16} className="text-green-600" /></Button>
                              <Button size="sm" variant="ghost" onClick={() => handleMark(r.id, 'cancelled')}><XCircle size={16} className="text-red-500" /></Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {!loading && records.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-8 text-gray-500">No bookings for this meal/date</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>

      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Member Leaves (auto-excludes bookings)</h2>
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
