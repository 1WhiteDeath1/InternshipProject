"""Expenses domain schemas."""
from datetime import datetime, date
from typing import Optional
from pydantic import BaseModel, Field, ConfigDict


class ExpenseCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    category: str = Field(..., min_length=1, max_length=100)
    amount: float = Field(..., gt=0)
    expense_date: date
    bill_reference_no: Optional[str] = Field(None, max_length=100)
    notes: Optional[str] = None

class ExpenseOut(ExpenseCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    attachment_path: Optional[str] = None
    attachment_filename: Optional[str] = None
    created_by: Optional[int] = None
    created_by_name: Optional[str] = None
    created_at: datetime
