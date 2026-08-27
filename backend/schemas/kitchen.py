"""Kitchen domain schemas: the editable menu (+ edit-request approval flow),
kitchen production orders, the gas charge rate, and the mess-charges
overview/order-history views."""
from datetime import datetime, date
from typing import List, Optional
from pydantic import BaseModel, Field, ConfigDict, model_validator


class MenuItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    meal_type: str
    day_of_week: Optional[str] = None
    price: float
    is_active: bool


class MenuItemProposal(BaseModel):
    """Body for both 'propose new item' (POST /menu) and 'propose edit'
    (PUT /menu/{id}) - the endpoint distinguishes new vs. edit, not the body."""
    name: str = Field(..., min_length=1, max_length=200)
    price: float = Field(..., ge=0)
    meal_type: str
    day_of_week: Optional[str] = None
    reason: Optional[str] = None


class MenuItemEditRequestOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    menu_item_id: Optional[int] = None
    is_new_item: bool
    original_name: Optional[str] = None
    original_price: Optional[float] = None
    proposed_name: str
    proposed_price: float
    proposed_meal_type: str
    proposed_day_of_week: Optional[str] = None
    reason: Optional[str] = None
    status: str
    requested_by_name: Optional[str] = None
    requested_at: datetime
    decision_reason: Optional[str] = None


class EditRequestReject(BaseModel):
    reason: str = Field(..., min_length=1)


class KitchenOrderCreate(BaseModel):
    menu_item_id: int
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
    menu_item_id: int
    menu_item_name: Optional[str] = None
    quantity_ordered: int
    actual_portions: Optional[int] = None
    status: str
    notes: Optional[str] = None
    meal_date: Optional[str] = None
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
    gas_amount: Optional[float] = None
    price_override: Optional[float] = None


class KitchenOrderPrepareRequest(BaseModel):
    actual_portions: Optional[int] = Field(None, gt=0)


class DishPricingSet(BaseModel):
    """Sets the food price override and/or gas amount for one routine
    (non-ala-carte) date+meal+dish, finding or creating the matching batch
    KitchenOrder - see KitchenOrder.gas_amount/price_override's model
    docstrings. Either field left null reverts that side to its automatic
    default (menu price / no gas) rather than leaving it unchanged - the
    dialog that calls this always sends both current values together."""
    date: date
    meal_type: str
    menu_item_id: int
    price_override: Optional[float] = Field(None, ge=0)
    gas_amount: Optional[float] = Field(None, ge=0)


class MealBoardPerson(BaseModel):
    kind: str  # "member" | "booking" | "guest"
    id: int


class CopyLastMealRequest(BaseModel):
    """Body for POST /kitchen/meal-board/copy-last. `entries` is who's present
    for this meal, sent by the board rather than re-derived server-side - a
    dining member is present by default with no stored attendance row, so the
    caller's roster is the only complete picture (see the endpoint docstring)."""
    date: date
    meal_type: str
    entries: List[MealBoardPerson]


class GasChargeRateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    percentage: float
    updated_at: Optional[datetime] = None


class GasChargeRateUpdate(BaseModel):
    percentage: float = Field(..., ge=0, le=100)


class GasChargeRateHistoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    old_percentage: float
    new_percentage: float
    changed_at: datetime


class MessChargeOverviewRow(BaseModel):
    consumer_type: str  # "member" | "guest"
    consumer_id: int  # member_id or booking_id
    name: str
    sub_label: Optional[str] = None  # room number for a guest, rank/unit for a member
    unbilled_mess_total: float
    unbilled_gas_total: float = 0
    # Guest rows only - checking-out context, see Booking.kitchen_finalized_at's model docstring.
    is_departing: bool = False
    kitchen_finalized_by_name: Optional[str] = None
    booking_finalized_by_name: Optional[str] = None


class OrderHistoryRow(BaseModel):
    date: date
    meal_type: str
    menu_item_id: Optional[int] = None
    item_name: str
    price: float
    status: str
    price_is_override: bool = False
    gas_amount: Optional[float] = None
    status: str
