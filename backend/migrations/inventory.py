"""Inventory domain migrations."""
from sqlalchemy import text
from backend.logging_config import get_logger

logger = get_logger("app")


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


MIGRATIONS = [
    _migrate_inventory_ingredient_type,
    _migrate_stock_zone_removal,
]
