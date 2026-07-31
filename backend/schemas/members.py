"""Members domain schemas: the resident officer/member roster and leave."""
from datetime import datetime, date
from typing import Optional
from pydantic import BaseModel, Field, ConfigDict, model_validator


class MemberBase(BaseModel):
    service_number: str = Field(..., min_length=1, max_length=50)
    full_name: str = Field(..., min_length=1, max_length=200)
    rank: str = Field(..., min_length=1, max_length=50)
    unit: Optional[str] = None
    mess_category: str
    is_womens_bloc: bool = False
    dining_status: str = "dining"
    phone: Optional[str] = None
    email: Optional[str] = None
    custom_discount_rate: float = Field(0, ge=0, le=100)

class MemberCreate(MemberBase):
    pass

class MemberUpdate(BaseModel):
    full_name: Optional[str] = None
    rank: Optional[str] = None
    unit: Optional[str] = None
    mess_category: Optional[str] = None
    is_womens_bloc: Optional[bool] = None
    dining_status: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    status: Optional[str] = None
    custom_discount_rate: Optional[float] = Field(None, ge=0, le=100)

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
