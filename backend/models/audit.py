"""Audit domain: the immutable audit trail."""
from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Text, ForeignKey, Enum, Index
from backend.database import Base
from backend.models.enums import AuditAction


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    user_name = Column(String(200))
    action = Column(Enum(AuditAction), nullable=False)
    entity_type = Column(String(50), nullable=False)  # table name
    entity_id = Column(Integer)
    before_state = Column(Text)  # JSON
    after_state = Column(Text)   # JSON
    reason = Column(Text)
    department = Column(String(50))
    timestamp = Column(DateTime, default=datetime.utcnow)
    ip_address = Column(String(45))

    __table_args__ = (
        Index("idx_audit_user", "user_id"),
        Index("idx_audit_action", "action"),
        Index("idx_audit_entity", "entity_type", "entity_id"),
        Index("idx_audit_timestamp", "timestamp"),
        Index("idx_audit_dept", "department"),
    )
