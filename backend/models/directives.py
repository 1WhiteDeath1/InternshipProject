"""Directives domain: one-way notes a Manager sends to an operating role
(e.g. "book Room 12 for Col X") - a lightweight instruction feed, distinct
from Alert (a Manager-only oversight feed with no per-role visibility)."""
from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Text, ForeignKey, Enum, Index
from sqlalchemy.orm import relationship
from backend.database import Base
from backend.models.enums import DirectiveStatus


class Directive(Base):
    __tablename__ = "directives"

    id = Column(Integer, primary_key=True)
    from_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    to_role_id = Column(Integer, ForeignKey("roles.id"), nullable=False)
    message = Column(Text, nullable=False)
    status = Column(Enum(DirectiveStatus), default=DirectiveStatus.NEW)
    acknowledged_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    acknowledged_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    from_user = relationship("User", foreign_keys=[from_user_id])
    to_role = relationship("Role", foreign_keys=[to_role_id])
    acknowledger = relationship("User", foreign_keys=[acknowledged_by])

    __table_args__ = (
        Index("idx_directive_role_status", "to_role_id", "status"),
    )
