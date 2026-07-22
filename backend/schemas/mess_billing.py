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

class DiscountApplyRequest(BaseModel):
    discount_rate: Optional[float] = Field(None, ge=0, le=100)
    discount_amount: Optional[float] = Field(None, ge=0)
    reason: str = Field(..., min_length=1)

    @model_validator(mode="after")
    def _exactly_one(self):
        if (self.discount_rate is None) == (self.discount_amount is None):
            raise ValueError("Provide exactly one of discount_rate or discount_amount")
        return self

class ComplimentaryRequest(BaseModel):
    is_complimentary: bool = True
    reason: str = Field(..., min_length=1)
