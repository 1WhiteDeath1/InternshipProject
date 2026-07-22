"""Billing domain migrations."""
from sqlalchemy import text
from backend.logging_config import get_logger

logger = get_logger("app")


def _migrate_invoices_bill_type(engine):
    # Room-bill / mess-bill split at checkout. Additive with default; older
    # single invoices remain 'combined'.
    with engine.connect() as conn:
        cols = conn.execute(text("PRAGMA table_info(invoices)")).fetchall()
        if not cols:
            return
        if "bill_type" not in {c[1] for c in cols}:
            conn.execute(text("ALTER TABLE invoices ADD COLUMN bill_type VARCHAR(20) DEFAULT 'combined'"))
            conn.commit()
            logger.info("migration: added invoices.bill_type")


def _migrate_invoices_complimentary(engine):
    # Lets staff mark an invoice fully complimentary (Rs 0) with a reason,
    # distinct from a partial discount. Additive, nullable/defaulted.
    with engine.connect() as conn:
        cols = conn.execute(text("PRAGMA table_info(invoices)")).fetchall()
        if not cols:
            return
        col_names = {c[1] for c in cols}
        if "is_complimentary" not in col_names:
            conn.execute(text("ALTER TABLE invoices ADD COLUMN is_complimentary BOOLEAN DEFAULT 0"))
            logger.info("migration: added invoices.is_complimentary")
        if "complimentary_reason" not in col_names:
            conn.execute(text("ALTER TABLE invoices ADD COLUMN complimentary_reason TEXT"))
            logger.info("migration: added invoices.complimentary_reason")
        conn.commit()


MIGRATIONS = [
    _migrate_invoices_bill_type,
    _migrate_invoices_complimentary,
]
