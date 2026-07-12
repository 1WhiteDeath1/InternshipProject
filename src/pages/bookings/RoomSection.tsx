import { useCallback, useEffect, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  LogIn, LogOut, Sparkles, Wrench, ChevronLeft, ChevronRight, Plus,
  ImagePlus, X, Camera, CalendarPlus,
} from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import { CheckoutSheet } from '@/components/CheckoutSheet';
import { ConfirmDialog, type ConfirmRequest } from '@/components/ConfirmDialog';
import {
  ROOM_TYPE_LABELS, RANKS, todayISO, addDays, fmtDay, selectClass,
  type CalendarData, type CalendarStay, type AvailableRoom, type MemberOption,
} from './shared';
import { RoomStatusPill, HousekeepingBadge, HraBadge } from './badges';

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
  reference_person: '',
  guest_id_type: 'cnic', guest_id_number: '', client_category: 'serving_officer',
  nature_of_duty: 'visit', da_multiplier: '1.5', mattress_count: 0,
  adults: 1, children: 0,
  member_id: 0, special_requests: '',
  source: 'walk_in', online_voucher_no: '',
  check_in: checkIn, check_out: checkOut, check_in_now: checkInNow,
});

interface GuestSuggestion {
  id: number; full_name: string; phone: string | null;
  id_type: string | null; id_number: string | null; unit_address: string | null;
}

interface TransferOption {
  id: number;
  room_number: string;
  room_type: string;
  pricing: { total: number; nightly_total: number };
}

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
  const [extendOpen, setExtendOpen] = useState(false);
  const [extendDate, setExtendDate] = useState('');
  const [extending, setExtending] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [transferOptions, setTransferOptions] = useState<TransferOption[] | null>(null);
  const [guestSuggestions, setGuestSuggestions] = useState<GuestSuggestion[]>([]);
  // Click-and-drag date-range selection on the mini calendar: dragAnchor is
  // where the pointer went down, dragHover tracks the day currently under
  // the pointer (clamped so the live-highlighted range never crosses an
  // occupied/reserved day or a past date).
  const [dragAnchor, setDragAnchor] = useState<string | null>(null);
  const [dragHover, setDragHover] = useState<string | null>(null);

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

      // Always land on Room Details first - booking is a deliberate next step via
      // the "Book This Room" button, not something that happens automatically on
      // open. initialBooking (e.g. a future-mode date search) still seeds the
      // dates the button will use, it just no longer force-opens the form.
      if (initialBooking) {
        setForm(emptyForm(initialBooking.check_in, initialBooking.check_out, !!initialBooking.check_in_now));
      } else {
        const startDate = roomFreeToday ? today : addDays(today, 1);
        setForm(emptyForm(startDate, addDays(startDate, 1), roomFreeToday));
      }
      setFormOpen(false);
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
  // Always land on the current month when a (possibly different) room's
  // panel opens - otherwise the calendar keeps showing whatever month was
  // last navigated to for the previous room.
  useEffect(() => {
    if (!open || !roomId) return;
    queueMicrotask(() => {
      const now = new Date();
      setYm({ year: now.getFullYear(), month: now.getMonth() + 1 });
      setSelectedDay(null);
      setDragAnchor(null);
      setDragHover(null);
    });
  }, [open, roomId]);

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

  // Search-as-you-type guest lookup - recognizes a returning visitor by name
  // or ID number so the desk doesn't retype details already on file.
  useEffect(() => {
    if (!formOpen) { queueMicrotask(() => setGuestSuggestions([])); return; }
    const q = (form.guest_id_number.trim().length >= 2 ? form.guest_id_number : form.guest_name).trim();
    if (q.length < 2) { queueMicrotask(() => setGuestSuggestions([])); return; }
    const t = setTimeout(async () => {
      try {
        const res = await api.get(`/guests/search?q=${encodeURIComponent(q)}`);
        setGuestSuggestions(res.data);
      } catch { /* non-critical - search failures shouldn't block manual entry */ }
    }, 300);
    return () => clearTimeout(t);
  }, [form.guest_name, form.guest_id_number, formOpen]);

  const selectGuestSuggestion = (g: GuestSuggestion) => {
    setForm(f => ({
      ...f, guest_name: g.full_name, guest_phone: g.phone || f.guest_phone,
      guest_id_type: g.id_type || f.guest_id_type, guest_id_number: g.id_number || f.guest_id_number,
      unit_address: g.unit_address || f.unit_address,
    }));
    setGuestSuggestions([]);
  };

  const room = data?.room;
  const current = data?.current_booking;
  const arrivalToday = data?.stays.find(s => s.status === 'confirmed' && s.check_in <= today && today < s.check_out);
  const upcoming = data?.stays.filter(s => s.status === 'confirmed' && s.check_in > today) || [];
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
    if (form.client_category === 'civilian' && !form.reference_person.trim()) { toast.error('Civilian guests require a reference person (C/O)'); return; }
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
        check_in_now: effectiveCheckInNow,
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
  const stayForIso = (iso: string): CalendarStay | undefined =>
    data?.stays
      .filter(s => s.check_in <= iso && iso < s.check_out)
      .sort((a, b) => (STAY_PRIORITY[b.status] || 0) - (STAY_PRIORITY[a.status] || 0))[0];
  const stayFor = (day: number) => stayForIso(`${ym.year}-${pad(ym.month)}-${pad(day)}`);
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

  // --- Drag-to-select a date range on the calendar ---
  // A day can anchor a drag when the booking form is open, it's a dated stay
  // (not HRA - HRA only has a single move-in date), it's today or later, and
  // it isn't already covered by an existing stay.
  const isDraggableDay = (iso: string) => formOpen && form.nature_of_duty !== 'hra' && iso >= today && !stayForIso(iso);

  const startDrag = (iso: string, e: React.PointerEvent<HTMLButtonElement>) => {
    if (!isDraggableDay(iso)) return;
    setDragAnchor(iso);
    setDragHover(iso);
    setSelectedDay(null);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* unsupported for this pointer type - drag still works via document.elementFromPoint */ }
  };

  // Walks day-by-day from the anchor toward `candidate`, stopping at the last
  // free day before hitting a past date or an existing stay - so the live
  // preview can never span across a booked day.
  const furthestFreeDay = (anchor: string, candidate: string): string => {
    if (candidate === anchor) return anchor;
    const dir = candidate < anchor ? -1 : 1;
    let cursor = anchor;
    let result = anchor;
    while (cursor !== candidate) {
      cursor = addDays(cursor, dir);
      if (cursor < today || stayForIso(cursor)) break;
      result = cursor;
    }
    return result;
  };

  const moveDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragAnchor) return;
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const iso = el?.dataset.day;
    if (!iso) return;
    setDragHover(furthestFreeDay(dragAnchor, iso));
  };

  const endDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    // Releasing capture can throw if the browser already released it (common
    // for touch, or if the pointer left the window) - must never block the
    // selection from committing below.
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    if (!dragAnchor || !dragHover) { setDragAnchor(null); setDragHover(null); return; }
    const lo = dragHover < dragAnchor ? dragHover : dragAnchor;
    const hi = dragHover < dragAnchor ? dragAnchor : dragHover;
    setForm(f => ({
      ...f, check_in: lo, check_out: addDays(hi, 1),
      check_in_now: lo === today ? f.check_in_now : false,
    }));
    setDragAnchor(null);
    setDragHover(null);
  };

  const dragging = dragAnchor !== null && dragHover !== null;
  const dragLo = dragging ? (dragHover! < dragAnchor! ? dragHover! : dragAnchor!) : null;
  const dragHi = dragging ? (dragHover! < dragAnchor! ? dragAnchor! : dragHover!) : null;
  const dragNights = dragging ? Math.round((new Date(dragHi!).getTime() - new Date(dragLo!).getTime()) / 86400000) + 1 : 0;

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
                  <RoomStatusPill status={room.status} />
                  <HousekeepingBadge status={room.housekeeping_status} />
                </span>
              </SheetTitle>
            </SheetHeader>
            <div className="space-y-4 mt-2 px-1">
              {/* Prominent, hard-to-miss blockers - a guest cannot be checked in until these are cleared */}
              {room.status === 'maintenance' && (
                <div className="rounded-lg border-2 border-gray-400 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 p-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-gray-700 dark:text-gray-200 min-w-0">
                    <Wrench size={20} className="shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">Room under maintenance</p>
                      <p className="text-xs">Check-in is blocked until maintenance ends.</p>
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

              {/* Room Details - the "see details" half of the details-or-book choice */}
              <div className="rounded-lg border bg-gray-50 dark:bg-gray-900/40 p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold">Room Details</p>
                  <p className="text-lg font-bold text-gray-900 dark:text-white">{formatCurrency(room.base_price)}<span className="text-xs font-normal text-gray-400">/night</span></p>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                  <div><p className="text-xs text-gray-400">Type</p><p className="font-medium">{ROOM_TYPE_LABELS[room.room_type] || room.room_type}{room.room_type === 'suite' ? ` · ${room.ac_count || 1}×AC` : ''}</p></div>
                  <div><p className="text-xs text-gray-400">Capacity</p><p className="font-medium">{room.capacity} guests</p></div>
                  <div><p className="text-xs text-gray-400">Floor</p><p className="font-medium">{room.floor}</p></div>
                  <div><p className="text-xs text-gray-400">Housekeeping</p><p className="font-medium capitalize">{room.housekeeping_status || 'clean'}</p></div>
                </div>
              </div>

              {/* Customer profile & booking details */}
              {current && (
                <div className={`rounded-lg border p-3 ${current.checkout_due ? 'border-red-400 ring-1 ring-red-300' : ''}`}>
                  {current.checkout_due && (
                    <div className="mb-2 rounded-md bg-red-50 dark:bg-red-950 border border-red-300 px-2.5 py-1.5 text-xs font-semibold text-red-700 dark:text-red-300 animate-pulse">
                      Action Required: Extend or Checkout — scheduled departure was {fmtDay(current.check_out)}
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 mb-1">
                    <p className="text-xs text-gray-400">{current.nature_of_duty === 'hra' ? 'HRA resident' : 'Now staying'}</p>
                    {current.nature_of_duty === 'hra' && <HraBadge />}
                    {current.source === 'online' && <span className="text-[10px] font-medium text-blue-700 bg-blue-50 dark:bg-blue-950 dark:text-blue-300 rounded px-1 py-0.5">Online{current.online_voucher_no ? ` · V/No ${current.online_voucher_no}` : ''}</span>}
                  </div>
                  <p className="font-medium">{current.rank ? `${current.rank} ` : ''}{current.guest_name}</p>
                  <p className="text-xs text-gray-500">{current.booking_reference}{current.guest_phone ? ` · ${current.guest_phone}` : ''}</p>
                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-gray-600 dark:text-gray-300">
                    {current.client_category && <p><span className="text-gray-400">Category:</span> {current.client_category.replace(/_/g, ' ')}</p>}
                    {current.guest_id_number && <p><span className="text-gray-400">{(current.guest_id_type || 'ID').toUpperCase()}:</span> {current.guest_id_number}</p>}
                    {current.pa_number && <p><span className="text-gray-400">PA No:</span> {current.pa_number}</p>}
                    {current.unit_address && <p><span className="text-gray-400">Unit:</span> {current.unit_address}</p>}
                    {current.reference_person && <p className="col-span-2"><span className="text-gray-400">Reference:</span> {current.reference_person}</p>}
                    {current.mattress_count > 0 && <p><span className="text-gray-400">Mattresses:</span> {current.mattress_count}</p>}
                    {current.actual_check_in && <p className="col-span-2"><span className="text-gray-400">Checked in:</span> {new Date(current.actual_check_in).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>}
                    {current.special_requests && <p className="col-span-2"><span className="text-gray-400">Remarks:</span> {current.special_requests}</p>}
                  </div>
                  <div className="flex items-center justify-between mt-2 text-sm">
                    <span>{current.nature_of_duty === 'hra' ? `Resident since ${fmtDay(current.check_in)}` : `${fmtDay(current.check_in)} → ${fmtDay(current.check_out)}`}</span>
                    {current.nature_of_duty !== 'hra' && <span className="font-medium">{formatCurrency(current.total_amount)}</span>}
                  </div>
                  {current.nature_of_duty === 'hra' && <p className="text-xs text-gray-500 mt-0.5">Billed monthly via the mess bill, not a fixed total</p>}

                  {!extendOpen ? (
                    <div className="flex gap-2 mt-2">
                      {current.nature_of_duty !== 'hra' ? (
                        <>
                          <Button size="sm" variant={current.checkout_due ? 'default' : 'outline'} className="flex-1" onClick={openExtend}>
                            <CalendarPlus size={14} className="mr-1" /> Extend Stay
                          </Button>
                          <Button size="sm" variant={current.checkout_due ? 'destructive' : 'default'} className="flex-1" onClick={() => setCheckoutOpen(true)}>
                            <LogOut size={14} className="mr-1" /> Checkout & Bill
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" variant="outline" className="flex-1"
                          title="Ends the monthly residency - outstanding charges settle via the final Mess Bill"
                          onClick={() => setConfirm({
                            title: `End ${current.guest_name}'s residency?`,
                            description: `Room ${room.room_number} will be freed and sent to housekeeping. The final month's charges settle via the monthly Mess Bill.`,
                            confirmLabel: 'End Residency', destructive: true,
                            onConfirm: () => act(() => api.post(`/bookings/${current.id}/end-residency`), 'Residency ended — room sent to housekeeping queue'),
                          })}>
                          <LogOut size={14} className="mr-1" /> End Residency
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="mt-2 border-t pt-2 space-y-2">
                      <div className="flex items-end gap-2">
                        <div className="flex-1">
                          <Label className="text-xs">Extend checkout to</Label>
                          <Input type="date" value={extendDate} min={addDays(today, 1)} onChange={e => { setExtendDate(e.target.value); setTransferOptions(null); }} />
                        </div>
                        <Button size="sm" disabled={extending || !extendDate} onClick={() => handleExtend()}>
                          {extending ? 'Checking…' : 'Extend'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => { setExtendOpen(false); setTransferOptions(null); }}><X size={14} /></Button>
                      </div>
                      {transferOptions !== null && (
                        <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950 p-2 space-y-1.5">
                          <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
                            This room is reserved for those dates. Transfer {current.guest_name} to another room, or check them out.
                          </p>
                          {transferOptions.length === 0 && <p className="text-xs text-amber-700">No other rooms are free until {fmtDay(extendDate)} — a standard checkout is the only option.</p>}
                          {transferOptions.slice(0, 6).map(r => (
                            <button key={r.id} type="button" disabled={extending}
                              className="w-full flex items-center justify-between text-xs bg-white dark:bg-gray-900 border rounded px-2 py-1.5 hover:border-blue-400"
                              onClick={() => handleExtend(r.id)}>
                              <span className="font-medium">Room {r.room_number} <span className="text-gray-400 font-normal">{ROOM_TYPE_LABELS[r.room_type] || r.room_type}</span></span>
                              <span>{formatCurrency(r.pricing.total)} total</span>
                            </button>
                          ))}
                          <Button size="sm" variant="outline" className="w-full" onClick={() => { setExtendOpen(false); setTransferOptions(null); setCheckoutOpen(true); }}>
                            <LogOut size={14} className="mr-1" /> Checkout & Bill Instead
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
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
                  <Button size="sm" className="mt-2 w-full" disabled={!roomReady} title={roomReady ? undefined : 'Room must be marked clean first'}
                    onClick={() => act(() => api.post(`/bookings/${arrivalToday.id}/check-in`), `${arrivalToday.guest_name} checked in`)}>
                    <LogIn size={14} className="mr-1" /> {roomReady ? 'Check In' : 'Room Not Ready'}
                  </Button>
                </div>
              )}

              {!formOpen && (
                <Button size="sm" variant={roomFreeToday ? 'default' : 'outline'} className="w-full"
                  onClick={() => setFormOpen(true)}>
                  <Plus size={14} className="mr-1" /> {roomFreeToday ? 'Book This Room' : 'New Booking for a Later Stay'}
                </Button>
              )}

              {formOpen && (
                <div className="rounded-lg border-2 border-primary/20 shadow-sm p-4 space-y-3.5">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">New Booking</p>
                    <button type="button" className="text-gray-400 hover:text-gray-600" onClick={() => setFormOpen(false)}><X size={16} /></button>
                  </div>

                  <div className="flex rounded-md border overflow-hidden text-xs">
                    {([['walk_in', 'Walk-in / Desk'], ['online', 'Online Portal']] as const).map(([val, label]) => (
                      <button key={val} type="button"
                        className={`flex-1 py-1.5 ${form.source === val ? 'bg-primary text-primary-foreground font-medium' : 'bg-transparent text-gray-500 hover:text-gray-700'}`}
                        onClick={() => setForm({ ...form, source: val })}>
                        {label}
                      </button>
                    ))}
                  </div>
                  {form.source === 'online' && (
                    <Input placeholder="Online V/No *" value={form.online_voucher_no}
                      onChange={e => setForm({ ...form, online_voucher_no: e.target.value })} />
                  )}

                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Stay Dates</p>
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
                  <label className={`text-xs flex items-center gap-1.5 ${form.check_in === today && roomFreeToday && roomReady ? 'text-gray-700 dark:text-gray-200' : 'text-gray-400'}`}>
                    <input type="checkbox" checked={effectiveCheckInNow} disabled={!(form.check_in === today && roomFreeToday && roomReady)}
                      onChange={e => setForm({ ...form, check_in_now: e.target.checked })} />
                    Check in now (walk-in){form.check_in === today && roomFreeToday && !roomReady ? ' — room not ready' : ''}
                  </label>

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
                        onChange={e => setForm({ ...form, nature_of_duty: e.target.value === 'member' ? 'hra' : 'visit' })}>
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
                  </div>

                  <div className="pt-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Guest Details</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="relative">
                      <Input placeholder="Guest name *" value={form.guest_name}
                        onChange={e => setForm({ ...form, guest_name: e.target.value })}
                        onBlur={() => setTimeout(() => setGuestSuggestions([]), 150)} />
                      {guestSuggestions.length > 0 && (
                        <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto rounded-md border bg-white dark:bg-gray-900 shadow-lg text-sm">
                          {guestSuggestions.map(g => (
                            <button type="button" key={g.id}
                              className="block w-full text-left px-2 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-800"
                              onMouseDown={e => e.preventDefault()} onClick={() => selectGuestSuggestion(g)}>
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
                        <Input type="number" min={1} value={form.adults}
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
                    {/* Unit/Address is deliberately not asked at check-in (form kept
                        lean per the desk's request) - a returning guest's stored
                        address still flows in silently via selectGuestSuggestion so
                        the printed bill header stays populated. */}
                    <div className="col-span-2">
                      <Input placeholder={form.client_category === 'civilian' ? 'Reference Person (C/O) * — required for civilians' : 'Reference Person (C/O) — optional'}
                        className={form.client_category === 'civilian' && !form.reference_person.trim() ? 'border-red-400' : ''}
                        value={form.reference_person} onChange={e => setForm({ ...form, reference_person: e.target.value })} />
                    </div>
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
                    const draggable = isDraggableDay(iso);
                    const inDragRange = dragging && dragLo! <= iso && iso <= dragHi!;
                    const props = draggable
                      ? { onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => startDrag(iso, e), onPointerMove: moveDrag, onPointerUp: endDrag }
                      : { onClick: () => handleDayClick(iso) };
                    return (
                      <button type="button" key={day} data-day={iso} {...props}
                        className={`text-xs rounded py-1.5 select-none touch-none
                          ${inDragRange ? 'bg-blue-500 text-white font-semibold ring-2 ring-blue-700 dark:ring-blue-400'
                            : stay ? stayColor(stay) + ' font-medium' : ''}
                          ${iso === today ? 'ring-1 ring-gray-500' : ''}
                          ${draggable && !inDragRange ? 'hover:bg-blue-50 dark:hover:bg-blue-950 cursor-pointer' : ''}`}>
                        {day}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-gray-500 min-h-4 mt-1.5">
                  {dragging
                    ? <span className="text-blue-700 dark:text-blue-300 font-medium">{fmtDay(dragLo!)} → {fmtDay(dragHi!)} · {dragNights} night{dragNights > 1 ? 's' : ''}</span>
                    : selectedDay
                      ? (() => {
                        const s = stayFor(Number(selectedDay.split('-')[2]));
                        return s ? `${s.guest_name} · ${s.status.replace(/_/g, ' ')} · ${fmtDay(s.check_in)}–${fmtDay(s.check_out)} (${s.booking_reference})` : formOpen ? `${fmtDay(selectedDay)} · set as check-in` : `${fmtDay(selectedDay)} · free`;
                      })()
                      : formOpen && form.nature_of_duty !== 'hra' ? 'Click and drag across days to select your stay, or tap a single day'
                        : formOpen ? 'Tap the move-in day' : 'Tap a day to see its booking'}
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

              {/* Housekeeping / maintenance - the "resolve a blocker" actions live in the
                  banner above; this row is only for deliberately starting one. */}
              <div className="border-t pt-3 flex flex-wrap gap-2">
                {room.housekeeping_status === 'clean' && !current && (
                  <Button size="sm" variant="secondary" className="font-medium" onClick={() => act(() => api.put(`/bookings/rooms/${room.id}/housekeeping`, { status: 'dirty' }), 'Room marked dirty')}>
                    <Sparkles size={14} className="mr-1" /> Mark Dirty
                  </Button>
                )}
                {room.status !== 'maintenance' && (
                  <Button size="sm" variant="secondary" className="font-medium" onClick={() => act(() => api.put(`/bookings/rooms/${room.id}`, { status: 'maintenance' }), 'Room locked for maintenance')}>
                    <Wrench size={14} className="mr-1" /> Maintenance
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>

      <CheckoutSheet
        guest={checkoutOpen && current ? {
          id: current.id, guest_name: current.guest_name, rank: current.rank,
          room_number: data?.room.room_number, status: 'checked_in',
        } : null}
        onOpenChange={v => { if (!v) setCheckoutOpen(false); }}
        onDone={() => { reloadCalendar(); onChanged(); }} />
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </Sheet>
  );
}
