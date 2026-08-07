"""Hotel operational expenses domain: ad-hoc Clerk-logged spend (Gas,
Electricity, Repairs...) that isn't part of either billing pipeline - money
going out, not money owed by a guest/member."""
from datetime import datetime, date
from sqlalchemy import Column, Integer, String, DateTime, Date, Text, ForeignKey, Numeric, Index
from sqlalchemy.orm import relationship
from backend.database import Base


class Expense(Base):
    __tablename__ = "expenses"

    id = Column(Integer, primary_key=True)
    name = Column(String(200), nullable=False)  # e.g. "Diesel refill", "Plumber - Room 12 leak"
    category = Column(String(100), nullable=False)  # free text with UI presets: Gas, Electricity, Repairs...
    amount = Column(Numeric(10, 2), nullable=False)
    expense_date = Column(Date, nullable=False, default=date.today)
    # Utility bill / vendor invoice reference number for audit trail - e.g.
    # the account number printed on a Sui Gas or electricity bill.
    bill_reference_no = Column(String(100), nullable=True)
    # A scanned copy/screenshot of the physical bill (PNG/JPG/PDF, up to
    # 5MB - see routers/expenses.py upload endpoint). attachment_path is
    # relative to UPLOADS_DIR/expenses, served statically at /uploads/... -
    # see main.py's StaticFiles mount.
    attachment_path = Column(String(255), nullable=True)
    attachment_filename = Column(String(255), nullable=True)
    notes = Column(Text)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)

    creator = relationship("User")

    __table_args__ = (
        Index("idx_expense_date", "expense_date"),
        Index("idx_expense_category", "category"),
    )
