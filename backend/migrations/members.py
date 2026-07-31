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


def _migrate_members_dining_status(engine):
    # Dining vs non-dining classification - non-dining members are excluded
    # from mess bill generation entirely (see mess_billing.py:generate_bills).
    with engine.connect() as conn:
        cols = conn.execute(text("PRAGMA table_info(members)")).fetchall()
        if not cols:
            return
        if "dining_status" not in {c[1] for c in cols}:
            # SQLAlchemy's plain Column(Enum(DiningStatus)) stores the member
            # *name* ("DINING"/"NON_DINING"), not its .value - matching every
            # other Enum column on this model (status, client_category, ...).
            # An earlier version of this migration defaulted to the lowercase
            # .value ('dining'), which SQLite then backfilled onto every
            # existing row, so old rows 500'd on load with a LookupError the
            # moment SQLAlchemy tried to decode them. Repaired below.
            conn.execute(text("ALTER TABLE members ADD COLUMN dining_status VARCHAR(20) DEFAULT 'DINING'"))
            conn.commit()
            logger.info("migration: added members.dining_status")

        # Idempotent repair for rows written by the old lowercase-default
        # migration (or any other lowercase writer) - safe to run every
        # startup, a no-op once every row is in the DINING/NON_DINING form.
        result = conn.execute(text(
            "UPDATE members SET dining_status = 'DINING' WHERE dining_status = 'dining'"
        ))
        result2 = conn.execute(text(
            "UPDATE members SET dining_status = 'NON_DINING' WHERE dining_status = 'non_dining'"
        ))
        if result.rowcount or result2.rowcount:
            conn.commit()
            logger.info(f"migration: repaired {result.rowcount + result2.rowcount} members.dining_status row(s) with lowercase enum values")


MIGRATIONS = [_migrate_members_womens_bloc, _migrate_members_dining_status]
