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
import { Search, Plus, BedDouble, LogIn, LogOut, Users, DoorOpen } from 'lucide-react';

interface Booking {
  id: number;
  booking_reference: string;
  guest_name: string;
  guest_phone: string;
  room_number: string;
  check_in: string;
  check_out: string;
  status: string;
  adults: number;
  total_amount: number;
  client_category: string | null;
  member_name: string | null;
}

interface Room {
  id: number;
  room_number: string;
  room_type: string;
  status: string;
  floor: number;
  base_price: number;
  current_guest: string | null;
}

interface MemberOption {
  id: number;
  full_name: string;
  service_number: string;
}

export default function Bookings() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ guest_name: '', guest_phone: '', room_id: 0, check_in: '', check_out: '', adults: 1, children: 0, special_requests: '', client_category: 'non_member_civilian', member_id: 0 });

  const fetchBookings = async () => {
    try {
      const res = await api.get(`/bookings?search=${search}`);
      setBookings(res.data.items);
    } catch { toast.error('Failed to load bookings'); }
  };

  const fetchRooms = async () => {
    try {
      const res = await api.get('/bookings/rooms');
      setRooms(res.data.items);
    } catch { toast.error('Failed to load rooms'); }
  };

  const fetchMembers = async () => {
    try {
      const res = await api.get('/members?status=active&page_size=100');
      setMembers(res.data.items);
    } catch { toast.error('Failed to load members'); }
  };

  useEffect(() => {
    queueMicrotask(() => {
      setLoading(true);
      Promise.all([fetchBookings(), fetchRooms(), fetchMembers()]).finally(() => setLoading(false));
    });
  }, [search]);

  const handleCreate = async () => {
    if (!form.check_in || !form.check_out) {
      toast.error('Check-in and check-out dates are required');
      return;
    }
    if (form.check_out <= form.check_in) {
      toast.error('Check-out date must be after check-in date');
      return;
    }
    try {
      await api.post('/bookings', { ...form, member_id: form.member_id || null });
      toast.success('Booking created');
      setDialogOpen(false);
      fetchBookings();
      fetchRooms();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed')); }
  };

  const handleCheckIn = async (id: number) => {
    try { await api.post(`/bookings/${id}/check-in`); toast.success('Checked in'); fetchBookings(); fetchRooms(); }
    catch (err) { toast.error(getErrorMessage(err, 'Failed')); }
  };

  const handleCheckOut = async (id: number) => {
    try { await api.post(`/bookings/${id}/check-out`); toast.success('Checked out'); fetchBookings(); fetchRooms(); }
    catch (err) { toast.error(getErrorMessage(err, 'Failed')); }
  };

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      pending: 'bg-amber-100 text-amber-800', confirmed: 'bg-blue-100 text-blue-800',
      checked_in: 'bg-green-100 text-green-800', checked_out: 'bg-gray-100 text-gray-800', cancelled: 'bg-red-100 text-red-800',
    };
    return <Badge className={colors[status] || ''}>{status.replace('_', ' ')}</Badge>;
  };

  const roomStatusColor = (status: string) => {
    const colors: Record<string, string> = { vacant: 'bg-green-100 text-green-700 border-green-300', occupied: 'bg-red-100 text-red-700 border-red-300', reserved: 'bg-blue-100 text-blue-700 border-blue-300', maintenance: 'bg-gray-100 text-gray-700 border-gray-300' };
    return colors[status] || '';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Hotel Bookings</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild><Button><Plus size={16} className="mr-1" /> New Booking</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>New Booking</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Input placeholder="Guest name" value={form.guest_name} onChange={e => setForm({...form, guest_name: e.target.value})} />
              <Input placeholder="Phone" value={form.guest_phone} onChange={e => setForm({...form, guest_phone: e.target.value})} />
              <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.room_id} onChange={e => setForm({...form, room_id: Number(e.target.value)})}>
                <option value="0">Select room</option>
                {rooms.filter(r => r.status === 'vacant').map(r => <option key={r.id} value={r.id}>{r.room_number} - {r.room_type} (${r.base_price})</option>)}
              </select>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Check In</Label><Input type="date" onChange={e => setForm({...form, check_in: e.target.value})} /></div>
                <div><Label>Check Out</Label><Input type="date" onChange={e => setForm({...form, check_out: e.target.value})} /></div>
              </div>
              <div>
                <Label>Guest Type</Label>
                <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.client_category} onChange={e => setForm({...form, client_category: e.target.value})}>
                  <option value="non_member_civilian">Civilian</option>
                  <option value="non_member_non_civilian">Non-Civilian</option>
                </select>
              </div>
              <div>
                <Label>Link to Member (optional, for on-base accommodation)</Label>
                <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.member_id} onChange={e => setForm({...form, member_id: Number(e.target.value)})}>
                  <option value="0">None</option>
                  {members.map(m => <option key={m.id} value={m.id}>{m.full_name} ({m.service_number})</option>)}
                </select>
              </div>
              <Button onClick={handleCreate} className="w-full">Create Booking</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="bookings">
        <TabsList className="grid w-full grid-cols-3 max-w-md"><TabsTrigger value="bookings">Bookings</TabsTrigger><TabsTrigger value="rooms">Room Grid</TabsTrigger><TabsTrigger value="occupancy">Occupancy</TabsTrigger></TabsList>

        <TabsContent value="bookings">
          <div className="relative max-w-sm mb-4"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} /><Input placeholder="Search bookings..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" /></div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Reference</TableHead><TableHead>Guest</TableHead><TableHead>Type</TableHead><TableHead>Room</TableHead><TableHead>Check In</TableHead><TableHead>Check Out</TableHead><TableHead>Status</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
                <TableBody>
                  {loading && <TableRow><TableCell colSpan={8} className="text-center py-8 text-gray-500">Loading bookings...</TableCell></TableRow>}
                  {!loading && bookings.map(b => (
                    <TableRow key={b.id}>
                      <TableCell className="font-medium">{b.booking_reference}</TableCell>
                      <TableCell>{b.guest_name}{b.member_name && <span className="block text-xs text-gray-500">Member: {b.member_name}</span>}</TableCell>
                      <TableCell className="text-xs capitalize text-gray-500">{b.client_category?.replace(/_/g, ' ') || '-'}</TableCell>
                      <TableCell>{b.room_number}</TableCell>
                      <TableCell>{b.check_in}</TableCell>
                      <TableCell>{b.check_out}</TableCell>
                      <TableCell>{statusBadge(b.status)}</TableCell>
                      <TableCell>
                        {b.status === 'confirmed' && <Button size="sm" variant="ghost" onClick={() => handleCheckIn(b.id)}><LogIn size={16} className="text-green-600" /></Button>}
                        {b.status === 'checked_in' && <Button size="sm" variant="ghost" onClick={() => handleCheckOut(b.id)}><LogOut size={16} className="text-blue-600" /></Button>}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!loading && bookings.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-8 text-gray-500">No bookings found</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rooms">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {rooms.map(room => (
              <Card key={room.id} className={`cursor-pointer hover:shadow-md transition-all ${roomStatusColor(room.status)}`}>
                <CardContent className="p-4 text-center">
                  <DoorOpen size={24} className="mx-auto mb-2 opacity-60" />
                  <p className="font-bold text-lg">{room.room_number}</p>
                  <p className="text-xs capitalize">{room.room_type}</p>
                  <p className="text-xs font-medium mt-1 capitalize">{room.status}</p>
                  {room.current_guest && <p className="text-xs mt-1 truncate opacity-75">{room.current_guest}</p>}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="occupancy">
          <OccupancyView />
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface OccupancyData {
  total_rooms: number;
  occupied: number;
  reserved: number;
  vacant: number;
  maintenance: number;
  occupancy_rate: number;
}

function OccupancyView() {
  const [data, setData] = useState<OccupancyData | null>(null);
  useEffect(() => { api.get('/bookings/occupancy').then(res => setData(res.data)).catch(() => { /* occupancy is a secondary view; leave it blank on failure */ }); }, []);
  if (!data) return null;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
      {[{ label: 'Total Rooms', value: data.total_rooms, icon: BedDouble }, { label: 'Occupied', value: data.occupied, color: 'text-red-600' }, { label: 'Vacant', value: data.vacant, color: 'text-green-600' }, { label: 'Reserved', value: data.reserved, color: 'text-blue-600' }, { label: 'Maintenance', value: data.maintenance, color: 'text-gray-600' }, { label: 'Occupancy Rate', value: `${data.occupancy_rate}%`, color: 'text-purple-600' }].map((item, i) => (
        <Card key={i}><CardContent className="p-6 flex items-center gap-4">
          <div className={`w-12 h-12 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center ${item.color || ''}`}>
            {item.icon ? <item.icon size={24} /> : <Users size={24} />}
          </div>
          <div><p className="text-sm text-gray-500">{item.label}</p><p className={`text-2xl font-bold ${item.color || 'text-gray-900 dark:text-white'}`}>{item.value}</p></div>
        </CardContent></Card>
      ))}
    </div>
  );
}
