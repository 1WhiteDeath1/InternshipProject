"""Kitchen domain: an editable menu (Kitchen NCO proposes, Manager approves),
kitchen production orders, and the gas charge percentage rate that feeds
guest bills (the Extra Messing total itself is always computed from actual
orders - see backend/services/mess_charge_calc.py)."""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Date, Text, ForeignKey, Numeric, Enum
from sqlalchemy.orm import relationship
from backend.database import Base
from backend.models.enums import MealType, EditRequestStatus


class MenuItem(Base):
    """One dish. day_of_week is null for items not tied to a specific day's
    rotation (e.g. an always-available a la carte item); Sunday's separate
    Afternoon/Night specials map onto lunch/dinner respectively - there's no
    dedicated slot for them, they just add more rows for that day/meal."""
    __tablename__ = "menu_items"

    id = Column(Integer, primary_key=True)
    name = Column(String(200), nullable=False)
    meal_type = Column(Enum(MealType), nullable=False)
    day_of_week = Column(String(10), nullable=True)  # monday..sunday, or null
    price = Column(Numeric(12, 2), nullable=False, default=0)  # editable estimate, not a costed figure
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class MenuItemEditRequest(Base):
    """Kitchen NCO's proposed add/edit, pending Manager sign-off - the menu
    itself never changes until approved. menu_item_id is null for a brand
    new item proposal (is_new_item=True); non-null for editing an existing
    row (proposed_* mirrors that item's fields with the requested change)."""
    __tablename__ = "menu_item_edit_requests"

    id = Column(Integer, primary_key=True)
    menu_item_id = Column(Integer, ForeignKey("menu_items.id"), nullable=True)
    is_new_item = Column(Boolean, default=False)
    proposed_name = Column(String(200), nullable=False)
    proposed_price = Column(Numeric(12, 2), nullable=False)
    proposed_meal_type = Column(Enum(MealType), nullable=False)
    proposed_day_of_week = Column(String(10), nullable=True)
    reason = Column(Text, nullable=True)
    status = Column(Enum(EditRequestStatus), default=EditRequestStatus.PENDING)
    requested_by = Column(Integer, ForeignKey("users.id"))
    requested_at = Column(DateTime, default=datetime.utcnow)
    decided_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    decided_at = Column(DateTime, nullable=True)
    decision_reason = Column(Text, nullable=True)

    menu_item = relationship("MenuItem")


class GasChargeRate(Base):
    """The Sui Gas Charges on Messing percentage, set directly by the Kitchen
    NCO - no approval gate, unlike menu pricing. Applied to a consumer's
    computed Extra Messing total (see backend/services/mess_charge_calc.py)
    to get the gas charge amount; still overridable per checkout. A single
    row (no key needed - there used to be a matching flat "mess" rate here
    too, but Extra Messing is now always computed from actual orders, never
    a settable rate)."""
    __tablename__ = "gas_charge_rate"

    id = Column(Integer, primary_key=True)
    percentage = Column(Numeric(5, 2), nullable=False, default=0)
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class GasChargeRateHistory(Base):
    """One row per percentage change - a real time series (unlike AuditLog's
    generic JSON blobs) so the Manager's trend graph can query it directly."""
    __tablename__ = "gas_charge_rate_history"

    id = Column(Integer, primary_key=True)
    old_percentage = Column(Numeric(5, 2), nullable=False)
    new_percentage = Column(Numeric(5, 2), nullable=False)
    changed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    changed_at = Column(DateTime, default=datetime.utcnow)


class KitchenOrder(Base):
    __tablename__ = "kitchen_orders"

    id = Column(Integer, primary_key=True)
    menu_item_id = Column(Integer, ForeignKey("menu_items.id"), nullable=False)
    quantity_ordered = Column(Integer, nullable=False, default=1)
    actual_portions = Column(Integer)
    status = Column(String(20), default="pending")  # pending, prepared, served, cancelled
    notes = Column(Text)
    # Set when an order is auto-generated from that day's bookings, so the
    # generate step stays idempotent and traceable (manual orders leave these null).
    meal_date = Column(Date, nullable=True)
    meal_type = Column(String(20), nullable=True)
    source = Column(String(20), nullable=True)  # manual | auto_from_bookings
    ordered_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)

    # --- À la carte custom-order fields (is_ala_carte=True only) ---
    # A la carte orders are attributed to one specific consumer for billing -
    # MealAttendance can't hold this (its unique constraint allows only one row
    # per person per date/meal_type, but a guest may order several custom
    # dishes in a day), so the link lives here instead.
    is_ala_carte = Column(Boolean, default=False)
    consumer_type = Column(String(20), nullable=True)  # "member" | "guest"
    member_id = Column(Integer, ForeignKey("members.id"), nullable=True)
    booking_id = Column(Integer, ForeignKey("bookings.id"), nullable=True)
    sla_minutes = Column(Integer, nullable=True)
    due_at = Column(DateTime, nullable=True)  # fixed at creation; later SystemSetting changes don't move it
    cooking_started_at = Column(DateTime, nullable=True)  # set the instant status -> "cooking"
    escalated_at = Column(DateTime, nullable=True)  # idempotency guard: >15min-overdue admin alert posted once
    invoiced_at = Column(DateTime, nullable=True)  # set once pulled into a MessBill/Invoice, guards double-billing

    menu_item = relationship("MenuItem")
    member = relationship("Member")
    booking = relationship("Booking")
