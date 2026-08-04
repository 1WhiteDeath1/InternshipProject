import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  Scale, ChevronLeft, ChevronRight, FileDown, Wallet,
  Ban, Clock, Boxes, Percent, BedDouble, UtensilsCrossed,
} from 'lucide-react';
import { formatCurrency } from '@/lib/currency';

interface CategoryFigures { income: number; cost: number | null; margin: number | null; }

interface SummaryData {
  period: string;
  start_date: string;
  end_date: string;
  room: CategoryFigures;
  mess: CategoryFigures;
  mess_cost_breakdown: { procurement: number; waste: number };
  other_revenue: number;
  total_revenue: number;
  invoice_count: number;
  discounts_total: number;
  void_count: number;
  void_amount: number;
  overdue_amount: number;
  cash_in_total: number;
  cash_in_by_method: { method: string; amount: number }[];
}

interface StockSummary {
  total_stock_value: number;
  low_stock_count: number;
  top_items: { id: number; name: string; sku: string; unit: string; quantity: number; value: number }[];
}

type Period = 'month' | 'year';

const fmtLabel = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

// Income vs. cost, side by side per category - the headline visual this page
// exists for. Room has no cost side (nothing in this system tracks a
// housekeeping/utility/maintenance cost for a room - see the "cost: null"
// contract on GET /billing/reports/summary), so it renders as an income-only
// bar with an explicit "Not tracked" instead of a fabricated number. Mess
// cost is real: committed procurement spend + logged waste, both entirely
// kitchen/mess stock.
function IncomeCostCard({ label, icon: Icon, income, cost, accentClass }: {
  label: string; icon: typeof BedDouble; income: number; cost: number | null; accentClass: string;
}) {
  const margin = cost !== null ? income - cost : null;
  const scale = Math.max(income, cost ?? 0, 1);
  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <p className="font-semibold flex items-center gap-2"><Icon size={18} className={accentClass} /> {label}</p>
          {margin !== null ? (
            <span className={`text-sm font-bold ${margin >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
              {margin >= 0 ? '+' : ''}{formatCurrency(margin)} margin
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Margin not calculable</span>
          )}
        </div>

        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground"><span>Income</span><span className="font-mono font-semibold text-emerald-600">{formatCurrency(income)}</span></div>
          <div className="h-3 rounded-full bg-muted overflow-hidden">
            <div className="h-3 rounded-full bg-emerald-500" style={{ width: `${Math.min((income / scale) * 100, 100)}%` }} />
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Cost</span>
            <span className={`font-mono font-semibold ${cost !== null ? 'text-red-500' : 'text-muted-foreground'}`}>
              {cost !== null ? formatCurrency(cost) : 'Not tracked'}
            </span>
          </div>
          <div className="h-3 rounded-full bg-muted overflow-hidden">
            {cost !== null && <div className="h-3 rounded-full bg-red-500" style={{ width: `${Math.min((cost / scale) * 100, 100)}%` }} />}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Standalone income-vs-cost module for the Clerk (billing:view, same
// permission as the Billing page - not nested under Clerk Desk, and not the
// Manager-only cross-module /reports either). See backend/routers/billing.py
// /reports/summary, /stock-summary, /export/*.
export default function BillingReports() {
  const [period, setPeriod] = useState<Period>('month');
  const [refDate, setRefDate] = useState(new Date());
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [stock, setStock] = useState<StockSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<string | null>(null);

  const dateStr = refDate.toISOString().slice(0, 10);

  useEffect(() => {
    queueMicrotask(() => {
      setLoading(true);
      Promise.all([
        api.get(`/billing/reports/summary?period=${period}&date=${dateStr}`),
        api.get('/billing/stock-summary'),
      ]).then(([sRes, stRes]) => { setSummary(sRes.data); setStock(stRes.data); })
        .catch(err => toast.error(getErrorMessage(err, 'Failed to load reports')))
        .finally(() => setLoading(false));
    });
  }, [period, dateStr]);

  const shift = (dir: 1 | -1) => {
    const d = new Date(refDate);
    if (period === 'month') d.setMonth(d.getMonth() + dir);
    else d.setFullYear(d.getFullYear() + dir);
    setRefDate(d);
  };

  const download = async (kind: 'invoices' | 'payments') => {
    if (!summary) return;
    setExporting(kind);
    try {
      const res = await api.get(`/billing/export/${kind}?start=${summary.start_date}&end=${summary.end_date}`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${kind}_${summary.start_date}_to_${summary.end_date}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success(`${kind === 'invoices' ? 'Invoices' : 'Payments'} exported`);
    } catch (err) { toast.error(getErrorMessage(err, 'Export failed')); }
    finally { setExporting(null); }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Scale size={24} /> Income &amp; Cost
        </h1>
        <p className="text-xs text-muted-foreground">Room vs. mess income compared against known cost, by month or year.</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {(['month', 'year'] as Period[]).map(p => (
            <Button key={p} size="sm" variant={period === p ? 'default' : 'outline'} onClick={() => setPeriod(p)}>
              {p === 'month' ? 'Monthly' : 'Yearly'}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => shift(-1)}><ChevronLeft size={16} /></Button>
          <span className="text-sm font-medium min-w-40 text-center">
            {summary ? `${fmtLabel(summary.start_date)} – ${fmtLabel(summary.end_date)}` : '—'}
          </span>
          <Button size="sm" variant="ghost" onClick={() => shift(1)}><ChevronRight size={16} /></Button>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={!summary || exporting === 'invoices'} onClick={() => download('invoices')}>
            <FileDown size={14} className="mr-1" /> Export Invoices
          </Button>
          <Button size="sm" variant="outline" disabled={!summary || exporting === 'payments'} onClick={() => download('payments')}>
            <FileDown size={14} className="mr-1" /> Export Payments
          </Button>
        </div>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading report…</p>}

      {!loading && summary && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <IncomeCostCard label="Room" icon={BedDouble} accentClass="text-purple-600"
              income={summary.room.income} cost={summary.room.cost} />
            <IncomeCostCard label="Mess" icon={UtensilsCrossed} accentClass="text-orange-600"
              income={summary.mess.income} cost={summary.mess.cost} />
          </div>
          {summary.mess.cost !== null && summary.mess.cost > 0 && (
            <p className="text-xs text-muted-foreground -mt-2">
              Mess cost = {formatCurrency(summary.mess_cost_breakdown.procurement)} procurement + {formatCurrency(summary.mess_cost_breakdown.waste)} waste.
              Room cost isn't tracked anywhere in this system (no housekeeping/utility/maintenance cost model) - only income is shown for Room.
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card><CardContent className="p-4 space-y-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><Wallet size={14} className="text-emerald-600" /> Cash In</div>
              <p className="text-xl font-bold text-emerald-600">{formatCurrency(summary.cash_in_total)}</p>
              <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                {summary.cash_in_by_method.length === 0 && <span>No payments recorded</span>}
                {summary.cash_in_by_method.map(m => (
                  <span key={m.method}>{m.method}: <span className="font-mono font-medium">{formatCurrency(m.amount)}</span></span>
                ))}
              </div>
            </CardContent></Card>
            <Card><CardContent className="p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center"><Percent size={18} className="text-amber-600" /></div>
              <div><p className="text-xs text-muted-foreground">Discounts Given</p><p className="text-lg font-bold">{formatCurrency(summary.discounts_total)}</p></div>
            </CardContent></Card>
            <Card><CardContent className="p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-red-100 dark:bg-red-900/30 flex items-center justify-center"><Ban size={18} className="text-red-600" /></div>
              <div><p className="text-xs text-muted-foreground">Voided</p><p className="text-lg font-bold">{summary.void_count} · {formatCurrency(summary.void_amount)}</p></div>
            </CardContent></Card>
            <Card><CardContent className="p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center"><Clock size={18} className="text-orange-600" /></div>
              <div><p className="text-xs text-muted-foreground">Overdue Balance</p><p className="text-lg font-bold">{formatCurrency(summary.overdue_amount)}</p></div>
            </CardContent></Card>
          </div>

          {stock && (
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium"><Boxes size={16} /> Stock Valuation</div>
                  <div className="text-sm text-muted-foreground">
                    Total: <span className="font-bold text-foreground">{formatCurrency(stock.total_stock_value)}</span>
                    {stock.low_stock_count > 0 && <span className="ml-3 text-amber-600">{stock.low_stock_count} item(s) low stock</span>}
                  </div>
                </div>
                {stock.top_items.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                    {stock.top_items.map(it => (
                      <div key={it.id} className="rounded-md border p-2.5 text-sm">
                        <p className="font-medium truncate" title={it.name}>{it.name}</p>
                        <p className="text-xs text-muted-foreground">{it.quantity} {it.unit}</p>
                        <p className="font-mono text-xs font-semibold">{formatCurrency(it.value)}</p>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-sm text-muted-foreground">No stock on hand.</p>}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
