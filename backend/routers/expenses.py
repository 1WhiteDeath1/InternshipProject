"""Hotel operational expenses router - a standalone log of Clerk-entered
spend (Gas, Electricity, Repairs...), independent of the guest/member
billing pipelines. Gated on the existing clerk_desk permission (Clerk's
money-operations scope) rather than a new RBAC module, since this is
squarely part of that same job."""
import uuid
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile, File
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.config import UPLOADS_DIR
from backend.models import Expense
from backend.schemas import ExpenseCreate
from backend.auth import get_current_user, check_permission
from backend.audit import log_audit, serialize_model, AuditAction

router = APIRouter()

EXPENSE_ATTACHMENTS_DIR = UPLOADS_DIR / "expenses"
EXPENSE_ATTACHMENTS_DIR.mkdir(parents=True, exist_ok=True)
MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024  # 5MB
ALLOWED_ATTACHMENT_TYPES = {"image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf"}


def _expense_out(e: Expense) -> dict:
    return {
        "id": e.id, "name": e.name, "category": e.category, "amount": float(e.amount),
        "expense_date": e.expense_date, "bill_reference_no": e.bill_reference_no, "notes": e.notes,
        "attachment_path": f"/uploads/expenses/{e.attachment_path}" if e.attachment_path else None,
        "attachment_filename": e.attachment_filename,
        "created_by": e.created_by, "created_by_name": e.creator.full_name if e.creator else None,
        "created_at": e.created_at,
    }


@router.get("")
async def list_expenses(
    date_from: str = "", date_to: str = "", category: str = "",
    page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db), current_user=Depends(get_current_user),
):
    if not check_permission(current_user, "clerk_desk", "view"):
        raise HTTPException(status_code=403, detail="Permission denied")
    query = db.query(Expense)
    if date_from:
        query = query.filter(Expense.expense_date >= date_from)
    if date_to:
        query = query.filter(Expense.expense_date <= date_to)
    if category:
        query = query.filter(Expense.category == category)

    total = query.count()
    expenses = query.order_by(Expense.expense_date.desc(), Expense.id.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {"items": [_expense_out(e) for e in expenses], "total": total}


@router.get("/summary")
async def expense_summary(
    date_from: str = Query(...), date_to: str = Query(...),
    db: Session = Depends(get_db), current_user=Depends(get_current_user),
):
    """Per-category totals for a date range, computed server-side - the same
    "never sum a page_size-capped fetch client-side" rule every other list
    endpoint in this app follows."""
    if not check_permission(current_user, "clerk_desk", "view"):
        raise HTTPException(status_code=403, detail="Permission denied")
    from sqlalchemy import func
    rows = db.query(Expense.category, func.sum(Expense.amount), func.count(Expense.id)).filter(
        Expense.expense_date >= date_from, Expense.expense_date <= date_to,
    ).group_by(Expense.category).all()
    items = [{"category": cat, "total": float(total), "count": count} for cat, total, count in rows]
    return {"items": items, "grand_total": sum(i["total"] for i in items)}


@router.post("")
async def create_expense(data: ExpenseCreate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "clerk_desk", "create"):
        raise HTTPException(status_code=403, detail="Permission denied")
    expense = Expense(
        name=data.name.strip(), category=data.category.strip(), amount=data.amount,
        expense_date=data.expense_date, bill_reference_no=(data.bill_reference_no or "").strip() or None,
        notes=data.notes, created_by=current_user.id,
    )
    db.add(expense)
    db.commit()
    db.refresh(expense)
    log_audit(db, current_user.id, current_user.full_name, AuditAction.CREATE, "expenses", expense.id, after_state=serialize_model(expense), ip_address=request.client.host)
    return _expense_out(expense)


@router.post("/{expense_id}/attachment")
async def upload_expense_attachment(expense_id: int, file: UploadFile = File(...), request: Request = None, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """A scanned copy/screenshot of the physical bill, for audit
    verification - PNG/JPG/PDF up to 5MB, same size/type-checking shape as
    Inventory's Smart Intake receipt upload (routers/inventory.py)."""
    if not check_permission(current_user, "clerk_desk", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    expense = db.query(Expense).filter(Expense.id == expense_id).first()
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")
    if file.content_type not in ALLOWED_ATTACHMENT_TYPES:
        raise HTTPException(status_code=400, detail="Only PNG, JPG, or PDF files are allowed")
    content = await file.read()
    if len(content) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(status_code=400, detail="File is too large - the limit is 5MB")

    before = serialize_model(expense)
    ext = ALLOWED_ATTACHMENT_TYPES[file.content_type]
    stored_name = f"{uuid.uuid4().hex}.{ext}"
    (EXPENSE_ATTACHMENTS_DIR / stored_name).write_bytes(content)
    expense.attachment_path = stored_name
    expense.attachment_filename = file.filename
    db.commit()
    db.refresh(expense)
    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "expenses", expense.id,
              before_state=before, after_state=serialize_model(expense), ip_address=request.client.host if request else None)
    return _expense_out(expense)


@router.delete("/{expense_id}")
async def delete_expense(expense_id: int, reason: str, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "clerk_desk", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    expense = db.query(Expense).filter(Expense.id == expense_id).first()
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")
    before = serialize_model(expense)
    db.delete(expense)
    db.commit()
    log_audit(db, current_user.id, current_user.full_name, AuditAction.SOFT_DELETE, "expenses", expense_id, before_state=before, reason=reason, ip_address=request.client.host)
    return {"message": "Expense removed"}
