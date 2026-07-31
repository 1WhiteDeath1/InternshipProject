"""Inventory domain schemas."""
from datetime import datetime, date
from typing import Optional, List
from pydantic import BaseModel, Field, ConfigDict


class InventoryCategoryBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None

class InventoryCategoryCreate(InventoryCategoryBase):
    pass

class InventoryCategoryOut(InventoryCategoryBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool
    created_at: datetime

class InventoryItemBase(BaseModel):
    sku: str = Field(..., min_length=1, max_length=100)
    name: str = Field(..., min_length=1, max_length=200)
    category_id: int
    description: Optional[str] = None
    unit: str = Field(..., min_length=1, max_length=50)
    reorder_level: float = 0
    reorder_quantity: float = 0

class InventoryItemCreate(InventoryItemBase):
    pass

class InventoryItemUpdate(BaseModel):
    sku: Optional[str] = None
    name: Optional[str] = None
    category_id: Optional[int] = None
    description: Optional[str] = None
    unit: Optional[str] = None
    reorder_level: Optional[float] = None
    reorder_quantity: Optional[float] = None

class InventoryItemOut(InventoryItemBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool
    created_at: datetime
    category_name: Optional[str] = None
    total_stock: float = 0
    last_unit_cost: Optional[float] = None
    last_vendor_id: Optional[int] = None
    last_vendor_name: Optional[str] = None
    last_purchased_at: Optional[str] = None

class StockBatchBase(BaseModel):
    item_id: int
    batch_number: str = Field(..., min_length=1, max_length=100)
    quantity: float = Field(..., gt=0)
    bin_location: Optional[str] = None
    expiry_date: Optional[date] = None
    unit_cost: float = 0

class StockBatchCreate(StockBatchBase):
    pass

class StockBatchOut(StockBatchBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    received_date: date
    is_active: bool
    item_name: Optional[str] = None

class StockMovementCreate(BaseModel):
    batch_id: int
    item_id: int
    movement_type: str
    quantity: float = Field(..., gt=0)
    reference_type: Optional[str] = None
    reference_id: Optional[int] = None
    notes: Optional[str] = None

class WasteLogCreate(BaseModel):
    item_id: int
    batch_id: Optional[int] = None
    quantity: float = Field(..., gt=0)
    category: str
    note: Optional[str] = None
    cost: float = 0

class WasteLogOut(WasteLogCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    item_name: Optional[str] = None
    logged_by: Optional[int] = None
    created_at: datetime

class CycleCountCreate(BaseModel):
    item_id: int
    batch_id: Optional[int] = None
    expected_quantity: float
    actual_quantity: float
    notes: Optional[str] = None


class StockIntakeCreate(BaseModel):
    item_id: int
    quantity: float = Field(..., gt=0)
    total_cost: float = Field(..., gt=0)
    vendor_id: Optional[int] = None


class ReceiptConfirmLine(BaseModel):
    item_id: int
    quantity: float = Field(..., gt=0)
    total_cost: float = Field(..., gt=0)
    raw_name: Optional[str] = None  # kept for the audit log, not used for lookup


class ReceiptConfirmRequest(BaseModel):
    lines: List[ReceiptConfirmLine]
    receipt_batch_id: Optional[str] = None
