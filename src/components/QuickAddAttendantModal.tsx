import { useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { selectClass } from '@/pages/bookings/shared';

interface QuickAddAttendantModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const emptyForm = { full_name: '', phone: '', email: '', shift: '' };

/** Global "+ Add Attendant" shortcut - same POST /attendants call the
    Attendants page's own dialog makes. Fires 'attendants:changed' so the
    Attendants page's list refreshes immediately if it's already mounted
    (e.g. the shortcut was used from that very page). */
export function QuickAddAttendantModal({ open, onOpenChange }: QuickAddAttendantModalProps) {
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const reset = () => setForm(emptyForm);

  const handleSave = async () => {
    if (!form.full_name.trim()) { toast.error('Enter a full name'); return; }
    setSaving(true);
    try {
      await api.post('/attendants', form);
      toast.success(`${form.full_name} added as attendant`);
      window.dispatchEvent(new Event('attendants:changed'));
      onOpenChange(false);
      reset();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to add attendant')); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={v => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Attendant</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Full Name" value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} autoFocus />
          <Input placeholder="Phone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
          <Input placeholder="Email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          <div>
            <Label className="text-xs">Shift</Label>
            <select className={selectClass} value={form.shift} onChange={e => setForm({ ...form, shift: e.target.value })}>
              <option value="">—</option>
              <option value="morning">Morning</option>
              <option value="evening">Evening</option>
              <option value="night">Night</option>
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Adding…' : 'Add Attendant'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
