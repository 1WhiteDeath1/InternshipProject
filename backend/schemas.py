"""Pydantic schemas for request/response models."""
from datetime import datetime, date
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field, ConfigDict, model_validator, field_validator

# Kept in sync with models.MealType. Defined here (rather than imported) to keep
# the schema layer free of an ORM dependency; a request carrying an unknown meal
# slot is rejected with a clean 422 instead of blowing up as a 500 when the
# SQLAlchemy Enum column rejects it at flush time.
_VALID_MEAL_TYPES = {"breakfast", "lunch", "hitea", "dinner"}


def _ensure_meal_type(v: str) -> str:
    if v not in _VALID_MEAL_TYPES:
        raise ValueError(f"meal_type must be one of {sorted(_VALID_MEAL_TYPES)}")
    return v


# --- Auth Schemas ---

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


# --- User Schemas ---

class UserBase(BaseModel):
    username: str = Field(..., min_length=3, max_length=100)
    email: str
    full_name: str = Field(..., min_length=1, max_length=200)
    role_id: int
    status: str = "active"

class UserCreate(UserBase):
    password: str = Field(..., min_length=6)

class UserUpdate(BaseModel):
    email: Optional[str] = None
    full_name: Optional[str] = None
    role_id: Optional[int] = None
    status: Optional[str] = None
    preferences: Optional[str] = None

class UserOut(UserBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    last_login: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    role_name: Optional[str] = None
    is_supervisor: bool = False

class UserListResponse(BaseModel):
    items: List[UserOut]
    total: int
    page: int
    page_size: int


# --- Role Schemas ---

class RolePermissionBase(BaseModel):
    module: str
    action: str
    data_scope: Optional[str] = None

class RolePermissionCreate(RolePermissionBase):
    pass

class RolePermissionOut(RolePermissionBase):
    model_config = ConfigDict(from_attributes=True)
    id: int

class RoleBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None

class RoleCreate(RoleBase):
    is_supervisor: bool = False
    permissions: List[RolePermissionCreate] = []

class RoleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_supervisor: Optional[bool] = None
    permissions: Optional[List[RolePermissionCreate]] = None

class RoleOut(RoleBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_supervisor: bool
    created_at: datetime
    permissions: List[RolePermissionOut] = []


# --- Feature Flag Schemas ---

class FeatureFlagOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    key: str
    name: str
    description: Optional[str]
    department: str
    enabled: bool

class FeatureFlagToggle(BaseModel):
    enabled: bool


# --- System Setting Schemas ---

class SettingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    key: str
    value: Optional[str]
    description: Optional[str]

class SettingUpdate(BaseModel):
    value: str


# --- Audit Log Schemas ---

class AuditLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    user_id: Optional[int]
    user_name: Optional[str]
    action: str
    entity_type: str
    entity_id: Optional[int]
    before_state: Optional[str]
    after_state: Optional[str]
    reason: Optional[str]
    department: Optional[str]
    timestamp: datetime
    ip_address: Optional[str]

class AuditLogList(BaseModel):
    items: List[AuditLogOut]
    total: int


# --- Alert Schemas ---

class AlertOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    message: str
    severity: str
    status: str
    module: str
    created_at: datetime

class AlertAcknowledge(BaseModel):
    status: str


# --- Inventory Schemas ---

class InventoryCategoryBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None

class InventoryCategoryCreate(InventoryCategoryBase):
    pass

class InventoryCategoryOut(InventoryCategoryBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool
    created_at: datetime

class InventoryItemBase(BaseModel):
    sku: str = Field(..., min_length=1, max_length=100)
    name: str = Field(..., min_length=1, max_length=200)
    category_id: int
    description: Optional[str] = None
    unit: str = Field(..., min_length=1, max_length=50)
    reorder_level: float = 0
    reorder_quantity: float = 0
    ingredient_type: Optional[str] = None  # "liquid" | "powder" | "granular" | "solid_pieces" | None

class InventoryItemCreate(InventoryItemBase):
    pass

class InventoryItemUpdate(BaseModel):
    sku: Optional[str] = None
    name: Optional[str] = None
    category_id: Optional[int] = None
    description: Optional[str] = None
    unit: Optional[str] = None
    reorder_level: Optional[float] = None
    reorder_quantity: Optional[float] = None
    ingredient_type: Optional[str] = None

class InventoryItemOut(InventoryItemBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool
    created_at: datetime
    category_name: Optional[str] = None
    total_stock: float = 0

class StockBatchBase(BaseModel):
    item_id: int
    batch_number: str = Field(..., min_length=1, max_length=100)
    quantity: float = Field(..., gt=0)
    bin_location: Optional[str] = None
    expiry_date: Optional[date] = None
    unit_cost: float = 0

class StockBatchCreate(StockBatchBase):
    pass

class StockBatchOut(StockBatchBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    received_date: date
    is_active: bool
    item_name: Optional[str] = None

class StockMovementCreate(BaseModel):
    batch_id: int
    item_id: int
    movement_type: str
    quantity: float = Field(..., gt=0)
    reference_type: Optional[str] = None
    reference_id: Optional[int] = None
    notes: Optional[str] = None

class WasteLogCreate(BaseModel):
    item_id: int
    batch_id: Optional[int] = None
    quantity: float = Field(..., gt=0)
    category: str
    note: Optional[str] = None
    cost: float = 0

class WasteLogOut(WasteLogCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    item_name: Optional[str] = None
    logged_by: Optional[int] = None
    created_at: datetime

class CycleCountCreate(BaseModel):
    item_id: int
    batch_id: Optional[int] = None
    expected_quantity: float
    actual_quantity: float
    notes: Optional[str] = None


# --- Recipe Schemas ---

class RecipeIngredientBase(BaseModel):
    item_id: int
    quantity: float = Field(..., gt=0)
    unit: str

class RecipeBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    menu_category: Optional[str] = None
    portions: int = Field(1, gt=0)

class RecipeCreate(RecipeBase):
    ingredients: List[RecipeIngredientBase] = []

class RecipeUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    menu_category: Optional[str] = None
    portions: Optional[int] = Field(None, gt=0)
    is_active: Optional[bool] = None
    ingredients: Optional[List[RecipeIngredientBase]] = None  # replaces all existing ingredients when provided

class RecipeIngredientOut(RecipeIngredientBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    item_name: Optional[str] = None

class RecipeOut(RecipeBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool
    ingredients: List[RecipeIngredientOut] = []

class KitchenOrderCreate(BaseModel):
    recipe_id: int
    quantity_ordered: int = Field(1, gt=0)
    notes: Optional[str] = None
    is_ala_carte: bool = False
    consumer_type: Optional[str] = None  # "member" | "guest"
    member_id: Optional[int] = None
    booking_id: Optional[int] = None
    sla_minutes: Optional[int] = Field(None, gt=0)

    @model_validator(mode="after")
    def _check_consumer(self):
        if self.is_ala_carte:
            if bool(self.member_id) == bool(self.booking_id):
                raise ValueError("Exactly one of member_id or booking_id is required for an a la carte order")
            self.consumer_type = "member" if self.member_id else "guest"
        return self

class KitchenOrderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    recipe_id: int
    recipe_name: Optional[str] = None
    quantity_ordered: int
    actual_portions: Optional[int] = None
    food_cost: Optional[float] = None
    status: str
    notes: Optional[str] = None
    meal_date: Optional[date] = None
    meal_type: Optional[str] = None
    source: Optional[str] = None
    ordered_by: Optional[int] = None
    created_at: datetime
    is_ala_carte: bool = False
    consumer_type: Optional[str] = None
    member_id: Optional[int] = None
    booking_id: Optional[int] = None
    consumer_name: Optional[str] = None
    sla_minutes: Optional[int] = None
    due_at: Optional[datetime] = None
    cooking_started_at: Optional[datetime] = None

class KitchenOrderPrepareRequest(BaseModel):
    actual_portions: Optional[int] = Field(None, gt=0)

class MenuPriceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    recipe_id: int
    recipe_name: Optional[str] = None
    price: float
    is_active: bool
    updated_at: Optional[datetime] = None

class MenuPriceUpdate(BaseModel):
    price: float = Field(..., ge=0)
    is_active: bool = True


# --- Vendor Schemas ---

class VendorBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    tax_id: Optional[str] = None
    payment_terms: Optional[str] = None

class VendorCreate(VendorBase):
    pass

class VendorUpdate(VendorBase):
    name: Optional[str] = None

class VendorOut(VendorBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    delivery_accuracy: float
    is_active: bool
    created_at: datetime


# --- Purchase Order Schemas ---

class POItemBase(BaseModel):
    item_id: int
    quantity_ordered: float = Field(..., gt=0)
    unit_price: float = Field(..., gt=0)

class POItemOut(POItemBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    quantity_delivered: float
    quantity_received: float
    total_price: float
    item_name: Optional[str] = None

class PurchaseOrderBase(BaseModel):
    vendor_id: int
    expected_delivery: Optional[date] = None
    notes: Optional[str] = None

class PurchaseOrderCreate(PurchaseOrderBase):
    items: List[POItemBase]

class PurchaseOrderUpdate(BaseModel):
    status: Optional[str] = None
    expected_delivery: Optional[date] = None
    notes: Optional[str] = None

class PurchaseOrderOut(PurchaseOrderBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    po_number: str
    status: str
    total_amount: float
    created_at: datetime
    vendor_name: Optional[str] = None
    items: List[POItemOut] = []

class ReceivingItem(BaseModel):
    po_item_id: int
    quantity: float = Field(..., ge=0)

class ReceivingQuantities(BaseModel):
    items: List[ReceivingItem]

class ThreeWayMatchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    po_id: int
    po_quantity: float
    delivery_quantity: float
    received_quantity: float
    variance: float
    is_matched: bool
    created_at: datetime


# --- Room & Booking Schemas ---

class RoomBase(BaseModel):
    room_number: str = Field(..., min_length=1, max_length=20)
    room_type: str
    floor: int = 1
    capacity: int = 2
    base_price: float = Field(..., gt=0)
    amenities: Optional[str] = None

class RoomCreate(RoomBase):
    pass

class RoomUpdate(BaseModel):
    room_type: Optional[str] = None
    floor: Optional[int] = None
    capacity: Optional[int] = None
    base_price: Optional[float] = None
    amenities: Optional[str] = None
    status: Optional[str] = None

class RoomOut(RoomBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    status: str
    is_active: bool
    created_at: datetime
    current_guest: Optional[str] = None
    current_check_out: Optional[date] = None

class BookingBase(BaseModel):
    guest_name: str = Field(..., min_length=1, max_length=200)
    guest_phone: Optional[str] = None
    guest_email: Optional[str] = None
    guest_id_type: Optional[str] = None
    guest_id_number: Optional[str] = None
    room_id: int
    check_in: date
    check_out: date
    adults: int = 1
    children: int = 0
    special_requests: Optional[str] = None
    client_category: str = "non_member_civilian"
    member_id: Optional[int] = None
    # Booking-register fields
    rank: Optional[str] = Field(None, max_length=50)
    pa_number: Optional[str] = Field(None, max_length=50)
    unit_address: Optional[str] = Field(None, max_length=255)
    nature_of_duty: str = "visit"
    da_multiplier: Optional[float] = None
    mattress_count: int = Field(0, ge=0, le=10)

    @model_validator(mode="after")
    def _check_dates(self):
        if self.check_out <= self.check_in:
            raise ValueError("check_out must be after check_in")
        if self.nature_of_duty not in ("visit", "leave", "official_duty", "hra"):
            raise ValueError("nature_of_duty must be one of: visit, leave, official_duty, hra")
        if self.da_multiplier is not None and self.da_multiplier not in (1.0, 1.5):
            raise ValueError("da_multiplier must be 1 or 1.5")
        return self

class BookingCreate(BookingBase):
    check_in_now: bool = False  # walk-in fast path: create and check in immediately

class BookingUpdate(BaseModel):
    guest_name: Optional[str] = None
    guest_phone: Optional[str] = None
    guest_email: Optional[str] = None
    room_id: Optional[int] = None
    check_in: Optional[date] = None
    check_out: Optional[date] = None
    status: Optional[str] = None
    special_requests: Optional[str] = None

    @model_validator(mode="after")
    def _check_dates(self):
        if self.check_in is not None and self.check_out is not None and self.check_out <= self.check_in:
            raise ValueError("check_out must be after check_in")
        return self

class BookingOut(BookingBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    booking_reference: str
    status: str
    total_amount: Optional[float] = None
    processed_by: Optional[int] = None
    created_at: datetime
    room_number: Optional[str] = None
    member_name: Optional[str] = None

class GuestMovementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    booking_id: int
    movement_type: str
    timestamp: datetime
    processed_by: Optional[int] = None
    notes: Optional[str] = None


# --- Invoice Schemas ---

class InvoiceItemCreate(BaseModel):
    description: str
    quantity: float = Field(1, gt=0)
    unit_price: float = Field(..., ge=0)
    is_meal_charge: bool = False  # if true, unit_price is scaled by the booking's client_category meal multiplier

class InvoiceBase(BaseModel):
    booking_id: int
    issue_date: date
    due_date: date
    subtotal: float
    tax_amount: float = Field(0, ge=0)
    discount: float = Field(0, ge=0)
    total_amount: float
    notes: Optional[str] = None

class InvoiceCreate(InvoiceBase):
    items: List[InvoiceItemCreate]

class InvoiceItemOut(InvoiceItemCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    total_price: float

class InvoiceOut(InvoiceBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    invoice_number: str
    status: str
    amount_paid: float
    created_at: datetime
    items: List[InvoiceItemOut] = []
    guest_name: Optional[str] = None
    room_number: Optional[str] = None


class PaymentCreate(BaseModel):
    amount: float = Field(..., gt=0)
    method: Optional[str] = None
    notes: Optional[str] = None

class PaymentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    invoice_id: int
    amount: float
    method: Optional[str] = None
    notes: Optional[str] = None
    received_by: Optional[int] = None
    created_at: datetime


# --- Security Schemas ---

class SecurityLogCreate(BaseModel):
    event_type: str
    booking_id: Optional[int] = None
    guest_name: Optional[str] = None
    room_number: Optional[str] = None
    notes: Optional[str] = None

class SecurityLogOut(SecurityLogCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    timestamp: datetime
    processed_by: Optional[int] = None

class IncidentReportBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    description: str
    location: Optional[str] = None
    category: Optional[str] = None
    severity: str = "low"

class IncidentReportCreate(IncidentReportBase):
    pass

class IncidentReportUpdate(BaseModel):
    status: Optional[str] = None
    resolution: Optional[str] = None

class IncidentReportOut(IncidentReportBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    status: str
    reported_by: Optional[int] = None
    created_at: datetime
    resolved_at: Optional[datetime] = None


# --- Dashboard & Report Schemas ---

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


# --- Branding Schemas ---

class BrandingConfig(BaseModel):
    badge_text: str = "SAM"
    badge_position: str = "bottom-right"
    splash_title: str = "SAM Hotel & Mess Management"
    splash_subtitle: str = "Developed by SAM Technologies"
    splash_duration_seconds: int = 3


# --- Member Schemas ---

class MemberBase(BaseModel):
    service_number: str = Field(..., min_length=1, max_length=50)
    full_name: str = Field(..., min_length=1, max_length=200)
    rank: str = Field(..., min_length=1, max_length=50)
    unit: Optional[str] = None
    mess_category: str
    phone: Optional[str] = None
    email: Optional[str] = None
    custom_discount_rate: float = Field(0, ge=0, le=100)

class MemberCreate(MemberBase):
    pass

class MemberUpdate(BaseModel):
    full_name: Optional[str] = None
    rank: Optional[str] = None
    unit: Optional[str] = None
    mess_category: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    status: Optional[str] = None
    custom_discount_rate: Optional[float] = Field(None, ge=0, le=100)

class MemberStatusChange(BaseModel):
    status: str
    reason: str = Field(..., min_length=1)

class MemberOut(MemberBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    client_category: str
    status: str
    created_at: datetime
    updated_at: datetime


# --- Meal Attendance & Leave Schemas ---

class MealAttendanceBase(BaseModel):
    member_id: Optional[int] = None
    booking_id: Optional[int] = None
    recipe_id: Optional[int] = None
    date: date
    meal_type: str
    method: str = "manual"

    _check_meal_type = field_validator("meal_type")(_ensure_meal_type)

class MealAttendanceCreate(MealAttendanceBase):
    @model_validator(mode="after")
    def _exactly_one_consumer(self):
        if (self.member_id is None) == (self.booking_id is None):
            raise ValueError("Provide exactly one of member_id or booking_id")
        return self

class MealAttendanceOut(MealAttendanceBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    status: str
    booked_at: datetime
    marked_at: Optional[datetime] = None
    marked_by: Optional[int] = None
    member_name: Optional[str] = None
    guest_name: Optional[str] = None
    recipe_name: Optional[str] = None

class AttendanceMarkRequest(BaseModel):
    status: str
    reason: Optional[str] = None

class BulkAttendanceCreate(BaseModel):
    member_ids: List[int] = Field(..., min_length=1)
    date: date
    meal_type: str
    method: str = "manual"

    _check_meal_type = field_validator("meal_type")(_ensure_meal_type)

class RosterSetRequest(BaseModel):
    date: date
    meal_type: str
    member_ids: List[int] = Field(..., min_length=1)
    present: bool
    recipe_id: Optional[int] = None
    reason: Optional[str] = None

    _check_meal_type = field_validator("meal_type")(_ensure_meal_type)

class MemberLeaveBase(BaseModel):
    member_id: int
    start_date: date
    end_date: date
    reason: Optional[str] = None

    @model_validator(mode="after")
    def _check_dates(self):
        if self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        return self

class MemberLeaveCreate(MemberLeaveBase):
    pass

class MemberLeaveOut(MemberLeaveBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    status: str
    created_at: datetime
    member_name: Optional[str] = None


# --- Mess Billing Schemas ---

class MessBillOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    member_id: int
    member_name: Optional[str] = None
    month: int
    year: int
    man_days: int
    per_head_rate: float
    base_menu_amount: float
    stay_amount: float
    extra_meals_amount: float
    applied_discount_rate: float
    discount_amount: float
    discount_approved_by: Optional[int] = None
    discount_reason: Optional[str] = None
    total_amount: float
    status: str
    generated_at: datetime

class GuestMealChargeCreate(BaseModel):
    sponsor_member_id: int
    guest_name: str = Field(..., min_length=1, max_length=200)
    date: date
    meal_type: str
    amount: float = Field(..., gt=0)
    notes: Optional[str] = None

    _check_meal_type = field_validator("meal_type")(_ensure_meal_type)

class GuestMealChargeOut(GuestMealChargeCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime

class DiscountApplyRequest(BaseModel):
    discount_rate: Optional[float] = Field(None, ge=0, le=100)
    discount_amount: Optional[float] = Field(None, ge=0)
    reason: str = Field(..., min_length=1)

    @model_validator(mode="after")
    def _exactly_one(self):
        if (self.discount_rate is None) == (self.discount_amount is None):
            raise ValueError("Provide exactly one of discount_rate or discount_amount")
        return self
