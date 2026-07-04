import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { BarChart3, Trash2, Truck } from 'lucide-react';

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
  accuracy: number;
}

export default function Reports() {
  const [revenueTrend, setRevenueTrend] = useState<TrendData | null>(null);
  const [occupancyTrend, setOccupancyTrend] = useState<TrendData | null>(null);
  const [wasteData, setWasteData] = useState<WasteByCategory | null>(null);
  const [vendorPerf, setVendorPerf] = useState<VendorPerformance[]>([]);

  useEffect(() => {
    api.get('/reports/revenue-trend?days=30').then(res => setRevenueTrend(res.data)).catch(() => {});
    api.get('/reports/occupancy-trend?days=30').then(res => setOccupancyTrend(res.data)).catch(() => {});
    api.get('/reports/waste-by-category').then(res => setWasteData(res.data)).catch(() => {});
    api.get('/reports/vendor-performance').then(res => setVendorPerf(res.data)).catch(() => {});
  }, []);

  const revenueChart = revenueTrend?.labels?.map((l: string, i: number) => ({ date: l.slice(5), value: revenueTrend.values[i] })) || [];
  const occupancyChart = occupancyTrend?.labels?.map((l: string, i: number) => ({ date: l.slice(5), value: occupancyTrend.values[i] })) || [];
  const wasteChart = wasteData?.labels?.map((l: string, i: number) => ({ name: l, value: wasteData.costs?.[i] || 0 })) || [];

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
          <CardHeader><CardTitle className="text-sm font-medium flex items-center gap-2"><Truck size={16} /> Vendor Performance</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={vendorPerf} layout="vertical">
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 12 }} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={100} />
                <Tooltip />
                <Bar dataKey="accuracy" fill="#2563EB" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
