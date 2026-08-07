"""Kitchen production orders - what everyone (member or guest) is eating,
aggregated into suggested production quantities, and the actual
prepare/serve workflow. Also the custom a la carte order lifecycle
(Pending -> Cooking -> Completed/Late) with SLA timers; the editable Menu
(Kitchen NCO proposes, Manager approves); the Gas Charge percentage rate
Kitchen NCO sets directly for guest bills; and the mess-charges overview +
order-history views (Extra Messing itself is always computed from actual
orders, see backend/services/mess_charge_calc.py)."""
from datetime import datetime, date, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, or_
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.models import (
    KitchenOrder, MenuItem, MenuItemEditRequest, GasChargeRate, GasChargeRateHistory,
    MealAttendance, Member, MemberStatus, Booking, AlertSeverity, EditRequestStatus, FeatureFlag,
)
from backend.models.enums import MealType
from backend.schemas import (
    KitchenOrderCreate, KitchenOrderPrepareRequest, DishPricingSet,
    MenuItemProposal, EditRequestReject, GasChargeRateUpdate,
)
from backend.auth import get_current_user, check_permission, PermissionChecker
from backend.audit import log_audit, serialize_model, AuditAction
from backend.logging_config import get_logger
from backend.services.mess_billing_calc import get_setting_float
from backend.services.mess_charge_calc import (
    compute_unbilled_mess_total, compute_unbilled_gas_total, get_order_history, meal_multiplier_for_booking,
    get_member_gas_total,
)
from backend.alerts import create_alert

logger = get_logger("app")
# No router-level permission dependency: KitchenOrder endpoints below need
# "kitchen" (Kitchen NCO only), but Menu/Mess-Gas-Rate endpoints are also
# reached by Manager/Deputy (who never get "kitchen" access) via their own
# "menu"/"mess_rates" permissions - each endpoint checks the module it owns.
router = APIRouter()


def _is_feature_enabled(db: Session, key: str) -> bool:
    flag = db.query(FeatureFlag).filter(FeatureFlag.key == key).first()
    return bool(flag and flag.enabled)


def _recompute_ala_carte_status(db: Session, order: KitchenOrder) -> None:
    """Lazy, on-read recomputation of an a la carte order's SLA state - there is
    no background scheduler in this app, so this (plus light frontend polling)
    is the entire "timer" mechanism. Only touches is_ala_carte orders still in
    pending/cooking. Flips to 'late' once due_at passes, and posts exactly one
    CRITICAL admin alert once escalation_minutes further overdue, guarded by
    escalated_at so repeated reads never duplicate-alert."""
    if not order.is_ala_carte or order.status in ("served", "cancelled") or not order.due_at:
        return
    now = datetime.utcnow()
    if now <= order.due_at:
        return
    if order.status in ("pending", "cooking"):
        order.status = "late"
        db.commit()
    escalation_minutes = get_setting_float(db, "ala_carte_escalation_minutes", 15)
    if order.escalated_at is None and now > order.due_at + timedelta(minutes=escalation_minutes):
        item_name = order.menu_item.name if order.menu_item else "Order"
        create_alert(
            db, f"Kitchen order #{order.id} critically overdue",
            f"{item_name} for {_consumer_name(order) or 'a guest'} is over {escalation_minutes:.0f} min past its SLA deadline.",
            AlertSeverity.CRITICAL, "kitchen", "kitchen_order", order.id,
        )
        order.escalated_at = now
        db.commit()


def _aggregate_suggestions(db: Session, order_date: str, meal_type: str):
    # Member and guest consumption rows combine identically here - the query
    # never discriminates on member_id vs booking_id - this is what makes the
    # suggestion reflect everyone eating that meal, not just members. Returns a
    # list of (menu_item_id, headcount) rows.
    return db.query(
        MealAttendance.menu_item_id, func.count(MealAttendance.id).label("headcount"),
    ).filter(
        MealAttendance.date == order_date,
        MealAttendance.meal_type == meal_type,
        MealAttendance.status.in_(["booked", "attended"]),
        MealAttendance.menu_item_id.isnot(None),
    ).group_by(MealAttendance.menu_item_id).all()


@router.get("/orders")
async def list_kitchen_orders(
    status: str = "", order_date: str = Query("", alias="date"),
    page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db), current_user=Depends(get_current_user),
):
    if not check_permission(current_user, "kitchen", "view"):
        raise HTTPException(status_code=403, detail="Permission denied")
    query = db.query(KitchenOrder)
    if status:
        query = query.filter(KitchenOrder.status == status)
    if order_date:
        try:
            parsed = date.fromisoformat(order_date)
        except ValueError:
            raise HTTPException(status_code=400, detail="date must be an ISO date (YYYY-MM-DD)")
        day_start = datetime.combine(parsed, datetime.min.time())
        day_end = datetime.combine(parsed, datetime.max.time())
        query = query.filter(KitchenOrder.created_at >= day_start, KitchenOrder.created_at <= day_end)

    total = query.count()
    orders = query.order_by(KitchenOrder.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    for o in orders:
        _recompute_ala_carte_status(db, o)
    return {"items": [
        {"id": o.id, "menu_item_id": o.menu_item_id, "menu_item_name": o.menu_item.name if o.menu_item else None,
         "quantity_ordered": o.quantity_ordered, "actual_portions": o.actual_portions,
         "status": o.status, "notes": o.notes, "meal_date": o.meal_date, "meal_type": o.meal_type,
         "source": o.source, "ordered_by": o.ordered_by, "created_at": o.created_at,
         "is_ala_carte": bool(o.is_ala_carte), "consumer_type": o.consumer_type,
         "member_id": o.member_id, "booking_id": o.booking_id, "consumer_name": _consumer_name(o),
         "sla_minutes": o.sla_minutes, "due_at": o.due_at, "cooking_started_at": o.cooking_started_at,
         "gas_amount": float(o.gas_amount) if o.gas_amount is not None else None,
         "price_override": float(o.price_override) if o.price_override is not None else None,
         } for o in orders], "total": total}


def _consumer_name(order: KitchenOrder) -> str | None:
    if order.member_id and order.member:
        return order.member.full_name
    if order.booking_id and order.booking:
        return order.booking.guest_name
    return None


@router.post("/orders")
async def create_kitchen_order(data: KitchenOrderCreate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "kitchen", "create"):
        raise HTTPException(status_code=403, detail="Permission denied")
    menu_item = db.query(MenuItem).filter(MenuItem.id == data.menu_item_id).first()
    if not menu_item:
        raise HTTPException(status_code=404, detail="Menu item not found")
    if data.is_ala_carte:
        if data.member_id and not db.query(Member).filter(Member.id == data.member_id).first():
            raise HTTPException(status_code=404, detail="Member not found")
        if data.booking_id and not db.query(Booking).filter(Booking.id == data.booking_id).first():
            raise HTTPException(status_code=404, detail="Booking not found")

    order = KitchenOrder(menu_item_id=data.menu_item_id, quantity_ordered=data.quantity_ordered, notes=data.notes, status="pending", source="manual", ordered_by=current_user.id)
    if data.is_ala_carte:
        sla_minutes = data.sla_minutes or int(get_setting_float(db, "ala_carte_default_sla_minutes", 45))
        order.is_ala_carte = True
        order.consumer_type = data.consumer_type
        order.member_id = data.member_id
        order.booking_id = data.booking_id
        order.sla_minutes = sla_minutes
        order.due_at = datetime.utcnow() + timedelta(minutes=sla_minutes)
    db.add(order)
    db.commit()
    db.refresh(order)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.CREATE, "kitchen_orders", order.id, after_state=serialize_model(order), ip_address=request.client.host)
    return order


@router.get("/suggested-orders")
async def suggested_orders(
    order_date: str = Query(..., alias="date"), meal_type: str = Query(...),
    db: Session = Depends(get_db), current_user=Depends(get_current_user),
):
    if not check_permission(current_user, "kitchen", "view"):
        raise HTTPException(status_code=403, detail="Permission denied")
    rows = _aggregate_suggestions(db, order_date, meal_type)
    menu_item_ids = [r.menu_item_id for r in rows]
    items_by_id = {i.id: i for i in db.query(MenuItem).filter(MenuItem.id.in_(menu_item_ids)).all()} if menu_item_ids else {}

    return [{"menu_item_id": r.menu_item_id, "menu_item_name": items_by_id[r.menu_item_id].name if r.menu_item_id in items_by_id else None,
             "suggested_quantity": r.headcount} for r in rows]


@router.post("/orders/generate")
async def generate_orders_from_bookings(
    order_date: str = Query(..., alias="date"), meal_type: str = Query(...),
    request: Request = None, db: Session = Depends(get_db), current_user=Depends(get_current_user),
):
    """Promote a date/meal's combined member+guest bookings into pending kitchen
    orders in one shot. Idempotent: a menu item that already has a non-cancelled
    order for the same meal_date/meal_type is skipped rather than duplicated."""
    if not check_permission(current_user, "kitchen", "create"):
        raise HTTPException(status_code=403, detail="Permission denied")
    try:
        meal_date = date.fromisoformat(order_date)  # Date column needs a real date, not the raw query string
    except ValueError:
        raise HTTPException(status_code=400, detail="date must be an ISO date (YYYY-MM-DD)")

    rows = _aggregate_suggestions(db, order_date, meal_type)
    menu_item_ids = [r.menu_item_id for r in rows]
    items_by_id = {i.id: i for i in db.query(MenuItem).filter(MenuItem.id.in_(menu_item_ids)).all()} if menu_item_ids else {}

    # Existing non-cancelled orders already covering this meal_date/meal_type.
    already_ordered = {
        o.menu_item_id for o in db.query(KitchenOrder).filter(
            KitchenOrder.meal_date == meal_date,
            KitchenOrder.meal_type == meal_type,
            KitchenOrder.status != "cancelled",
        ).all()
    }

    created, skipped = [], []
    for r in rows:
        item_name = items_by_id[r.menu_item_id].name if r.menu_item_id in items_by_id else None
        if r.menu_item_id in already_ordered:
            skipped.append({"menu_item_id": r.menu_item_id, "menu_item_name": item_name})
            continue
        order = KitchenOrder(
            menu_item_id=r.menu_item_id, quantity_ordered=r.headcount, status="pending",
            meal_date=meal_date, meal_type=meal_type, source="auto_from_bookings",
            ordered_by=current_user.id,
        )
        db.add(order)
        db.commit()
        db.refresh(order)
        created.append({"id": order.id, "menu_item_id": r.menu_item_id, "menu_item_name": item_name, "quantity_ordered": r.headcount})

    log_audit(db, current_user.id, current_user.full_name, AuditAction.CREATE, "kitchen_orders", None,
              after_state={"date": order_date, "meal_type": meal_type, "created": len(created), "skipped": len(skipped)},
              ip_address=request.client.host if request else None)
    return {"created": created, "skipped": skipped}


@router.post("/orders/{order_id}/prepare")
async def prepare_kitchen_order(order_id: int, data: KitchenOrderPrepareRequest, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "kitchen", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    order = db.query(KitchenOrder).filter(KitchenOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Kitchen order not found")
    if order.status != "pending":
        raise HTTPException(status_code=400, detail="Only a pending order can be prepared")

    before = serialize_model(order)
    if _is_feature_enabled(db, "portion_tracking") and data.actual_portions is not None:
        order.actual_portions = data.actual_portions
    order.status = "prepared"
    db.commit()
    db.refresh(order)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "kitchen_orders", order.id, before_state=before, after_state=serialize_model(order), ip_address=request.client.host)
    return order


@router.post("/orders/{order_id}/cook")
async def cook_kitchen_order(order_id: int, data: KitchenOrderPrepareRequest, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """One-tap 'Mark Cooked' - collapses prepare+serve, straight to served.
    Only a pending order can be cooked."""
    if not check_permission(current_user, "kitchen", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    order = db.query(KitchenOrder).filter(KitchenOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Kitchen order not found")
    if order.status != "pending":
        raise HTTPException(status_code=400, detail="Only a pending order can be cooked")

    before = serialize_model(order)
    if _is_feature_enabled(db, "portion_tracking") and data.actual_portions is not None:
        order.actual_portions = data.actual_portions
    order.status = "served"
    db.commit()
    db.refresh(order)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "kitchen_orders", order.id, before_state=before, after_state=serialize_model(order), ip_address=request.client.host)
    return order


@router.post("/orders/{order_id}/serve")
async def serve_kitchen_order(order_id: int, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "kitchen", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    order = db.query(KitchenOrder).filter(KitchenOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Kitchen order not found")
    if order.status != "prepared":
        raise HTTPException(status_code=400, detail="Only a prepared order can be served")

    before = serialize_model(order)
    order.status = "served"
    db.commit()
    db.refresh(order)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "kitchen_orders", order.id, before_state=before, after_state=serialize_model(order), ip_address=request.client.host)
    return order


@router.post("/orders/{order_id}/start-cooking")
async def start_cooking_kitchen_order(order_id: int, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """A la carte only: Pending/Late -> Cooking."""
    if not check_permission(current_user, "kitchen", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    order = db.query(KitchenOrder).filter(KitchenOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Kitchen order not found")
    if not order.is_ala_carte:
        raise HTTPException(status_code=400, detail="Only an a la carte order uses this transition")
    _recompute_ala_carte_status(db, order)
    if order.status not in ("pending", "late"):
        raise HTTPException(status_code=400, detail="Only a pending or late order can start cooking")

    before = serialize_model(order)
    order.status = "cooking"
    order.cooking_started_at = datetime.utcnow()
    db.commit()
    db.refresh(order)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "kitchen_orders", order.id, before_state=before, after_state=serialize_model(order), ip_address=request.client.host)
    return order


@router.post("/orders/{order_id}/complete")
async def complete_ala_carte_order(order_id: int, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """A la carte only: Cooking/Late -> Completed. Maps onto the existing
    terminal 'served' status string - no new terminal value needed."""
    if not check_permission(current_user, "kitchen", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    order = db.query(KitchenOrder).filter(KitchenOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Kitchen order not found")
    if not order.is_ala_carte:
        raise HTTPException(status_code=400, detail="Only an a la carte order uses this transition")
    _recompute_ala_carte_status(db, order)
    if order.status not in ("cooking", "late"):
        raise HTTPException(status_code=400, detail="Only a cooking or late order can be completed")

    before = serialize_model(order)
    order.status = "served"
    db.commit()
    db.refresh(order)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "kitchen_orders", order.id, before_state=before, after_state=serialize_model(order), ip_address=request.client.host)
    return order


@router.get("/orders/late-summary")
async def late_orders_summary(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Cheap count+list backing the Kitchen Production tab's late-orders banner."""
    if not check_permission(current_user, "kitchen", "view"):
        raise HTTPException(status_code=403, detail="Permission denied")
    candidates = db.query(KitchenOrder).filter(
        KitchenOrder.is_ala_carte == True, KitchenOrder.status.in_(["pending", "cooking", "late"]),
    ).all()
    for o in candidates:
        _recompute_ala_carte_status(db, o)
    late = [o for o in candidates if o.status == "late"]
    return {"count": len(late), "items": [
        {"id": o.id, "menu_item_name": o.menu_item.name if o.menu_item else None,
         "consumer_name": _consumer_name(o), "due_at": o.due_at} for o in late]}


@router.post("/orders/{order_id}/cancel")
async def cancel_kitchen_order(order_id: int, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "kitchen", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    order = db.query(KitchenOrder).filter(KitchenOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Kitchen order not found")
    if order.status not in ("pending", "prepared", "cooking", "late"):
        raise HTTPException(status_code=400, detail="Only a pending, prepared, cooking, or late order can be cancelled")

    before = serialize_model(order)
    order.status = "cancelled"
    db.commit()
    db.refresh(order)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "kitchen_orders", order.id, before_state=before, after_state=serialize_model(order), ip_address=request.client.host)
    return order


@router.put("/dish-pricing")
async def set_dish_pricing(data: DishPricingSet, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Sets the per-head food price override and/or gas charge for one
    routine date+meal+dish, entered once and automatically applied to
    everyone with an 'attended' MealAttendance row for that same date+meal+
    dish - see KitchenOrder.price_override/gas_amount's model docstrings and
    mess_charge_calc.py's _dish_pricing_order/_effective_dish_price. Finds
    the matching non-ala-carte batch order for this triple, or creates one
    (source='manual') if none exists yet, so the Kitchen NCO can price a
    dish straight from a person's breakdown table without first needing to
    "Generate from bookings" for that date/meal. Same mess_rates:edit gate
    as the mess-wide Gas Charge Rate."""
    if not check_permission(current_user, "mess_rates", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    try:
        MealType(data.meal_type)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid meal_type '{data.meal_type}'")
    if not db.query(MenuItem).filter(MenuItem.id == data.menu_item_id).first():
        raise HTTPException(status_code=404, detail="Menu item not found")

    order = db.query(KitchenOrder).filter(
        KitchenOrder.is_ala_carte == False, KitchenOrder.meal_date == data.date,
        KitchenOrder.meal_type == data.meal_type, KitchenOrder.menu_item_id == data.menu_item_id,
        KitchenOrder.status != "cancelled",
    ).order_by(KitchenOrder.created_at.desc()).first()

    before = serialize_model(order) if order else None
    if order is None:
        headcount = db.query(MealAttendance).filter(
            MealAttendance.date == data.date, MealAttendance.meal_type == data.meal_type,
            MealAttendance.menu_item_id == data.menu_item_id, MealAttendance.status.in_(["booked", "attended"]),
        ).count()
        order = KitchenOrder(
            menu_item_id=data.menu_item_id, quantity_ordered=max(headcount, 1), status="pending",
            meal_date=data.date, meal_type=data.meal_type, source="manual", ordered_by=current_user.id,
        )
        db.add(order)

    order.price_override = data.price_override
    order.gas_amount = data.gas_amount
    db.commit()
    db.refresh(order)

    log_audit(db, current_user.id, current_user.full_name,
              AuditAction.UPDATE if before else AuditAction.CREATE, "kitchen_orders", order.id,
              before_state=before, after_state=serialize_model(order), ip_address=request.client.host)
    return {
        "id": order.id,
        "price_override": float(order.price_override) if order.price_override is not None else None,
        "gas_amount": float(order.gas_amount) if order.gas_amount is not None else None,
    }


# --- Menu: Kitchen NCO proposes, Manager approves (mirrors billing.py's
# InvoiceEditRequest flow exactly) ---

def _menu_item_edit_request_out(db: Session, req: MenuItemEditRequest) -> dict:
    from backend.models import User
    requester = db.query(User).filter(User.id == req.requested_by).first() if req.requested_by else None
    original = req.menu_item
    return {
        "id": req.id, "menu_item_id": req.menu_item_id, "is_new_item": bool(req.is_new_item),
        "original_name": original.name if original else None,
        "original_price": float(original.price) if original else None,
        "proposed_name": req.proposed_name, "proposed_price": float(req.proposed_price),
        "proposed_meal_type": req.proposed_meal_type.value if hasattr(req.proposed_meal_type, "value") else req.proposed_meal_type,
        "proposed_day_of_week": req.proposed_day_of_week,
        "reason": req.reason, "status": req.status.value,
        "requested_by_name": requester.full_name if requester else None,
        "requested_at": req.requested_at, "decision_reason": req.decision_reason,
    }


def _parse_meal_type(value: str) -> MealType:
    try:
        return MealType(value)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"meal_type must be one of {[m.value for m in MealType]}")


@router.get("/menu")
async def list_menu_items(meal_type: str = "", db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Open to any authenticated user - Billing/Attendance need to read
    prices/items without operating the Kitchen module (same as the old
    menu_prices GET)."""
    query = db.query(MenuItem).filter(MenuItem.is_active == True)
    if meal_type:
        query = query.filter(MenuItem.meal_type == _parse_meal_type(meal_type))
    items = query.order_by(MenuItem.day_of_week, MenuItem.name).all()
    return [{"id": i.id, "name": i.name, "meal_type": i.meal_type.value, "day_of_week": i.day_of_week,
             "price": float(i.price), "is_active": i.is_active} for i in items]


@router.post("/menu")
async def propose_new_menu_item(data: MenuItemProposal, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "menu", "create"):
        raise HTTPException(status_code=403, detail="Permission denied")
    req = MenuItemEditRequest(
        is_new_item=True, proposed_name=data.name, proposed_price=data.price,
        proposed_meal_type=_parse_meal_type(data.meal_type), proposed_day_of_week=data.day_of_week,
        reason=data.reason, requested_by=current_user.id,
    )
    db.add(req)
    db.commit()
    db.refresh(req)
    log_audit(db, current_user.id, current_user.full_name, AuditAction.CREATE, "menu_item_edit_requests", req.id,
              after_state=serialize_model(req), ip_address=request.client.host)
    return _menu_item_edit_request_out(db, req)


@router.put("/menu/{item_id}")
async def propose_menu_item_edit(item_id: int, data: MenuItemProposal, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "menu", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    item = db.query(MenuItem).filter(MenuItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Menu item not found")
    existing = db.query(MenuItemEditRequest).filter(
        MenuItemEditRequest.menu_item_id == item_id, MenuItemEditRequest.status == EditRequestStatus.PENDING,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="This item already has a change pending approval")

    req = MenuItemEditRequest(
        menu_item_id=item_id, is_new_item=False, proposed_name=data.name, proposed_price=data.price,
        proposed_meal_type=_parse_meal_type(data.meal_type), proposed_day_of_week=data.day_of_week,
        reason=data.reason, requested_by=current_user.id,
    )
    db.add(req)
    db.commit()
    db.refresh(req)
    log_audit(db, current_user.id, current_user.full_name, AuditAction.CREATE, "menu_item_edit_requests", req.id,
              after_state=serialize_model(req), ip_address=request.client.host)
    return _menu_item_edit_request_out(db, req)


@router.get("/menu/edit-requests")
async def list_menu_edit_requests(status: str = "pending", db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Used both by the Kitchen NCO (their own submitted requests) and the
    Manager (the approval queue)."""
    if not (check_permission(current_user, "menu", "create") or check_permission(current_user, "menu", "edit")
            or check_permission(current_user, "menu", "approve")):
        raise HTTPException(status_code=403, detail="Permission denied")
    query = db.query(MenuItemEditRequest)
    if status:
        try:
            query = query.filter(MenuItemEditRequest.status == EditRequestStatus(status))
        except ValueError:
            raise HTTPException(status_code=400, detail="status must be pending, approved, or rejected")
    reqs = query.order_by(MenuItemEditRequest.requested_at.desc()).all()
    return [_menu_item_edit_request_out(db, r) for r in reqs]


@router.post("/menu/edit-requests/{request_id}/approve")
async def approve_menu_edit_request(request_id: int, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "menu", "approve"):
        raise HTTPException(status_code=403, detail="Permission denied")
    req = db.query(MenuItemEditRequest).filter(MenuItemEditRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Edit request not found")
    if req.status != EditRequestStatus.PENDING:
        raise HTTPException(status_code=400, detail=f"Request already {req.status.value}")

    if req.is_new_item:
        item = MenuItem(name=req.proposed_name, price=req.proposed_price,
                         meal_type=req.proposed_meal_type, day_of_week=req.proposed_day_of_week)
        db.add(item)
        db.flush()
        after_state = serialize_model(item)
        before_state = None
    else:
        item = req.menu_item
        if not item:
            raise HTTPException(status_code=404, detail="Menu item no longer exists")
        before_state = serialize_model(item)
        item.name = req.proposed_name
        item.price = req.proposed_price
        item.meal_type = req.proposed_meal_type
        item.day_of_week = req.proposed_day_of_week
        after_state = serialize_model(item)

    req.status = EditRequestStatus.APPROVED
    req.decided_by = current_user.id
    req.decided_at = datetime.utcnow()
    db.commit()
    db.refresh(item)
    db.refresh(req)

    log_audit(db, current_user.id, current_user.full_name,
              AuditAction.CREATE if req.is_new_item else AuditAction.UPDATE, "menu_items", item.id,
              before_state=before_state, after_state=after_state, reason=req.reason, ip_address=request.client.host)
    return _menu_item_edit_request_out(db, req)


@router.post("/menu/edit-requests/{request_id}/reject")
async def reject_menu_edit_request(request_id: int, data: EditRequestReject, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "menu", "approve"):
        raise HTTPException(status_code=403, detail="Permission denied")
    req = db.query(MenuItemEditRequest).filter(MenuItemEditRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Edit request not found")
    if req.status != EditRequestStatus.PENDING:
        raise HTTPException(status_code=400, detail=f"Request already {req.status.value}")

    before = serialize_model(req)
    req.status = EditRequestStatus.REJECTED
    req.decided_by = current_user.id
    req.decided_at = datetime.utcnow()
    req.decision_reason = data.reason
    db.commit()
    db.refresh(req)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.OVERRIDE, "menu_item_edit_requests", req.id,
              before_state=before, after_state=serialize_model(req), reason=data.reason, ip_address=request.client.host)
    return _menu_item_edit_request_out(db, req)


# --- Gas charge rate: Kitchen NCO sets this percentage directly (no
# approval gate, unlike menu pricing above) - every change is logged to
# GasChargeRateHistory for the Manager's trend graph. Extra Messing itself
# is never a settable rate - see mess_charge_calc.py, it's always computed
# from actual orders. ---

@router.get("/gas-rate")
async def get_gas_rate(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not (check_permission(current_user, "mess_rates", "view") or check_permission(current_user, "mess_rates", "edit")):
        raise HTTPException(status_code=403, detail="Permission denied")
    row = db.query(GasChargeRate).first()
    return {"percentage": float(row.percentage) if row else 0.0, "updated_at": row.updated_at if row else None}


@router.put("/gas-rate")
async def upsert_gas_rate(data: GasChargeRateUpdate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "mess_rates", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")

    row = db.query(GasChargeRate).first()
    old_percentage = float(row.percentage) if row else 0.0
    if row:
        row.percentage = data.percentage
        row.updated_by = current_user.id
    else:
        row = GasChargeRate(percentage=data.percentage, updated_by=current_user.id)
        db.add(row)
    db.add(GasChargeRateHistory(old_percentage=old_percentage, new_percentage=data.percentage, changed_by=current_user.id))
    db.commit()
    db.refresh(row)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "gas_charge_rate", row.id,
              before_state={"percentage": old_percentage}, after_state={"percentage": float(row.percentage)}, ip_address=request.client.host)
    return {"percentage": float(row.percentage), "updated_at": row.updated_at}


@router.get("/gas-rate/history")
async def gas_rate_history(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not (check_permission(current_user, "mess_rates", "view") or check_permission(current_user, "mess_rates", "edit")):
        raise HTTPException(status_code=403, detail="Permission denied")
    rows = db.query(GasChargeRateHistory).order_by(GasChargeRateHistory.changed_at).all()
    return [{"old_percentage": float(r.old_percentage), "new_percentage": float(r.new_percentage),
             "changed_at": r.changed_at} for r in rows]


# --- Mess charges overview + order history: replaces the old one-guest-at-a-
# time picker. Covers active Members and currently checked-in Guests
# together - see mess_charge_calc.py for what "unbilled mess total" means
# for each consumer type. ---

def _can_view_mess_overview(current_user) -> bool:
    return (check_permission(current_user, "kitchen", "view") or check_permission(current_user, "members", "view")
            or check_permission(current_user, "clerk_desk", "view") or check_permission(current_user, "billing", "view"))


def _gas_percentage(db: Session) -> float:
    row = db.query(GasChargeRate).first()
    return float(row.percentage) if row else 0.0


@router.get("/mess-charges-overview")
async def mess_charges_overview(consumer_type: str = "all", db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not _can_view_mess_overview(current_user):
        raise HTTPException(status_code=403, detail="Permission denied")
    if consumer_type not in ("all", "member", "guest"):
        raise HTTPException(status_code=400, detail="consumer_type must be 'all', 'member', or 'guest'")

    rows = []
    fallback_percentage = _gas_percentage(db)
    # HRA members currently occupying a room are shown once, as the richer
    # "guest" row (with room number) - not double-counted as a member row too.
    hra_member_ids = {b.member_id for b in db.query(Booking).filter(
        Booking.status == "checked_in", Booking.nature_of_duty == "hra", Booking.member_id.isnot(None),
    ).all()}

    today = date.today()
    if consumer_type in ("all", "member"):
        for m in db.query(Member).filter(Member.status == MemberStatus.ACTIVE).all():
            if m.id in hra_member_ids:
                continue
            total, _, _, _ = compute_unbilled_mess_total(db, member_id=m.id)
            # A live preview of what this month's generate_bills run would
            # charge this member for gas so far (per-dish amount where the
            # NCO has set one, mess-wide percentage fallback otherwise) - see
            # get_member_gas_total. Not itself "unbilled" in the row-level
            # sense guests use, since member routine dining is only ever
            # actually billed monthly.
            gas_total = get_member_gas_total(db, m.id, today.month, today.year, fallback_percentage=fallback_percentage)
            rows.append({"consumer_type": "member", "consumer_id": m.id, "name": m.full_name,
                         "sub_label": f"{m.rank} · {m.unit}" if m.unit else m.rank,
                         "unbilled_mess_total": total, "unbilled_gas_total": gas_total})

    if consumer_type in ("all", "guest"):
        from backend.models import User
        checked_in_bookings = db.query(Booking).filter(Booking.status == "checked_in").all()
        finalizer_ids = {b.kitchen_finalized_by for b in checked_in_bookings if b.kitchen_finalized_by} | \
            {b.booking_finalized_by for b in checked_in_bookings if b.booking_finalized_by}
        names_by_id = {u.id: u.full_name for u in db.query(User).filter(User.id.in_(finalizer_ids)).all()} if finalizer_ids else {}
        for b in checked_in_bookings:
            meal_multiplier = meal_multiplier_for_booking(db, b)
            total, _, attendance_rows, _ = compute_unbilled_mess_total(db, booking_id=b.id, meal_multiplier=meal_multiplier)
            gas_total = compute_unbilled_gas_total(db, attendance_rows, meal_multiplier=meal_multiplier, fallback_percentage=fallback_percentage)
            rows.append({
                "consumer_type": "guest", "consumer_id": b.id, "name": b.guest_name,
                "sub_label": b.room.room_number if b.room else None,
                "unbilled_mess_total": total, "unbilled_gas_total": gas_total,
                # Checking-out context (see Booking.kitchen_finalized_at's model
                # docstring) so the breakdown dialog can surface a "checking
                # out" banner + the same Finalize action Departures offers,
                # without a second fetch.
                "is_departing": b.check_out <= today and b.nature_of_duty != "hra",
                "kitchen_finalized_by_name": names_by_id.get(b.kitchen_finalized_by),
                "booking_finalized_by_name": names_by_id.get(b.booking_finalized_by),
            })

    return rows


@router.get("/order-history")
async def order_history(member_id: int = 0, booking_id: int = 0, guest_id: int = 0, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not _can_view_mess_overview(current_user):
        raise HTTPException(status_code=403, detail="Permission denied")
    if sum(bool(x) for x in (member_id, booking_id, guest_id)) != 1:
        raise HTTPException(status_code=400, detail="Provide exactly one of member_id, booking_id, guest_id")
    return get_order_history(db, member_id=member_id or None, booking_id=booking_id or None, guest_id=guest_id or None)


# --- Departures: a narrow, Kitchen-scoped view of today's/overdue checkouts
# (guest name + room + unbilled mess/gas total only, not the full Bookings
# module) so the Kitchen NCO can see who's leaving and finalize their
# mess/gas charges before they check out - see Booking.kitchen_finalized_at's
# model docstring. Booking NCO's equivalent lives in bookings.py, stamping
# the same booking's booking_finalized_at instead. Neither stamp blocks
# checkout - the Clerk sees both statuses at checkout time as context. ---

def _departure_bookings(db: Session):
    today = date.today()
    return today, db.query(Booking).filter(
        Booking.check_out <= today, Booking.status == "checked_in",
        or_(Booking.nature_of_duty.is_(None), Booking.nature_of_duty != "hra"),
    ).order_by(Booking.check_out.asc()).all()


@router.get("/departures")
async def kitchen_departures(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "kitchen", "view"):
        raise HTTPException(status_code=403, detail="Permission denied")
    from backend.models import User
    today, bookings = _departure_bookings(db)

    fallback_percentage = _gas_percentage(db)
    finalizer_ids = {b.kitchen_finalized_by for b in bookings if b.kitchen_finalized_by} | \
        {b.booking_finalized_by for b in bookings if b.booking_finalized_by}
    names_by_id = {u.id: u.full_name for u in db.query(User).filter(User.id.in_(finalizer_ids)).all()} if finalizer_ids else {}

    out = []
    for b in bookings:
        meal_multiplier = meal_multiplier_for_booking(db, b)
        total, _, attendance_rows, _ = compute_unbilled_mess_total(db, booking_id=b.id, meal_multiplier=meal_multiplier)
        gas_total = compute_unbilled_gas_total(db, attendance_rows, meal_multiplier=meal_multiplier, fallback_percentage=fallback_percentage)
        out.append({
            "booking_id": b.id, "guest_name": b.guest_name, "room_number": b.room.room_number if b.room else None,
            "overdue": b.check_out < today, "days_overdue": (today - b.check_out).days,
            "unbilled_mess_total": total, "unbilled_gas_total": gas_total,
            "kitchen_finalized_at": b.kitchen_finalized_at, "kitchen_finalized_by_name": names_by_id.get(b.kitchen_finalized_by),
            "booking_finalized_at": b.booking_finalized_at, "booking_finalized_by_name": names_by_id.get(b.booking_finalized_by),
        })
    return out


@router.post("/departures/{booking_id}/finalize")
async def finalize_kitchen_departure(booking_id: int, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "kitchen", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    booking = db.query(Booking).filter(Booking.id == booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking.status.value != "checked_in":
        raise HTTPException(status_code=400, detail="Only a checked-in guest can be finalized for checkout")

    before = serialize_model(booking)
    booking.kitchen_finalized_at = datetime.utcnow()
    booking.kitchen_finalized_by = current_user.id
    db.commit()
    db.refresh(booking)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "bookings", booking.id,
              before_state=before, after_state=serialize_model(booking), ip_address=request.client.host)
    create_alert(
        db, f"Mess charges finalized: {booking.guest_name}",
        f"{current_user.full_name} confirmed {booking.guest_name}'s (Room {booking.room.room_number if booking.room else '-'}) "
        f"mess/gas charges are final - ready to check out.",
        AlertSeverity.LOW, "kitchen", "booking", booking.id,
    )
    return {"kitchen_finalized_at": booking.kitchen_finalized_at, "kitchen_finalized_by_name": current_user.full_name}
