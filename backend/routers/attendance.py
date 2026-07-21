"""Meal attendance/booking and member-leave router."""
from typing import List
from datetime import datetime, date, time, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.models import (
    MealAttendance, MemberLeave, Member, MemberStatus, Booking, Guest, AttendanceStatus, LeaveStatus, Room,
)
from backend.schemas import (
    MealAttendanceCreate, MealAttendanceOut, AttendanceMarkRequest, BulkAttendanceCreate, MemberLeaveCreate,
    AttendanceLookupResult, ServeAttendanceRequest, NoShowSweepResult,
)
from backend.auth import get_current_user, check_permission
from backend.audit import log_audit, serialize_model, AuditAction
from backend.logging_config import get_logger
from backend.services.mess_billing_calc import get_man_days, get_setting_float, get_setting_str

logger = get_logger("app")
router = APIRouter()

# Fixed meal times for Tier 1 - not per-mess-configurable, just used as a
# fallback reference. The actual booking cutoff is the settable
# meal_cutoff_<type> SystemSetting (see _get_meal_cutoff_time) - an absolute
# clock time per meal, editable on the Settings page, after which that
# meal's attendance for the day is final.
MEAL_TIMES = {
    "breakfast": time(7, 0),
    "lunch": time(13, 0),
    "hitea": time(16, 30),
    "dinner": time(20, 0),
}

_DEFAULT_CUTOFFS = {
    "breakfast": time(9, 0),
    "lunch": time(14, 30),
    "hitea": time(17, 30),
    "dinner": time(21, 30),
}


def _get_meal_cutoff_time(db: Session, meal_type: str) -> time:
    default = _DEFAULT_CUTOFFS.get(meal_type, time(23, 59))
    raw = get_setting_str(db, f"meal_cutoff_{meal_type}", default.strftime("%H:%M"))
    try:
        hh, mm = raw.split(":")
        return time(int(hh), int(mm))
    except (ValueError, TypeError):
        return default


def _is_locked(meal_date: date, cutoff_time: time) -> bool:
    """A meal is final (locked) for any date that's already fully elapsed,
    or for today once the clock passes its settable cutoff time. A future
    date is never locked - its cutoff simply hasn't arrived yet."""
    today = date.today()
    if meal_date < today:
        return True
    if meal_date > today:
        return False
    return datetime.utcnow() > datetime.combine(meal_date, cutoff_time)


def _has_active_leave(db: Session, member_id: int, on_date: date) -> bool:
    return db.query(MemberLeave).filter(
        MemberLeave.member_id == member_id,
        MemberLeave.status == LeaveStatus.ACTIVE,
        MemberLeave.start_date <= on_date,
        MemberLeave.end_date >= on_date,
    ).first() is not None


def _attendance_out(record: MealAttendance) -> MealAttendanceOut:
    return MealAttendanceOut(
        id=record.id, member_id=record.member_id, booking_id=record.booking_id, guest_id=record.guest_id, recipe_id=record.recipe_id,
        date=record.date, meal_type=record.meal_type.value, method=record.method, status=record.status.value,
        booked_at=record.booked_at, marked_at=record.marked_at, marked_by=record.marked_by,
        member_name=record.member.full_name if record.member else None,
        guest_name=(record.booking.guest_name if record.booking else None) or (record.guest.full_name if record.guest else None),
        recipe_name=record.recipe.name if record.recipe else None,
    )


def _create_attendance(db: Session, member_id: int | None, booking_id: int | None, meal_date: date, meal_type: str, method: str, recipe_id: int | None = None, guest_id: int | None = None) -> MealAttendance:
    # Only members have a MemberLeave concept - checked-in guests and
    # standalone walk-in guests (booking_id/guest_id) skip this check.
    status = AttendanceStatus.BOOKED
    if member_id and _has_active_leave(db, member_id, meal_date):
        status = AttendanceStatus.EXCLUDED
    record = MealAttendance(member_id=member_id, booking_id=booking_id, guest_id=guest_id, recipe_id=recipe_id, date=meal_date, meal_type=meal_type, method=method, status=status)
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
    if data.guest_id and not db.query(Guest).filter(Guest.id == data.guest_id).first():
        raise HTTPException(status_code=404, detail="Guest not found")
    cutoff = _get_meal_cutoff_time(db, data.meal_type)
    if _is_locked(data.date, cutoff):
        raise HTTPException(status_code=400, detail=f"Attendance for {data.meal_type} on {data.date} is final - booking closed at {cutoff.strftime('%H:%M')}")

    try:
        record = _create_attendance(db, data.member_id, data.booking_id, data.date, data.meal_type, data.method, data.recipe_id, data.guest_id)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="This member/guest already has a booking for that meal/date")

    log_audit(db, current_user.id, current_user.full_name, AuditAction.CREATE, "meal_attendance", record.id, after_state=serialize_model(record), ip_address=request.client.host)
    return record


@router.post("/bulk")
async def bulk_book_attendance(data: BulkAttendanceCreate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "attendance", "create"):
        raise HTTPException(status_code=403, detail="Permission denied")
    cutoff = _get_meal_cutoff_time(db, data.meal_type)
    if _is_locked(data.date, cutoff):
        raise HTTPException(status_code=400, detail=f"Attendance for {data.meal_type} on {data.date} is final - booking closed at {cutoff.strftime('%H:%M')}")

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
    q: str = Query(""), date_: str = Query(..., alias="date"), meal_type: str = Query(...),
    db: Session = Depends(get_db), current_user=Depends(get_current_user),
):
    """Omnibar data source: matches active members (name/service number),
    checked-in hotel guests (name/room number), and standalone walk-in
    guests with no room booking (name/phone) - the same one box adds any of
    the three the same way. Annotated with attendance status for the given
    date/meal so the UI can render the Intent pill without a second round trip.

    An empty q is a deliberate "browse" mode (contains("") matches every
    row) rather than a narrow search, so it uses a much higher limit - the
    frontend shows this on focus, before anyone's typed anything, as a
    preview of who's available to add."""
    try:
        lookup_date = date.fromisoformat(date_)
    except ValueError:
        raise HTTPException(status_code=400, detail="date must be an ISO date (YYYY-MM-DD)")

    browsing = not q.strip()
    person_limit = 50 if browsing else 8
    guest_limit = 20 if browsing else 8

    results: List[AttendanceLookupResult] = []

    members = db.query(Member).filter(
        Member.status == MemberStatus.ACTIVE,
        (Member.full_name.contains(q)) | (Member.service_number.contains(q)),
    ).order_by(Member.full_name).limit(person_limit).all()
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
    ).order_by(Booking.guest_name).limit(person_limit).all()
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

    # Standalone walk-in guests: excludes anyone with an active checked-in
    # booking, since those people are already covered above under "booking" -
    # without this exclusion the same physical person could be added twice
    # under two different consumer identities, double-counting them.
    checked_in_guest_ids = {b.guest_id for b in db.query(Booking.guest_id).filter(Booking.status == "checked_in", Booking.guest_id.isnot(None)).all()}
    guest_query = db.query(Guest).filter((Guest.full_name.contains(q)) | (Guest.phone.contains(q)))
    if checked_in_guest_ids:
        guest_query = guest_query.filter(~Guest.id.in_(checked_in_guest_ids))
    guests = guest_query.order_by(Guest.updated_at.desc()).limit(guest_limit).all()
    guest_ids = [g.id for g in guests]
    guest_rows = {}
    if guest_ids:
        guest_rows = {r.guest_id: r for r in db.query(MealAttendance).filter(
            MealAttendance.guest_id.in_(guest_ids), MealAttendance.date == lookup_date,
            MealAttendance.meal_type == meal_type,
        ).all()}
    for g in guests:
        rec = guest_rows.get(g.id)
        results.append(AttendanceLookupResult(
            kind="guest", id=g.id, name=g.full_name, sub_label=g.phone or "Guest",
            recipe_id=rec.recipe_id if rec else None,
            attendance_id=rec.id if rec else None,
            attendance_status=rec.status.value if rec else None,
        ))

    return results


@router.post("/serve", response_model=MealAttendanceOut)
async def serve_meal(data: ServeAttendanceRequest, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Point-of-service action: confirm attendance for someone already booked,
    or create+confirm in one step for a walk-up with no advance intent."""
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
    if data.guest_id and not db.query(Guest).filter(Guest.id == data.guest_id).first():
        raise HTTPException(status_code=404, detail="Guest not found")

    query = db.query(MealAttendance).filter(MealAttendance.date == data.date, MealAttendance.meal_type == data.meal_type)
    if data.member_id:
        query = query.filter(MealAttendance.member_id == data.member_id)
    elif data.booking_id:
        query = query.filter(MealAttendance.booking_id == data.booking_id)
    else:
        query = query.filter(MealAttendance.guest_id == data.guest_id)
    record = query.first()

    if record and record.status in (AttendanceStatus.CANCELLED, AttendanceStatus.EXCLUDED):
        # Explicit cancellation/leave shouldn't be silently overridden by a serve click -
        # the frontend intercepts this exact status code and shows why, not a generic error.
        raise HTTPException(status_code=409, detail=record.status.value)
    if record and record.status == AttendanceStatus.ATTENDED:
        return _attendance_out(record)  # idempotent double-click safety
    cutoff = _get_meal_cutoff_time(db, data.meal_type)
    if _is_locked(data.date, cutoff):
        raise HTTPException(status_code=400, detail=f"Attendance for {data.meal_type} on {data.date} is final - booking closed at {cutoff.strftime('%H:%M')}")
    if record is None and data.member_id and _has_active_leave(db, data.member_id, data.date):
        raise HTTPException(status_code=409, detail="excluded")

    before = serialize_model(record) if record else None
    if record is None:
        record = MealAttendance(member_id=data.member_id, booking_id=data.booking_id, guest_id=data.guest_id, recipe_id=data.recipe_id,
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
        kind = "member" if r.member_id else ("booking" if r.booking_id else "guest")
        items.append(AttendanceLookupResult(
            kind=kind,
            id=r.member_id or r.booking_id or r.guest_id,
            name=r.member.full_name if r.member else (r.booking.guest_name if r.booking else (r.guest.full_name if r.guest else "Unknown")),
            sub_label=None, recipe_id=r.recipe_id, attendance_id=r.id, attendance_status=r.status.value,
        ))
        log_audit(db, current_user.id, current_user.full_name, AuditAction.OVERRIDE, "meal_attendance", r.id,
                  before_state=before, after_state=serialize_model(r), reason="no-show sweep", ip_address=request.client.host)

    db.commit()
    return NoShowSweepResult(count=len(items), items=items)


# --- Cutoffs (per-meal settable "attendance is final" time) ---

@router.get("/cutoffs")
async def list_cutoffs(
    date_: str = Query(..., alias="date"),
    db: Session = Depends(get_db), current_user=Depends(get_current_user),
):
    """Cutoff time + lock state for each meal on one date - drives the
    Attendance page's lock badges and disables adding/removing once a meal's
    booking window has closed. Cutoff times themselves are edited on the
    Settings page (meal_cutoff_breakfast/lunch/hitea/dinner)."""
    try:
        cutoff_date = date.fromisoformat(date_)
    except ValueError:
        raise HTTPException(status_code=400, detail="date must be an ISO date (YYYY-MM-DD)")

    out = {}
    for mt in MEAL_TIMES:
        cutoff = _get_meal_cutoff_time(db, mt)
        out[mt] = {"cutoff": cutoff.strftime("%H:%M"), "locked": _is_locked(cutoff_date, cutoff)}
    return out


# --- Attendees (unified confirmed list for one meal - the omnibar's counterpart view) ---

@router.get("/attendees")
async def list_attendees(
    date_: str = Query(..., alias="date"), meal_type: str = Query(...),
    db: Session = Depends(get_db), current_user=Depends(get_current_user),
):
    """Everyone currently booked/attended for one date+meal, regardless of
    whether they're a member, a checked-in hotel guest, or a standalone
    walk-in guest - one flat list, since the frontend no longer distinguishes
    how someone was added, only who's confirmed to eat."""
    try:
        attendees_date = date.fromisoformat(date_)
    except ValueError:
        raise HTTPException(status_code=400, detail="date must be an ISO date (YYYY-MM-DD)")

    rows = db.query(MealAttendance).filter(
        MealAttendance.date == attendees_date, MealAttendance.meal_type == meal_type,
        MealAttendance.status.in_([AttendanceStatus.BOOKED, AttendanceStatus.ATTENDED]),
    ).all()

    out = []
    for r in rows:
        if r.member_id:
            kind, name, sub_label = "member", r.member.full_name if r.member else "Unknown", r.member.service_number if r.member else None
        elif r.booking_id:
            kind, name, sub_label = "booking", r.booking.guest_name if r.booking else "Unknown", (r.booking.room.room_number if r.booking and r.booking.room else None)
        else:
            kind, name, sub_label = "guest", r.guest.full_name if r.guest else "Unknown", r.guest.phone if r.guest else None
        out.append({
            "attendance_id": r.id, "kind": kind, "name": name, "sub_label": sub_label,
            "recipe_name": r.recipe.name if r.recipe else None, "status": r.status.value,
        })
    out.sort(key=lambda x: x["name"] or "")
    return out


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
    if not is_backdated:
        # Today only - once locked there's no override, unlike the reasoned
        # correction path above for genuinely past dates.
        cutoff = _get_meal_cutoff_time(db, record.meal_type.value)
        if _is_locked(record.date, cutoff):
            raise HTTPException(status_code=400, detail=f"Attendance for {record.meal_type.value} on {record.date} is final - booking closed at {cutoff.strftime('%H:%M')}")

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
