"""Attendance domain schemas: per-meal consumption/booking records."""
from datetime import datetime, date
from typing import Optional, List
from pydantic import BaseModel, Field, ConfigDict, model_validator, field_validator
from backend.schemas.common import _ensure_meal_type, _check_exactly_one_consumer


class MealAttendanceBase(BaseModel):
    member_id: Optional[int] = None
    booking_id: Optional[int] = None
    guest_id: Optional[int] = None
    menu_item_id: Optional[int] = None
    date: date
    meal_type: str
    method: str = "manual"

    _check_meal_type = field_validator("meal_type")(_ensure_meal_type)

class MealAttendanceCreate(MealAttendanceBase):
    @model_validator(mode="after")
    def _exactly_one_consumer(self):
        _check_exactly_one_consumer(self.member_id, self.booking_id, self.guest_id)
        return self

class MealAttendanceOut(MealAttendanceBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    status: str
    booked_at: datetime
    marked_at: Optional[datetime] = None
    marked_by: Optional[int] = None
    member_name: Optional[str] = None
    guest_name: Optional[str] = None
    menu_item_name: Optional[str] = None

class AttendanceMarkRequest(BaseModel):
    status: str
    reason: Optional[str] = None

class BulkAttendanceCreate(BaseModel):
    member_ids: List[int] = Field(..., min_length=1)
    date: date
    meal_type: str
    method: str = "manual"

    _check_meal_type = field_validator("meal_type")(_ensure_meal_type)

class AttendanceLookupResult(BaseModel):
    kind: str  # "member" | "booking" | "guest"
    id: int
    name: str
    sub_label: Optional[str] = None
    menu_item_id: Optional[int] = None
    attendance_id: Optional[int] = None
    attendance_status: Optional[str] = None

class ServeAttendanceRequest(BaseModel):
    member_id: Optional[int] = None
    booking_id: Optional[int] = None
    guest_id: Optional[int] = None
    date: date
    meal_type: str
    menu_item_id: Optional[int] = None

    _check_meal_type = field_validator("meal_type")(_ensure_meal_type)

    @model_validator(mode="after")
    def _exactly_one_consumer(self):
        _check_exactly_one_consumer(self.member_id, self.booking_id, self.guest_id)
        return self

class NoShowSweepResult(BaseModel):
    count: int
    items: List[AttendanceLookupResult] = []
