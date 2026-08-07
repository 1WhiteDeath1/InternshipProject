"""Expenses domain migrations."""
from sqlalchemy import text
from backend.logging_config import get_logger

logger = get_logger("app")


def _migrate_expenses_reference_and_attachment(engine):
    # Utility Bill Reference # + scanned attachment (PNG/JPG/PDF) for audit
    # verification - added after the expenses table itself first shipped.
    with engine.connect() as conn:
        cols = conn.execute(text("PRAGMA table_info(expenses)")).fetchall()
        if not cols:
            return
        col_names = {c[1] for c in cols}
        additions = (
            ("bill_reference_no", "VARCHAR(100)"),
            ("attachment_path", "VARCHAR(255)"),
            ("attachment_filename", "VARCHAR(255)"),
        )
        for name, ddl_type in additions:
            if name not in col_names:
                conn.execute(text(f"ALTER TABLE expenses ADD COLUMN {name} {ddl_type}"))
                logger.info("migration: added expenses.%s", name)
        conn.commit()


MIGRATIONS = [_migrate_expenses_reference_and_attachment]
