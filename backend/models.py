"""SQLAlchemy models for Hotel & Mess Management System."""
import enum
from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime, Date, Text,
    ForeignKey, Enum, Numeric, JSON, BigInteger, Index
)
from sqlalchemy.orm import relationship
from backend.database import Base


# --- Enums ---

class UserStatus(str, enum.Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    SUSPENDED = "suspended"
    LOCKED = "locked"

class BookingStatus(str, enum.Enum):
    PENDING = "pending"
    CONFIRMED = "confirmed"
    CHECKED_IN = "checked_in"
    CHECKED_OUT = "checked_out"
    CANCELLED = "cancelled"

class RoomStatus(str, enum.Enum):
    VACANT = "vacant"
    OCCUPIED = "occupied"
    RESERVED = "reserved"
    MAINTENANCE = "maintenance"

class RoomType(str, enum.Enum):
    SINGLE = "single"
    DOUBLE = "double"
    DELUXE = "deluxe"
    SUITE = "suite"
    DORMITORY = "dormitory"

class POStatus(str, enum.Enum):
    DRAFT = "draft"
    APPROVED = "approved"
    SENT = "sent"
    DELIVERY_EXPECTED = "delivery_expected"
    PARTIALLY_RECEIVED = "partially_received"
    RECEIVED = "received"
    CANCELLED = "cancelled"

class InvoiceStatus(str, enum.Enum):
    DRAFT = "draft"
    ISSUED = "issued"
    PAID = "paid"
    VOID = "void"
    OVERDUE = "overdue"

class IngredientType(str, enum.Enum):
    LIQUID = "liquid"
    POWDER = "powder"
    GRANULAR = "granular"
    SOLID_PIECES = "solid_pieces"

class WasteCategory(str, enum.Enum):
    SPOILAGE = "spoilage"
    OVER_PREP = "over_prep"
    DAMAGE = "damage"
    EXPIRED = "expired"
    OTHER = "other"

class AlertSeverity(str, enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

class AlertStatus(str, enum.Enum):
    NEW = "new"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"
    DISMISSED = "dismissed"

class AuditAction(str, enum.Enum):
    CREATE = "create"
    UPDATE = "update"
    SOFT_DELETE = "soft_delete"
    APPROVE = "approve"
    TRANSFER = "transfer"
    LOGIN = "login"
    LOGOUT = "logout"
    OVERRIDE = "override"
    CLEAR_DATA = "clear_data"
    EXPORT = "export"
    IMPORT = "import"

class MessCategory(str, enum.Enum):
    OFFICERS = "officers"
    JCOS = "jcos"
    ORS = "ors"

class MemberStatus(str, enum.Enum):
    ACTIVE = "active"
    TRANSFERRED = "transferred"
    LEFT = "left"

class ClientCategory(str, enum.Enum):
    PERMANENT_MEMBER = "permanent_member"
    NON_MEMBER_CIVILIAN = "non_member_civilian"
    NON_MEMBER_NON_CIVILIAN = "non_member_non_civilian"

class MealType(str, enum.Enum):
    BREAKFAST = "breakfast"
    LUNCH = "lunch"
    HITEA = "hitea"
    DINNER = "dinner"

class AttendanceStatus(str, enum.Enum):
    BOOKED = "booked"
    ATTENDED = "attended"
    CANCELLED = "cancelled"
    EXCLUDED = "excluded"

class LeaveStatus(str, enum.Enum):
    ACTIVE = "active"
    CANCELLED = "cancelled"

class MessBillStatus(str, enum.Enum):
    DRAFT = "draft"
    ISSUED = "issued"
    PAID = "paid"


# --- Core Models ---

class Role(Base):
    __tablename__ = "roles"

    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=False, unique=True)
    description = Column(Text)
    is_supervisor = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    permissions = relationship("RolePermission", back_populates="role", cascade="all, delete-orphan")
    users = relationship("User", back_populates="role")


class RolePermission(Base):
    __tablename__ = "role_permissions"

    id = Column(Integer, primary_key=True)
    role_id = Column(Integer, ForeignKey("roles.id"), nullable=False)
    module = Column(String(50), nullable=False)  # e.g., "inventory", "billing"
    action = Column(String(50), nullable=False)   # e.g., "view", "create", "edit", "approve"
    data_scope = Column(Text)  # optional JSON for scoped access
    created_at = Column(DateTime, default=datetime.utcnow)

    role = relationship("Role", back_populates="permissions")


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    username = Column(String(100), nullable=False, unique=True)
    email = Column(String(255), nullable=False, unique=True)
    full_name = Column(String(200), nullable=False)
    hashed_password = Column(String(255), nullable=False)
    role_id = Column(Integer, ForeignKey("roles.id"), nullable=False)
    status = Column(Enum(UserStatus), default=UserStatus.ACTIVE)
    login_attempts = Column(Integer, default=0)
    locked_until = Column(DateTime, nullable=True)
    last_login = Column(DateTime, nullable=True)
    preferences = Column(Text)  # JSON: dark_mode, sound_effects, etc.
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    role = relationship("Role", back_populates="users")
    __table_args__ = (
        Index("idx_user_status", "status"),
    )


class FeatureFlag(Base):
    __tablename__ = "feature_flags"

    id = Column(Integer, primary_key=True)
    key = Column(String(100), nullable=False, unique=True)
    name = Column(String(200), nullable=False)
    description = Column(Text)
    department = Column(String(50), nullable=False)
    enabled = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SystemSetting(Base):
    __tablename__ = "system_settings"

    id = Column(Integer, primary_key=True)
    key = Column(String(100), nullable=False, unique=True)
    value = Column(Text)
    description = Column(Text)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = Column(Integer, ForeignKey("users.id"))


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    user_name = Column(String(200))
    action = Column(Enum(AuditAction), nullable=False)
    entity_type = Column(String(50), nullable=False)  # table name
    entity_id = Column(Integer)
    before_state = Column(Text)  # JSON
    after_state = Column(Text)   # JSON
    reason = Column(Text)
    department = Column(String(50))
    timestamp = Column(DateTime, default=datetime.utcnow)
    ip_address = Column(String(45))

    __table_args__ = (
        Index("idx_audit_user", "user_id"),
        Index("idx_audit_action", "action"),
        Index("idx_audit_entity", "entity_type", "entity_id"),
        Index("idx_audit_timestamp", "timestamp"),
        Index("idx_audit_dept", "department"),
    )


class Alert(Base):
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True)
    title = Column(String(255), nullable=False)
    message = Column(Text, nullable=False)
    severity = Column(Enum(AlertSeverity), nullable=False)
    status = Column(Enum(AlertStatus), default=AlertStatus.NEW)
    module = Column(String(50), nullable=False)
    entity_type = Column(String(50))
    entity_id = Column(Integer)
    acknowledged_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    acknowledged_at = Column(DateTime)
    resolved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    resolved_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("idx_alert_status", "status"),
        Index("idx_alert_severity", "severity"),
        Index("idx_alert_module", "module"),
    )


# --- Inventory Models ---

class InventoryCategory(Base):
    __tablename__ = "inventory_categories"

    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=False, unique=True)
    description = Column(Text)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class InventoryItem(Base):
    __tablename__ = "inventory_items"

    id = Column(Integer, primary_key=True)
    sku = Column(String(100), nullable=False, unique=True)
    name = Column(String(200), nullable=False)
    category_id = Column(Integer, ForeignKey("inventory_categories.id"))
    description = Column(Text)
    unit = Column(String(50), nullable=False)  # kg, l, pcs, etc.
    reorder_level = Column(Float, default=0)
    reorder_quantity = Column(Float, default=0)
    # Nullable: only meaningful for cookable ingredients that need a
    # cup/tbsp/tsp <-> unit density bridge (see unit_conversion.py) - non-food
    # items and count-based ingredients (pcs) leave this unset.
    ingredient_type = Column(Enum(IngredientType), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    category = relationship("InventoryCategory")


class StockBatch(Base):
    __tablename__ = "stock_batches"

    id = Column(Integer, primary_key=True)
    item_id = Column(Integer, ForeignKey("inventory_items.id"), nullable=False)
    batch_number = Column(String(100), nullable=False)
    quantity = Column(Float, nullable=False, default=0)
    bin_location = Column(String(100))
    expiry_date = Column(Date, nullable=True)
    received_date = Column(Date, default=datetime.utcnow)
    unit_cost = Column(Numeric(12, 2), default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    item = relationship("InventoryItem")

    __table_args__ = (
        Index("idx_stock_item", "item_id"),
    )


class StockMovement(Base):
    __tablename__ = "stock_movements"

    id = Column(Integer, primary_key=True)
    batch_id = Column(Integer, ForeignKey("stock_batches.id"), nullable=False)
    item_id = Column(Integer, ForeignKey("inventory_items.id"), nullable=False)
    movement_type = Column(String(50), nullable=False)  # receipt, issue, adjustment, waste, recipe_deduction
    quantity = Column(Float, nullable=False)
    reference_type = Column(String(50))  # po, recipe, booking, etc.
    reference_id = Column(Integer)
    notes = Column(Text)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("idx_movement_batch", "batch_id"),
        Index("idx_movement_item", "item_id"),
        Index("idx_movement_type", "movement_type"),
    )


class WasteLog(Base):
    __tablename__ = "waste_logs"

    id = Column(Integer, primary_key=True)
    item_id = Column(Integer, ForeignKey("inventory_items.id"), nullable=False)
    batch_id = Column(Integer, ForeignKey("stock_batches.id"), nullable=True)
    quantity = Column(Float, nullable=False)
    category = Column(Enum(WasteCategory), nullable=False)
    note = Column(Text)
    cost = Column(Numeric(12, 2), default=0)
    logged_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)

    item = relationship("InventoryItem")


class CycleCount(Base):
    __tablename__ = "cycle_counts"

    id = Column(Integer, primary_key=True)
    item_id = Column(Integer, ForeignKey("inventory_items.id"), nullable=False)
    batch_id = Column(Integer, ForeignKey("stock_batches.id"), nullable=True)
    expected_quantity = Column(Float, nullable=False)
    actual_quantity = Column(Float, nullable=False)
    variance = Column(Float, nullable=False)
    variance_percentage = Column(Float)
    notes = Column(Text)
    counted_by = Column(Integer, ForeignKey("users.id"))
    status = Column(String(20), default="pending")  # pending, approved, rejected
    created_at = Column(DateTime, default=datetime.utcnow)

    item = relationship("InventoryItem")


# --- Recipe Models ---

class Recipe(Base):
    __tablename__ = "recipes"

    id = Column(Integer, primary_key=True)
    name = Column(String(200), nullable=False)
    description = Column(Text)
    menu_category = Column(String(50))  # breakfast, lunch, dinner, snack
    portions = Column(Integer, default=1)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class RecipeIngredient(Base):
    __tablename__ = "recipe_ingredients"

    id = Column(Integer, primary_key=True)
    recipe_id = Column(Integer, ForeignKey("recipes.id"), nullable=False)
    item_id = Column(Integer, ForeignKey("inventory_items.id"), nullable=False)
    quantity = Column(Float, nullable=False)
    unit = Column(String(50), nullable=False)

    recipe = relationship("Recipe")
    item = relationship("InventoryItem")


class KitchenOrder(Base):
    __tablename__ = "kitchen_orders"

    id = Column(Integer, primary_key=True)
    recipe_id = Column(Integer, ForeignKey("recipes.id"), nullable=False)
    quantity_ordered = Column(Integer, nullable=False, default=1)
    actual_portions = Column(Integer)
    food_cost = Column(Numeric(12, 2))
    status = Column(String(20), default="pending")  # pending, prepared, served, cancelled
    notes = Column(Text)
    # Set when an order is auto-generated from that day's bookings, so the
    # generate step stays idempotent and traceable (manual orders leave these null).
    meal_date = Column(Date, nullable=True)
    meal_type = Column(String(20), nullable=True)
    source = Column(String(20), nullable=True)  # manual | auto_from_bookings
    ordered_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)

    recipe = relationship("Recipe")


# --- Procurement Models ---

class Vendor(Base):
    __tablename__ = "vendors"

    id = Column(Integer, primary_key=True)
    name = Column(String(200), nullable=False)
    contact_person = Column(String(200))
    phone = Column(String(50))
    email = Column(String(255))
    address = Column(Text)
    tax_id = Column(String(100))
    payment_terms = Column(String(100))
    delivery_accuracy = Column(Float, default=100.0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"

    id = Column(Integer, primary_key=True)
    po_number = Column(String(50), nullable=False, unique=True)
    vendor_id = Column(Integer, ForeignKey("vendors.id"), nullable=False)
    status = Column(Enum(POStatus), default=POStatus.DRAFT)
    total_amount = Column(Numeric(12, 2), default=0)
    expected_delivery = Column(Date, nullable=True)
    notes = Column(Text)
    approved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_at = Column(DateTime)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    vendor = relationship("Vendor")
    items = relationship("PurchaseOrderItem", back_populates="purchase_order")


class PurchaseOrderItem(Base):
    __tablename__ = "purchase_order_items"

    id = Column(Integer, primary_key=True)
    po_id = Column(Integer, ForeignKey("purchase_orders.id"), nullable=False)
    item_id = Column(Integer, ForeignKey("inventory_items.id"), nullable=False)
    quantity_ordered = Column(Float, nullable=False)
    quantity_delivered = Column(Float, default=0)
    quantity_received = Column(Float, default=0)
    unit_price = Column(Numeric(12, 2), nullable=False)
    total_price = Column(Numeric(12, 2), nullable=False)

    purchase_order = relationship("PurchaseOrder", back_populates="items")
    inventory_item = relationship("InventoryItem")


class ThreeWayMatch(Base):
    __tablename__ = "three_way_matches"

    id = Column(Integer, primary_key=True)
    po_id = Column(Integer, ForeignKey("purchase_orders.id"), nullable=False)
    po_quantity = Column(Float, nullable=False)
    delivery_quantity = Column(Float, nullable=False)
    received_quantity = Column(Float, nullable=False)
    variance = Column(Float, nullable=False)
    tolerance_percent = Column(Float, default=5.0)
    is_matched = Column(Boolean, default=False)
    discrepancy_reason = Column(Text)
    resolved = Column(Boolean, default=False)
    resolved_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)


# --- Booking Models ---

class Room(Base):
    __tablename__ = "rooms"

    id = Column(Integer, primary_key=True)
    room_number = Column(String(20), nullable=False, unique=True)
    room_type = Column(Enum(RoomType), nullable=False)
    floor = Column(Integer, default=1)
    capacity = Column(Integer, default=2)
    base_price = Column(Numeric(10, 2), nullable=False)
    amenities = Column(Text)  # JSON array
    status = Column(Enum(RoomStatus), default=RoomStatus.VACANT)
    notes = Column(Text)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Booking(Base):
    __tablename__ = "bookings"

    id = Column(Integer, primary_key=True)
    booking_reference = Column(String(50), nullable=False, unique=True)
    guest_name = Column(String(200), nullable=False)
    guest_phone = Column(String(50))
    guest_email = Column(String(255))
    guest_id_type = Column(String(50))
    guest_id_number = Column(String(100))
    room_id = Column(Integer, ForeignKey("rooms.id"), nullable=False)
    check_in = Column(Date, nullable=False)
    check_out = Column(Date, nullable=False)
    adults = Column(Integer, default=1)
    children = Column(Integer, default=0)
    status = Column(Enum(BookingStatus), default=BookingStatus.PENDING)
    special_requests = Column(Text)
    total_amount = Column(Numeric(10, 2))
    processed_by = Column(Integer, ForeignKey("users.id"))
    client_category = Column(Enum(ClientCategory), default=ClientCategory.NON_MEMBER_CIVILIAN)
    member_id = Column(Integer, ForeignKey("members.id"), nullable=True)  # set when a permanent member occupies a room
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    room = relationship("Room")
    member = relationship("Member")


class GuestMovement(Base):
    __tablename__ = "guest_movements"

    id = Column(Integer, primary_key=True)
    booking_id = Column(Integer, ForeignKey("bookings.id"), nullable=False)
    movement_type = Column(String(50), nullable=False)  # check_in, check_out, room_change
    from_room_id = Column(Integer, ForeignKey("rooms.id"), nullable=True)
    to_room_id = Column(Integer, ForeignKey("rooms.id"), nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    processed_by = Column(Integer, ForeignKey("users.id"))
    notes = Column(Text)


# --- Billing Models ---

class Invoice(Base):
    __tablename__ = "invoices"

    id = Column(Integer, primary_key=True)
    invoice_number = Column(String(50), nullable=False, unique=True)
    booking_id = Column(Integer, ForeignKey("bookings.id"), nullable=False)
    issue_date = Column(Date, nullable=False)
    due_date = Column(Date, nullable=False)
    subtotal = Column(Numeric(10, 2), nullable=False)
    tax_amount = Column(Numeric(10, 2), default=0)
    discount = Column(Numeric(10, 2), default=0)
    total_amount = Column(Numeric(10, 2), nullable=False)
    amount_paid = Column(Numeric(10, 2), default=0)
    status = Column(Enum(InvoiceStatus), default=InvoiceStatus.DRAFT)
    notes = Column(Text)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)

    booking = relationship("Booking")
    items = relationship("InvoiceItem", back_populates="invoice")


class InvoiceItem(Base):
    __tablename__ = "invoice_items"

    id = Column(Integer, primary_key=True)
    invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=False)
    description = Column(String(255), nullable=False)
    quantity = Column(Float, default=1)
    unit_price = Column(Numeric(10, 2), nullable=False)
    total_price = Column(Numeric(10, 2), nullable=False)

    invoice = relationship("Invoice", back_populates="items")


class InvoicePayment(Base):
    __tablename__ = "invoice_payments"

    id = Column(Integer, primary_key=True)
    invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=False)
    amount = Column(Numeric(10, 2), nullable=False)
    method = Column(String(50))
    notes = Column(Text)
    received_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)

    invoice = relationship("Invoice")

    __table_args__ = (
        Index("idx_payment_invoice", "invoice_id"),
    )


# --- Security Models ---

class SecurityLog(Base):
    __tablename__ = "security_logs"

    id = Column(Integer, primary_key=True)
    event_type = Column(String(50), nullable=False)  # check_in, check_out, after_hours_access, incident
    booking_id = Column(Integer, ForeignKey("bookings.id"), nullable=True)
    guest_name = Column(String(200))
    room_number = Column(String(20))
    timestamp = Column(DateTime, default=datetime.utcnow)
    processed_by = Column(Integer, ForeignKey("users.id"))
    notes = Column(Text)


class IncidentReport(Base):
    __tablename__ = "incident_reports"

    id = Column(Integer, primary_key=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=False)
    location = Column(String(200))
    category = Column(String(50))  # theft, disturbance, safety, medical, other
    severity = Column(Enum(AlertSeverity), default=AlertSeverity.LOW)
    reported_by = Column(Integer, ForeignKey("users.id"))
    status = Column(String(20), default="open")  # open, investigating, resolved, closed
    resolution = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)
    resolved_at = Column(DateTime)


# --- Mess Management Models ---

class Member(Base):
    __tablename__ = "members"

    id = Column(Integer, primary_key=True)
    service_number = Column(String(50), nullable=False, unique=True)
    full_name = Column(String(200), nullable=False)
    rank = Column(String(50), nullable=False)
    unit = Column(String(100))
    mess_category = Column(Enum(MessCategory), nullable=False)
    client_category = Column(Enum(ClientCategory), default=ClientCategory.PERMANENT_MEMBER)
    custom_discount_rate = Column(Numeric(4, 2), default=0.00)  # per-member override, 0-100
    phone = Column(String(50))
    email = Column(String(255))
    status = Column(Enum(MemberStatus), default=MemberStatus.ACTIVE)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("idx_member_status", "status"),
        Index("idx_member_category", "mess_category"),
    )


class MemberLeave(Base):
    __tablename__ = "member_leaves"

    id = Column(Integer, primary_key=True)
    member_id = Column(Integer, ForeignKey("members.id"), nullable=False)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    reason = Column(Text)
    status = Column(Enum(LeaveStatus), default=LeaveStatus.ACTIVE)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)

    member = relationship("Member")

    __table_args__ = (
        Index("idx_leave_member", "member_id"),
        Index("idx_leave_dates", "start_date", "end_date"),
    )


class MealAttendance(Base):
    """A single consumption/booking record for one meal slot. The consumer is
    either a Member (member_id) or a non-member hotel guest (booking_id) -
    exactly one is set, enforced in MealAttendanceCreate. recipe_id optionally
    records what menu item was consumed, feeding kitchen production planning."""
    __tablename__ = "meal_attendance"

    id = Column(Integer, primary_key=True)
    member_id = Column(Integer, ForeignKey("members.id"), nullable=True)
    booking_id = Column(Integer, ForeignKey("bookings.id"), nullable=True)
    recipe_id = Column(Integer, ForeignKey("recipes.id"), nullable=True)
    date = Column(Date, nullable=False)
    meal_type = Column(Enum(MealType), nullable=False)
    status = Column(Enum(AttendanceStatus), default=AttendanceStatus.BOOKED)
    method = Column(String(20), default="manual")  # manual | biometric | qr - recorded only, no hardware integration
    booked_at = Column(DateTime, default=datetime.utcnow)
    marked_at = Column(DateTime, nullable=True)
    marked_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    member = relationship("Member")
    booking = relationship("Booking")
    recipe = relationship("Recipe")

    __table_args__ = (
        Index("idx_attendance_member_date", "member_id", "date"),
        Index("idx_attendance_date_meal", "date", "meal_type"),
        Index("uq_attendance_member_date_meal", "member_id", "date", "meal_type", unique=True),
        Index("uq_attendance_booking_date_meal", "booking_id", "date", "meal_type", unique=True),
    )


class MessBill(Base):
    __tablename__ = "mess_bills"

    id = Column(Integer, primary_key=True)
    member_id = Column(Integer, ForeignKey("members.id"), nullable=False)
    month = Column(Integer, nullable=False)
    year = Column(Integer, nullable=False)
    man_days = Column(Integer, nullable=False, default=0)
    per_head_rate = Column(Numeric(12, 2), nullable=False, default=0)
    base_menu_amount = Column(Numeric(12, 2), nullable=False, default=0)
    stay_amount = Column(Numeric(12, 2), default=0)
    extra_meals_amount = Column(Numeric(12, 2), default=0)
    applied_discount_rate = Column(Numeric(4, 2), default=0)
    discount_amount = Column(Numeric(12, 2), default=0)
    discount_approved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    discount_reason = Column(Text, nullable=True)
    total_amount = Column(Numeric(12, 2), nullable=False, default=0)
    status = Column(Enum(MessBillStatus), default=MessBillStatus.DRAFT)
    generated_at = Column(DateTime, default=datetime.utcnow)
    generated_by = Column(Integer, ForeignKey("users.id"))

    member = relationship("Member")

    __table_args__ = (
        Index("uq_messbill_period", "member_id", "year", "month", unique=True),
    )


class GuestMealCharge(Base):
    """Guest meals sponsored by a member, folded into that member's
    MessBill.extra_meals_amount at generation time. No guest-identity
    table - Guest Management is out of scope, a free-text guest_name
    is enough here."""
    __tablename__ = "guest_meal_charges"

    id = Column(Integer, primary_key=True)
    sponsor_member_id = Column(Integer, ForeignKey("members.id"), nullable=False)
    guest_name = Column(String(200), nullable=False)
    date = Column(Date, nullable=False)
    meal_type = Column(Enum(MealType), nullable=False)
    amount = Column(Numeric(12, 2), nullable=False)
    notes = Column(Text)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)

    sponsor = relationship("Member")

    __table_args__ = (
        Index("idx_guestcharge_sponsor_date", "sponsor_member_id", "date"),
    )
