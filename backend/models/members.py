"""Members domain: the resident officer/member roster and leave records."""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Date, Text, ForeignKey, Enum, Numeric, Index
from sqlalchemy.orm import relationship
from backend.database import Base
from backend.models.enums import MessCategory, ClientCategory, MemberStatus, LeaveStatus


class Member(Base):
    __tablename__ = "members"

    id = Column(Integer, primary_key=True)
    service_number = Column(String(50), nullable=False, unique=True)
    full_name = Column(String(200), nullable=False)
    rank = Column(String(50), nullable=False)
    unit = Column(String(100))
    mess_category = Column(Enum(MessCategory), nullable=False)
    client_category = Column(Enum(ClientCategory), default=ClientCategory.PERMANENT_MEMBER)
    # Orthogonal to mess_category - a resident can be Women's Bloc AND
    # officers/jcos/ors; when set, HRA billing uses WomensBlocRankRate
    # instead of HraRankRate for the same rank band.
    is_womens_bloc = Column(Boolean, default=False)
    custom_discount_rate = Column(Numeric(4, 2), default=0.00)  # per-member override, 0-100
    phone = Column(String(50))
    email = Column(String(255))
    status = Column(Enum(MemberStatus), default=MemberStatus.ACTIVE)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("idx_member_status", "status"),
        Index("idx_member_category", "mess_category"),
    )


class MemberLeave(Base):
    __tablename__ = "member_leaves"

    id = Column(Integer, primary_key=True)
    member_id = Column(Integer, ForeignKey("members.id"), nullable=False)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    reason = Column(Text)
    status = Column(Enum(LeaveStatus), default=LeaveStatus.ACTIVE)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)

    member = relationship("Member")

    __table_args__ = (
        Index("idx_leave_member", "member_id"),
        Index("idx_leave_dates", "start_date", "end_date"),
    )
