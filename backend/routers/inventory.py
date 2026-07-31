"""Inventory management router."""
import uuid
from datetime import datetime, date, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile, File
from sqlalchemy.orm import Session
from sqlalchemy import func, case, cast, Float
from backend.database import get_db
from backend.config import UPLOADS_DIR
from backend.models import (
    InventoryCategory, InventoryItem, StockBatch, StockMovement,
    WasteLog, CycleCount, Alert, AlertSeverity, AlertStatus, Vendor,
)
from backend.schemas import (
    InventoryCategoryCreate, InventoryItemCreate, InventoryItemUpdate,
    StockBatchCreate, StockMovementCreate, WasteLogCreate, CycleCountCreate,
    StockIntakeCreate, ReceiptConfirmRequest,
)
from backend.auth import get_current_user, check_permission, require_supervisor, PermissionChecker
from backend.audit import log_audit, serialize_model, AuditAction
from backend.logging_config import get_logger

logger = get_logger("app")
router = APIRouter(dependencies=[Depends(PermissionChecker("inventory", "view"))])

RECEIPTS_DIR = UPLOADS_DIR / "receipts"
RECEIPTS_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_RECEIPT_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}


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

    # Price Memory: most recent priced StockBatch per item - Daily Stock
    # Intake and Smart Intake (receipt scan) are the only purchase-history
    # source now that the mess buys directly (no PO flow). One query for
    # the whole page's batches (already fetched above) plus the vendors
    # they reference, instead of a per-item lookup.
    last_batch_by_item = {}
    if item_ids:
        for iid, batches in batches_by_item.items():
            priced = [b for b in batches if b.unit_cost]
            if priced:
                last_batch_by_item[iid] = max(priced, key=lambda b: b.created_at)
    vendors_by_id = {}
    vendor_ids = {b.vendor_id for b in last_batch_by_item.values() if b.vendor_id}
    if vendor_ids:
        vendors_by_id = {v.id: v for v in db.query(Vendor).filter(Vendor.id.in_(vendor_ids)).all()}

    result = []
    for item in items:
        batches = batches_by_item.get(item.id, [])
        total_stock = sum(b.quantity for b in batches)

        is_low = total_stock <= item.reorder_level and item.reorder_level > 0
        if low_stock and not is_low:
            continue

        last_batch = last_batch_by_item.get(item.id)
        if last_batch:
            last_unit_cost = float(last_batch.unit_cost)
            last_vendor = vendors_by_id.get(last_batch.vendor_id) if last_batch.vendor_id else None
            last_purchased_at = last_batch.created_at.strftime("%d-%m-%y") if last_batch.created_at else None
        else:
            last_unit_cost = None
            last_vendor = None
            last_purchased_at = None

        result.append({
            "id": item.id, "sku": item.sku, "name": item.name,
            "category_id": item.category_id, "category_name": item.category.name if item.category else None,
            "description": item.description, "unit": item.unit,
            "reorder_level": item.reorder_level, "reorder_quantity": item.reorder_quantity,
            "is_active": item.is_active, "created_at": item.created_at,
            "total_stock": total_stock,
            "last_unit_cost": last_unit_cost,
            "last_vendor_id": last_vendor.id if last_vendor else None,
            "last_vendor_name": last_vendor.name if last_vendor else None,
            "last_purchased_at": last_purchased_at,
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


# --- Stock Intake (simplified daily procurement) ---

@router.post("/stock-intake")
async def record_stock_intake(
    data: StockIntakeCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    if not check_permission(current_user, "inventory", "create"):
        raise HTTPException(status_code=403, detail="Permission denied")

    item = db.query(InventoryItem).filter(InventoryItem.id == data.item_id, InventoryItem.is_active == True).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    unit_price = round(data.total_cost / data.quantity, 2)

    prev_batch = (
        db.query(StockBatch)
        .filter(StockBatch.item_id == data.item_id, StockBatch.is_active == True)
        .order_by(StockBatch.created_at.desc())
        .first()
    )
    prev_unit_price = float(prev_batch.unit_cost) if prev_batch and prev_batch.unit_cost else None

    vendor = None
    if data.vendor_id:
        vendor = db.query(Vendor).filter(Vendor.id == data.vendor_id, Vendor.is_active == True).first()
        if not vendor:
            raise HTTPException(status_code=404, detail="Vendor not found")

    batch_number = f"SI-{item.id}-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"
    batch = StockBatch(
        item_id=data.item_id,
        batch_number=batch_number,
        quantity=data.quantity,
        unit_cost=unit_price,
        vendor_id=data.vendor_id,
        received_date=date.today(),
    )
    db.add(batch)
    db.flush()

    movement = StockMovement(
        batch_id=batch.id,
        item_id=data.item_id,
        movement_type="receipt",
        quantity=data.quantity,
        reference_type="stock_intake",
        reference_id=batch.id,
        notes=f"Daily intake: {data.quantity} {item.unit} @ Rs {unit_price}/{item.unit}",
        created_by=current_user.id,
    )
    db.add(movement)
    db.commit()
    db.refresh(batch)

    log_audit(
        db, current_user.id, current_user.full_name,
        AuditAction.CREATE, "stock_intake", batch.id,
        after_state={"item_id": data.item_id, "item_name": item.name, "quantity": data.quantity, "total_cost": data.total_cost, "unit_price": unit_price, "vendor_id": data.vendor_id},
        ip_address=request.client.host,
    )

    price_diff = None
    price_diff_pct = None
    if prev_unit_price and prev_unit_price > 0:
        price_diff = round(unit_price - prev_unit_price, 2)
        price_diff_pct = round((price_diff / prev_unit_price) * 100, 1)

    return {
        "batch_id": batch.id,
        "item_id": item.id,
        "item_name": item.name,
        "quantity": data.quantity,
        "unit": item.unit,
        "total_cost": data.total_cost,
        "unit_price": unit_price,
        "prev_unit_price": prev_unit_price,
        "price_diff": price_diff,
        "price_diff_pct": price_diff_pct,
        "vendor_id": vendor.id if vendor else None,
        "vendor_name": vendor.name if vendor else None,
    }


@router.get("/stock-intake/recent")
async def recent_stock_intakes(
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    batches = (
        db.query(StockBatch, InventoryItem)
        .join(InventoryItem, StockBatch.item_id == InventoryItem.id)
        .filter(StockBatch.is_active == True)
        .order_by(StockBatch.created_at.desc())
        .limit(limit)
        .all()
    )
    vendor_ids = {b.vendor_id for b, _ in batches if b.vendor_id}
    vendors_by_id = {v.id: v.name for v in db.query(Vendor).filter(Vendor.id.in_(vendor_ids)).all()} if vendor_ids else {}
    return [
        {
            "id": b.id,
            "item_id": b.item_id,
            "item_name": item.name,
            "quantity": b.quantity,
            "unit": item.unit,
            "unit_cost": float(b.unit_cost) if b.unit_cost else 0,
            "total_cost": round(b.quantity * float(b.unit_cost), 2) if b.unit_cost else 0,
            "vendor_id": b.vendor_id,
            "vendor_name": vendors_by_id.get(b.vendor_id),
            "received_date": b.received_date.isoformat() if b.received_date else None,
            "created_at": b.created_at.isoformat() if b.created_at else None,
        }
        for b, item in batches
    ]


@router.get("/expiring")
async def expiring_batches(
    days: int = Query(3, ge=1, le=90),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Batches expiring within `days` - the same signal check_expiring_items()
    (backend/alerts.py) generates as an Alert, surfaced here directly for the
    Kitchen NCO dashboard (which has no alerts:view) without writing an
    Alert row on every dashboard load."""
    cutoff = date.today() + timedelta(days=days)
    batches = (
        db.query(StockBatch, InventoryItem)
        .join(InventoryItem, StockBatch.item_id == InventoryItem.id)
        .filter(
            StockBatch.expiry_date.isnot(None),
            StockBatch.expiry_date <= cutoff,
            StockBatch.expiry_date >= date.today(),
            StockBatch.is_active == True,
            StockBatch.quantity > 0,
        )
        .order_by(StockBatch.expiry_date.asc())
        .all()
    )
    return [
        {
            "batch_id": b.id, "item_id": b.item_id, "item_name": item.name,
            "quantity": b.quantity, "unit": item.unit,
            "expiry_date": b.expiry_date.isoformat(),
        }
        for b, item in batches
    ]


# --- Dashboard Analytics ---

@router.get("/dashboard")
async def inventory_dashboard(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    now = datetime.utcnow()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    thirty_days_ago = now - timedelta(days=30)

    # KPI 1: Total procurement this month (sum of batch quantity * unit_cost for batches created this month)
    month_total = (
        db.query(func.coalesce(func.sum(StockBatch.quantity * StockBatch.unit_cost), 0))
        .filter(StockBatch.created_at >= month_start, StockBatch.is_active == True)
        .scalar()
    )

    # KPI 2: Active inventory value (sum of current quantity * last unit cost per item)
    active_batches = (
        db.query(
            StockBatch.item_id,
            func.sum(StockBatch.quantity).label("total_qty"),
        )
        .filter(StockBatch.is_active == True)
        .group_by(StockBatch.item_id)
        .all()
    )
    # Get last unit cost per item
    item_ids_with_stock = [r.item_id for r in active_batches]
    qty_by_item = {r.item_id: r.total_qty for r in active_batches}
    last_cost_by_item = {}
    if item_ids_with_stock:
        for iid in item_ids_with_stock:
            last_b = (
                db.query(StockBatch.unit_cost)
                .filter(StockBatch.item_id == iid, StockBatch.is_active == True, StockBatch.unit_cost > 0)
                .order_by(StockBatch.created_at.desc())
                .first()
            )
            if last_b:
                last_cost_by_item[iid] = float(last_b.unit_cost)

    inventory_value = sum(
        qty_by_item.get(iid, 0) * last_cost_by_item.get(iid, 0)
        for iid in item_ids_with_stock
    )

    # KPI 3: Low stock count
    items_all = db.query(InventoryItem).filter(InventoryItem.is_active == True).all()
    low_stock_count = 0
    for it in items_all:
        if it.reorder_level and it.reorder_level > 0:
            total_q = qty_by_item.get(it.id, 0)
            if total_q <= it.reorder_level:
                low_stock_count += 1

    # KPI 4: Top cost driver (item with highest total spend in last 30 days)
    top_cost_rows = (
        db.query(
            StockBatch.item_id,
            func.sum(StockBatch.quantity * StockBatch.unit_cost).label("total_spend"),
        )
        .filter(StockBatch.created_at >= thirty_days_ago, StockBatch.is_active == True)
        .group_by(StockBatch.item_id)
        .order_by(func.sum(StockBatch.quantity * StockBatch.unit_cost).desc())
        .first()
    )
    top_cost_driver = None
    if top_cost_rows and top_cost_rows.total_spend:
        item_obj = db.query(InventoryItem).filter(InventoryItem.id == top_cost_rows.item_id).first()
        if item_obj:
            top_cost_driver = {"item_name": item_obj.name, "total_spend": round(float(top_cost_rows.total_spend), 2)}

    # Procurement frequency (last 30 days): how many intake events per item
    freq_rows = (
        db.query(
            StockBatch.item_id,
            InventoryItem.name,
            func.count(StockBatch.id).label("intake_count"),
        )
        .join(InventoryItem, StockBatch.item_id == InventoryItem.id)
        .filter(StockBatch.created_at >= thirty_days_ago, StockBatch.is_active == True)
        .group_by(StockBatch.item_id, InventoryItem.name)
        .order_by(func.count(StockBatch.id).desc())
        .limit(10)
        .all()
    )
    procurement_frequency = [
        {"item_id": r.item_id, "item_name": r.name, "intake_count": r.intake_count}
        for r in freq_rows
    ]

    # Top costing products (last 30 days): ranked by total spend, same
    # underlying figure as top_cost_driver above but the full top-10 list
    # instead of just the single highest item - the "which products actually
    # drive the procurement bill" counterpart to procurement_frequency's
    # "which products get bought most often" (a cheap, frequently-bought item
    # and an expensive, rarely-bought one can both rank highly here for very
    # different reasons, which is exactly why both views are shown).
    cost_rows = (
        db.query(
            StockBatch.item_id,
            InventoryItem.name,
            func.sum(StockBatch.quantity * StockBatch.unit_cost).label("total_spend"),
        )
        .join(InventoryItem, StockBatch.item_id == InventoryItem.id)
        .filter(StockBatch.created_at >= thirty_days_ago, StockBatch.is_active == True)
        .group_by(StockBatch.item_id, InventoryItem.name)
        .order_by(func.sum(StockBatch.quantity * StockBatch.unit_cost).desc())
        .limit(10)
        .all()
    )
    top_costing_products = [
        {"item_id": r.item_id, "item_name": r.name, "total_spend": round(float(r.total_spend or 0), 2)}
        for r in cost_rows
    ]

    return {
        "month_total": round(float(month_total), 2),
        "inventory_value": round(inventory_value, 2),
        "low_stock_count": low_stock_count,
        "top_cost_driver": top_cost_driver,
        "procurement_frequency": procurement_frequency,
        "top_costing_products": top_costing_products,
    }


@router.get("/price-history/{item_id}")
async def item_price_history(
    item_id: int,
    days: int = Query(90, ge=7, le=365),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    since = datetime.utcnow() - timedelta(days=days)
    batches = (
        db.query(StockBatch)
        .filter(
            StockBatch.item_id == item_id,
            StockBatch.is_active == True,
            StockBatch.unit_cost > 0,
            StockBatch.created_at >= since,
        )
        .order_by(StockBatch.created_at.asc())
        .all()
    )
    item = db.query(InventoryItem).filter(InventoryItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    prices = [float(b.unit_cost) for b in batches if b.unit_cost]
    volatility_pct = None
    if len(prices) >= 2:
        min_p, max_p = min(prices), max(prices)
        avg_p = sum(prices) / len(prices)
        if avg_p > 0:
            volatility_pct = round(((max_p - min_p) / avg_p) * 100, 1)

    return {
        "item_id": item_id,
        "item_name": item.name,
        "unit": item.unit,
        "volatility_pct": volatility_pct,
        "history": [
            {
                "date": b.created_at.strftime("%Y-%m-%d") if b.created_at else None,
                "unit_price": float(b.unit_cost) if b.unit_cost else 0,
                "quantity": b.quantity,
            }
            for b in batches
        ],
    }


# --- Smart Intake: receipt scanning (OCR + staged review) ---
#
# A photographed receipt is never parsed 100% reliably - faint print, tilt,
# odd vendor abbreviations. So this is a two-step flow: /receipts/parse
# returns the model's best guess per line tagged with a status (matched /
# unmapped / illegible) for the frontend's staging grid, and the clerk's
# corrected version of that list is what actually gets written to stock via
# /receipts/confirm. Nothing here touches StockBatch/StockMovement until
# confirm - parsing alone has no side effects on inventory.

@router.post("/receipts/parse")
async def parse_receipt(
    request: Request,
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    if not check_permission(current_user, "inventory", "create"):
        raise HTTPException(status_code=403, detail="Permission denied")
    if not files:
        raise HTTPException(status_code=400, detail="Upload at least one receipt photo")

    from backend.services import receipt_ocr

    batch_id = uuid.uuid4().hex
    batch_dir = RECEIPTS_DIR / batch_id
    batch_dir.mkdir(parents=True, exist_ok=True)

    active_items = db.query(InventoryItem).filter(InventoryItem.is_active == True).all()
    item_choices = {item.id: item.name for item in active_items}
    unit_by_item = {item.id: item.unit for item in active_items}

    all_lines = []
    for page_index, file in enumerate(files, start=1):
        ext = ALLOWED_RECEIPT_TYPES.get(file.content_type)
        if not ext:
            raise HTTPException(status_code=400, detail=f"File {file.filename}: only JPEG, PNG, or WEBP images are allowed")
        contents = await file.read()
        if len(contents) > 8 * 1024 * 1024:
            raise HTTPException(status_code=400, detail=f"File {file.filename}: must be under 8MB")

        (batch_dir / f"page-{page_index}.{ext}").write_bytes(contents)

        try:
            image = receipt_ocr.preprocess_image(contents)
        except ValueError:
            continue  # unreadable image - skip rather than fail the whole batch
        ocr_lines = receipt_ocr.extract_lines(image)

        # Narrows to the item block only - header (store name, address,
        # invoice/date) and footer (totals, thank-you) lines are dropped by
        # position, not just keyword match, so they never reach the clerk's
        # staging grid at all.
        item_lines = receipt_ocr.classify_receipt_lines(ocr_lines)

        for entry in item_lines:
            ocr_line, parsed = entry["ocr_line"], entry["parsed"]
            low_confidence = ocr_line["confidence"] < 0.35
            matched_item_id, matched_item_name, score = receipt_ocr.fuzzy_match_item(
                parsed["raw_name"] or "", item_choices
            )

            if low_confidence or parsed["total_cost"] is None or not parsed["raw_name"]:
                status = "illegible"
            elif matched_item_id:
                status = "matched"
            else:
                status = "unmapped"

            all_lines.append({
                "source_page": page_index,
                "raw_text": ocr_line["text"],
                "ocr_confidence": ocr_line["confidence"],
                "raw_name": parsed["raw_name"],
                "quantity": parsed["quantity"],
                "quantity_assumed": parsed["quantity_assumed"],
                "total_cost": parsed["total_cost"],
                "status": status,
                "matched_item_id": matched_item_id,
                "matched_item_name": matched_item_name,
                "matched_unit": unit_by_item.get(matched_item_id) if matched_item_id else None,
                "match_score": score,
            })

    log_audit(
        db, current_user.id, current_user.full_name, AuditAction.CREATE, "receipt_scan", None,
        after_state={"batch_id": batch_id, "pages": len(files), "lines_detected": len(all_lines)},
        ip_address=request.client.host,
    )

    return {
        "batch_id": batch_id,
        "pages": len(files),
        "lines": all_lines,
        "summary": {
            "matched": sum(1 for l in all_lines if l["status"] == "matched"),
            "unmapped": sum(1 for l in all_lines if l["status"] == "unmapped"),
            "illegible": sum(1 for l in all_lines if l["status"] == "illegible"),
        },
    }


@router.post("/receipts/confirm")
async def confirm_receipt(
    data: ReceiptConfirmRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    if not check_permission(current_user, "inventory", "create"):
        raise HTTPException(status_code=403, detail="Permission denied")
    if not data.lines:
        raise HTTPException(status_code=400, detail="No lines to confirm")

    item_ids = {line.item_id for line in data.lines}
    items_by_id = {
        item.id: item
        for item in db.query(InventoryItem).filter(InventoryItem.id.in_(item_ids), InventoryItem.is_active == True).all()
    }
    missing = item_ids - items_by_id.keys()
    if missing:
        raise HTTPException(status_code=404, detail=f"Item(s) not found or inactive: {sorted(missing)}")

    created = []
    for line in data.lines:
        item = items_by_id[line.item_id]
        unit_price = round(line.total_cost / line.quantity, 2)
        batch = StockBatch(
            item_id=line.item_id,
            batch_number=f"SI-{item.id}-{datetime.utcnow().strftime('%Y%m%d%H%M%S%f')}",
            quantity=line.quantity,
            unit_cost=unit_price,
            received_date=date.today(),
        )
        db.add(batch)
        db.flush()

        db.add(StockMovement(
            batch_id=batch.id, item_id=line.item_id, movement_type="receipt",
            quantity=line.quantity,
            reference_type="receipt_scan", reference_id=batch.id,
            notes=f"Smart intake: {line.quantity} {item.unit} @ Rs {unit_price}/{item.unit}"
                  + (f" (scanned as '{line.raw_name}')" if line.raw_name else ""),
            created_by=current_user.id,
        ))
        created.append({
            "batch_id": batch.id, "item_id": item.id, "item_name": item.name,
            "quantity": line.quantity, "unit": item.unit, "unit_price": unit_price,
            "total_cost": line.total_cost,
        })

    db.commit()

    log_audit(
        db, current_user.id, current_user.full_name, AuditAction.CREATE, "stock_intake_bulk", None,
        after_state={"receipt_batch_id": data.receipt_batch_id, "lines": created},
        ip_address=request.client.host,
    )

    return {"created": created, "total_cost": round(sum(c["total_cost"] for c in created), 2)}
