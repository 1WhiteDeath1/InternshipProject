import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import RoomGridTab from './bookings/RoomGridTab';
import CalendarTab from './bookings/CalendarTab';
import BookingsListTab from './bookings/BookingsListTab';
import { RoomInfoDialog } from './bookings/RoomInfoDialog';
import type { Room } from './bookings/shared';

/** Manager / Deputy Manager's view-only counterpart to Booking NCO's
    Bookings page - same room grid, calendar and booking history, but every
    click opens the read-only RoomInfoDialog instead of a booking panel, and
    there is no create/check-in/cancel/maintenance affordance anywhere.
    Gated on rooms_overview:view (see backend/migrations/access.py), a
    module deliberately separate from "bookings" so it can never also
    unlock Booking NCO's write-capable Bookings page. */
export default function RoomsOverview() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [panelRoomId, setPanelRoomId] = useState<number | null>(null);

  const fetchRooms = useCallback(async () => {
    try { const res = await api.get('/bookings/rooms'); setRooms(res.data.items); }
    catch { toast.error('Failed to load rooms'); }
  }, []);

  useEffect(() => { queueMicrotask(() => fetchRooms()); }, [fetchRooms]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') fetchRooms();
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchRooms]);

  const openRoom = (roomId: number) => setPanelRoomId(roomId);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Rooms</h1>

      <Tabs defaultValue="rooms">
        <TabsList className="grid w-full grid-cols-3 max-w-xl">
          <TabsTrigger value="rooms">Rooms</TabsTrigger>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
          <TabsTrigger value="history">Booking History</TabsTrigger>
        </TabsList>

        <TabsContent value="rooms">
          <RoomGridTab rooms={rooms} onOpenRoom={openRoom} onChanged={fetchRooms} readOnly />
        </TabsContent>

        <TabsContent value="calendar">
          <CalendarTab onOpenRoom={openRoom} />
        </TabsContent>

        <TabsContent value="history">
          <BookingsListTab onChanged={fetchRooms} readOnly />
        </TabsContent>
      </Tabs>

      <RoomInfoDialog roomId={panelRoomId} open={panelRoomId !== null} onClose={() => setPanelRoomId(null)} />
    </div>
  );
}
