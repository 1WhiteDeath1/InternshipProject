"""Security domain: security event logs and incident reports."""
from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Text, ForeignKey, Enum
from backend.database import Base
from backend.models.enums import AlertSeverity


class SecurityLog(Base):
    __tablename__ = "security_logs"

    id = Column(Integer, primary_key=True)
    event_type = Column(String(50), nullable=False)  # check_in, check_out, after_hours_access, incident
    booking_id = Column(Integer, ForeignKey("bookings.id"), nullable=True)
    guest_name = Column(String(200))
    room_number = Column(String(20))
    timestamp = Column(DateTime, default=datetime.utcnow)
    processed_by = Column(Integer, ForeignKey("users.id"))
    notes = Column(Text)


class IncidentReport(Base):
    __tablename__ = "incident_reports"

    id = Column(Integer, primary_key=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=False)
    location = Column(String(200))
    category = Column(String(50))  # theft, disturbance, safety, medical, other
    severity = Column(Enum(AlertSeverity), default=AlertSeverity.LOW)
    reported_by = Column(Integer, ForeignKey("users.id"))
    status = Column(String(20), default="open")  # open, investigating, resolved, closed
    resolution = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)
    resolved_at = Column(DateTime)
