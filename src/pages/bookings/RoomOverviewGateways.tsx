import { Button } from '@/components/ui/button';
import { Plus, Sparkles, Wrench } from 'lucide-react';
import type { CalendarData } from './shared';

interface RoomOverviewGatewaysProps {
  room: CalendarData['room'];
  current: CalendarData['current_booking'];
  roomFreeToday: boolean;
  onBook: () => void;
  onMarkDirty: () => void;
  onOpenMaintenance: () => void;
}

/** The three intent-driven gateways below the drawer header: start a
    booking, flag the room for housekeeping, or pull it out of inventory
    for maintenance. Each stays hidden when it wouldn't make sense (e.g. no
    "mark dirty" shortcut for a room that's already dirty or occupied - that
    transition is handled by the blocking banner above, not here). */
export function RoomOverviewGateways({ room, current, roomFreeToday, onBook, onMarkDirty, onOpenMaintenance }: RoomOverviewGatewaysProps) {
  return (
    <div className="grid grid-cols-1 gap-2">
      <Button size="sm" variant={roomFreeToday ? 'default' : 'outline'} className="w-full justify-start" onClick={onBook}>
        <Plus size={14} className="mr-1.5" /> {roomFreeToday ? 'Book / Check-In Room' : 'New Booking for a Later Stay'}
      </Button>
      <div className="grid grid-cols-2 gap-2">
        {room.housekeeping_status === 'clean' && !current && (
          <Button size="sm" variant="secondary" className="justify-start font-medium" onClick={onMarkDirty}>
            <Sparkles size={14} className="mr-1.5" /> Mark for Housekeeping
          </Button>
        )}
        {room.status !== 'maintenance' && (
          <Button size="sm" variant="secondary" className="justify-start font-medium" onClick={onOpenMaintenance}>
            <Wrench size={14} className="mr-1.5" /> Send to Maintenance
          </Button>
        )}
      </div>
    </div>
  );
}
