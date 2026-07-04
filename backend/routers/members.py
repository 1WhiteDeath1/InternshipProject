"""Member/officer roster management router."""
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.models import Member, MemberStatus
from backend.schemas import MemberCreate, MemberUpdate, MemberStatusChange
from backend.auth import get_current_user, check_permission
from backend.audit import log_audit, serialize_model, AuditAction
from backend.logging_config import get_logger

logger = get_logger("app")
router = APIRouter()


@router.get("")
async def list_members(
    status: str = "", mess_category: str = "", search: str = "",
    page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db), current_user=Depends(get_current_user),
):
    query = db.query(Member)
    if status:
        query = query.filter(Member.status == status)
    if mess_category:
        query = query.filter(Member.mess_category == mess_category)
    if search:
        query = query.filter((Member.full_name.contains(search)) | (Member.service_number.contains(search)))

    total = query.count()
    members = query.order_by(Member.full_name).offset((page - 1) * page_size).limit(page_size).all()

    return {"items": [
        {"id": m.id, "service_number": m.service_number, "full_name": m.full_name,
         "rank": m.rank, "unit": m.unit, "mess_category": m.mess_category.value,
         "client_category": m.client_category.value, "custom_discount_rate": float(m.custom_discount_rate or 0),
         "phone": m.phone, "email": m.email, "status": m.status.value,
         "created_at": m.created_at, "updated_at": m.updated_at} for m in members], "total": total, "page": page, "page_size": page_size}


@router.post("")
async def create_member(data: MemberCreate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "members", "create"):
        raise HTTPException(status_code=403, detail="Permission denied")
    if db.query(Member).filter(Member.service_number == data.service_number).first():
        raise HTTPException(status_code=409, detail="Service number already exists")

    member = Member(**data.model_dump())
    db.add(member)
    db.commit()
    db.refresh(member)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.CREATE, "members", member.id, after_state=serialize_model(member), ip_address=request.client.host)
    return member


@router.put("/{member_id}")
async def update_member(member_id: int, data: MemberUpdate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "members", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    member = db.query(Member).filter(Member.id == member_id).first()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    before = serialize_model(member)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(member, field, value)
    db.commit()
    db.refresh(member)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "members", member.id, before_state=before, after_state=serialize_model(member), ip_address=request.client.host)
    return member


@router.post("/{member_id}/status")
async def change_member_status(member_id: int, data: MemberStatusChange, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "members", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    member = db.query(Member).filter(Member.id == member_id).first()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    if data.status not in (MemberStatus.ACTIVE.value, MemberStatus.TRANSFERRED.value, MemberStatus.LEFT.value):
        raise HTTPException(status_code=400, detail="Invalid status")

    before = serialize_model(member)
    member.status = data.status
    db.commit()
    db.refresh(member)

    action = AuditAction.TRANSFER if data.status == MemberStatus.TRANSFERRED.value else AuditAction.UPDATE
    log_audit(db, current_user.id, current_user.full_name, action, "members", member.id, before_state=before, after_state=serialize_model(member), reason=data.reason, ip_address=request.client.host)
    return member
