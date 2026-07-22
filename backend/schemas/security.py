"""Security domain schemas: security logs and incident reports."""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field, ConfigDict


class SecurityLogCreate(BaseModel):
    event_type: str
    booking_id: Optional[int] = None
    guest_name: Optional[str] = None
    room_number: Optional[str] = None
    notes: Optional[str] = None

class SecurityLogOut(SecurityLogCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    timestamp: datetime
    processed_by: Optional[int] = None

class IncidentReportBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    description: str
    location: Optional[str] = None
    category: Optional[str] = None
    severity: str = "low"

class IncidentReportCreate(IncidentReportBase):
    pass

class IncidentReportUpdate(BaseModel):
    status: Optional[str] = None
    resolution: Optional[str] = None

class IncidentReportOut(IncidentReportBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    status: str
    reported_by: Optional[int] = None
    created_at: datetime
    resolved_at: Optional[datetime] = None
