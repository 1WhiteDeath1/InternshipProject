"""Reports and analytics router."""
from datetime import datetime, date, timedelta
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, and_
from backend.database import get_db
from backend.models import (
    Invoice, Booking, Room, InventoryItem, StockBatch, WasteLog,
    PurchaseOrder, Vendor, AuditLog, Alert, KitchenOrder,
)
from backend.auth import get_current_user, require_supervisor

router = APIRouter()


@router.get("/dashboard")
async def supervisor_dashboard(db: Session = Depends(get_db), current_user=Depends(require_supervisor)):
    today = date.today()
    month_start = today.replace(day=1)

    # Revenue
    invoices = db.query(Invoice).filter(Invoice.created_at >= datetime.combine(today, datetime.min.time())).all()
    today_revenue = sum(float(inv.total_amount) for inv in invoices if inv.status.value in ["issued", "paid"])

    # Occupancy
    total_rooms = db.query(Room).filter(Room.is_active == True).count()
    occupied = db.query(Room).filter(Room.status == "occupied").count()
    occupancy_rate = round(occupied / total_rooms * 100, 1) if total_rooms else 0

    # Stock value
    batches = db.query(StockBatch).filter(StockBatch.is_active == True).all()
    stock_value = sum(float(b.unit_cost) * b.quantity for b in batches if b.unit_cost)

    # Waste cost this month
    waste_items = db.query(WasteLog).filter(WasteLog.created_at >= datetime.combine(month_start, datetime.min.time())).all()
    waste_cost = sum(float(w.cost) for w in waste_items if w.cost)

    # Open alerts
    open_alerts = db.query(Alert).filter(Alert.status.in_(["new", "acknowledged"])).count()

    # Pending approvals
    pending_pos = db.query(PurchaseOrder).filter(PurchaseOrder.status == "draft").count()

    # Total guests today
    today_guests = db.query(Booking).filter(
        Booking.check_in <= today, Booking.check_out >= today,
        Booking.status.in_(["checked_in"]),
    ).count()

    # Low stock count
    from sqlalchemy import text
    low_stock_result = db.execute(text("""
        SELECT COUNT(*) FROM (
            SELECT i.id FROM inventory_items i
            LEFT JOIN stock_batches b ON b.item_id = i.id AND b.is_active = 1
            WHERE i.is_active = 1 AND i.reorder_level > 0
            GROUP BY i.id
            HAVING COALESCE(SUM(b.quantity), 0) <= i.reorder_level
        )
    """)).scalar()

    return {
        "today_revenue": today_revenue,
        "occupancy_rate": occupancy_rate,
        "total_stock_value": round(stock_value, 2),
        "waste_cost_month": round(waste_cost, 2),
        "open_alerts": open_alerts,
        "pending_approvals": pending_pos,
        "total_guests_today": today_guests,
        "low_stock_count": low_stock_result or 0,
    }


@router.get("/revenue-trend")
async def revenue_trend(days: int = Query(30, ge=7, le=365), db: Session = Depends(get_db), current_user=Depends(require_supervisor)):
    today = date.today()
    labels = []
    values = []
    for i in range(days - 1, -1, -1):
        d = today - timedelta(days=i)
        labels.append(d.strftime("%Y-%m-%d"))
        day_invoices = db.query(Invoice).filter(
            Invoice.created_at >= datetime.combine(d, datetime.min.time()),
            Invoice.created_at < datetime.combine(d + timedelta(days=1), datetime.min.time()),
            Invoice.status.in_(["issued", "paid"]),
        ).all()
        values.append(sum(float(inv.total_amount) for inv in day_invoices))
    return {"labels": labels, "values": values}


@router.get("/occupancy-trend")
async def occupancy_trend(days: int = Query(30, ge=7, le=365), db: Session = Depends(get_db), current_user=Depends(require_supervisor)):
    today = date.today()
    labels = []
    values = []
    total_rooms = db.query(Room).filter(Room.is_active == True).count()
    for i in range(days - 1, -1, -1):
        d = today - timedelta(days=i)
        labels.append(d.strftime("%Y-%m-%d"))
        occupied = db.query(Booking).filter(
            Booking.check_in <= d, Booking.check_out >= d,
            Booking.status.in_(["checked_in"]),
        ).count()
        values.append(round(occupied / total_rooms * 100, 1) if total_rooms else 0)
    return {"labels": labels, "values": values}


@router.get("/waste-by-category")
async def waste_by_category(db: Session = Depends(get_db), current_user=Depends(require_supervisor)):
    month_start = date.today().replace(day=1)
    results = db.query(WasteLog.category, func.sum(WasteLog.quantity), func.sum(WasteLog.cost)).filter(
        WasteLog.created_at >= datetime.combine(month_start, datetime.min.time()),
    ).group_by(WasteLog.category).all()
    return {"labels": [r[0].value if r[0] else "unknown" for r in results], 
            "quantities": [float(r[1] or 0) for r in results],
            "costs": [float(r[2] or 0) for r in results]}


@router.get("/vendor-performance")
async def vendor_performance(db: Session = Depends(get_db), current_user=Depends(require_supervisor)):
    vendors = db.query(Vendor).filter(Vendor.is_active == True).order_by(Vendor.delivery_accuracy.desc()).limit(10).all()
    return [{"name": v.name, "accuracy": v.delivery_accuracy} for v in vendors]
