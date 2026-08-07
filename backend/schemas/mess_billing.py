"""Mess billing domain schemas: monthly member mess bills, sponsored guest meals, discounts."""
from datetime import datetime, date
from typing import Optional
from pydantic import BaseModel, Field, ConfigDict, model_validator, field_validator
from backend.schemas.common import _ensure_meal_type


class MessBillOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    member_id: int
    member_name: Optional[str] = None
    month: int
    year: int
    man_days: int
    per_head_rate: float
    base_menu_amount: float
    stay_amount: float
    extra_meals_amount: float
    applied_discount_rate: float
    discount_amount: float
    discount_approved_by: Optional[int] = None
    discount_reason: Optional[str] = None
    total_amount: float
    status: str
    generated_at: datetime

class GuestMealChargeCreate(BaseModel):
    sponsor_member_id: int
    guest_name: str = Field(..., min_length=1, max_length=200)
    date: date
    meal_type: str
    amount: float = Field(..., gt=0)
    notes: Optional[str] = None

    _check_meal_type = field_validator("meal_type")(_ensure_meal_type)

class GuestMealChargeOut(GuestMealChargeCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime

class MessBillChargeCreate(BaseModel):
    head: str = Field(..., min_length=1, max_length=100)
    amount: float = Field(..., gt=0)
    reason: str = Field(..., min_length=3, max_length=255)

class MessBillChargeCorrection(BaseModel):
    new_amount: float = Field(..., ge=0)
    correction_reason: str = Field(..., min_length=3, max_length=255)

class MessBillFieldCorrection(BaseModel):
    """Pre-lock correction of one of the three directly-stored MessBill
    columns the printed bill shows as its own row - "Extra Messing" is still
    composite/computed (not a single stored column), so it's not correctable
    through this endpoint."""
    field: str = Field(..., pattern="^(base_menu_amount|stay_amount|gas_amount)$")
    new_amount: float = Field(..., ge=0)
    correction_reason: str = Field(..., min_length=3, max_length=255)

class MessBillChargeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    mess_bill_id: int
    head: str
    amount: float
    reason: str
    created_at: datetime

class MessBillPaymentCreate(BaseModel):
    amount: float = Field(..., gt=0)
    method: Optional[str] = None
    voucher_number: Optional[str] = Field(None, max_length=50)
    notes: Optional[str] = None

    @model_validator(mode="after")
    def _voucher_required_for_online(self):
        if self.method == "Online/AG Branch" and not (self.voucher_number or "").strip():
            raise ValueError("Voucher Number is required for Online/AG Branch payments")
        return self

class MessBillPaymentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    mess_bill_id: int
    amount: float
    method: Optional[str] = None
    voucher_number: Optional[str] = None
    created_at: datetime


class MasterBillRow(BaseModel):
    label: str
    amount: float
    reason: Optional[str] = None

class MasterBillOut(BaseModel):
    """The universal paper-form bill (services/master_bill.py) - same shape
    regardless of whether it's assembled from a guest Invoice or a member
    MessBill, so the Interactive Invoice Table and print template are one
    component for both."""
    source: str  # "invoice" | "mess_bill"
    source_id: int
    header: dict
    rows: list[MasterBillRow]
    last_debit_balance: float
    total_debit: float
    credits: float
    net_debits: float
    bill_serial_number: Optional[str] = None
    bill_made_at: Optional[datetime] = None
    preset_heads: list[str]


class DiscountApplyRequest(BaseModel):
    discount_rate: Optional[float] = Field(None, ge=0, le=100)
    discount_amount: Optional[float] = Field(None, ge=0)
    reason: str = Field(..., min_length=1)

    @model_validator(mode="after")
    def _exactly_one(self):
        if (self.discount_rate is None) == (self.discount_amount is None):
            raise ValueError("Provide exactly one of discount_rate or discount_amount")
        return self
