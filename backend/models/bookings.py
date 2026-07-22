"""Bookings domain: the booking record itself, ad-hoc charges, SMS outbox,
and guest movement (check-in/check-out/room-change) history."""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Date, Text, ForeignKey, Enum, Numeric
from sqlalchemy.orm import relationship
from backend.database import Base
from backend.models.enums import BookingStatus, ClientCategory


class Booking(Base):
    __tablename__ = "bookings"

    id = Column(Integer, primary_key=True)
    booking_reference = Column(String(50), nullable=False, unique=True)
    guest_name = Column(String(200), nullable=False)
    guest_phone = Column(String(50))
    guest_email = Column(String(255))
    guest_id_type = Column(String(50))
    guest_id_number = Column(String(100))
    guest_id = Column(Integer, ForeignKey("guests.id"), nullable=True)
    room_id = Column(Integer, ForeignKey("rooms.id"), nullable=False)
    check_in = Column(Date, nullable=False)
    check_out = Column(Date, nullable=False)
    adults = Column(Integer, default=1)
    children = Column(Integer, default=0)
    status = Column(Enum(BookingStatus), default=BookingStatus.PENDING)
    special_requests = Column(Text)
    total_amount = Column(Numeric(10, 2))
    processed_by = Column(Integer, ForeignKey("users.id"))
    client_category = Column(Enum(ClientCategory), default=ClientCategory.NON_MEMBER_CIVILIAN)
    member_id = Column(Integer, ForeignKey("members.id"), nullable=True)  # set when a permanent member occupies a room
    # Snapshot of the room's attendant at check-in time - independent of
    # rooms.attendant_id so later reassignment doesn't rewrite this stay's history.
    attendant_id = Column(Integer, ForeignKey("attendants.id"), nullable=True)
    # Official / private / family - third axis of the rank x room-type x
    # stay-type tariff matrix (see TariffRate). Independent of nature_of_duty.
    stay_type = Column(String(20))
    # Booking-register fields (paper register columns the mess must keep recording)
    rank = Column(String(50))
    pa_number = Column(String(50))
    unit_address = Column(String(255))
    # "C/O" reference from the paper register (e.g. "C/O AD", "C/O Brig Cdr CES").
    # Mandatory for civilian guests, optional for officers/institutional guests.
    reference_person = Column(String(100))
    nature_of_duty = Column(String(20), default="visit")  # visit | leave | official_duty | hra
    da_multiplier = Column(Numeric(3, 1))  # 1.0 or 1.5 for official-duty DA billing
    mattress_count = Column(Integer, default=0)
    # Booking channel: walk_in (at the desk) or online (transcribed from the
    # separate online portal, carrying that portal's voucher number).
    source = Column(String(20), default="walk_in")  # walk_in | online
    online_voucher_no = Column(String(50))
    # Guest must physically arrive (be checked in) by this time or staff may
    # void the booking to free the room.
    arrival_deadline = Column(DateTime)
    late_checkout_fee = Column(Numeric(10, 2), default=0)
    actual_check_in = Column(DateTime)
    actual_check_out = Column(DateTime)
    cancel_reason = Column(Text)
    rate_breakdown = Column(Text)  # JSON snapshot of the itemized nightly rate applied
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    room = relationship("Room")
    member = relationship("Member")
    guest = relationship("Guest")
    attendant = relationship("Attendant")


class BookingCharge(Base):
    """Ad-hoc charge against a stay, matching the paper draft bill's line
    heads (Dhobi, Allied Charges, Breakage, Dental Kit, Extra Messing, Sui
    Gas Charges on Messing...). is_mess_charge routes the line onto the
    mess/food bill at checkout instead of the room bill."""
    __tablename__ = "booking_charges"

    id = Column(Integer, primary_key=True)
    booking_id = Column(Integer, ForeignKey("bookings.id"), nullable=False)
    head = Column(String(100), nullable=False)
    amount = Column(Numeric(10, 2), nullable=False)
    is_mess_charge = Column(Boolean, default=False)
    invoiced_at = Column(DateTime)  # set when swept into an invoice at checkout
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)

    booking = relationship("Booking")


class SmsMessage(Base):
    """Outbox for guest SMS notifications. The server itself is offline, so
    messages queue as 'pending'; delivery happens either through an optional
    HTTP SMS gateway (sms_gateway_url setting, e.g. a GSM-modem bridge on the
    LAN) or manually - staff copy the text to a phone and mark it sent."""
    __tablename__ = "sms_messages"

    id = Column(Integer, primary_key=True)
    booking_id = Column(Integer, ForeignKey("bookings.id"))
    phone = Column(String(50), nullable=False)
    body = Column(Text, nullable=False)
    status = Column(String(20), default="pending")  # pending | sent | failed
    error = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)
    sent_at = Column(DateTime)
    sent_by = Column(Integer, ForeignKey("users.id"))

    booking = relationship("Booking")


class GuestMovement(Base):
    __tablename__ = "guest_movements"

    id = Column(Integer, primary_key=True)
    booking_id = Column(Integer, ForeignKey("bookings.id"), nullable=False)
    movement_type = Column(String(50), nullable=False)  # check_in, check_out, room_change
    from_room_id = Column(Integer, ForeignKey("rooms.id"), nullable=True)
    to_room_id = Column(Integer, ForeignKey("rooms.id"), nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    processed_by = Column(Integer, ForeignKey("users.id"))
    notes = Column(Text)
