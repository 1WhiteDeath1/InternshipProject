"""Reports and analytics router."""
from datetime import datetime, date, timedelta
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, and_
from backend.database import get_db
from backend.models import (
    Invoice, Booking, Room, InventoryItem, StockBatch, WasteLog,
    PurchaseOrder, Vendor, AuditLog, Alert, KitchenOrder,
    IncidentReport, MealAttendance, AttendanceStatus, MessBill, MessBillStatus,
    Member, MemberStatus, MenuPrice, Recipe,
)
from backend.auth import PermissionChecker
from backend.services.recipe_costing import compute_theoretical_recipe_cost

router = APIRouter()


@router.get("/dashboard")
async def supervisor_dashboard(db: Session = Depends(get_db), current_user=Depends(PermissionChecker("reports", "view"))):
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

    # Pending approvals (draft POs awaiting sign-off)
    pending_pos = db.query(PurchaseOrder).filter(PurchaseOrder.status == "draft").count()

    # Outstanding balance across all live, unsettled invoices - an aggregate the
    # Manager sees without reaching the (Clerk-owned) desk. No names, just the total.
    live_invoices = db.query(Invoice).filter(Invoice.status.in_(["draft", "issued"])).all()
    outstanding_balance = sum(
        max(float(inv.total_amount) - float(inv.amount_paid or 0), 0.0) for inv in live_invoices
    )
    unsettled_invoice_count = sum(
        1 for inv in live_invoices if float(inv.total_amount) - float(inv.amount_paid or 0) > 0.01
    )

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

    # Security - open incidents
    open_incidents = db.query(IncidentReport).filter(IncidentReport.status.in_(["open", "investigating"])).count()

    # Attendance - today's meal service
    today_attendance = db.query(MealAttendance).filter(MealAttendance.date == today).all()
    attendance_present = sum(1 for a in today_attendance if a.status == AttendanceStatus.ATTENDED)
    attendance_absent = sum(1 for a in today_attendance if a.status == AttendanceStatus.NO_SHOW)

    # Procurement - vendor performance at a glance
    active_vendors = db.query(Vendor).filter(Vendor.is_active == True).all()
    active_vendor_count = len(active_vendors)
    avg_vendor_accuracy = round(sum(v.delivery_accuracy or 0 for v in active_vendors) / active_vendor_count, 1) if active_vendor_count else 0

    # Recipes - theoretical cost at or above the guest-facing menu price (no margin left)
    recipes_below_margin = 0
    for mp in db.query(MenuPrice).filter(MenuPrice.is_active == True).all():
        recipe = db.query(Recipe).filter(Recipe.id == mp.recipe_id).first()
        if not recipe:
            continue
        cost = compute_theoretical_recipe_cost(db, recipe)
        if cost is not None and cost >= float(mp.price):
            recipes_below_margin += 1

    # Mess billing - current period
    month_bills = db.query(MessBill).filter(MessBill.month == today.month, MessBill.year == today.year).all()
    mess_revenue_month = sum(float(b.total_amount) for b in month_bills)
    unpaid_mess_bills = sum(1 for b in month_bills if b.status != MessBillStatus.PAID)

    # Members - active roster size
    active_member_count = db.query(Member).filter(Member.status == MemberStatus.ACTIVE).count()

    # Clerk Desk - finalization activity
    invoices_finalized_today = sum(1 for inv in invoices if inv.status.value in ["issued", "paid"])
    month_invoices = db.query(Invoice).filter(Invoice.created_at >= datetime.combine(month_start, datetime.min.time())).all()
    discounts_month = sum(float(inv.discount) for inv in month_invoices if inv.discount)

    return {
        "today_revenue": today_revenue,
        "occupancy_rate": occupancy_rate,
        "total_stock_value": round(stock_value, 2),
        "waste_cost_month": round(waste_cost, 2),
        "open_alerts": open_alerts,
        "pending_approvals": pending_pos,
        "total_guests_today": today_guests,
        "low_stock_count": low_stock_result or 0,
        "open_incidents": open_incidents,
        "attendance_present_today": attendance_present,
        "attendance_absent_today": attendance_absent,
        "active_vendor_count": active_vendor_count,
        "avg_vendor_accuracy": avg_vendor_accuracy,
        "recipes_below_margin": recipes_below_margin,
        "mess_revenue_month": round(mess_revenue_month, 2),
        "unpaid_mess_bills": unpaid_mess_bills,
        "active_member_count": active_member_count,
        "invoices_finalized_today": invoices_finalized_today,
        "discounts_month": round(discounts_month, 2),
        "outstanding_balance": round(outstanding_balance, 2),
        "unsettled_invoice_count": unsettled_invoice_count,
    }


@router.get("/revenue-trend")
async def revenue_trend(days: int = Query(30, ge=7, le=365), db: Session = Depends(get_db), current_user=Depends(PermissionChecker("reports", "view"))):
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
async def occupancy_trend(days: int = Query(30, ge=7, le=365), db: Session = Depends(get_db), current_user=Depends(PermissionChecker("reports", "view"))):
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
async def waste_by_category(db: Session = Depends(get_db), current_user=Depends(PermissionChecker("reports", "view"))):
    month_start = date.today().replace(day=1)
    results = db.query(WasteLog.category, func.sum(WasteLog.quantity), func.sum(WasteLog.cost)).filter(
        WasteLog.created_at >= datetime.combine(month_start, datetime.min.time()),
    ).group_by(WasteLog.category).all()
    return {"labels": [r[0].value if r[0] else "unknown" for r in results], 
            "quantities": [float(r[1] or 0) for r in results],
            "costs": [float(r[2] or 0) for r in results]}


@router.get("/vendor-performance")
async def vendor_performance(db: Session = Depends(get_db), current_user=Depends(PermissionChecker("reports", "view"))):
    vendors = db.query(Vendor).filter(Vendor.is_active == True).order_by(Vendor.delivery_accuracy.desc()).limit(10).all()
    return [{"name": v.name, "accuracy": v.delivery_accuracy} for v in vendors]
