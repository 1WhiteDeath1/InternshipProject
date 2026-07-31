import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { toast } from 'sonner';
import { Sparkles, Wrench } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import {
  todayISO, addDays,
  type CalendarData, type AvailableRoom, type MemberOption, type AttendantOption,
} from './shared';
import { RoomDrawerHeader } from './RoomDrawerHeader';
import { RoomOverviewGateways } from './RoomOverviewGateways';
import { RoomOccupantCard } from './RoomOccupantCard';
import { RoomBookingForm } from './RoomBookingForm';
import { RoomMaintenanceDialog } from './RoomMaintenanceDialog';
import { RoomCalendarMini } from './RoomCalendarMini';
import { ConfirmDialog, type ConfirmRequest } from '@/components/ConfirmDialog';

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

const emptyForm = (checkIn: string, checkOut: string, checkInNow: boolean, attendantId = '') => ({
  guest_name: '', guest_phone: '', rank: '', pa_number: '', unit_address: '',
  reference_person: '',
  guest_id_type: 'cnic', guest_id_number: '', client_category: 'serving_officer',
  nature_of_duty: 'visit', da_multiplier: '1.5', mattress_count: 0,
  adults: 1, children: 0,
  member_id: 0, special_requests: '',
  source: 'walk_in', online_voucher_no: '',
  advance_payment_amount: '', advance_paid_at: todayISO(),
  check_in: checkIn, check_out: checkOut, check_in_now: checkInNow,
  attendant_id: attendantId, stay_type: '', is_indefinite: false,
});

export type BookingFormState = ReturnType<typeof emptyForm>;

interface GuestSuggestion {
  id: number; full_name: string; phone: string | null;
  id_type: string | null; id_number: string | null; unit_address: string | null;
  last_client_category: string | null; last_rank: string | null;
  last_nature_of_duty: string | null; last_stay_type: string | null;
}

interface TransferOption {
  id: number;
  room_number: string;
  room_type: string;
  pricing: { total: number; nightly_total: number };
}

type DrawerView = 'overview' | 'booking' | 'maintenance';

export default function RoomSection({ roomId, open, onClose, onChanged, members, initialBooking }: RoomSectionProps) {
  const navigate = useNavigate();
  const now = new Date();
  const [ym, setYm] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const [data, setData] = useState<CalendarData | null>(null);
  const [view, setView] = useState<DrawerView>('overview');
  const [form, setForm] = useState<BookingFormState>(() => emptyForm(todayISO(), addDays(todayISO(), 1), false));
  const [quote, setQuote] = useState<AvailableRoom | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [maintenanceSaving, setMaintenanceSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [extendOpen, setExtendOpen] = useState(false);
  const [extendDate, setExtendDate] = useState('');
  const [extending, setExtending] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [transferOptions, setTransferOptions] = useState<TransferOption[] | null>(null);
  const [guestSuggestions, setGuestSuggestions] = useState<GuestSuggestion[]>([]);
  const [attendants, setAttendants] = useState<AttendantOption[]>([]);
  const [arrivalAttendantId, setArrivalAttendantId] = useState('');
  const [roomChargesTotal, setRoomChargesTotal] = useState(0);

  const firstBookingFieldRef = useRef<HTMLButtonElement>(null);
  const issueFieldRef = useRef<HTMLInputElement>(null);

  const today = todayISO();

  const loadInitial = useCallback(async () => {
    if (!roomId) return;
    try {
      const res = await api.get(`/bookings/rooms/${roomId}/calendar?year=${ym.year}&month=${ym.month}`);
      const d: CalendarData = res.data;
      setData(d);

      const arrivalToday = d.stays.find(s => s.status === 'confirmed' && s.check_in <= today && today < s.check_out);
      const roomFreeToday = !d.current_booking && !arrivalToday;
      setArrivalAttendantId(d.room.attendant_id ? String(d.room.attendant_id) : '');
      // A room switch always starts fresh - an extend-in-progress from the
      // previous room must not leak into this one (most visibly wrong for an
      // HRA room, whose action row doesn't branch on extendOpen at all).
      setExtendOpen(false);
      setTransferOptions(null);

      // Always land on the overview gateways first - booking is a deliberate
      // next step via the "Book / Check-In Room" gateway, not something that
      // happens automatically on open. initialBooking (e.g. a future-mode
      // date search) still seeds the dates the gateway will use, it just no
      // longer force-opens the form.
      const defaultAttendantId = d.room.attendant_id ? String(d.room.attendant_id) : '';
      if (initialBooking) {
        setForm(emptyForm(initialBooking.check_in, initialBooking.check_out, !!initialBooking.check_in_now, defaultAttendantId));
      } else {
        const startDate = roomFreeToday ? today : addDays(today, 1);
        setForm(emptyForm(startDate, addDays(startDate, 1), roomFreeToday, defaultAttendantId));
      }
      setView('overview');
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

  useEffect(() => { queueMicrotask(() => {
    api.get('/attendants').then(res => setAttendants(res.data.filter((a: AttendantOption) => a.is_active))).catch(() => {});
  }); }, []);
  useEffect(() => { if (open && roomId) queueMicrotask(() => loadInitial()); }, [open, roomId, loadInitial]);
  useEffect(() => { if (open && roomId) queueMicrotask(() => reloadCalendar()); }, [ym, open, roomId, reloadCalendar]);
  // Always land on the current month when a (possibly different) room's
  // panel opens - otherwise the calendar keeps showing whatever month was
  // last navigated to for the previous room.
  useEffect(() => {
    if (!open || !roomId) return;
    queueMicrotask(() => {
      const n = new Date();
      setYm({ year: n.getFullYear(), month: n.getMonth() + 1 });
    });
  }, [open, roomId]);

  // Keyboard focus follows the view: a clerk who clicks a gateway (or the
  // keyboard equivalent) should land straight in the new screen's first
  // field, not fall through to whatever was previously focused.
  useEffect(() => {
    if (view === 'booking') queueMicrotask(() => firstBookingFieldRef.current?.focus());
    else if (view === 'maintenance') queueMicrotask(() => issueFieldRef.current?.focus());
  }, [view]);

  const datesValid = form.check_in && form.check_out && form.check_out > form.check_in;

  const fetchQuote = useCallback(async () => {
    if (!roomId || view !== 'booking' || !datesValid) { setQuote(null); return; }
    setQuoteLoading(true);
    try {
      const params = new URLSearchParams({
        check_in: form.check_in, check_out: form.check_out, room_id: String(roomId),
        client_category: form.client_category, nature_of_duty: form.nature_of_duty,
        rank: form.rank, da_multiplier: form.nature_of_duty === 'official_duty' ? form.da_multiplier : '0',
        mattress_count: String(form.mattress_count), member_id: String(form.member_id || 0),
        stay_type: form.stay_type,
      });
      const res = await api.get(`/bookings/availability?${params.toString()}`);
      setQuote(res.data.items[0] || null);
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to price this stay')); }
    finally { setQuoteLoading(false); }
  }, [roomId, view, datesValid, form.check_in, form.check_out, form.client_category, form.nature_of_duty, form.rank, form.da_multiplier, form.mattress_count, form.member_id, form.stay_type]);

  useEffect(() => { if (view === 'booking') queueMicrotask(() => fetchQuote()); }, [view, fetchQuote]);

  // Search-as-you-type guest lookup - recognizes a returning visitor by name
  // or ID number so the desk doesn't retype details already on file.
  useEffect(() => {
    if (view !== 'booking') { queueMicrotask(() => setGuestSuggestions([])); return; }
    const q = (form.guest_id_number.trim().length >= 2 ? form.guest_id_number : form.guest_name).trim();
    if (q.length < 2) { queueMicrotask(() => setGuestSuggestions([])); return; }
    const t = setTimeout(async () => {
      try {
        const res = await api.get(`/guests/search?q=${encodeURIComponent(q)}`);
        setGuestSuggestions(res.data);
      } catch { /* non-critical - search failures shouldn't block manual entry */ }
    }, 300);
    return () => clearTimeout(t);
  }, [form.guest_name, form.guest_id_number, view]);

  const selectGuestSuggestion = (g: GuestSuggestion) => {
    setForm(f => ({
      ...f, guest_name: g.full_name, guest_phone: g.phone || f.guest_phone,
      guest_id_type: g.id_type || f.guest_id_type, guest_id_number: g.id_number || f.guest_id_number,
      unit_address: g.unit_address || f.unit_address,
      // Prefilled from this guest's last stay, when known - nature_of_duty
      // is only carried over for non-HRA stays (HRA needs a member link the
      // guest search can't supply, see backend/routers/guests.py).
      client_category: g.last_client_category || f.client_category,
      rank: g.last_rank || f.rank,
      nature_of_duty: g.last_nature_of_duty || f.nature_of_duty,
      stay_type: g.last_stay_type || f.stay_type,
    }));
    setGuestSuggestions([]);
  };

  const room = data?.room;
  const current = data?.current_booking;
  const arrivalToday = data?.stays.find(s => s.status === 'confirmed' && s.check_in <= today && today < s.check_out);
  const roomFreeToday = !current && !arrivalToday;
  const roomReady = !!room && room.status !== 'maintenance' && (room.housekeeping_status || 'clean') === 'clean';
  const effectiveCheckInNow = form.check_in_now && form.check_in === today && roomFreeToday && roomReady;

  const act = async (fn: () => Promise<unknown>, okMsg: string) => {
    try { await fn(); toast.success(okMsg); await reloadCalendar(); onChanged(); }
    catch (err) { toast.error(getErrorMessage(err, 'Failed')); }
  };

  const openExtend = () => {
    if (!current) return;
    setExtendDate(addDays(current.check_out > today ? current.check_out : today, 1));
    setTransferOptions(null);
    setExtendOpen(true);
  };

  // Move the guest to a different room without touching their dates - reuses
  // the same /extend endpoint's transfer_room_id path (it already accepts a
  // same-date transfer), just pre-filled with the current checkout instead
  // of requiring a failed date-extend first.
  const openChangeRoom = async () => {
    if (!current) return;
    setExtendDate(current.check_out);
    setTransferOptions(null);
    setExtendOpen(true);
    try {
      const avail = await api.get(`/bookings/availability?check_in=${today}&check_out=${current.check_out}`);
      setTransferOptions((avail.data.items as (TransferOption & { id: number })[]).filter(r => r.id !== roomId));
    } catch { setTransferOptions([]); }
  };

  const handleExtend = async (transferRoomId?: number) => {
    if (!current || !extendDate) return;
    setExtending(true);
    try {
      const res = await api.post(`/bookings/${current.id}/extend`, {
        new_check_out: extendDate,
        ...(transferRoomId ? { transfer_room_id: transferRoomId } : {}),
      });
      toast.success(res.data.message);
      setExtendOpen(false);
      setTransferOptions(null);
      await reloadCalendar();
      onChanged();
      if (res.data.transferred) onClose(); // guest is now in a different room - this panel is stale
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 409 && !transferRoomId) {
        // Scenario B: same-room extension blocked - offer a transfer instead.
        toast.warning(getErrorMessage(err, 'Room is reserved for those dates'));
        try {
          const avail = await api.get(`/bookings/availability?check_in=${today}&check_out=${extendDate}`);
          setTransferOptions((avail.data.items as (TransferOption & { id: number })[]).filter(r => r.id !== roomId));
        } catch { setTransferOptions([]); }
      } else {
        toast.error(getErrorMessage(err, 'Failed to extend stay'));
      }
    } finally { setExtending(false); }
  };

  const handleSubmitBooking = async () => {
    if (!roomId) return;
    if (!form.guest_name.trim()) { toast.error('Guest name is required'); return; }
    if (!datesValid) { toast.error('Check-out must be after check-in'); return; }
    if (form.nature_of_duty === 'hra' && !form.member_id) { toast.error('HRA residency must be linked to a member'); return; }
    if (form.source === 'online' && !form.online_voucher_no.trim()) { toast.error('Online bookings need the portal voucher number (Online V/No)'); return; }
    if (form.source === 'online' && !(Number(form.advance_payment_amount) > 0)) { toast.error('Online bookings are paid in full in advance — enter the amount received'); return; }
    if (form.source === 'online' && !form.advance_paid_at) { toast.error('Enter the date the advance was actually received'); return; }
    if (form.client_category === 'civilian' && !form.reference_person.trim()) { toast.error('Civilian guests require a reference person (C/O)'); return; }
    if (effectiveCheckInNow && !form.attendant_id) { toast.error('Select a room attendant before checking in'); return; }
    const guestTotal = Math.max(1, Number(form.adults) || 1) + Math.max(0, Number(form.children) || 0);
    if (room?.capacity && guestTotal > room.capacity) {
      toast.error(`Room ${room.room_number} accommodates at most ${room.capacity} guest(s) — this booking has ${guestTotal}`);
      return;
    }
    setSaving(true);
    try {
      const res = await api.post('/bookings', {
        guest_name: form.guest_name, guest_phone: form.guest_phone || null,
        guest_id_type: form.guest_id_type, guest_id_number: form.guest_id_number || null,
        room_id: roomId, check_in: form.check_in, check_out: form.check_out,
        client_category: form.client_category, member_id: form.member_id || null,
        rank: form.rank || null, pa_number: form.pa_number || null,
        unit_address: form.unit_address || null, nature_of_duty: form.nature_of_duty,
        reference_person: form.reference_person.trim() || null,
        da_multiplier: form.nature_of_duty === 'official_duty' ? Number(form.da_multiplier) : null,
        mattress_count: form.mattress_count, special_requests: form.special_requests || null,
        adults: Math.max(1, Number(form.adults) || 1), children: Math.max(0, Number(form.children) || 0),
        source: form.source, online_voucher_no: form.source === 'online' ? form.online_voucher_no.trim() : null,
        advance_payment_amount: form.source === 'online' ? Number(form.advance_payment_amount) : null,
        advance_paid_at: form.source === 'online' ? form.advance_paid_at : null,
        check_in_now: effectiveCheckInNow,
        attendant_id: form.attendant_id ? Number(form.attendant_id) : null,
        stay_type: form.stay_type || null,
        is_indefinite: form.is_indefinite,
      });
      const p = res.data.pricing;
      const amountText = p.pricing_mode === 'hra_monthly' ? `${formatCurrency(res.data.total_amount)}/month (HRA)` : formatCurrency(res.data.total_amount);
      const checkedIn = effectiveCheckInNow && res.data.status === 'checked_in';
      toast.success(`${res.data.booking_reference} — ${amountText}${checkedIn ? ' — guest checked in' : ''}`);
      if (res.data.warning) toast.warning(res.data.warning);
      if (res.data.sms_status) {
        toast.info(res.data.sms_status === 'sent'
          ? `Confirmation SMS sent to ${form.guest_phone}`
          : `Confirmation SMS queued for ${form.guest_phone} — send it from the Bookings dashboard outbox`);
      }
      setView('overview');
      await reloadCalendar();
      onChanged();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to create booking')); }
    finally { setSaving(false); }
  };

  const handleSaveMaintenance = async (notes: string, maintenanceUntil: string) => {
    if (!room) return;
    setMaintenanceSaving(true);
    try {
      await api.put(`/bookings/rooms/${room.id}`, {
        status: 'maintenance', notes: notes.trim() || null, maintenance_until: maintenanceUntil || null,
      });
      toast.success('Room locked for maintenance');
      setView('overview');
      await reloadCalendar();
      onChanged();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to update room')); }
    finally { setMaintenanceSaving(false); }
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

  const sendToClerkDesk = () => { setExtendOpen(false); setTransferOptions(null); navigate('/clerk-desk'); };

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        {room && (
          <div className="space-y-4 mt-2 px-1">
            <RoomDrawerHeader room={room} current={current ?? null} uploading={uploading}
              onUploadPhoto={handleUploadPhoto} onDeletePhoto={handleDeletePhoto} />

            {/* Prominent, hard-to-miss blockers - a guest cannot be checked in until these are cleared */}
            {room.status === 'maintenance' && (
              <div className="rounded-lg border-2 border-gray-400 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 p-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-gray-700 dark:text-gray-200 min-w-0">
                  <Wrench size={20} className="shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">Room under maintenance</p>
                    <p className="text-xs">{room.notes ? room.notes : 'Check-in is blocked until maintenance ends.'}{room.maintenance_until ? ` · Est. back ${room.maintenance_until}` : ''}</p>
                  </div>
                </div>
                <Button size="sm" className="bg-gray-700 hover:bg-gray-800 text-white shrink-0"
                  onClick={() => act(() => api.put(`/bookings/rooms/${room.id}`, { status: 'vacant' }), 'Room back in service')}>
                  End Maintenance
                </Button>
              </div>
            )}
            {room.status !== 'maintenance' && room.housekeeping_status !== 'clean' && (
              <div className="rounded-lg border-2 border-amber-400 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 p-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200 min-w-0">
                  <Sparkles size={20} className="shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">Room needs cleaning</p>
                    <p className="text-xs">Check-in is blocked until this room is marked clean.</p>
                  </div>
                </div>
                {room.housekeeping_status === 'dirty' && (
                  <Button size="sm" className="bg-amber-600 hover:bg-amber-700 text-white shrink-0"
                    onClick={() => act(() => api.put(`/bookings/rooms/${room.id}/housekeeping`, { status: 'cleaning' }), 'Cleaning started')}>
                    Start Cleaning
                  </Button>
                )}
                {room.housekeeping_status === 'cleaning' && (
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white shrink-0"
                    onClick={() => act(() => api.put(`/bookings/rooms/${room.id}/housekeeping`, { status: 'clean' }), 'Room marked clean')}>
                    Mark Clean
                  </Button>
                )}
              </div>
            )}

            {view !== 'maintenance' && (current || arrivalToday) && (
              <RoomOccupantCard
                current={current ?? null} arrivalToday={arrivalToday} roomReady={roomReady} today={today}
                roomChargesTotal={roomChargesTotal} onTotalsChange={setRoomChargesTotal}
                extendOpen={extendOpen} extendDate={extendDate} extending={extending} transferOptions={transferOptions}
                onOpenExtend={openExtend} onOpenChangeRoom={openChangeRoom}
                onCloseExtend={() => { setExtendOpen(false); setTransferOptions(null); }}
                onExtendDateChange={d => { setExtendDate(d); setTransferOptions(null); }}
                onExtend={handleExtend}
                onEndResidency={() => current && setConfirm({
                  title: `End ${current.guest_name}'s residency?`,
                  description: `Room ${room.room_number} will be freed and sent to housekeeping. The final month's charges settle via the monthly Mess Bill.`,
                  confirmLabel: 'End Residency', destructive: true,
                  onConfirm: () => act(() => api.post(`/bookings/${current.id}/end-residency`), 'Residency ended — room sent to housekeeping queue'),
                })}
                onSendToClerkDesk={sendToClerkDesk}
                attendants={attendants} arrivalAttendantId={arrivalAttendantId} onArrivalAttendantChange={setArrivalAttendantId}
                onCheckInArrival={() => arrivalToday && act(() => api.post(`/bookings/${arrivalToday.id}/check-in?attendant_id=${arrivalAttendantId}`), `${arrivalToday.guest_name} checked in`)}
                reloadCalendar={reloadCalendar} onChanged={onChanged}
              />
            )}

            {view === 'overview' && (
              <RoomOverviewGateways room={room} current={current ?? null} roomFreeToday={roomFreeToday}
                onBook={() => setView('booking')}
                onMarkDirty={() => act(() => api.put(`/bookings/rooms/${room.id}/housekeeping`, { status: 'dirty' }), 'Room marked dirty')}
                onOpenMaintenance={() => setView('maintenance')} />
            )}

            {view === 'booking' && (
              <RoomBookingForm
                form={form} setForm={setForm} room={room} roomFreeToday={roomFreeToday} roomReady={roomReady}
                today={today} effectiveCheckInNow={effectiveCheckInNow} quote={quote} quoteLoading={quoteLoading}
                guestSuggestions={guestSuggestions} onSelectGuestSuggestion={selectGuestSuggestion}
                onClearGuestSuggestions={() => setGuestSuggestions([])}
                attendants={attendants} members={members} saving={saving}
                onSubmit={handleSubmitBooking} onCancel={() => setView('overview')}
                firstFieldRef={firstBookingFieldRef}
              />
            )}

            {view === 'maintenance' && (
              <RoomMaintenanceDialog room={room} saving={maintenanceSaving}
                onSave={handleSaveMaintenance} onCancel={() => setView('overview')}
                issueFieldRef={issueFieldRef} />
            )}

            {view !== 'maintenance' && (
              <RoomCalendarMini key={roomId} data={data ?? null} ym={ym} setYm={setYm} today={today}
                formOpen={view === 'booking'} form={form} setForm={setForm} />
            )}
          </div>
        )}
      </SheetContent>

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </Sheet>
  );
}
