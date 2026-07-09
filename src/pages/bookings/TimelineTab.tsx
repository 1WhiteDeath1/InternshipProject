import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';
import { fmtDay, todayISO, type TimelineData } from './shared';

interface TimelineTabProps {
  onOpenRoom: (roomId: number) => void;
}

const CELL_COLORS: Record<string, string> = {
  occupied: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100',
  reserved: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100',
  maintenance: 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  vacant: '',
};

export default function TimelineTab({ onOpenRoom }: TimelineTabProps) {
  const [data, setData] = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { const res = await api.get('/bookings/timeline?days=7'); setData(res.data); }
    catch (err) { toast.error(getErrorMessage(err, 'Failed to load the 7-day overview')); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { queueMicrotask(() => load()); }, [load]);

  const today = todayISO();

  const floorGroups = useMemo(() => {
    if (!data) return [];
    const byFloor = new Map<number, TimelineData['rooms']>();
    for (const r of data.rooms) {
      if (!byFloor.has(r.floor)) byFloor.set(r.floor, []);
      byFloor.get(r.floor)!.push(r);
    }
    return [...byFloor.entries()].sort(([a], [b]) => a - b);
  }, [data]);

  if (loading) return <p className="text-sm text-gray-500 text-center py-8">Loading 7-day overview…</p>;
  if (!data) return null;

  return (
    <Card>
      <CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b">
              <th className="text-left font-medium text-gray-500 text-xs py-2 px-3 sticky left-0 bg-white dark:bg-gray-950">Room</th>
              {data.dates.map(d => (
                <th key={d} className={`text-center font-medium text-xs py-2 px-2 min-w-20 ${d === today ? 'text-gray-900 dark:text-white' : 'text-gray-500'}`}>{fmtDay(d)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {floorGroups.map(([floor, rooms]) => (
              <Fragment key={floor}>
                <tr>
                  <td colSpan={data.dates.length + 1} className="bg-gray-50 dark:bg-gray-900 text-xs font-medium text-gray-400 uppercase tracking-wide py-1 px-3">Floor {floor}</td>
                </tr>
                {rooms.map(r => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-1.5 px-3 font-medium sticky left-0 bg-white dark:bg-gray-950 cursor-pointer hover:underline" onClick={() => onOpenRoom(r.id)}>
                      {r.room_number}
                    </td>
                    {r.cells.map(c => (
                      <td key={c.date} title={c.guest_name ? `${c.guest_name}${c.booking_reference ? ` (${c.booking_reference})` : ''}` : c.status}
                        onClick={() => onOpenRoom(r.id)}
                        className={`text-center text-[11px] py-1.5 px-1 cursor-pointer truncate max-w-20 ${CELL_COLORS[c.status] || ''} ${c.date === today ? 'ring-1 ring-inset ring-gray-400' : ''}`}>
                        {c.guest_name ? c.guest_name.split(' ')[0] : ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
