"""Excel import/export router."""
import io
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from openpyxl import Workbook, load_workbook
from backend.database import get_db
from backend.models import (
    InventoryItem, InventoryCategory, Vendor, Room,
    Booking, StockBatch,
)
from backend.auth import get_current_user, check_permission
from backend.audit import log_audit, AuditAction
from backend.logging_config import get_logger

logger = get_logger("app")
router = APIRouter()


TEMPLATES = {
    "inventory": ["sku", "name", "category", "unit", "reorder_level", "reorder_quantity"],
    "vendors": ["name", "contact_person", "phone", "email", "address", "tax_id", "payment_terms"],
    "rooms": ["room_number", "room_type", "floor", "capacity", "base_price", "amenities"],
    "bookings": ["guest_name", "guest_phone", "guest_email", "room_number", "check_in", "check_out", "adults", "children"],
    "opening_stock": ["sku", "batch_number", "quantity", "bin_location", "expiry_date", "unit_cost"],
}


@router.get("/template/{module}")
async def get_template(module: str, current_user=Depends(get_current_user)):
    if module not in TEMPLATES:
        raise HTTPException(status_code=400, detail="Unknown module")

    wb = Workbook()
    ws = wb.active
    ws.title = "Template"
    ws.append(TEMPLATES[module])
    ws.append(["Example"] * len(TEMPLATES[module]))

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                            headers={"Content-Disposition": f"attachment; filename={module}_template.xlsx"})


@router.post("/import/{module}")
async def import_data(module: str, file: UploadFile = File(...), request: Request = None, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, module, "create"):
        raise HTTPException(status_code=403, detail="Permission denied")
    if module not in TEMPLATES:
        raise HTTPException(status_code=400, detail="Unknown module")

    content = await file.read()
    wb = load_workbook(filename=io.BytesIO(content))
    ws = wb.active

    headers = [cell.value for cell in ws[1]]
    errors = []
    imported = 0

    for idx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        try:
            data = dict(zip(headers, row))
            if module == "inventory":
                cat = db.query(InventoryCategory).filter(InventoryCategory.name == data.get("category", "General")).first()
                if not cat:
                    cat = InventoryCategory(name=data.get("category", "General"))
                    db.add(cat)
                    db.commit()
                    db.refresh(cat)
                if not db.query(InventoryItem).filter(InventoryItem.sku == data["sku"]).first():
                    item = InventoryItem(sku=data["sku"], name=data["name"], category_id=cat.id, unit=data.get("unit", "pcs"),
                                        reorder_level=float(data.get("reorder_level", 0) or 0), reorder_quantity=float(data.get("reorder_quantity", 0) or 0))
                    db.add(item)
                    imported += 1
            elif module == "vendors":
                if not db.query(Vendor).filter(Vendor.name == data["name"]).first():
                    v = Vendor(**{k: v for k, v in data.items() if v})
                    db.add(v)
                    imported += 1
            elif module == "rooms":
                if not db.query(Room).filter(Room.room_number == data["room_number"]).first():
                    r = Room(room_number=data["room_number"], room_type=data.get("room_type", "single"), floor=int(data.get("floor", 1)),
                            capacity=int(data.get("capacity", 2)), base_price=float(data["base_price"]), amenities=data.get("amenities"))
                    db.add(r)
                    imported += 1
        except Exception as e:
            errors.append(f"Row {idx}: {str(e)}")

    db.commit()
    log_audit(db, current_user.id, current_user.full_name, AuditAction.IMPORT, module, reason=f"Imported {imported} rows", after_state={"imported": imported, "errors": len(errors)})
    return {"imported": imported, "errors": len(errors), "error_details": errors[:10]}


@router.get("/export/{module}")
async def export_data(module: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, module, "view"):
        raise HTTPException(status_code=403, detail="Permission denied")
    wb = Workbook()
    ws = wb.active

    if module == "inventory":
        ws.append(["ID", "SKU", "Name", "Category", "Unit", "Reorder Level", "Reorder Qty", "Total Stock"])
        items = db.query(InventoryItem).filter(InventoryItem.is_active == True).all()
        for item in items:
            batches = db.query(StockBatch).filter(StockBatch.item_id == item.id, StockBatch.is_active == True).all()
            total = sum(b.quantity for b in batches)
            ws.append([item.id, item.sku, item.name, item.category.name if item.category else "", item.unit, item.reorder_level, item.reorder_quantity, total])
    elif module == "bookings":
        ws.append(["ID", "Reference", "Guest", "Phone", "Room", "Check In", "Check Out", "Status", "Total"])
        bookings = db.query(Booking).order_by(Booking.created_at.desc()).limit(1000).all()
        for b in bookings:
            ws.append([b.id, b.booking_reference, b.guest_name, b.guest_phone, b.room.room_number if b.room else "", b.check_in, b.check_out, b.status.value, float(b.total_amount) if b.total_amount else ""])
    elif module == "vendors":
        ws.append(["ID", "Name", "Contact", "Phone", "Email", "Address", "Tax ID"])
        vendors = db.query(Vendor).filter(Vendor.is_active == True).all()
        for v in vendors:
            ws.append([v.id, v.name, v.contact_person, v.phone, v.email, v.address, v.tax_id])
    elif module == "audit":
        from sqlalchemy import desc
        from backend.models import AuditLog
        ws.append(["ID", "User", "Action", "Entity", "Entity ID", "Reason", "Department", "Timestamp", "IP"])
        logs = db.query(AuditLog).order_by(desc(AuditLog.timestamp)).limit(5000).all()
        for l in logs:
            ws.append([l.id, l.user_name, l.action.value if l.action else "", l.entity_type, l.entity_id, l.reason, l.department, l.timestamp, l.ip_address])
    else:
        raise HTTPException(status_code=400, detail="Export module not supported")

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                            headers={"Content-Disposition": f"attachment; filename={module}_export_{datetime.utcnow().strftime('%Y%m%d_%H%M')}.xlsx"})
