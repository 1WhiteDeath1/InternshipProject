"""Meal booking-cutoff rules, shared by the Attendance and Kitchen routers.

Lives here rather than in either router because both need the same answer to
"is this meal still editable?" - Attendance gates its roster/dish writes on it,
and Kitchen's merged Meals board shows the same lock state on the board itself.
"""
from datetime import datetime, date, time
from sqlalchemy.orm import Session
from backend.services.mess_billing_calc import get_setting_str

# Nominal serving times - a fallback reference only, NOT the booking cutoff.
# The cutoff is the settable meal_cutoff_<type> SystemSetting below.
MEAL_TIMES = {
    "breakfast": time(7, 0),
    "lunch": time(13, 0),
    "hitea": time(16, 30),
    "dinner": time(20, 0),
}

DEFAULT_CUTOFFS = {
    "breakfast": time(9, 0),
    "lunch": time(14, 30),
    "hitea": time(17, 30),
    "dinner": time(21, 30),
}


def get_meal_cutoff_time(db: Session, meal_type: str) -> time:
    """The absolute clock time after which this meal's attendance is final,
    from the editable meal_cutoff_<type> SystemSetting (Settings page)."""
    default = DEFAULT_CUTOFFS.get(meal_type, time(23, 59))
    raw = get_setting_str(db, f"meal_cutoff_{meal_type}", default.strftime("%H:%M"))
    try:
        hh, mm = raw.split(":")
        return time(int(hh), int(mm))
    except (ValueError, TypeError):
        return default


def is_locked(meal_date: date, cutoff_time: time) -> bool:
    """A meal is final (locked) for any date that's already fully elapsed, or
    for today once the clock passes its settable cutoff time. A future date is
    never locked - its cutoff simply hasn't arrived yet."""
    today = date.today()
    if meal_date < today:
        return True
    if meal_date > today:
        return False
    return datetime.utcnow() > datetime.combine(meal_date, cutoff_time)
