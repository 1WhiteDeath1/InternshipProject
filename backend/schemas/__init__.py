"""Re-exports every schema from its domain submodule, so existing code doing
`from backend.schemas import X` keeps working unchanged regardless of which
domain file X actually lives in. See docs/MODULE_STRUCTURE.md for the domain
boundaries and the rule for adding a new one."""
from backend.schemas.common import (
    Token, LoginRequest, PasswordChange,
    DashboardStats, TrendData, PaginatedResponse, ExportRequest, ImportPreview, ImportResult,
    BrandingConfig,
)
from backend.schemas.access import (
    UserBase, UserCreate, UserUpdate, UserOut, UserListResponse,
    RolePermissionBase, RolePermissionCreate, RolePermissionOut,
    RoleBase, RoleCreate, RoleUpdate, RoleOut,
)
from backend.schemas.system import FeatureFlagOut, FeatureFlagToggle, SettingOut, SettingUpdate
from backend.schemas.audit import AuditLogOut, AuditLogList
from backend.schemas.alerts import AlertOut, AlertAcknowledge
from backend.schemas.inventory import (
    InventoryCategoryBase, InventoryCategoryCreate, InventoryCategoryOut,
    InventoryItemBase, InventoryItemCreate, InventoryItemUpdate, InventoryItemOut,
    StockBatchBase, StockBatchCreate, StockBatchOut, StockMovementCreate,
    WasteLogCreate, WasteLogOut, CycleCountCreate,
    StockIntakeCreate, ReceiptConfirmLine, ReceiptConfirmRequest,
)
from backend.schemas.kitchen import (
    MenuItemOut, MenuItemProposal, MenuItemEditRequestOut, EditRequestReject,
    KitchenOrderCreate, KitchenOrderOut, KitchenOrderPrepareRequest,
    GasChargeRateOut, GasChargeRateUpdate, GasChargeRateHistoryOut, MessChargeOverviewRow, OrderHistoryRow,
)
from backend.schemas.procurement import (
    VendorBase, VendorCreate, VendorUpdate, VendorOut,
)
from backend.schemas.rooms import (
    AttendantBase, AttendantCreate, AttendantUpdate, AttendantOut, AttendantDuty,
    AttendantActivitySummaryOut, AttendantActivityTrendOut,
    RoomBase, RoomCreate, RoomUpdate, RoomOut,
)
from backend.schemas.rates import (
    TariffRateCreate, TariffRateOut, WomensBlocRankRateCreate, WomensBlocRankRateOut,
    RoomRateCreate, RoomRateOut, DutyRateCreate, DutyRateOut,
    HraRankRateCreate, HraRankRateOut, HraUtilityRateCreate, HraUtilityRateOut,
)
from backend.schemas.guests import (
    GuestOut, GuestListItem, GuestListResponse, GuestProfileOut, GuestQuickCreate,
)
from backend.schemas.bookings import (
    GuestBookingSummary, BookingBase, BookingCreate, BookingUpdate, BookingOut, GuestMovementOut,
)
from backend.schemas.billing import (
    GuestInvoiceSummary, InvoiceItemCreate, InvoiceBase, InvoiceItemOut, InvoiceOut,
    BookingChargeCreate, PaymentCreate, PaymentOut,
    InvoiceEditRequestCreate, InvoiceEditRequestOut, InvoiceEditDecision,
)
from backend.schemas.security import (
    SecurityLogCreate, SecurityLogOut,
    IncidentReportBase, IncidentReportCreate, IncidentReportUpdate, IncidentReportOut,
)
from backend.schemas.members import (
    MemberBase, MemberCreate, MemberUpdate, MemberStatusChange, MemberOut,
    MemberLeaveBase, MemberLeaveCreate, MemberLeaveOut,
)
from backend.schemas.attendance import (
    MealAttendanceBase, MealAttendanceCreate, MealAttendanceOut,
    AttendanceMarkRequest, BulkAttendanceCreate, AttendanceLookupResult,
    ServeAttendanceRequest, NoShowSweepResult,
)
from backend.schemas.mess_billing import (
    MessBillOut, GuestMealChargeCreate, GuestMealChargeOut,
    DiscountApplyRequest,
)
from backend.schemas.events import (
    EventMenuItemCreate, EventCreate, EventUpdate, EventStatusUpdate, EventPostponeRequest,
)
from backend.schemas.directives import DirectiveCreate, DirectiveOut

__all__ = [
    "Token", "LoginRequest", "PasswordChange",
    "DashboardStats", "TrendData", "PaginatedResponse", "ExportRequest", "ImportPreview", "ImportResult",
    "BrandingConfig",
    "UserBase", "UserCreate", "UserUpdate", "UserOut", "UserListResponse",
    "RolePermissionBase", "RolePermissionCreate", "RolePermissionOut",
    "RoleBase", "RoleCreate", "RoleUpdate", "RoleOut",
    "FeatureFlagOut", "FeatureFlagToggle", "SettingOut", "SettingUpdate",
    "AuditLogOut", "AuditLogList",
    "AlertOut", "AlertAcknowledge",
    "InventoryCategoryBase", "InventoryCategoryCreate", "InventoryCategoryOut",
    "InventoryItemBase", "InventoryItemCreate", "InventoryItemUpdate", "InventoryItemOut",
    "StockBatchBase", "StockBatchCreate", "StockBatchOut", "StockMovementCreate",
    "WasteLogCreate", "WasteLogOut", "CycleCountCreate",
    "StockIntakeCreate", "ReceiptConfirmLine", "ReceiptConfirmRequest",
    "MenuItemOut", "MenuItemProposal", "MenuItemEditRequestOut", "EditRequestReject",
    "KitchenOrderCreate", "KitchenOrderOut", "KitchenOrderPrepareRequest",
    "GasChargeRateOut", "GasChargeRateUpdate", "GasChargeRateHistoryOut", "MessChargeOverviewRow", "OrderHistoryRow",
    "VendorBase", "VendorCreate", "VendorUpdate", "VendorOut",
    "AttendantBase", "AttendantCreate", "AttendantUpdate", "AttendantOut", "AttendantDuty",
    "AttendantActivitySummaryOut", "AttendantActivityTrendOut",
    "RoomBase", "RoomCreate", "RoomUpdate", "RoomOut",
    "TariffRateCreate", "TariffRateOut", "WomensBlocRankRateCreate", "WomensBlocRankRateOut",
    "RoomRateCreate", "RoomRateOut", "DutyRateCreate", "DutyRateOut",
    "HraRankRateCreate", "HraRankRateOut", "HraUtilityRateCreate", "HraUtilityRateOut",
    "GuestOut", "GuestListItem", "GuestListResponse", "GuestProfileOut", "GuestQuickCreate",
    "GuestBookingSummary", "BookingBase", "BookingCreate", "BookingUpdate", "BookingOut", "GuestMovementOut",
    "GuestInvoiceSummary", "InvoiceItemCreate", "InvoiceBase", "InvoiceItemOut", "InvoiceOut",
    "BookingChargeCreate", "PaymentCreate", "PaymentOut",
    "InvoiceEditRequestCreate", "InvoiceEditRequestOut", "InvoiceEditDecision",
    "SecurityLogCreate", "SecurityLogOut",
    "IncidentReportBase", "IncidentReportCreate", "IncidentReportUpdate", "IncidentReportOut",
    "MemberBase", "MemberCreate", "MemberUpdate", "MemberStatusChange", "MemberOut",
    "MemberLeaveBase", "MemberLeaveCreate", "MemberLeaveOut",
    "MealAttendanceBase", "MealAttendanceCreate", "MealAttendanceOut",
    "AttendanceMarkRequest", "BulkAttendanceCreate", "AttendanceLookupResult",
    "ServeAttendanceRequest", "NoShowSweepResult",
    "MessBillOut", "GuestMealChargeCreate", "GuestMealChargeOut",
    "DiscountApplyRequest",
    "EventMenuItemCreate", "EventCreate", "EventUpdate", "EventStatusUpdate", "EventPostponeRequest",
    "DirectiveCreate", "DirectiveOut",
]
