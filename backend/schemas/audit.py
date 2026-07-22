"""Audit domain schemas."""
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, ConfigDict


class AuditLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    user_id: Optional[int]
    user_name: Optional[str]
    action: str
    entity_type: str
    entity_id: Optional[int]
    before_state: Optional[str]
    after_state: Optional[str]
    reason: Optional[str]
    department: Optional[str]
    timestamp: datetime
    ip_address: Optional[str]

class AuditLogList(BaseModel):
    items: List[AuditLogOut]
    total: int
