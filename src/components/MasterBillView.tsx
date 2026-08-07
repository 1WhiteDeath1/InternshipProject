import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Printer, Lock, Pencil, X } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import { PRINT_STYLE, PrintArea, DottedField, rupeesInWords } from '@/components/BillPrint';

type Source = 'invoice' | 'mess_bill';

interface MasterBillRow { label: string; amount: number; reason?: string | null; }
// One entry per underlying record (unaggregated, unlike `rows` above) - the
// pre-lock Interactive correction table edits these. `source` distinguishes
// how correct() below should call the backend; absent entirely for the two
// composite/computed mess_bill rows (Extra Messing, Sui Gas) that have no
// single stored field to correct.
interface MasterBillLineItem {
  source?: 'invoice_item' | 'charge' | 'field';
  id?: number; field?: string;
  label: string; amount: number; reason?: string | null;
}
interface PaymentRow { id: number; amount: number; method: string | null; voucher_number: string | null; notes: string | null; created_at: string; }
interface PaymentBreakdown {
  online_ag_branch: number; online_ag_branch_vouchers: string[];
  bank_transfer: number; cash_deposit: number; other: number;
  total_paid: number; balance_due: number; payments: PaymentRow[];
}
interface MasterBillData {
  source: Source; source_id: number;
  header: { bill_for: string | null; rank: string | null; name: string | null; address_unit: string | null; date: string | null };
  mess: { name: string; address: string; phone: string };
  rows: MasterBillRow[]; line_items: MasterBillLineItem[];
  last_debit_balance: number; total_debit: number; credits: number; net_debits: number;
  bill_serial_number: string | null; bill_made_at: string | null;
  preset_heads: string[]; payment_breakdown: PaymentBreakdown; status: string;
}

const PAYMENT_METHODS = ['Online/AG Branch', 'Bank Transfer', 'Cash Deposit'];
const basePath = (source: Source) => source === 'invoice' ? '/billing/invoices' : '/mess-billing/bills';

function splitRsPs(amount: number): [string, string] {
  const rounded = Math.round(amount * 100) / 100;
  const rs = Math.floor(rounded);
  const ps = Math.round((rounded - rs) * 100);
  return [rs.toLocaleString('en-US'), String(ps).padStart(2, '0')];
}

/** The Interactive Invoice Table: opening a generated Invoice or MessBill
    shows this editable view of the universal paper-form bill. While still a
    draft (bill_made_at unset), the Clerk can add preset line items (Masjid,
    Library, Sweeper...), edit Last Debit Balance, and set the Bill Serial
    Number. "Make Bill" locks all of that and enables Print, which renders
    the exact EME Officers Mess bill register layout. */
export function MasterBillView({ source, sourceId, onClose }: { source: Source | null; sourceId: number | null; onClose: () => void }) {
  const [data, setData] = useState<MasterBillData | null>(null);
  const [loading, setLoading] = useState(false);
  const [serial, setSerial] = useState('');
  const [ldb, setLdb] = useState('');
  const [head, setHead] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [adding, setAdding] = useState(false);
  const [making, setMaking] = useState(false);
  const [showPrint, setShowPrint] = useState(false);

  // Pre-lock inline correction of an existing line - keyed by the
  // line_items entry being edited (label is unique enough within one bill).
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const [correctionAmount, setCorrectionAmount] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [correcting, setCorrecting] = useState(false);

  // Record Payment (split-payment: amount + method + voucher for Online)
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState(PAYMENT_METHODS[0]);
  const [payVoucher, setPayVoucher] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [payingRecording, setPayingRecording] = useState(false);

  const fetchData = async () => {
    if (!source || !sourceId) return;
    setLoading(true);
    try {
      const res = await api.get(`${basePath(source)}/${sourceId}/master-bill`);
      setData(res.data);
      setSerial(res.data.bill_serial_number || '');
      setLdb(String(res.data.last_debit_balance || ''));
      if (!head) setHead(res.data.preset_heads[0] || '');
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to load the bill')); }
    finally { setLoading(false); }
  };

  useEffect(() => { queueMicrotask(() => { setData(null); setShowPrint(false); fetchData(); }); }, [source, sourceId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!source || !sourceId) return null;
  const locked = !!data?.bill_made_at;

  const saveSerial = async () => {
    if (!data || serial.trim() === (data.bill_serial_number || '')) return;
    try {
      const url = source === 'invoice' ? `${basePath(source)}/${sourceId}/serial-number` : `${basePath(source)}/${sourceId}/serial-number?bill_serial_number=${encodeURIComponent(serial.trim())}`;
      if (source === 'invoice') await api.put(url, { bill_serial_number: serial.trim() });
      else await api.put(url);
      fetchData();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to save serial number')); }
  };

  const saveLdb = async () => {
    if (!data) return;
    const val = Number(ldb) || 0;
    if (val === data.last_debit_balance) return;
    try {
      await api.put(`${basePath(source)}/${sourceId}/last-debit-balance`, { last_debit_balance: val });
      fetchData();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to save last debit balance')); }
  };

  const addLine = async () => {
    const amt = Number(amount);
    if (!head) { toast.error('Select a line item'); return; }
    if (!amt || amt <= 0) { toast.error('Enter an amount'); return; }
    if (reason.trim().length < 3) { toast.error('A reason (at least 3 characters) is required'); return; }
    setAdding(true);
    try {
      const path = source === 'invoice' ? `${basePath(source)}/${sourceId}/master-bill-lines` : `${basePath(source)}/${sourceId}/charges`;
      await api.post(path, { head, amount: amt, reason: reason.trim() });
      toast.success(`${head} — ${formatCurrency(amt)} added`);
      setAmount(''); setReason('');
      fetchData();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to add line item')); }
    finally { setAdding(false); }
  };

  const startEdit = (li: MasterBillLineItem) => {
    setEditingLabel(li.label);
    setCorrectionAmount(String(li.amount));
    setCorrectionReason('');
  };

  const cancelEdit = () => { setEditingLabel(null); setCorrectionAmount(''); setCorrectionReason(''); };

  const saveCorrection = async (li: MasterBillLineItem) => {
    const newAmount = Number(correctionAmount);
    if (!Number.isFinite(newAmount) || newAmount < 0) { toast.error('Enter a valid amount'); return; }
    if (correctionReason.trim().length < 3) { toast.error('A Correction Reason (at least 3 characters) is required'); return; }
    setCorrecting(true);
    try {
      if (source === 'invoice') {
        await api.put(`${basePath(source)}/${sourceId}/items/${li.id}/correct`, { new_amount: newAmount, correction_reason: correctionReason.trim() });
      } else if (li.source === 'field') {
        await api.put(`${basePath(source)}/${sourceId}/correct-field`, { field: li.field, new_amount: newAmount, correction_reason: correctionReason.trim() });
      } else {
        await api.put(`/mess-billing/charges/${li.id}/correct`, { new_amount: newAmount, correction_reason: correctionReason.trim() });
      }
      toast.success(`${li.label} corrected — Manager notified in Alerts & Approvals`);
      cancelEdit();
      fetchData();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to save correction')); }
    finally { setCorrecting(false); }
  };

  const recordPayment = async () => {
    const amt = Number(payAmount);
    if (!amt || amt <= 0) { toast.error('Enter a valid payment amount'); return; }
    if (payMethod === 'Online/AG Branch' && !payVoucher.trim()) { toast.error('Voucher Number is required for Online/AG Branch payments'); return; }
    setPayingRecording(true);
    try {
      await api.post(`${basePath(source)}/${sourceId}/payments`, {
        amount: amt, method: payMethod, voucher_number: payVoucher.trim() || undefined, notes: payNotes.trim() || undefined,
      });
      toast.success(`${formatCurrency(amt)} payment recorded (${payMethod})`);
      setPayAmount(''); setPayVoucher(''); setPayNotes('');
      fetchData();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to record payment')); }
    finally { setPayingRecording(false); }
  };

  const makeBill = async () => {
    setMaking(true);
    try {
      await saveSerial();
      await api.post(`${basePath(source)}/${sourceId}/make-bill`);
      toast.success('Bill made — Print is now available');
      fetchData();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to make bill')); }
    finally { setMaking(false); }
  };

  return (
    <>
      <Dialog open={!!source && !!sourceId && !showPrint} onOpenChange={open => { if (!open) onClose(); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Interactive Invoice Table {locked && <span className="text-amber-600 text-sm font-normal ml-2 inline-flex items-center gap-1"><Lock size={13} /> Made — locked</span>}</DialogTitle></DialogHeader>
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!loading && data && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Bill Serial Number</Label>
                  <Input value={serial} disabled={locked} onChange={e => setSerial(e.target.value)} onBlur={saveSerial} placeholder="e.g. 1045" />
                </div>
                <div>
                  <Label className="text-xs">Last Debit Balance (Rs)</Label>
                  <Input type="number" min={0} disabled={locked} value={ldb} onChange={e => setLdb(e.target.value.replace(/^0+(?=\d)/, ''))} onBlur={saveLdb} />
                </div>
              </div>

              {locked ? (
                <Table>
                  <TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {data.rows.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell>{r.label}{r.reason && <span className="block text-xs text-muted-foreground">{r.reason}</span>}</TableCell>
                        <TableCell className="text-right font-mono">{formatCurrency(r.amount)}</TableCell>
                      </TableRow>
                    ))}
                    {data.rows.length === 0 && <TableRow><TableCell colSpan={2} className="text-center py-6 text-muted-foreground">No charges yet</TableCell></TableRow>}
                  </TableBody>
                </Table>
              ) : (
                <Table>
                  <TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="w-10" /></TableRow></TableHeader>
                  <TableBody>
                    {data.line_items.map(li => {
                      const editable = source === 'invoice' ? !!li.id : li.source === 'field' || li.source === 'charge';
                      const editing = editingLabel === li.label;
                      return (
                        <TableRow key={li.label}>
                          <TableCell>
                            {li.label}{li.reason && <span className="block text-xs text-muted-foreground">{li.reason}</span>}
                            {editing && (
                              <div className="mt-1.5 space-y-1.5">
                                <Input type="number" min={0} placeholder="Corrected amount" className="h-8 text-xs" value={correctionAmount} onChange={e => setCorrectionAmount(e.target.value.replace(/^0+(?=\d)/, ''))} />
                                <Input placeholder="Correction Reason (required)" className="h-8 text-xs" value={correctionReason} onChange={e => setCorrectionReason(e.target.value)} />
                                <div className="flex gap-1.5">
                                  <Button size="sm" className="h-7 text-xs flex-1" disabled={correcting} onClick={() => saveCorrection(li)}>{correcting ? 'Saving…' : 'Save Correction'}</Button>
                                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={cancelEdit}><X size={13} /></Button>
                                </div>
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono align-top">{formatCurrency(li.amount)}</TableCell>
                          <TableCell className="align-top">
                            {editable && !editing && (
                              <button type="button" className="text-muted-foreground hover:text-foreground" title="Correct this amount" onClick={() => startEdit(li)}>
                                <Pencil size={13} />
                              </button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {data.line_items.length === 0 && <TableRow><TableCell colSpan={3} className="text-center py-6 text-muted-foreground">No charges yet</TableCell></TableRow>}
                  </TableBody>
                </Table>
              )}

              <div className="rounded-lg border p-3 text-sm space-y-1">
                <div className="flex justify-between"><span>Total Debit</span><span className="font-mono">{formatCurrency(data.total_debit)}</span></div>
                <div className="flex justify-between text-muted-foreground"><span>Credits</span><span className="font-mono">− {formatCurrency(data.credits)}</span></div>
                <div className="flex justify-between font-bold border-t pt-1"><span>Net Debits (Total Gross Bill)</span><span className="font-mono">{formatCurrency(data.net_debits)}</span></div>
              </div>

              <div className="rounded-lg border p-3 text-sm space-y-1">
                <p className="font-semibold mb-1">Payment Summary Breakdown</p>
                {data.payment_breakdown.online_ag_branch > 0 && (
                  <div className="flex justify-between">
                    <span>Advance Paid (Online/AG Branch){data.payment_breakdown.online_ag_branch_vouchers.length > 0 && <span className="text-muted-foreground"> (V/No {data.payment_breakdown.online_ag_branch_vouchers.join(', ')})</span>}</span>
                    <span className="font-mono">{formatCurrency(data.payment_breakdown.online_ag_branch)}</span>
                  </div>
                )}
                {data.payment_breakdown.bank_transfer > 0 && (
                  <div className="flex justify-between"><span>Bank Transfer Payments</span><span className="font-mono">{formatCurrency(data.payment_breakdown.bank_transfer)}</span></div>
                )}
                {data.payment_breakdown.cash_deposit > 0 && (
                  <div className="flex justify-between"><span>Cash Payments</span><span className="font-mono">{formatCurrency(data.payment_breakdown.cash_deposit)}</span></div>
                )}
                {data.payment_breakdown.other > 0 && (
                  <div className="flex justify-between text-muted-foreground"><span>Other Payments</span><span className="font-mono">{formatCurrency(data.payment_breakdown.other)}</span></div>
                )}
                {data.payment_breakdown.total_paid === 0 && <p className="text-xs text-muted-foreground">No payments recorded yet</p>}
                <div className="flex justify-between border-t pt-1"><span>Total Paid to Date</span><span className="font-mono">{formatCurrency(data.payment_breakdown.total_paid)}</span></div>
                <div className="flex justify-between font-bold"><span>Remaining Balance Due</span><span className="font-mono">{formatCurrency(Math.max(data.payment_breakdown.balance_due, 0))}</span></div>
              </div>

              {data.payment_breakdown.balance_due > 0.01 && (
                <div className="rounded-lg border p-3 space-y-2">
                  <p className="text-sm font-semibold">Record Payment</p>
                  <div className="grid grid-cols-2 gap-2">
                    <select className="h-9 rounded-md border border-input bg-background px-2 text-xs" value={payMethod} onChange={e => setPayMethod(e.target.value)}>
                      {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <Input type="number" min={1} placeholder="Rs" className="h-9 text-xs" value={payAmount} onChange={e => setPayAmount(e.target.value.replace(/^0+(?=\d)/, ''))} />
                  </div>
                  {(payMethod === 'Online/AG Branch' || payMethod === 'Bank Transfer') && (
                    <Input placeholder={payMethod === 'Online/AG Branch' ? 'Voucher Number (required)' : 'Voucher Number (optional)'} className="h-9 text-xs" value={payVoucher} onChange={e => setPayVoucher(e.target.value)} />
                  )}
                  <Input placeholder="Notes (optional)" className="h-9 text-xs" value={payNotes} onChange={e => setPayNotes(e.target.value)} />
                  <Button size="sm" className="h-9 w-full" disabled={payingRecording} onClick={recordPayment}>{payingRecording ? 'Recording…' : 'Record Payment'}</Button>
                </div>
              )}

              {!locked && (
                <div className="rounded-lg border p-3 space-y-2">
                  <p className="text-sm font-semibold">Add Line Item</p>
                  <div className="grid grid-cols-2 gap-2">
                    <select className="h-9 rounded-md border border-input bg-background px-2 text-xs" value={head} onChange={e => setHead(e.target.value)}>
                      {data.preset_heads.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                    <Input type="number" min={1} placeholder="Rs" className="h-9 text-xs" value={amount} onChange={e => setAmount(e.target.value.replace(/^0+(?=\d)/, ''))} />
                  </div>
                  <Input placeholder="Reason / Description (required)" className="h-9 text-xs" value={reason} onChange={e => setReason(e.target.value)} />
                  <Button size="sm" className="h-9 w-full" disabled={adding} onClick={addLine}>{adding ? 'Adding…' : 'Add'}</Button>
                </div>
              )}

              <div className="flex gap-2">
                <Button className="flex-1" disabled={making || locked} onClick={makeBill}>{making ? 'Making…' : locked ? 'Bill Made' : 'Make Bill'}</Button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex-1 inline-flex">
                      <Button className="w-full" disabled={!locked} onClick={() => setShowPrint(true)}>
                        <Printer size={16} className="mr-1" /> Print
                      </Button>
                    </span>
                  </TooltipTrigger>
                  {!locked && <TooltipContent>Click &quot;Make Bill&quot; to lock and enable printing.</TooltipContent>}
                </Tooltip>
                <Button variant="ghost" onClick={onClose}>Close</Button>
              </div>
              {!locked && <p className="text-xs text-muted-foreground">Print unlocks once the bill is Made — review the line items above first.</p>}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {showPrint && data && <MasterBillPrint data={data} onClose={() => setShowPrint(false)} />}
    </>
  );
}

function MasterBillPrint({ data, onClose }: { data: MasterBillData; onClose: () => void }) {
  const mess = data.mess;

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <style>{PRINT_STYLE}</style>
        <DialogHeader><DialogTitle>Detailed Mess Bill</DialogTitle></DialogHeader>
        <PrintArea>
          <div className="bill-page border border-gray-400 rounded-sm p-5 text-[13px] text-foreground bg-white space-y-3">
            <div className="text-center">
              <p className="font-bold text-lg tracking-wide uppercase">{mess?.name || 'EME Officers Mess'}</p>
              <p className="text-[11px] text-muted-foreground">{mess?.address || '204 - Firdousi Road, Rawalpindi'}. {mess?.phone || 'Tel : GHQ/31725'}</p>
            </div>

            <div className="flex justify-between gap-4">
              <DottedField label="Bill for the Month of" value={data.header.bill_for || '—'} grow />
              <DottedField label="Serial No." value={data.bill_serial_number || '—'} />
            </div>
            <div className="flex gap-4">
              <DottedField label="Rank" value={data.header.rank || '—'} />
              <DottedField label="Name" value={data.header.name} grow />
            </div>
            <div className="flex gap-4">
              <DottedField label="Address / Unit" value={data.header.address_unit || '—'} grow />
              <DottedField label="Date" value={data.header.date ? new Date(data.header.date).toLocaleDateString('en-GB') : '—'} />
            </div>

            <table className="w-full border-collapse mt-1">
              <thead>
                <tr>
                  <th className="border border-gray-500 px-2 py-1 w-10 text-left">Item</th>
                  <th className="border border-gray-500 px-2 py-1 text-left">Details</th>
                  <th className="border border-gray-500 px-2 py-1 w-20 text-right">Rs.</th>
                  <th className="border border-gray-500 px-2 py-1 w-12 text-right">Ps.</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => {
                  const [rs, ps] = splitRsPs(r.amount);
                  return (
                    <tr key={i}>
                      <td className="border border-gray-500 px-2 py-1">{i + 1}</td>
                      <td className="border border-gray-500 px-2 py-1">{r.label}</td>
                      <td className="border border-gray-500 px-2 py-1 text-right font-mono">{rs}</td>
                      <td className="border border-gray-500 px-2 py-1 text-right font-mono">{ps}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2} className="border border-gray-500 px-2 py-1 font-bold text-right">Total Debit</td>
                  <td colSpan={2} className="border border-gray-500 px-2 py-1 text-right font-bold font-mono">{formatCurrency(data.total_debit)}</td>
                </tr>
                <tr>
                  <td colSpan={2} className="border border-gray-500 px-2 py-1 text-right">Credits</td>
                  <td colSpan={2} className="border border-gray-500 px-2 py-1 text-right font-mono">− {formatCurrency(data.credits)}</td>
                </tr>
                <tr>
                  <td colSpan={2} className="border border-gray-500 px-2 py-1 font-bold text-right">Net Debits</td>
                  <td colSpan={2} className="border border-gray-500 px-2 py-1 text-right font-bold font-mono">{formatCurrency(data.net_debits)}</td>
                </tr>
              </tfoot>
            </table>

            <div className="flex justify-end pt-2">
              <div className="text-right">
                <p className="text-[12px] font-semibold">For EME Officer's Mess</p>
                <p className="border-t border-gray-500 mt-8 pt-1 text-[12px] text-center">Mess Secretary</p>
              </div>
            </div>

            <div className="text-[10px] text-muted-foreground space-y-0.5 pt-2 border-t">
              <p>(i) Payment to be made by cheque. Cheque to be crossed and made payable to Secretary, EME Officer's Mess, Rawalpindi.</p>
              <p>(ii) Add Bank commission Rs.199/- on all out station charges.</p>
              <p>(iii) Bill under all circumstances to be paid in fully by 10th of each month in each of over charges the amount due will be adjusted next month.</p>
            </div>

            <div className="border-t-2 border-dashed pt-2 space-y-2">
              <div className="flex flex-wrap gap-1"><DottedField label="Received Cash/Cheque No." value="" grow /></div>
              <div className="flex gap-4">
                <DottedField label="Dated" value="" />
                <DottedField label="for Rs." value={`${formatCurrency(data.net_debits)} (${rupeesInWords(data.net_debits)} only)`} grow />
              </div>
              <p className="text-right text-[12px] pt-4">Mess Secretary</p>
            </div>
          </div>
        </PrintArea>
        <div className="flex gap-2 pt-2">
          <Button onClick={() => window.print()} className="flex-1"><Printer size={16} className="mr-1" /> Print</Button>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
