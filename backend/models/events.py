"""Events domain: a group hall/function booking with a free-text, per-dish
priced menu and a kitchen prep lifecycle - distinct from the guest-Room
Booking flow. Deputy Manager creates/owns the booking (picks the hall/area
and its capacity fresh at booking time - no persistent hall catalog, no
automated double-booking or over-capacity check; postponing or cancelling
for a capacity issue is the booker's own call). Kitchen NCO sets the menu and
advances prep status. Clerk generates the invoice once it's completed."""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, Date, DateTime, ForeignKey, Enum, Numeric
from sqlalchemy.orm import relationship
from backend.database import Base
from backend.models.enums import EventStatus, EventBillingType


class Event(Base):
    __tablename__ = "events"

    id = Column(Integer, primary_key=True)
    title = Column(String(200), nullable=False)
    guest_id = Column(Integer, ForeignKey("guests.id"), nullable=False)
    hall_name = Column(String(100), nullable=False)
    capacity = Column(Integer, nullable=False)
    headcount = Column(Integer, nullable=False)
    event_date = Column(Date, nullable=False)
    requirements = Column(Text)
    arrangement = Column(Text)
    billing_type = Column(Enum(EventBillingType), default=EventBillingType.SPLIT)
    status = Column(Enum(EventStatus), default=EventStatus.BOOKED)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    guest = relationship("Guest")
    menu_items = relationship("EventMenuItem", back_populates="event", cascade="all, delete-orphan")


class EventMenuItem(Base):
    """A guest-requested dish, free-text - deliberately not linked to the
    Recipe catalog (no costing/stock-deduction integration for events).
    estimated_price is per unit; quantity defaults to the event's headcount
    at creation time but can be overridden (e.g. a shared platter dish)."""
    __tablename__ = "event_menu_items"

    id = Column(Integer, primary_key=True)
    event_id = Column(Integer, ForeignKey("events.id"), nullable=False)
    dish_name = Column(String(200), nullable=False)
    estimated_price = Column(Numeric(10, 2), nullable=False)
    quantity = Column(Integer, nullable=False)

    event = relationship("Event", back_populates="menu_items")
