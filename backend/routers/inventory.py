"""Inventory management router."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from sqlalchemy import func
from backend.database import get_db
from backend.models import (
    InventoryCategory, InventoryItem, StockBatch, StockMovement,
    WasteLog, CycleCount, Alert, AlertSeverity, AlertStatus,
)
from backend.schemas import (
    InventoryCategoryCreate, InventoryItemCreate, InventoryItemUpdate,
    StockBatchCreate, StockMovementCreate, WasteLogCreate, CycleCountCreate,
)
from backend.auth import get_current_user, check_permission, require_supervisor
from backend.audit import log_audit, serialize_model, AuditAction
from backend.logging_config import get_logger

logger = get_logger("app")
router = APIRouter()


# --- Categories ---

@router.get("/categories")
async def list_categories(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    return db.query(InventoryCategory).filter(InventoryCategory.is_active == True).all()


@router.post("/categories")
async def create_category(data: InventoryCategoryCreate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "inventory", "create"):
        raise HTTPException(status_code=403, detail="Permission denied")
    cat = InventoryCategory(**data.model_dump())
    db.add(cat)
    db.commit()
    db.refresh(cat)
    log_audit(db, current_user.id, current_user.full_name, AuditAction.CREATE, "inventory_categories", cat.id, after_state=serialize_model(cat), ip_address=request.client.host)
    return cat


# --- Items ---

@router.get("/items")
async def list_items(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    search: str = "",
    category_id: int = 0,
    low_stock: bool = False,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    query = db.query(InventoryItem).filter(InventoryItem.is_active == True)
    if search:
        query = query.filter((InventoryItem.name.contains(search)) | (InventoryItem.sku.contains(search)))
    if category_id:
        query = query.filter(InventoryItem.category_id == category_id)

    total = query.count()
    items = query.order_by(InventoryItem.name).offset((page - 1) * page_size).limit(page_size).all()

    # One query for all batches across this page's items instead of one query per item.
    item_ids = [item.id for item in items]
    batches_by_item = {}
    if item_ids:
        all_batches = db.query(StockBatch).filter(StockBatch.item_id.in_(item_ids), StockBatch.is_active == True).all()
        for b in all_batches:
            batches_by_item.setdefault(b.item_id, []).append(b)

    result = []
    for item in items:
        batches = batches_by_item.get(item.id, [])
        total_stock = sum(b.quantity for b in batches)

        is_low = total_stock <= item.reorder_level and item.reorder_level > 0
        if low_stock and not is_low:
            continue

        result.append({
            "id": item.id, "sku": item.sku, "name": item.name,
            "category_id": item.category_id, "category_name": item.category.name if item.category else None,
            "description": item.description, "unit": item.unit,
            "ingredient_type": item.ingredient_type.value if item.ingredient_type else None,
            "reorder_level": item.reorder_level, "reorder_quantity": item.reorder_quantity,
            "is_active": item.is_active, "created_at": item.created_at,
            "total_stock": total_stock,
        })

    return {"items": result, "total": total, "page": page, "page_size": page_size}


@router.post("/items")
async def create_item(data: InventoryItemCreate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "inventory", "create"):
        raise HTTPException(status_code=403, detail="Permission denied")
    if db.query(InventoryItem).filter(InventoryItem.sku == data.sku).first():
        raise HTTPException(status_code=400, detail="SKU already exists")

    item = InventoryItem(**data.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    log_audit(db, current_user.id, current_user.full_name, AuditAction.CREATE, "inventory_items", item.id, after_state=serialize_model(item), ip_address=request.client.host)
    return item


@router.put("/items/{item_id}")
async def update_item(item_id: int, data: InventoryItemUpdate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "inventory", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    item = db.query(InventoryItem).filter(InventoryItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    before = serialize_model(item)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    db.commit()
    db.refresh(item)
    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "inventory_items", item.id, before_state=before, after_state=serialize_model(item), ip_address=request.client.host)
    return item


@router.delete("/items/{item_id}")
async def soft_delete_item(item_id: int, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "inventory", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    item = db.query(InventoryItem).filter(InventoryItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    before = serialize_model(item)
    item.is_active = False
    db.commit()
    log_audit(db, current_user.id, current_user.full_name, AuditAction.SOFT_DELETE, "inventory_items", item.id, before_state=before, after_state=serialize_model(item), reason="Soft deleted", ip_address=request.client.host)
    return {"message": "Item deactivated"}


# --- Stock Batches ---

@router.get("/batches")
async def list_batches(item_id: int = 0, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    query = db.query(StockBatch).filter(StockBatch.is_active == True)
    if item_id:
        query = query.filter(StockBatch.item_id == item_id)
    batches = query.order_by(StockBatch.expiry_date).all()
    return [{"id": b.id, "item_id": b.item_id, "item_name": b.item.name if b.item else None,
             "batch_number": b.batch_number, "quantity": b.quantity,
             "bin_location": b.bin_location, "expiry_date": b.expiry_date, "unit_cost": float(b.unit_cost) if b.unit_cost else 0} for b in batches]


@router.post("/batches")
async def create_batch(data: StockBatchCreate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "inventory", "create"):
        raise HTTPException(status_code=403, detail="Permission denied")
    batch = StockBatch(**data.model_dump())
    db.add(batch)
    db.commit()
    db.refresh(batch)

    # Log stock movement
    movement = StockMovement(
        batch_id=batch.id, item_id=batch.item_id, movement_type="receipt",
        quantity=batch.quantity,
        reference_type="batch", reference_id=batch.id,
        notes=f"Batch {batch.batch_number} created", created_by=current_user.id,
    )
    db.add(movement)
    db.commit()

    log_audit(db, current_user.id, current_user.full_name, AuditAction.CREATE, "stock_batches", batch.id, after_state=serialize_model(batch), ip_address=request.client.host)
    return batch


# --- Stock Movements ---

@router.get("/movements")
async def list_movements(item_id: int = 0, page: int = Query(1, ge=1), page_size: int = Query(25, ge=1), db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    query = db.query(StockMovement)
    if item_id:
        query = query.filter(StockMovement.item_id == item_id)
    total = query.count()
    movements = query.order_by(StockMovement.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {"items": movements, "total": total, "page": page, "page_size": page_size}


@router.post("/movements")
async def create_movement(data: StockMovementCreate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "inventory", "create"):
        raise HTTPException(status_code=403, detail="Permission denied")

    batch = db.query(StockBatch).filter(StockBatch.id == data.batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    if data.movement_type == "issue":
        if batch.quantity < data.quantity:
            raise HTTPException(status_code=400, detail="Insufficient stock")
        batch.quantity -= data.quantity
    elif data.movement_type == "receipt":
        batch.quantity += data.quantity
    elif data.movement_type == "adjustment":
        batch.quantity = data.quantity

    movement = StockMovement(created_by=current_user.id, **data.model_dump())
    db.add(movement)
    db.commit()
    db.refresh(batch)

    if batch.quantity < 0:
        # A concurrent request depleted this batch between our read and commit.
        # SQLite serializes commits, so this check immediately after commit is
        # race-free: compensate by reverting the decrement and reject.
        batch.quantity += data.quantity
        db.delete(movement)
        db.commit()
        raise HTTPException(status_code=409, detail="Stock level would go negative due to a concurrent change - please retry")

    db.refresh(movement)
    log_audit(db, current_user.id, current_user.full_name, AuditAction.CREATE, "stock_movements", movement.id, after_state=serialize_model(movement), ip_address=request.client.host)
    return movement


# --- Waste Logging ---

@router.get("/waste")
async def list_waste(page: int = Query(1, ge=1), page_size: int = Query(25, ge=1), db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    total = db.query(WasteLog).count()
    logs = db.query(WasteLog).order_by(WasteLog.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {"items": [{"id": w.id, "item_id": w.item_id, "item_name": w.item.name if w.item else None,
                      "quantity": w.quantity, "category": w.category.value, "note": w.note,
                      "cost": float(w.cost) if w.cost else 0, "created_at": w.created_at} for w in logs], "total": total}


@router.post("/waste")
async def log_waste(data: WasteLogCreate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "inventory", "create"):
        raise HTTPException(status_code=403, detail="Permission denied")

    wl = WasteLog(**data.model_dump(), logged_by=current_user.id)
    db.add(wl)

    # Deduct from batch if specified
    batch = None
    movement = None
    if data.batch_id:
        batch = db.query(StockBatch).filter(StockBatch.id == data.batch_id).first()
        if batch:
            batch.quantity -= data.quantity
            movement = StockMovement(
                batch_id=batch.id, item_id=data.item_id, movement_type="waste",
                quantity=data.quantity,
                notes=f"Waste: {data.category}", created_by=current_user.id,
            )
            db.add(movement)

    db.commit()
    db.refresh(wl)

    if batch is not None:
        db.refresh(batch)
        if batch.quantity < 0:
            # Same race-free post-commit compensation pattern as create_movement:
            # SQLite serializes commits, so this check right after commit is reliable.
            batch.quantity += data.quantity
            db.delete(wl)
            if movement is not None:
                db.delete(movement)
            db.commit()
            raise HTTPException(status_code=409, detail="Stock level would go negative due to a concurrent change - please retry")

    log_audit(db, current_user.id, current_user.full_name, AuditAction.CREATE, "waste_logs", wl.id, after_state=serialize_model(wl), ip_address=request.client.host)
    return wl


# --- Cycle Counts ---

@router.get("/cycle-counts")
async def list_cycle_counts(page: int = Query(1, ge=1), page_size: int = Query(25, ge=1), db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    total = db.query(CycleCount).count()
    counts = db.query(CycleCount).order_by(CycleCount.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {"items": counts, "total": total}


@router.post("/cycle-counts")
async def create_cycle_count(data: CycleCountCreate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "inventory", "create"):
        raise HTTPException(status_code=403, detail="Permission denied")

    variance = data.actual_quantity - data.expected_quantity
    variance_pct = (variance / data.expected_quantity * 100) if data.expected_quantity else 0

    cc = CycleCount(
        **data.model_dump(),
        variance=variance,
        variance_percentage=variance_pct,
        counted_by=current_user.id,
    )
    db.add(cc)
    db.commit()
    db.refresh(cc)

    if abs(variance_pct) > 5:
        from backend.alerts import create_alert
        create_alert(db, f"Stock Variance: Item #{data.item_id}",
                     f"Variance of {variance_pct:.1f}% detected. Expected: {data.expected_quantity}, Actual: {data.actual_quantity}",
                     AlertSeverity.HIGH, "inventory", "cycle_count", cc.id)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.CREATE, "cycle_counts", cc.id, after_state=serialize_model(cc), ip_address=request.client.host)
    return cc
