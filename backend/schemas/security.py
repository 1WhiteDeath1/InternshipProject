"""Security domain schemas: security logs and incident reports."""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field, ConfigDict, field_validator
from backend.models.enums import AlertSeverity


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

    # The IncidentReport.severity column is a strict Enum(AlertSeverity) - an
    # out-of-enum string used to pass this bare str field and crash uncaught
    # at the DB layer instead of returning a clean validation error.
    @field_validator("severity")
    @classmethod
    def _validate_severity(cls, v: str) -> str:
        valid = [e.value for e in AlertSeverity]
        if v not in valid:
            raise ValueError(f"severity must be one of {valid}")
        return v

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
