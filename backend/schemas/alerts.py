"""Alerts domain schemas."""
from datetime import datetime
from pydantic import BaseModel, ConfigDict


class AlertOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    message: str
    severity: str
    status: str
    module: str
    created_at: datetime

class AlertAcknowledge(BaseModel):
    status: str
