"""Rooms domain migrations."""
from sqlalchemy import text
from backend.logging_config import get_logger

logger = get_logger("app")


def _migrate_rooms_housekeeping(engine):
    # Physical room readiness (clean/dirty/cleaning), independent of the
    # occupancy status column. Additive nullable-with-default column.
    with engine.connect() as conn:
        cols = conn.execute(text("PRAGMA table_info(rooms)")).fetchall()
        if not cols:
            return
        if "housekeeping_status" not in {c[1] for c in cols}:
            conn.execute(text("ALTER TABLE rooms ADD COLUMN housekeeping_status VARCHAR(20) DEFAULT 'clean'"))
            conn.commit()
            logger.info("migration: added rooms.housekeeping_status")


def _migrate_rooms_attendant(engine):
    # Default responsible attendant for the room (1 attendant -> many rooms).
    # attendants table itself is new and created by create_all().
    with engine.connect() as conn:
        cols = conn.execute(text("PRAGMA table_info(rooms)")).fetchall()
        if not cols:
            return
        if "attendant_id" not in {c[1] for c in cols}:
            conn.execute(text("ALTER TABLE rooms ADD COLUMN attendant_id INTEGER REFERENCES attendants(id)"))
            conn.commit()
            logger.info("migration: added rooms.attendant_id")


def _migrate_rooms_maintenance_until(engine):
    # Est. completion date captured by the "Send to Maintenance" overlay -
    # notes (issue description) already exists on rooms.
    with engine.connect() as conn:
        cols = conn.execute(text("PRAGMA table_info(rooms)")).fetchall()
        if not cols:
            return
        if "maintenance_until" not in {c[1] for c in cols}:
            conn.execute(text("ALTER TABLE rooms ADD COLUMN maintenance_until DATE"))
            conn.commit()
            logger.info("migration: added rooms.maintenance_until")


def _migrate_room_types_three_classes(engine):
    # 2026-07 rate-card simplification: guests see three room classes
    # (standard / suite / dg_suite). Old classes are remapped; suites keep
    # an ac_count (1 or 2) so HRA utilities still bill 1xAC vs 29,500 2xAC
    # per the card. Enum values are stored as NAMES (uppercase) in rooms,
    # but as lowercase values in the rate tables' plain-string columns.
    with engine.connect() as conn:
        cols = conn.execute(text("PRAGMA table_info(rooms)")).fetchall()
        if not cols:
            return
        if "ac_count" not in {c[1] for c in cols}:
            conn.execute(text("ALTER TABLE rooms ADD COLUMN ac_count INTEGER DEFAULT 1"))
            logger.info("migration: added rooms.ac_count")
        # Capture AC counts BEFORE the rename collapses 1xAC/2xAC into 'suite'
        conn.execute(text("UPDATE rooms SET ac_count = 2 WHERE UPPER(room_type) IN ('SUITE_2AC', 'DG_SUITE')"))
        remapped = 0
        remapped += conn.execute(text(
            "UPDATE rooms SET room_type = 'STANDARD' WHERE UPPER(room_type) IN ('SINGLE','DOUBLE','DELUXE','DORMITORY','VIP')")).rowcount
        remapped += conn.execute(text(
            "UPDATE rooms SET room_type = 'SUITE' WHERE UPPER(room_type) IN ('SUITE','SUITE_1AC','SUITE_2AC') AND room_type != 'SUITE'")).rowcount
        remapped += conn.execute(text(
            "UPDATE rooms SET room_type = 'DG_SUITE' WHERE UPPER(room_type) = 'DG_SUITE' AND room_type != 'DG_SUITE'")).rowcount
        # Legacy demo prices (Rs 30-200) predate the rate card; lift the
        # displayed nightly to the card's serving-officer total.
        conn.execute(text("UPDATE rooms SET base_price = 3500 WHERE room_type = 'STANDARD' AND base_price < 3500"))
        conn.execute(text("UPDATE rooms SET base_price = 4500 WHERE room_type IN ('SUITE','DG_SUITE') AND base_price < 4500"))
        # Rate-card rows (plain lowercase strings): vip -> standard; the two
        # suite classes had identical nightly rates, so drop the duplicate
        # before renaming to avoid two 'suite' rows per category.
        conn.execute(text("UPDATE room_rates SET room_type = 'standard' WHERE room_type = 'vip'"))
        conn.execute(text(
            "DELETE FROM room_rates WHERE room_type = 'suite_2ac' AND EXISTS ("
            " SELECT 1 FROM room_rates r2 WHERE r2.room_type = 'suite_1ac'"
            " AND r2.guest_category = room_rates.guest_category)"))
        conn.execute(text("UPDATE room_rates SET room_type = 'suite' WHERE room_type IN ('suite_1ac','suite_2ac')"))
        # HRA utility rows keep suite_1ac/suite_2ac keys (resolved via
        # ac_count) - only the vip row renames.
        conn.execute(text("UPDATE hra_utility_rates SET room_type = 'standard' WHERE room_type = 'vip'"))
        conn.commit()
        if remapped:
            logger.info("migration: remapped %d rooms to the three-class room types", remapped)


def _migrate_attendants_on_duty(engine):
    # Clock-in state, separate from the static `shift` label and from
    # `is_active` (roster membership) - lets the attendant picker default to
    # who's actually on the floor right now.
    with engine.connect() as conn:
        cols = conn.execute(text("PRAGMA table_info(attendants)")).fetchall()
        if not cols:
            return
        col_names = {c[1] for c in cols}
        if "on_duty" not in col_names:
            conn.execute(text("ALTER TABLE attendants ADD COLUMN on_duty BOOLEAN DEFAULT 0"))
            logger.info("migration: added attendants.on_duty")
        if "on_duty_since" not in col_names:
            conn.execute(text("ALTER TABLE attendants ADD COLUMN on_duty_since DATETIME"))
            logger.info("migration: added attendants.on_duty_since")
        conn.commit()


MIGRATIONS = [
    _migrate_rooms_housekeeping,
    _migrate_rooms_attendant,
    _migrate_rooms_maintenance_until,
    _migrate_room_types_three_classes,
    _migrate_attendants_on_duty,
]
