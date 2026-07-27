"""Events domain schemas - see backend/models/events.py for the workflow."""
from datetime import date
from typing import Optional
from pydantic import BaseModel, Field


class EventMenuItemCreate(BaseModel):
    dish_name: str = Field(..., min_length=1, max_length=200)
    estimated_price: float = Field(..., ge=0)
    quantity: int = Field(..., ge=1)


class EventCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    guest_name: str = Field(..., min_length=1, max_length=200)
    guest_phone: Optional[str] = None
    hall_name: str = Field(..., min_length=1, max_length=100)
    capacity: int = Field(..., ge=1)
    headcount: int = Field(..., ge=1)
    event_date: date
    requirements: Optional[str] = None
    arrangement: Optional[str] = None
    billing_type: str = "split"  # split | single_payer


class EventUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    hall_name: Optional[str] = Field(None, min_length=1, max_length=100)
    capacity: Optional[int] = Field(None, ge=1)
    headcount: Optional[int] = Field(None, ge=1)
    event_date: Optional[date] = None
    requirements: Optional[str] = None
    arrangement: Optional[str] = None
    billing_type: Optional[str] = None


class EventStatusUpdate(BaseModel):
    status: str  # menu_set | preparing | completed | cancelled


class EventPostponeRequest(BaseModel):
    new_date: date
    reason: str = Field(..., min_length=1)
