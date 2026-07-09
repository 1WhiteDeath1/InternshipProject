import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import DashboardTab from './bookings/DashboardTab';
import RoomGridTab from './bookings/RoomGridTab';
import TimelineTab from './bookings/TimelineTab';
import RoomSection, { type InitialBooking } from './bookings/RoomSection';
import type { Room, MemberOption } from './bookings/shared';

export default function Bookings() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [panelRoomId, setPanelRoomId] = useState<number | null>(null);
  const [panelInitialBooking, setPanelInitialBooking] = useState<InitialBooking | undefined>(undefined);

  const fetchRooms = useCallback(async () => {
    try { const res = await api.get('/bookings/rooms'); setRooms(res.data.items); }
    catch { toast.error('Failed to load rooms'); }
  }, []);

  const fetchMembers = useCallback(async () => {
    try { const res = await api.get('/members?status=active&page_size=100'); setMembers(res.data.items); }
    catch { toast.error('Failed to load members'); }
  }, []);

  useEffect(() => { queueMicrotask(() => { fetchRooms(); fetchMembers(); }); }, [fetchRooms, fetchMembers]);

  const openRoom = (roomId: number, initialBooking?: InitialBooking) => {
    setPanelInitialBooking(initialBooking);
    setPanelRoomId(roomId);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Hotel Bookings</h1>

      <Tabs defaultValue="dashboard">
        <TabsList className="grid w-full grid-cols-3 max-w-lg">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="rooms">Rooms</TabsTrigger>
          <TabsTrigger value="timeline">7-Day Overview</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard">
          <DashboardTab onOpenRoom={id => openRoom(id)} onChanged={fetchRooms} />
        </TabsContent>

        <TabsContent value="rooms">
          <RoomGridTab rooms={rooms} onOpenRoom={openRoom} />
        </TabsContent>

        <TabsContent value="timeline">
          <TimelineTab onOpenRoom={id => openRoom(id)} />
        </TabsContent>
      </Tabs>

      <RoomSection
        roomId={panelRoomId}
        open={panelRoomId !== null}
        onClose={() => setPanelRoomId(null)}
        onChanged={fetchRooms}
        members={members}
        initialBooking={panelInitialBooking}
      />
    </div>
  );
}
