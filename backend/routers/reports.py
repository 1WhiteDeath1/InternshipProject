"""Reports and analytics router."""
from datetime import datetime, date, timedelta
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, and_
from backend.database import get_db
from backend.models import (
    Invoice, Booking, Room, InventoryItem, StockBatch, WasteLog,
    Vendor, AuditLog, Alert, KitchenOrder,
    IncidentReport, MealAttendance, AttendanceStatus, MessBill, MessBillStatus,
    Member, MemberStatus,
)
from backend.auth import PermissionChecker

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

    # Procurement - active vendor count (self-purchase, no delivery accuracy to track)
    active_vendor_count = db.query(Vendor).filter(Vendor.is_active == True).count()

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
        "total_guests_today": today_guests,
        "low_stock_count": low_stock_result or 0,
        "open_incidents": open_incidents,
        "attendance_present_today": attendance_present,
        "attendance_absent_today": attendance_absent,
        "active_vendor_count": active_vendor_count,
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


def _invoice_revenue(db: Session, start_dt: datetime, end_dt: datetime, bill_type: str | None = None):
    q = db.query(func.sum(Invoice.total_amount)).filter(
        Invoice.created_at >= start_dt, Invoice.created_at < end_dt,
        Invoice.status.in_(["issued", "paid"]),
    )
    if bill_type:
        q = q.filter(Invoice.bill_type == bill_type)
    return float(q.scalar() or 0)


def _period_cost(db: Session, start_dt: datetime, end_dt: datetime):
    """Real, trackable operating cost for the period: self-purchase stock
    spend (raw materials, logged via Daily Stock Intake / Smart Intake)
    plus logged waste. No payroll/utilities module exists to draw from."""
    procurement = float(db.query(func.sum(StockBatch.quantity * StockBatch.unit_cost)).filter(
        StockBatch.created_at >= start_dt, StockBatch.created_at < end_dt,
    ).scalar() or 0)
    waste = float(db.query(func.sum(WasteLog.cost)).filter(
        WasteLog.created_at >= start_dt, WasteLog.created_at < end_dt,
    ).scalar() or 0)
    return procurement, waste


@router.get("/revenue-summary")
async def revenue_summary(db: Session = Depends(get_db), current_user=Depends(PermissionChecker("reports", "view"))):
    """Compact Manager-dashboard widget: a short sparkline plus this-week vs
    last-week compared like-for-like (same number of elapsed days), so a
    Tuesday reading isn't compared against a full Sun-Sat prior week."""
    today = date.today()
    sparkline = []
    for i in range(13, -1, -1):
        d = today - timedelta(days=i)
        start = datetime.combine(d, datetime.min.time())
        sparkline.append(round(_invoice_revenue(db, start, start + timedelta(days=1)), 2))

    days_elapsed = today.weekday() + 1  # Monday=0 -> 1 day elapsed so far
    week_start = today - timedelta(days=today.weekday())
    last_week_start = week_start - timedelta(days=7)

    current_week_total = _invoice_revenue(db, datetime.combine(week_start, datetime.min.time()),
                                           datetime.combine(today + timedelta(days=1), datetime.min.time()))
    last_week_comparable_total = _invoice_revenue(
        db, datetime.combine(last_week_start, datetime.min.time()),
        datetime.combine(last_week_start + timedelta(days=days_elapsed), datetime.min.time()))

    if last_week_comparable_total > 0:
        pct_change = round((current_week_total - last_week_comparable_total) / last_week_comparable_total * 100, 1)
    else:
        pct_change = 100.0 if current_week_total > 0 else 0.0

    return {
        "sparkline": sparkline,
        "current_week_total": round(current_week_total, 2),
        "last_week_comparable_total": round(last_week_comparable_total, 2),
        "pct_change": pct_change,
    }


@router.get("/revenue-detail")
async def revenue_detail(days: int = Query(30, ge=7, le=365), db: Session = Depends(get_db), current_user=Depends(PermissionChecker("reports", "view"))):
    """Manager-dashboard revenue popup: a revenue/cost/profit series for the
    requested range (1w/1m/3m/1y, daily buckets except 1y which buckets
    weekly to keep the series readable), the room/mess split, and a
    previous-equal-length-period comparison."""
    today = date.today()
    period_end = today + timedelta(days=1)  # exclusive upper bound, includes all of today
    period_start = today - timedelta(days=days - 1)

    weekly = days > 90
    labels, revenue_values, cost_values, profit_values = [], [], [], []
    bucket_start = period_start
    while bucket_start <= today:
        bucket_len = 7 if weekly else 1
        bucket_end = min(bucket_start + timedelta(days=bucket_len), period_end)
        start_dt = datetime.combine(bucket_start, datetime.min.time())
        end_dt = datetime.combine(bucket_end, datetime.min.time())
        rev = _invoice_revenue(db, start_dt, end_dt)
        procurement, waste = _period_cost(db, start_dt, end_dt)
        cost = procurement + waste
        labels.append(bucket_start.strftime("%Y-%m-%d"))
        revenue_values.append(round(rev, 2))
        cost_values.append(round(cost, 2))
        profit_values.append(round(rev - cost, 2))
        bucket_start = bucket_end

    full_start_dt = datetime.combine(period_start, datetime.min.time())
    full_end_dt = datetime.combine(period_end, datetime.min.time())
    room_revenue_total = _invoice_revenue(db, full_start_dt, full_end_dt, bill_type="room")
    mess_revenue_total = _invoice_revenue(db, full_start_dt, full_end_dt, bill_type="mess")
    revenue_total = sum(revenue_values)
    procurement_total, waste_total = _period_cost(db, full_start_dt, full_end_dt)
    cost_total = procurement_total + waste_total
    profit_total = revenue_total - cost_total
    # "combined" is a legacy bill_type from before room/mess invoices were
    # split apart - folded into "other" so the room+mess+other split still
    # accounts for the full revenue_total.
    other_revenue_total = round(revenue_total - room_revenue_total - mess_revenue_total, 2)

    prev_start = period_start - timedelta(days=days)
    prev_end = period_start
    prev_start_dt = datetime.combine(prev_start, datetime.min.time())
    prev_end_dt = datetime.combine(prev_end, datetime.min.time())
    prev_revenue = _invoice_revenue(db, prev_start_dt, prev_end_dt)
    prev_procurement, prev_waste = _period_cost(db, prev_start_dt, prev_end_dt)
    prev_cost = prev_procurement + prev_waste
    prev_profit = prev_revenue - prev_cost

    def pct(curr, prev):
        if prev > 0:
            return round((curr - prev) / prev * 100, 1)
        return 100.0 if curr > 0 else 0.0

    return {
        "labels": labels, "revenue": revenue_values, "cost": cost_values, "profit": profit_values,
        "room_revenue_total": round(room_revenue_total, 2),
        "mess_revenue_total": round(mess_revenue_total, 2),
        "other_revenue_total": other_revenue_total,
        "revenue_total": round(revenue_total, 2),
        "cost_total": round(cost_total, 2),
        "profit_total": round(profit_total, 2),
        "previous_revenue_total": round(prev_revenue, 2),
        "previous_cost_total": round(prev_cost, 2),
        "previous_profit_total": round(prev_profit, 2),
        "revenue_pct_change": pct(revenue_total, prev_revenue),
        "cost_pct_change": pct(cost_total, prev_cost),
        "profit_pct_change": pct(profit_total, prev_profit),
    }


@router.get("/occupancy-detail")
async def occupancy_detail(db: Session = Depends(get_db), current_user=Depends(PermissionChecker("reports", "view"))):
    """Manager-dashboard occupancy popup: today's occupied/non-occupied split
    plus a breakdown of each side, and last week's occupancy rate for the
    inner trend ring."""
    today = date.today()
    total_rooms = db.query(Room).filter(Room.is_active == True).count()

    non_occupied_by_status = {
        status: db.query(Room).filter(Room.is_active == True, Room.status == status).count()
        for status in ["vacant", "reserved", "maintenance"]
    }
    occupied_count = db.query(Room).filter(Room.is_active == True, Room.status == "occupied").count()
    not_occupied_count = sum(non_occupied_by_status.values())

    duty_rows = db.query(Booking.nature_of_duty, func.count(Booking.id)).filter(
        Booking.status == "checked_in",
    ).group_by(Booking.nature_of_duty).all()
    occupied_by_duty = {duty or "visit": count for duty, count in duty_rows}

    last_week = today - timedelta(days=7)
    last_week_occupied = db.query(Booking).filter(
        Booking.check_in <= last_week, Booking.check_out >= last_week,
        Booking.status.in_(["checked_in"]),
    ).count()
    last_week_rate = round(last_week_occupied / total_rooms * 100, 1) if total_rooms else 0

    return {
        "total_rooms": total_rooms,
        "occupied_count": occupied_count,
        "not_occupied_count": not_occupied_count,
        "occupancy_rate": round(occupied_count / total_rooms * 100, 1) if total_rooms else 0,
        "non_occupied_by_status": non_occupied_by_status,
        "occupied_by_duty": occupied_by_duty,
        "last_week_occupancy_rate": last_week_rate,
    }


@router.get("/cost-revenue-flow")
async def cost_revenue_flow(days: int = Query(30, ge=1, le=365), db: Session = Depends(get_db), current_user=Depends(PermissionChecker("reports", "view"))):
    """Manager-dashboard Sankey source data: revenue by source, cost by
    category, and the profit/loss remainder, for the requested trailing
    window (defaults to the last 30 days)."""
    today = date.today()
    start_dt = datetime.combine(today - timedelta(days=days - 1), datetime.min.time())
    end_dt = datetime.combine(today + timedelta(days=1), datetime.min.time())

    room_revenue = _invoice_revenue(db, start_dt, end_dt, bill_type="room")
    mess_revenue = _invoice_revenue(db, start_dt, end_dt, bill_type="mess")
    total_revenue = _invoice_revenue(db, start_dt, end_dt)
    other_revenue = round(total_revenue - room_revenue - mess_revenue, 2)
    procurement_cost, waste_cost = _period_cost(db, start_dt, end_dt)
    profit = total_revenue - procurement_cost - waste_cost

    return {
        "room_revenue": round(room_revenue, 2),
        "mess_revenue": round(mess_revenue, 2),
        "other_revenue": max(other_revenue, 0.0),
        "procurement_cost": round(procurement_cost, 2),
        "waste_cost": round(waste_cost, 2),
        "total_revenue": round(total_revenue, 2),
        "profit": round(profit, 2),
    }


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
    """Top vendors by total self-purchase spend in the last 30 days (Daily
    Stock Intake / Smart Intake batches tagged with that vendor) - the only
    real per-vendor signal now that the mess buys directly rather than
    through a PO a vendor could be scored for fulfilling."""
    since = datetime.utcnow() - timedelta(days=30)
    rows = (
        db.query(Vendor.name, func.sum(StockBatch.quantity * StockBatch.unit_cost).label("spend"))
        .join(StockBatch, StockBatch.vendor_id == Vendor.id)
        .filter(Vendor.is_active == True, StockBatch.created_at >= since)
        .group_by(Vendor.id)
        .order_by(func.sum(StockBatch.quantity * StockBatch.unit_cost).desc())
        .limit(10)
        .all()
    )
    return [{"name": name, "spend_30d": round(float(spend or 0), 2)} for name, spend in rows]
