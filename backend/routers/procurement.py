"""Procurement router - vendors, purchase orders, three-way match."""
import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.models import Vendor, PurchaseOrder, PurchaseOrderItem, InventoryItem, ThreeWayMatch, StockBatch, StockMovement
from backend.schemas import VendorCreate, VendorUpdate, PurchaseOrderCreate, PurchaseOrderUpdate, POItemBase, ReceivingQuantities
from backend.auth import get_current_user, check_permission
from backend.audit import log_audit, serialize_model, AuditAction
from backend.logging_config import get_logger

logger = get_logger("app")
router = APIRouter()


# --- Vendors ---

@router.get("/vendors")
async def list_vendors(search: str = "", page: int = Query(1, ge=1), page_size: int = Query(25, ge=1), db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    query = db.query(Vendor).filter(Vendor.is_active == True)
    if search:
        query = query.filter(Vendor.name.contains(search))
    total = query.count()
    vendors = query.order_by(Vendor.name).offset((page - 1) * page_size).limit(page_size).all()
    return {"items": vendors, "total": total, "page": page, "page_size": page_size}


@router.post("/vendors")
async def create_vendor(data: VendorCreate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "procurement", "create"):
        raise HTTPException(status_code=403, detail="Permission denied")
    v = Vendor(**data.model_dump())
    db.add(v)
    db.commit()
    db.refresh(v)
    log_audit(db, current_user.id, current_user.full_name, AuditAction.CREATE, "vendors", v.id, after_state=serialize_model(v), ip_address=request.client.host)
    return v


@router.put("/vendors/{vendor_id}")
async def update_vendor(vendor_id: int, data: VendorUpdate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "procurement", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    v = db.query(Vendor).filter(Vendor.id == vendor_id).first()
    if not v:
        raise HTTPException(status_code=404, detail="Vendor not found")

    before = serialize_model(v)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(v, field, value)
    db.commit()
    db.refresh(v)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "vendors", v.id, before_state=before, after_state=serialize_model(v), ip_address=request.client.host)
    return v


# --- Purchase Orders ---

@router.get("/purchase-orders")
async def list_pos(status: str = "", page: int = Query(1, ge=1), page_size: int = Query(25, ge=1), db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    query = db.query(PurchaseOrder)
    if status:
        query = query.filter(PurchaseOrder.status == status)
    total = query.count()
    pos = query.order_by(PurchaseOrder.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {"items": [
        {"id": p.id, "po_number": p.po_number, "vendor_id": p.vendor_id,
         "vendor_name": p.vendor.name if p.vendor else None, "status": p.status.value,
         "total_amount": float(p.total_amount) if p.total_amount else 0,
         "expected_delivery": p.expected_delivery, "created_at": p.created_at,
         "items": [{"id": i.id, "item_id": i.item_id, "item_name": i.inventory_item.name if i.inventory_item else None,
                    "quantity_ordered": i.quantity_ordered, "quantity_delivered": i.quantity_delivered,
                    "quantity_received": i.quantity_received, "unit_price": float(i.unit_price),
                    "total_price": float(i.total_price)} for i in p.items]} for p in pos], "total": total}


@router.post("/purchase-orders")
async def create_po(data: PurchaseOrderCreate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "procurement", "create"):
        raise HTTPException(status_code=403, detail="Permission denied")

    total = sum(i.quantity_ordered * i.unit_price for i in data.items)
    po = PurchaseOrder(
        po_number=f"TMP-{uuid.uuid4().hex}", vendor_id=data.vendor_id, expected_delivery=data.expected_delivery,
        notes=data.notes, total_amount=total, created_by=current_user.id,
    )
    db.add(po)
    db.commit()
    db.refresh(po)

    # Friendly number derived from the autoincrement id (assigned by the DB above),
    # not a pre-insert count() - avoids a race where two concurrent creates read the
    # same count and generate the same number.
    po.po_number = f"PO-{datetime.utcnow().strftime('%Y%m%d')}-{po.id:04d}"
    db.commit()
    db.refresh(po)

    for item in data.items:
        poi = PurchaseOrderItem(
            po_id=po.id, item_id=item.item_id, quantity_ordered=item.quantity_ordered,
            unit_price=item.unit_price, total_price=item.quantity_ordered * item.unit_price,
        )
        db.add(poi)
    db.commit()

    log_audit(db, current_user.id, current_user.full_name, AuditAction.CREATE, "purchase_orders", po.id, after_state=serialize_model(po), ip_address=request.client.host)
    return {"id": po.id, "po_number": po.po_number, "status": po.status.value, "total_amount": total}


@router.put("/purchase-orders/{po_id}")
async def update_po(po_id: int, data: PurchaseOrderUpdate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "procurement", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    po = db.query(PurchaseOrder).filter(PurchaseOrder.id == po_id).first()
    if not po:
        raise HTTPException(status_code=404, detail="PO not found")

    before = serialize_model(po)
    if data.status:
        po.status = data.status
    if data.expected_delivery:
        po.expected_delivery = data.expected_delivery
    if data.notes is not None:
        po.notes = data.notes
    db.commit()
    db.refresh(po)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "purchase_orders", po.id, before_state=before, after_state=serialize_model(po), ip_address=request.client.host)
    return po


@router.post("/purchase-orders/{po_id}/approve")
async def approve_po(po_id: int, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "procurement", "approve"):
        raise HTTPException(status_code=403, detail="Permission denied")
    po = db.query(PurchaseOrder).filter(PurchaseOrder.id == po_id).first()
    if not po:
        raise HTTPException(status_code=404, detail="PO not found")

    before = serialize_model(po)
    po.status = "approved"
    po.approved_by = current_user.id
    po.approved_at = datetime.utcnow()
    db.commit()

    log_audit(db, current_user.id, current_user.full_name, AuditAction.APPROVE, "purchase_orders", po.id, before_state=before, after_state=serialize_model(po), ip_address=request.client.host)
    return {"message": "PO approved"}


@router.post("/purchase-orders/{po_id}/receive")
async def receive_po(po_id: int, data: ReceivingQuantities, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "procurement", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    po = db.query(PurchaseOrder).filter(PurchaseOrder.id == po_id).first()
    if not po:
        raise HTTPException(status_code=404, detail="PO not found")

    valid_item_ids = {item.id for item in po.items}
    quantities = {}
    for entry in data.items:
        if entry.po_item_id not in valid_item_ids:
            raise HTTPException(status_code=400, detail=f"Item {entry.po_item_id} does not belong to this PO")
        quantities[entry.po_item_id] = entry.quantity

    before = {item.id: item.quantity_delivered for item in po.items}
    for item in po.items:
        item.quantity_delivered = quantities.get(item.id, item.quantity_delivered)

    po.status = "delivery_expected"
    db.commit()

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "purchase_orders", po.id,
              before_state={"quantity_delivered": before}, after_state={"quantity_delivered": quantities},
              reason="Delivery quantities recorded", ip_address=request.client.host)
    return {"message": "Delivery recorded"}


@router.post("/purchase-orders/{po_id}/confirm-receipt")
async def confirm_receipt(po_id: int, data: ReceivingQuantities, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    po = db.query(PurchaseOrder).filter(PurchaseOrder.id == po_id).first()
    if not po:
        raise HTTPException(status_code=404, detail="PO not found")

    valid_item_ids = {item.id for item in po.items}
    for entry in data.items:
        if entry.po_item_id not in valid_item_ids:
            raise HTTPException(status_code=400, detail=f"Item {entry.po_item_id} does not belong to this PO")
    received_quantities = {entry.po_item_id: entry.quantity for entry in data.items}

    for item in po.items:
        received = received_quantities.get(item.id, 0)
        item.quantity_received = received

        # Create stock batch for received items
        if received > 0:
            inv_item = db.query(InventoryItem).filter(InventoryItem.id == item.item_id).first()
            batch = StockBatch(
                item_id=item.item_id,
                batch_number=f"{po.po_number}-I{item.id}",
                quantity=received,
                zone="warehouse",
                unit_cost=item.unit_price,
            )
            db.add(batch)
            db.commit()
            db.refresh(batch)

            movement = StockMovement(
                batch_id=batch.id, item_id=item.item_id, movement_type="receipt",
                quantity=received, to_zone="warehouse",
                reference_type="purchase_order", reference_id=po.id,
                notes=f"Receipt from PO {po.po_number}", created_by=current_user.id,
            )
            db.add(movement)

    # Three-way match
    for item in po.items:
        variance = abs(item.quantity_ordered - item.quantity_received)
        twm = ThreeWayMatch(
            po_id=po.id, po_quantity=item.quantity_ordered,
            delivery_quantity=item.quantity_delivered,
            received_quantity=item.quantity_received,
            variance=variance, tolerance_percent=5.0,
            is_matched=(variance <= item.quantity_ordered * 0.05),
        )
        if not twm.is_matched:
            twm.discrepancy_reason = f"Variance of {variance} exceeds 5% tolerance"
        db.add(twm)

    po.status = "received"
    db.commit()

    # Update vendor accuracy
    vendor_pos = db.query(PurchaseOrder).filter(PurchaseOrder.vendor_id == po.vendor_id, PurchaseOrder.status == "received").count()
    matched_pos = db.query(ThreeWayMatch).join(PurchaseOrder).filter(
        PurchaseOrder.vendor_id == po.vendor_id, ThreeWayMatch.is_matched == True
    ).count()
    total_matches = db.query(ThreeWayMatch).join(PurchaseOrder).filter(PurchaseOrder.vendor_id == po.vendor_id).count()
    if total_matches > 0:
        po.vendor.delivery_accuracy = round(matched_pos / total_matches * 100, 1)
        db.commit()

    log_audit(db, current_user.id, current_user.full_name, AuditAction.TRANSFER, "purchase_orders", po.id, reason="Receipt confirmed and stock updated", ip_address=request.client.host)
    return {"message": "Receipt confirmed, stock updated"}


# --- Three-way match ---

@router.get("/three-way-matches")
async def list_twm(page: int = Query(1, ge=1), page_size: int = Query(25, ge=1), db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    total = db.query(ThreeWayMatch).count()
    matches = db.query(ThreeWayMatch).order_by(ThreeWayMatch.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {"items": matches, "total": total}
