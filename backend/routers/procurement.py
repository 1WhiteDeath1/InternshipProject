"""Procurement router - vendors, the lookup list used by self-purchase
stock intake (see routers/inventory.py's /stock-intake). No purchase-order
workflow: the mess buys and restocks itself, there's no external vendor
fulfilling an order against a PO."""
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.models import Vendor
from backend.schemas import VendorCreate, VendorUpdate
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
