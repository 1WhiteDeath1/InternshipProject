"""System settings router."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.models import SystemSetting
from backend.schemas import SettingOut, SettingUpdate
from backend.auth import require_supervisor
from backend.audit import log_audit, serialize_model, AuditAction
from backend.config import settings as app_settings

router = APIRouter()


@router.get("")
async def list_settings(db: Session = Depends(get_db), current_user=Depends(require_supervisor)):
    items = db.query(SystemSetting).all()
    if not items:
        defaults = [
            SystemSetting(key="max_login_attempts", value="5", description="Max failed login attempts before lockout"),
            SystemSetting(key="lockout_duration", value="30", description="Account lockout duration in minutes"),
            SystemSetting(key="backup_schedule", value="daily", description="Automatic backup frequency"),
            SystemSetting(key="backup_hour", value="2", description="Hour to run daily backup (0-23)"),
            SystemSetting(key="after_hours_start", value="22", description="After-hours alert start hour"),
            SystemSetting(key="after_hours_end", value="6", description="After-hours alert end hour"),
            SystemSetting(key="expiry_alert_days", value="7", description="Days before expiry to alert"),
            SystemSetting(key="waste_threshold_pct", value="5", description="Waste percentage threshold for alerts"),
            SystemSetting(key="low_stock_alert", value="true", description="Enable low stock alerts"),
            SystemSetting(key="auto_backup", value="true", description="Enable automatic backups"),
            SystemSetting(key="meal_booking_cutoff_minutes", value="120", description="Minutes before meal time after which booking/changes require override"),
            SystemSetting(key="member_fixed_menu_base_price", value="0.00", description="Optional flat monthly menu rate override for permanent members (0 = use dynamic per-head rate)"),
            SystemSetting(key="member_room_night_rate", value="0.00", description="Preferential room rate for a permanent member occupying a room, if set (0 = use room's own rate)"),
            SystemSetting(key="guest_room_night_rate", value="0.00", description="Reference/override room rate for non-member stays (0 = use room's own rate)"),
            SystemSetting(key="civilian_meal_multiplier", value="1.00", description="Multiplier applied to extra-meal charges for civilian non-members"),
            SystemSetting(key="non_civilian_meal_multiplier", value="1.00", description="Multiplier applied to extra-meal charges for non-civilian non-members"),
            SystemSetting(key="default_member_discount_rate", value="0.00", description="Institution-wide baseline member discount percentage, used when a member has no custom rate set"),
        ]
        for d in defaults:
            db.add(d)
        db.commit()
        items = db.query(SystemSetting).all()
    return items


@router.put("/{key}")
async def update_setting(key: str, data: SettingUpdate, db: Session = Depends(get_db), current_user=Depends(require_supervisor)):
    s = db.query(SystemSetting).filter(SystemSetting.key == key).first()
    if not s:
        raise HTTPException(status_code=404, detail="Setting not found")
    before = serialize_model(s)
    s.value = data.value
    s.updated_by = current_user.id
    db.commit()
    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "system_settings", s.id, before_state=before, after_state=serialize_model(s))
    return s
