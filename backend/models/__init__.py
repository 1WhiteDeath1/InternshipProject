"""Re-exports every model/enum from its domain submodule, so existing code
doing `from backend.models import X` keeps working unchanged regardless of
which domain file X actually lives in. See docs/MODULE_STRUCTURE.md for the
domain boundaries and the rule for adding a new one."""
from backend.models.enums import (
    UserStatus, BookingStatus, RoomStatus, RoomType, POStatus, InvoiceStatus,
    IngredientType, WasteCategory, AlertSeverity, AlertStatus, AuditAction,
    MessCategory, MemberStatus, ClientCategory, MealType, AttendanceStatus,
    LeaveStatus, MessBillStatus, EditRequestStatus, EventStatus, EventBillingType,
)
from backend.models.access import Role, RolePermission, User
from backend.models.system import FeatureFlag, SystemSetting
from backend.models.audit import AuditLog
from backend.models.alerts import Alert
from backend.models.inventory import (
    InventoryCategory, InventoryItem, StockBatch, StockMovement, WasteLog, CycleCount,
)
from backend.models.kitchen import Recipe, RecipeIngredient, KitchenOrder, MenuPrice
from backend.models.procurement import Vendor, PurchaseOrder, PurchaseOrderItem, ThreeWayMatch
from backend.models.rooms import Room, Attendant, RoomPhoto
from backend.models.rates import (
    RoomRate, DutyRate, HraRankRate, WomensBlocRankRate, HraUtilityRate, TariffRate,
)
from backend.models.guests import Guest
from backend.models.bookings import Booking, BookingCharge, SmsMessage, GuestMovement
from backend.models.billing import Invoice, InvoiceItem, InvoicePayment, InvoiceEditRequest
from backend.models.security import SecurityLog, IncidentReport
from backend.models.members import Member, MemberLeave
from backend.models.attendance import MealAttendance
from backend.models.mess_billing import MessBill, GuestMealCharge
from backend.models.events import Event, EventMenuItem

__all__ = [
    "UserStatus", "BookingStatus", "RoomStatus", "RoomType", "POStatus", "InvoiceStatus",
    "IngredientType", "WasteCategory", "AlertSeverity", "AlertStatus", "AuditAction",
    "MessCategory", "MemberStatus", "ClientCategory", "MealType", "AttendanceStatus",
    "LeaveStatus", "MessBillStatus", "EditRequestStatus", "EventStatus", "EventBillingType",
    "Role", "RolePermission", "User",
    "FeatureFlag", "SystemSetting",
    "AuditLog",
    "Alert",
    "InventoryCategory", "InventoryItem", "StockBatch", "StockMovement", "WasteLog", "CycleCount",
    "Recipe", "RecipeIngredient", "KitchenOrder", "MenuPrice",
    "Vendor", "PurchaseOrder", "PurchaseOrderItem", "ThreeWayMatch",
    "Room", "Attendant", "RoomPhoto",
    "RoomRate", "DutyRate", "HraRankRate", "WomensBlocRankRate", "HraUtilityRate", "TariffRate",
    "Guest",
    "Booking", "BookingCharge", "SmsMessage", "GuestMovement",
    "Invoice", "InvoiceItem", "InvoicePayment", "InvoiceEditRequest",
    "SecurityLog", "IncidentReport",
    "Member", "MemberLeave",
    "MealAttendance",
    "MessBill", "GuestMealCharge",
    "Event", "EventMenuItem",
]
