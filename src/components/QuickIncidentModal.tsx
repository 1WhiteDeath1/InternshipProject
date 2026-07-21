import { useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { selectClass } from '@/pages/bookings/shared';

interface QuickIncidentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const emptyForm = { title: '', description: '', location: '', category: 'other', severity: 'low' };

/** Global "+ Report Incident" shortcut - same POST /security/incidents call
    the Security page's own dialog makes. Fires 'incidents:changed' so the
    Security page's list refreshes immediately if it's already mounted
    (e.g. the shortcut was used from that very page). */
export function QuickIncidentModal({ open, onOpenChange }: QuickIncidentModalProps) {
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const reset = () => setForm(emptyForm);

  const handleSave = async () => {
    if (!form.title.trim()) { toast.error('Enter a title'); return; }
    setSaving(true);
    try {
      await api.post('/security/incidents', form);
      toast.success('Incident reported');
      window.dispatchEvent(new Event('incidents:changed'));
      onOpenChange(false);
      reset();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to report incident')); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={v => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Security Incident Report</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} autoFocus />
          <textarea
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px]"
            placeholder="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
          />
          <Input placeholder="Location" value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} />
          <select className={selectClass} value={form.severity} onChange={e => setForm({ ...form, severity: e.target.value })}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Submitting…' : 'Submit Report'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
