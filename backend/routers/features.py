"""Feature flags router."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.models import FeatureFlag
from backend.schemas import FeatureFlagOut, FeatureFlagToggle
from backend.auth import require_supervisor
from backend.audit import log_audit, serialize_model, AuditAction

router = APIRouter()


DEFAULT_FEATURES = [
    FeatureFlag(key="waste_logging", name="Waste Logging", description="Log and track food waste by category", department="Kitchen Inventory", enabled=True),
    FeatureFlag(key="cycle_counts", name="Cycle Counts", description="Physical stock count verification with variance detection", department="Kitchen Inventory", enabled=True),
    FeatureFlag(key="fifo_fefo", name="FIFO/FEFO Expiry Enforcement", description="Enforce first-in-first-out and first-expired-first-out picking", department="Kitchen Inventory", enabled=True),
    FeatureFlag(key="bin_locations", name="Bin/Location Assignment", description="Assign shelf/bin locations to stock batches", department="Kitchen Inventory", enabled=True),
    FeatureFlag(key="expiry_alerts", name="Expiry Alerts", description="Proactive alerts for items nearing expiration", department="Kitchen Inventory", enabled=True),
    FeatureFlag(key="three_way_match", name="Three-way Match Verification", description="Verify PO, delivery note, and receipt quantities match", department="Procurement", enabled=True),
    FeatureFlag(key="purchase_forecasting", name="Smart Purchase Forecasting", description="Consumption-based reorder recommendations", department="Procurement", enabled=True),
    FeatureFlag(key="vendor_tracking", name="Vendor Performance Tracking", description="Track and score vendor delivery accuracy", department="Procurement", enabled=True),
    FeatureFlag(key="recipe_deductions", name="Recipe-linked Stock Deductions", description="Auto-deduct ingredients when orders are placed", department="Kitchen Orders", enabled=True),
    FeatureFlag(key="portion_tracking", name="Portion Tracking", description="Track actual vs planned portions", department="Kitchen Orders", enabled=True),
    FeatureFlag(key="food_cost_reports", name="Food Cost Reports", description="Generate food cost percentage reports", department="Kitchen Orders", enabled=True),
    FeatureFlag(key="live_occupancy", name="Live Occupancy View", description="Real-time room occupancy dashboard", department="Booking", enabled=True),
    FeatureFlag(key="double_booking_guard", name="Double-booking Guard", description="Prevent overlapping room bookings", department="Booking", enabled=True),
    FeatureFlag(key="guest_movement_log", name="Guest Movement Log", description="Track check-in, check-out, and room changes", department="Booking", enabled=True),
    FeatureFlag(key="unbilled_detection", name="Unbilled-stay Detection", description="Alert when guests check out without billing", department="Billing", enabled=True),
    FeatureFlag(key="auto_sync", name="Billing-booking Auto-sync", description="Keep billing in sync with booking changes", department="Billing", enabled=True),
    FeatureFlag(key="pdf_invoices", name="PDF Invoice Generation", description="Generate printable PDF invoices", department="Billing", enabled=True),
    FeatureFlag(key="checkin_checkout_log", name="Check-in/Check-out Log", description="Security log for guest movements", department="Security", enabled=True),
    FeatureFlag(key="after_hours_alerts", name="After-hours Access Alerts", description="Alert on logins and events outside business hours", department="Security", enabled=True),
    FeatureFlag(key="incident_reports", name="Incident Reports", description="File and track security incidents", department="Security", enabled=True),
    FeatureFlag(key="advanced_analytics", name="Advanced Analytics", description="Detailed charts and trend analysis", department="Reports", enabled=True),
    FeatureFlag(key="dept_comparisons", name="Department Comparisons", description="Compare metrics across departments", department="Reports", enabled=True),
    FeatureFlag(key="auto_backup_scheduler", name="Automated Backup Scheduler", description="Schedule automatic database backups", department="System", enabled=True),
    FeatureFlag(key="excel_import_export", name="Excel Import/Export", description="Import and export data via Excel files", department="System", enabled=True),
    FeatureFlag(key="hover_sounds", name="Hover Sound Effects", description="Subtle sound effects on hover and click (opt-in)", department="System", enabled=False),
    FeatureFlag(key="mess_members", name="Member Management", description="Army mess member/officer roster", department="Mess", enabled=True),
    FeatureFlag(key="mess_attendance", name="Meal Attendance & Booking", description="Advance meal booking and attendance tracking for members", department="Mess", enabled=True),
    FeatureFlag(key="mess_billing", name="Mess Billing", description="Communal per-head mess bill generation for members", department="Mess", enabled=True),
    FeatureFlag(key="kitchen_module", name="Kitchen Module", description="Recipe/menu management and kitchen production orders", department="Mess", enabled=True),
]


@router.get("")
async def list_features(db: Session = Depends(get_db), current_user=Depends(require_supervisor)):
    # Seed any default whose key isn't already present, rather than only
    # seeding when the whole table is empty - otherwise a default added in a
    # later release would never appear on any already-seeded database.
    existing_keys = {row.key for row in db.query(FeatureFlag.key).all()}
    missing = [FeatureFlag(key=d.key, name=d.name, description=d.description, department=d.department, enabled=d.enabled)
               for d in DEFAULT_FEATURES if d.key not in existing_keys]
    if missing:
        for d in missing:
            db.add(d)
        db.commit()
    return db.query(FeatureFlag).all()


@router.put("/{feature_id}/toggle")
async def toggle_feature(feature_id: int, data: FeatureFlagToggle, db: Session = Depends(get_db), current_user=Depends(require_supervisor)):
    f = db.query(FeatureFlag).filter(FeatureFlag.id == feature_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="Feature not found")
    before = serialize_model(f)
    f.enabled = data.enabled
    db.commit()
    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "feature_flags", f.id, before_state=before, after_state=serialize_model(f), reason=f"Feature toggled to {data.enabled}")
    return f
