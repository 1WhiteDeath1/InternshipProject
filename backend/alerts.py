"""Real-time alert engine."""
from datetime import datetime, timedelta
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import func
from backend.models import Alert, AlertSeverity, AlertStatus, StockBatch, InventoryItem, Booking, Invoice, Recipe, MenuPrice
from backend.logging_config import get_logger
from backend.services.recipe_costing import compute_theoretical_recipe_cost
from backend.services.mess_billing_calc import get_setting_float

logger = get_logger("app")


def create_alert(
    db: Session,
    title: str,
    message: str,
    severity: AlertSeverity,
    module: str,
    entity_type: Optional[str] = None,
    entity_id: Optional[int] = None,
) -> Alert:
    alert = Alert(
        title=title,
        message=message,
        severity=severity,
        module=module,
        entity_type=entity_type,
        entity_id=entity_id,
    )
    db.add(alert)
    db.commit()
    db.refresh(alert)
    return alert


def check_low_stock(db: Session) -> int:
    """Check for low stock items and create alerts."""
    from sqlalchemy import text
    query = text("""
        SELECT i.id, i.name, i.reorder_level, COALESCE(SUM(b.quantity), 0) as total
        FROM inventory_items i
        LEFT JOIN stock_batches b ON b.item_id = i.id AND b.is_active = 1
        WHERE i.is_active = 1
        GROUP BY i.id
        HAVING total <= i.reorder_level AND i.reorder_level > 0
    """)
    results = db.execute(query).fetchall()
    count = 0
    for row in results:
        existing = db.query(Alert).filter(
            Alert.entity_type == "inventory_item",
            Alert.entity_id == row.id,
            Alert.status.in_([AlertStatus.NEW, AlertStatus.ACKNOWLEDGED]),
            Alert.module == "inventory",
        ).first()
        if not existing:
            create_alert(
                db,
                f"Low Stock: {row.name}",
                f"Current stock: {row.total} {row.name}. Reorder level: {row.reorder_level}",
                AlertSeverity.HIGH,
                "inventory",
                "inventory_item",
                row.id,
            )
            count += 1
    return count


def check_expiring_items(db: Session, days: int = 7) -> int:
    cutoff = datetime.utcnow().date() + timedelta(days=days)
    items = db.query(StockBatch).filter(
        StockBatch.expiry_date <= cutoff,
        StockBatch.expiry_date >= datetime.utcnow().date(),
        StockBatch.is_active == True,
        StockBatch.quantity > 0,
    ).all()
    count = 0
    for batch in items:
        existing = db.query(Alert).filter(
            Alert.entity_type == "stock_batch",
            Alert.entity_id == batch.id,
            Alert.status.in_([AlertStatus.NEW, AlertStatus.ACKNOWLEDGED]),
        ).first()
        if not existing:
            create_alert(
                db,
                f"Expiring Soon: Batch {batch.batch_number}",
                f"Item expires on {batch.expiry_date}. Quantity: {batch.quantity}",
                AlertSeverity.MEDIUM,
                "inventory",
                "stock_batch",
                batch.id,
            )
            count += 1
    return count


def check_unbilled_stays(db: Session) -> int:
    today = datetime.utcnow().date()
    bookings = db.query(Booking).filter(
        Booking.check_out < today,
        Booking.status != "checked_out",
        Booking.status != "cancelled",
    ).all()
    count = 0
    for booking in bookings:
        existing = db.query(Alert).filter(
            Alert.entity_type == "booking",
            Alert.entity_id == booking.id,
            Alert.status.in_([AlertStatus.NEW, AlertStatus.ACKNOWLEDGED]),
            Alert.title.contains("Unbilled"),
        ).first()
        if not existing:
            create_alert(
                db,
                f"Unbilled Stay: {booking.guest_name}",
                f"Guest checked out on {booking.check_out} but no invoice generated.",
                AlertSeverity.HIGH,
                "billing",
                "booking",
                booking.id,
            )
            count += 1
    return count


def check_recipe_margins(db: Session) -> int:
    """Compare each priced recipe's theoretical ingredient cost against its
    guest-facing MenuPrice, flagging thin/negative margins. A recipe missing
    active stock batches for one or more ingredients gets a separate LOW-
    severity "cannot compute" alert instead of being silently skipped, so this
    unattended check never fails and management still has visibility into why
    that dish is producing no margin data. The two alert kinds are dedup'd
    independently via a title-prefix discriminator (same technique
    check_unbilled_stays uses), since a recipe could legitimately have one or
    the other open at different times."""
    threshold = get_setting_float(db, "recipe_margin_alert_threshold_pct", 20)
    rows = db.query(Recipe, MenuPrice).join(
        MenuPrice, MenuPrice.recipe_id == Recipe.id
    ).filter(
        Recipe.is_active == True, MenuPrice.is_active == True, MenuPrice.price > 0,
    ).all()

    count = 0
    for recipe, menu_price in rows:
        cost = compute_theoretical_recipe_cost(db, recipe)

        if cost is None:
            existing = db.query(Alert).filter(
                Alert.entity_type == "recipe", Alert.entity_id == recipe.id,
                Alert.status.in_([AlertStatus.NEW, AlertStatus.ACKNOWLEDGED]),
                Alert.module == "procurement",
                Alert.title.contains("Cannot compute margin"),
            ).first()
            if not existing:
                create_alert(
                    db, f"Cannot compute margin: {recipe.name}",
                    "Missing ingredient stock inventory logs - one or more ingredients has no active stock batch to cost against.",
                    AlertSeverity.LOW, "procurement", "recipe", recipe.id,
                )
                count += 1
            continue

        price = float(menu_price.price)
        margin_pct = (price - cost) / price * 100
        if margin_pct >= threshold:
            continue

        existing = db.query(Alert).filter(
            Alert.entity_type == "recipe", Alert.entity_id == recipe.id,
            Alert.status.in_([AlertStatus.NEW, AlertStatus.ACKNOWLEDGED]),
            Alert.module == "procurement",
            Alert.title.contains("Cost Alert"),
        ).first()
        if not existing:
            create_alert(
                db, f"Cost Alert: {recipe.name}",
                f"Production cost is Rs {cost:.2f} against a menu price of Rs {price:.2f} ({margin_pct:.1f}% margin).",
                AlertSeverity.CRITICAL if margin_pct < 0 else AlertSeverity.HIGH,
                "procurement", "recipe", recipe.id,
            )
            count += 1

    return count


def run_all_checks(db: Session) -> dict:
    """Run all alert checks and return summary."""
    return {
        "low_stock": check_low_stock(db),
        "expiring_items": check_expiring_items(db),
        "unbilled_stays": check_unbilled_stays(db),
        "recipe_margins": check_recipe_margins(db),
    }
