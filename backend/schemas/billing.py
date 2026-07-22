"""Billing domain schemas: invoices, payments, ad-hoc booking charges."""
from datetime import datetime, date
from typing import Optional, List
from pydantic import BaseModel, Field, ConfigDict


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
    is_meal_charge: bool = False  # if true, unit_price is scaled by the booking's client_category meal multiplier

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

class PaymentCreate(BaseModel):
    amount: float = Field(..., gt=0)
    method: Optional[str] = None
    notes: Optional[str] = None

class PaymentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    invoice_id: int
    amount: float
    method: Optional[str] = None
    notes: Optional[str] = None
    received_by: Optional[int] = None
    created_at: datetime
