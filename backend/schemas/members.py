"""Members domain schemas: the resident officer/member roster and leave."""
from datetime import datetime, date
from typing import Optional
from pydantic import BaseModel, Field, ConfigDict, model_validator, field_validator
from backend.models.enums import MessCategory, DiningStatus


_HRA_STAY_TYPES = ("in_mess", "out_of_mess")


class MemberBase(BaseModel):
    service_number: str = Field(..., min_length=1, max_length=50)
    full_name: str = Field(..., min_length=1, max_length=200)
    rank: str = Field(..., min_length=1, max_length=50)
    unit: Optional[str] = None
    mess_category: str
    is_womens_bloc: bool = False
    dining_status: str = "dining"
    is_hra: bool = False
    hra_stay_type: Optional[str] = None
    dorm_location: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    custom_discount_rate: float = Field(0, ge=0, le=100)

    # Both columns are strict SQLAlchemy Enums (Member.mess_category,
    # Member.dining_status) - an out-of-enum string used to pass these bare
    # str fields and crash uncaught at the DB layer instead of a clean 422.
    @field_validator("mess_category")
    @classmethod
    def _validate_mess_category(cls, v: str) -> str:
        valid = [e.value for e in MessCategory]
        if v not in valid:
            raise ValueError(f"mess_category must be one of {valid}")
        return v

    @field_validator("dining_status")
    @classmethod
    def _validate_dining_status(cls, v: str) -> str:
        valid = [e.value for e in DiningStatus]
        if v not in valid:
            raise ValueError(f"dining_status must be one of {valid}")
        return v

    @field_validator("hra_stay_type")
    @classmethod
    def _validate_hra_stay_type(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in _HRA_STAY_TYPES:
            raise ValueError(f"hra_stay_type must be one of {_HRA_STAY_TYPES}")
        return v

    @model_validator(mode="after")
    def _check_hra_fields(self):
        if self.is_hra:
            if not self.hra_stay_type:
                raise ValueError("hra_stay_type is required when is_hra is true")
            if self.hra_stay_type == "out_of_mess" and not (self.dorm_location or "").strip():
                raise ValueError("dorm_location is required for an out-of-mess HRA member")
        if not self.is_hra or self.hra_stay_type == "in_mess":
            # Room comes from the active HRA Booking for an in-mess resident
            # (or doesn't apply at all for a non-HRA member) - never both a
            # dorm_location AND a real room at once.
            self.dorm_location = None
        if not self.is_hra:
            self.hra_stay_type = None
        return self

class MemberCreate(MemberBase):
    pass

class MemberUpdate(BaseModel):
    full_name: Optional[str] = None
    rank: Optional[str] = None
    unit: Optional[str] = None
    mess_category: Optional[str] = None
    is_womens_bloc: Optional[bool] = None
    dining_status: Optional[str] = None
    is_hra: Optional[bool] = None
    hra_stay_type: Optional[str] = None
    dorm_location: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    status: Optional[str] = None
    custom_discount_rate: Optional[float] = Field(None, ge=0, le=100)

    @field_validator("hra_stay_type")
    @classmethod
    def _validate_hra_stay_type(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in _HRA_STAY_TYPES:
            raise ValueError(f"hra_stay_type must be one of {_HRA_STAY_TYPES}")
        return v

class MemberStatusChange(BaseModel):
    status: str
    reason: str = Field(..., min_length=1)

class MemberOut(MemberBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    client_category: str
    status: str
    created_at: datetime
    updated_at: datetime


class MemberLeaveBase(BaseModel):
    member_id: int
    start_date: date
    end_date: date
    reason: Optional[str] = None

    @model_validator(mode="after")
    def _check_dates(self):
        if self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        return self

class MemberLeaveCreate(MemberLeaveBase):
    pass

class MemberLeaveOut(MemberLeaveBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    status: str
    created_at: datetime
    member_name: Optional[str] = None
