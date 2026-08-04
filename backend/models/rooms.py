"""Rooms domain: physical rooms, room photos, and the attendant roster."""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Date, Text, ForeignKey, Enum, Numeric
from sqlalchemy.orm import relationship
from backend.database import Base
from backend.models.enums import RoomType, RoomStatus


class Room(Base):
    __tablename__ = "rooms"

    id = Column(Integer, primary_key=True)
    room_number = Column(String(20), nullable=False, unique=True)
    room_type = Column(Enum(RoomType), nullable=False)
    floor = Column(Integer, default=1)
    capacity = Column(Integer, default=2)
    # Suites only: number of air conditioners (1 or 2) - drives the HRA
    # monthly utility charge (Rs 25,500 vs 29,500 on the rate card).
    ac_count = Column(Integer, default=1)
    base_price = Column(Numeric(10, 2), nullable=False)
    amenities = Column(Text)  # JSON array
    status = Column(Enum(RoomStatus), default=RoomStatus.VACANT)
    # Physical readiness, independent of occupancy: clean | dirty | cleaning
    housekeeping_status = Column(String(20), default="clean")
    notes = Column(Text)
    # Estimated day maintenance ends - set alongside `notes` (used as the
    # issue description) when a room is sent to maintenance from the drawer.
    maintenance_until = Column(Date, nullable=True)
    is_active = Column(Boolean, default=True)
    attendant_id = Column(Integer, ForeignKey("attendants.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    attendant = relationship("Attendant")


class Attendant(Base):
    """Room attendant/housekeeping staff. One attendant -> many rooms
    (Room.attendant_id is the default/current assignment); Booking.attendant_id
    is a separate snapshot of who was responsible during a specific stay, so
    reassigning a room's attendant later doesn't rewrite past-stay history."""
    __tablename__ = "attendants"

    id = Column(Integer, primary_key=True)
    full_name = Column(String(200), nullable=False)
    phone = Column(String(50))
    email = Column(String(255))
    shift = Column(String(50))  # e.g. morning | evening | night, free text
    photo_file_name = Column(String(255))
    is_active = Column(Boolean, default=True)
    # Whether this attendant is currently clocked in - distinct from `shift`
    # (a static label) and from `is_active` (an employment/roster flag).
    on_duty = Column(Boolean, default=False)
    on_duty_since = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AttendantDutyLog(Base):
    """One row per clock-in/clock-out session, so total hours and shift
    counts can be aggregated per attendant - Attendant.on_duty/on_duty_since
    only track the *current* session and get overwritten on every toggle."""
    __tablename__ = "attendant_duty_logs"

    id = Column(Integer, primary_key=True)
    attendant_id = Column(Integer, ForeignKey("attendants.id"), nullable=False, index=True)
    clock_in = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    clock_out = Column(DateTime, nullable=True)
    duration_minutes = Column(Integer, nullable=True)  # set on clock-out


class RoomPhoto(Base):
    __tablename__ = "room_photos"

    id = Column(Integer, primary_key=True)
    room_id = Column(Integer, ForeignKey("rooms.id"), nullable=False)
    file_name = Column(String(255), nullable=False)
    sort_order = Column(Integer, default=0)
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    uploaded_by = Column(Integer, ForeignKey("users.id"))
