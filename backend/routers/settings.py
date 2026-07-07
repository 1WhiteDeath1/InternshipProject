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


# (key, default value, description). Seeded on first read OR first write, so a
# clerk can update a setting even if the Settings page was never opened first
# (previously PUT would 404 because the row hadn't been lazily created yet).
DEFAULT_SETTINGS = [
    ("max_login_attempts", "5", "Max failed login attempts before lockout"),
    ("lockout_duration", "30", "Account lockout duration in minutes"),
    ("backup_schedule", "daily", "Automatic backup frequency"),
    ("backup_hour", "2", "Hour to run daily backup (0-23)"),
    ("after_hours_start", "22", "After-hours alert start hour"),
    ("after_hours_end", "6", "After-hours alert end hour"),
    ("expiry_alert_days", "7", "Days before expiry to alert"),
    ("waste_threshold_pct", "5", "Waste percentage threshold for alerts"),
    ("low_stock_alert", "true", "Enable low stock alerts"),
    ("auto_backup", "true", "Enable automatic backups"),
    ("meal_booking_cutoff_minutes", "120", "Minutes before meal time after which booking/changes require override"),
    ("member_fixed_menu_base_price", "0.00", "Optional flat monthly menu rate override for permanent members (0 = use dynamic per-head rate)"),
    ("member_room_night_rate", "0.00", "Preferential room rate for a permanent member occupying a room, if set (0 = use room's own rate)"),
    ("guest_room_night_rate", "0.00", "Reference/override room rate for non-member stays (0 = use room's own rate)"),
    ("civilian_meal_multiplier", "1.00", "Multiplier applied to extra-meal charges for civilian non-members"),
    ("non_civilian_meal_multiplier", "1.00", "Multiplier applied to extra-meal charges for non-civilian non-members"),
    ("default_member_discount_rate", "0.00", "Institution-wide baseline member discount percentage, used when a member has no custom rate set"),
    ("ala_carte_default_sla_minutes", "45", "Default countdown timer (minutes) for a new a la carte kitchen order before it flips Late, if not manually overridden"),
    ("ala_carte_escalation_minutes", "15", "Additional minutes overdue past the SLA deadline before a Late order escalates to a CRITICAL admin alert"),
]


def _seed_missing_settings(db: Session) -> None:
    """Insert any default setting whose key isn't present yet. Keyed per-row (not
    'table is empty') so a default added in a later release still appears."""
    existing = {row.key for row in db.query(SystemSetting.key).all()}
    missing = [SystemSetting(key=k, value=v, description=d) for k, v, d in DEFAULT_SETTINGS if k not in existing]
    if missing:
        db.add_all(missing)
        db.commit()


@router.get("")
async def list_settings(db: Session = Depends(get_db), current_user=Depends(require_supervisor)):
    _seed_missing_settings(db)
    return db.query(SystemSetting).all()


@router.put("/{key}")
async def update_setting(key: str, data: SettingUpdate, db: Session = Depends(get_db), current_user=Depends(require_supervisor)):
    _seed_missing_settings(db)
    s = db.query(SystemSetting).filter(SystemSetting.key == key).first()
    if not s:
        raise HTTPException(status_code=404, detail="Setting not found")
    before = serialize_model(s)
    s.value = data.value
    s.updated_by = current_user.id
    db.commit()
    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "system_settings", s.id, before_state=before, after_state=serialize_model(s))
    return s
