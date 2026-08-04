import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ResizableDialog, statCols } from '@/components/dashboard/ResizableDialog';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { Package } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';

interface StockItemRow { item_id: number; name: string; unit: string; total_stock: number; reorder_level: number; }
interface CostRow { item_id: number; item_name: string; total_spend: number; }
interface StockOverview {
  inventory_value: number;
  month_procurement: number;
  low_stock_count: number;
  low_stock_items: StockItemRow[];
  well_stocked_items: StockItemRow[];
  top_costing_products: CostRow[];
}
interface WasteData { labels: string[]; quantities: number[]; costs: number[]; }

const costConfig: ChartConfig = { total_spend: { label: 'Spend (30d)', color: 'hsl(var(--chart-1))' } };

function StockDetailDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [data, setData] = useState<StockOverview | null>(null);
  const [waste, setWaste] = useState<WasteData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    queueMicrotask(async () => {
      setLoading(true);
      try {
        const [overviewRes, wasteRes] = await Promise.all([
          api.get('/reports/stock-overview'),
          api.get('/reports/waste-by-category'),
        ]);
        setData(overviewRes.data);
        setWaste(wasteRes.data);
      } catch { toast.error('Failed to load stock overview'); }
      finally { setLoading(false); }
    });
  }, [open]);

  const chartData = data?.top_costing_products.map(r => ({ name: r.item_name, total_spend: r.total_spend })) ?? [];
  const wasteRows = waste?.labels.map((l, i) => ({ label: l, cost: waste.costs[i], qty: waste.quantities[i] })) ?? [];
  const wasteTotal = wasteRows.reduce((s, r) => s + r.cost, 0);

  return (
    <ResizableDialog open={open} onClose={onClose} storageKey="stock-overview" defaultWidth={840} defaultHeight={680}
      title={<><Package size={20} /> Stock &amp; Procurement Overview</>}>
      {({ bucket, chartHeight }) => (
        <>
          {loading && <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>}

          {!loading && data && (
            <>
              <div className={`grid gap-3 ${statCols(bucket, 3)}`}>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Inventory Value</p>
                  <p className="text-lg font-bold font-mono">{formatCurrency(data.inventory_value)}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Procurement (Month)</p>
                  <p className="text-lg font-bold font-mono">{formatCurrency(data.month_procurement)}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Low Stock Items</p>
                  <p className="text-lg font-bold font-mono text-amber-600">{data.low_stock_count}</p>
                </div>
              </div>

              <div>
                <p className="text-sm font-semibold mb-2">Top Costing Products (30 days)</p>
                {chartData.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">No procurement in the last 30 days</p>
                ) : (
                  <ChartContainer config={costConfig} style={{ height: Math.max(160, chartHeight * 0.55) }} className="w-full">
                    <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => formatCurrency(v)} />
                      <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={bucket === 'sm' ? 70 : 100} />
                      <ChartTooltip content={<ChartTooltipContent formatter={v => [formatCurrency(v as number), 'Spend']} />} />
                      <Bar dataKey="total_spend" fill="hsl(var(--chart-1))" radius={[0, 4, 4, 0]} maxBarSize={22} />
                    </BarChart>
                  </ChartContainer>
                )}
              </div>

              <div className={bucket === 'lg' ? 'grid grid-cols-2 gap-4' : 'space-y-4'}>
                <div>
                  <p className="text-sm font-semibold mb-2 flex items-center gap-1.5">Low Stock <Badge variant="outline" className="text-amber-600 border-amber-300">{data.low_stock_items.length}</Badge></p>
                  {data.low_stock_items.length === 0 ? <p className="text-sm text-muted-foreground">Nothing below reorder level</p> : (
                    <Table>
                      <TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Stock</TableHead><TableHead>Reorder At</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {data.low_stock_items.map(r => (
                          <TableRow key={r.item_id}>
                            <TableCell className="font-medium">{r.name}</TableCell>
                            <TableCell className="text-amber-600 font-medium">{r.total_stock} {r.unit}</TableCell>
                            <TableCell className="text-muted-foreground">{r.reorder_level} {r.unit}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
                <div>
                  <p className="text-sm font-semibold mb-2">Well Stocked</p>
                  {data.well_stocked_items.length === 0 ? <p className="text-sm text-muted-foreground">No stock data yet</p> : (
                    <Table>
                      <TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Stock</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {data.well_stocked_items.map(r => (
                          <TableRow key={r.item_id}>
                            <TableCell className="font-medium">{r.name}</TableCell>
                            <TableCell className="text-emerald-600 font-medium">{r.total_stock} {r.unit}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              </div>

              <div>
                <p className="text-sm font-semibold mb-2">Waste This Month{wasteTotal > 0 && <span className="text-muted-foreground font-normal"> — {formatCurrency(wasteTotal)} total</span>}</p>
                {wasteRows.length === 0 ? <p className="text-sm text-muted-foreground">No waste logged this month</p> : (
                  <div className="space-y-1.5">
                    {wasteRows.map(r => (
                      <div key={r.label} className="flex items-center justify-between text-sm">
                        <span className="capitalize">{r.label}</span>
                        <span className="font-medium">{formatCurrency(r.cost)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </ResizableDialog>
  );
}

export default function StockOverviewWidget() {
  const [data, setData] = useState<StockOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailOpen, setDetailOpen] = useState(false);

  useEffect(() => {
    queueMicrotask(async () => {
      try { const res = await api.get('/reports/stock-overview'); setData(res.data); }
      catch { toast.error('Failed to load stock overview'); }
      finally { setLoading(false); }
    });
  }, []);

  return (
    <>
      <Card className="cursor-pointer hover:shadow-lg transition-all py-0" onClick={() => setDetailOpen(true)}>
        <CardContent className="p-4">
          <p className="text-base text-muted-foreground flex items-center gap-1.5 mb-1"><Package size={16} /> Stock &amp; Procurement</p>
          {loading ? (
            <span className="inline-block h-8 w-32 bg-muted rounded animate-pulse" />
          ) : (
            <p className="text-3xl font-bold tracking-tight text-foreground">{formatCurrency(data?.inventory_value ?? 0)}</p>
          )}
          <p className="text-sm text-muted-foreground mt-0.5">inventory value on hand</p>
          {!loading && (
            <p className="text-sm mt-2">
              {(data?.low_stock_count ?? 0) > 0 ? (
                <span className="text-amber-600 font-medium">{data?.low_stock_count} item{data?.low_stock_count === 1 ? '' : 's'} low on stock</span>
              ) : (
                <span className="text-emerald-600 font-medium">Stock levels healthy</span>
              )}
            </p>
          )}
        </CardContent>
      </Card>
      <StockDetailDialog open={detailOpen} onClose={() => setDetailOpen(false)} />
    </>
  );
}
