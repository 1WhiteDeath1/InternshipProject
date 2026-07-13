// Small colored-dot pill badges shared across the booking module - matches
// the reference PMS's "dot + label" status chip look, kept theme-aware.
import { type Meta, ROOM_STATUS_META } from './shared';

function Pill({ meta }: { meta: Meta }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${meta.bg}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

const BOOKING_STATUS_META: Record<string, Meta> = {
  pending: { label: 'Pending', bg: 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300', dot: 'bg-amber-500' },
  confirmed: { label: 'Confirmed', bg: 'bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-300', dot: 'bg-blue-500' },
  checked_in: { label: 'Checked In', bg: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300', dot: 'bg-emerald-500' },
  checked_out: { label: 'Checked Out', bg: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300', dot: 'bg-gray-400' },
  cancelled: { label: 'Cancelled', bg: 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300', dot: 'bg-red-500' },
  no_show: { label: 'No Show', bg: 'bg-orange-50 text-orange-800 dark:bg-orange-950 dark:text-orange-300', dot: 'bg-orange-500' },
};

export function StatusBadge({ status }: { status: string }) {
  const meta = BOOKING_STATUS_META[status] || { label: status.replace(/_/g, ' '), bg: 'bg-gray-100 text-gray-700', dot: 'bg-gray-400' };
  return <Pill meta={meta} />;
}

const HOUSEKEEPING_META: Record<string, Meta> = {
  clean: { label: 'Ready', bg: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300', dot: 'bg-emerald-500' },
  cleaning: { label: 'Cleaning', bg: 'bg-sky-50 text-sky-800 dark:bg-sky-950 dark:text-sky-300', dot: 'bg-sky-500' },
  dirty: { label: 'Needs cleaning', bg: 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300', dot: 'bg-amber-500' },
};

export function HousekeepingBadge({ status }: { status: string }) {
  return <Pill meta={HOUSEKEEPING_META[status] || HOUSEKEEPING_META.dirty} />;
}

export function HraBadge() {
  return <Pill meta={{ label: 'HRA resident', bg: 'bg-purple-50 text-purple-800 dark:bg-purple-950 dark:text-purple-300', dot: 'bg-purple-500' }} />;
}

export function RoomStatusPill({ status }: { status: string }) {
  return <Pill meta={ROOM_STATUS_META[status] || ROOM_STATUS_META.maintenance} />;
}
