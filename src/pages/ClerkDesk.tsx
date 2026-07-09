import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';
import { LayoutGrid, DoorOpen, IdCard, Receipt } from 'lucide-react';
import ReceiptView, { type ReceiptData } from '@/components/ReceiptView';
import { formatCurrency } from '@/lib/currency';

interface Booking {
  id: number;
  guest_name: string;
  room_number: string;
  status: string;
}

interface Balance {
  room_amount: number;
  routine_meals_amount: number;
  ala_carte_amount: number;
  total: number;
  unpriced_items: string[];
}

interface Member {
  id: number;
  full_name: string;
  service_number: string;
}

export default function ClerkDesk() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [balances, setBalances] = useState<Record<number, Balance>>({});
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const navigate = useNavigate();

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [bookingsRes, membersRes] = await Promise.all([
        api.get('/bookings?status=checked_in'),
        api.get('/members?status=active&page_size=100'),
      ]);
      const bks: Booking[] = bookingsRes.data.items;
      setBookings(bks);
      setMembers(membersRes.data.items);

      const balanceEntries = await Promise.all(bks.map(async (b) => {
        try { const res = await api.get(`/billing/bookings/${b.id}/running-balance`); return [b.id, res.data] as const; }
        catch { return [b.id, null] as const; }
      }));
      const balanceMap: Record<number, Balance> = {};
      for (const [id, bal] of balanceEntries) if (bal) balanceMap[id] = bal;
      setBalances(balanceMap);
    } catch { toast.error('Failed to load Clerk Desk'); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    queueMicrotask(() => { fetchAll(); });
  }, []);

  const handleCheckout = async (bookingId: number, guestName: string, roomNumber: string) => {
    try {
      const res = await api.post(`/billing/bookings/${bookingId}/instant-checkout`);
      setReceipt({ invoice_number: res.data.invoice_number, guest_name: guestName, room_number: roomNumber, items: res.data.items, total_amount: res.data.total_amount, unpriced_items: res.data.unpriced_items });
      toast.success('Checked out');
      fetchAll();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to check out')); }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2"><LayoutGrid size={24} /> Clerk Desk</h1>

      <div>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2"><DoorOpen size={18} /> Guests</h2>
        {loading && <p className="text-sm text-gray-500">Loading…</p>}
        {!loading && bookings.length === 0 && <p className="text-sm text-gray-500">No checked-in guests</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {bookings.map(b => {
            const bal = balances[b.id];
            return (
              <Card key={b.id}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-bold">{b.guest_name}</p>
                      <p className="text-xs text-gray-500">Room {b.room_number}</p>
                    </div>
                    <p className="text-xl font-bold">{bal ? formatCurrency(bal.total) : '—'}</p>
                  </div>
                  {bal && (
                    <div className="text-xs text-gray-500 space-y-0.5">
                      <p>Room: {formatCurrency(bal.room_amount)}</p>
                      <p>Meals: {formatCurrency(bal.routine_meals_amount)}</p>
                      <p>À la carte: {formatCurrency(bal.ala_carte_amount)}</p>
                      {bal.unpriced_items.length > 0 && <p className="text-amber-600">Needs pricing: {bal.unpriced_items.join(', ')}</p>}
                    </div>
                  )}
                  <Button size="sm" className="w-full" onClick={() => handleCheckout(b.id, b.guest_name, b.room_number)}>
                    <Receipt size={14} className="mr-1" /> Instant Checkout
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2"><IdCard size={18} /> Members</h2>
        <p className="text-xs text-gray-500 mb-2">Members settle through the monthly Mess Bill, not Instant Checkout.</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {members.map(m => (
            <Card key={m.id} className="cursor-pointer hover:shadow-md transition-all" onClick={() => navigate('/mess-billing')}>
              <CardContent className="p-4 text-center">
                <IdCard size={20} className="mx-auto mb-2 opacity-60" />
                <p className="font-medium text-sm truncate">{m.full_name}</p>
                <p className="text-xs text-gray-500">{m.service_number}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <ReceiptView receipt={receipt} onClose={() => setReceipt(null)} />
    </div>
  );
}
