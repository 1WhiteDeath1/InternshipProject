"""Mess billing domain: monthly member mess bills and sponsored guest meal charges."""
from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Date, Text, ForeignKey, Enum, Numeric, Index
from sqlalchemy.orm import relationship
from backend.database import Base
from backend.models.enums import MessBillStatus, MealType


class MessBill(Base):
    __tablename__ = "mess_bills"

    id = Column(Integer, primary_key=True)
    member_id = Column(Integer, ForeignKey("members.id"), nullable=False)
    month = Column(Integer, nullable=False)
    year = Column(Integer, nullable=False)
    man_days = Column(Integer, nullable=False, default=0)
    per_head_rate = Column(Numeric(12, 2), nullable=False, default=0)
    base_menu_amount = Column(Numeric(12, 2), nullable=False, default=0)
    stay_amount = Column(Numeric(12, 2), default=0)
    extra_meals_amount = Column(Numeric(12, 2), default=0)
    applied_discount_rate = Column(Numeric(4, 2), default=0)
    discount_amount = Column(Numeric(12, 2), default=0)
    discount_approved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    discount_reason = Column(Text, nullable=True)
    # Member's own à la carte custom-order charges for the period, billed at
    # cost (food_cost, no markup) since MenuPrice is the guest-facing list.
    ala_carte_amount = Column(Numeric(12, 2), default=0)
    total_amount = Column(Numeric(12, 2), nullable=False, default=0)
    status = Column(Enum(MessBillStatus), default=MessBillStatus.DRAFT)
    generated_at = Column(DateTime, default=datetime.utcnow)
    generated_by = Column(Integer, ForeignKey("users.id"))

    member = relationship("Member")

    __table_args__ = (
        Index("uq_messbill_period", "member_id", "year", "month", unique=True),
    )


class GuestMealCharge(Base):
    """Guest meals sponsored by a member, folded into that member's
    MessBill.extra_meals_amount at generation time. No guest-identity
    table - Guest Management is out of scope, a free-text guest_name
    is enough here."""
    __tablename__ = "guest_meal_charges"

    id = Column(Integer, primary_key=True)
    sponsor_member_id = Column(Integer, ForeignKey("members.id"), nullable=False)
    guest_name = Column(String(200), nullable=False)
    date = Column(Date, nullable=False)
    meal_type = Column(Enum(MealType), nullable=False)
    amount = Column(Numeric(12, 2), nullable=False)
    notes = Column(Text)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)

    sponsor = relationship("Member")

    __table_args__ = (
        Index("idx_guestcharge_sponsor_date", "sponsor_member_id", "date"),
    )
