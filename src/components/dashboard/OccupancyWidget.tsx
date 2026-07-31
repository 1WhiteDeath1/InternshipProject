import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { ResizableDialog } from '@/components/dashboard/ResizableDialog';
import { BedDouble } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { useTheme } from '@/contexts/useTheme';
import { ROOM_STATE_COLORS } from '@/components/RoomStatusDonut';

interface OccupancyDetail {
  total_rooms: number;
  occupied_count: number;
  not_occupied_count: number;
  occupancy_rate: number;
  non_occupied_by_status: Record<string, number>;
  occupied_by_duty: Record<string, number>;
  last_week_occupancy_rate: number;
}

// Shared with RoomStatusDonut so occupied/vacant/reserved/maintenance mean
// the same color everywhere in the app, not just within this widget.
const OCCUPIED_COLOR = ROOM_STATE_COLORS.occupied;
const NOT_OCCUPIED_COLOR = ROOM_STATE_COLORS.vacant;

// Detail-view palette: warm reds for the occupied-by-duty slice family, cool
// greens/blues for the non-occupied-by-status family - two visually distinct
// groups within one ring, matching the compact widget's red/green split.
const DUTY_COLORS: Record<string, string> = {
  visit: '#DC2626', leave: '#EA580C', official_duty: '#F59E0B', hra: '#BE123C',
};
const DUTY_LABELS: Record<string, string> = {
  visit: 'Visit', leave: 'Leave', official_duty: 'Official Duty', hra: 'HRA Resident',
};
const STATUS_COLORS: Record<string, string> = {
  vacant: ROOM_STATE_COLORS.vacant, reserved: ROOM_STATE_COLORS.reserved, maintenance: ROOM_STATE_COLORS.maintenance,
};
const STATUS_LABELS: Record<string, string> = {
  vacant: 'Vacant', reserved: 'Reserved', maintenance: 'Maintenance',
};

function OccupancyDetailDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { darkMode } = useTheme();
  const [detail, setDetail] = useState<OccupancyDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    queueMicrotask(async () => {
      setLoading(true);
      try { const res = await api.get('/reports/occupancy-detail'); setDetail(res.data); }
      catch { toast.error('Failed to load occupancy detail'); }
      finally { setLoading(false); }
    });
  }, [open]);

  const tooltipStyle = {
    backgroundColor: darkMode ? '#111827' : '#FFFFFF',
    border: `1px solid ${darkMode ? '#374151' : '#E5E7EB'}`, borderRadius: 8,
    color: darkMode ? '#F9FAFB' : '#111827', fontSize: 13,
  };

  const outerData = detail ? [
    ...Object.entries(detail.occupied_by_duty).map(([k, v]) => ({ name: DUTY_LABELS[k] || k, value: v, color: DUTY_COLORS[k] || '#DC2626' })),
    ...Object.entries(detail.non_occupied_by_status).filter(([, v]) => v > 0).map(([k, v]) => ({ name: STATUS_LABELS[k] || k, value: v, color: STATUS_COLORS[k] || '#059669' })),
  ] : [];

  const innerData = detail ? [
    { name: 'Occupied (last week)', value: detail.last_week_occupancy_rate, color: OCCUPIED_COLOR },
    { name: 'Not Occupied (last week)', value: Math.max(100 - detail.last_week_occupancy_rate, 0), color: NOT_OCCUPIED_COLOR },
  ] : [];

  return (
    <ResizableDialog open={open} onClose={onClose} storageKey="occupancy" defaultWidth={560} defaultHeight={620}
      title={<><BedDouble size={20} /> Occupancy Breakdown</>}>
      {({ bucket, chartHeight }) => {
        // Ring radii track the box: a donut scaled for a 560px dialog looks
        // lost at 1100px and clips at 380px.
        const r = Math.max(70, Math.min(chartHeight, bucket === 'sm' ? 200 : 320)) / 2;
        const legend = (
          <div className={`flex flex-wrap gap-x-4 gap-y-1.5 text-xs ${bucket === 'lg' ? 'flex-col' : 'justify-center'}`}>
            {outerData.map((d, i) => (
              <span key={i} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: d.color }} />
                {d.name} <span className="font-semibold">{d.value}</span>
              </span>
            ))}
          </div>
        );
        const chart = (
          <div className="relative">
            <ResponsiveContainer width="100%" height={Math.max(180, Math.min(chartHeight, 360))}>
              <PieChart>
                {/* Inner ring: last week's occupied/not-occupied split, semi-transparent - the trend reference nested inside this week's detail. */}
                <Pie data={innerData} dataKey="value" nameKey="name" innerRadius={0} outerRadius={r * 0.48}
                  stroke="none" isAnimationActive={false}>
                  {innerData.map((d, i) => <Cell key={i} fill={d.color} fillOpacity={0.35} />)}
                </Pie>
                {/* Outer ring: this week's detailed breakdown by duty type / non-occupancy status. */}
                <Pie data={outerData} dataKey="value" nameKey="name" innerRadius={r * 0.65} outerRadius={r}
                  paddingAngle={2} stroke={darkMode ? '#0a0a0a' : '#FFFFFF'} strokeWidth={2}>
                  {outerData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number, name: string) => [name.includes('last week') ? `${v}%` : `${v} rooms`, name]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <p className="text-xs text-gray-400">Inner ring: last week</p>
            </div>
          </div>
        );

        return (
          <>
            {loading && <p className="text-sm text-gray-500 py-8 text-center">Loading…</p>}

            {!loading && detail && (
              <>
                {/* Wide: legend moves beside the ring as a readable column
                    instead of wrapping into a centred ribbon under it. */}
                {bucket === 'lg' ? (
                  <div className="grid grid-cols-[1fr_auto] gap-6 items-center">
                    {chart}
                    {legend}
                  </div>
                ) : (
                  <>{chart}{legend}</>
                )}

                <div className={`grid gap-3 text-center ${bucket === 'sm' ? 'grid-cols-1' : 'grid-cols-2'}`}>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-gray-500">Occupied</p>
                    <p className="text-xl font-bold" style={{ color: OCCUPIED_COLOR }}>{detail.occupied_count} / {detail.total_rooms}</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-gray-500">Not Occupied</p>
                    <p className="text-xl font-bold" style={{ color: NOT_OCCUPIED_COLOR }}>{detail.not_occupied_count} / {detail.total_rooms}</p>
                  </div>
                </div>
                <p className="text-xs text-gray-400 text-center">
                  Last week this time: {detail.last_week_occupancy_rate}% occupied
                </p>
              </>
            )}
          </>
        );
      }}
    </ResizableDialog>
  );
}

export default function OccupancyWidget() {
  const [detail, setDetail] = useState<OccupancyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailOpen, setDetailOpen] = useState(false);

  useEffect(() => {
    queueMicrotask(async () => {
      try { const res = await api.get('/reports/occupancy-detail'); setDetail(res.data); }
      catch { toast.error('Failed to load occupancy'); }
      finally { setLoading(false); }
    });
  }, []);

  const compactData = detail ? [
    { name: 'Occupied', value: detail.occupied_count, color: OCCUPIED_COLOR },
    { name: 'Not Occupied', value: detail.not_occupied_count, color: NOT_OCCUPIED_COLOR },
  ] : [];
  // Same nested-ring trend cue as the detail dialog, shown from the start
  // instead of only after opening it: a semi-transparent inner ring for last
  // week's split, nested inside this week's outer ring.
  const compactInnerData = detail ? [
    { name: 'Occupied (last week)', value: detail.last_week_occupancy_rate, color: OCCUPIED_COLOR },
    { name: 'Not Occupied (last week)', value: Math.max(100 - detail.last_week_occupancy_rate, 0), color: NOT_OCCUPIED_COLOR },
  ] : [];

  return (
    <>
      {/* py-0 cancels Card's own py-6 - CardContent's p-5 below is this
          widget's only vertical padding. */}
      <Card className="cursor-pointer hover:shadow-lg transition-all py-0" onClick={() => setDetailOpen(true)}>
        <CardContent className="p-4">
          <p className="text-base text-gray-500 dark:text-gray-400 flex items-center gap-1.5 mb-1"><BedDouble size={16} /> Occupancy</p>
          <div className="flex items-center gap-4">
            <div className="relative w-24 h-24 shrink-0">
              {!loading && detail && (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={compactInnerData} dataKey="value" nameKey="name" innerRadius={0} outerRadius={17}
                      stroke="none" isAnimationActive={false}>
                      {compactInnerData.map((d, i) => <Cell key={i} fill={d.color} fillOpacity={0.35} />)}
                    </Pie>
                    <Pie data={compactData} dataKey="value" nameKey="name" innerRadius={30} outerRadius={46}
                      paddingAngle={2} stroke="none" isAnimationActive={false}>
                      {compactData.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="space-y-1.5 min-w-0">
              <p className="text-sm"><span className="inline-block w-2.5 h-2.5 rounded-sm mr-1.5" style={{ background: OCCUPIED_COLOR }} />Occupied <span className="font-bold">{loading ? '…' : detail?.occupied_count}</span></p>
              <p className="text-sm"><span className="inline-block w-2.5 h-2.5 rounded-sm mr-1.5" style={{ background: NOT_OCCUPIED_COLOR }} />Not Occupied <span className="font-bold">{loading ? '…' : detail?.not_occupied_count}</span></p>
            </div>
          </div>
        </CardContent>
      </Card>
      <OccupancyDetailDialog open={detailOpen} onClose={() => setDetailOpen(false)} />
    </>
  );
}
