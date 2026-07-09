import { Badge } from '@/components/ui/badge';

export function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-800', confirmed: 'bg-blue-100 text-blue-800',
    checked_in: 'bg-green-100 text-green-800', checked_out: 'bg-gray-100 text-gray-800',
    cancelled: 'bg-red-100 text-red-800', no_show: 'bg-orange-100 text-orange-800',
  };
  return <Badge className={colors[status] || ''}>{status.replace(/_/g, ' ')}</Badge>;
}

export function HousekeepingBadge({ status }: { status: string }) {
  if (status === 'clean') return <Badge className="bg-emerald-100 text-emerald-800">Ready</Badge>;
  if (status === 'cleaning') return <Badge className="bg-sky-100 text-sky-800">Cleaning</Badge>;
  return <Badge className="bg-amber-100 text-amber-800">Needs cleaning</Badge>;
}

export function HraBadge() {
  return <Badge className="bg-purple-100 text-purple-800">HRA resident</Badge>;
}
