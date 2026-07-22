"""Kitchen production orders - what everyone (member or guest) is eating,
aggregated into suggested production quantities, and the actual
prepare/serve workflow with inventory deduction. Also the custom a la carte
order lifecycle (Pending -> Cooking -> Completed/Late) with SLA timers."""
from datetime import datetime, date, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.models import KitchenOrder, Recipe, MealAttendance, FeatureFlag, Member, Booking, AlertSeverity
from backend.schemas import KitchenOrderCreate, KitchenOrderPrepareRequest
from backend.auth import get_current_user, check_permission, PermissionChecker
from backend.audit import log_audit, serialize_model, AuditAction
from backend.logging_config import get_logger
from backend.services.kitchen_deduction import deduct_recipe_stock
from backend.services.mess_billing_calc import get_setting_float
from backend.alerts import create_alert

logger = get_logger("app")
router = APIRouter(dependencies=[Depends(PermissionChecker("kitchen", "view"))])


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
        recipe_name = order.recipe.name if order.recipe else "Order"
        create_alert(
            db, f"Kitchen order #{order.id} critically overdue",
            f"{recipe_name} for {_consumer_name(order) or 'a guest'} is over {escalation_minutes:.0f} min past its SLA deadline.",
            AlertSeverity.CRITICAL, "kitchen", "kitchen_order", order.id,
        )
        order.escalated_at = now
        db.commit()


def _aggregate_suggestions(db: Session, order_date: str, meal_type: str):
    # Member and guest consumption rows combine identically here - the query
    # never discriminates on member_id vs booking_id - this is what makes the
    # suggestion reflect everyone eating that meal, not just members. Returns a
    # list of (recipe_id, headcount) rows.
    return db.query(
        MealAttendance.recipe_id, func.count(MealAttendance.id).label("headcount"),
    ).filter(
        MealAttendance.date == order_date,
        MealAttendance.meal_type == meal_type,
        MealAttendance.status.in_(["booked", "attended"]),
        MealAttendance.recipe_id.isnot(None),
    ).group_by(MealAttendance.recipe_id).all()


@router.get("/orders")
async def list_kitchen_orders(
    status: str = "", order_date: str = Query("", alias="date"),
    page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db), current_user=Depends(get_current_user),
):
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
        {"id": o.id, "recipe_id": o.recipe_id, "recipe_name": o.recipe.name if o.recipe else None,
         "quantity_ordered": o.quantity_ordered, "actual_portions": o.actual_portions,
         "food_cost": float(o.food_cost) if o.food_cost else None, "status": o.status,
         "notes": o.notes, "ordered_by": o.ordered_by, "created_at": o.created_at,
         "is_ala_carte": bool(o.is_ala_carte), "consumer_type": o.consumer_type,
         "member_id": o.member_id, "booking_id": o.booking_id, "consumer_name": _consumer_name(o),
         "sla_minutes": o.sla_minutes, "due_at": o.due_at, "cooking_started_at": o.cooking_started_at,
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
    recipe = db.query(Recipe).filter(Recipe.id == data.recipe_id).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    if data.is_ala_carte:
        if data.member_id and not db.query(Member).filter(Member.id == data.member_id).first():
            raise HTTPException(status_code=404, detail="Member not found")
        if data.booking_id and not db.query(Booking).filter(Booking.id == data.booking_id).first():
            raise HTTPException(status_code=404, detail="Booking not found")

    order = KitchenOrder(recipe_id=data.recipe_id, quantity_ordered=data.quantity_ordered, notes=data.notes, status="pending", source="manual", ordered_by=current_user.id)
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
    rows = _aggregate_suggestions(db, order_date, meal_type)
    recipe_ids = [r.recipe_id for r in rows]
    recipes_by_id = {r.id: r for r in db.query(Recipe).filter(Recipe.id.in_(recipe_ids)).all()} if recipe_ids else {}

    return [{"recipe_id": r.recipe_id, "recipe_name": recipes_by_id[r.recipe_id].name if r.recipe_id in recipes_by_id else None,
             "suggested_quantity": r.headcount} for r in rows]


@router.post("/orders/generate")
async def generate_orders_from_bookings(
    order_date: str = Query(..., alias="date"), meal_type: str = Query(...),
    request: Request = None, db: Session = Depends(get_db), current_user=Depends(get_current_user),
):
    """Promote a date/meal's combined member+guest bookings into pending kitchen
    orders in one shot. Idempotent: a recipe that already has a non-cancelled
    order for the same meal_date/meal_type is skipped rather than duplicated."""
    if not check_permission(current_user, "kitchen", "create"):
        raise HTTPException(status_code=403, detail="Permission denied")
    try:
        meal_date = date.fromisoformat(order_date)  # Date column needs a real date, not the raw query string
    except ValueError:
        raise HTTPException(status_code=400, detail="date must be an ISO date (YYYY-MM-DD)")

    rows = _aggregate_suggestions(db, order_date, meal_type)
    recipe_ids = [r.recipe_id for r in rows]
    recipes_by_id = {r.id: r for r in db.query(Recipe).filter(Recipe.id.in_(recipe_ids)).all()} if recipe_ids else {}

    # Existing non-cancelled orders already covering this meal_date/meal_type.
    already_ordered = {
        o.recipe_id for o in db.query(KitchenOrder).filter(
            KitchenOrder.meal_date == meal_date,
            KitchenOrder.meal_type == meal_type,
            KitchenOrder.status != "cancelled",
        ).all()
    }

    created, skipped = [], []
    for r in rows:
        recipe_name = recipes_by_id[r.recipe_id].name if r.recipe_id in recipes_by_id else None
        if r.recipe_id in already_ordered:
            skipped.append({"recipe_id": r.recipe_id, "recipe_name": recipe_name})
            continue
        order = KitchenOrder(
            recipe_id=r.recipe_id, quantity_ordered=r.headcount, status="pending",
            meal_date=meal_date, meal_type=meal_type, source="auto_from_bookings",
            ordered_by=current_user.id,
        )
        db.add(order)
        db.commit()
        db.refresh(order)
        created.append({"id": order.id, "recipe_id": r.recipe_id, "recipe_name": recipe_name, "quantity_ordered": r.headcount})

    log_audit(db, current_user.id, current_user.full_name, AuditAction.CREATE, "kitchen_orders", None,
              after_state={"date": order_date, "meal_type": meal_type, "created": len(created), "skipped": len(skipped)},
              ip_address=request.client.host if request else None)
    return {"created": created, "skipped": skipped}


def _apply_deduction(db: Session, order: KitchenOrder, current_user, actual_portions=None):
    """Shared body for prepare/cook: deduct recipe stock, auto-record food cost,
    optionally capture actual portions. Feature-flag gated exactly as before."""
    if _is_feature_enabled(db, "recipe_deductions"):
        consumed_cost = deduct_recipe_stock(db, order.recipe, order.quantity_ordered, order.id, current_user.id)
        # Auto-record food cost from the batches actually consumed, so cost
        # reporting needs zero manual entry (gated by its own feature flag).
        if _is_feature_enabled(db, "food_cost_reports"):
            order.food_cost = consumed_cost
    if _is_feature_enabled(db, "portion_tracking") and actual_portions is not None:
        order.actual_portions = actual_portions


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
    _apply_deduction(db, order, current_user, data.actual_portions)
    order.status = "prepared"
    db.commit()
    db.refresh(order)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "kitchen_orders", order.id, before_state=before, after_state=serialize_model(order), ip_address=request.client.host)
    return order


@router.post("/orders/{order_id}/cook")
async def cook_kitchen_order(order_id: int, data: KitchenOrderPrepareRequest, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """One-tap 'Mark Cooked' - collapses prepare+serve: deduct inventory and
    take the order straight to served. Only a pending order can be cooked."""
    if not check_permission(current_user, "kitchen", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    order = db.query(KitchenOrder).filter(KitchenOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Kitchen order not found")
    if order.status != "pending":
        raise HTTPException(status_code=400, detail="Only a pending order can be cooked")

    before = serialize_model(order)
    _apply_deduction(db, order, current_user, data.actual_portions)
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
    """A la carte only: Pending/Late -> Cooking. THE moment inventory is
    deducted, atomically, via the same deduct_recipe_stock used everywhere else."""
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
    _apply_deduction(db, order, current_user)
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
    candidates = db.query(KitchenOrder).filter(
        KitchenOrder.is_ala_carte == True, KitchenOrder.status.in_(["pending", "cooking", "late"]),
    ).all()
    for o in candidates:
        _recompute_ala_carte_status(db, o)
    late = [o for o in candidates if o.status == "late"]
    return {"count": len(late), "items": [
        {"id": o.id, "recipe_name": o.recipe.name if o.recipe else None,
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

    # Known limitation: cancelling an already-prepared order does not reverse
    # its inventory deduction - reversing consumed kitchen stock is a separate,
    # deliberately out-of-scope concern for this change.
    before = serialize_model(order)
    order.status = "cancelled"
    db.commit()
    db.refresh(order)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "kitchen_orders", order.id, before_state=before, after_state=serialize_model(order), ip_address=request.client.host)
    return order
