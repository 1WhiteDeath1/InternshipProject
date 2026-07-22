"""Mess billing domain migrations."""
from sqlalchemy import text
from backend.logging_config import get_logger

logger = get_logger("app")


def _migrate_mess_bills_ala_carte(engine):
    # A member's own a la carte custom-order charges for the period, folded
    # into their monthly statement alongside the existing extra_meals_amount.
    with engine.connect() as conn:
        cols = conn.execute(text("PRAGMA table_info(mess_bills)")).fetchall()
        if not cols:
            return
        if "ala_carte_amount" not in {c[1] for c in cols}:
            conn.execute(text("ALTER TABLE mess_bills ADD COLUMN ala_carte_amount NUMERIC(12, 2) DEFAULT 0"))
            conn.commit()
            logger.info("migration: added mess_bills.ala_carte_amount")


MIGRATIONS = [_migrate_mess_bills_ala_carte]
