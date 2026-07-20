"""Meal attendance/booking and member-leave router."""
from typing import List
from datetime import datetime, date, time, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.models import (
    MealAttendance, MemberLeave, Member, MemberStatus, Booking, AttendanceStatus, LeaveStatus, Room,
)
from backend.schemas import (
    MealAttendanceCreate, MealAttendanceOut, AttendanceMarkRequest, BulkAttendanceCreate, MemberLeaveCreate,
    RosterSetRequest, AttendanceLookupResult, ServeAttendanceRequest, NoShowSweepResult,
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


def _attendance_out(record: MealAttendance) -> MealAttendanceOut:
    return MealAttendanceOut(
        id=record.id, member_id=record.member_id, booking_id=record.booking_id, recipe_id=record.recipe_id,
        date=record.date, meal_type=record.meal_type.value, method=record.method, status=record.status.value,
        booked_at=record.booked_at, marked_at=record.marked_at, marked_by=record.marked_by,
        member_name=record.member.full_name if record.member else None,
        guest_name=record.booking.guest_name if record.booking else None,
        recipe_name=record.recipe.name if record.recipe else None,
    )


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


# --- Meal Service (omnibar search, per-person serve, no-show sweep) ---

@router.get("/lookup", response_model=List[AttendanceLookupResult])
async def lookup_attendance(
    q: str = Query(..., min_length=2), date_: str = Query(..., alias="date"), meal_type: str = Query(...),
    db: Session = Depends(get_db), current_user=Depends(get_current_user),
):
    """Omnibar data source: matches active members (name/service number) and
    checked-in guests (name/room number), annotated with their attendance
    status for the given date/meal so the UI can render the Intent pill
    without a second round trip."""
    try:
        lookup_date = date.fromisoformat(date_)
    except ValueError:
        raise HTTPException(status_code=400, detail="date must be an ISO date (YYYY-MM-DD)")

    results: List[AttendanceLookupResult] = []

    members = db.query(Member).filter(
        Member.status == MemberStatus.ACTIVE,
        (Member.full_name.contains(q)) | (Member.service_number.contains(q)),
    ).order_by(Member.full_name).limit(8).all()
    member_ids = [m.id for m in members]
    member_rows = {}
    if member_ids:
        member_rows = {r.member_id: r for r in db.query(MealAttendance).filter(
            MealAttendance.member_id.in_(member_ids), MealAttendance.date == lookup_date,
            MealAttendance.meal_type == meal_type,
        ).all()}
    for m in members:
        rec = member_rows.get(m.id)
        results.append(AttendanceLookupResult(
            kind="member", id=m.id, name=m.full_name, sub_label=m.service_number,
            recipe_id=rec.recipe_id if rec else None,
            attendance_id=rec.id if rec else None,
            attendance_status=rec.status.value if rec else None,
        ))

    bookings = db.query(Booking).join(Room, Booking.room_id == Room.id).filter(
        Booking.status == "checked_in",
        (Booking.guest_name.contains(q)) | (Room.room_number.contains(q)),
    ).order_by(Booking.guest_name).limit(8).all()
    booking_ids = [b.id for b in bookings]
    booking_rows = {}
    if booking_ids:
        booking_rows = {r.booking_id: r for r in db.query(MealAttendance).filter(
            MealAttendance.booking_id.in_(booking_ids), MealAttendance.date == lookup_date,
            MealAttendance.meal_type == meal_type,
        ).all()}
    for b in bookings:
        rec = booking_rows.get(b.id)
        results.append(AttendanceLookupResult(
            kind="booking", id=b.id, name=b.guest_name, sub_label=b.room.room_number if b.room else None,
            recipe_id=rec.recipe_id if rec else None,
            attendance_id=rec.id if rec else None,
            attendance_status=rec.status.value if rec else None,
        ))

    return results


@router.post("/serve", response_model=MealAttendanceOut)
async def serve_meal(data: ServeAttendanceRequest, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Point-of-service action: confirm attendance for someone already booked,
    or create+confirm in one step for a walk-up with no advance intent. Unlike
    POST /attendance, this never checks the advance-booking cutoff - serving
    someone right now is not a future booking."""
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

    query = db.query(MealAttendance).filter(MealAttendance.date == data.date, MealAttendance.meal_type == data.meal_type)
    query = query.filter(MealAttendance.member_id == data.member_id) if data.member_id else query.filter(MealAttendance.booking_id == data.booking_id)
    record = query.first()

    if record and record.status in (AttendanceStatus.CANCELLED, AttendanceStatus.EXCLUDED):
        # Explicit cancellation/leave shouldn't be silently overridden by a serve click -
        # the frontend intercepts this exact status code and shows why, not a generic error.
        raise HTTPException(status_code=409, detail=record.status.value)
    if record and record.status == AttendanceStatus.ATTENDED:
        return _attendance_out(record)  # idempotent double-click safety
    if record is None and data.member_id and _has_active_leave(db, data.member_id, data.date):
        raise HTTPException(status_code=409, detail="excluded")

    before = serialize_model(record) if record else None
    if record is None:
        record = MealAttendance(member_id=data.member_id, booking_id=data.booking_id, recipe_id=data.recipe_id,
                                 date=data.date, meal_type=data.meal_type, method="manual")
        db.add(record)
    elif data.recipe_id is not None:
        record.recipe_id = data.recipe_id
    record.status = AttendanceStatus.ATTENDED
    record.marked_at = datetime.utcnow()
    record.marked_by = current_user.id
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="This member/guest already has a booking for that meal/date")
    db.refresh(record)

    action = AuditAction.CREATE if before is None else AuditAction.UPDATE
    log_audit(db, current_user.id, current_user.full_name, action, "meal_attendance", record.id,
              before_state=before, after_state=serialize_model(record), ip_address=request.client.host)
    return _attendance_out(record)


@router.post("/no-show-sweep", response_model=NoShowSweepResult)
async def no_show_sweep(
    request: Request,
    date_: str = Query(..., alias="date"), meal_type: str = Query(...),
    db: Session = Depends(get_db), current_user=Depends(get_current_user),
):
    """Manual sweep (no background scheduler in this app - matches the
    lazy-recompute pattern already used for a la carte SLA timers): flips
    stale BOOKED rows past the meal window + grace period to NO_SHOW."""
    if not check_permission(current_user, "attendance", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    try:
        sweep_date = date.fromisoformat(date_)
    except ValueError:
        raise HTTPException(status_code=400, detail="date must be an ISO date (YYYY-MM-DD)")
    meal_time = MEAL_TIMES.get(meal_type)
    if not meal_time:
        raise HTTPException(status_code=400, detail=f"meal_type must be one of {sorted(MEAL_TIMES)}")

    grace_minutes = get_setting_float(db, "no_show_grace_minutes", 60)
    grace_end = datetime.combine(sweep_date, meal_time) + timedelta(minutes=grace_minutes)
    if datetime.utcnow() < grace_end:
        raise HTTPException(status_code=400, detail="This meal window hasn't closed yet")

    rows = db.query(MealAttendance).filter(
        MealAttendance.date == sweep_date, MealAttendance.meal_type == meal_type,
        MealAttendance.status == AttendanceStatus.BOOKED,
    ).all()

    items: List[AttendanceLookupResult] = []
    for r in rows:
        before = serialize_model(r)
        r.status = AttendanceStatus.NO_SHOW
        r.marked_at = datetime.utcnow()
        r.marked_by = current_user.id
        items.append(AttendanceLookupResult(
            kind="member" if r.member_id else "booking",
            id=r.member_id or r.booking_id,
            name=r.member.full_name if r.member else (r.booking.guest_name if r.booking else "Unknown"),
            sub_label=None, recipe_id=r.recipe_id, attendance_id=r.id, attendance_status=r.status.value,
        ))
        log_audit(db, current_user.id, current_user.full_name, AuditAction.OVERRIDE, "meal_attendance", r.id,
                  before_state=before, after_state=serialize_model(r), reason="no-show sweep", ip_address=request.client.host)

    db.commit()
    return NoShowSweepResult(count=len(items), items=items)


# --- Roster (single-tap present/absent grid) ---

@router.get("/roster")
async def get_roster(
    date_: str = Query(..., alias="date"), meal_type: str = Query(...),
    db: Session = Depends(get_db), current_user=Depends(get_current_user),
):
    """Every active member with their present/absent/on_leave state for one
    meal, plus any guest rows recorded for it - the data behind the roster grid.
    Present means an attendance row exists in a booked or attended state."""
    try:
        roster_date = date.fromisoformat(date_)
    except ValueError:
        raise HTTPException(status_code=400, detail="date must be an ISO date (YYYY-MM-DD)")
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
