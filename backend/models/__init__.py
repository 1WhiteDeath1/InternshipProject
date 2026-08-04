"""Re-exports every model/enum from its domain submodule, so existing code
doing `from backend.models import X` keeps working unchanged regardless of
which domain file X actually lives in. See docs/MODULE_STRUCTURE.md for the
domain boundaries and the rule for adding a new one."""
from backend.models.enums import (
    UserStatus, BookingStatus, RoomStatus, RoomType, InvoiceStatus,
    WasteCategory, AlertSeverity, AlertStatus, AuditAction,
    MessCategory, MemberStatus, ClientCategory, MealType, AttendanceStatus,
    LeaveStatus, MessBillStatus, EditRequestStatus, EventStatus, EventBillingType,
    DiningStatus, DirectiveStatus,
)
from backend.models.access import Role, RolePermission, User
from backend.models.system import FeatureFlag, SystemSetting
from backend.models.audit import AuditLog
from backend.models.alerts import Alert
from backend.models.inventory import (
    InventoryCategory, InventoryItem, StockBatch, StockMovement, WasteLog, CycleCount,
)
from backend.models.kitchen import MenuItem, MenuItemEditRequest, GasChargeRate, GasChargeRateHistory, KitchenOrder
from backend.models.procurement import Vendor
from backend.models.rooms import Room, Attendant, RoomPhoto, AttendantDutyLog
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
from backend.models.directives import Directive

__all__ = [
    "UserStatus", "BookingStatus", "RoomStatus", "RoomType", "InvoiceStatus",
    "WasteCategory", "AlertSeverity", "AlertStatus", "AuditAction",
    "MessCategory", "MemberStatus", "ClientCategory", "MealType", "AttendanceStatus", "DiningStatus",
    "LeaveStatus", "MessBillStatus", "EditRequestStatus", "EventStatus", "EventBillingType",
    "DirectiveStatus",
    "Role", "RolePermission", "User",
    "FeatureFlag", "SystemSetting",
    "AuditLog",
    "Alert",
    "InventoryCategory", "InventoryItem", "StockBatch", "StockMovement", "WasteLog", "CycleCount",
    "MenuItem", "MenuItemEditRequest", "GasChargeRate", "GasChargeRateHistory", "KitchenOrder",
    "Vendor",
    "Room", "Attendant", "RoomPhoto", "AttendantDutyLog",
    "RoomRate", "DutyRate", "HraRankRate", "WomensBlocRankRate", "HraUtilityRate", "TariffRate",
    "Guest",
    "Booking", "BookingCharge", "SmsMessage", "GuestMovement",
    "Invoice", "InvoiceItem", "InvoicePayment", "InvoiceEditRequest",
    "SecurityLog", "IncidentReport",
    "Member", "MemberLeave",
    "MealAttendance",
    "MessBill", "GuestMealCharge",
    "Event", "EventMenuItem",
    "Directive",
]
