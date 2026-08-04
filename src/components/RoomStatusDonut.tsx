import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { Sparkles } from 'lucide-react';

// Room-state palette validated with the dataviz six-checks against both the
// light and dark surfaces: occupied red, reserved blue, vacant green,
// maintenance amber. Identity is never color-alone - the legend beside the
// donut always carries label + count.
export const ROOM_STATE_COLORS = {
  occupied: '#DC2626',
  reserved: '#2563EB',
  vacant: '#059669',
  maintenance: '#D97706',
} as const;

export interface RoomStatusCounts {
  total_rooms: number;
  occupied: number;
  reserved: number;
  vacant: number;
  maintenance: number;
  needs_housekeeping: number;
}

export function RoomStatusDonut({ counts }: { counts: RoomStatusCounts | null }) {
  const segmentStroke = 'hsl(var(--card))'; // the 2px surface gap between segments
  const tooltipStyle = {
    backgroundColor: 'hsl(var(--popover))',
    border: '1px solid hsl(var(--border))',
    borderRadius: 8, color: 'hsl(var(--popover-foreground))', fontSize: 15,
  };

  const states = [
    { key: 'occupied' as const, label: 'Occupied', value: counts?.occupied ?? 0 },
    { key: 'reserved' as const, label: 'Reserved', value: counts?.reserved ?? 0 },
    { key: 'vacant' as const, label: 'Vacant', value: counts?.vacant ?? 0 },
    { key: 'maintenance' as const, label: 'Maintenance', value: counts?.maintenance ?? 0 },
  ];
  const donutData = states.filter(s => s.value > 0);
  const rate = counts ? Math.round((counts.occupied / (counts.total_rooms || 1)) * 100) : 0;

  return (
    <div className="flex items-center gap-4 flex-wrap">
      <div className="relative w-44 h-44 shrink-0 mx-auto">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={donutData} dataKey="value" nameKey="label" innerRadius={58} outerRadius={85}
              paddingAngle={2} stroke={segmentStroke} strokeWidth={2}>
              {donutData.map(s => <Cell key={s.key} fill={ROOM_STATE_COLORS[s.key]} />)}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number, name: string) => [`${v} rooms`, name]} />
          </PieChart>
        </ResponsiveContainer>
        {/* Hero number in the donut's center: the figure that matters most */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <p className="text-4xl font-bold text-foreground leading-none">{rate}%</p>
          <p className="text-sm text-muted-foreground mt-1">occupied</p>
        </div>
      </div>
      <div className="flex-1 min-w-[10rem] space-y-2">
        {states.map(s => (
          <div key={s.key} className="flex items-center gap-3">
            <span className="w-3.5 h-3.5 rounded-sm shrink-0" style={{ background: ROOM_STATE_COLORS[s.key] }} />
            <span className="text-base text-muted-foreground flex-1">{s.label}</span>
            <span className="text-2xl font-bold text-foreground">{s.value}</span>
          </div>
        ))}
        <div className="flex items-center gap-3 border-t pt-2 mt-1">
          <Sparkles size={15} className="text-amber-500 shrink-0" />
          <span className="text-base text-muted-foreground flex-1">Need cleaning</span>
          <span className="text-2xl font-bold text-amber-600">{counts?.needs_housekeeping ?? 0}</span>
        </div>
      </div>
    </div>
  );
}
