import { useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { selectClass } from '@/pages/bookings/shared';

interface QuickAddMemberModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const emptyForm = { service_number: '', full_name: '', rank: '', unit: '', mess_category: 'officers', phone: '', email: '' };

/** Global "+ Add Member" shortcut - covers the fields every member needs on
    day one (Women's Bloc flag / custom discount rate stay supervisor-only
    edits on the Members page itself, same as the full dialog there). Fires
    'members:changed' so the Members page's list refreshes immediately if
    it's already mounted (e.g. the shortcut was used from that very page). */
export function QuickAddMemberModal({ open, onOpenChange }: QuickAddMemberModalProps) {
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const reset = () => setForm(emptyForm);

  const handleSave = async () => {
    if (!form.service_number.trim() || !form.full_name.trim() || !form.rank.trim()) {
      toast.error('Service number, full name, and rank are required');
      return;
    }
    setSaving(true);
    try {
      await api.post('/members', form);
      toast.success(`${form.full_name} added as member`);
      window.dispatchEvent(new Event('members:changed'));
      onOpenChange(false);
      reset();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to add member')); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={v => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Member</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Service Number" value={form.service_number} onChange={e => setForm({ ...form, service_number: e.target.value })} autoFocus />
            <Input placeholder="Full Name" value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Rank" value={form.rank} onChange={e => setForm({ ...form, rank: e.target.value })} />
            <Input placeholder="Unit" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Mess Category</Label>
            <select className={selectClass} value={form.mess_category} onChange={e => setForm({ ...form, mess_category: e.target.value })}>
              <option value="officers">Officers</option>
              <option value="jcos">JCOs</option>
              <option value="ors">ORs</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Phone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
            <Input placeholder="Email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Adding…' : 'Create Member'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
