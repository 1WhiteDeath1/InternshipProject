"""Kitchen production orders - what everyone (member or guest) is eating,
aggregated into suggested production quantities, and the actual
prepare/serve workflow with inventory deduction."""
from datetime import datetime, date
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.models import KitchenOrder, Recipe, MealAttendance, FeatureFlag
from backend.schemas import KitchenOrderCreate, KitchenOrderPrepareRequest
from backend.auth import get_current_user, check_permission
from backend.audit import log_audit, serialize_model, AuditAction
from backend.logging_config import get_logger
from backend.services.kitchen_deduction import deduct_recipe_stock

logger = get_logger("app")
router = APIRouter()


def _is_feature_enabled(db: Session, key: str) -> bool:
    flag = db.query(FeatureFlag).filter(FeatureFlag.key == key).first()
    return bool(flag and flag.enabled)


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
        day_start = datetime.combine(date.fromisoformat(order_date), datetime.min.time())
        day_end = datetime.combine(date.fromisoformat(order_date), datetime.max.time())
        query = query.filter(KitchenOrder.created_at >= day_start, KitchenOrder.created_at <= day_end)

    total = query.count()
    orders = query.order_by(KitchenOrder.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {"items": [
        {"id": o.id, "recipe_id": o.recipe_id, "recipe_name": o.recipe.name if o.recipe else None,
         "quantity_ordered": o.quantity_ordered, "actual_portions": o.actual_portions,
         "food_cost": float(o.food_cost) if o.food_cost else None, "status": o.status,
         "notes": o.notes, "ordered_by": o.ordered_by, "created_at": o.created_at} for o in orders], "total": total}


@router.post("/orders")
async def create_kitchen_order(data: KitchenOrderCreate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "kitchen", "create"):
        raise HTTPException(status_code=403, detail="Permission denied")
    recipe = db.query(Recipe).filter(Recipe.id == data.recipe_id).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")

    order = KitchenOrder(recipe_id=data.recipe_id, quantity_ordered=data.quantity_ordered, notes=data.notes, status="pending", source="manual", ordered_by=current_user.id)
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
    meal_date = date.fromisoformat(order_date)  # Date column needs a real date, not the raw query string

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


@router.post("/orders/{order_id}/cancel")
async def cancel_kitchen_order(order_id: int, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "kitchen", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    order = db.query(KitchenOrder).filter(KitchenOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Kitchen order not found")
    if order.status not in ("pending", "prepared"):
        raise HTTPException(status_code=400, detail="Only a pending or prepared order can be cancelled")

    # Known limitation: cancelling an already-prepared order does not reverse
    # its inventory deduction - reversing consumed kitchen stock is a separate,
    # deliberately out-of-scope concern for this change.
    before = serialize_model(order)
    order.status = "cancelled"
    db.commit()
    db.refresh(order)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "kitchen_orders", order.id, before_state=before, after_state=serialize_model(order), ip_address=request.client.host)
    return order
