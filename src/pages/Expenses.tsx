import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Banknote, Plus, Trash2, FileText, Image as ImageIcon } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';

interface Expense {
  id: number; name: string; category: string; amount: number;
  expense_date: string; bill_reference_no: string | null; notes: string | null;
  attachment_path: string | null; attachment_filename: string | null;
  created_by_name: string | null; created_at: string;
}
interface CategorySummary { category: string; total: number; count: number; }

const PRESET_CATEGORIES = ['Gas', 'Electricity', 'Repairs', 'Water', 'Cleaning Supplies', 'Transport', 'Miscellaneous'];
const CUSTOM = '__custom__';
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const ALLOWED_ATTACHMENT_TYPES = ['image/png', 'image/jpeg', 'application/pdf'];
const todayISO = () => new Date().toISOString().slice(0, 10);
const firstOfMonth = () => `${todayISO().slice(0, 7)}-01`;

const emptyForm = () => ({ name: '', category: PRESET_CATEGORIES[0], customCategory: '', amount: '', expense_date: todayISO(), billReferenceNo: '', notes: '' });

export default function Expenses() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [summary, setSummary] = useState<CategorySummary[]>([]);
  const [dateFrom, setDateFrom] = useState(firstOfMonth());
  const [dateTo, setDateTo] = useState(todayISO());
  const [categoryFilter, setCategoryFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchExpenses = async () => {
    try {
      const res = await api.get(`/expenses?date_from=${dateFrom}&date_to=${dateTo}&category=${categoryFilter}&page_size=100`);
      setExpenses(res.data.items);
    } catch { toast.error('Failed to load expenses'); }
  };

  const fetchSummary = async () => {
    try {
      const res = await api.get(`/expenses/summary?date_from=${dateFrom}&date_to=${dateTo}`);
      setSummary(res.data.items);
    } catch { toast.error('Failed to load expense summary'); }
  };

  useEffect(() => {
    queueMicrotask(() => {
      setLoading(true);
      Promise.all([fetchExpenses(), fetchSummary()]).finally(() => setLoading(false));
    });
  }, [dateFrom, dateTo, categoryFilter]);

  const handleAttachmentChange = (file: File | null) => {
    if (file && !ALLOWED_ATTACHMENT_TYPES.includes(file.type)) { toast.error('Only PNG, JPG, or PDF files are allowed'); return; }
    if (file && file.size > MAX_ATTACHMENT_BYTES) { toast.error('File is too large - the limit is 5MB'); return; }
    setAttachmentFile(file);
  };

  const handleSave = async () => {
    const category = form.category === CUSTOM ? form.customCategory.trim() : form.category;
    const amount = Number(form.amount);
    if (!form.name.trim()) { toast.error('Enter an expense name'); return; }
    if (!category) { toast.error('Enter a category'); return; }
    if (!amount || amount <= 0) { toast.error('Enter a valid amount'); return; }
    setSaving(true);
    try {
      const res = await api.post('/expenses', {
        name: form.name.trim(), category, amount, expense_date: form.expense_date,
        bill_reference_no: form.billReferenceNo.trim() || null, notes: form.notes || null,
      });
      if (attachmentFile) {
        const fd = new FormData();
        fd.append('file', attachmentFile);
        // Clears api's instance default (Content-Type: application/json) so
        // the browser sets multipart/form-data with the correct boundary -
        // see ReceiptScanDialog.tsx for the same pattern.
        await api.post(`/expenses/${res.data.id}/attachment`, fd, { headers: { 'Content-Type': undefined } });
      }
      toast.success(`${form.name} — ${formatCurrency(amount)} logged`);
      setDialogOpen(false);
      setForm(emptyForm());
      setAttachmentFile(null);
      fetchExpenses();
      fetchSummary();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to log expense')); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: number) => {
    const reason = window.prompt('Reason for removing this expense entry:');
    if (!reason || !reason.trim()) return;
    try {
      await api.delete(`/expenses/${id}?reason=${encodeURIComponent(reason.trim())}`);
      toast.success('Expense removed');
      fetchExpenses();
      fetchSummary();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to remove expense')); }
  };

  const grandTotal = summary.reduce((s, c) => s + c.total, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><Banknote size={24} /> Hotel Expenses</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild><Button onClick={() => setForm(emptyForm())}><Plus size={16} className="mr-1" /> Log Expense</Button></DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Log Operational Expense</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Expense Name</Label><Input placeholder="e.g. Diesel refill, Plumber - Room 12" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Category</Label>
                  <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                    {PRESET_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    <option value={CUSTOM}>Custom…</option>
                  </select>
                </div>
                <div><Label>Amount (Rs)</Label><Input type="number" min={1} value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value.replace(/^0+(?=\d)/, '') })} /></div>
              </div>
              {form.category === CUSTOM && (
                <div><Label>Custom Category</Label><Input value={form.customCategory} onChange={e => setForm({ ...form, customCategory: e.target.value })} /></div>
              )}
              <div><Label>Date</Label><Input type="date" max={todayISO()} value={form.expense_date} onChange={e => setForm({ ...form, expense_date: e.target.value })} /></div>
              <div><Label>Utility Bill Reference / Invoice # (optional)</Label><Input placeholder="e.g. account/invoice number on the bill" value={form.billReferenceNo} onChange={e => setForm({ ...form, billReferenceNo: e.target.value })} /></div>
              <div><Label>Notes (optional)</Label><Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
              <div>
                <Label>Bill Scan / Screenshot (optional, PNG/JPG/PDF, max 5MB)</Label>
                <Input type="file" accept="image/png,image/jpeg,application/pdf" onChange={e => handleAttachmentChange(e.target.files?.[0] || null)} />
                {attachmentFile && <p className="text-xs text-muted-foreground mt-1">{attachmentFile.name} ({(attachmentFile.size / 1024).toFixed(0)} KB)</p>}
              </div>
              <Button onClick={handleSave} disabled={saving} className="w-full">{saving ? 'Saving…' : 'Log Expense'}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
        <span className="text-muted-foreground text-sm">to</span>
        <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-40" />
        <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
          <option value="">All Categories</option>
          {Array.from(new Set([...PRESET_CATEGORIES, ...summary.map(s => s.category)])).map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total for period</p><p className="text-xl font-bold">{formatCurrency(grandTotal)}</p></CardContent></Card>
        {summary.slice(0, 3).map(s => (
          <Card key={s.category}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{s.category}</p><p className="text-xl font-bold">{formatCurrency(s.total)}</p></CardContent></Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Name</TableHead><TableHead>Category</TableHead><TableHead>Bill Ref #</TableHead><TableHead>Attachment</TableHead><TableHead>Logged By</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="w-16">Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>}
              {!loading && expenses.map(e => (
                <TableRow key={e.id}>
                  <TableCell>{e.expense_date}</TableCell>
                  <TableCell className="font-medium">{e.name}{e.notes && <span className="block text-xs text-muted-foreground">{e.notes}</span>}</TableCell>
                  <TableCell>{e.category}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{e.bill_reference_no || '—'}</TableCell>
                  <TableCell>
                    {e.attachment_path ? (
                      <a href={e.attachment_path} target="_blank" rel="noreferrer" title={e.attachment_filename || 'View attachment'}
                        className="inline-flex items-center gap-1 text-blue-600 hover:underline text-xs">
                        {e.attachment_filename?.toLowerCase().endsWith('.pdf') ? <FileText size={14} /> : <ImageIcon size={14} />} View
                      </a>
                    ) : <span className="text-muted-foreground text-xs">—</span>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{e.created_by_name || '-'}</TableCell>
                  <TableCell className="text-right font-mono">{formatCurrency(e.amount)}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => handleDelete(e.id)}><Trash2 size={16} className="text-red-500" /></Button>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && expenses.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No expenses logged for this period</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
