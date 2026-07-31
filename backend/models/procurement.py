"""Procurement domain: vendors (lookup list for self-purchase intake - see
inventory.StockBatch.vendor_id). The mess buys and restocks its own
ingredients directly; there is no external vendor fulfilling an order, so
there is no purchase-order/receiving/three-way-match workflow here."""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, Text
from backend.database import Base


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
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
