import { useCallback, useEffect, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  LogIn, LogOut, Sparkles, Wrench, ChevronLeft, ChevronRight, Plus,
  ImagePlus, X, Camera,
} from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import {
  ROOM_TYPE_LABELS, RANKS, todayISO, addDays, fmtDay, selectClass,
  type CalendarData, type CalendarStay, type AvailableRoom, type MemberOption,
} from './shared';
import { StatusBadge, HousekeepingBadge, HraBadge } from './badges';

export interface InitialBooking {
  check_in: string;
  check_out: string;
  check_in_now?: boolean;
}

interface RoomSectionProps {
  roomId: number | null;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
  members: MemberOption[];
  initialBooking?: InitialBooking | null;
}

const emptyForm = (checkIn: string, checkOut: string, checkInNow: boolean) => ({
  guest_name: '', guest_phone: '', rank: '', pa_number: '', unit_address: '',
  guest_id_type: 'cnic', guest_id_number: '', client_category: 'serving_officer',
  nature_of_duty: 'visit', da_multiplier: '1.5', mattress_count: 0,
  member_id: 0, special_requests: '',
  check_in: checkIn, check_out: checkOut, check_in_now: checkInNow,
});

export default function RoomSection({ roomId, open, onClose, onChanged, members, initialBooking }: RoomSectionProps) {
  const now = new Date();
  const [ym, setYm] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const [data, setData] = useState<CalendarData | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(() => emptyForm(todayISO(), addDays(todayISO(), 1), false));
  const [quote, setQuote] = useState<AvailableRoom | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const today = todayISO();

  const loadInitial = useCallback(async () => {
    if (!roomId) return;
    try {
      const res = await api.get(`/bookings/rooms/${roomId}/calendar?year=${ym.year}&month=${ym.month}`);
      const d: CalendarData = res.data;
      setData(d);
      setSelectedDay(null);

      const arrivalToday = d.stays.find(s => s.status === 'confirmed' && s.check_in <= today && today < s.check_out);
      const roomFreeToday = !d.current_booking && !arrivalToday;

      if (initialBooking) {
        setForm(emptyForm(initialBooking.check_in, initialBooking.check_out, !!initialBooking.check_in_now));
        setFormOpen(true);
      } else if (roomFreeToday) {
        setForm(emptyForm(today, addDays(today, 1), true));
        setFormOpen(true);
      } else {
        setForm(emptyForm(today, addDays(today, 1), false));
        setFormOpen(false);
      }
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to load room')); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, ym, initialBooking]);

  const reloadCalendar = useCallback(async () => {
    if (!roomId) return;
    try {
      const res = await api.get(`/bookings/rooms/${roomId}/calendar?year=${ym.year}&month=${ym.month}`);
      setData(res.data);
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to refresh room')); }
  }, [roomId, ym]);

  useEffect(() => { if (open && roomId) queueMicrotask(() => loadInitial()); }, [open, roomId, loadInitial]);
  useEffect(() => { if (open && roomId) queueMicrotask(() => reloadCalendar()); }, [ym, open, roomId, reloadCalendar]);

  const isOfficer = form.client_category !== 'civilian';
  const datesValid = form.check_in && form.check_out && form.check_out > form.check_in;

  const fetchQuote = useCallback(async () => {
    if (!roomId || !formOpen || !datesValid) { setQuote(null); return; }
    setQuoteLoading(true);
    try {
      const params = new URLSearchParams({
        check_in: form.check_in, check_out: form.check_out, room_id: String(roomId),
        client_category: form.client_category, nature_of_duty: form.nature_of_duty,
        rank: form.rank, da_multiplier: form.nature_of_duty === 'official_duty' ? form.da_multiplier : '0',
        mattress_count: String(form.mattress_count), member_id: String(form.member_id || 0),
      });
      const res = await api.get(`/bookings/availability?${params.toString()}`);
      setQuote(res.data.items[0] || null);
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to price this stay')); }
    finally { setQuoteLoading(false); }
  }, [roomId, formOpen, datesValid, form.check_in, form.check_out, form.client_category, form.nature_of_duty, form.rank, form.da_multiplier, form.mattress_count, form.member_id]);

  useEffect(() => { if (formOpen) queueMicrotask(() => fetchQuote()); }, [formOpen, fetchQuote]);

  const room = data?.room;
  const current = data?.current_booking;
  const arrivalToday = data?.stays.find(s => s.status === 'confirmed' && s.check_in <= today && today < s.check_out);
  const upcoming = data?.stays.filter(s => s.status === 'confirmed' && s.check_in > today) || [];
  const roomFreeToday = !current && !arrivalToday;
  const effectiveCheckInNow = form.check_in_now && form.check_in === today && roomFreeToday;

  const act = async (fn: () => Promise<unknown>, okMsg: string) => {
    try { await fn(); toast.success(okMsg); await reloadCalendar(); onChanged(); }
    catch (err) { toast.error(getErrorMessage(err, 'Failed')); }
  };

  const handleSubmitBooking = async () => {
    if (!roomId) return;
    if (!form.guest_name.trim()) { toast.error('Guest name is required'); return; }
    if (!datesValid) { toast.error('Check-out must be after check-in'); return; }
    if (form.nature_of_duty === 'hra' && !form.member_id) { toast.error('HRA residency must be linked to a member'); return; }
    setSaving(true);
    try {
      const res = await api.post('/bookings', {
        guest_name: form.guest_name, guest_phone: form.guest_phone || null,
        guest_id_type: form.guest_id_type, guest_id_number: form.guest_id_number || null,
        room_id: roomId, check_in: form.check_in, check_out: form.check_out,
        client_category: form.client_category, member_id: form.member_id || null,
        rank: form.rank || null, pa_number: form.pa_number || null,
        unit_address: form.unit_address || null, nature_of_duty: form.nature_of_duty,
        da_multiplier: form.nature_of_duty === 'official_duty' ? Number(form.da_multiplier) : null,
        mattress_count: form.mattress_count, special_requests: form.special_requests || null,
        check_in_now: effectiveCheckInNow,
      });
      const p = res.data.pricing;
      const amountText = p.pricing_mode === 'hra_monthly' ? `${formatCurrency(res.data.total_amount)}/month (HRA)` : formatCurrency(res.data.total_amount);
      toast.success(`${res.data.booking_reference} — ${amountText}${effectiveCheckInNow ? ' — guest checked in' : ''}`);
      setFormOpen(false);
      await reloadCalendar();
      onChanged();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to create booking')); }
    finally { setSaving(false); }
  };

  const handleUploadPhoto = async (file: File) => {
    if (!roomId) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post(`/bookings/rooms/${roomId}/photos`, fd, { headers: { 'Content-Type': undefined } });
      setData(prev => prev ? { ...prev, room: { ...prev.room, photos: res.data.photos } } : prev);
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to upload photo')); }
    finally { setUploading(false); }
  };

  const handleDeletePhoto = async (photoId: number) => {
    if (!roomId) return;
    try {
      const res = await api.delete(`/bookings/rooms/${roomId}/photos/${photoId}`);
      setData(prev => prev ? { ...prev, room: { ...prev.room, photos: res.data.photos } } : prev);
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to remove photo')); }
  };

  const monthName = new Date(ym.year, ym.month - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const daysInMonth = new Date(ym.year, ym.month, 0).getDate();
  const firstDow = new Date(ym.year, ym.month - 1, 1).getDay();
  const pad = (n: number) => String(n).padStart(2, '0');
  const STAY_PRIORITY: Record<string, number> = { checked_in: 3, confirmed: 2, checked_out: 1 };
  const stayFor = (day: number): CalendarStay | undefined => {
    const iso = `${ym.year}-${pad(ym.month)}-${pad(day)}`;
    return data?.stays
      .filter(s => s.check_in <= iso && iso < s.check_out)
      .sort((a, b) => (STAY_PRIORITY[b.status] || 0) - (STAY_PRIORITY[a.status] || 0))[0];
  };
  const stayColor = (s: CalendarStay) =>
    s.status === 'checked_in' ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100'
      : s.status === 'confirmed' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100'
        : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300';

  const handleDayClick = (iso: string) => {
    setSelectedDay(iso);
    if (formOpen) {
      setForm(f => ({
        ...f, check_in: iso,
        check_out: f.check_out > iso ? f.check_out : addDays(iso, 1),
        check_in_now: iso === today ? f.check_in_now : false,
      }));
    }
  };

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        {room && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center justify-between pr-6">
                <span>Room {room.room_number}</span>
                <span className="flex gap-1.5">
                  {current?.nature_of_duty === 'hra' && <HraBadge />}
                  <StatusBadge status={room.status === 'occupied' ? 'checked_in' : room.status === 'reserved' ? 'confirmed' : room.status} />
                  <HousekeepingBadge status={room.housekeeping_status} />
                </span>
              </SheetTitle>
            </SheetHeader>
            <div className="space-y-4 mt-2 px-1">
              <p className="text-sm text-gray-500">{ROOM_TYPE_LABELS[room.room_type] || room.room_type} · floor {room.floor} · sleeps {room.capacity}</p>

              {/* Photos */}
              <div className="flex gap-2 overflow-x-auto pb-1">
                {room.photos.map(p => (
                  <div key={p.id} className="relative shrink-0 group">
                    <img src={p.url} alt={`Room ${room.room_number}`} className="w-20 h-20 object-cover rounded-md border" />
                    <button type="button" onClick={() => handleDeletePhoto(p.id)}
                      className="absolute -top-1.5 -right-1.5 bg-gray-900/80 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <X size={12} />
                    </button>
                  </div>
                ))}
                <label className={`shrink-0 w-20 h-20 rounded-md border-2 border-dashed flex flex-col items-center justify-center gap-1 cursor-pointer text-gray-400 hover:text-gray-600 hover:border-gray-400 ${room.photos.length === 0 ? 'w-full' : ''}`}>
                  {room.photos.length === 0 ? <Camera size={20} /> : <ImagePlus size={18} />}
                  <span className="text-[10px] text-center px-1">{uploading ? 'Uploading…' : room.photos.length === 0 ? 'Add room photos' : 'Add'}</span>
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={uploading}
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleUploadPhoto(f); e.target.value = ''; }} />
                </label>
              </div>

              {/* Customer details */}
              {current && (
                <div className="rounded-lg border p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <p className="text-xs text-gray-400">{current.nature_of_duty === 'hra' ? 'HRA resident' : 'Now staying'}</p>
                    {current.nature_of_duty === 'hra' && <HraBadge />}
                  </div>
                  <p className="font-medium">{current.rank ? `${current.rank} ` : ''}{current.guest_name}</p>
                  <p className="text-xs text-gray-500">{current.booking_reference}{current.guest_phone ? ` · ${current.guest_phone}` : ''}</p>
                  <div className="flex items-center justify-between mt-2 text-sm">
                    <span>{current.nature_of_duty === 'hra' ? `Resident since ${fmtDay(current.check_in)}` : `${fmtDay(current.check_in)} → ${fmtDay(current.check_out)}`}</span>
                    {current.nature_of_duty !== 'hra' && <span className="font-medium">{formatCurrency(current.total_amount)}</span>}
                  </div>
                  {current.nature_of_duty === 'hra' && <p className="text-xs text-gray-500 mt-0.5">Billed monthly via the mess bill, not a fixed total</p>}
                  <Button size="sm" className="mt-2 w-full" onClick={() => act(() => api.post(`/bookings/${current.id}/check-out`), 'Guest checked out — room sent to housekeeping queue')}>
                    <LogOut size={14} className="mr-1" /> Check Out
                  </Button>
                </div>
              )}
              {arrivalToday && (
                <div className="rounded-lg border p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <p className="text-xs text-gray-400">Arriving today</p>
                    {arrivalToday.nature_of_duty === 'hra' && <HraBadge />}
                  </div>
                  <p className="font-medium">{arrivalToday.guest_name}</p>
                  <p className="text-xs text-gray-500">{arrivalToday.booking_reference}</p>
                  <Button size="sm" className="mt-2 w-full" onClick={() => act(() => api.post(`/bookings/${arrivalToday.id}/check-in`), `${arrivalToday.guest_name} checked in`)}>
                    <LogIn size={14} className="mr-1" /> Check In
                  </Button>
                </div>
              )}

              {!formOpen && (
                <Button size="sm" variant={roomFreeToday ? 'default' : 'outline'} className="w-full"
                  onClick={() => { setForm(emptyForm(roomFreeToday ? today : addDays(today, 1), roomFreeToday ? addDays(today, 1) : addDays(today, 2), roomFreeToday)); setFormOpen(true); }}>
                  <Plus size={14} className="mr-1" /> New booking{!roomFreeToday ? ' for a later stay' : ''}
                </Button>
              )}

              {formOpen && (
                <div className="rounded-lg border p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">New booking</p>
                    <button type="button" className="text-gray-400 hover:text-gray-600" onClick={() => setFormOpen(false)}><X size={16} /></button>
                  </div>

                  {form.nature_of_duty === 'hra' ? (
                    <div>
                      <Label className="text-xs">Move-in date</Label>
                      <Input type="date" value={form.check_in} min={today} onChange={e => setForm({ ...form, check_in: e.target.value, check_out: addDays(e.target.value, 1) })} />
                      <p className="text-xs text-gray-500 mt-1">Ongoing residency — renews automatically each time a mess bill is generated for this member, no fixed checkout needed.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <div><Label className="text-xs">Check In</Label><Input type="date" value={form.check_in} min={today} onChange={e => setForm({ ...form, check_in: e.target.value, check_out: form.check_out > e.target.value ? form.check_out : addDays(e.target.value, 1) })} /></div>
                      <div><Label className="text-xs">Check Out</Label><Input type="date" value={form.check_out} min={addDays(form.check_in, 1)} onChange={e => setForm({ ...form, check_out: e.target.value })} /></div>
                    </div>
                  )}
                  <label className={`text-xs flex items-center gap-1.5 ${form.check_in === today && roomFreeToday ? 'text-gray-700 dark:text-gray-200' : 'text-gray-400'}`}>
                    <input type="checkbox" checked={effectiveCheckInNow} disabled={!(form.check_in === today && roomFreeToday)}
                      onChange={e => setForm({ ...form, check_in_now: e.target.checked })} />
                    Check in now (walk-in)
                  </label>

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
                      <Label className="text-xs">Nature of Duty</Label>
                      <select className={selectClass} value={form.nature_of_duty} onChange={e => setForm({ ...form, nature_of_duty: e.target.value })}>
                        <option value="visit">Visit</option>
                        <option value="leave">Leave</option>
                        {isOfficer && <option value="official_duty">Official Duty</option>}
                        {isOfficer && <option value="hra">HRA (monthly resident)</option>}
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
                    {form.nature_of_duty === 'official_duty' && (
                      <div>
                        <Label className="text-xs">DA Entitlement</Label>
                        <select className={selectClass} value={form.da_multiplier} onChange={e => setForm({ ...form, da_multiplier: e.target.value })}>
                          <option value="1.5">1½ DA</option>
                          <option value="1">1 DA</option>
                        </select>
                      </div>
                    )}
                    <div>
                      <Label className="text-xs">Extra Mattresses</Label>
                      <Input type="number" min={0} max={10} value={form.mattress_count} onChange={e => setForm({ ...form, mattress_count: Math.max(0, Number(e.target.value) || 0) })} />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Input placeholder="Guest name *" value={form.guest_name} onChange={e => setForm({ ...form, guest_name: e.target.value })} />
                    <Input placeholder="Phone" value={form.guest_phone} onChange={e => setForm({ ...form, guest_phone: e.target.value })} />
                    {isOfficer && <Input placeholder="PA No" value={form.pa_number} onChange={e => setForm({ ...form, pa_number: e.target.value })} />}
                    <div className="flex gap-1.5">
                      <select className={`${selectClass} w-24`} value={form.guest_id_type} onChange={e => setForm({ ...form, guest_id_type: e.target.value })}>
                        <option value="cnic">CNIC</option>
                        <option value="svc_no">Svc No</option>
                        <option value="passport">Passport</option>
                      </select>
                      <Input placeholder="ID number" value={form.guest_id_number} onChange={e => setForm({ ...form, guest_id_number: e.target.value })} />
                    </div>
                    <Input className="col-span-2" placeholder="Unit / Address" value={form.unit_address} onChange={e => setForm({ ...form, unit_address: e.target.value })} />
                    <select className={`${selectClass} col-span-2 ${form.nature_of_duty === 'hra' && !form.member_id ? 'border-red-400' : ''}`} value={form.member_id} onChange={e => setForm({ ...form, member_id: Number(e.target.value) })}>
                      <option value="0">{form.nature_of_duty === 'hra' ? 'Select member (required for HRA)' : 'Link to member (optional)'}</option>
                      {members.map(m => <option key={m.id} value={m.id}>{m.full_name} ({m.service_number})</option>)}
                    </select>
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
                    <Button size="sm" onClick={handleSubmitBooking} disabled={saving || (quote ? quote.available === false : false) || (form.nature_of_duty === 'hra' && !form.member_id)}>
                      {effectiveCheckInNow ? <><LogIn size={14} className="mr-1" /> Book & Check In</> : 'Confirm'}
                    </Button>
                  </div>
                </div>
              )}

              {/* Calendar */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <Button size="sm" variant="ghost" onClick={() => setYm(({ year, month }) => month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 })}><ChevronLeft size={16} /></Button>
                  <p className="text-sm font-medium">{monthName}</p>
                  <Button size="sm" variant="ghost" onClick={() => setYm(({ year, month }) => month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 })}><ChevronRight size={16} /></Button>
                </div>
                <div className="grid grid-cols-7 gap-0.5 text-center">
                  {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => <div key={d} className="text-[11px] text-gray-400 py-1">{d}</div>)}
                  {Array.from({ length: firstDow }).map((_, i) => <div key={`b${i}`} />)}
                  {Array.from({ length: daysInMonth }).map((_, i) => {
                    const day = i + 1;
                    const iso = `${ym.year}-${pad(ym.month)}-${pad(day)}`;
                    const stay = stayFor(day);
                    return (
                      <button type="button" key={day}
                        onClick={() => handleDayClick(iso)}
                        className={`text-xs rounded py-1.5 ${stay ? stayColor(stay) + ' font-medium' : ''} ${iso === today ? 'ring-1 ring-gray-500' : ''} ${formOpen && !stay ? 'hover:bg-blue-50 dark:hover:bg-blue-950' : ''}`}>
                        {day}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-gray-500 min-h-4 mt-1.5">
                  {selectedDay
                    ? (() => {
                      const s = stayFor(Number(selectedDay.split('-')[2]));
                      return s ? `${s.guest_name} · ${s.status.replace(/_/g, ' ')} · ${fmtDay(s.check_in)}–${fmtDay(s.check_out)} (${s.booking_reference})` : formOpen ? `${fmtDay(selectedDay)} · set as check-in` : `${fmtDay(selectedDay)} · free`;
                    })()
                    : formOpen ? 'Tap a free day to set it as check-in' : 'Tap a day to see its booking'}
                </p>
                <div className="flex gap-3 text-[11px] text-gray-500 mt-1">
                  <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-200 align-middle mr-1" />In-house</span>
                  <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-blue-200 align-middle mr-1" />Reserved</span>
                  <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-gray-200 align-middle mr-1" />Past stay</span>
                </div>
              </div>

              {upcoming.length > 0 && (
                <div>
                  <p className="text-xs text-gray-400 mb-1">Upcoming</p>
                  {upcoming.map(s => (
                    <div key={s.id} className="flex justify-between text-sm border rounded-md px-2.5 py-1.5 mb-1">
                      <span>{s.guest_name} <span className="text-gray-400 text-xs">{s.booking_reference}</span></span>
                      <span className="text-blue-700 dark:text-blue-300">{fmtDay(s.check_in)}–{fmtDay(s.check_out)}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Housekeeping / maintenance */}
              <div className="border-t pt-3 flex flex-wrap gap-2">
                {room.housekeeping_status === 'dirty' && (
                  <Button size="sm" variant="outline" onClick={() => act(() => api.put(`/bookings/rooms/${room.id}/housekeeping`, { status: 'cleaning' }), 'Cleaning started')}>
                    <Sparkles size={14} className="mr-1" /> Start Cleaning
                  </Button>
                )}
                {room.housekeeping_status === 'cleaning' && (
                  <Button size="sm" variant="outline" onClick={() => act(() => api.put(`/bookings/rooms/${room.id}/housekeeping`, { status: 'clean' }), 'Room marked clean')}>
                    <Sparkles size={14} className="mr-1" /> Mark Clean
                  </Button>
                )}
                {room.housekeeping_status === 'clean' && !current && (
                  <Button size="sm" variant="outline" onClick={() => act(() => api.put(`/bookings/rooms/${room.id}/housekeeping`, { status: 'dirty' }), 'Room marked dirty')}>
                    Mark Dirty
                  </Button>
                )}
                {room.status !== 'maintenance' ? (
                  <Button size="sm" variant="outline" onClick={() => act(() => api.put(`/bookings/rooms/${room.id}`, { status: 'maintenance' }), 'Room locked for maintenance')}>
                    <Wrench size={14} className="mr-1" /> Maintenance
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => act(() => api.put(`/bookings/rooms/${room.id}`, { status: 'vacant' }), 'Room back in service')}>
                    <Wrench size={14} className="mr-1" /> End Maintenance
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
