"""Alerts domain migrations."""
from sqlalchemy import text
from backend.logging_config import get_logger

logger = get_logger("app")


def _migrate_alerts_detail(engine):
    # Structured (JSON-in-Text) anomaly detail, additive alongside the
    # existing prose `message` column - see backend/models/alerts.py.
    with engine.connect() as conn:
        cols = conn.execute(text("PRAGMA table_info(alerts)")).fetchall()
        if not cols:
            return
        if "detail" not in {c[1] for c in cols}:
            conn.execute(text("ALTER TABLE alerts ADD COLUMN detail TEXT"))
            conn.commit()
            logger.info("migration: added alerts.detail")


MIGRATIONS = [_migrate_alerts_detail]
