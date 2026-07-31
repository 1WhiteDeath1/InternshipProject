"""Directives domain schemas."""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class DirectiveCreate(BaseModel):
    to_role_id: int
    message: str = Field(..., min_length=1, max_length=2000)


class DirectiveOut(BaseModel):
    id: int
    from_user_id: int
    from_user_name: Optional[str] = None
    to_role_id: int
    to_role_name: Optional[str] = None
    message: str
    status: str
    acknowledged_by: Optional[int] = None
    acknowledged_by_name: Optional[str] = None
    acknowledged_at: Optional[datetime] = None
    created_at: datetime
