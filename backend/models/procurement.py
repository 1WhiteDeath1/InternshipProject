"""Procurement domain: vendors, purchase orders, three-way match."""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, Date, Text, ForeignKey, Enum, Numeric
from sqlalchemy.orm import relationship
from backend.database import Base
from backend.models.enums import POStatus


class Vendor(Base):
    __tablename__ = "vendors"

    id = Column(Integer, primary_key=True)
    name = Column(String(200), nullable=False)
    contact_person = Column(String(200))
    phone = Column(String(50))
    email = Column(String(255))
    address = Column(Text)
    tax_id = Column(String(100))
    payment_terms = Column(String(100))
    delivery_accuracy = Column(Float, default=100.0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"

    id = Column(Integer, primary_key=True)
    po_number = Column(String(50), nullable=False, unique=True)
    vendor_id = Column(Integer, ForeignKey("vendors.id"), nullable=False)
    status = Column(Enum(POStatus), default=POStatus.DRAFT)
    total_amount = Column(Numeric(12, 2), default=0)
    expected_delivery = Column(Date, nullable=True)
    notes = Column(Text)
    approved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_at = Column(DateTime)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    vendor = relationship("Vendor")
    items = relationship("PurchaseOrderItem", back_populates="purchase_order")


class PurchaseOrderItem(Base):
    __tablename__ = "purchase_order_items"

    id = Column(Integer, primary_key=True)
    po_id = Column(Integer, ForeignKey("purchase_orders.id"), nullable=False)
    item_id = Column(Integer, ForeignKey("inventory_items.id"), nullable=False)
    quantity_ordered = Column(Float, nullable=False)
    quantity_delivered = Column(Float, default=0)
    quantity_received = Column(Float, default=0)
    unit_price = Column(Numeric(12, 2), nullable=False)
    total_price = Column(Numeric(12, 2), nullable=False)

    purchase_order = relationship("PurchaseOrder", back_populates="items")
    inventory_item = relationship("InventoryItem")


class ThreeWayMatch(Base):
    __tablename__ = "three_way_matches"

    id = Column(Integer, primary_key=True)
    po_id = Column(Integer, ForeignKey("purchase_orders.id"), nullable=False)
    po_quantity = Column(Float, nullable=False)
    delivery_quantity = Column(Float, nullable=False)
    received_quantity = Column(Float, nullable=False)
    variance = Column(Float, nullable=False)
    tolerance_percent = Column(Float, default=5.0)
    is_matched = Column(Boolean, default=False)
    discrepancy_reason = Column(Text)
    resolved = Column(Boolean, default=False)
    resolved_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)
