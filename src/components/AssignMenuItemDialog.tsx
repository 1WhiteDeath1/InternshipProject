import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';

interface Candidate {
  kind: 'member' | 'booking';
  id: number;
  name: string;
  sub_label: string | null;
  menu_item_id: number | null;
}

function rowKey(r: { kind: string; id: number }) { return `${r.kind}-${r.id}`; }

/** Second step of the attendance workflow: having already marked who's
    attending a meal (the roster switches), pick who's eating one specific
    menu item. Only offers people already marked present for the meal - this
    dialog assigns the dish, it doesn't itself mark anyone attending. Saving
    writes to MealAttendance.menu_item_id via /attendance/matrix/assign-item,
    which is what Kitchen's Production tab (suggested-orders/Generate)
    actually aggregates by - this is the missing link between the two. */
export function AssignMenuItemDialog({
  open, onOpenChange, date, mealType, menuItemId, menuItemName, groups, onSaved,
}: {
  open: boolean; onOpenChange: (open: boolean) => void;
  date: string; mealType: string; menuItemId: number; menuItemName: string;
  groups: { title: string; rows: Candidate[] }[];
  onSaved: () => void;
}) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const next: Record<string, boolean> = {};
    for (const g of groups) for (const r of g.rows) next[rowKey(r)] = r.menu_item_id === menuItemId;
    setChecked(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, menuItemId]);

  const allRows = groups.flatMap(g => g.rows);
  const allChecked = allRows.length > 0 && allRows.every(r => checked[rowKey(r)]);

  const toggleAll = () => {
    const next: Record<string, boolean> = {};
    for (const r of allRows) next[rowKey(r)] = !allChecked;
    setChecked(next);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const entries = allRows.filter(r => checked[rowKey(r)]).map(r => ({ kind: r.kind, id: r.id }));
      await api.post('/attendance/matrix/assign-item', { date, meal_type: mealType, menu_item_id: menuItemId, entries });
      toast.success(`${menuItemName}: ${entries.length} assigned`);
      onOpenChange(false);
      onSaved();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to save')); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Who's eating {menuItemName}?</DialogTitle>
        </DialogHeader>
        {allRows.length === 0 && (
          <p className="text-sm text-muted-foreground">Nobody is marked attending this meal yet - mark attendance first.</p>
        )}
        {allRows.length > 0 && (
          <label className="flex items-center gap-2 text-sm font-medium pb-2 border-b cursor-pointer">
            <Checkbox checked={allChecked} onCheckedChange={toggleAll} />
            Select all
          </label>
        )}
        <div className="space-y-4">
          {groups.map(g => g.rows.length > 0 && (
            <div key={g.title}>
              <p className="text-xs font-semibold text-muted-foreground mb-1">{g.title}</p>
              <div className="space-y-1">
                {g.rows.map(r => (
                  <label key={rowKey(r)} className="flex items-center justify-between gap-2 text-sm py-1 cursor-pointer">
                    <span className="flex items-center gap-2 min-w-0">
                      <Checkbox checked={!!checked[rowKey(r)]}
                        onCheckedChange={(v) => setChecked({ ...checked, [rowKey(r)]: !!v })} />
                      <span className="truncate">{r.name}</span>
                    </span>
                    {r.menu_item_id && r.menu_item_id !== menuItemId && (
                      <span className="text-xs text-amber-600 shrink-0">already on another item</span>
                    )}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || allRows.length === 0}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
