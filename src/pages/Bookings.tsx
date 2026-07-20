import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import DashboardTab from './bookings/DashboardTab';
import RoomGridTab from './bookings/RoomGridTab';
import CalendarTab from './bookings/CalendarTab';
import BookingsListTab from './bookings/BookingsListTab';
import RoomSection, { type InitialBooking } from './bookings/RoomSection';
import type { Room, MemberOption } from './bookings/shared';

export default function Bookings() {
  const location = useLocation();
  const navigate = useNavigate();
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

  // Keep room/housekeeping status fresh across desks without a manual
  // refresh - paused while the tab isn't visible so an idle background tab
  // doesn't keep polling the server.
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') fetchRooms();
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchRooms]);

  // The global "+ New Booking" shortcut (Layout.tsx) hands off the room it
  // auto-picked via navigation state - consume it once, then clear the
  // state so a back-navigation or remount doesn't reopen the panel.
  useEffect(() => { queueMicrotask(() => {
    const state = location.state as { openRoomId?: number; initialBooking?: InitialBooking } | null;
    if (state?.openRoomId) {
      setPanelInitialBooking(state.initialBooking);
      setPanelRoomId(state.openRoomId);
      navigate(location.pathname, { replace: true, state: null });
    }
  }); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const openRoom = (roomId: number, initialBooking?: InitialBooking) => {
    setPanelInitialBooking(initialBooking);
    setPanelRoomId(roomId);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Hotel Bookings</h1>

      <Tabs defaultValue="dashboard">
        <TabsList className="grid w-full grid-cols-4 max-w-2xl">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="rooms">Rooms</TabsTrigger>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
          <TabsTrigger value="list">All Bookings</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard">
          <DashboardTab onOpenRoom={id => openRoom(id)} onChanged={fetchRooms} />
        </TabsContent>

        <TabsContent value="rooms">
          <RoomGridTab rooms={rooms} onOpenRoom={openRoom} onChanged={fetchRooms} />
        </TabsContent>

        <TabsContent value="calendar">
          <CalendarTab onOpenRoom={id => openRoom(id)} />
        </TabsContent>

        <TabsContent value="list">
          <BookingsListTab onChanged={fetchRooms} />
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
