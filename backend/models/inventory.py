"""Inventory domain: categories, items, stock batches/movements, waste, cycle counts."""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, Date, Text, ForeignKey, Enum, Numeric, Index
from sqlalchemy.orm import relationship
from backend.database import Base
from backend.models.enums import IngredientType, WasteCategory


class InventoryCategory(Base):
    __tablename__ = "inventory_categories"

    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=False, unique=True)
    description = Column(Text)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class InventoryItem(Base):
    __tablename__ = "inventory_items"

    id = Column(Integer, primary_key=True)
    sku = Column(String(100), nullable=False, unique=True)
    name = Column(String(200), nullable=False)
    category_id = Column(Integer, ForeignKey("inventory_categories.id"))
    description = Column(Text)
    unit = Column(String(50), nullable=False)  # kg, l, pcs, etc.
    reorder_level = Column(Float, default=0)
    reorder_quantity = Column(Float, default=0)
    # Nullable: only meaningful for cookable ingredients that need a
    # cup/tbsp/tsp <-> unit density bridge (see unit_conversion.py) - non-food
    # items and count-based ingredients (pcs) leave this unset.
    ingredient_type = Column(Enum(IngredientType), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    category = relationship("InventoryCategory")


class StockBatch(Base):
    __tablename__ = "stock_batches"

    id = Column(Integer, primary_key=True)
    item_id = Column(Integer, ForeignKey("inventory_items.id"), nullable=False)
    batch_number = Column(String(100), nullable=False)
    quantity = Column(Float, nullable=False, default=0)
    bin_location = Column(String(100))
    expiry_date = Column(Date, nullable=True)
    received_date = Column(Date, default=datetime.utcnow)
    unit_cost = Column(Numeric(12, 2), default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    item = relationship("InventoryItem")

    __table_args__ = (
        Index("idx_stock_item", "item_id"),
    )


class StockMovement(Base):
    __tablename__ = "stock_movements"

    id = Column(Integer, primary_key=True)
    batch_id = Column(Integer, ForeignKey("stock_batches.id"), nullable=False)
    item_id = Column(Integer, ForeignKey("inventory_items.id"), nullable=False)
    movement_type = Column(String(50), nullable=False)  # receipt, issue, adjustment, waste, recipe_deduction
    quantity = Column(Float, nullable=False)
    reference_type = Column(String(50))  # po, recipe, booking, etc.
    reference_id = Column(Integer)
    notes = Column(Text)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("idx_movement_batch", "batch_id"),
        Index("idx_movement_item", "item_id"),
        Index("idx_movement_type", "movement_type"),
    )


class WasteLog(Base):
    __tablename__ = "waste_logs"

    id = Column(Integer, primary_key=True)
    item_id = Column(Integer, ForeignKey("inventory_items.id"), nullable=False)
    batch_id = Column(Integer, ForeignKey("stock_batches.id"), nullable=True)
    quantity = Column(Float, nullable=False)
    category = Column(Enum(WasteCategory), nullable=False)
    note = Column(Text)
    cost = Column(Numeric(12, 2), default=0)
    logged_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)

    item = relationship("InventoryItem")


class CycleCount(Base):
    __tablename__ = "cycle_counts"

    id = Column(Integer, primary_key=True)
    item_id = Column(Integer, ForeignKey("inventory_items.id"), nullable=False)
    batch_id = Column(Integer, ForeignKey("stock_batches.id"), nullable=True)
    expected_quantity = Column(Float, nullable=False)
    actual_quantity = Column(Float, nullable=False)
    variance = Column(Float, nullable=False)
    variance_percentage = Column(Float)
    notes = Column(Text)
    counted_by = Column(Integer, ForeignKey("users.id"))
    status = Column(String(20), default="pending")  # pending, approved, rejected
    created_at = Column(DateTime, default=datetime.utcnow)

    item = relationship("InventoryItem")
