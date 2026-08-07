"""Real-time alert engine."""
import json
from datetime import datetime, timedelta
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import func
from backend.models import (
    Alert, AlertSeverity, AlertStatus, StockBatch, InventoryItem, Booking, Invoice,
    InventoryCategory, CycleCount,
)
from backend.logging_config import get_logger
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
    detail: Optional[dict] = None,
) -> Alert:
    alert = Alert(
        title=title,
        message=message,
        severity=severity,
        module=module,
        entity_type=entity_type,
        entity_id=entity_id,
        detail=json.dumps(detail) if detail is not None else None,
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


def check_stock_take_due(db: Session, days: int = 7) -> int:
    """Flags an active inventory category whose most recent cycle count (of
    any of its items) is older than `days`, or has never had one - nudges
    staff toward a periodic stock-take. Like every other check here, this
    only runs when someone hits "Run Checks" on the Alerts page - there is
    no background scheduler in this app, so "weekly" is enforced by the
    staleness check itself, not by anything firing on a timer."""
    cutoff = datetime.utcnow() - timedelta(days=days)
    categories = db.query(InventoryCategory).filter(InventoryCategory.is_active == True).all()
    count = 0
    for cat in categories:
        last_count = (
            db.query(func.max(CycleCount.created_at))
            .join(InventoryItem, InventoryItem.id == CycleCount.item_id)
            .filter(InventoryItem.category_id == cat.id)
            .scalar()
        )
        if last_count is not None and last_count >= cutoff:
            continue
        existing = db.query(Alert).filter(
            Alert.entity_type == "inventory_category",
            Alert.entity_id == cat.id,
            Alert.status.in_([AlertStatus.NEW, AlertStatus.ACKNOWLEDGED]),
            Alert.module == "inventory",
            Alert.title.contains("Stock Take Due"),
        ).first()
        if not existing:
            create_alert(
                db,
                f"Stock Take Due: {cat.name}",
                (f"No cycle count recorded for {cat.name} in the last {days} days"
                 if last_count is not None else f"{cat.name} has never had a cycle count"),
                AlertSeverity.LOW, "inventory", "inventory_category", cat.id,
            )
            count += 1
    return count


def _overdue_severity(days: int) -> AlertSeverity:
    # Escalation thresholds are this app's own default (not specified
    # upstream) - adjust here if the mess wants different cutoffs.
    if days >= 7:
        return AlertSeverity.CRITICAL
    if days >= 3:
        return AlertSeverity.HIGH
    return AlertSeverity.WARNING


def check_overdue_checkout(db: Session) -> int:
    """A guest still physically checked in past their booked check_out date -
    distinct from check_unbilled_stays (billing-side, fires once a guest has
    actually left with no invoice). Severity escalates the longer they stay
    past checkout, and re-escalates an existing open alert in place instead
    of leaving it stuck at whatever severity it started at."""
    today = datetime.utcnow().date()
    bookings = db.query(Booking).filter(
        Booking.status == "checked_in", Booking.check_out < today,
    ).all()
    count = 0
    for booking in bookings:
        days_overdue = (today - booking.check_out).days
        severity = _overdue_severity(days_overdue)
        message = f"{booking.guest_name} (Room {booking.room.room_number if booking.room else '?'}) is {days_overdue} day(s) past the booked check-out date of {booking.check_out}."
        detail = {
            "days_overdue": days_overdue, "room_number": booking.room.room_number if booking.room else None,
            "guest_name": booking.guest_name, "expected_checkout": booking.check_out.isoformat(),
        }
        existing = db.query(Alert).filter(
            Alert.entity_type == "booking", Alert.entity_id == booking.id,
            Alert.status.in_([AlertStatus.NEW, AlertStatus.ACKNOWLEDGED]),
            Alert.module == "bookings", Alert.title.contains("Overdue Checkout"),
        ).first()
        if existing:
            if existing.severity != severity:
                existing.severity = severity
                existing.message = message
                existing.detail = json.dumps(detail)
                # Escalating (or de-escalating on an early recheck) should
                # surface again even if staff already acknowledged it at the
                # old severity - a WARNING someone dismissed shouldn't stay
                # silently acknowledged once it's become CRITICAL.
                existing.status = AlertStatus.NEW
                db.commit()
            continue
        create_alert(
            db, f"Overdue Checkout: {booking.guest_name}", message, severity,
            "bookings", "booking", booking.id, detail,
        )
        count += 1
    return count


def run_all_checks(db: Session) -> dict:
    """Run all alert checks and return summary."""
    return {
        "low_stock": check_low_stock(db),
        "expiring_items": check_expiring_items(db),
        "unbilled_stays": check_unbilled_stays(db),
        "stock_take_due": check_stock_take_due(db),
        "overdue_checkout": check_overdue_checkout(db),
    }
