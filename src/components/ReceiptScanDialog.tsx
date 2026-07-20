import { useEffect, useRef, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Camera, X, Upload, CheckCircle2, HelpCircle, AlertCircle, Loader2 } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';

interface InventoryItemOption {
  id: number;
  name: string;
  unit: string;
}

interface Category {
  id: number;
  name: string;
}

interface StagedLine {
  localId: string;
  source_page: number;
  raw_text: string;
  status: 'matched' | 'unmapped' | 'illegible';
  matched_item_id: number | null;
  matched_item_name: string | null;
  matched_unit: string | null;
  raw_name: string | null;
  quantity: number | null;
  quantity_assumed: boolean;
  total_cost: number | null;
}

const UNIT_OPTIONS = ['kg', 'gram', 'liter', 'ml', 'pcs', 'tray', 'dozen', 'pack', 'bottle', 'can', 'bag', 'box', 'bundle'];
const MAX_PAGES = 10;
const emptyNewItemForm = { sku: '', name: '', category_id: 0, unit: '' };

export function ReceiptScanDialog({
  open, onOpenChange, items, onConfirmed, onItemsChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: InventoryItemOption[];
  onConfirmed: () => void;
  onItemsChanged?: () => void;
}) {
  const [stage, setStage] = useState<'upload' | 'parsing' | 'review'>('upload');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [lines, setLines] = useState<StagedLine[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [localItems, setLocalItems] = useState<InventoryItemOption[]>(items);
  const [categories, setCategories] = useState<Category[]>([]);
  const [creatingItemFor, setCreatingItemFor] = useState<string | null>(null);
  const [newItemForm, setNewItemForm] = useState(emptyNewItemForm);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Snapshot the master item list (and load categories, needed for the
  // inline "create new item" form) fresh every time the dialog opens, then
  // let it evolve locally as items are created mid-review - a parent
  // re-fetch mid-session shouldn't yank a row's freshly-picked selection.
  useEffect(() => {
    if (open) {
      setLocalItems(items);
      api.get('/inventory/categories').then(res => setCategories(res.data)).catch(() => { /* silent */ });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const reset = () => {
    setStage('upload');
    setSelectedFiles([]);
    setBatchId(null);
    setLines([]);
    setCreatingItemFor(null);
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) reset();
    onOpenChange(isOpen);
  };

  const handleFilesSelected = (fileList: FileList | null) => {
    if (!fileList) return;
    const files = Array.from(fileList);
    if (selectedFiles.length + files.length > MAX_PAGES) {
      toast.error(`A single receipt scan is limited to ${MAX_PAGES} photos`);
      return;
    }
    setSelectedFiles(prev => [...prev, ...files]);
  };

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleParse = async () => {
    if (selectedFiles.length === 0) {
      toast.error('Add at least one receipt photo');
      return;
    }
    setStage('parsing');
    try {
      const formData = new FormData();
      selectedFiles.forEach(f => formData.append('files', f));
      // api's instance default is Content-Type: application/json - overriding
      // it to undefined here lets the browser generate the correct
      // multipart/form-data boundary itself. Without this the request goes
      // out as application/json with a raw multipart body, so FastAPI never
      // sees `files` and rejects it with a 422.
      const res = await api.post('/inventory/receipts/parse', formData, {
        headers: { 'Content-Type': undefined },
      });
      const parsedLines: StagedLine[] = res.data.lines.map((l: Omit<StagedLine, 'localId'>, idx: number) => ({
        ...l,
        localId: `${idx}-${Math.random().toString(36).slice(2)}`,
      }));
      setBatchId(res.data.batch_id);
      setLines(parsedLines);
      setStage('review');
      const { matched, unmapped, illegible } = res.data.summary;
      toast.success(`${matched} matched, ${unmapped} need mapping, ${illegible} illegible`);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to parse receipt'));
      setStage('upload');
    }
  };

  const updateLine = (localId: string, patch: Partial<StagedLine>) => {
    setLines(prev => prev.map(l => (l.localId === localId ? { ...l, ...patch } : l)));
  };

  const removeLine = (localId: string) => {
    setLines(prev => prev.filter(l => l.localId !== localId));
  };

  const setMappedItem = (localId: string, itemId: number) => {
    const item = localItems.find(i => i.id === itemId);
    setLines(prev => prev.map(l => (l.localId === localId
      ? { ...l, matched_item_id: itemId, matched_item_name: item?.name ?? null, matched_unit: item?.unit ?? null, status: 'matched' }
      : l)));
  };

  const openNewItemForm = (localId: string) => {
    const line = lines.find(l => l.localId === localId);
    setNewItemForm({ ...emptyNewItemForm, name: line?.raw_name ?? '' });
    setCreatingItemFor(localId);
  };

  const handleCreateItemInline = async (localId: string) => {
    if (!newItemForm.name.trim() || !newItemForm.sku.trim() || !newItemForm.unit.trim() || !newItemForm.category_id) {
      toast.error('Name, SKU, category, and unit are required');
      return;
    }
    try {
      const res = await api.post('/inventory/items', newItemForm);
      const created: InventoryItemOption = { id: res.data.id, name: res.data.name, unit: res.data.unit };
      setLocalItems(prev => [...prev, created]);
      toast.success('Item created');
      setCreatingItemFor(null);
      setMappedItem(localId, created.id);
      onItemsChanged?.();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to create item'));
    }
  };

  const readyLines = lines.filter(l => l.matched_item_id && l.quantity && l.quantity > 0 && l.total_cost && l.total_cost > 0);
  const incompleteCount = lines.length - readyLines.length;

  const handleConfirm = async () => {
    if (readyLines.length === 0) {
      toast.error('No complete rows to save - map an item, quantity, and cost for at least one line');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post('/inventory/receipts/confirm', {
        receipt_batch_id: batchId,
        lines: readyLines.map(l => ({
          item_id: l.matched_item_id,
          quantity: l.quantity,
          total_cost: l.total_cost,
          raw_name: l.raw_name,
        })),
      });
      toast.success(`Stock updated: ${res.data.created.length} item(s), ${formatCurrency(res.data.total_cost)} total`);
      handleClose(false);
      onConfirmed();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to save stock'));
    } finally {
      setSubmitting(false);
    }
  };

  const statusMeta: Record<StagedLine['status'], { label: string; icon: typeof CheckCircle2; className: string; rowClass: string }> = {
    matched: { label: 'Matched', icon: CheckCircle2, className: 'bg-green-100 text-green-800 border-green-300', rowClass: 'border-l-4 border-l-green-500' },
    unmapped: { label: 'Unmapped', icon: HelpCircle, className: 'bg-amber-100 text-amber-800 border-amber-300', rowClass: 'border-l-4 border-l-amber-500 bg-amber-50/50 dark:bg-amber-950/10' },
    illegible: { label: 'Illegible', icon: AlertCircle, className: 'bg-red-100 text-red-800 border-red-300', rowClass: 'border-l-4 border-l-red-500 bg-red-50/50 dark:bg-red-950/10' },
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Smart Intake: Scan Receipt</DialogTitle>
        </DialogHeader>

        {stage === 'upload' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Photograph a long or multi-page receipt in several shots — each photo is parsed and combined into one list below. Headers, footers, and totals are filtered out automatically.
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              capture="environment"
              className="hidden"
              onChange={e => { handleFilesSelected(e.target.files); e.target.value = ''; }}
            />
            <div
              className="border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-8 text-center cursor-pointer hover:border-blue-400 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <Camera className="mx-auto mb-2 text-gray-400" size={32} />
              <p className="text-sm font-medium">Tap to add receipt photo(s)</p>
              <p className="text-xs text-gray-400 mt-1">JPEG, PNG, or WEBP — up to {MAX_PAGES} pages</p>
            </div>

            {selectedFiles.length > 0 && (
              <div className="space-y-2">
                {selectedFiles.map((f, i) => (
                  <div key={i} className="flex items-center justify-between text-sm bg-gray-50 dark:bg-gray-900 rounded px-3 py-2">
                    <span>Page {i + 1}: {f.name}</span>
                    <button onClick={() => removeFile(i)} className="text-gray-400 hover:text-red-500">
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <Button onClick={handleParse} disabled={selectedFiles.length === 0} className="w-full">
              <Upload size={16} className="mr-2" /> Parse Receipt
            </Button>
          </div>
        )}

        {stage === 'parsing' && (
          <div className="py-16 flex flex-col items-center justify-center text-gray-500">
            <Loader2 className="animate-spin mb-3" size={32} />
            <p>Reading receipt text and matching against inventory...</p>
          </div>
        )}

        {stage === 'review' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-sm text-gray-500">
                {lines.filter(l => l.status === 'matched').length} matched, {lines.filter(l => l.status === 'unmapped').length} need mapping, {lines.filter(l => l.status === 'illegible').length} illegible.
                {incompleteCount > 0 && <span className="text-amber-600"> {incompleteCount} row(s) incomplete and won't be saved.</span>}
              </p>
              <Button variant="outline" size="sm" onClick={reset}>Start Over</Button>
            </div>

            <div className="space-y-2">
              {lines.length === 0 && (
                <p className="text-center text-gray-400 py-8">No line items detected. Try a clearer photo.</p>
              )}
              {lines.map(line => {
                const meta = statusMeta[line.status];
                const Icon = meta.icon;
                const isCreatingItem = creatingItemFor === line.localId;
                return (
                  <div key={line.localId} className={`rounded-lg border p-3 ${meta.rowClass}`}>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={meta.className}>
                          <Icon size={12} className="mr-1" /> {meta.label}
                        </Badge>
                        <span className="text-xs text-gray-400">Page {line.source_page}</span>
                      </div>
                      <button onClick={() => removeLine(line.localId)} className="text-gray-400 hover:text-red-500" title="Exclude this line">
                        <X size={16} />
                      </button>
                    </div>
                    <p className="text-xs text-gray-400 mb-2 font-mono truncate">"{line.raw_text}"</p>

                    {isCreatingItem ? (
                      <div className="space-y-2 bg-gray-50 dark:bg-gray-900 rounded-md p-3">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs">New Inventory Item</Label>
                          <button type="button" className="text-xs text-gray-500 hover:underline" onClick={() => setCreatingItemFor(null)}>Cancel</button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <Input placeholder="Name" value={newItemForm.name} onChange={e => setNewItemForm({ ...newItemForm, name: e.target.value })} />
                          <Input placeholder="SKU" value={newItemForm.sku} onChange={e => setNewItemForm({ ...newItemForm, sku: e.target.value })} />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <Select value={newItemForm.category_id ? String(newItemForm.category_id) : ''} onValueChange={v => setNewItemForm({ ...newItemForm, category_id: Number(v) })}>
                            <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
                            <SelectContent>
                              {categories.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <Select value={newItemForm.unit || ''} onValueChange={v => setNewItemForm({ ...newItemForm, unit: v })}>
                            <SelectTrigger><SelectValue placeholder="Unit" /></SelectTrigger>
                            <SelectContent>
                              {UNIT_OPTIONS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <Button size="sm" onClick={() => handleCreateItemInline(line.localId)} className="w-full">Create &amp; Use</Button>
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-1 sm:grid-cols-[1fr_100px_120px] gap-2">
                          <Select
                            value={line.matched_item_id ? String(line.matched_item_id) : ''}
                            onValueChange={v => setMappedItem(line.localId, Number(v))}
                          >
                            <SelectTrigger className={!line.matched_item_id ? 'border-amber-400' : ''}>
                              <SelectValue placeholder="Select item..." />
                            </SelectTrigger>
                            <SelectContent>
                              {localItems.map(item => (
                                <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Input
                            type="number"
                            placeholder="Qty"
                            min={0}
                            step="any"
                            value={line.quantity ?? ''}
                            onChange={e => updateLine(line.localId, { quantity: e.target.value ? Number(e.target.value) : null, quantity_assumed: false })}
                            className={!line.quantity ? 'border-amber-400' : ''}
                          />
                          <Input
                            type="number"
                            placeholder="Total Cost"
                            min={0}
                            step="any"
                            value={line.total_cost ?? ''}
                            onChange={e => updateLine(line.localId, { total_cost: e.target.value ? Number(e.target.value) : null })}
                            className={!line.total_cost ? 'border-amber-400' : ''}
                          />
                        </div>
                        <div className="flex items-center justify-between mt-1.5">
                          {line.quantity_assumed ? (
                            <p className="text-xs text-amber-600">Quantity not found on receipt — assumed 1, please confirm</p>
                          ) : <span />}
                          {!line.matched_item_id && (
                            <button type="button" className="text-xs text-blue-600 hover:underline" onClick={() => openNewItemForm(line.localId)}>
                              + Create new item
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            <Button onClick={handleConfirm} disabled={submitting || readyLines.length === 0} className="w-full" size="lg">
              {submitting ? 'Saving...' : `Confirm & Update Stock (${readyLines.length} item${readyLines.length === 1 ? '' : 's'})`}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
