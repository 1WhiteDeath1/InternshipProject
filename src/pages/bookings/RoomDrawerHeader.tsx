import { SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Camera, ImagePlus, X } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import { ROOM_TYPE_LABELS, type CalendarData } from './shared';
import { RoomStatusPill, HousekeepingBadge, HraBadge } from './badges';

interface RoomDrawerHeaderProps {
  room: CalendarData['room'];
  current: CalendarData['current_booking'];
  uploading: boolean;
  onUploadPhoto: (file: File) => void;
  onDeletePhoto: (photoId: number) => void;
}

/** Compressed 16:9 photo banner + a single metadata subline, so the
    operational gateway buttons below are never pushed below the fold. */
export function RoomDrawerHeader({ room, current, uploading, onUploadPhoto, onDeletePhoto }: RoomDrawerHeaderProps) {
  const [mainPhoto, ...restPhotos] = room.photos;

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center justify-between pr-6">
          <span>Room {room.room_number}</span>
          <span className="flex gap-1.5">
            {current?.nature_of_duty === 'hra' && <HraBadge />}
            <RoomStatusPill status={room.status} />
            <HousekeepingBadge status={room.housekeeping_status} />
          </span>
        </SheetTitle>
      </SheetHeader>

      <div className="relative w-full aspect-video rounded-lg overflow-hidden border bg-gray-100 dark:bg-gray-900 mt-2">
        {mainPhoto ? (
          <>
            <img src={mainPhoto.url} alt={`Room ${room.room_number}`} className="w-full h-full object-cover" />
            <button type="button" onClick={() => onDeletePhoto(mainPhoto.id)}
              className="absolute top-1.5 right-1.5 bg-gray-900/80 text-white rounded-full p-1 opacity-70 hover:opacity-100 transition-opacity">
              <X size={13} />
            </button>
          </>
        ) : (
          <label className="w-full h-full flex flex-col items-center justify-center gap-1 cursor-pointer text-gray-400 hover:text-gray-600">
            <Camera size={24} />
            <span className="text-xs">{uploading ? 'Uploading…' : 'Add room photos'}</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={uploading}
              onChange={e => { const f = e.target.files?.[0]; if (f) onUploadPhoto(f); e.target.value = ''; }} />
          </label>
        )}
      </div>

      {mainPhoto && (
        <div className="flex gap-1.5 overflow-x-auto pt-1.5 pb-0.5">
          {restPhotos.map(p => (
            <div key={p.id} className="relative shrink-0 group">
              <img src={p.url} alt={`Room ${room.room_number}`} className="w-14 h-14 object-cover rounded-md border" />
              <button type="button" onClick={() => onDeletePhoto(p.id)}
                className="absolute -top-1 -right-1 bg-gray-900/80 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <X size={10} />
              </button>
            </div>
          ))}
          <label className="shrink-0 w-14 h-14 rounded-md border-2 border-dashed flex items-center justify-center cursor-pointer text-gray-400 hover:text-gray-600 hover:border-gray-400">
            <ImagePlus size={16} />
            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={uploading}
              onChange={e => { const f = e.target.files?.[0]; if (f) onUploadPhoto(f); e.target.value = ''; }} />
          </label>
        </div>
      )}

      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1.5">
        {ROOM_TYPE_LABELS[room.room_type] || room.room_type}{room.room_type === 'suite' ? ` · ${room.ac_count || 1}×AC` : ''}
        {' · '}Floor {room.floor} · Capacity {room.capacity} guests · {formatCurrency(room.base_price)}/night
      </p>
    </>
  );
}
