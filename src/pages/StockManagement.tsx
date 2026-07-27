import { useEffect, useState, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import {
  Search, Plus, AlertTriangle,
  Package, DollarSign, ShoppingCart, ArrowRight, Camera,
} from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, BarChart, Bar,
} from 'recharts';
import { ReceiptScanDialog } from '@/components/ReceiptScanDialog';

// ── Types ──

interface InventoryItem {
  id: number;
  sku: string;
  name: string;
  category_name: string;
  unit: string;
  reorder_level: number;
  total_stock: number;
  is_active: boolean;
  last_unit_cost: number | null;
}

interface Category {
  id: number;
  name: string;
}

interface DashboardData {
  month_total: number;
  inventory_value: number;
  low_stock_count: number;
  top_cost_driver: { item_name: string; total_spend: number } | null;
  procurement_frequency: { item_id: number; item_name: string; intake_count: number }[];
  top_costing_products: { item_id: number; item_name: string; total_spend: number }[];
}

interface PriceHistory {
  item_id: number;
  item_name: string;
  unit: string;
  volatility_pct: number | null;
  history: { date: string; unit_price: number; quantity: number }[];
}

interface RecentIntake {
  id: number;
  item_id: number;
  item_name: string;
  quantity: number;
  unit: string;
  unit_cost: number;
  total_cost: number;
  received_date: string | null;
  created_at: string | null;
}

// ── Main Component ──

export default function StockManagement() {
  const location = useLocation();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [prefillItemId, setPrefillItemId] = useState<number | null>(null);
  const [autoScan, setAutoScan] = useState(false);

  // The global "Scan Receipt" shortcut (Layout.tsx) deep-links here with
  // navigation state - consume it once, then clear the state so a
  // back-navigation or remount doesn't reopen the dialog.
  useEffect(() => { queueMicrotask(() => {
    const state = location.state as { openScan?: boolean } | null;
    if (state?.openScan) {
      setActiveTab('intake');
      setAutoScan(true);
      navigate(location.pathname, { replace: true, state: null });
    }
  }); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Inventory & Procurement
        </h1>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3 max-w-lg">
          <TabsTrigger value="dashboard">Dashboard & Analytics</TabsTrigger>
          <TabsTrigger value="intake">Daily Stock Intake</TabsTrigger>
          <TabsTrigger value="stock">Current Stock</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="mt-4">
          <DashboardTab />
        </TabsContent>
        <TabsContent value="intake" className="mt-4">
          <IntakeTab
            prefillItemId={prefillItemId}
            onPrefillConsumed={() => setPrefillItemId(null)}
            autoScan={autoScan}
            onAutoScanConsumed={() => setAutoScan(false)}
          />
        </TabsContent>
        <TabsContent value="stock" className="mt-4">
          <StockTab onLogIntake={(itemId) => {
            setPrefillItemId(itemId);
            setActiveTab('intake');
          }} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// TAB 1: Dashboard & Analytics
// ═══════════════════════════════════════════════════════════════════

function DashboardTab() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [priceHistory, setPriceHistory] = useState<PriceHistory | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [priceLoading, setPriceLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [dashRes, itemsRes] = await Promise.all([
          api.get('/inventory/dashboard'),
          api.get('/inventory/items?page_size=100'),
        ]);
        setData(dashRes.data);
        setItems(itemsRes.data.items);
        if (itemsRes.data.items.length > 0 && !selectedItemId) {
          setSelectedItemId(String(itemsRes.data.items[0].id));
        }
      } catch {
        toast.error('Failed to load dashboard');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  useEffect(() => {
    if (!selectedItemId) return;
    setPriceLoading(true);
    api.get(`/inventory/price-history/${selectedItemId}`)
      .then(res => setPriceHistory(res.data))
      .catch(() => toast.error('Failed to load price history'))
      .finally(() => setPriceLoading(false));
  }, [selectedItemId]);

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading dashboard...</div>;
  }
  if (!data) return null;

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <ShoppingCart className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Procurement (Month)</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white">{formatCurrency(data.month_total)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
                <Package className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Inventory Value</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white">{formatCurrency(data.inventory_value)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
                <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Low Stock Alerts</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white">{data.low_stock_count}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
                <DollarSign className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Top Cost Driver</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white truncate">
                  {data.top_cost_driver?.item_name ?? '—'}
                </p>
                {data.top_cost_driver && (
                  <p className="text-xs text-gray-400">{formatCurrency(data.top_cost_driver.total_spend)} / 30 days</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Price Fluctuation - full width on its own row: the item selector
          needs room to breathe, and it doesn't pair naturally with the two
          ranked-list charts below. */}
      <div className="grid grid-cols-1 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-base">Ingredient Price Fluctuation</CardTitle>
              <Select value={selectedItemId} onValueChange={setSelectedItemId}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Select item" />
                </SelectTrigger>
                <SelectContent>
                  {items.map(item => (
                    <SelectItem key={item.id} value={String(item.id)}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {priceHistory?.volatility_pct != null && (
              <p className="text-sm text-gray-500 mt-1">
                {priceHistory.item_name}: <span className={priceHistory.volatility_pct > 10 ? 'text-red-500 font-medium' : 'text-green-600'}>
                  {priceHistory.volatility_pct > 0 ? '+' : ''}{priceHistory.volatility_pct}% volatility (90d)
                </span>
              </p>
            )}
          </CardHeader>
          <CardContent>
            {priceLoading ? (
              <div className="h-[250px] flex items-center justify-center text-gray-400">Loading chart...</div>
            ) : priceHistory && priceHistory.history.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={priceHistory.history}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border, #e5e7eb)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--muted-foreground, #9ca3af)" />
                  <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground, #9ca3af)" />
                  <RechartsTooltip
                    contentStyle={{ background: 'var(--popover, #fff)', border: '1px solid var(--border, #e5e7eb)', borderRadius: 8, fontSize: 13 }}
                    formatter={(value: number) => [`Rs ${value.toFixed(2)}`, 'Unit Price']}
                    labelFormatter={(label) => `Date: ${label}`}
                  />
                  <Line type="monotone" dataKey="unit_price" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[250px] flex items-center justify-center text-gray-400">
                No price data available for this item
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Two ranked-list views over the same 30-day window, side by side:
          how often an item gets bought (frequency) vs. how much it actually
          costs (spend) - a cheap staple and an expensive rarely-bought item
          can each top one list without topping the other. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Procurement Frequency Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Procurement Frequency (30 Days)</CardTitle>
            <p className="text-sm text-gray-500">Items ranked by number of intake entries</p>
          </CardHeader>
          <CardContent>
            {data.procurement_frequency.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={data.procurement_frequency} layout="vertical" margin={{ left: 80 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border, #e5e7eb)" />
                  <XAxis type="number" tick={{ fontSize: 11 }} stroke="var(--muted-foreground, #9ca3af)" />
                  <YAxis dataKey="item_name" type="category" tick={{ fontSize: 11 }} width={75} stroke="var(--muted-foreground, #9ca3af)" />
                  <RechartsTooltip
                    contentStyle={{ background: 'var(--popover, #fff)', border: '1px solid var(--border, #e5e7eb)', borderRadius: 8, fontSize: 13 }}
                    formatter={(value: number) => [`${value} times`, 'Procured']}
                  />
                  <Bar dataKey="intake_count" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[250px] flex items-center justify-center text-gray-400">
                No procurement data in the last 30 days
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top Costing Products Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Top Costing Products (30 Days)</CardTitle>
            <p className="text-sm text-gray-500">Items ranked by total spend</p>
          </CardHeader>
          <CardContent>
            {data.top_costing_products.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={data.top_costing_products} layout="vertical" margin={{ left: 80 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border, #e5e7eb)" />
                  <XAxis type="number" tick={{ fontSize: 11 }} stroke="var(--muted-foreground, #9ca3af)"
                    tickFormatter={(v: number) => v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)} />
                  <YAxis dataKey="item_name" type="category" tick={{ fontSize: 11 }} width={75} stroke="var(--muted-foreground, #9ca3af)" />
                  <RechartsTooltip
                    contentStyle={{ background: 'var(--popover, #fff)', border: '1px solid var(--border, #e5e7eb)', borderRadius: 8, fontSize: 13 }}
                    formatter={(value: number) => [formatCurrency(value), 'Spend']}
                  />
                  <Bar dataKey="total_spend" fill="#dc2626" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[250px] flex items-center justify-center text-gray-400">
                No procurement data in the last 30 days
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// TAB 2: Daily Stock Intake
// ═══════════════════════════════════════════════════════════════════

function IntakeTab({ prefillItemId, onPrefillConsumed, autoScan, onAutoScanConsumed }: {
  prefillItemId: number | null; onPrefillConsumed: () => void;
  autoScan: boolean; onAutoScanConsumed: () => void;
}) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedItemId, setSelectedItemId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [totalCost, setTotalCost] = useState('');
  const [saving, setSaving] = useState(false);
  const [lastResult, setLastResult] = useState<{
    item_name: string; quantity: number; unit: string;
    unit_price: number; prev_unit_price: number | null;
    price_diff: number | null; price_diff_pct: number | null;
  } | null>(null);
  const [recentIntakes, setRecentIntakes] = useState<RecentIntake[]>([]);
  const [newItemOpen, setNewItemOpen] = useState(false);
  const [newItemForm, setNewItemForm] = useState({ sku: '', name: '', category_id: 0, unit: '' });
  const [scanOpen, setScanOpen] = useState(false);
  const costRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);

  const fetchItems = useCallback(async () => {
    try {
      const res = await api.get('/inventory/items?page_size=100');
      setItems(res.data.items);
    } catch { /* silent */ }
  }, []);

  const fetchRecent = useCallback(async () => {
    try {
      const res = await api.get('/inventory/stock-intake/recent?limit=10');
      setRecentIntakes(res.data);
    } catch { /* silent */ }
  }, []);

  const fetchCategories = useCallback(async () => {
    try {
      const res = await api.get('/inventory/categories');
      setCategories(res.data);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchItems();
    fetchRecent();
    fetchCategories();
  }, [fetchItems, fetchRecent, fetchCategories]);

  useEffect(() => {
    if (prefillItemId != null) {
      setSelectedItemId(String(prefillItemId));
      onPrefillConsumed();
    }
  }, [prefillItemId, onPrefillConsumed]);

  useEffect(() => { queueMicrotask(() => {
    if (autoScan) {
      setScanOpen(true);
      onAutoScanConsumed();
    }
  }); }, [autoScan, onAutoScanConsumed]);

  const selectedItem = items.find(i => String(i.id) === selectedItemId);
  const qtyNum = parseFloat(quantity);
  const costNum = parseFloat(totalCost);
  const calculatedUnitPrice = qtyNum > 0 && costNum > 0 ? costNum / qtyNum : null;

  const handleSubmit = async () => {
    if (!selectedItemId || !qtyNum || !costNum) {
      toast.error('Select an item, enter quantity, and total cost');
      return;
    }
    setSaving(true);
    try {
      const res = await api.post('/inventory/stock-intake', {
        item_id: Number(selectedItemId),
        quantity: qtyNum,
        total_cost: costNum,
      });
      toast.success(`Logged ${res.data.quantity} ${res.data.unit} of ${res.data.item_name}`);
      setLastResult(res.data);
      setQuantity('');
      setTotalCost('');
      setSelectedItemId('');
      fetchItems();
      fetchRecent();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to log stock'));
    } finally {
      setSaving(false);
    }
  };

  const handleCreateItem = async () => {
    if (!newItemForm.name.trim() || !newItemForm.sku.trim() || !newItemForm.unit.trim() || !newItemForm.category_id) {
      toast.error('All fields are required');
      return;
    }
    try {
      const res = await api.post('/inventory/items', newItemForm);
      toast.success('Item created');
      setNewItemOpen(false);
      setNewItemForm({ sku: '', name: '', category_id: 0, unit: '' });
      await fetchItems();
      setSelectedItemId(String(res.data.id));
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to create item'));
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Input Form */}
      <div className="lg:col-span-2">
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <CardTitle className="text-lg">Record Incoming Stock</CardTitle>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Log daily inventory purchases to update stock counts and track pricing.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setScanOpen(true)}>
                <Camera size={15} className="mr-1.5" /> Scan Receipt
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Step 1: Select Item */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">1. Select Stock Item</Label>
              <Select value={selectedItemId} onValueChange={setSelectedItemId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select item... (e.g. Tomatoes, Basmati Rice)" />
                </SelectTrigger>
                <SelectContent>
                  {items.map(item => (
                    <SelectItem key={item.id} value={String(item.id)}>
                      {item.name} ({item.unit}) — Stock: {item.total_stock}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <button
                type="button"
                className="text-sm text-blue-600 hover:underline"
                onClick={() => setNewItemOpen(true)}
              >
                + Create New Ingredient Profile
              </button>
            </div>

            {/* Step 2 & 3: Quantity and Cost */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium">2. Quantity Bought</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    placeholder="e.g. 25.50"
                    value={quantity}
                    onChange={e => setQuantity(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') costRef.current?.focus(); }}
                    min={0}
                    step="any"
                  />
                  <span className="text-sm text-gray-500 whitespace-nowrap min-w-[40px]">
                    {selectedItem?.unit || 'unit'}
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">3. Total Cost Paid</Label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500">Rs</span>
                  <Input
                    ref={costRef}
                    type="number"
                    placeholder="e.g. 3,570"
                    value={totalCost}
                    onChange={e => setTotalCost(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') submitRef.current?.focus(); }}
                    min={0}
                    step="any"
                  />
                </div>
              </div>
            </div>

            {/* Dynamic Pricing Insight */}
            {calculatedUnitPrice !== null && (
              <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 p-4 space-y-1">
                <p className="text-sm font-medium text-blue-800 dark:text-blue-300">
                  Calculated Unit Price: Rs {calculatedUnitPrice.toFixed(2)} / {selectedItem?.unit || 'unit'}
                </p>
                {selectedItem?.last_unit_cost != null && (
                  <p className="text-sm text-blue-600 dark:text-blue-400">
                    {(() => {
                      const diff = calculatedUnitPrice - selectedItem.last_unit_cost;
                      const icon = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
                      const color = diff > 0 ? 'text-red-600' : diff < 0 ? 'text-green-600' : '';
                      return (
                        <span className={color}>
                          Trend: {icon} Rs {Math.abs(diff).toFixed(2)} / {selectedItem.unit} {diff > 0 ? 'higher' : diff < 0 ? 'lower' : 'same'} than previous purchase
                        </span>
                      );
                    })()}
                  </p>
                )}
              </div>
            )}

            {/* Last result feedback */}
            {lastResult && (
              <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 p-3 text-sm">
                <p className="font-medium text-green-800 dark:text-green-300">
                  Logged: {lastResult.quantity} {lastResult.unit} of {lastResult.item_name} @ Rs {lastResult.unit_price.toFixed(2)}/{lastResult.unit}
                </p>
                {lastResult.price_diff != null && (
                  <p className={`mt-1 ${lastResult.price_diff > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    Price change: {lastResult.price_diff > 0 ? '+' : ''}Rs {lastResult.price_diff.toFixed(2)} ({lastResult.price_diff_pct}%)
                  </p>
                )}
              </div>
            )}

            <Button
              ref={submitRef}
              onClick={handleSubmit}
              disabled={saving || !selectedItemId || !quantity || !totalCost}
              className="w-full sm:w-auto"
              size="lg"
            >
              <Plus size={18} className="mr-2" />
              {saving ? 'Saving...' : 'Log & Save Stock'}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Recent Intakes Sidebar */}
      <div>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">Recent Intakes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-3">
            {recentIntakes.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-4">No recent intakes</p>
            )}
            {recentIntakes.map(r => (
              <div key={r.id} className="flex items-center justify-between text-sm border-b border-gray-100 dark:border-gray-800 pb-2 last:border-0">
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">{r.item_name}</p>
                  <p className="text-xs text-gray-500">
                    {r.quantity} {r.unit} @ Rs {r.unit_cost.toFixed(2)}/{r.unit}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-medium">{formatCurrency(r.total_cost)}</p>
                  <p className="text-xs text-gray-400">{r.received_date}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* New Item Dialog */}
      <Dialog open={newItemOpen} onOpenChange={setNewItemOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Ingredient Profile</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  placeholder="e.g. Basmati Rice"
                  value={newItemForm.name}
                  onChange={e => setNewItemForm({ ...newItemForm, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>SKU</Label>
                <Input
                  placeholder="e.g. RICE-001"
                  value={newItemForm.sku}
                  onChange={e => setNewItemForm({ ...newItemForm, sku: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select
                  value={newItemForm.category_id ? String(newItemForm.category_id) : ''}
                  onValueChange={v => setNewItemForm({ ...newItemForm, category_id: Number(v) })}
                >
                  <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent>
                    {categories.map(c => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Unit</Label>
                <Select
                  value={newItemForm.unit || ''}
                  onValueChange={v => setNewItemForm({ ...newItemForm, unit: v })}
                >
                  <SelectTrigger><SelectValue placeholder="Select unit" /></SelectTrigger>
                  <SelectContent>
                    {['kg', 'gram', 'liter', 'ml', 'pcs', 'tray', 'dozen', 'pack', 'bottle', 'can', 'bag', 'box', 'bundle'].map(u => (
                      <SelectItem key={u} value={u}>{u}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button onClick={handleCreateItem} className="w-full">Create Item</Button>
          </div>
        </DialogContent>
      </Dialog>

      <ReceiptScanDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        items={items}
        onConfirmed={() => { fetchItems(); fetchRecent(); }}
        onItemsChanged={fetchItems}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// TAB 3: Current Stock (Inventory Ledger)
// ═══════════════════════════════════════════════════════════════════

function StockTab({ onLogIntake }: { onLogIntake: (itemId: number) => void }) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'low'>('all');
  const [loading, setLoading] = useState(true);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/inventory/items?search=${encodeURIComponent(search)}&page_size=100`);
      setItems(res.data.items);
    } catch {
      toast.error('Failed to load inventory');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const filteredItems = filter === 'low'
    ? items.filter(i => i.reorder_level > 0 && i.total_stock <= i.reorder_level)
    : items;

  // Pin low-stock items to the top
  const sortedItems = [...filteredItems].sort((a, b) => {
    const aLow = a.reorder_level > 0 && a.total_stock <= a.reorder_level;
    const bLow = b.reorder_level > 0 && b.total_stock <= b.reorder_level;
    if (aLow && !bLow) return -1;
    if (!aLow && bLow) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <Input
            placeholder="Search ingredient or SKU..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex gap-2">
          <Button
            variant={filter === 'all' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter('all')}
          >
            All Stock
          </Button>
          <Button
            variant={filter === 'low' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter('low')}
          >
            <AlertTriangle size={14} className="mr-1" />
            Low Only
          </Button>
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item Name</TableHead>
                  <TableHead>Current Quantity</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Last Unit Price</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-28">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-gray-500">Loading inventory...</TableCell>
                  </TableRow>
                )}
                {!loading && sortedItems.map(item => {
                  const isLow = item.reorder_level > 0 && item.total_stock <= item.reorder_level;
                  return (
                    <TableRow key={item.id} className={isLow ? 'bg-amber-50 dark:bg-amber-950/20' : ''}>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell className="font-semibold">{item.total_stock}</TableCell>
                      <TableCell className="text-gray-500">{item.unit}</TableCell>
                      <TableCell>
                        {item.last_unit_cost != null
                          ? `Rs ${item.last_unit_cost.toFixed(2)} / ${item.unit}`
                          : <span className="text-gray-400">—</span>
                        }
                      </TableCell>
                      <TableCell>
                        {isLow ? (
                          <Badge variant="destructive" className="gap-1">
                            <AlertTriangle size={12} /> Low Stock
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-green-600 border-green-300">Normal</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-blue-600 hover:text-blue-700"
                          onClick={() => onLogIntake(item.id)}
                        >
                          Log Intake <ArrowRight size={14} className="ml-1" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {!loading && sortedItems.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-gray-500">
                      {filter === 'low' ? 'No low stock items' : 'No inventory items found'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
