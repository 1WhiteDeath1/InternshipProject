import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LogIn, LogOut, CalendarPlus, ArrowRight, X } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import { useAuth } from '@/contexts/useAuth';
import { hasPermission } from '@/contexts/auth-context';
import { GuestChargePanel } from '@/components/GuestChargePanel';
import { ROOM_TYPE_LABELS, addDays, fmtDay, selectClass, type CalendarData, type CalendarStay, type AttendantOption } from './shared';
import { HraBadge } from './badges';

interface TransferOption {
  id: number;
  room_number: string;
  room_type: string;
  pricing: { total: number; nightly_total: number };
}

interface RoomOccupantCardProps {
  current: CalendarData['current_booking'];
  arrivalToday: CalendarStay | undefined;
  roomReady: boolean;
  today: string;
  roomChargesTotal: number;
  onTotalsChange: (total: number) => void;
  extendOpen: boolean;
  extendDate: string;
  extending: boolean;
  transferOptions: TransferOption[] | null;
  onOpenExtend: () => void;
  onOpenChangeRoom: () => void;
  onCloseExtend: () => void;
  onExtendDateChange: (date: string) => void;
  onExtend: (transferRoomId?: number) => void;
  onEndResidency: () => void;
  onSendToClerkDesk: () => void;
  attendants: AttendantOption[];
  arrivalAttendantId: string;
  onArrivalAttendantChange: (id: string) => void;
  onCheckInArrival: () => void;
  reloadCalendar: () => void;
  onChanged: () => void;
}

/** Current occupant details, the live folio, and the terminal front-desk
    action (extend or hand off to the Clerk Desk for billing) - plus, if a
    different reservation is arriving today, the one-tap check-in for it. */
export function RoomOccupantCard({
  current, arrivalToday, roomReady, today, roomChargesTotal, onTotalsChange,
  extendOpen, extendDate, extending, transferOptions,
  onOpenExtend, onOpenChangeRoom, onCloseExtend, onExtendDateChange, onExtend, onEndResidency, onSendToClerkDesk,
  attendants, arrivalAttendantId, onArrivalAttendantChange, onCheckInArrival,
  reloadCalendar, onChanged,
}: RoomOccupantCardProps) {
  const { user } = useAuth();
  // Room-side ad-hoc charges (Dhobi/Breakage/Wages of Servants/Heater-AC/
  // etc.) are owned end-to-end by either Clerk (billing:view) or Booking NCO
  // (bookings:view, which they already hold for the room/stay itself) - see
  // add_booking_charge's permission check in billing.py. Mess-side charges
  // (Extra Messing/Sui Gas) stay off this panel entirely (isMess={false}
  // below) - those are Kitchen NCO's, logged through kitchen orders instead.
  const canLogRoomCharges = hasPermission(user, 'billing', 'view') || hasPermission(user, 'bookings', 'view');
  return (
    <>
      {current && (
      <div className={`rounded-lg border p-3 ${current.checkout_due ? 'border-red-400 ring-1 ring-red-300' : ''}`}>
        {current.checkout_due && (
          <div className="mb-2 rounded-md bg-red-50 dark:bg-red-950 border border-red-300 px-2.5 py-1.5 text-xs font-semibold text-red-700 dark:text-red-300 animate-pulse">
            Action Required: Extend or Checkout — scheduled departure was {fmtDay(current.check_out)}
          </div>
        )}
        <div className="flex items-center gap-1.5 mb-1">
          <p className="text-xs text-muted-foreground">{current.nature_of_duty === 'hra' ? 'HRA resident' : 'Now staying'}</p>
          {current.nature_of_duty === 'hra' && <HraBadge />}
          {current.nature_of_duty !== 'hra' && current.is_indefinite && (
            <span className="text-[10px] font-medium text-violet-700 bg-violet-50 dark:bg-violet-950 dark:text-violet-300 rounded px-1 py-0.5">Open-ended</span>
          )}
          {current.source === 'online' && <span className="text-[10px] font-medium text-blue-700 bg-blue-50 dark:bg-blue-950 dark:text-blue-300 rounded px-1 py-0.5">Online{current.online_voucher_no ? ` · V/No ${current.online_voucher_no}` : ''}</span>}
        </div>
        <p className="font-medium">{current.rank ? `${current.rank} ` : ''}{current.guest_name}</p>
        <p className="text-xs text-muted-foreground">{current.booking_reference}{current.guest_phone ? ` · ${current.guest_phone}` : ''}</p>
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {current.client_category && <p><span className="text-muted-foreground">Category:</span> {current.client_category.replace(/_/g, ' ')}</p>}
          {current.guest_id_number && <p><span className="text-muted-foreground">{(current.guest_id_type || 'ID').toUpperCase()}:</span> {current.guest_id_number}</p>}
          {current.pa_number && <p><span className="text-muted-foreground">PA No:</span> {current.pa_number}</p>}
          {current.unit_address && <p><span className="text-muted-foreground">Unit:</span> {current.unit_address}</p>}
          {current.reference_person && <p className="col-span-2"><span className="text-muted-foreground">Reference:</span> {current.reference_person}</p>}
          {current.mattress_count > 0 && <p><span className="text-muted-foreground">Mattresses:</span> {current.mattress_count}</p>}
          {current.actual_check_in && <p className="col-span-2"><span className="text-muted-foreground">Checked in:</span> {new Date(current.actual_check_in).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>}
          {current.special_requests && <p className="col-span-2"><span className="text-muted-foreground">Remarks:</span> {current.special_requests}</p>}
        </div>
        <div className="flex items-center justify-between mt-2 text-sm">
          <span>
            {current.nature_of_duty === 'hra' ? `Resident since ${fmtDay(current.check_in)}`
              : current.is_indefinite ? `Since ${fmtDay(current.check_in)} — open-ended`
              : `${fmtDay(current.check_in)} → ${fmtDay(current.check_out)}`}
          </span>
          {current.nature_of_duty !== 'hra' && <span className="font-medium">{formatCurrency(current.total_amount)}</span>}
        </div>
        {current.nature_of_duty === 'hra' && <p className="text-xs text-muted-foreground mt-0.5">Billed monthly via the mess bill, not a fixed total</p>}
        {current.nature_of_duty !== 'hra' && current.is_indefinite && <p className="text-xs text-muted-foreground mt-0.5">Nightly-rate estimate shown — actual total is billed at checkout</p>}

        {current.nature_of_duty !== 'hra' && (
          <div className="mt-2 rounded-md border bg-muted/40 px-2.5 py-2 text-xs space-y-1">
            <p className="font-semibold text-muted-foreground uppercase tracking-wide text-[10px] mb-1">Live Bill Summary</p>
            <div className="flex justify-between">
              <span>Room Stay Base {current.is_indefinite ? '(open-ended)' : `(${fmtDay(current.check_in)} - ${fmtDay(current.check_out)})`}</span>
              <span className="font-mono">{formatCurrency(current.total_amount)}</span>
            </div>
            {roomChargesTotal > 0 && (
              <div className="flex justify-between">
                <span>Local Incidentals</span>
                <span className="font-mono">{formatCurrency(roomChargesTotal)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold border-t pt-1">
              <span>Total</span>
              <span className="font-mono">{formatCurrency(current.total_amount + roomChargesTotal)}</span>
            </div>
          </div>
        )}

        {!extendOpen ? (
          <div className="flex gap-2 mt-2">
            {current.nature_of_duty !== 'hra' ? (
              <>
                <Button size="sm" variant={current.checkout_due ? 'default' : 'outline'} className="flex-1" onClick={onOpenExtend}>
                  <CalendarPlus size={14} className="mr-1" /> Extend Stay
                </Button>
                <Button size="sm" variant="outline" className="flex-1" onClick={onOpenChangeRoom}>
                  <ArrowRight size={14} className="mr-1" /> Change Room
                </Button>
                <Button size="sm" variant={current.checkout_due ? 'destructive' : 'default'} className="flex-1" onClick={onSendToClerkDesk}>
                  <ArrowRight size={14} className="mr-1" /> Send to Clerk Desk for Billing
                </Button>
              </>
            ) : (
              <Button size="sm" variant="outline" className="flex-1"
                title="Ends the monthly residency - outstanding charges settle via the final Mess Bill"
                onClick={onEndResidency}>
                <LogOut size={14} className="mr-1" /> End Residency
              </Button>
            )}
          </div>
        ) : (
          <div className="mt-2 border-t pt-2 space-y-2">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label className="text-xs">Extend checkout to</Label>
                <Input type="date" value={extendDate} min={addDays(today, 1)} onChange={e => onExtendDateChange(e.target.value)} />
              </div>
              <Button size="sm" disabled={extending || !extendDate} onClick={() => onExtend()}>
                {extending ? 'Checking…' : 'Extend'}
              </Button>
              <Button size="sm" variant="ghost" onClick={onCloseExtend}><X size={14} /></Button>
            </div>
            {transferOptions !== null && (
              <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950 p-2 space-y-1.5">
                <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
                  This room is reserved for those dates. Transfer {current.guest_name} to another room, or check them out.
                </p>
                {transferOptions.length === 0 && <p className="text-xs text-amber-700">No other rooms are free until {fmtDay(extendDate)} — a standard checkout is the only option.</p>}
                {transferOptions.slice(0, 6).map(r => (
                  <button key={r.id} type="button" disabled={extending}
                    className="w-full flex items-center justify-between text-xs bg-card border rounded px-2 py-1.5 hover:border-blue-400"
                    onClick={() => onExtend(r.id)}>
                    <span className="font-medium">Room {r.room_number} <span className="text-muted-foreground font-normal">{ROOM_TYPE_LABELS[r.room_type] || r.room_type}</span></span>
                    <span>{formatCurrency(r.pricing.total)} total</span>
                  </button>
                ))}
                <Button size="sm" variant="outline" className="w-full" onClick={onSendToClerkDesk}>
                  <ArrowRight size={14} className="mr-1" /> Send to Clerk Desk Instead
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
      )}

      {current && current.nature_of_duty !== 'hra' && canLogRoomCharges && (
        <GuestChargePanel bookingId={current.id} isMess={false}
          onChanged={() => { reloadCalendar(); onChanged(); }}
          onTotalsChange={onTotalsChange} />
      )}

      {arrivalToday && (
        <div className="rounded-lg border p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <p className="text-xs text-muted-foreground">Arriving today</p>
            {arrivalToday.nature_of_duty === 'hra' && <HraBadge />}
          </div>
          <p className="font-medium">{arrivalToday.guest_name}</p>
          <p className="text-xs text-muted-foreground">{arrivalToday.booking_reference}</p>
          {roomReady && (
            <div className="mt-2">
              <Label className="text-xs">Attendant</Label>
              <select className={selectClass} value={arrivalAttendantId} onChange={e => onArrivalAttendantChange(e.target.value)}>
                <option value="">Select attendant…</option>
                {attendants.some(a => a.on_duty) && (
                  <optgroup label="On duty">
                    {attendants.filter(a => a.on_duty).map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
                  </optgroup>
                )}
                {attendants.some(a => !a.on_duty) && (
                  <optgroup label={attendants.some(a => a.on_duty) ? 'Off duty' : 'All attendants'}>
                    {attendants.filter(a => !a.on_duty).map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
                  </optgroup>
                )}
              </select>
            </div>
          )}
          <Button size="sm" className="mt-2 w-full" disabled={!roomReady || !arrivalAttendantId}
            title={!roomReady ? 'Room must be marked clean first' : !arrivalAttendantId ? 'Select an attendant first' : undefined}
            onClick={onCheckInArrival}>
            <LogIn size={14} className="mr-1" /> {roomReady ? 'Check In' : 'Room Not Ready'}
          </Button>
        </div>
      )}
    </>
  );
}
