import { useEffect, useRef, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Search, Plus, CheckCircle, Star, Trash2, Truck, PackageCheck } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';

interface PurchaseOrder {
  id: number;
  po_number: string;
  vendor_name: string;
  status: string;
  total_amount: number;
  expected_delivery: string;
  items: { id: number; item_name: string; quantity_ordered: number; quantity_delivered: number; quantity_received: number; unit_price: number }[];
}

interface Vendor {
  id: number;
  name: string;
  contact_person: string;
  phone: string;
  delivery_accuracy: number;
  is_active: boolean;
}

interface InventoryItemOption {
  id: number;
  name: string;
  sku: string;
  last_unit_cost: number | null;
  last_vendor_id: number | null;
  last_vendor_name: string | null;
  last_purchased_at: string | null;
}

interface Category {
  id: number;
  name: string;
}

interface ThreeWayMatch {
  id: number;
  po_id: number;
  po_quantity: number;
  delivery_quantity: number;
  received_quantity: number;
  variance: number;
  is_matched: boolean;
  created_at: string;
}

interface POLineItem {
  item_id: number;
  quantity_ordered: number;
  unit_price: number;
}

const emptyLineItem: POLineItem = { item_id: 0, quantity_ordered: 1, unit_price: 0 };
const emptyNewItemForm = { sku: '', name: '', category_id: 0, unit: '' };

export default function Procurement() {
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItemOption[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [matches, setMatches] = useState<ThreeWayMatch[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [vendorDialogOpen, setVendorDialogOpen] = useState(false);
  const [poForm, setPoForm] = useState({ vendor_id: 0, expected_delivery: '', notes: '', items: [{ ...emptyLineItem }] as POLineItem[] });
  const [vendorForm, setVendorForm] = useState({ name: '', contact_person: '', phone: '', email: '', address: '', payment_terms: '' });
  const [receiveDialogPO, setReceiveDialogPO] = useState<PurchaseOrder | null>(null);
  const [confirmDialogPO, setConfirmDialogPO] = useState<PurchaseOrder | null>(null);
  const [qtyByItem, setQtyByItem] = useState<Record<number, number>>({});
  const quantityRefs = useRef<(HTMLInputElement | null)[]>([]);
  // Inline "+ New Item" - which line item row (if any) is showing the quick
  // create-item form instead of its normal item/qty/price inputs.
  const [creatingItemForIndex, setCreatingItemForIndex] = useState<number | null>(null);
  const [newItemForm, setNewItemForm] = useState(emptyNewItemForm);

  const fetchPOs = async () => {
    try {
      const res = await api.get('/procurement/purchase-orders');
      setPos(res.data.items);
    } catch { toast.error('Failed to load POs'); }
  };

  const fetchVendors = async () => {
    try {
      const res = await api.get('/procurement/vendors');
      setVendors(res.data.items);
    } catch { toast.error('Failed to load vendors'); }
  };

  const fetchInventoryItems = async () => {
    try {
      const res = await api.get('/inventory/items?page_size=100');
      setInventoryItems(res.data.items);
    } catch { toast.error('Failed to load inventory items'); }
  };

  const fetchMatches = async () => {
    try {
      const res = await api.get('/procurement/three-way-matches');
      setMatches(res.data.items);
    } catch { toast.error('Failed to load three-way match data'); }
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
      Promise.all([fetchPOs(), fetchVendors(), fetchInventoryItems(), fetchMatches(), fetchCategories()]).finally(() => setLoading(false));
    });
  }, []);

  const addLineItem = () => setPoForm({ ...poForm, items: [...poForm.items, { ...emptyLineItem }] });
  const removeLineItem = (index: number) => setPoForm({ ...poForm, items: poForm.items.filter((_, i) => i !== index) });
  const updateLineItem = (index: number, field: keyof POLineItem, value: number) => {
    const items = [...poForm.items];
    items[index] = { ...items[index], [field]: value };
    setPoForm({ ...poForm, items });
  };
  // Price Memory: selecting an item pre-fills last-known unit price and jumps
  // focus to Quantity with its value selected, so a keystroke overwrites the
  // default instantly instead of requiring a backspace first.
  const selectLineItem = (index: number, itemId: number) => {
    const picked = inventoryItems.find(it => it.id === itemId);
    const items = [...poForm.items];
    items[index] = {
      ...items[index], item_id: itemId,
      // Always reflect the newly selected item's own history, even resetting
      // to 0 when it has none - carrying forward a different item's stale
      // price across a swap would be actively misleading, not "manual".
      unit_price: picked?.last_unit_cost ?? 0,
    };
    setPoForm({ ...poForm, items });
    // Focus/select the Quantity field, re-asserted a beat later: right after
    // creating a new item inline, the row is still the create-item Card in
    // this tick (quantityRefs[index] is stale until it swaps back to the
    // normal row), AND Radix Dialog's FocusScope reclaims focus onto the
    // dialog container once the previously-focused "Create & Use" button is
    // removed from the DOM by that swap - a single deferred call (rAF, or
    // rAF+0ms timeout) consistently loses that race. Re-asserting again
    // ~150ms later - comfortably after Radix's own reclaim has already
    // fired - is what actually wins, for both the plain-select and the
    // inline-create-then-select paths.
    const focusQty = () => {
      const el = quantityRefs.current[index];
      el?.focus();
      el?.select();
    };
    requestAnimationFrame(focusQty);
    setTimeout(focusQty, 150);
  };
  const poTotal = poForm.items.reduce((sum, i) => sum + i.quantity_ordered * i.unit_price, 0);

  // Redundancy fix: without this, ordering an item that's never been bought
  // before meant abandoning the PO dialog, creating it on the separate
  // Inventory page, then coming back and starting the PO over. Mirrors the
  // "+ Create new recipe" inline pattern already used in Kitchen's a la
  // carte dialog - same idea, applied here.
  const openNewItemForm = (index: number) => {
    setCreatingItemForIndex(index);
    setNewItemForm(emptyNewItemForm);
  };

  const cancelNewItemForm = () => setCreatingItemForIndex(null);

  const handleCreateItemInline = async (index: number) => {
    if (!newItemForm.name.trim() || !newItemForm.sku.trim() || !newItemForm.unit.trim() || !newItemForm.category_id) {
      toast.error('Name, SKU, category, and unit are required');
      return;
    }
    try {
      const res = await api.post('/inventory/items', newItemForm);
      toast.success('Item created');
      await fetchInventoryItems();
      setCreatingItemForIndex(null);
      // Brand new item has no purchase history, so this correctly leaves
      // unit_price at 0 (same fallback selectLineItem already uses for any
      // item with no last_unit_cost) while still focusing Quantity.
      selectLineItem(index, res.data.id);
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to create item')); }
  };

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      draft: 'bg-gray-100 text-gray-800', approved: 'bg-blue-100 text-blue-800', sent: 'bg-purple-100 text-purple-800',
      delivery_expected: 'bg-amber-100 text-amber-800', received: 'bg-green-100 text-green-800', cancelled: 'bg-red-100 text-red-800',
    };
    return <Badge className={map[status] || ''}>{status.replace('_', ' ')}</Badge>;
  };

  const handleCreatePO = async () => {
    if (!poForm.vendor_id) {
      toast.error('Select a vendor');
      return;
    }
    const validItems = poForm.items.filter(i => i.item_id > 0 && i.quantity_ordered > 0 && i.unit_price > 0);
    if (validItems.length === 0) {
      toast.error('Add at least one line item with an item, quantity, and unit price');
      return;
    }
    try {
      await api.post('/procurement/purchase-orders', { ...poForm, items: validItems });
      toast.success('Purchase order created');
      setDialogOpen(false);
      setPoForm({ vendor_id: 0, expected_delivery: '', notes: '', items: [{ ...emptyLineItem }] });
      fetchPOs();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to create PO')); }
  };

  const handleCreateVendor = async () => {
    try {
      await api.post('/procurement/vendors', vendorForm);
      toast.success('Vendor created');
      setVendorDialogOpen(false);
      fetchVendors();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed')); }
  };

  const handleApprove = async (id: number) => {
    try { await api.post(`/procurement/purchase-orders/${id}/approve`); toast.success('PO approved'); fetchPOs(); }
    catch { toast.error('Failed'); }
  };

  const openReceiveDialog = (po: PurchaseOrder) => {
    setReceiveDialogPO(po);
    // Smart default: exact delivery is the common case, clerk only adjusts on a shortfall/overage.
    setQtyByItem(Object.fromEntries(po.items.map(i => [i.id, i.quantity_ordered])));
  };

  const openConfirmDialog = (po: PurchaseOrder) => {
    setConfirmDialogPO(po);
    setQtyByItem(Object.fromEntries(po.items.map(i => [i.id, i.quantity_delivered])));
  };

  const handleRecordDelivery = async () => {
    if (!receiveDialogPO) return;
    try {
      await api.post(`/procurement/purchase-orders/${receiveDialogPO.id}/receive`, {
        items: receiveDialogPO.items.map(i => ({ po_item_id: i.id, quantity: qtyByItem[i.id] ?? 0 })),
      });
      toast.success('Delivery recorded');
      setReceiveDialogPO(null);
      fetchPOs();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to record delivery')); }
  };

  const handleConfirmReceipt = async () => {
    if (!confirmDialogPO) return;
    try {
      await api.post(`/procurement/purchase-orders/${confirmDialogPO.id}/confirm-receipt`, {
        items: confirmDialogPO.items.map(i => ({ po_item_id: i.id, quantity: qtyByItem[i.id] ?? 0 })),
      });
      toast.success('Receipt confirmed - stock updated');
      setConfirmDialogPO(null);
      fetchPOs();
      fetchMatches();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to confirm receipt')); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Procurement</h1>
        <div className="flex gap-2">
          <Dialog open={vendorDialogOpen} onOpenChange={setVendorDialogOpen}>
            <DialogTrigger asChild><Button variant="outline"><Plus size={16} className="mr-1" /> Vendor</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add Vendor</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <Input placeholder="Vendor name" value={vendorForm.name} onChange={e => setVendorForm({...vendorForm, name: e.target.value})} />
                <Input placeholder="Contact person" value={vendorForm.contact_person} onChange={e => setVendorForm({...vendorForm, contact_person: e.target.value})} />
                <Input placeholder="Phone" value={vendorForm.phone} onChange={e => setVendorForm({...vendorForm, phone: e.target.value})} />
                <Input placeholder="Email" value={vendorForm.email} onChange={e => setVendorForm({...vendorForm, email: e.target.value})} />
                <Button onClick={handleCreateVendor} className="w-full">Add Vendor</Button>
              </div>
            </DialogContent>
          </Dialog>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild><Button><Plus size={16} className="mr-1" /> Purchase Order</Button></DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader><DialogTitle>Create Purchase Order</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Vendor</Label>
                    <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={poForm.vendor_id} onChange={e => setPoForm({...poForm, vendor_id: Number(e.target.value)})}>
                      <option value="0">Select vendor</option>
                      {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                  </div>
                  <div><Label>Expected Delivery</Label><Input type="date" value={poForm.expected_delivery} onChange={e => setPoForm({...poForm, expected_delivery: e.target.value})} /></div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label>Line Items</Label>
                    <Button size="sm" variant="outline" onClick={addLineItem}><Plus size={14} className="mr-1" /> Add Item</Button>
                  </div>
                  <div className="space-y-2">
                    {poForm.items.map((line, i) => {
                      const picked = inventoryItems.find(it => it.id === line.item_id);
                      if (creatingItemForIndex === i) {
                        return (
                          <Card key={i}>
                            <CardContent className="p-3 space-y-2">
                              <div className="flex items-center justify-between">
                                <Label className="text-xs">New Inventory Item</Label>
                                <Button size="sm" variant="ghost" onClick={cancelNewItemForm}>Cancel</Button>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <Input placeholder="Name" value={newItemForm.name} onChange={e => setNewItemForm({ ...newItemForm, name: e.target.value })} />
                                <Input placeholder="SKU" value={newItemForm.sku} onChange={e => setNewItemForm({ ...newItemForm, sku: e.target.value })} />
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={newItemForm.category_id} onChange={e => setNewItemForm({ ...newItemForm, category_id: Number(e.target.value) })}>
                                  <option value="0">Select category</option>
                                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                                <Input placeholder="Unit (kg, l, pcs...)" value={newItemForm.unit} onChange={e => setNewItemForm({ ...newItemForm, unit: e.target.value })} />
                              </div>
                              <Button size="sm" onClick={() => handleCreateItemInline(i)} className="w-full">Create &amp; Use</Button>
                            </CardContent>
                          </Card>
                        );
                      }
                      return (
                      <div key={i} className="space-y-1">
                        <div className="flex items-center gap-2">
                          <select
                            className="flex-1 h-10 rounded-md border border-input bg-background px-3 text-sm"
                            value={line.item_id}
                            onChange={e => selectLineItem(i, Number(e.target.value))}
                          >
                            <option value="0">Select item</option>
                            {inventoryItems.map(item => <option key={item.id} value={item.id}>{item.name} ({item.sku})</option>)}
                          </select>
                          <Input
                            ref={el => { quantityRefs.current[i] = el; }}
                            type="number" placeholder="Qty" className="w-24" min={0}
                            value={line.quantity_ordered}
                            onChange={e => updateLineItem(i, 'quantity_ordered', Number(e.target.value))}
                          />
                          <Input
                            type="number" placeholder="Unit Price" className="w-28" min={0}
                            value={line.unit_price}
                            onChange={e => updateLineItem(i, 'unit_price', Number(e.target.value))}
                          />
                          <Button size="sm" variant="ghost" onClick={() => removeLineItem(i)} disabled={poForm.items.length === 1}>
                            <Trash2 size={16} className="text-red-500" />
                          </Button>
                        </div>
                        <div className="flex items-center justify-between pl-1">
                          {picked?.last_unit_cost != null ? (
                            <p className="text-xs text-gray-400">
                              Last: {formatCurrency(picked.last_unit_cost)}{picked.last_vendor_name ? ` from ${picked.last_vendor_name}` : ''}{picked.last_purchased_at ? ` (${picked.last_purchased_at})` : ''}
                            </p>
                          ) : <span />}
                          <button type="button" className="text-xs text-blue-600 hover:underline" onClick={() => openNewItemForm(i)}>
                            + New Item
                          </button>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                  <p className="text-right text-sm font-semibold mt-2">Total: {formatCurrency(poTotal)}</p>
                </div>

                <Button onClick={handleCreatePO} className="w-full">Create PO</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Tabs defaultValue="pos">
        <TabsList className="grid w-full grid-cols-3 max-w-md"><TabsTrigger value="pos">Purchase Orders</TabsTrigger><TabsTrigger value="vendors">Vendors</TabsTrigger><TabsTrigger value="matching">3-Way Match</TabsTrigger></TabsList>

        <TabsContent value="pos" className="space-y-4">
          <div className="relative max-w-sm"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} /><Input placeholder="Search POs..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" /></div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>PO Number</TableHead><TableHead>Vendor</TableHead><TableHead>Status</TableHead><TableHead>Total</TableHead><TableHead>Items</TableHead><TableHead className="w-24">Actions</TableHead></TableRow></TableHeader>
                <TableBody>
                  {loading && <TableRow><TableCell colSpan={6} className="text-center py-8 text-gray-500">Loading purchase orders...</TableCell></TableRow>}
                  {!loading && pos.filter(p => p.po_number.includes(search) || p.vendor_name?.includes(search)).map(po => (
                    <TableRow key={po.id}>
                      <TableCell className="font-medium">{po.po_number}</TableCell>
                      <TableCell>{po.vendor_name}</TableCell>
                      <TableCell>{statusBadge(po.status)}</TableCell>
                      <TableCell>{formatCurrency(po.total_amount)}</TableCell>
                      <TableCell>{po.items?.length || 0} items</TableCell>
                      <TableCell>
                        {po.status === 'draft' && (
                          <Button size="sm" variant="ghost" onClick={() => handleApprove(po.id)} title="Approve"><CheckCircle size={16} className="text-green-600" /></Button>
                        )}
                        {po.status === 'approved' && (
                          <Button size="sm" variant="outline" onClick={() => openReceiveDialog(po)}><Truck size={14} className="mr-1" /> Record Delivery</Button>
                        )}
                        {po.status === 'delivery_expected' && (
                          <Button size="sm" variant="outline" onClick={() => openConfirmDialog(po)}><PackageCheck size={14} className="mr-1" /> Confirm Receipt</Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!loading && pos.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-8 text-gray-500">No purchase orders</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="vendors">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Contact</TableHead><TableHead>Phone</TableHead><TableHead>Accuracy</TableHead></TableRow></TableHeader>
                <TableBody>
                  {vendors.map(v => (
                    <TableRow key={v.id}>
                      <TableCell className="font-medium">{v.name}</TableCell>
                      <TableCell>{v.contact_person}</TableCell>
                      <TableCell>{v.phone}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Star size={14} className={v.delivery_accuracy >= 90 ? 'text-green-500' : v.delivery_accuracy >= 70 ? 'text-amber-500' : 'text-red-500'} />
                          {v.delivery_accuracy}%
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {vendors.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-8 text-gray-500">No vendors</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="matching">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>PO ID</TableHead><TableHead>Ordered</TableHead><TableHead>Delivered</TableHead><TableHead>Received</TableHead><TableHead>Variance</TableHead><TableHead>Result</TableHead></TableRow></TableHeader>
                <TableBody>
                  {loading && <TableRow><TableCell colSpan={6} className="text-center py-8 text-gray-500">Loading three-way match data...</TableCell></TableRow>}
                  {!loading && matches.map(m => (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">#{m.po_id}</TableCell>
                      <TableCell>{m.po_quantity}</TableCell>
                      <TableCell>{m.delivery_quantity}</TableCell>
                      <TableCell>{m.received_quantity}</TableCell>
                      <TableCell>{m.variance}</TableCell>
                      <TableCell><Badge className={m.is_matched ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}>{m.is_matched ? 'Matched' : 'Discrepancy'}</Badge></TableCell>
                    </TableRow>
                  ))}
                  {!loading && matches.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-8 text-gray-500">Three-way match data will appear here when POs are received</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!receiveDialogPO} onOpenChange={(open) => { if (!open) setReceiveDialogPO(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Record Delivery - {receiveDialogPO?.po_number}</DialogTitle></DialogHeader>
          {receiveDialogPO && (
            <div className="space-y-3">
              <p className="text-sm text-gray-500">Enter the quantity actually delivered for each item - defaults to what was ordered.</p>
              {receiveDialogPO.items.map(i => (
                <div key={i.id} className="flex items-center justify-between gap-3">
                  <span className="text-sm flex-1">{i.item_name} <span className="text-gray-400">(ordered {i.quantity_ordered})</span></span>
                  <Input type="number" min={0} className="w-28" value={qtyByItem[i.id] ?? 0}
                         onChange={e => setQtyByItem({...qtyByItem, [i.id]: Number(e.target.value)})} />
                </div>
              ))}
              <Button onClick={handleRecordDelivery} className="w-full">Record Delivery</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmDialogPO} onOpenChange={(open) => { if (!open) setConfirmDialogPO(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Confirm Receipt - {confirmDialogPO?.po_number}</DialogTitle></DialogHeader>
          {confirmDialogPO && (
            <div className="space-y-3">
              <p className="text-sm text-gray-500">Enter the quantity actually received (after inspection) - defaults to what was delivered. This creates stock and runs the three-way match.</p>
              {confirmDialogPO.items.map(i => (
                <div key={i.id} className="flex items-center justify-between gap-3">
                  <span className="text-sm flex-1">{i.item_name} <span className="text-gray-400">(delivered {i.quantity_delivered})</span></span>
                  <Input type="number" min={0} className="w-28" value={qtyByItem[i.id] ?? 0}
                         onChange={e => setQtyByItem({...qtyByItem, [i.id]: Number(e.target.value)})} />
                </div>
              ))}
              <Button onClick={handleConfirmReceipt} className="w-full">Confirm Receipt</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
