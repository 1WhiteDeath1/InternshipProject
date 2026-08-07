"""Billing domain schemas: invoices, payments, ad-hoc booking charges."""
from datetime import datetime, date
from typing import Optional, List
from pydantic import BaseModel, Field, ConfigDict, model_validator


class GuestInvoiceSummary(BaseModel):
    """An invoice, summarized for a guest's profile (schemas.guests.GuestProfileOut)."""
    id: int
    invoice_number: str
    bill_type: str
    issue_date: date
    total_amount: float
    amount_paid: float
    status: str
    is_complimentary: bool = False


class InvoiceItemCreate(BaseModel):
    description: str
    quantity: float = Field(1, gt=0)
    unit_price: float = Field(..., ge=0)
    # Preview-only metadata (never persisted to InvoiceItem - _build_invoice
    # only reads description/quantity/unit_price) so the Clerk Desk checkout
    # dialog can tell a computed rate component (individually correctable)
    # apart from a fixed structural line (Extra Mattress/Late Fee) and an
    # ad-hoc BookingCharge (removable, has a real charge_id) without
    # re-parsing the description string. See billing.py's _gather_unbilled_items.
    component_key: Optional[str] = None
    charge_id: Optional[int] = None

class InvoiceBase(BaseModel):
    booking_id: int
    issue_date: date
    due_date: date
    subtotal: float
    tax_amount: float = Field(0, ge=0)
    discount: float = Field(0, ge=0)
    total_amount: float
    notes: Optional[str] = None

class InvoiceItemOut(InvoiceItemCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    total_price: float
    reason: Optional[str] = None

class MasterBillLineCreate(BaseModel):
    head: str = Field(..., min_length=1, max_length=100)
    amount: float = Field(..., gt=0)
    reason: str = Field(..., min_length=3, max_length=255)

class MasterBillLineCorrection(BaseModel):
    """Pre-lock inline correction of an already-populated line in the
    Interactive Master Bill Table - the reason is mandatory (unlike a fresh
    ad-hoc charge) since this overwrites a value someone else already
    entered/computed, and it drives the auto-dispatched Manager alert."""
    new_amount: float = Field(..., ge=0)
    correction_reason: str = Field(..., min_length=3, max_length=255)

class LastDebitBalanceUpdate(BaseModel):
    last_debit_balance: float = Field(..., ge=0)

class InvoiceOut(InvoiceBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    invoice_number: str
    status: str
    amount_paid: float
    created_at: datetime
    items: List[InvoiceItemOut] = []
    guest_name: Optional[str] = None
    room_number: Optional[str] = None


class BookingChargeCreate(BaseModel):
    head: str = Field(..., min_length=1, max_length=100)  # e.g. Dhobi, Breakage, Allied Charges
    amount: float = Field(..., gt=0)
    is_mess_charge: bool = False  # True routes the line onto the mess/food bill
    # Optional for every preset head except "Allied Charges" (enforced in
    # add_booking_charge) - that one's a catch-all ambiguous enough to need
    # an explanation; every other preset head is already self-explanatory.
    reason: Optional[str] = Field(None, max_length=255)

# Split-payment methods - see PAYMENT_METHODS in routers/billing.py, which
# is the single source of truth this list mirrors.
PAYMENT_METHODS = ("Online/AG Branch", "Bank Transfer", "Cash Deposit")

class PaymentCreate(BaseModel):
    amount: float = Field(..., gt=0)
    method: Optional[str] = None
    voucher_number: Optional[str] = Field(None, max_length=50)
    notes: Optional[str] = None

    @model_validator(mode="after")
    def _voucher_required_for_online(self):
        if self.method == "Online/AG Branch" and not (self.voucher_number or "").strip():
            raise ValueError("Voucher Number is required for Online/AG Branch payments")
        return self

class PaymentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    invoice_id: int
    amount: float
    method: Optional[str] = None
    voucher_number: Optional[str] = None
    notes: Optional[str] = None
    received_by: Optional[int] = None
    created_at: datetime


class InvoiceEditRequestCreate(BaseModel):
    proposed_description: str = Field(..., min_length=1, max_length=255)
    proposed_unit_price: float = Field(..., ge=0)
    reason: str = Field(..., min_length=1)

class InvoiceEditRequestOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    invoice_id: int
    invoice_item_id: Optional[int] = None
    bill_type: str
    original_description: str
    original_unit_price: float
    proposed_description: str
    proposed_unit_price: float
    reason: str
    status: str
    requested_by_name: Optional[str] = None
    requested_at: datetime
    decided_by_name: Optional[str] = None
    decided_at: Optional[datetime] = None
    decision_reason: Optional[str] = None
    guest_name: Optional[str] = None
    room_number: Optional[str] = None

class InvoiceEditDecision(BaseModel):
    reason: Optional[str] = None
