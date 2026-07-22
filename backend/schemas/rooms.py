"""Rooms domain schemas: rooms and attendants."""
from datetime import datetime, date
from typing import Optional
from pydantic import BaseModel, Field, ConfigDict


class AttendantBase(BaseModel):
    full_name: str = Field(..., min_length=1, max_length=200)
    phone: Optional[str] = None
    email: Optional[str] = None
    shift: Optional[str] = None

class AttendantCreate(AttendantBase):
    pass

class AttendantUpdate(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    shift: Optional[str] = None
    is_active: Optional[bool] = None

class AttendantOut(AttendantBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool
    on_duty: bool = False
    on_duty_since: Optional[datetime] = None
    photo_url: Optional[str] = None
    room_count: int = 0
    created_at: datetime


class AttendantDuty(BaseModel):
    on_duty: bool


class RoomBase(BaseModel):
    room_number: str = Field(..., min_length=1, max_length=20)
    room_type: str
    floor: int = 1
    capacity: int = 2
    base_price: float = Field(..., gt=0)
    amenities: Optional[str] = None

class RoomCreate(RoomBase):
    pass

class RoomUpdate(BaseModel):
    room_type: Optional[str] = None
    floor: Optional[int] = None
    capacity: Optional[int] = None
    base_price: Optional[float] = None
    amenities: Optional[str] = None
    status: Optional[str] = None

class RoomOut(RoomBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    status: str
    is_active: bool
    created_at: datetime
    current_guest: Optional[str] = None
    current_check_out: Optional[date] = None
