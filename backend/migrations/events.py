"""Events domain migrations."""
from sqlalchemy import text
from backend.logging_config import get_logger

logger = get_logger("app")


def _migrate_events_actual_cost(engine):
    # Clerk-logged actual spend on an event, additive alongside the existing
    # estimated-price-based menu total - see backend/models/events.py.
    with engine.connect() as conn:
        cols = conn.execute(text("PRAGMA table_info(events)")).fetchall()
        if not cols:
            return
        if "actual_cost" not in {c[1] for c in cols}:
            conn.execute(text("ALTER TABLE events ADD COLUMN actual_cost NUMERIC(10, 2)"))
            conn.commit()
            logger.info("migration: added events.actual_cost")


MIGRATIONS = [_migrate_events_actual_cost]
