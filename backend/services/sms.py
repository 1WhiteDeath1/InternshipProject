"""Guest SMS notifications (booking confirmations).

The server runs on an offline LAN, so SMS delivery is decoupled from
composition: every message is written to the sms_messages outbox as
'pending', then delivery is attempted through an optional HTTP gateway
(the `sms_gateway_url` setting - e.g. a GSM-modem bridge or an Android
SMS-gateway app reachable on the LAN). If no gateway is configured or the
send fails, the message stays pending and staff can copy the text to a
phone manually and mark it sent from the Bookings dashboard.

Gateway URL is a template with {phone} and {message} placeholders, e.g.
    http://192.168.1.50:8082/send?to={phone}&text={message}
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


def compose_booking_sms(db: Session, booking: Booking) -> str:
    mess_name = get_setting_str(db, "mess_name", "EME Officers Mess")
    mess_address = get_setting_str(db, "mess_address", "204 Firdousi Road, Rawalpindi")
    mess_phone = get_setting_str(db, "mess_phone", "Tele: G.H.Q 31725")

    room_no = booking.room.room_number if booking.room else "-"
    lines = [
        f"{mess_name}: Booking {booking.booking_reference} confirmed.",
        f"Room {room_no}, check-in {booking.check_in.strftime('%d %b %Y')} to {booking.check_out.strftime('%d %b %Y')}."
        if booking.nature_of_duty != "hra" else
        f"Room {room_no}, residency from {booking.check_in.strftime('%d %b %Y')}.",
        f"Location: {mess_address}.",
    ]
    if booking.arrival_deadline:
        lines.append(
            f"Please arrive by {booking.arrival_deadline.strftime('%d %b %Y %I:%M %p')} or the booking will be voided."
        )
    if booking.source == "online" and booking.online_voucher_no:
        lines.append(f"Online V/No: {booking.online_voucher_no}.")
    if booking.total_amount and booking.nature_of_duty != "hra":
        lines.append(f"Estimated charges Rs {float(booking.total_amount):,.0f}.")
    lines.append(f"Contact: {mess_phone}.")
    return " ".join(lines)


def try_send(db: Session, msg: SmsMessage) -> bool:
    """Attempt gateway delivery for one outbox message. Returns True if sent.
    No gateway configured -> message simply stays pending (manual send)."""
    gateway = get_setting_str(db, "sms_gateway_url", "")
    if not gateway or "{phone}" not in gateway:
        return False
    url = gateway.replace("{phone}", urllib.parse.quote(msg.phone)).replace(
        "{message}", urllib.parse.quote(msg.body))
    try:
        with urllib.request.urlopen(url, timeout=10) as res:
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
