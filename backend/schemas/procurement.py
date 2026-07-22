"""Procurement domain schemas: vendors, purchase orders, three-way match."""
from datetime import datetime, date
from typing import Optional, List
from pydantic import BaseModel, Field, ConfigDict


class VendorBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    tax_id: Optional[str] = None
    payment_terms: Optional[str] = None

class VendorCreate(VendorBase):
    pass

class VendorUpdate(VendorBase):
    name: Optional[str] = None

class VendorOut(VendorBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    delivery_accuracy: float
    is_active: bool
    created_at: datetime


class POItemBase(BaseModel):
    item_id: int
    quantity_ordered: float = Field(..., gt=0)
    unit_price: float = Field(..., gt=0)

class POItemOut(POItemBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    quantity_delivered: float
    quantity_received: float
    total_price: float
    item_name: Optional[str] = None

class PurchaseOrderBase(BaseModel):
    vendor_id: int
    expected_delivery: Optional[date] = None
    notes: Optional[str] = None

class PurchaseOrderCreate(PurchaseOrderBase):
    items: List[POItemBase]

class PurchaseOrderUpdate(BaseModel):
    status: Optional[str] = None
    expected_delivery: Optional[date] = None
    notes: Optional[str] = None

class PurchaseOrderOut(PurchaseOrderBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    po_number: str
    status: str
    total_amount: float
    created_at: datetime
    vendor_name: Optional[str] = None
    items: List[POItemOut] = []

class ReceivingItem(BaseModel):
    po_item_id: int
    quantity: float = Field(..., ge=0)

class ReceivingQuantities(BaseModel):
    items: List[ReceivingItem]

class ThreeWayMatchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    po_id: int
    po_quantity: float
    delivery_quantity: float
    received_quantity: float
    variance: float
    is_matched: bool
    created_at: datetime
