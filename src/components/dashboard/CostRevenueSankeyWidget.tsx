import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Waves } from 'lucide-react';
import { Sankey, ResponsiveContainer, Rectangle, Layer } from 'recharts';
import { useTheme } from '@/contexts/useTheme';
import { formatCurrency } from '@/lib/currency';

interface FlowData {
  room_revenue: number; mess_revenue: number; other_revenue: number;
  procurement_cost: number; waste_cost: number; total_revenue: number; profit: number;
}

const RANGES = [
  { key: '7', label: '1W' },
  { key: '30', label: '1M' },
  { key: '90', label: '3M' },
  { key: '365', label: '1Y' },
];

interface SankeyNodeDatum { name: string; color: string; amount: number; }

type LabelMode = 'none' | 'short' | 'full';

function LabeledNode({ x, y, width, height, payload, labelMode }: {
  x: number; y: number; width: number; height: number; payload: SankeyNodeDatum; labelMode: LabelMode;
}) {
  const isLeft = x < 150;
  return (
    <Layer>
      <Rectangle x={x} y={y} width={width} height={height} fill={payload.color} fillOpacity={1} stroke="none" />
      {labelMode !== 'none' && (
        <text x={isLeft ? x - 6 : x + width + 6} y={y + height / 2} textAnchor={isLeft ? 'end' : 'start'}
          dominantBaseline="middle" fontSize={labelMode === 'full' ? 12 : 11} fontWeight={600} fill="currentColor" className="text-gray-700 dark:text-gray-200">
          {payload.name}{labelMode === 'full' ? ` (${formatCurrency(payload.amount)})` : ''}
        </text>
      )}
    </Layer>
  );
}

function buildFlow(data: FlowData) {
  // Node rectangles are still sized by Recharts' own link-derived Sankey
  // value (it doesn't accept a value override), but the *label text* always
  // reads from this real `amount` instead - so a loss (cost > revenue, where
  // outflow can't literally balance inflow) never mislabels a node with a
  // number that doesn't match its real total. Every link also gets a visual
  // floor (a minimum share of the largest side of the diagram) so a
  // small-but-real category (a modest Mess Revenue, a tiny Waste Cost) still
  // renders as its own visible band instead of a razor-thin, effectively
  // invisible line - the label's `amount` is what stays truthful about the
  // real figure. Scaled off the bigger of revenue/cost/|profit|, not revenue
  // alone, so a cost that dwarfs revenue (a runaway PO, say) doesn't leave
  // every other category looking like "just one line" by comparison.
  const nodes: SankeyNodeDatum[] = [];
  const links: { source: number; target: number; value: number }[] = [];
  const idx: Record<string, number> = {};
  const add = (name: string, color: string, amount: number) => { idx[name] = nodes.length; nodes.push({ name, color, amount }); return idx[name]; };
  const totalCost = data.procurement_cost + data.waste_cost;
  const scale = Math.max(data.total_revenue, totalCost, Math.abs(data.profit), 1);
  const floor = (v: number) => Math.max(v, scale * 0.05, 1);

  // All three revenue types always get their own line, even if one is small
  // or momentarily zero for the selected range - a Sankey with only one
  // revenue source reads as "there's only one kind of revenue", which isn't
  // true even when Mess/Other happen to be light for that period.
  const revenueSources: [string, number, string][] = [
    ['Room Revenue', data.room_revenue, '#7C3AED'],
    ['Mess Revenue', data.mess_revenue, '#EA580C'],
    ['Other Revenue', data.other_revenue, '#64748B'],
  ];

  revenueSources.forEach(([name, value, color]) => add(name, color, value));
  const totalIdx = add('Total Revenue', '#2563EB', data.total_revenue);
  revenueSources.forEach(([name, value]) => links.push({ source: idx[name], target: totalIdx, value: floor(value) }));

  if (data.procurement_cost > 0.01) {
    const i = add('Procurement Cost', '#DC2626', data.procurement_cost);
    links.push({ source: totalIdx, target: i, value: floor(data.procurement_cost) });
  }
  if (data.waste_cost > 0.01) {
    const i = add('Waste Cost', '#F59E0B', data.waste_cost);
    links.push({ source: totalIdx, target: i, value: floor(data.waste_cost) });
  }
  const isLoss = data.profit < 0;
  const profitIdx = add(isLoss ? 'Loss' : 'Profit', isLoss ? '#B91C1C' : '#059669', Math.abs(data.profit));
  // Sankey links can't carry a negative value - a loss still renders as a
  // flow (sized off the cost side) but the real signed number is what's
  // shown in the label (via `amount` above) and the summary text below.
  links.push({ source: totalIdx, target: profitIdx, value: floor(Math.abs(data.profit)) });

  return { nodes, links };
}

function SankeyDetailDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { darkMode } = useTheme();
  const [range, setRange] = useState('30');
  const [data, setData] = useState<FlowData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    queueMicrotask(async () => {
      setLoading(true);
      try { const res = await api.get(`/reports/cost-revenue-flow?days=${range}`); setData(res.data); }
      catch { toast.error('Failed to load cost/revenue flow'); }
      finally { setLoading(false); }
    });
  }, [open, range]);

  const flow = data ? buildFlow(data) : null;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Waves size={20} /> Revenue → Cost → Profit</DialogTitle></DialogHeader>

        <ToggleGroup type="single" value={range} onValueChange={v => v && setRange(v)} variant="outline">
          {RANGES.map(r => <ToggleGroupItem key={r.key} value={r.key}>{r.label}</ToggleGroupItem>)}
        </ToggleGroup>

        {loading && <p className="text-sm text-gray-500 py-8 text-center">Loading…</p>}

        {!loading && flow && data && (
          <>
            <div style={{ color: darkMode ? '#E5E7EB' : '#374151' }}>
              <ResponsiveContainer width="100%" height={340}>
                <Sankey data={flow} nodeWidth={14} nodePadding={28} linkCurvature={0.5}
                  node={(props: unknown) => <LabeledNode {...(props as { x: number; y: number; width: number; height: number; payload: SankeyNodeDatum })} labelMode="full" />}
                  link={{ stroke: darkMode ? '#9CA3AF' : '#64748B', strokeOpacity: 0.85 }}
                  margin={{ top: 10, right: 140, bottom: 10, left: 110 }} />
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-gray-500">Total Revenue</p>
                <p className="text-lg font-bold font-mono text-blue-600">{formatCurrency(data.total_revenue)}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-gray-500">Total Cost</p>
                <p className="text-lg font-bold font-mono text-red-600">{formatCurrency(data.procurement_cost + data.waste_cost)}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-gray-500">{data.profit < 0 ? 'Loss' : 'Profit'}</p>
                <p className={`text-lg font-bold font-mono ${data.profit < 0 ? 'text-red-700' : 'text-emerald-600'}`}>{formatCurrency(Math.abs(data.profit))}</p>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function CostRevenueSankeyWidget() {
  const { darkMode } = useTheme();
  const [data, setData] = useState<FlowData | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailOpen, setDetailOpen] = useState(false);

  useEffect(() => {
    queueMicrotask(async () => {
      try { const res = await api.get('/reports/cost-revenue-flow?days=30'); setData(res.data); }
      catch { toast.error('Failed to load cost/revenue flow'); }
      finally { setLoading(false); }
    });
  }, []);

  // Compact preview: full node color and short (name-only, no amounts) labels
  // so the flow reads at a glance - real numbers stay one tap away in the
  // detail dialog. Same node layout as the detail view (revenue in, cost +
  // profit out) built from real proportions.
  const preview = data ? buildFlow(data) : null;

  return (
    <>
      {/* py-0 cancels Card's own py-6 - CardContent's p-5 below is this
          widget's only vertical padding. */}
      <Card className="cursor-pointer hover:shadow-lg transition-all py-0" onClick={() => setDetailOpen(true)}>
        <CardContent className="p-4">
          <p className="text-base text-gray-500 dark:text-gray-400 flex items-center gap-1.5 mb-1.5"><Waves size={16} /> Cost &amp; Revenue Flow</p>
          <div className="h-32" style={{ color: darkMode ? '#E5E7EB' : '#374151' }}>
            {!loading && preview && (
              <ResponsiveContainer width="100%" height="100%">
                <Sankey data={preview} nodeWidth={12} nodePadding={18} linkCurvature={0.5}
                  node={(props: unknown) => <LabeledNode {...(props as { x: number; y: number; width: number; height: number; payload: SankeyNodeDatum })} labelMode="short" />}
                  link={{ stroke: darkMode ? '#9CA3AF' : '#64748B', strokeOpacity: 0.85 }}
                  margin={{ top: 8, right: 95, bottom: 8, left: 80 }} />
              </ResponsiveContainer>
            )}
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Tap for the full revenue → cost → profit breakdown</p>
        </CardContent>
      </Card>
      <SankeyDetailDialog open={detailOpen} onClose={() => setDetailOpen(false)} />
    </>
  );
}
