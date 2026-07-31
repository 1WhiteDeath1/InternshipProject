"""Attendance domain: per-meal consumption/booking records."""
from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Date, ForeignKey, Enum, Index
from sqlalchemy.orm import relationship
from backend.database import Base
from backend.models.enums import MealType, AttendanceStatus


class MealAttendance(Base):
    """A single consumption/booking record for one meal slot. The consumer is
    exactly one of: a Member (member_id), a checked-in hotel guest
    (booking_id), or a standalone walk-in Guest with no room booking
    (guest_id) - enforced in MealAttendanceCreate/ServeAttendanceRequest.
    guest_id exists specifically so a non-member can be logged as fast as a
    member, without first needing a room booking. menu_item_id optionally
    records what menu item was consumed, feeding kitchen production planning."""
    __tablename__ = "meal_attendance"

    id = Column(Integer, primary_key=True)
    member_id = Column(Integer, ForeignKey("members.id"), nullable=True)
    booking_id = Column(Integer, ForeignKey("bookings.id"), nullable=True)
    guest_id = Column(Integer, ForeignKey("guests.id"), nullable=True)
    menu_item_id = Column(Integer, ForeignKey("menu_items.id"), nullable=True)
    date = Column(Date, nullable=False)
    meal_type = Column(Enum(MealType), nullable=False)
    status = Column(Enum(AttendanceStatus), default=AttendanceStatus.BOOKED)
    method = Column(String(20), default="manual")  # manual | biometric | qr - recorded only, no hardware integration
    booked_at = Column(DateTime, default=datetime.utcnow)
    marked_at = Column(DateTime, nullable=True)
    marked_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    # Set once this row's routine-meal charge (non-member/guest pay-per-item,
    # priced via MenuItem.price) has been pulled into an Instant Checkout
    # invoice - guards against double-billing the same meal on a repeat checkout.
    invoiced_at = Column(DateTime, nullable=True)

    member = relationship("Member")
    booking = relationship("Booking")
    guest = relationship("Guest")
    menu_item = relationship("MenuItem")

    __table_args__ = (
        Index("idx_attendance_member_date", "member_id", "date"),
        Index("idx_attendance_date_meal", "date", "meal_type"),
        Index("uq_attendance_member_date_meal", "member_id", "date", "meal_type", unique=True),
        Index("uq_attendance_booking_date_meal", "booking_id", "date", "meal_type", unique=True),
        Index("uq_attendance_guest_date_meal", "guest_id", "date", "meal_type", unique=True),
    )
