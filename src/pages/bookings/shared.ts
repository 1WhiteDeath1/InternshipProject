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
  };
  current_booking: {
    id: number; booking_reference: string; guest_name: string; guest_phone: string | null;
    rank: string | null; check_in: string; check_out: string; total_amount: number;
    nature_of_duty: string | null;
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
}

export interface CalendarDaySummary {
  date: string;
  total_rooms: number;
  occupied: number;
  reserved: number;
  arrivals: number;
  departures: number;
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

export const RANKS = ['Lt', 'Capt', 'Maj', 'Lt Col', 'Col', 'Brig', 'Maj Gen', 'Lt Gen', 'Gen'];

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
