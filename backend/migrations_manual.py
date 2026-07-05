"""One-off, idempotent schema patches for databases created before a model
change, since this app has no real migration tooling (Alembic is a vendored
dependency, never invoked - schema evolution is Base.metadata.create_all()
only, which adds new tables but never alters existing ones). Call
run_startup_migrations(engine) once, right after create_all(), on every
startup - each check is a no-op once applied."""
from sqlalchemy import text
from backend.logging_config import get_logger

logger = get_logger("app")


def run_startup_migrations(engine):
    _migrate_meal_attendance(engine)
    _migrate_kitchen_orders(engine)
    _migrate_stock_zone_removal(engine)
    _migrate_inventory_ingredient_type(engine)


def _migrate_inventory_ingredient_type(engine):
    # Additive, nullable column - plain ALTER TABLE ADD COLUMN is safe, no rebuild needed.
    with engine.connect() as conn:
        cols = conn.execute(text("PRAGMA table_info(inventory_items)")).fetchall()
        if not cols:
            return
        if "ingredient_type" not in {c[1] for c in cols}:
            conn.execute(text("ALTER TABLE inventory_items ADD COLUMN ingredient_type VARCHAR(20)"))
            conn.commit()
            logger.info("migration: added inventory_items.ingredient_type")


def _migrate_stock_zone_removal(engine):
    # There is only one physical stock location - the warehouse/kitchen zone
    # split never matched reality and was the root cause of stock landing
    # somewhere the kitchen deduction logic could never read from. Dropping a
    # column needs the same rebuild pattern as the NOT NULL relaxation above
    # (SQLite's ALTER TABLE can't drop columns pre-3.35, and this codebase
    # doesn't assume a specific SQLite version).
    #
    # Uses the raw DBAPI connection rather than SQLAlchemy's Connection: this
    # rebuild has to temporarily disable foreign key enforcement (database.py
    # turns it on for every connection, and stock_movements.batch_id points at
    # stock_batches, so dropping stock_batches while it's still referenced
    # fails otherwise) - and PRAGMA foreign_keys is a no-op once a transaction
    # has begun, which SQLAlchemy's Connection does implicitly on first
    # execute(). A fresh raw sqlite3 connection only opens a transaction
    # before DML, so the PRAGMA reliably takes effect here.
    raw = engine.raw_connection()
    try:
        cur = raw.cursor()
        batch_cols = cur.execute("PRAGMA table_info(stock_batches)").fetchall()
        movement_cols = cur.execute("PRAGMA table_info(stock_movements)").fetchall()
        needs_batches = bool(batch_cols) and "zone" in {c[1] for c in batch_cols}
        needs_movements = bool(movement_cols) and ({"from_zone", "to_zone"} & {c[1] for c in movement_cols})
        if not (needs_batches or needs_movements):
            return

        cur.execute("PRAGMA foreign_keys=OFF")
        if needs_batches:
            _rebuild_stock_batches_without_zone(cur)
            raw.commit()
            logger.info("migration: removed stock_batches.zone")
        if needs_movements:
            _rebuild_stock_movements_without_zone(cur)
            raw.commit()
            logger.info("migration: removed stock_movements.from_zone/to_zone")
        cur.execute("PRAGMA foreign_keys=ON")
        raw.commit()
    finally:
        raw.close()


def _rebuild_stock_batches_without_zone(cur):
    cur.execute("""
        CREATE TABLE stock_batches_new (
            id INTEGER NOT NULL PRIMARY KEY,
            item_id INTEGER NOT NULL,
            batch_number VARCHAR(100) NOT NULL,
            quantity FLOAT NOT NULL,
            bin_location VARCHAR(100),
            expiry_date DATE,
            received_date DATE,
            unit_cost NUMERIC(12, 2),
            is_active BOOLEAN,
            created_at DATETIME,
            FOREIGN KEY(item_id) REFERENCES inventory_items (id)
        )
    """)
    cur.execute("""
        INSERT INTO stock_batches_new (id, item_id, batch_number, quantity, bin_location, expiry_date, received_date, unit_cost, is_active, created_at)
        SELECT id, item_id, batch_number, quantity, bin_location, expiry_date, received_date, unit_cost, is_active, created_at
        FROM stock_batches
    """)
    cur.execute("DROP TABLE stock_batches")
    cur.execute("ALTER TABLE stock_batches_new RENAME TO stock_batches")
    cur.execute("CREATE INDEX idx_stock_item ON stock_batches (item_id)")


def _rebuild_stock_movements_without_zone(cur):
    cur.execute("""
        CREATE TABLE stock_movements_new (
            id INTEGER NOT NULL PRIMARY KEY,
            batch_id INTEGER NOT NULL,
            item_id INTEGER NOT NULL,
            movement_type VARCHAR(50) NOT NULL,
            quantity FLOAT NOT NULL,
            reference_type VARCHAR(50),
            reference_id INTEGER,
            notes TEXT,
            created_by INTEGER,
            created_at DATETIME,
            FOREIGN KEY(batch_id) REFERENCES stock_batches (id),
            FOREIGN KEY(item_id) REFERENCES inventory_items (id),
            FOREIGN KEY(created_by) REFERENCES users (id)
        )
    """)
    cur.execute("""
        INSERT INTO stock_movements_new (id, batch_id, item_id, movement_type, quantity, reference_type, reference_id, notes, created_by, created_at)
        SELECT id, batch_id, item_id, movement_type, quantity, reference_type, reference_id, notes, created_by, created_at
        FROM stock_movements
    """)
    cur.execute("DROP TABLE stock_movements")
    cur.execute("ALTER TABLE stock_movements_new RENAME TO stock_movements")
    cur.execute("CREATE INDEX idx_movement_batch ON stock_movements (batch_id)")
    cur.execute("CREATE INDEX idx_movement_item ON stock_movements (item_id)")
    cur.execute("CREATE INDEX idx_movement_type ON stock_movements (movement_type)")


def _migrate_kitchen_orders(engine):
    # Additive columns letting a kitchen order remember which booking-day/meal it
    # was auto-generated from, so "Generate Production Orders" stays idempotent.
    # Plain ALTER TABLE ADD COLUMN - safe, no constraint change or rebuild needed.
    with engine.connect() as conn:
        cols = conn.execute(text("PRAGMA table_info(kitchen_orders)")).fetchall()
        if not cols:
            return  # table doesn't exist yet - create_all() will make it correctly
        col_names = {c[1] for c in cols}
        for name, ddl_type in (("meal_date", "DATE"), ("meal_type", "VARCHAR(20)"), ("source", "VARCHAR(20)")):
            if name not in col_names:
                conn.execute(text(f"ALTER TABLE kitchen_orders ADD COLUMN {name} {ddl_type}"))
                logger.info("migration: added kitchen_orders.%s", name)
        conn.commit()


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
