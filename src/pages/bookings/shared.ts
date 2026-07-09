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
  base_price: number;
  current_guest: string | null;
  current_booking_id: number | null;
  current_nature_of_duty: string | null;
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
    base_price: number; status: string; housekeeping_status: string; photos: RoomPhoto[];
  };
  current_booking: {
    id: number; booking_reference: string; guest_name: string; guest_phone: string | null;
    rank: string | null; check_in: string; check_out: string; total_amount: number;
    nature_of_duty: string | null;
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

export interface TimelineCell {
  date: string;
  status: string;
  guest_name: string | null;
  booking_reference: string | null;
}

export interface TimelineRoom {
  id: number;
  room_number: string;
  room_type: string;
  floor: number;
  cells: TimelineCell[];
}

export interface TimelineData {
  start: string;
  days: number;
  dates: string[];
  rooms: TimelineRoom[];
}

export const ROOM_TYPE_LABELS: Record<string, string> = {
  single: 'Single', double: 'Double', deluxe: 'Deluxe', suite: 'Suite', dormitory: 'Dormitory',
  vip: 'VIP GR', suite_1ac: 'Suite 1×AC', suite_2ac: 'Suite 2×AC', dg_suite: 'DG Suite',
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

export function roomStatusColor(status: string) {
  const colors: Record<string, string> = {
    vacant: 'bg-green-100 text-green-700 border-green-300', occupied: 'bg-red-100 text-red-700 border-red-300',
    reserved: 'bg-blue-100 text-blue-700 border-blue-300', maintenance: 'bg-gray-100 text-gray-700 border-gray-300',
  };
  return colors[status] || '';
}
