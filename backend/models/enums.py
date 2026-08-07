"""All model-layer enums in one place - shared across domain files, so no
domain file needs to import another domain's enum. Rarely touched; adding an
enum value here is low-conflict by nature (a single new line)."""
import enum


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
    # remapped by migrations._migrate_room_types_three_classes.
    STANDARD = "standard"
    SUITE = "suite"
    DG_SUITE = "dg_suite"

class InvoiceStatus(str, enum.Enum):
    DRAFT = "draft"
    ISSUED = "issued"
    PARTIALLY_PAID = "partially_paid"
    PAID = "paid"
    VOID = "void"
    OVERDUE = "overdue"

class EditRequestStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"

class WasteCategory(str, enum.Enum):
    SPOILAGE = "spoilage"
    OVER_PREP = "over_prep"
    DAMAGE = "damage"
    EXPIRED = "expired"
    OTHER = "other"

class AlertSeverity(str, enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    WARNING = "warning"  # Overdue Checkout's first-tier escalation, below HIGH
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

class DiningStatus(str, enum.Enum):
    # Orthogonal to whether a member also holds an HRA room. NON_DINING
    # members are excluded from mess bill generation and the man-day pool
    # entirely (see mess_billing.py:generate_bills) - not billed at all for
    # that period, not just a reporting label.
    DINING = "dining"
    NON_DINING = "non_dining"

class DirectiveStatus(str, enum.Enum):
    NEW = "new"
    ACKNOWLEDGED = "acknowledged"

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
    PARTIALLY_PAID = "partially_paid"
    PAID = "paid"

class EventStatus(str, enum.Enum):
    BOOKED = "booked"
    MENU_SET = "menu_set"
    PREPARING = "preparing"
    COMPLETED = "completed"
    CANCELLED = "cancelled"

class EventBillingType(str, enum.Enum):
    SPLIT = "split"
    SINGLE_PAYER = "single_payer"
