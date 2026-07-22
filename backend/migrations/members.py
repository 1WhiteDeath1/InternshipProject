"""Members domain migrations."""
from sqlalchemy import text
from backend.logging_config import get_logger

logger = get_logger("app")


def _migrate_members_womens_bloc(engine):
    # First-ever ALTER on members - orthogonal to mess_category, drives which
    # rank-rate table (HraRankRate vs WomensBlocRankRate) HRA billing uses.
    with engine.connect() as conn:
        cols = conn.execute(text("PRAGMA table_info(members)")).fetchall()
        if not cols:
            return
        if "is_womens_bloc" not in {c[1] for c in cols}:
            conn.execute(text("ALTER TABLE members ADD COLUMN is_womens_bloc BOOLEAN DEFAULT 0"))
            conn.commit()
            logger.info("migration: added members.is_womens_bloc")


MIGRATIONS = [_migrate_members_womens_bloc]
