import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from '@/components/ui/tabs';
import { toast } from 'sonner';
import {
  Search, Plus, Trash2, AlertTriangle
} from 'lucide-react';
import { formatCurrency } from '@/lib/currency';

interface InventoryItem {
  id: number;
  sku: string;
  name: string;
  category_name: string;
  unit: string;
  ingredient_type: string | null;
  reorder_level: number;
  total_stock: number;
  is_active: boolean;
  last_unit_cost: number | null;
}

interface StockBatch {
  id: number;
  batch_number: string;
  item_name: string;
  quantity: number;
  bin_location: string;
  expiry_date: string;
}

export default function Inventory() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [batches, setBatches] = useState<StockBatch[]>([]);
  const [search, setSearch] = useState('');
  const [lowStock, setLowStock] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ sku: '', name: '', category_id: 1, unit: 'pcs', ingredient_type: '', reorder_level: 0, reorder_quantity: 0 });
  const [categories, setCategories] = useState<{id: number; name: string}[]>([]);
  const [expirySoonThreshold, setExpirySoonThreshold] = useState(0);

  useEffect(() => { queueMicrotask(() => setExpirySoonThreshold(Date.now() + 7 * 86400000)); }, []);

  const fetchItems = async () => {
    try {
      const res = await api.get(`/inventory/items?search=${search}&low_stock=${lowStock}`);
      setItems(res.data.items);
    } catch { toast.error('Failed to load inventory'); }
  };

  const fetchBatches = async () => {
    try {
      const res = await api.get('/inventory/batches');
      setBatches(res.data);
    } catch { toast.error('Failed to load stock batches'); }
  };

  const fetchCategories = async () => {
    try {
      const res = await api.get('/inventory/categories');
      setCategories(res.data);
    } catch { toast.error('Failed to load categories'); }
  };

  useEffect(() => {
    queueMicrotask(() => {
      setLoading(true);
      Promise.all([fetchItems(), fetchBatches(), fetchCategories()]).finally(() => setLoading(false));
    });
  }, [search, lowStock]);

  const handleCreate = async () => {
    try {
      await api.post('/inventory/items', { ...form, ingredient_type: form.ingredient_type || null });
      toast.success('Item created');
      setDialogOpen(false);
      fetchItems();
      setForm({ sku: '', name: '', category_id: 1, unit: 'pcs', ingredient_type: '', reorder_level: 0, reorder_quantity: 0 });
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to create item'));
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Deactivate this item?')) return;
    try {
      await api.delete(`/inventory/items/${id}`);
      toast.success('Item deactivated');
      fetchItems();
    } catch { toast.error('Failed to deactivate'); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Inventory Management</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button><Plus size={18} className="mr-2" /> Add Item</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Add Inventory Item</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>SKU</Label><Input value={form.sku} onChange={e => setForm({...form, sku: e.target.value})} /></div>
                <div className="space-y-2"><Label>Name</Label><Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Category</Label>
                  <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.category_id} onChange={e => setForm({...form, category_id: Number(e.target.value)})}>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="space-y-2"><Label>Unit</Label><Input value={form.unit} onChange={e => setForm({...form, unit: e.target.value})} /></div>
              </div>
              <div className="space-y-2">
                <Label>Ingredient Type (optional, for recipe unit conversion)</Label>
                <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.ingredient_type} onChange={e => setForm({...form, ingredient_type: e.target.value})}>
                  <option value="">Not applicable (non-food item / count-based)</option>
                  <option value="liquid">Liquid</option>
                  <option value="powder">Powder</option>
                  <option value="granular">Granular</option>
                  <option value="solid_pieces">Solid Pieces</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Reorder Level</Label><Input type="number" value={form.reorder_level} onChange={e => setForm({...form, reorder_level: Number(e.target.value)})} /></div>
                <div className="space-y-2"><Label>Reorder Qty</Label><Input type="number" value={form.reorder_quantity} onChange={e => setForm({...form, reorder_quantity: Number(e.target.value)})} /></div>
              </div>
              <Button onClick={handleCreate} className="w-full">Create Item</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="items">
        <TabsList className="grid w-full grid-cols-3 max-w-md">
          <TabsTrigger value="items">Items</TabsTrigger>
          <TabsTrigger value="batches">Batches</TabsTrigger>
          <TabsTrigger value="low-stock">Low Stock</TabsTrigger>
        </TabsList>

        <TabsContent value="items" className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <Input placeholder="Search items..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer select-none">
              <input type="checkbox" checked={lowStock} onChange={e => setLowStock(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
              Low stock only
            </label>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Total Stock</TableHead>
                    <TableHead>Last Price</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-16"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && <TableRow><TableCell colSpan={7} className="text-center py-8 text-gray-500">Loading inventory...</TableCell></TableRow>}
                  {!loading && items.map(item => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.sku}</TableCell>
                      <TableCell>{item.name}</TableCell>
                      <TableCell>{item.category_name}</TableCell>
                      <TableCell className="font-semibold">{item.total_stock} {item.unit}</TableCell>
                      <TableCell className="text-gray-500">{item.last_unit_cost != null ? formatCurrency(item.last_unit_cost) : '—'}</TableCell>
                      <TableCell>
                        {item.total_stock <= item.reorder_level && item.reorder_level > 0 ? (
                          <Badge variant="destructive" className="gap-1"><AlertTriangle size={12} /> Low</Badge>
                        ) : (
                          <Badge variant="outline" className="text-green-600 border-green-300">OK</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={() => handleDelete(item.id)}><Trash2 size={16} className="text-red-500" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!loading && items.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-gray-500">No inventory items found</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="batches">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Batch</TableHead><TableHead>Item</TableHead><TableHead>Quantity</TableHead><TableHead>Location</TableHead><TableHead>Expiry</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {batches.map(b => (
                    <TableRow key={b.id}>
                      <TableCell>{b.batch_number}</TableCell>
                      <TableCell>{b.item_name}</TableCell>
                      <TableCell className="font-semibold">{b.quantity}</TableCell>
                      <TableCell>{b.bin_location || '-'}</TableCell>
                      <TableCell className={b.expiry_date && expirySoonThreshold && new Date(b.expiry_date).getTime() < expirySoonThreshold ? 'text-red-500 font-medium' : ''}>
                        {b.expiry_date || '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                  {batches.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center py-8 text-gray-500">No stock batches</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="low-stock">
          <Card>
            <CardHeader><CardTitle className="text-red-600 flex items-center gap-2"><AlertTriangle size={20} /> Low Stock Alerts</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow><TableHead>SKU</TableHead><TableHead>Name</TableHead><TableHead>Stock</TableHead><TableHead>Reorder Level</TableHead><TableHead>Shortfall</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {items.filter(i => i.total_stock <= i.reorder_level && i.reorder_level > 0).map(item => (
                    <TableRow key={item.id} className="bg-red-50 dark:bg-red-950/20">
                      <TableCell className="font-medium">{item.sku}</TableCell>
                      <TableCell>{item.name}</TableCell>
                      <TableCell className="font-bold text-red-600">{item.total_stock}</TableCell>
                      <TableCell>{item.reorder_level}</TableCell>
                      <TableCell className="text-red-600">{item.reorder_level - item.total_stock}</TableCell>
                    </TableRow>
                  ))}
                  {items.filter(i => i.total_stock <= i.reorder_level && i.reorder_level > 0).length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center py-8 text-gray-500">No low stock items</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
