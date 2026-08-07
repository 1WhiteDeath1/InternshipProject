"""Single source of truth for "what does this consumer owe/have ordered from
the kitchen" - feeds the checkout bill's consolidated Extra Messing line, the
Kitchen mess-charges overview, and the order-history view.

Consumer identities and what counts as "unbilled" differ by type:
- A checked-in room guest (booking_id): routine MealAttendance (scaled by the
  meal multiplier) + a la carte KitchenOrder (never scaled), both gated on
  invoiced_at being null - the same rows Instant Checkout stamps as billed.
- A standalone walk-in guest (guest_id): routine MealAttendance only -
  KitchenOrder has no guest_id column, a walk-in can't order a la carte.
- A permanent member (member_id): a la carte KitchenOrder only. Routine
  dining is priced man-days x per-head-rate by mess_billing.generate_bills,
  not per-dish, and MealAttendance.invoiced_at is never set for member rows -
  there's no meaningful "unbilled routine meal" figure to compute here.
"""
from calendar import monthrange
from datetime import date
from sqlalchemy.orm import Session
from backend.models import MealAttendance, KitchenOrder, MenuItem, Booking, ClientCategory
from backend.services.mess_billing_calc import get_setting_float


def meal_multiplier_for_booking(db: Session, booking: Booking) -> float:
    """The client-category multiplier applied to a room guest's routine meal
    charges. Shared by the checkout preview and the actual invoice build (and
    now the mess-charges overview) so they can never diverge."""
    if booking.client_category == ClientCategory.NON_MEMBER_NON_CIVILIAN:
        return get_setting_float(db, "non_civilian_meal_multiplier", 1.0)
    if booking.client_category == ClientCategory.NON_MEMBER_CIVILIAN:
        return get_setting_float(db, "civilian_meal_multiplier", 1.0)
    return 1.0


def walkin_meal_multiplier(db: Session) -> float:
    """Meal-charge multiplier for a standalone walk-in guest. No Booking, so
    no client_category - a walk-in mess guest is a non-member civilian, the
    same tier a civilian room guest bills at."""
    return get_setting_float(db, "civilian_meal_multiplier", 1.0)


def _resolve_menu_price(db: Session, menu_item_id: int | None) -> float:
    if not menu_item_id:
        return 0.0
    item = db.query(MenuItem).filter(MenuItem.id == menu_item_id, MenuItem.is_active == True).first()
    return float(item.price) if item else 0.0


def _dish_pricing_order(db: Session, meal_date, meal_type: str, menu_item_id: int | None) -> KitchenOrder | None:
    """The routine (non-ala-carte) batch order for this exact (date,
    meal_type, dish), if one exists - the single place the Kitchen NCO's
    per-dish price_override and gas_amount live (see PUT /kitchen/dish-pricing
    and KitchenOrder's model docstrings). There's no FK from MealAttendance to
    KitchenOrder (only this matching triple, same as production-order
    generation), and no DB uniqueness constraint stopping two orders existing
    for the same triple, so the most recently created one wins."""
    if menu_item_id is None or meal_date is None:
        return None
    return db.query(KitchenOrder).filter(
        KitchenOrder.is_ala_carte == False, KitchenOrder.meal_date == meal_date,
        KitchenOrder.meal_type == meal_type, KitchenOrder.menu_item_id == menu_item_id,
    ).order_by(KitchenOrder.created_at.desc()).first()


def _effective_dish_price(db: Session, meal_date, meal_type: str, menu_item_id: int | None) -> float:
    """The price actually charged for this date+meal+dish - the Kitchen NCO's
    price_override if one was set on the matching batch order, otherwise the
    plain MenuItem price (the "automatic" default)."""
    order = _dish_pricing_order(db, meal_date, meal_type, menu_item_id)
    if order is not None and order.price_override is not None:
        return float(order.price_override)
    return _resolve_menu_price(db, menu_item_id)


def compute_unbilled_mess_total(
    db: Session, *, member_id: int | None = None, booking_id: int | None = None,
    guest_id: int | None = None, meal_multiplier: float = 1.0,
):
    """Returns (total, unpriced_labels, attendance_rows, ala_carte_orders).
    Exactly one of member_id/booking_id/guest_id must be set. The two row
    lists are returned (not just the total) so callers that go on to mark
    them billed - Instant Checkout, the walk-in mess bill - query them once
    here rather than a second time."""
    assert sum(x is not None for x in (member_id, booking_id, guest_id)) == 1, \
        "compute_unbilled_mess_total needs exactly one consumer identity"

    total = 0.0
    unpriced: list[str] = []

    attendance_rows = []
    if booking_id is not None or guest_id is not None:
        query = db.query(MealAttendance).filter(
            MealAttendance.invoiced_at.is_(None), MealAttendance.status.in_(["booked", "attended", "no_show"]),
        )
        query = query.filter(MealAttendance.booking_id == booking_id) if booking_id is not None else query.filter(MealAttendance.guest_id == guest_id)
        attendance_rows = query.all()
        for a in attendance_rows:
            # "Automatic, based on meal prices, but still editable" - respects
            # a Kitchen-NCO price_override on the matching batch order before
            # falling back to the plain menu price.
            price = _effective_dish_price(db, a.date, a.meal_type.value, a.menu_item_id)
            if price > 0:
                total += price * meal_multiplier
            else:
                label = f"No-Show Charge ({a.date.strftime('%d %b')})" if a.status == "no_show" else f"{a.meal_type.value.title()} ({a.date.strftime('%d %b')})"
                unpriced.append(label)

    ala_carte_orders = []
    if booking_id is not None or member_id is not None:
        query = db.query(KitchenOrder).filter(
            KitchenOrder.is_ala_carte == True, KitchenOrder.status == "served", KitchenOrder.invoiced_at.is_(None),
        )
        query = query.filter(KitchenOrder.booking_id == booking_id) if booking_id is not None else query.filter(KitchenOrder.member_id == member_id)
        ala_carte_orders = query.all()
        for o in ala_carte_orders:
            price = _resolve_menu_price(db, o.menu_item_id)
            if price > 0:
                total += price * o.quantity_ordered
            else:
                unpriced.append(f"A la carte - {o.menu_item.name if o.menu_item else 'item'}")

    return total, unpriced, attendance_rows, ala_carte_orders


def compute_unbilled_gas_total(
    db: Session, attendance_rows: list, *, meal_multiplier: float = 1.0, fallback_percentage: float = 0.0,
) -> float:
    """Sui Gas Charges on Messing for one consumer's still-unbilled routine
    meals - reuses the attendance_rows compute_unbilled_mess_total already
    fetched rather than re-querying. Only 'attended' rows are charged (a
    no-show/booked-only row never touched the kitchen's gas). For each
    attended row, the Kitchen NCO's per-dish gas amount on the matching batch
    order is used if one was set (see _dish_pricing_order) - the same amount
    every attendee of that exact date+meal+dish gets - otherwise falls back
    to the mess-wide percentage-of-food-price estimate (fallback_percentage,
    from GasChargeRate, applied to the *effective* price so an overridden
    food price is reflected here too) so an unpriced dish never silently
    bills Rs 0 gas."""
    attended = [r for r in attendance_rows if r.status == "attended"]
    total = 0.0
    for r in attended:
        order = _dish_pricing_order(db, r.date, r.meal_type.value, r.menu_item_id)
        if order is not None and order.gas_amount is not None:
            total += float(order.gas_amount)
        else:
            price = _effective_dish_price(db, r.date, r.meal_type.value, r.menu_item_id)
            total += price * meal_multiplier * fallback_percentage / 100
    return total


def get_member_gas_total(db: Session, member_id: int, month: int, year: int, *, fallback_percentage: float = 0.0) -> float:
    """A member's routine-dining gas total for one billing period - mirrors
    get_man_days's shape (backend/services/mess_billing_calc.py) but for gas.
    Members have no per-row 'unbilled' concept (their routine dining is
    always billed as a whole period by generate_bills, never per-attendance-
    row), so this always sums every 'attended' row in the period, billed or
    not - callers decide whether that's a live preview (mess-charges-overview)
    or the actual figure being generated (mess_billing.generate_bills)."""
    period_start = date(year, month, 1)
    period_end = date(year, month, monthrange(year, month)[1])
    rows = db.query(MealAttendance).filter(
        MealAttendance.member_id == member_id, MealAttendance.status == "attended",
        MealAttendance.date >= period_start, MealAttendance.date <= period_end,
    ).all()
    total = 0.0
    for r in rows:
        order = _dish_pricing_order(db, r.date, r.meal_type.value, r.menu_item_id)
        if order is not None and order.gas_amount is not None:
            total += float(order.gas_amount)
        else:
            price = _effective_dish_price(db, r.date, r.meal_type.value, r.menu_item_id)
            total += price * fallback_percentage / 100
    return total


def get_order_history(
    db: Session, *, member_id: int | None = None, booking_id: int | None = None, guest_id: int | None = None,
) -> list[dict]:
    """Everything this consumer has ever ordered - billed and unbilled alike
    (no invoiced_at filter) - for the Order History view. Sorted newest first."""
    assert sum(x is not None for x in (member_id, booking_id, guest_id)) == 1, \
        "get_order_history needs exactly one consumer identity"

    rows: list[dict] = []

    attendance_query = db.query(MealAttendance)
    if member_id is not None:
        attendance_query = attendance_query.filter(MealAttendance.member_id == member_id)
    elif booking_id is not None:
        attendance_query = attendance_query.filter(MealAttendance.booking_id == booking_id)
    else:
        attendance_query = attendance_query.filter(MealAttendance.guest_id == guest_id)
    for a in attendance_query.all():
        dish_order = _dish_pricing_order(db, a.date, a.meal_type.value, a.menu_item_id)
        price = float(dish_order.price_override) if dish_order and dish_order.price_override is not None else _resolve_menu_price(db, a.menu_item_id)
        rows.append({
            "date": a.date, "meal_type": a.meal_type.value, "menu_item_id": a.menu_item_id,
            "item_name": a.menu_item.name if a.menu_item else "meal",
            "price": price, "status": a.status.value,
            "price_is_override": bool(dish_order and dish_order.price_override is not None),
            "gas_amount": float(dish_order.gas_amount) if dish_order and dish_order.gas_amount is not None else None,
        })

    # KitchenOrder carries no guest_id - a walk-in can't have a la carte history.
    if member_id is not None or booking_id is not None:
        order_query = db.query(KitchenOrder).filter(KitchenOrder.is_ala_carte == True)
        order_query = order_query.filter(KitchenOrder.member_id == member_id) if member_id is not None else order_query.filter(KitchenOrder.booking_id == booking_id)
        for o in order_query.all():
            # price_override/gas_amount don't apply to a la carte orders (see
            # KitchenOrder's model docstrings) - always the plain menu price,
            # no gas line.
            rows.append({
                "date": o.meal_date or o.created_at.date(), "meal_type": "a_la_carte", "menu_item_id": o.menu_item_id,
                "item_name": o.menu_item.name if o.menu_item else "item",
                "price": _resolve_menu_price(db, o.menu_item_id) * o.quantity_ordered, "status": o.status,
                "price_is_override": False, "gas_amount": None,
            })

    rows.sort(key=lambda r: r["date"], reverse=True)
    return rows
