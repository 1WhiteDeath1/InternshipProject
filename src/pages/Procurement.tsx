import { useEffect, useState } from 'react';
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

export default function Procurement() {
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItemOption[]>([]);
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

  useEffect(() => {
    queueMicrotask(() => {
      setLoading(true);
      Promise.all([fetchPOs(), fetchVendors(), fetchInventoryItems(), fetchMatches()]).finally(() => setLoading(false));
    });
  }, []);

  const addLineItem = () => setPoForm({ ...poForm, items: [...poForm.items, { ...emptyLineItem }] });
  const removeLineItem = (index: number) => setPoForm({ ...poForm, items: poForm.items.filter((_, i) => i !== index) });
  const updateLineItem = (index: number, field: keyof POLineItem, value: number) => {
    const items = [...poForm.items];
    items[index] = { ...items[index], [field]: value };
    setPoForm({ ...poForm, items });
  };
  const poTotal = poForm.items.reduce((sum, i) => sum + i.quantity_ordered * i.unit_price, 0);

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
                    {poForm.items.map((line, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <select
                          className="flex-1 h-10 rounded-md border border-input bg-background px-3 text-sm"
                          value={line.item_id}
                          onChange={e => updateLineItem(i, 'item_id', Number(e.target.value))}
                        >
                          <option value="0">Select item</option>
                          {inventoryItems.map(item => <option key={item.id} value={item.id}>{item.name} ({item.sku})</option>)}
                        </select>
                        <Input
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
                    ))}
                  </div>
                  <p className="text-right text-sm font-semibold mt-2">Total: ${poTotal.toFixed(2)}</p>
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
                      <TableCell>${po.total_amount?.toFixed(2)}</TableCell>
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
