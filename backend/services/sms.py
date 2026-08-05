"""Guest SMS notifications (booking confirmations).

The server runs on an offline LAN, so SMS delivery is decoupled from
composition: every message is written to the sms_messages outbox as
'pending', then delivery is attempted through an optional HTTP gateway
(the `sms_gateway_url` setting - e.g. a GSM-modem bridge, an Android
SMS-gateway app on the LAN, or a real SMS provider's HTTP API). If no
gateway is configured or the send fails, the message stays pending and
staff can copy the text to a phone manually and mark it sent from the
Bookings dashboard.

Gateway URL is a template with {phone} and {message} placeholders, e.g.
    http://192.168.1.50:8082/send?to={phone}&text={message}
Both `sms_gateway_url` and `sms_api_key` are plain SystemSetting rows,
editable from Settings by any role with settings:edit (Manager/Deputy
Manager) - no .env or redeploy needed to point at a new provider or
rotate a key. If `sms_api_key` is set, it's sent two ways so either style
of provider works: as an `Authorization: Bearer` header on every request,
and substituted into a {api_key} placeholder in the URL if present, e.g.
    https://api.provider.com/send?key={api_key}&to={phone}&text={message}
A 2xx response counts as sent.
"""
import urllib.request
import urllib.parse
from datetime import datetime
from sqlalchemy.orm import Session
from backend.models import Booking, SmsMessage
from backend.services.mess_billing_calc import get_setting_str
from backend.logging_config import get_logger

logger = get_logger("app")

_NATURE_OF_DUTY_LABELS = {
    "visit": "Visit", "leave": "Leave", "official_duty": "Official Duty", "hra": "HRA Residency",
}


def compose_booking_sms(db: Session, booking: Booking) -> str:
    mess_name = get_setting_str(db, "mess_name", "EME Officers Mess")
    mess_address = get_setting_str(db, "mess_address", "204 Firdousi Road, Rawalpindi")
    mess_phone = get_setting_str(db, "mess_phone", "Tele: G.H.Q 31725")
    is_hra = booking.nature_of_duty == "hra"

    room_no = booking.room.room_number if booking.room else "-"
    room_type = getattr(booking.room.room_type, "value", booking.room.room_type) if booking.room and booking.room.room_type else None
    room_desc = f"Room {room_no} ({room_type})" if room_type else f"Room {room_no}"

    lines = [f"{mess_name}: Booking {booking.booking_reference} confirmed."]
    lines.append(f"Guest: {booking.guest_name}" + (f", {booking.rank}" if booking.rank else "") + ".")
    duty_label = _NATURE_OF_DUTY_LABELS.get(booking.nature_of_duty, booking.nature_of_duty)
    if is_hra:
        lines.append(f"{room_desc}, residency from {booking.check_in.strftime('%d %b %Y')}. Nature: {duty_label}.")
    else:
        pax = (booking.adults or 1) + (booking.children or 0)
        pax_note = f", {pax} pax" if pax and pax != 1 else ""
        lines.append(
            f"{room_desc}{pax_note}, check-in {booking.check_in.strftime('%d %b %Y')} to "
            f"{booking.check_out.strftime('%d %b %Y')}. Nature: {duty_label}."
        )
    lines.append(f"Location: {mess_address}.")
    if booking.arrival_deadline:
        lines.append(
            f"Please arrive by {booking.arrival_deadline.strftime('%d %b %Y %I:%M %p')} or the booking will be voided."
        )
    if booking.source == "online" and booking.online_voucher_no:
        lines.append(f"Online V/No: {booking.online_voucher_no}.")
    if booking.total_amount and not is_hra:
        lines.append(f"Estimated charges Rs {float(booking.total_amount):,.0f} (subject to actual stay/mess usage).")
    if booking.special_requests:
        lines.append(f"Note: {booking.special_requests[:100]}.")
    lines.append(f"Contact: {mess_phone}.")
    return " ".join(lines)


def try_send(db: Session, msg: SmsMessage) -> bool:
    """Attempt gateway delivery for one outbox message. Returns True if sent.
    No gateway configured -> message simply stays pending (manual send)."""
    gateway = get_setting_str(db, "sms_gateway_url", "")
    if not gateway or "{phone}" not in gateway:
        return False
    api_key = get_setting_str(db, "sms_api_key", "")
    url = gateway.replace("{phone}", urllib.parse.quote(msg.phone)).replace(
        "{message}", urllib.parse.quote(msg.body))
    if "{api_key}" in url:
        url = url.replace("{api_key}", urllib.parse.quote(api_key))
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=10) as res:
            if 200 <= res.status < 300:
                msg.status = "sent"
                msg.sent_at = datetime.utcnow()
                msg.error = None
                db.commit()
                return True
            msg.status = "failed"
            msg.error = f"Gateway returned HTTP {res.status}"
    except Exception as exc:  # gateway down/unreachable - keep for retry
        msg.status = "failed"
        msg.error = str(exc)[:500]
        logger.warning("SMS gateway send failed for message %s: %s", msg.id, exc)
    db.commit()
    return False


def queue_booking_sms(db: Session, booking: Booking) -> SmsMessage | None:
    """Compose + enqueue the confirmation SMS for a booking (no-op without a
    phone number), then best-effort attempt gateway delivery."""
    phone = (booking.guest_phone or "").strip()
    if not phone:
        return None
    msg = SmsMessage(booking_id=booking.id, phone=phone, body=compose_booking_sms(db, booking))
    db.add(msg)
    db.commit()
    db.refresh(msg)
    try_send(db, msg)
    return msg
