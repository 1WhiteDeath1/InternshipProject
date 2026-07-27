"""Billing domain: invoices, invoice line items, and payments."""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, Date, Text, ForeignKey, Enum, Numeric, Index
from sqlalchemy.orm import relationship
from backend.database import Base
from backend.models.enums import InvoiceStatus, EditRequestStatus


class Invoice(Base):
    __tablename__ = "invoices"

    id = Column(Integer, primary_key=True)
    invoice_number = Column(String(50), nullable=False, unique=True)
    # A bill belongs to exactly one of: a room stay (booking_id) or a
    # standalone walk-in mess guest with no room (guest_id). Both nullable so
    # the schema can express either; the routers enforce exactly-one.
    booking_id = Column(Integer, ForeignKey("bookings.id"), nullable=True)
    guest_id = Column(Integer, ForeignKey("guests.id"), nullable=True)
    # Set only for an event/hall-booking invoice (bill_type='event') - always
    # paired with guest_id (the event's contact), never with booking_id.
    event_id = Column(Integer, ForeignKey("events.id"), nullable=True)
    issue_date = Column(Date, nullable=False)
    due_date = Column(Date, nullable=False)
    subtotal = Column(Numeric(10, 2), nullable=False)
    tax_amount = Column(Numeric(10, 2), default=0)
    discount = Column(Numeric(10, 2), default=0)
    total_amount = Column(Numeric(10, 2), nullable=False)
    amount_paid = Column(Numeric(10, 2), default=0)
    status = Column(Enum(InvoiceStatus), default=InvoiceStatus.DRAFT)
    # Which of the two checkout bills this is: 'room' (guest room charges,
    # mattress, dhobi, breakage...) or 'mess' (messing/food charges). Older
    # single-bill invoices stay 'combined'.
    bill_type = Column(String(20), default="combined")  # room | mess | combined
    is_complimentary = Column(Boolean, default=False)
    complimentary_reason = Column(Text)
    notes = Column(Text)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)

    booking = relationship("Booking")
    guest = relationship("Guest")
    event = relationship("Event")
    items = relationship("InvoiceItem", back_populates="invoice")


class InvoiceItem(Base):
    __tablename__ = "invoice_items"

    id = Column(Integer, primary_key=True)
    invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=False)
    description = Column(String(255), nullable=False)
    quantity = Column(Float, default=1)
    unit_price = Column(Numeric(10, 2), nullable=False)
    total_price = Column(Numeric(10, 2), nullable=False)

    invoice = relationship("Invoice", back_populates="items")


class InvoicePayment(Base):
    __tablename__ = "invoice_payments"

    id = Column(Integer, primary_key=True)
    invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=False)
    amount = Column(Numeric(10, 2), nullable=False)
    method = Column(String(50))
    notes = Column(Text)
    received_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)

    invoice = relationship("Invoice")

    __table_args__ = (
        Index("idx_payment_invoice", "invoice_id"),
    )


class InvoiceEditRequest(Base):
    """A Clerk-proposed correction to one already-generated invoice line
    (wrong room rate, wrong mess charge...), sitting pending until a Manager
    approves or rejects it. Scoped to description/unit_price only - quantity
    is untouched and total_price is always derived. Distinct from the
    discount/complimentary action on Invoice, which stays Clerk-autonomous
    with no approval step."""
    __tablename__ = "invoice_edit_requests"

    id = Column(Integer, primary_key=True)
    invoice_item_id = Column(Integer, ForeignKey("invoice_items.id"), nullable=False)
    invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=False)
    original_description = Column(String(255), nullable=False)
    original_unit_price = Column(Numeric(10, 2), nullable=False)
    proposed_description = Column(String(255), nullable=False)
    proposed_unit_price = Column(Numeric(10, 2), nullable=False)
    reason = Column(Text, nullable=False)
    status = Column(Enum(EditRequestStatus), default=EditRequestStatus.PENDING)
    requested_by = Column(Integer, ForeignKey("users.id"))
    requested_at = Column(DateTime, default=datetime.utcnow)
    decided_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    decided_at = Column(DateTime, nullable=True)
    decision_reason = Column(Text, nullable=True)

    invoice_item = relationship("InvoiceItem")
    invoice = relationship("Invoice")

    __table_args__ = (
        Index("idx_editrequest_status", "status"),
    )
