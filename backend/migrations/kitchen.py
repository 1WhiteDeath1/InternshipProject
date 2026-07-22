"""Kitchen domain migrations."""
from sqlalchemy import text
from backend.logging_config import get_logger

logger = get_logger("app")


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


def _migrate_kitchen_orders_ala_carte(engine):
    # Additive columns for the custom a la carte order lifecycle (Pending ->
    # Cooking -> Completed/Late with a timer and consumer attribution). All
    # nullable - plain ALTER TABLE ADD COLUMN, no rebuild needed.
    with engine.connect() as conn:
        cols = conn.execute(text("PRAGMA table_info(kitchen_orders)")).fetchall()
        if not cols:
            return  # table doesn't exist yet - create_all() will make it correctly
        col_names = {c[1] for c in cols}
        additions = (
            ("is_ala_carte", "BOOLEAN"),
            ("consumer_type", "VARCHAR(20)"),
            ("member_id", "INTEGER REFERENCES members(id)"),
            ("booking_id", "INTEGER REFERENCES bookings(id)"),
            ("sla_minutes", "INTEGER"),
            ("due_at", "DATETIME"),
            ("cooking_started_at", "DATETIME"),
            ("escalated_at", "DATETIME"),
            ("invoiced_at", "DATETIME"),
        )
        for name, ddl_type in additions:
            if name not in col_names:
                conn.execute(text(f"ALTER TABLE kitchen_orders ADD COLUMN {name} {ddl_type}"))
                logger.info("migration: added kitchen_orders.%s", name)
        conn.commit()


MIGRATIONS = [
    _migrate_kitchen_orders,
    _migrate_kitchen_orders_ala_carte,
]
