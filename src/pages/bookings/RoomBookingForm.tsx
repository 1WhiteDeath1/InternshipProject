import { useState, type RefObject } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LogIn, X } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import {
  RANKS, addDays, selectClass,
  type CalendarData, type AvailableRoom, type MemberOption, type AttendantOption,
} from './shared';
import type { BookingFormState } from './RoomSection';

interface GuestSuggestion {
  id: number; full_name: string; phone: string | null;
  id_type: string | null; id_number: string | null; unit_address: string | null;
  last_client_category: string | null; last_rank: string | null;
  last_nature_of_duty: string | null; last_stay_type: string | null;
}

const emptyNewMember = { service_number: '', full_name: '', rank: '', unit: '', mess_category: 'officers' };

interface RoomBookingFormProps {
  form: BookingFormState;
  setForm: (updater: BookingFormState | ((f: BookingFormState) => BookingFormState)) => void;
  room: CalendarData['room'];
  roomFreeToday: boolean;
  roomReady: boolean;
  today: string;
  effectiveCheckInNow: boolean;
  quote: AvailableRoom | null;
  quoteLoading: boolean;
  guestSuggestions: GuestSuggestion[];
  onSelectGuestSuggestion: (g: GuestSuggestion) => void;
  onClearGuestSuggestions: () => void;
  attendants: AttendantOption[];
  members: MemberOption[];
  saving: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  firstFieldRef: RefObject<HTMLButtonElement | null>;
}

/** The full guest-registration form, reachable from the "Book / Check-In
    Room" gateway. Conditional fields (PA No, Rank, Unit) only appear for
    officer categories, and the submit button's copy/behavior is driven
    entirely by whether check-in is actually possible right now (room
    readiness + attendant selection) - no separate bypass path. */
export function RoomBookingForm({
  form, setForm, room, roomFreeToday, roomReady, today, effectiveCheckInNow,
  quote, quoteLoading, guestSuggestions, onSelectGuestSuggestion, onClearGuestSuggestions,
  attendants, members, saving, onSubmit, onCancel, firstFieldRef,
}: RoomBookingFormProps) {
  const isOfficer = form.client_category !== 'civilian';
  const [localMembers, setLocalMembers] = useState<MemberOption[]>([]);
  const [newMemberOpen, setNewMemberOpen] = useState(false);
  const [newMemberSaving, setNewMemberSaving] = useState(false);
  const [newMember, setNewMember] = useState(emptyNewMember);
  const allMembers = [...members, ...localMembers];

  const saveNewMember = async () => {
    if (!newMember.service_number.trim() || !newMember.full_name.trim() || !newMember.rank) {
      toast.error('Service number, name, and rank are required');
      return;
    }
    setNewMemberSaving(true);
    try {
      const res = await api.post('/members', newMember);
      const created: MemberOption = { id: res.data.id, full_name: res.data.full_name, service_number: res.data.service_number };
      setLocalMembers(m => [...m, created]);
      setForm({ ...form, member_id: created.id });
      setNewMember(emptyNewMember);
      setNewMemberOpen(false);
      toast.success(`${created.full_name} registered`);
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to register member')); }
    finally { setNewMemberSaving(false); }
  };

  return (
    <div className="rounded-lg border-2 border-primary/20 shadow-sm p-4 space-y-3.5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">New Booking</p>
        <button type="button" className="text-gray-400 hover:text-gray-600" onClick={onCancel}><X size={16} /></button>
      </div>

      <div className="flex rounded-md border overflow-hidden text-xs">
        {([['walk_in', 'Walk-in / Desk'], ['online', 'Online Portal']] as const).map(([val, label], i) => (
          <button key={val} type="button" ref={i === 0 ? firstFieldRef : undefined}
            className={`flex-1 py-1.5 ${form.source === val ? 'bg-primary text-primary-foreground font-medium' : 'bg-transparent text-gray-500 hover:text-gray-700'}`}
            onClick={() => setForm({ ...form, source: val })}>
            {label}
          </button>
        ))}
      </div>
      {form.source === 'online' && (
        <div className="space-y-2">
          <Input placeholder="Online V/No *" value={form.online_voucher_no}
            onChange={e => setForm({ ...form, online_voucher_no: e.target.value })} />
          <p className="text-xs text-gray-500">Online bookings are paid in full, in advance, for the room — record what was actually received outside SAM (bank transfer/agent).</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Advance Received (Rs) *</Label>
              <Input type="number" min={0} placeholder="Amount" value={form.advance_payment_amount}
                onChange={e => setForm({ ...form, advance_payment_amount: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Date Received *</Label>
              <Input type="date" value={form.advance_paid_at} max={today}
                onChange={e => setForm({ ...form, advance_paid_at: e.target.value })} />
            </div>
          </div>
        </div>
      )}

      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Stay Dates</p>
      {form.nature_of_duty === 'hra' ? (
        <div>
          <Label className="text-xs">Move-in date</Label>
          <Input type="date" value={form.check_in} min={today} onChange={e => setForm({ ...form, check_in: e.target.value, check_out: addDays(e.target.value, 1) })} />
          <p className="text-xs text-gray-500 mt-1">Ongoing residency — renews automatically each time a mess bill is generated for this member, no fixed checkout needed.</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="grid grid-cols-2 gap-2">
            <div><Label className="text-xs">Check In</Label><Input type="date" value={form.check_in} min={today}
              onChange={e => setForm({ ...form, check_in: e.target.value, check_out: form.is_indefinite ? addDays(e.target.value, 1) : (form.check_out > e.target.value ? form.check_out : addDays(e.target.value, 1)) })} /></div>
            <div>
              <Label className="text-xs">Check Out</Label>
              <Input type="date" value={form.check_out} min={addDays(form.check_in, 1)} disabled={form.is_indefinite}
                onChange={e => setForm({ ...form, check_out: e.target.value })} />
            </div>
          </div>
          <label className="text-xs flex items-center gap-1.5 text-gray-700 dark:text-gray-200">
            <input type="checkbox" checked={form.is_indefinite}
              onChange={e => setForm({ ...form, is_indefinite: e.target.checked, check_out: addDays(form.check_in, 1) })} />
            Indefinite stay — departure date not yet known
          </label>
          {form.is_indefinite && (
            <p className="text-xs text-gray-500">Open-ended — the room stays reserved until checkout; actual nights are billed then. Rate shown below is the nightly rate.</p>
          )}
        </div>
      )}
      <label className={`text-xs flex items-center gap-1.5 ${form.check_in === today && roomFreeToday && roomReady ? 'text-gray-700 dark:text-gray-200' : 'text-gray-400'}`}>
        <input type="checkbox" checked={effectiveCheckInNow} disabled={!(form.check_in === today && roomFreeToday && roomReady)}
          onChange={e => setForm({ ...form, check_in_now: e.target.checked })} />
        Check in now (walk-in){form.check_in === today && roomFreeToday && !roomReady ? ' — room not ready' : ''}
      </label>
      {effectiveCheckInNow && (
        <div>
          <Label className="text-xs">Attendant *</Label>
          <select className={`${selectClass} ${!form.attendant_id ? 'border-red-400' : ''}`} value={form.attendant_id}
            onChange={e => setForm({ ...form, attendant_id: e.target.value })}>
            <option value="">Select attendant… (required to check in)</option>
            {attendants.some(a => a.on_duty) && (
              <optgroup label="On duty">
                {attendants.filter(a => a.on_duty).map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
              </optgroup>
            )}
            {attendants.some(a => !a.on_duty) && (
              <optgroup label={attendants.some(a => a.on_duty) ? 'Off duty' : 'All attendants'}>
                {attendants.filter(a => !a.on_duty).map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
              </optgroup>
            )}
          </select>
        </div>
      )}

      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 pt-1">Guest Classification</p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Guest Category</Label>
          <select className={selectClass} value={form.client_category} onChange={e => setForm({ ...form, client_category: e.target.value })}>
            <option value="serving_officer">Serving Officer</option>
            <option value="retired_officer">Retired Officer</option>
            <option value="civilian">Civilian</option>
          </select>
        </div>
        <div>
          <Label className="text-xs">Type of Guest</Label>
          <select className={selectClass} value={form.nature_of_duty === 'hra' ? 'member' : 'non_member'}
            onChange={e => setForm({ ...form, nature_of_duty: e.target.value === 'member' ? 'hra' : 'visit', is_indefinite: false })}>
            <option value="non_member">Non-member</option>
            {isOfficer && <option value="member">Member (HRA)</option>}
          </select>
        </div>
        {isOfficer && (
          <div>
            <Label className="text-xs">Rank</Label>
            <select className={selectClass} value={form.rank} onChange={e => setForm({ ...form, rank: e.target.value })}>
              <option value="">—</option>
              {RANKS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        )}
        <div>
          <Label className="text-xs">Stay Type</Label>
          <select className={selectClass} value={form.stay_type} onChange={e => setForm({ ...form, stay_type: e.target.value })}>
            <option value="">—</option>
            <option value="official">Official</option>
            <option value="private">Private</option>
            <option value="family">Family</option>
          </select>
        </div>
      </div>

      <div className="pt-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Guest Details</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="relative">
          <Input placeholder="Guest name *" value={form.guest_name}
            onChange={e => setForm({ ...form, guest_name: e.target.value })}
            onBlur={() => setTimeout(onClearGuestSuggestions, 150)} />
          {guestSuggestions.length > 0 && (
            <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto rounded-md border bg-white dark:bg-gray-900 shadow-lg text-sm">
              {guestSuggestions.map(g => (
                <button type="button" key={g.id}
                  className="block w-full text-left px-2 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-800"
                  onMouseDown={e => e.preventDefault()} onClick={() => onSelectGuestSuggestion(g)}>
                  <div className="font-medium">{g.full_name}</div>
                  <div className="text-xs text-gray-500">
                    {[g.phone, g.id_number].filter(Boolean).join(' · ') || 'No contact on file'}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        <Input placeholder="Phone" value={form.guest_phone} onChange={e => setForm({ ...form, guest_phone: e.target.value })} />
        {isOfficer && <Input placeholder="PA No" value={form.pa_number} onChange={e => setForm({ ...form, pa_number: e.target.value })} />}
        <div className="flex gap-1.5">
          <div className="flex-1">
            <Label className="text-xs">Adults</Label>
            <Input type="number" min={1} max={room?.capacity} value={form.adults}
              onChange={e => setForm({ ...form, adults: Number(e.target.value) })} />
          </div>
          <div className="flex-1">
            <Label className="text-xs">Children</Label>
            <Input type="number" min={0} value={form.children}
              onChange={e => setForm({ ...form, children: Number(e.target.value) })} />
          </div>
        </div>
        {/* Full-width ID row so a 13-digit CNIC is visible while typing.
            selectClass carries w-full, so the fixed width must be an
            inline style to reliably win over it. */}
        <div className="flex gap-1.5 col-span-2">
          <select className={`${selectClass} shrink-0`} style={{ width: '7rem' }} value={form.guest_id_type} onChange={e => setForm({ ...form, guest_id_type: e.target.value })}>
            <option value="cnic">CNIC</option>
            <option value="svc_no">Svc No</option>
            <option value="passport">Passport</option>
          </select>
          <Input className="flex-1" placeholder={form.guest_id_type === 'cnic' ? 'CNIC number (e.g. 12345-1234567-1)' : 'ID number'}
            value={form.guest_id_number} onChange={e => setForm({ ...form, guest_id_number: e.target.value })} />
        </div>
        <Input placeholder="Unit" value={form.unit_address} onChange={e => setForm({ ...form, unit_address: e.target.value })} />
        <div className="col-span-2">
          <Input placeholder={form.client_category === 'civilian' ? 'Reference Person (C/O) * — required for civilians' : 'Reference Person (C/O) — optional'}
            className={form.client_category === 'civilian' && !form.reference_person.trim() ? 'border-red-400' : ''}
            value={form.reference_person} onChange={e => setForm({ ...form, reference_person: e.target.value })} />
        </div>
        {form.nature_of_duty === 'hra' && (
          <div className="col-span-2 space-y-1.5">
            <div className="flex gap-1.5">
              <select className={`${selectClass} ${!form.member_id ? 'border-red-400' : ''}`} value={form.member_id}
                onChange={e => setForm({ ...form, member_id: Number(e.target.value) })}>
                <option value="0">Select member (required for HRA)</option>
                {allMembers.map(m => <option key={m.id} value={m.id}>{m.full_name} ({m.service_number})</option>)}
              </select>
              <Button type="button" size="sm" variant="outline" className="shrink-0"
                onClick={() => setNewMemberOpen(o => !o)}>
                {newMemberOpen ? 'Cancel' : '+ Register new'}
              </Button>
            </div>
            {newMemberOpen && (
              <div className="rounded-md border p-2.5 space-y-1.5">
                <p className="text-xs font-semibold text-gray-500">Register new HRA member</p>
                <div className="grid grid-cols-2 gap-1.5">
                  <Input placeholder="Service number *" value={newMember.service_number}
                    onChange={e => setNewMember({ ...newMember, service_number: e.target.value })} />
                  <Input placeholder="Full name *" value={newMember.full_name}
                    onChange={e => setNewMember({ ...newMember, full_name: e.target.value })} />
                  <select className={selectClass} value={newMember.rank} onChange={e => setNewMember({ ...newMember, rank: e.target.value })}>
                    <option value="">Rank *</option>
                    {RANKS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <select className={selectClass} value={newMember.mess_category} onChange={e => setNewMember({ ...newMember, mess_category: e.target.value })}>
                    <option value="officers">Officers</option>
                    <option value="jcos">JCOs</option>
                    <option value="ors">ORs</option>
                  </select>
                  <Input className="col-span-2" placeholder="Unit" value={newMember.unit}
                    onChange={e => setNewMember({ ...newMember, unit: e.target.value })} />
                </div>
                <Button type="button" size="sm" disabled={newMemberSaving} onClick={saveNewMember}>Save Member</Button>
              </div>
            )}
          </div>
        )}
        <Input className="col-span-2" placeholder="Remarks / special requests" value={form.special_requests} onChange={e => setForm({ ...form, special_requests: e.target.value })} />
      </div>

      <div className="border-t pt-2 flex items-center justify-between gap-2">
        <p className="text-sm">
          {quoteLoading ? <span className="text-gray-400">Pricing…</span>
            : quote?.available === false ? <span className="text-red-600 text-xs">{quote.unavailable_reason}</span>
              : quote ? (quote.pricing.pricing_mode === 'hra_monthly'
                ? (quote.pricing.monthly_total ? <><b>{formatCurrency(quote.pricing.monthly_total)}</b>/month</> : <span className="text-amber-600 text-xs">{quote.pricing.note}</span>)
                : <>{quote.pricing.nights} night{quote.pricing.nights > 1 ? 's' : ''} · <b>{formatCurrency(quote.pricing.total)}</b></>)
                : <span className="text-gray-400">Pick dates</span>}
        </p>
        <Button size="sm" onClick={onSubmit} disabled={saving || (quote ? quote.available === false : false) || (form.nature_of_duty === 'hra' && !form.member_id)}>
          {effectiveCheckInNow ? <><LogIn size={14} className="mr-1" /> Book & Check In</> : 'Confirm'}
        </Button>
      </div>
    </div>
  );
}
