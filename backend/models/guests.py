"""Guests domain: persistent walk-in guest identity."""
from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime
from backend.database import Base


class Guest(Base):
    """Persistent guest identity, matched across stays by ID number (CNIC/svc
    no/passport) or phone, so repeat visitors can be recognized at check-in
    and their bookings/bills traced by name. Not a full guest-management
    module - just enough to de-duplicate and prefill."""
    __tablename__ = "guests"

    id = Column(Integer, primary_key=True)
    full_name = Column(String(200), nullable=False)
    phone = Column(String(50))
    id_type = Column(String(50))
    id_number = Column(String(100))
    unit_address = Column(String(255))
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
