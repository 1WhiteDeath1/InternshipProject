"""Shared calculation helpers for mess attendance/billing."""
from datetime import date
from calendar import monthrange
from sqlalchemy.orm import Session
from backend.models import MealAttendance, AttendanceStatus, SystemSetting


def get_setting_float(db: Session, key: str, default: float) -> float:
    """Read a numeric SystemSetting, falling back to `default` if the row
    doesn't exist yet (settings are lazily seeded on first GET /settings)
    or isn't parseable."""
    setting = db.query(SystemSetting).filter(SystemSetting.key == key).first()
    if not setting or not setting.value:
        return default
    try:
        return float(setting.value)
    except ValueError:
        return default


def get_setting_str(db: Session, key: str, default: str) -> str:
    """Read a text SystemSetting, falling back to `default` when unset."""
    setting = db.query(SystemSetting).filter(SystemSetting.key == key).first()
    if not setting or not (setting.value or "").strip():
        return default
    return setting.value.strip()


def get_man_days(db: Session, member_id: int, month: int, year: int) -> int:
    """Count of attended-or-no-show meal-slots for a member in a given month/year.

    ATTENDED and NO_SHOW both consume a man-day (a no-show is still a meal the
    member is charged for) - BOOKED (not yet marked/swept) and CANCELLED/
    EXCLUDED (on leave) do not.
    """
    start = date(year, month, 1)
    end = date(year, month, monthrange(year, month)[1])
    return db.query(MealAttendance).filter(
        MealAttendance.member_id == member_id,
        MealAttendance.date >= start,
        MealAttendance.date <= end,
        MealAttendance.status.in_([AttendanceStatus.ATTENDED, AttendanceStatus.NO_SHOW]),
    ).count()
