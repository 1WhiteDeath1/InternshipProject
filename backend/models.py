"""SQLAlchemy models for Hotel & Mess Management System."""
import enum
from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime, Date, Text,
    ForeignKey, Enum, Numeric, JSON, BigInteger, Index, UniqueConstraint
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
    NO_SHOW = "no_show"

class RoomStatus(str, enum.Enum):
    VACANT = "vacant"
    OCCUPIED = "occupied"
    RESERVED = "reserved"
    MAINTENANCE = "maintenance"

class RoomType(str, enum.Enum):
    # The mess's three guest-room classes (2026 rate-card simplification).
    # Suites carry Room.ac_count (1 or 2): guests see one "Suite" type but
    # HRA utility charges still bill 1xAC vs 2xAC per the card. Legacy
    # types (single/double/deluxe/dormitory/vip/suite_1ac/suite_2ac) are
    # remapped by migrations_manual._migrate_room_types_three_classes.
    STANDARD = "standard"
    SUITE = "suite"
    DG_SUITE = "dg_suite"

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
    # Rate-card categories: the same room bills differently per occupant type
    SERVING_OFFICER = "serving_officer"
    RETIRED_OFFICER = "retired_officer"
    CIVILIAN = "civilian"

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
    NO_SHOW = "no_show"

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

    # --- À la carte custom-order fields (is_ala_carte=True only) ---
    # A la carte orders are attributed to one specific consumer for billing -
    # MealAttendance can't hold this (its unique constraint allows only one row
    # per person per date/meal_type, but a guest may order several custom
    # dishes in a day), so the link lives here instead.
    is_ala_carte = Column(Boolean, default=False)
    consumer_type = Column(String(20), nullable=True)  # "member" | "guest"
    member_id = Column(Integer, ForeignKey("members.id"), nullable=True)
    booking_id = Column(Integer, ForeignKey("bookings.id"), nullable=True)
    sla_minutes = Column(Integer, nullable=True)
    due_at = Column(DateTime, nullable=True)  # fixed at creation; later SystemSetting changes don't move it
    cooking_started_at = Column(DateTime, nullable=True)  # set the instant status -> "cooking" (also the deduction instant)
    escalated_at = Column(DateTime, nullable=True)  # idempotency guard: >15min-overdue admin alert posted once
    invoiced_at = Column(DateTime, nullable=True)  # set once pulled into a MessBill/Invoice, guards double-billing

    recipe = relationship("Recipe")
    member = relationship("Member")
    booking = relationship("Booking")


class MenuPrice(Base):
    """Guest-facing (non-member, pay-per-item) price for a recipe. Deliberately
    decoupled from Recipe itself - a recipe used only for member routine meals
    may never need a guest price, and pricing may vary by context later without
    touching recipe/ingredient data. One row per recipe; missing/inactive means
    "not yet priced for guests" and is excluded from bills, flagged instead."""
    __tablename__ = "menu_prices"

    id = Column(Integer, primary_key=True)
    recipe_id = Column(Integer, ForeignKey("recipes.id"), nullable=False, unique=True)
    price = Column(Numeric(12, 2), nullable=False, default=0)
    is_active = Column(Boolean, default=True)
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

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
    # Suites only: number of air conditioners (1 or 2) - drives the HRA
    # monthly utility charge (Rs 25,500 vs 29,500 on the rate card).
    ac_count = Column(Integer, default=1)
    base_price = Column(Numeric(10, 2), nullable=False)
    amenities = Column(Text)  # JSON array
    status = Column(Enum(RoomStatus), default=RoomStatus.VACANT)
    # Physical readiness, independent of occupancy: clean | dirty | cleaning
    housekeeping_status = Column(String(20), default="clean")
    notes = Column(Text)
    # Estimated day maintenance ends - set alongside `notes` (used as the
    # issue description) when a room is sent to maintenance from the drawer.
    maintenance_until = Column(Date, nullable=True)
    is_active = Column(Boolean, default=True)
    attendant_id = Column(Integer, ForeignKey("attendants.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    attendant = relationship("Attendant")


class Attendant(Base):
    """Room attendant/housekeeping staff. One attendant -> many rooms
    (Room.attendant_id is the default/current assignment); Booking.attendant_id
    is a separate snapshot of who was responsible during a specific stay, so
    reassigning a room's attendant later doesn't rewrite past-stay history."""
    __tablename__ = "attendants"

    id = Column(Integer, primary_key=True)
    full_name = Column(String(200), nullable=False)
    phone = Column(String(50))
    email = Column(String(255))
    shift = Column(String(50))  # e.g. morning | evening | night, free text
    photo_file_name = Column(String(255))
    is_active = Column(Boolean, default=True)
    # Whether this attendant is currently clocked in - distinct from `shift`
    # (a static label) and from `is_active` (an employment/roster flag).
    on_duty = Column(Boolean, default=False)
    on_duty_since = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Guest(Base):
    """Persistent guest identity, matched across stays by ID number (CNIC/svc
    no/passport) or phone, so repeat visitors can be recognized at check-in
    and their bookings/bills traced by name. Not a full guest-management
    module - just enough to de-duplicate and prefill."""
    __tablename__ = "guests"

    id = Column(Integer, primary_key=True)
    full_name = Column(String(200), nullable=False)
    phone = Column(String(50))
    id_type = Column(String(50))
    id_number = Column(String(100))
    unit_address = Column(String(255))
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
    guest_id = Column(Integer, ForeignKey("guests.id"), nullable=True)
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
    # Snapshot of the room's attendant at check-in time - independent of
    # rooms.attendant_id so later reassignment doesn't rewrite this stay's history.
    attendant_id = Column(Integer, ForeignKey("attendants.id"), nullable=True)
    # Official / private / family - third axis of the rank x room-type x
    # stay-type tariff matrix (see TariffRate). Independent of nature_of_duty.
    stay_type = Column(String(20))
    # Booking-register fields (paper register columns the mess must keep recording)
    rank = Column(String(50))
    pa_number = Column(String(50))
    unit_address = Column(String(255))
    # "C/O" reference from the paper register (e.g. "C/O AD", "C/O Brig Cdr CES").
    # Mandatory for civilian guests, optional for officers/institutional guests.
    reference_person = Column(String(100))
    nature_of_duty = Column(String(20), default="visit")  # visit | leave | official_duty | hra
    da_multiplier = Column(Numeric(3, 1))  # 1.0 or 1.5 for official-duty DA billing
    mattress_count = Column(Integer, default=0)
    # Booking channel: walk_in (at the desk) or online (transcribed from the
    # separate online portal, carrying that portal's voucher number).
    source = Column(String(20), default="walk_in")  # walk_in | online
    online_voucher_no = Column(String(50))
    # Guest must physically arrive (be checked in) by this time or staff may
    # void the booking to free the room.
    arrival_deadline = Column(DateTime)
    late_checkout_fee = Column(Numeric(10, 2), default=0)
    actual_check_in = Column(DateTime)
    actual_check_out = Column(DateTime)
    cancel_reason = Column(Text)
    rate_breakdown = Column(Text)  # JSON snapshot of the itemized nightly rate applied
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    room = relationship("Room")
    member = relationship("Member")
    guest = relationship("Guest")
    attendant = relationship("Attendant")


class BookingCharge(Base):
    """Ad-hoc charge against a stay, matching the paper draft bill's line
    heads (Dhobi, Allied Charges, Breakage, Dental Kit, Extra Messing, Sui
    Gas Charges on Messing...). is_mess_charge routes the line onto the
    mess/food bill at checkout instead of the room bill."""
    __tablename__ = "booking_charges"

    id = Column(Integer, primary_key=True)
    booking_id = Column(Integer, ForeignKey("bookings.id"), nullable=False)
    head = Column(String(100), nullable=False)
    amount = Column(Numeric(10, 2), nullable=False)
    is_mess_charge = Column(Boolean, default=False)
    invoiced_at = Column(DateTime)  # set when swept into an invoice at checkout
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)

    booking = relationship("Booking")


class SmsMessage(Base):
    """Outbox for guest SMS notifications. The server itself is offline, so
    messages queue as 'pending'; delivery happens either through an optional
    HTTP SMS gateway (sms_gateway_url setting, e.g. a GSM-modem bridge on the
    LAN) or manually - staff copy the text to a phone and mark it sent."""
    __tablename__ = "sms_messages"

    id = Column(Integer, primary_key=True)
    booking_id = Column(Integer, ForeignKey("bookings.id"))
    phone = Column(String(50), nullable=False)
    body = Column(Text, nullable=False)
    status = Column(String(20), default="pending")  # pending | sent | failed
    error = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)
    sent_at = Column(DateTime)
    sent_by = Column(Integer, ForeignKey("users.id"))

    booking = relationship("Booking")


class RoomRate(Base):
    """Nightly rate matrix from the official rate card: one row per
    room class x guest category, itemized into the components the mess
    bills separately (rent, electricity, generator, gas, internet/cable).
    Editable data - rates get revised by official letter."""
    __tablename__ = "room_rates"
    __table_args__ = (UniqueConstraint("room_type", "guest_category", name="uq_room_rate"),)

    id = Column(Integer, primary_key=True)
    room_type = Column(String(20), nullable=False)  # RoomType value
    guest_category = Column(String(30), nullable=False)  # serving_officer | retired_officer | civilian
    rent = Column(Numeric(10, 2), nullable=False, default=0)
    electricity = Column(Numeric(10, 2), nullable=False, default=0)
    generator = Column(Numeric(10, 2), nullable=False, default=0)
    gas = Column(Numeric(10, 2), nullable=False, default=0)
    internet = Column(Numeric(10, 2), nullable=False, default=0)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = Column(Integer, ForeignKey("users.id"))


class DutyRate(Base):
    """Daily-allowance room charge for serving officers on official duty,
    per rank band. Bookings bill at da_amount x da_multiplier (1 or 1.5)."""
    __tablename__ = "duty_rates"

    id = Column(Integer, primary_key=True)
    rank_band = Column(String(30), nullable=False, unique=True)  # maj_capt | ltcol_brig | maj_gen | ltgen_gen
    label = Column(String(100))
    da_amount = Column(Numeric(10, 2), nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = Column(Integer, ForeignKey("users.id"))


class HraRankRate(Base):
    """Monthly HRA (Hostel Rent Allowance) rate for a permanent resident
    officer, per rank band - finer-grained than DutyRate's bands since the
    HRA card prices Capt/Maj and Lt Col-Col/Brig separately."""
    __tablename__ = "hra_rank_rates"

    id = Column(Integer, primary_key=True)
    rank_band = Column(String(30), nullable=False, unique=True)  # capt | maj | ltcol_col | brig | maj_gen
    label = Column(String(100))
    monthly_amount = Column(Numeric(10, 2), nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = Column(Integer, ForeignKey("users.id"))


class WomensBlocRankRate(Base):
    """Monthly rank-based rate for a resident in the Women's Bloc wing -
    structurally identical to HraRankRate (same rank bands via
    hra_rank_to_band/_HRA_RANK_BANDS) but a separate table, since the two are
    orthogonal: a resident can be in the Women's Bloc wing and still keep
    their existing officers/jcos/ors mess_category. Seeded with Rs 0
    placeholder defaults - see DEFAULT_WOMENS_BLOC_RANK_RATES."""
    __tablename__ = "womens_bloc_rank_rates"

    id = Column(Integer, primary_key=True)
    rank_band = Column(String(30), nullable=False, unique=True)  # capt | maj | ltcol_col | brig | maj_gen
    label = Column(String(100))
    monthly_amount = Column(Numeric(10, 2), nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = Column(Integer, ForeignKey("users.id"))


class HraUtilityRate(Base):
    """Monthly flat utility charge (elec/gen/gas/internet bundled) for an
    HRA resident's room class - separate from RoomRate's nightly guest
    components."""
    __tablename__ = "hra_utility_rates"

    id = Column(Integer, primary_key=True)
    room_type = Column(String(20), nullable=False, unique=True)  # RoomType value
    monthly_amount = Column(Numeric(10, 2), nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = Column(Integer, ForeignKey("users.id"))


class TariffRate(Base):
    """Optional tiered override matrix: rank x room_type x stay_type ->
    nightly rate. When a matching row exists, compute_booking_price uses it
    ahead of the rate-card/duty/HRA engine above; otherwise that existing
    engine still applies unchanged. rank/room_type/stay_type are plain
    strings (not FKs) - the same convention RoomRate/DutyRate already use,
    since rank has never been a first-class entity in this schema."""
    __tablename__ = "tariff_rates"
    __table_args__ = (UniqueConstraint("rank", "room_type", "stay_type", name="uq_tariff_rate"),)

    id = Column(Integer, primary_key=True)
    rank = Column(String(50), nullable=False)
    room_type = Column(String(20), nullable=False)  # RoomType value
    stay_type = Column(String(20), nullable=False)  # official | private | family
    nightly_rate = Column(Numeric(10, 2), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = Column(Integer, ForeignKey("users.id"))


class RoomPhoto(Base):
    __tablename__ = "room_photos"

    id = Column(Integer, primary_key=True)
    room_id = Column(Integer, ForeignKey("rooms.id"), nullable=False)
    file_name = Column(String(255), nullable=False)
    sort_order = Column(Integer, default=0)
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    uploaded_by = Column(Integer, ForeignKey("users.id"))


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
    # Which of the two checkout bills this is: 'room' (guest room charges,
    # mattress, dhobi, breakage...) or 'mess' (messing/food charges). Older
    # single-bill invoices stay 'combined'.
    bill_type = Column(String(20), default="combined")  # room | mess | combined
    is_complimentary = Column(Boolean, default=False)
    complimentary_reason = Column(Text)
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
    # Orthogonal to mess_category - a resident can be Women's Bloc AND
    # officers/jcos/ors; when set, HRA billing uses WomensBlocRankRate
    # instead of HraRankRate for the same rank band.
    is_womens_bloc = Column(Boolean, default=False)
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
    exactly one of: a Member (member_id), a checked-in hotel guest
    (booking_id), or a standalone walk-in Guest with no room booking
    (guest_id) - enforced in MealAttendanceCreate/ServeAttendanceRequest.
    guest_id exists specifically so a non-member can be logged as fast as a
    member, without first needing a room booking. recipe_id optionally
    records what menu item was consumed, feeding kitchen production planning."""
    __tablename__ = "meal_attendance"

    id = Column(Integer, primary_key=True)
    member_id = Column(Integer, ForeignKey("members.id"), nullable=True)
    booking_id = Column(Integer, ForeignKey("bookings.id"), nullable=True)
    guest_id = Column(Integer, ForeignKey("guests.id"), nullable=True)
    recipe_id = Column(Integer, ForeignKey("recipes.id"), nullable=True)
    date = Column(Date, nullable=False)
    meal_type = Column(Enum(MealType), nullable=False)
    status = Column(Enum(AttendanceStatus), default=AttendanceStatus.BOOKED)
    method = Column(String(20), default="manual")  # manual | biometric | qr - recorded only, no hardware integration
    booked_at = Column(DateTime, default=datetime.utcnow)
    marked_at = Column(DateTime, nullable=True)
    marked_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    # Set once this row's routine-meal charge (non-member/guest pay-per-item,
    # priced via MenuPrice) has been pulled into an Instant Checkout invoice -
    # guards against double-billing the same meal on a repeat checkout.
    invoiced_at = Column(DateTime, nullable=True)

    member = relationship("Member")
    booking = relationship("Booking")
    guest = relationship("Guest")
    recipe = relationship("Recipe")

    __table_args__ = (
        Index("idx_attendance_member_date", "member_id", "date"),
        Index("idx_attendance_date_meal", "date", "meal_type"),
        Index("uq_attendance_member_date_meal", "member_id", "date", "meal_type", unique=True),
        Index("uq_attendance_booking_date_meal", "booking_id", "date", "meal_type", unique=True),
        Index("uq_attendance_guest_date_meal", "guest_id", "date", "meal_type", unique=True),
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
    # Member's own à la carte custom-order charges for the period, billed at
    # cost (food_cost, no markup) since MenuPrice is the guest-facing list.
    ala_carte_amount = Column(Numeric(12, 2), default=0)
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
