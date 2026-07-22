"""Cross-cutting schemas with no single domain owner, plus small shared
validation helpers used by more than one domain (meal-type validation,
exactly-one-consumer checks)."""
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field

# Kept in sync with models.MealType. Defined here (rather than imported) to keep
# the schema layer free of an ORM dependency; a request carrying an unknown meal
# slot is rejected with a clean 422 instead of blowing up as a 500 when the
# SQLAlchemy Enum column rejects it at flush time.
_VALID_MEAL_TYPES = {"breakfast", "lunch", "hitea", "dinner"}


def _ensure_meal_type(v: str) -> str:
    if v not in _VALID_MEAL_TYPES:
        raise ValueError(f"meal_type must be one of {sorted(_VALID_MEAL_TYPES)}")
    return v


def _check_exactly_one_consumer(member_id, booking_id, guest_id):
    if sum(x is not None for x in (member_id, booking_id, guest_id)) != 1:
        raise ValueError("Provide exactly one of member_id, booking_id, or guest_id")


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: Optional[Dict[str, Any]] = None

class LoginRequest(BaseModel):
    username: str
    password: str

class PasswordChange(BaseModel):
    old_password: str
    new_password: str = Field(..., min_length=6)


class DashboardStats(BaseModel):
    today_revenue: float
    occupancy_rate: float
    total_stock_value: float
    waste_cost_month: float
    open_alerts: int
    pending_approvals: int
    total_guests_today: int
    low_stock_count: int

class TrendData(BaseModel):
    labels: List[str]
    values: List[float]

class PaginatedResponse(BaseModel):
    items: List[Any]
    total: int
    page: int
    page_size: int

class ExportRequest(BaseModel):
    format: str = "xlsx"  # xlsx or pdf
    filters: Optional[Dict[str, Any]] = None

class ImportPreview(BaseModel):
    module: str
    column_mapping: Dict[str, str]

class ImportResult(BaseModel):
    imported: int
    errors: int
    error_details: List[str]


class BrandingConfig(BaseModel):
    badge_text: str = "EME MESS"
    badge_position: str = "bottom-right"
    splash_title: str = "EME MESS Management"
    splash_subtitle: str = "EME Officers Mess, Rawalpindi"
    splash_duration_seconds: int = 3
