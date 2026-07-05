"""Meal attendance/booking and member-leave router."""
from datetime import datetime, date, time, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.models import (
    MealAttendance, MemberLeave, Member, MemberStatus, Booking, AttendanceStatus, LeaveStatus,
)
from backend.schemas import (
    MealAttendanceCreate, AttendanceMarkRequest, BulkAttendanceCreate, MemberLeaveCreate,
    RosterSetRequest,
)
from backend.auth import get_current_user, check_permission
from backend.audit import log_audit, serialize_model, AuditAction
from backend.logging_config import get_logger
from backend.services.mess_billing_calc import get_man_days, get_setting_float

logger = get_logger("app")
router = APIRouter()

# Fixed meal times for Tier 1 - not per-mess-configurable (only the cutoff
# window before these times is configurable, via the meal_booking_cutoff_minutes setting).
MEAL_TIMES = {
    "breakfast": time(7, 0),
    "lunch": time(13, 0),
    "hitea": time(16, 30),
    "dinner": time(20, 0),
}


def _is_past_cutoff(db: Session, meal_date: date, meal_type: str) -> bool:
    meal_time = MEAL_TIMES.get(meal_type)
    if not meal_time:
        return False
    cutoff_minutes = get_setting_float(db, "meal_booking_cutoff_minutes", 120)
    cutoff = datetime.combine(meal_date, meal_time) - timedelta(minutes=cutoff_minutes)
    return datetime.utcnow() > cutoff


def _has_active_leave(db: Session, member_id: int, on_date: date) -> bool:
    return db.query(MemberLeave).filter(
        MemberLeave.member_id == member_id,
        MemberLeave.status == LeaveStatus.ACTIVE,
        MemberLeave.start_date <= on_date,
        MemberLeave.end_date >= on_date,
    ).first() is not None


def _create_attendance(db: Session, member_id: int | None, booking_id: int | None, meal_date: date, meal_type: str, method: str, recipe_id: int | None = None) -> MealAttendance:
    # Guests (booking_id set, member_id None) have no MemberLeave concept - only
    # check for an active leave when this is a member-based row.
    status = AttendanceStatus.BOOKED
    if member_id and _has_active_leave(db, member_id, meal_date):
        status = AttendanceStatus.EXCLUDED
    record = MealAttendance(member_id=member_id, booking_id=booking_id, recipe_id=recipe_id, date=meal_date, meal_type=meal_type, method=method, status=status)
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


# --- Attendance ---

@router.get("")
async def list_attendance(
    date_: str = Query("", alias="date"), date_from: str = "", date_to: str = "",
    meal_type: str = "", member_id: int = 0, booking_id: int = 0, status: str = "",
    page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db), current_user=Depends(get_current_user),
):
    query = db.query(MealAttendance)
    if date_:
        query = query.filter(MealAttendance.date == date_)
    if date_from:
        query = query.filter(MealAttendance.date >= date_from)
    if date_to:
        query = query.filter(MealAttendance.date <= date_to)
    if meal_type:
        query = query.filter(MealAttendance.meal_type == meal_type)
    if member_id:
        query = query.filter(MealAttendance.member_id == member_id)
    if booking_id:
        query = query.filter(MealAttendance.booking_id == booking_id)
    if status:
        query = query.filter(MealAttendance.status == status)

    total = query.count()
    records = query.order_by(MealAttendance.date.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {"items": [
        {"id": r.id, "member_id": r.member_id, "member_name": r.member.full_name if r.member else None,
         "booking_id": r.booking_id, "guest_name": r.booking.guest_name if r.booking else None,
         "recipe_id": r.recipe_id, "recipe_name": r.recipe.name if r.recipe else None,
         "date": r.date, "meal_type": r.meal_type.value, "status": r.status.value, "method": r.method,
         "booked_at": r.booked_at, "marked_at": r.marked_at, "marked_by": r.marked_by} for r in records], "total": total}


@router.post("")
async def book_attendance(data: MealAttendanceCreate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "attendance", "create"):
        raise HTTPException(status_code=403, detail="Permission denied")
    if data.member_id and not db.query(Member).filter(Member.id == data.member_id).first():
        raise HTTPException(status_code=404, detail="Member not found")
    if data.booking_id:
        booking = db.query(Booking).filter(Booking.id == data.booking_id).first()
        if not booking:
            raise HTTPException(status_code=404, detail="Booking not found")
        if booking.status.value != "checked_in":
            raise HTTPException(status_code=400, detail="Guest must be checked in to record a meal")
    if _is_past_cutoff(db, data.date, data.meal_type):
        raise HTTPException(status_code=400, detail="Booking window closed for this meal")

    try:
        record = _create_attendance(db, data.member_id, data.booking_id, data.date, data.meal_type, data.method, data.recipe_id)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="This member/guest already has a booking for that meal/date")

    log_audit(db, current_user.id, current_user.full_name, AuditAction.CREATE, "meal_attendance", record.id, after_state=serialize_model(record), ip_address=request.client.host)
    return record


@router.post("/bulk")
async def bulk_book_attendance(data: BulkAttendanceCreate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "attendance", "create"):
        raise HTTPException(status_code=403, detail="Permission denied")
    if _is_past_cutoff(db, data.date, data.meal_type):
        raise HTTPException(status_code=400, detail="Booking window closed for this meal")

    succeeded, failed = [], []
    for member_id in data.member_ids:
        if not db.query(Member).filter(Member.id == member_id).first():
            failed.append({"member_id": member_id, "error": "Member not found"})
            continue
        try:
            record = _create_attendance(db, member_id, None, data.date, data.meal_type, data.method)
            succeeded.append(record.id)
        except IntegrityError:
            db.rollback()
            failed.append({"member_id": member_id, "error": "Already booked for this meal/date"})

    log_audit(db, current_user.id, current_user.full_name, AuditAction.CREATE, "meal_attendance", None,
              after_state={"count": len(succeeded), "date": str(data.date), "meal_type": data.meal_type}, ip_address=request.client.host)
    return {"booked": succeeded, "failed": failed}


# --- Roster (single-tap present/absent grid) ---

@router.get("/roster")
async def get_roster(
    date_: str = Query(..., alias="date"), meal_type: str = Query(...),
    db: Session = Depends(get_db), current_user=Depends(get_current_user),
):
    """Every active member with their present/absent/on_leave state for one
    meal, plus any guest rows recorded for it - the data behind the roster grid.
    Present means an attendance row exists in a booked or attended state."""
    roster_date = date.fromisoformat(date_)
    members = db.query(Member).filter(Member.status == MemberStatus.ACTIVE).order_by(Member.full_name).all()

    rows = db.query(MealAttendance).filter(
        MealAttendance.date == roster_date, MealAttendance.meal_type == meal_type,
    ).all()
    by_member = {r.member_id: r for r in rows if r.member_id is not None}

    # One leave lookup for the whole active set instead of per-member.
    on_leave_ids = {
        l.member_id for l in db.query(MemberLeave).filter(
            MemberLeave.status == LeaveStatus.ACTIVE,
            MemberLeave.start_date <= roster_date,
            MemberLeave.end_date >= roster_date,
        ).all()
    }

    member_out = []
    for m in members:
        rec = by_member.get(m.id)
        if m.id in on_leave_ids:
            status = "on_leave"
        elif rec and rec.status.value in ("booked", "attended"):
            status = "present"
        else:
            status = "absent"
        member_out.append({"member_id": m.id, "full_name": m.full_name,
                           "service_number": m.service_number, "status": status})

    guest_out = [
        {"id": r.id, "booking_id": r.booking_id, "guest_name": r.booking.guest_name if r.booking else None,
         "recipe_id": r.recipe_id, "recipe_name": r.recipe.name if r.recipe else None, "status": r.status.value}
        for r in rows if r.booking_id is not None and r.status.value in ("booked", "attended")
    ]
    return {"members": member_out, "guests": guest_out}


@router.post("/roster")
async def set_roster(data: RosterSetRequest, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Bulk present/absent for a set of members - powers both a single-row
    toggle (one id) and 'Mark all present' (all ids). Present on today/past =
    ATTENDED, present on a future date = BOOKED (advance booking, not yet
    billable); absent = CANCELLED. On-leave members are skipped when marking
    present. Past-date edits require a reason and are logged as OVERRIDE,
    matching mark_attendance."""
    if not check_permission(current_user, "attendance", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")

    is_backdated = data.date < date.today()
    if data.present and is_backdated and not data.reason:
        raise HTTPException(status_code=400, detail="A reason is required to record attendance for a past date")

    present_status = AttendanceStatus.BOOKED if data.date > date.today() else AttendanceStatus.ATTENDED
    updated, skipped = [], []
    for member_id in data.member_ids:
        if not db.query(Member).filter(Member.id == member_id).first():
            skipped.append(member_id)
            continue
        if data.present and _has_active_leave(db, member_id, data.date):
            skipped.append(member_id)  # on leave - excluded, never auto-marked present
            continue

        record = db.query(MealAttendance).filter(
            MealAttendance.member_id == member_id, MealAttendance.date == data.date,
            MealAttendance.meal_type == data.meal_type,
        ).first()

        if data.present:
            if not record:
                record = MealAttendance(member_id=member_id, date=data.date, meal_type=data.meal_type, method="manual")
                db.add(record)
            record.status = present_status
            if data.recipe_id is not None:
                record.recipe_id = data.recipe_id
            record.marked_at = datetime.utcnow()
            record.marked_by = current_user.id
        else:
            if not record:
                continue  # absent and never recorded - nothing to do
            record.status = AttendanceStatus.CANCELLED
            record.marked_at = datetime.utcnow()
            record.marked_by = current_user.id
        updated.append(member_id)

    db.commit()
    action = AuditAction.OVERRIDE if is_backdated else AuditAction.UPDATE
    log_audit(db, current_user.id, current_user.full_name, action, "meal_attendance", None,
              after_state={"date": str(data.date), "meal_type": data.meal_type, "present": data.present,
                           "updated": len(updated), "skipped": len(skipped)},
              reason=data.reason if is_backdated else None, ip_address=request.client.host)
    return {"updated": updated, "skipped": skipped}


@router.post("/{attendance_id}/mark")
async def mark_attendance(attendance_id: int, data: AttendanceMarkRequest, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "attendance", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    record = db.query(MealAttendance).filter(MealAttendance.id == attendance_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Attendance record not found")
    if data.status not in (AttendanceStatus.ATTENDED.value, AttendanceStatus.CANCELLED.value):
        raise HTTPException(status_code=400, detail="Status must be 'attended' or 'cancelled'")

    is_backdated = record.date < date.today()
    if is_backdated and not data.reason:
        raise HTTPException(status_code=400, detail="A reason is required to correct a past attendance record")

    before = serialize_model(record)
    record.status = data.status
    record.marked_at = datetime.utcnow()
    record.marked_by = current_user.id
    db.commit()
    db.refresh(record)

    if is_backdated:
        log_audit(db, current_user.id, current_user.full_name, AuditAction.OVERRIDE, "meal_attendance", record.id, before_state=before, after_state=serialize_model(record), reason=data.reason, ip_address=request.client.host)
    else:
        log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "meal_attendance", record.id, before_state=before, after_state=serialize_model(record), ip_address=request.client.host)
    return record


@router.get("/summary")
async def attendance_summary(member_id: int, month: int = Query(..., ge=1, le=12), year: int = Query(...), db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not db.query(Member).filter(Member.id == member_id).first():
        raise HTTPException(status_code=404, detail="Member not found")
    return {"member_id": member_id, "month": month, "year": year, "man_days": get_man_days(db, member_id, month, year)}


# --- Member Leave ---

@router.get("/leaves")
async def list_leaves(member_id: int = 0, status: str = "", db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    query = db.query(MemberLeave)
    if member_id:
        query = query.filter(MemberLeave.member_id == member_id)
    if status:
        query = query.filter(MemberLeave.status == status)
    leaves = query.order_by(MemberLeave.start_date.desc()).all()
    return [{"id": l.id, "member_id": l.member_id, "member_name": l.member.full_name if l.member else None,
             "start_date": l.start_date, "end_date": l.end_date, "reason": l.reason,
             "status": l.status.value, "created_at": l.created_at} for l in leaves]


@router.post("/leaves")
async def create_leave(data: MemberLeaveCreate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "attendance", "create"):
        raise HTTPException(status_code=403, detail="Permission denied")
    if not db.query(Member).filter(Member.id == data.member_id).first():
        raise HTTPException(status_code=404, detail="Member not found")

    leave = MemberLeave(**data.model_dump(), created_by=current_user.id)
    db.add(leave)
    db.commit()
    db.refresh(leave)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.CREATE, "member_leaves", leave.id, after_state=serialize_model(leave), ip_address=request.client.host)
    return leave


@router.post("/leaves/{leave_id}/cancel")
async def cancel_leave(leave_id: int, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "attendance", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    leave = db.query(MemberLeave).filter(MemberLeave.id == leave_id).first()
    if not leave:
        raise HTTPException(status_code=404, detail="Leave record not found")

    before = serialize_model(leave)
    leave.status = LeaveStatus.CANCELLED
    db.commit()
    db.refresh(leave)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "member_leaves", leave.id, before_state=before, after_state=serialize_model(leave), ip_address=request.client.host)
    return leave
