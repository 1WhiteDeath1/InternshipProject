"""Alerts domain: system-generated alerts (low stock, margin, anomalies)."""
from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Text, ForeignKey, Enum, Index
from backend.database import Base
from backend.models.enums import AlertSeverity, AlertStatus


class Alert(Base):
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True)
    title = Column(String(255), nullable=False)
    message = Column(Text, nullable=False)
    severity = Column(Enum(AlertSeverity), nullable=False)
    status = Column(Enum(AlertStatus), default=AlertStatus.NEW)
    module = Column(String(50), nullable=False)
    entity_type = Column(String(50))
    entity_id = Column(Integer)
    acknowledged_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    acknowledged_at = Column(DateTime)
    resolved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    resolved_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("idx_alert_status", "status"),
        Index("idx_alert_severity", "severity"),
        Index("idx_alert_module", "module"),
    )
