export interface RoomPhoto {
  id: number;
  url: string;
}

export interface Room {
  id: number;
  room_number: string;
  room_type: string;
  status: string;
  housekeeping_status: string;
  floor: number;
  capacity: number;
  ac_count?: number;
  base_price: number;
  current_guest: string | null;
  current_check_out: string | null;
  current_booking_id: number | null;
  current_nature_of_duty: string | null;
  checkout_due: boolean;
  arrival_guest: string | null;
  arrival_booking_id: number | null;
  arrival_nature_of_duty: string | null;
  photos: RoomPhoto[];
  attendant_id: number | null;
  attendant_name: string | null;
}

export interface AttendantOption {
  id: number;
  full_name: string;
  is_active: boolean;
  on_duty: boolean;
}

export interface PricingQuote {
  pricing_mode: string;
  nights: number;
  nightly_total: number;
  monthly_total: number | null;
  total: number;
  mattress_total: number;
  note: string | null;
}

export interface AvailableRoom {
  id: number;
  room_number: string;
  room_type: string;
  floor: number;
  capacity: number;
  housekeeping_status: string;
  available: boolean;
  unavailable_reason: string | null;
  next_booking_start: string | null;
  pricing: PricingQuote;
}

export interface Booking {
  id: number;
  booking_reference: string;
  guest_name: string;
  guest_phone: string;
  room_number: string;
  check_in: string;
  check_out: string;
  status: string;
  adults: number;
  total_amount: number | null;
  client_category: string | null;
  member_name: string | null;
  rank: string | null;
  nature_of_duty: string | null;
  late_checkout_fee: number;
  source: string;
  online_voucher_no: string | null;
  reference_person: string | null;
  arrival_deadline: string | null;
  arrival_overdue: boolean;
}

export interface SmsOutboxItem {
  id: number;
  booking_id: number | null;
  booking_reference: string | null;
  guest_name: string | null;
  phone: string;
  body: string;
  status: string;
  error: string | null;
  created_at: string;
  sent_at: string | null;
}

export interface MemberOption {
  id: number;
  full_name: string;
  service_number: string;
}

export interface CalendarStay {
  id: number;
  booking_reference: string;
  guest_name: string;
  status: string;
  check_in: string;
  check_out: string;
  nature_of_duty: string | null;
}

export interface CalendarData {
  room: {
    id: number; room_number: string; room_type: string; floor: number; capacity: number;
    ac_count?: number; base_price: number; status: string; housekeeping_status: string; photos: RoomPhoto[];
    attendant_id: number | null; attendant_name: string | null;
    notes: string | null; maintenance_until: string | null;
  };
  current_booking: {
    id: number; booking_reference: string; guest_name: string; guest_phone: string | null;
    rank: string | null; check_in: string; check_out: string; total_amount: number;
    nature_of_duty: string | null; is_indefinite: boolean;
    client_category: string | null;
    guest_id_type: string | null; guest_id_number: string | null;
    pa_number: string | null; unit_address: string | null;
    reference_person: string | null;
    source: string; online_voucher_no: string | null;
    mattress_count: number;
    special_requests: string | null;
    actual_check_in: string | null;
    checkout_due: boolean;
  } | null;
  year: number; month: number;
  stays: CalendarStay[];
}

export interface ArrivalDeparture {
  booking_id: number;
  guest_name: string;
  room_id: number;
  room_number: string | null;
  booking_reference: string;
  arrival_deadline?: string | null;
  arrival_overdue?: boolean;
  // departures only: guest's scheduled check-out has already passed
  overdue?: boolean;
  days_overdue?: number;
}

export interface HousekeepingQueueItem {
  room_id: number;
  room_number: string;
  housekeeping_status: string;
}

export interface OccupancyData {
  total_rooms: number;
  occupied: number;
  reserved: number;
  vacant: number;
  maintenance: number;
  needs_housekeeping: number;
  occupancy_rate: number;
  arrivals: ArrivalDeparture[];
  departures: ArrivalDeparture[];
  housekeeping_queue: HousekeepingQueueItem[];
}

export interface CalendarDayGuest {
  guest_name: string;
  rank: string | null;
  room_id: number;
  room_number: string | null;
  status: string;
  nature_of_duty: string | null;
  is_indefinite: boolean;
}

export interface CalendarDaySummary {
  date: string;
  total_rooms: number;
  occupied: number;
  reserved: number;
  arrivals: number;
  departures: number;
  /** Per-day occupancy mix, same kinds the grid views colour by */
  kind_counts: { hra: number; indefinite: number; guest: number; reserved: number };
  guests: CalendarDayGuest[];
}

export interface CalendarMonthSummary {
  month: string; // "YYYY-MM"
  occupancy_rate: number;
  bookings_count: number;
  revenue: number;
}

export interface RoomWeekCell {
  date: string;
  status: string;
  guest_name: string | null;
  booking_reference: string | null;
  nature_of_duty: string | null;
  is_indefinite: boolean;
  booking_status: string | null;
}

// The one occupancy-kind palette, shared by every calendar view (Week,
// Month, Rooms-by-Month) so the same colour always means the same thing.
// Kinds are ordered from "longest commitment" to "no commitment": a room
// held by an HRA resident is a fundamentally different thing from a room
// sold for two nights, and the old single red for all of it hid that.
export type OccupancyKind =
  | 'hra' | 'indefinite' | 'official_duty' | 'leave' | 'guest'
  | 'departed' | 'reserved' | 'maintenance' | 'vacant';

export interface OccupancyMeta {
  label: string;
  /** Tailwind classes for a filled cell/bar */
  cell: string;
  /** Solid hex, for legend swatches and the gradient fade */
  hex: string;
  /** Legend visibility - 'departed' only appears once there's past data */
  legend: boolean;
}

export const OCCUPANCY_META: Record<OccupancyKind, OccupancyMeta> = {
  hra: { label: 'HRA resident', cell: 'bg-purple-200 text-purple-900 dark:bg-purple-800 dark:text-purple-50', hex: '#A855F7', legend: true },
  indefinite: { label: 'Open-ended stay', cell: 'bg-violet-200 text-violet-900 dark:bg-violet-800 dark:text-violet-50', hex: '#8B5CF6', legend: true },
  official_duty: { label: 'Official duty', cell: 'bg-amber-200 text-amber-900 dark:bg-amber-800 dark:text-amber-50', hex: '#F59E0B', legend: true },
  leave: { label: 'On leave', cell: 'bg-teal-200 text-teal-900 dark:bg-teal-800 dark:text-teal-50', hex: '#14B8A6', legend: true },
  guest: { label: 'Guest in house', cell: 'bg-red-200 text-red-900 dark:bg-red-800 dark:text-red-50', hex: '#EF4444', legend: true },
  departed: { label: 'Past stay', cell: 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300', hex: '#FDA4AF', legend: true },
  reserved: { label: 'Reserved', cell: 'bg-blue-200 text-blue-900 dark:bg-blue-800 dark:text-blue-50', hex: '#3B82F6', legend: true },
  maintenance: { label: 'Maintenance', cell: 'bg-gray-300 text-gray-700 dark:bg-gray-600 dark:text-gray-100', hex: '#9CA3AF', legend: true },
  vacant: { label: 'Vacant', cell: '', hex: 'transparent', legend: false },
};

/** Resolve one grid cell to its occupancy kind. Order matters: HRA wins over
    is_indefinite (an HRA residency is open-ended by definition and already
    has its own colour), and a checked-out stay reads as 'departed' whatever
    its duty type, since the room is historically - not currently - taken. */
export function cellKind(c: Pick<RoomWeekCell, 'status' | 'nature_of_duty' | 'is_indefinite' | 'booking_status'>): OccupancyKind {
  if (c.status === 'maintenance') return 'maintenance';
  if (c.status === 'vacant') return 'vacant';
  if (c.status === 'reserved') return 'reserved';
  if (c.nature_of_duty === 'hra') return 'hra';
  if (c.booking_status === 'checked_out') return 'departed';
  if (c.is_indefinite) return 'indefinite';
  if (c.nature_of_duty === 'official_duty') return 'official_duty';
  if (c.nature_of_duty === 'leave') return 'leave';
  return 'guest';
}

/** True when the cell belongs to a stay with no real end date that is still
    running - the trailing edge of such a run gets faded, because its stored
    check_out is a placeholder, not a departure the desk actually agreed. */
export function isOpenEnded(c: Pick<RoomWeekCell, 'nature_of_duty' | 'is_indefinite' | 'booking_status'>): boolean {
  if (c.booking_status === 'checked_out') return false;
  return c.nature_of_duty === 'hra' || c.is_indefinite;
}

export interface RoomWeekRoom {
  id: number;
  room_number: string;
  room_type: string;
  floor: number;
  cells: RoomWeekCell[];
}

export interface RoomWeekData {
  start: string;
  dates: string[];
  rooms: RoomWeekRoom[];
}

export const ROOM_TYPE_LABELS: Record<string, string> = {
  standard: 'Standard', suite: 'Suite', dg_suite: 'DG Suite',
};

// The 3 client_category values that actually have a Guest Room Charges row
// on the Tariffs rate card (RoomRate: room_type x guest_category) and so
// change what a room bills - the other 3 ClientCategory enum values
// (permanent_member, non_member_civilian, non_member_non_civilian) have no
// rate-card entry and fall back to the room's flat base_price instead.
// Single source of truth for these labels - Tariffs' rate card and Guest
// Discounts' category selector both read from here so they can't drift.
export const RATE_CARD_CATEGORY_LABELS: Record<string, string> = {
  serving_officer: 'Army Offrs', retired_officer: 'Army Retd Offrs', civilian: 'Civilian',
};

export const RANKS = ['Lt', 'Capt', 'Maj', 'Lt Col', 'Col', 'Brig', 'Maj Gen', 'Lt Gen', 'Gen'];

// Standard ad-hoc charge heads from the paper draft bill, split by which
// bill they land on. "Custom…" always appears too, for anything not listed.
// Extra Messing / Sui Gas Charges on Messing are no longer manually logged
// heads - they're computed automatically from actual orders at checkout
// (see backend/services/mess_charge_calc.py), so MESS_CHARGE_HEADS only
// ever offers "Custom..." for a genuinely separate ad-hoc mess charge.
export const ROOM_CHARGE_HEADS = ['Dhobi', 'Allied Charges', 'Breakage', 'Dental Kit'];
export const MESS_CHARGE_HEADS: string[] = [];
export const CUSTOM_CHARGE_HEAD = '__custom__';

export interface BookingCharge { id: number; head: string; amount: number; is_mess_charge: boolean; invoiced: boolean; }

export const todayISO = () => new Date().toLocaleDateString('en-CA');
export const addDays = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return dt.toLocaleDateString('en-CA');
};
export const fmtDay = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

export const selectClass = 'w-full h-10 rounded-md border border-input bg-background px-3 text-sm';

export interface Meta { label: string; bg: string; dot: string; }

// Room occupancy status (Rooms grid + card accents) - dot-pill colors plus a
// matching left-border accent class for the card itself.
export const ROOM_STATUS_META: Record<string, Meta & { border: string }> = {
  vacant: { label: 'Available', bg: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300', dot: 'bg-emerald-500', border: 'border-l-emerald-500' },
  occupied: { label: 'Occupied', bg: 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300', dot: 'bg-red-500', border: 'border-l-red-500' },
  reserved: { label: 'Reserved', bg: 'bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-300', dot: 'bg-blue-500', border: 'border-l-blue-500' },
  maintenance: { label: 'Maintenance', bg: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300', dot: 'bg-gray-400', border: 'border-l-gray-400' },
};
