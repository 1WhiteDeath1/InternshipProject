import { formatCurrency } from '@/lib/currency';

export interface SplitSegment { label: string; amount: number; colorClass: string; }

// Compact composition bar: proportion of a total at a glance in ~2 lines,
// instead of making the reader add up a list of numbers themselves. Segments
// at 0 (e.g. an already-billed side) are omitted from the bar but stay in
// the legend so the exact figure is still visible.
export function ChargeSplitBar({ segments, className = '' }: { segments: SplitSegment[]; className?: string }) {
  const total = segments.reduce((s, x) => s + x.amount, 0);
  const drawn = segments.filter(s => s.amount > 0);
  return (
    <div className={className}>
      {drawn.length > 0 && (
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
          {drawn.map(s => (
            <div key={s.label} className={s.colorClass}
              style={{ width: `${total > 0 ? Math.max((s.amount / total) * 100, 4) : 0}%` }}
              title={`${s.label}: ${formatCurrency(s.amount)}`} />
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[11px] text-muted-foreground">
        {segments.map(s => (
          <span key={s.label} className="inline-flex items-center gap-1">
            <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${s.amount > 0 ? s.colorClass : 'bg-muted'}`} />
            {s.label} <span className="font-mono font-medium">{s.amount > 0 ? formatCurrency(s.amount) : '—'}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
