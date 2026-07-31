import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { useAuth } from '@/contexts/useAuth';
import { hasPermission } from '@/contexts/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { BarChart3, Trash2, Truck, Flame } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';

const COLORS = ['#2563EB', '#0D7377', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

interface TrendData {
  labels: string[];
  values: number[];
}

interface WasteByCategory {
  labels: string[];
  quantities: number[];
  costs: number[];
}

interface VendorPerformance {
  name: string;
  spend_30d: number;
}

interface RateHistoryRow { old_percentage: number; new_percentage: number; changed_at: string; }

export default function Reports() {
  const { user } = useAuth();
  const canViewMessRates = hasPermission(user, 'mess_rates', 'view') || hasPermission(user, 'mess_rates', 'edit');
  const [revenueTrend, setRevenueTrend] = useState<TrendData | null>(null);
  const [occupancyTrend, setOccupancyTrend] = useState<TrendData | null>(null);
  const [wasteData, setWasteData] = useState<WasteByCategory | null>(null);
  const [vendorPerf, setVendorPerf] = useState<VendorPerformance[]>([]);
  const [rateHistory, setRateHistory] = useState<RateHistoryRow[]>([]);

  useEffect(() => {
    api.get('/reports/revenue-trend?days=30').then(res => setRevenueTrend(res.data)).catch(() => {});
    api.get('/reports/occupancy-trend?days=30').then(res => setOccupancyTrend(res.data)).catch(() => {});
    api.get('/reports/waste-by-category').then(res => setWasteData(res.data)).catch(() => {});
    api.get('/reports/vendor-performance').then(res => setVendorPerf(res.data)).catch(() => {});
    if (canViewMessRates) api.get('/kitchen/gas-rate/history').then(res => setRateHistory(res.data)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const revenueChart = revenueTrend?.labels?.map((l: string, i: number) => ({ date: l.slice(5), value: revenueTrend.values[i] })) || [];
  const occupancyChart = occupancyTrend?.labels?.map((l: string, i: number) => ({ date: l.slice(5), value: occupancyTrend.values[i] })) || [];
  const wasteChart = wasteData?.labels?.map((l: string, i: number) => ({ name: l, value: wasteData.costs?.[i] || 0 })) || [];
  const gasRateChart = rateHistory.map(r => ({ date: r.changed_at.slice(0, 10), percentage: r.new_percentage }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2"><BarChart3 size={24} /> Reports & Analytics</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium">Revenue Trend (30 days)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={revenueChart}>
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="value" fill="#2563EB" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm font-medium">Occupancy Trend (30 days)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={occupancyChart}>
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} domain={[0, 100]} />
                <Tooltip />
                <Bar dataKey="value" fill="#0D7377" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium flex items-center gap-2"><Trash2 size={16} /> Waste by Category (This Month)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={wasteChart} cx="50%" cy="50%" outerRadius={80} dataKey="value" label>
                  {wasteChart.map((_, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap gap-3 justify-center mt-2">
              {wasteChart.map((w, i: number) => (
                <div key={i} className="flex items-center gap-1.5 text-sm">
                  <div className="w-3 h-3 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                  <span className="capitalize">{w.name}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm font-medium flex items-center gap-2"><Truck size={16} /> Top Vendors by Spend (30 days)</CardTitle></CardHeader>
          <CardContent>
            {vendorPerf.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-10">No vendor-tagged purchases in the last 30 days</p>
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={vendorPerf} layout="vertical">
                  <XAxis type="number" tick={{ fontSize: 12 }} tickFormatter={v => formatCurrency(v)} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={100} />
                  <Tooltip formatter={(v: number) => formatCurrency(v)} />
                  <Bar dataKey="spend_30d" fill="#2563EB" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {canViewMessRates && (
        <Card className="max-w-xl">
          <CardHeader><CardTitle className="text-sm font-medium flex items-center gap-2"><Flame size={16} /> Gas Charge Rate Trend</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={gasRateChart}>
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 12 }} unit="%" />
                <Tooltip formatter={(v: number) => `${v}%`} />
                <Line type="stepAfter" dataKey="percentage" stroke="#EF4444" strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
            {gasRateChart.length === 0 && <p className="text-center text-sm text-gray-400">No rate changes recorded yet</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
