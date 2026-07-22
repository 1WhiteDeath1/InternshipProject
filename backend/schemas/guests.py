"""Guests domain schemas: persistent walk-in guest identity."""
from datetime import datetime, date
from typing import Optional, List
from pydantic import BaseModel, Field, ConfigDict
from backend.schemas.bookings import GuestBookingSummary
from backend.schemas.billing import GuestInvoiceSummary


class GuestOut(BaseModel):
    id: int
    full_name: str
    phone: Optional[str] = None
    id_type: Optional[str] = None
    id_number: Optional[str] = None
    unit_address: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)

class GuestListItem(BaseModel):
    id: int
    full_name: str
    id_number: Optional[str] = None
    phone: Optional[str] = None
    classification: Optional[str] = None  # latest booking's client_category
    rank: Optional[str] = None  # latest booking's rank, if any
    last_arrival_date: Optional[date] = None
    total_arrivals: int = 0

class GuestListResponse(BaseModel):
    items: List[GuestListItem]
    total: int
    page: int
    page_size: int

class GuestProfileOut(BaseModel):
    id: int
    full_name: str
    phone: Optional[str] = None
    id_type: Optional[str] = None
    id_number: Optional[str] = None
    unit_address: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    bookings: List[GuestBookingSummary] = []
    invoices: List[GuestInvoiceSummary] = []

class GuestQuickCreate(BaseModel):
    full_name: str = Field(..., min_length=1, max_length=200)
    phone: Optional[str] = None
