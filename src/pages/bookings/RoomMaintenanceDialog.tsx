import { useState, type RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { X } from 'lucide-react';
import { todayISO, type CalendarData } from './shared';

interface RoomMaintenanceDialogProps {
  room: CalendarData['room'];
  saving: boolean;
  onSave: (notes: string, maintenanceUntil: string) => void;
  onCancel: () => void;
  issueFieldRef: RefObject<HTMLInputElement | null>;
}

/** "Send to Maintenance" gateway target - captures why the room is out of
    service and when it's expected back, instead of the old bare status
    toggle. Pulls the asset out of active booking inventory on save. */
export function RoomMaintenanceDialog({ room, saving, onSave, onCancel, issueFieldRef }: RoomMaintenanceDialogProps) {
  const [notes, setNotes] = useState(room.notes || '');
  const [maintenanceUntil, setMaintenanceUntil] = useState(room.maintenance_until || '');

  return (
    <div className="rounded-lg border-2 border-primary/20 shadow-sm p-4 space-y-3.5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Send to Maintenance</p>
        <button type="button" className="text-gray-400 hover:text-gray-600" onClick={onCancel}><X size={16} /></button>
      </div>
      <div>
        <Label className="text-xs">Issue Description</Label>
        <Input ref={issueFieldRef} placeholder="e.g. AC unit not cooling" value={notes} onChange={e => setNotes(e.target.value)} />
      </div>
      <div>
        <Label className="text-xs">Est. Completion Date</Label>
        <Input type="date" min={todayISO()} value={maintenanceUntil} onChange={e => setMaintenanceUntil(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="flex-1" onClick={onCancel}>Cancel</Button>
        <Button size="sm" className="flex-1" disabled={saving} onClick={() => onSave(notes, maintenanceUntil)}>
          {saving ? 'Saving…' : 'Confirm Maintenance'}
        </Button>
      </div>
    </div>
  );
}
