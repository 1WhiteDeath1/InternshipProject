import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, ReferenceLine, Tooltip, Cell } from 'recharts';

export interface AnomalyDetail {
  kind: 'peer' | 'trend';
  unit: string;
  value: number;
  mean: number;
  stdev: number;
  z: number;
  series: { label: string; value: number; highlight: boolean }[];
}

const fmt = (v: number, unit: string) => (unit === '%' ? `${v}%` : `${unit} ${v.toLocaleString()}`);

// Renders the anomaly_engine's already-computed value/mean/stdev/z as a
// small bar chart instead of leaving the reason as plain text - the
// flagged bar (staff member, or today for a daily trend) is highlighted
// against its peers/history, with a dashed line at the baseline mean.
export function AnomalyMiniChart({ detail }: { detail: AnomalyDetail }) {
  const isPeer = detail.kind === 'peer';
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center justify-between mb-2 gap-2">
        <p className="text-xs font-medium text-muted-foreground">
          {isPeer ? 'This staff member vs. peers' : 'Last 14 days'}
        </p>
        <p className="text-xs font-mono whitespace-nowrap">
          <span className="font-semibold text-destructive">{fmt(detail.value, detail.unit)}</span>
          <span className="text-muted-foreground"> vs avg {fmt(detail.mean, detail.unit)} (z={detail.z})</span>
        </p>
      </div>
      <div className="h-28">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={detail.series} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10 }}
              interval={0}
              angle={isPeer ? 0 : -35}
              textAnchor={isPeer ? 'middle' : 'end'}
              height={isPeer ? 20 : 32}
            />
            <YAxis hide />
            <ReferenceLine y={detail.mean} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 3" />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
              formatter={(v: number) => [fmt(v, detail.unit), 'Value']}
            />
            <Bar dataKey="value" radius={[3, 3, 0, 0]}>
              {detail.series.map((d, i) => (
                <Cell key={i} fill={d.highlight ? 'hsl(var(--destructive))' : 'hsl(var(--chart-1))'} fillOpacity={d.highlight ? 1 : 0.35} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
