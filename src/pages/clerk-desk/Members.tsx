import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { IdCard, ArrowRight } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import { useClerkDesk } from './context';

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const STATUS_PILL: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  issued: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  paid: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
};

// Read-only: members settle through the monthly Mess Bill cycle, not checkout.
// This surfaces which member bills still need attention and hands off to the
// Mess Billing page for the actual issue / collect / discount actions.
export default function Members() {
  const { memberBills, loading } = useClerkDesk();
  const navigate = useNavigate();
  const unpaid = memberBills.filter(b => b.status !== 'paid');

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <p className="text-sm text-gray-500">Members settle via the monthly Mess Bill, not checkout. This is a read-only view — actions live on the Mess Billing page.</p>
        <button className="text-sm text-blue-600 hover:underline flex items-center gap-1" onClick={() => navigate('/mess-billing')}>
          Open Mess Billing <ArrowRight size={15} />
        </button>
      </div>
      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {!loading && unpaid.length === 0 && <p className="text-sm text-gray-500">No outstanding member bills — all issued bills are settled.</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {unpaid.map(b => (
          <Card key={b.id} className="cursor-pointer hover:shadow-md transition-all border-indigo-200 dark:border-indigo-900" onClick={() => navigate('/mess-billing')}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center shrink-0">
                <IdCard size={18} className="text-indigo-600 dark:text-indigo-300" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm truncate">{b.member_name || `Member #${b.member_id}`}</p>
                <p className="text-xs text-gray-500">{MONTHS[b.month]} {b.year}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-bold font-mono text-sm">{formatCurrency(b.total_amount)}</p>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${STATUS_PILL[b.status] || STATUS_PILL.draft}`}>{b.status}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
