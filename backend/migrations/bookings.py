"""Bookings domain migrations."""
from sqlalchemy import text
from backend.logging_config import get_logger

logger = get_logger("app")


def _migrate_bookings_register_fields(engine):
    # Booking-register columns (rank, PA no, unit, nature of duty), extra
    # mattress billing, actual check-in/out timestamps for late-fee math,
    # cancellation reason, and the itemized rate snapshot. All nullable -
    # plain ALTER TABLE ADD COLUMN, no rebuild needed.
    with engine.connect() as conn:
        cols = conn.execute(text("PRAGMA table_info(bookings)")).fetchall()
        if not cols:
            return
        col_names = {c[1] for c in cols}
        additions = (
            ("rank", "VARCHAR(50)"),
            ("pa_number", "VARCHAR(50)"),
            ("unit_address", "VARCHAR(255)"),
            ("nature_of_duty", "VARCHAR(20) DEFAULT 'visit'"),
            ("da_multiplier", "NUMERIC(3, 1)"),
            ("mattress_count", "INTEGER DEFAULT 0"),
            ("late_checkout_fee", "NUMERIC(10, 2) DEFAULT 0"),
            ("actual_check_in", "DATETIME"),
            ("actual_check_out", "DATETIME"),
            ("cancel_reason", "TEXT"),
            ("rate_breakdown", "TEXT"),
        )
        for name, ddl_type in additions:
            if name not in col_names:
                conn.execute(text(f"ALTER TABLE bookings ADD COLUMN {name} {ddl_type}"))
                logger.info("migration: added bookings.%s", name)
        conn.commit()


def _migrate_bookings_source_fields(engine):
    # Online-portal booking channel (source + portal voucher number) and the
    # arrival deadline after which an unclaimed booking may be voided. All
    # nullable/defaulted - plain ALTER TABLE ADD COLUMN.
    with engine.connect() as conn:
        cols = conn.execute(text("PRAGMA table_info(bookings)")).fetchall()
        if not cols:
            return
        col_names = {c[1] for c in cols}
        additions = (
            ("source", "VARCHAR(20) DEFAULT 'walk_in'"),
            ("online_voucher_no", "VARCHAR(50)"),
            ("arrival_deadline", "DATETIME"),
            ("reference_person", "VARCHAR(100)"),
        )
        for name, ddl_type in additions:
            if name not in col_names:
                conn.execute(text(f"ALTER TABLE bookings ADD COLUMN {name} {ddl_type}"))
                logger.info("migration: added bookings.%s", name)
        conn.commit()


def _migrate_bookings_guest_id(engine):
    # Links a booking to a persistent Guest identity (matched by CNIC/phone),
    # so repeat visitors are recognized. guests table is new, created by
    # create_all(); this only adds the FK column to the existing bookings table.
    with engine.connect() as conn:
        cols = conn.execute(text("PRAGMA table_info(bookings)")).fetchall()
        if not cols:
            return
        if "guest_id" not in {c[1] for c in cols}:
            conn.execute(text("ALTER TABLE bookings ADD COLUMN guest_id INTEGER"))
            conn.commit()
            logger.info("migration: added bookings.guest_id")


def _migrate_bookings_attendant(engine):
    # Snapshot of which attendant was responsible during this specific stay -
    # kept separate from rooms.attendant_id so reassigning a room's default
    # attendant later doesn't rewrite history for past bookings.
    with engine.connect() as conn:
        cols = conn.execute(text("PRAGMA table_info(bookings)")).fetchall()
        if not cols:
            return
        if "attendant_id" not in {c[1] for c in cols}:
            conn.execute(text("ALTER TABLE bookings ADD COLUMN attendant_id INTEGER REFERENCES attendants(id)"))
            conn.commit()
            logger.info("migration: added bookings.attendant_id")


def _migrate_bookings_stay_type(engine):
    # Official / private / family - the third axis of the rank x room-type x
    # stay-type tariff matrix, independent of nature_of_duty (which governs
    # which pricing engine/billing mode applies).
    with engine.connect() as conn:
        cols = conn.execute(text("PRAGMA table_info(bookings)")).fetchall()
        if not cols:
            return
        if "stay_type" not in {c[1] for c in cols}:
            conn.execute(text("ALTER TABLE bookings ADD COLUMN stay_type VARCHAR(20)"))
            conn.commit()
            logger.info("migration: added bookings.stay_type")


MIGRATIONS = [
    _migrate_bookings_register_fields,
    _migrate_bookings_source_fields,
    _migrate_bookings_guest_id,
    _migrate_bookings_attendant,
    _migrate_bookings_stay_type,
]
