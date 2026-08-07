"""Member/officer roster management router."""
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.models import Member, MemberStatus, Booking
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
    if not check_permission(current_user, "members", "view"):
        raise HTTPException(status_code=403, detail="Permission denied")
    query = db.query(Member)
    # Booking NCO's Members view is HRA-only - Kitchen NCO/Manager see the
    # full roster (they classify dining vs non-dining, which applies to
    # everyone, HRA or not).
    if current_user.role and current_user.role.name == "Booking NCO":
        query = query.filter(Member.is_hra == True)
    if status:
        query = query.filter(Member.status == status)
    if mess_category:
        query = query.filter(Member.mess_category == mess_category)
    if search:
        query = query.filter((Member.full_name.contains(search)) | (Member.service_number.contains(search)))

    total = query.count()
    members = query.order_by(Member.full_name).offset((page - 1) * page_size).limit(page_size).all()

    # Current room is derived from each member's active HRA booking, not
    # stored on Member - same "derive occupancy, don't cache it" rule the
    # bookings module follows everywhere else, so it can never go stale.
    member_ids = [m.id for m in members]
    current_rooms = {}
    if member_ids:
        hra_bookings = db.query(Booking).filter(
            Booking.member_id.in_(member_ids), Booking.nature_of_duty == "hra", Booking.status == "checked_in",
        ).order_by(Booking.check_in.desc()).all()
        for b in hra_bookings:
            current_rooms.setdefault(b.member_id, b)

    return {"items": [
        {"id": m.id, "service_number": m.service_number, "full_name": m.full_name,
         "rank": m.rank, "unit": m.unit, "mess_category": m.mess_category.value,
         "client_category": m.client_category.value, "is_womens_bloc": bool(m.is_womens_bloc),
         "dining_status": (m.dining_status.value if m.dining_status else "dining"),
         "is_hra": bool(m.is_hra), "hra_stay_type": m.hra_stay_type, "dorm_location": m.dorm_location,
         "custom_discount_rate": float(m.custom_discount_rate or 0),
         "phone": m.phone, "email": m.email, "status": m.status.value,
         "current_room_id": current_rooms[m.id].room_id if m.id in current_rooms else None,
         "current_room_number": current_rooms[m.id].room.room_number if m.id in current_rooms else None,
         "created_at": m.created_at, "updated_at": m.updated_at} for m in members], "total": total, "page": page, "page_size": page_size}


@router.get("/{member_id}")
async def get_member(member_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "members", "view"):
        raise HTTPException(status_code=403, detail="Permission denied")
    member = db.query(Member).filter(Member.id == member_id).first()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    current_hra = db.query(Booking).filter(
        Booking.member_id == member.id, Booking.nature_of_duty == "hra", Booking.status == "checked_in",
    ).order_by(Booking.check_in.desc()).first()
    return {
        "id": member.id, "service_number": member.service_number, "full_name": member.full_name,
        "rank": member.rank, "unit": member.unit, "mess_category": member.mess_category.value,
        "client_category": member.client_category.value, "is_womens_bloc": bool(member.is_womens_bloc),
        "dining_status": (member.dining_status.value if member.dining_status else "dining"),
        "is_hra": bool(member.is_hra), "hra_stay_type": member.hra_stay_type, "dorm_location": member.dorm_location,
        "custom_discount_rate": float(member.custom_discount_rate or 0),
        "phone": member.phone, "email": member.email, "status": member.status.value,
        "current_room_id": current_hra.room_id if current_hra else None,
        "current_room_number": current_hra.room.room_number if current_hra else None,
        "created_at": member.created_at, "updated_at": member.updated_at,
    }


@router.get("/{member_id}/residencies")
async def get_member_residencies(member_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """HRA booking history for the Room Allocation tab of the Member Ledger
    Portal - current and past residencies, most recent first. Read-only."""
    if not check_permission(current_user, "members", "view"):
        raise HTTPException(status_code=403, detail="Permission denied")
    if not db.query(Member).filter(Member.id == member_id).first():
        raise HTTPException(status_code=404, detail="Member not found")
    bookings = db.query(Booking).filter(
        Booking.member_id == member_id, Booking.nature_of_duty == "hra",
    ).order_by(Booking.check_in.desc()).all()
    return [{
        "id": b.id, "room_id": b.room_id, "room_number": b.room.room_number if b.room else None,
        "room_type": getattr(b.room.room_type, "value", b.room.room_type) if b.room else None,
        "check_in": b.check_in, "check_out": b.check_out, "status": b.status.value,
    } for b in bookings]


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

    updates = data.model_dump(exclude_unset=True)
    # Merge onto the current row's values (not just what's in this partial
    # payload) so cross-field HRA validation sees the real resulting state -
    # e.g. an update that only sends is_hra=False must still know the
    # member's existing hra_stay_type/dorm_location to validate correctly.
    next_is_hra = updates.get("is_hra", member.is_hra)
    next_stay_type = updates.get("hra_stay_type", member.hra_stay_type)
    next_dorm = updates.get("dorm_location", member.dorm_location)

    if next_is_hra and not next_stay_type:
        raise HTTPException(status_code=422, detail="hra_stay_type is required when is_hra is true")
    if next_is_hra and next_stay_type == "out_of_mess" and not (next_dorm or "").strip():
        raise HTTPException(status_code=422, detail="dorm_location is required for an out-of-mess HRA member")
    if not next_is_hra or next_stay_type == "in_mess":
        updates["dorm_location"] = None
    if not next_is_hra:
        updates["hra_stay_type"] = None

    # A member with an active HRA booking can't be silently un-HRA'd or
    # switched to out-of-mess - that would leave a real room occupancy
    # orphaned with no member record backing it. Check them out via Bookings
    # first (mirrors how Members can't be hard-deleted, only status-changed).
    was_dropping_in_mess_residency = member.is_hra and member.hra_stay_type == "in_mess" and not (next_is_hra and next_stay_type == "in_mess")
    if was_dropping_in_mess_residency:
        active_hra_booking = db.query(Booking).filter(
            Booking.member_id == member.id, Booking.nature_of_duty == "hra", Booking.status == "checked_in",
        ).first()
        if active_hra_booking:
            raise HTTPException(status_code=400, detail=f"{member.full_name} currently occupies room {active_hra_booking.room.room_number if active_hra_booking.room else active_hra_booking.room_id} - check them out via Bookings before changing their HRA status")

    before = serialize_model(member)
    for field, value in updates.items():
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
