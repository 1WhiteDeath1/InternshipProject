"""Attendance domain migrations."""
from sqlalchemy import text
from backend.logging_config import get_logger

logger = get_logger("app")


def _migrate_meal_attendance(engine):
    with engine.connect() as conn:
        cols = conn.execute(text("PRAGMA table_info(meal_attendance)")).fetchall()
        if not cols:
            return  # table doesn't exist yet - create_all() will make it correctly from the current model

        col_names = {c[1] for c in cols}
        member_id_col = next((c for c in cols if c[1] == "member_id"), None)
        member_id_not_null = bool(member_id_col[3]) if member_id_col else False

        if "booking_id" not in col_names:
            conn.execute(text("ALTER TABLE meal_attendance ADD COLUMN booking_id INTEGER REFERENCES bookings(id)"))
            logger.info("migration: added meal_attendance.booking_id")
        if "recipe_id" not in col_names:
            conn.execute(text("ALTER TABLE meal_attendance ADD COLUMN recipe_id INTEGER REFERENCES recipes(id)"))
            logger.info("migration: added meal_attendance.recipe_id")
        conn.commit()

        if member_id_not_null:
            _rebuild_meal_attendance_nullable_member(conn)
            logger.info("migration: relaxed meal_attendance.member_id to nullable")


def _migrate_meal_attendance_invoiced(engine):
    # Guards a non-member's routine-meal consumption against being billed
    # twice across repeated Instant Checkout attempts.
    with engine.connect() as conn:
        cols = conn.execute(text("PRAGMA table_info(meal_attendance)")).fetchall()
        if not cols:
            return
        if "invoiced_at" not in {c[1] for c in cols}:
            conn.execute(text("ALTER TABLE meal_attendance ADD COLUMN invoiced_at DATETIME"))
            conn.commit()
            logger.info("migration: added meal_attendance.invoiced_at")


def _migrate_meal_attendance_guest_id(engine):
    # Third consumer alternative alongside member_id/booking_id - lets a
    # walk-in non-member (no room booking) be logged as fast as a member.
    # Additive nullable FK column; guarded so the CREATE UNIQUE INDEX below
    # only ever runs the one time the column itself is first added.
    with engine.connect() as conn:
        cols = conn.execute(text("PRAGMA table_info(meal_attendance)")).fetchall()
        if not cols:
            return
        if "guest_id" not in {c[1] for c in cols}:
            conn.execute(text("ALTER TABLE meal_attendance ADD COLUMN guest_id INTEGER REFERENCES guests(id)"))
            conn.execute(text("CREATE UNIQUE INDEX uq_attendance_guest_date_meal ON meal_attendance (guest_id, date, meal_type)"))
            conn.commit()
            logger.info("migration: added meal_attendance.guest_id")


def _rebuild_meal_attendance_nullable_member(conn):
    # SQLite's ALTER TABLE can add/drop/rename columns but cannot change a
    # column's NOT NULL constraint - the only way to relax it is the classic
    # rebuild: new table with the target schema, copy rows, drop, rename.
    # CHECK constraints on the enum-backed columns are intentionally not
    # replicated here - validity is already enforced by the ORM/Pydantic layer
    # before any row reaches the database.
    conn.execute(text("""
        CREATE TABLE meal_attendance_new (
            id INTEGER NOT NULL PRIMARY KEY,
            member_id INTEGER,
            booking_id INTEGER,
            recipe_id INTEGER,
            date DATE NOT NULL,
            meal_type VARCHAR(9) NOT NULL,
            status VARCHAR(9),
            method VARCHAR(20),
            booked_at DATETIME,
            marked_at DATETIME,
            marked_by INTEGER,
            FOREIGN KEY(member_id) REFERENCES members (id),
            FOREIGN KEY(booking_id) REFERENCES bookings (id),
            FOREIGN KEY(recipe_id) REFERENCES recipes (id),
            FOREIGN KEY(marked_by) REFERENCES users (id)
        )
    """))
    conn.execute(text("""
        INSERT INTO meal_attendance_new (id, member_id, booking_id, recipe_id, date, meal_type, status, method, booked_at, marked_at, marked_by)
        SELECT id, member_id, booking_id, recipe_id, date, meal_type, status, method, booked_at, marked_at, marked_by
        FROM meal_attendance
    """))
    conn.execute(text("DROP TABLE meal_attendance"))
    conn.execute(text("ALTER TABLE meal_attendance_new RENAME TO meal_attendance"))
    conn.execute(text("CREATE INDEX idx_attendance_member_date ON meal_attendance (member_id, date)"))
    conn.execute(text("CREATE INDEX idx_attendance_date_meal ON meal_attendance (date, meal_type)"))
    conn.execute(text("CREATE UNIQUE INDEX uq_attendance_member_date_meal ON meal_attendance (member_id, date, meal_type)"))
    conn.execute(text("CREATE UNIQUE INDEX uq_attendance_booking_date_meal ON meal_attendance (booking_id, date, meal_type)"))
    conn.commit()


def _cleanup_meal_booking_cutoff_minutes(engine):
    # Superseded by the per-meal meal_cutoff_<type> settings (absolute
    # cutoff times, editable on the Settings page) - this single global
    # offset-in-minutes setting is dead config now, just delete the row.
    with engine.connect() as conn:
        tables = conn.execute(text("SELECT name FROM sqlite_master WHERE type='table' AND name='system_settings'")).fetchall()
        if not tables:
            return
        conn.execute(text("DELETE FROM system_settings WHERE key = 'meal_booking_cutoff_minutes'"))
        conn.commit()


MIGRATIONS = [
    _migrate_meal_attendance,
    _migrate_meal_attendance_invoiced,
    _migrate_meal_attendance_guest_id,
    _cleanup_meal_booking_cutoff_minutes,
]
