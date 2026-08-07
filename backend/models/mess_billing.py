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
    # Sui Gas Charges on Messing for this member's routine dining this period -
    # see mess_charge_calc.get_member_gas_total. Computed fresh by
    # generate_bills, editable via correct_mess_bill_field like base_menu_amount/
    # stay_amount (replaces the old read-only "% of Extra Messing" estimate).
    gas_amount = Column(Numeric(12, 2), default=0)
    applied_discount_rate = Column(Numeric(4, 2), default=0)
    discount_amount = Column(Numeric(12, 2), default=0)
    discount_approved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    discount_reason = Column(Text, nullable=True)
    # Member's own à la carte custom-order charges for the period, billed at
    # MenuItem.price - same rate guests pay, since there's no separate
    # ingredient-cost figure to bill members "at cost" anymore.
    ala_carte_amount = Column(Numeric(12, 2), default=0)
    total_amount = Column(Numeric(12, 2), nullable=False, default=0)
    # Clerk-entered carry-forward balance from the prior period's paper bill
    # (see master_bill.py) - sums into the printed Total Debit/Net Debits,
    # not into total_amount (which stays the pure dining/stay computation
    # generate_bills produces, so re-running generation for the period is
    # never polluted by a manually-entered figure).
    last_debit_balance = Column(Numeric(12, 2), default=0)
    amount_paid = Column(Numeric(12, 2), default=0)
    # Manually-entered physical bill-book serial, matching Invoice.bill_serial_number.
    bill_serial_number = Column(String(50), nullable=True)
    # Null = still a draft in the Interactive Invoice Table (freely editable);
    # set by "Make Bill" - locks further editing and enables Print.
    bill_made_at = Column(DateTime, nullable=True)
    status = Column(Enum(MessBillStatus), default=MessBillStatus.DRAFT)
    generated_at = Column(DateTime, default=datetime.utcnow)
    generated_by = Column(Integer, ForeignKey("users.id"))

    member = relationship("Member")

    __table_args__ = (
        Index("uq_messbill_period", "member_id", "year", "month", unique=True),
    )


class MessBillCharge(Base):
    """Ad-hoc charge against a member's mess bill - the MessBill-side
    equivalent of BookingCharge, so a member's bill can carry the same
    paper-form line items (Masjid, Library, Sweeper, Band Fund...) a guest's
    room bill already can via BookingCharge. A dedicated table rather than a
    nullable second owner column on BookingCharge, since booking_id there
    has been NOT NULL since inception - relaxing that on SQLite means a full
    table rebuild, not a plain ALTER TABLE ADD COLUMN."""
    __tablename__ = "mess_bill_charges"

    id = Column(Integer, primary_key=True)
    mess_bill_id = Column(Integer, ForeignKey("mess_bills.id"), nullable=False)
    head = Column(String(100), nullable=False)
    amount = Column(Numeric(10, 2), nullable=False)
    reason = Column(String(255), nullable=False)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)

    mess_bill = relationship("MessBill")

    __table_args__ = (
        Index("idx_messbillcharge_bill", "mess_bill_id"),
    )


class MessBillPayment(Base):
    """Payment against a member's mess bill - MessBill had no payment/receipt
    concept at all until now (members were assumed to settle in full when the
    bill was generated). Mirrors InvoicePayment so the same Payment Receipt
    Slip template can print for either."""
    __tablename__ = "mess_bill_payments"

    id = Column(Integer, primary_key=True)
    mess_bill_id = Column(Integer, ForeignKey("mess_bills.id"), nullable=False)
    amount = Column(Numeric(10, 2), nullable=False)
    method = Column(String(50))
    # Required when method is online_ag_branch, optional for bank_transfer -
    # mirrors InvoicePayment.voucher_number (see billing.py's PaymentCreate).
    voucher_number = Column(String(50), nullable=True)
    notes = Column(Text)
    received_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)

    mess_bill = relationship("MessBill")

    __table_args__ = (
        Index("idx_messbillpayment_bill", "mess_bill_id"),
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
