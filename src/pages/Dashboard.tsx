import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { useAuth } from '@/contexts/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  TrendingUp, Users, Package, AlertTriangle, Receipt,
  ShieldCheck, Percent, DollarSign, Trash2
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

interface DashboardStats {
  today_revenue: number;
  occupancy_rate: number;
  total_stock_value: number;
  waste_cost_month: number;
  open_alerts: number;
  pending_approvals: number;
  total_guests_today: number;
  low_stock_count: number;
}

function StatValue({ loading, value }: { loading: boolean; value: string | number }) {
  if (loading) return <span className="inline-block h-6 w-16 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />;
  return <>{value}</>;
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [revenueTrend, setRevenueTrend] = useState<{ labels: string[]; values: number[] } | null>(null);
  const [occupancyTrend, setOccupancyTrend] = useState<{ labels: string[]; values: number[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    queueMicrotask(() => {
      if (user?.is_supervisor) {
        setLoading(true);
        Promise.all([
          api.get('/reports/dashboard').then(res => setStats(res.data)),
          api.get('/reports/revenue-trend?days=14').then(res => setRevenueTrend(res.data)),
          api.get('/reports/occupancy-trend?days=14').then(res => setOccupancyTrend(res.data)),
        ]).catch(() => toast.error('Failed to load dashboard data')).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });
  }, [user]);

  if (!user?.is_supervisor) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Welcome, {user?.full_name}</h1>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/inventory')}>
            <CardContent className="p-6 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                <Package className="text-blue-600" size={24} />
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Inventory</p>
                <p className="text-lg font-semibold">Manage Stock</p>
              </div>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/bookings')}>
            <CardContent className="p-6 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <Users className="text-green-600" size={24} />
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Bookings</p>
                <p className="text-lg font-semibold">Manage Rooms</p>
              </div>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/security')}>
            <CardContent className="p-6 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                <ShieldCheck className="text-purple-600" size={24} />
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Security</p>
                <p className="text-lg font-semibold">View Logs</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const revenueData = revenueTrend?.labels.map((l, i) => ({ date: l.slice(5), value: revenueTrend.values[i] })) || [];
  const occupancyData = occupancyTrend?.labels.map((l, i) => ({ date: l.slice(5), value: occupancyTrend.values[i] })) || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Today's Revenue</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">$<StatValue loading={loading} value={stats?.today_revenue?.toFixed(2) || '0.00'} /></p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <DollarSign className="text-emerald-600" size={20} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Occupancy Rate</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white"><StatValue loading={loading} value={stats?.occupancy_rate || 0} />%</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                <Percent className="text-blue-600" size={20} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Stock Value</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">$<StatValue loading={loading} value={stats?.total_stock_value?.toLocaleString() || '0'} /></p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                <Package className="text-amber-600" size={20} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Waste This Month</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">$<StatValue loading={loading} value={stats?.waste_cost_month?.toFixed(2) || '0.00'} /></p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <Trash2 className="text-red-600" size={20} />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Revenue Trend (14 days)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={revenueData}>
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Line type="monotone" dataKey="value" stroke="#2563EB" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Occupancy Trend (14 days)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={occupancyData}>
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} domain={[0, 100]} />
                <Tooltip />
                <Line type="monotone" dataKey="value" stroke="#0D7377" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Secondary Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="cursor-pointer hover:shadow-md transition-all" onClick={() => navigate('/alerts')}>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <AlertTriangle className="text-red-600" size={18} />
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Open Alerts</p>
              <p className="text-lg font-bold"><StatValue loading={loading} value={stats?.open_alerts || 0} /></p>
            </div>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:shadow-md transition-all" onClick={() => navigate('/procurement')}>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
              <Receipt className="text-orange-600" size={18} />
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Pending Approvals</p>
              <p className="text-lg font-bold"><StatValue loading={loading} value={stats?.pending_approvals || 0} /></p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
              <Users className="text-indigo-600" size={18} />
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Guests Today</p>
              <p className="text-lg font-bold"><StatValue loading={loading} value={stats?.total_guests_today || 0} /></p>
            </div>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:shadow-md transition-all" onClick={() => navigate('/inventory')}>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-pink-100 dark:bg-pink-900/30 flex items-center justify-center">
              <TrendingUp className="text-pink-600" size={18} />
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Low Stock Items</p>
              <p className="text-lg font-bold"><StatValue loading={loading} value={stats?.low_stock_count || 0} /></p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
