"""Room attendant directory - profiles, photo upload, and the room-count
each attendant currently carries (1 attendant -> many rooms)."""
import uuid
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.config import UPLOADS_DIR
from backend.models import Attendant, Room, AttendantDutyLog
from datetime import datetime, timedelta
from backend.schemas import (
    AttendantCreate, AttendantUpdate, AttendantOut, AttendantDuty,
    AttendantActivitySummaryOut, AttendantActivityTrendOut,
)
from backend.auth import get_current_user, check_permission
from backend.audit import log_audit, serialize_model, AuditAction

router = APIRouter()

ATTENDANT_PHOTOS_DIR = UPLOADS_DIR / "attendants"
ATTENDANT_PHOTOS_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_PHOTO_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}


def _to_out(db: Session, a: Attendant) -> AttendantOut:
    room_count = db.query(Room).filter(Room.attendant_id == a.id).count()
    photo_url = f"/uploads/attendants/{a.photo_file_name}" if a.photo_file_name else None
    return AttendantOut(
        id=a.id, full_name=a.full_name, phone=a.phone, email=a.email, shift=a.shift,
        is_active=a.is_active, on_duty=a.on_duty or False, on_duty_since=a.on_duty_since,
        photo_url=photo_url, room_count=room_count, created_at=a.created_at,
    )


@router.get("", response_model=list[AttendantOut])
async def list_attendants(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "attendants", "view"):
        raise HTTPException(status_code=403, detail="Permission denied")
    attendants = db.query(Attendant).order_by(Attendant.full_name).all()
    return [_to_out(db, a) for a in attendants]


@router.post("", response_model=AttendantOut)
async def create_attendant(data: AttendantCreate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "attendants", "create"):
        raise HTTPException(status_code=403, detail="Permission denied")
    attendant = Attendant(**data.model_dump())
    db.add(attendant)
    db.commit()
    db.refresh(attendant)
    log_audit(db, current_user.id, current_user.full_name, AuditAction.CREATE, "attendants", attendant.id,
              after_state=serialize_model(attendant), ip_address=request.client.host)
    return _to_out(db, attendant)


@router.put("/{attendant_id}", response_model=AttendantOut)
async def update_attendant(attendant_id: int, data: AttendantUpdate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "attendants", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    attendant = db.query(Attendant).filter(Attendant.id == attendant_id).first()
    if not attendant:
        raise HTTPException(status_code=404, detail="Attendant not found")

    before = serialize_model(attendant)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(attendant, field, value)
    db.commit()
    db.refresh(attendant)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "attendants", attendant.id,
              before_state=before, after_state=serialize_model(attendant), ip_address=request.client.host)
    return _to_out(db, attendant)


@router.put("/{attendant_id}/duty", response_model=AttendantOut)
async def set_attendant_duty(attendant_id: int, data: AttendantDuty, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "attendants", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    attendant = db.query(Attendant).filter(Attendant.id == attendant_id).first()
    if not attendant:
        raise HTTPException(status_code=404, detail="Attendant not found")

    before = serialize_model(attendant)
    now = datetime.utcnow()
    attendant.on_duty = data.on_duty
    attendant.on_duty_since = now if data.on_duty else None

    if data.on_duty:
        db.add(AttendantDutyLog(attendant_id=attendant.id, clock_in=now))
    else:
        open_log = (db.query(AttendantDutyLog)
                    .filter(AttendantDutyLog.attendant_id == attendant.id, AttendantDutyLog.clock_out.is_(None))
                    .order_by(AttendantDutyLog.clock_in.desc()).first())
        if open_log:
            open_log.clock_out = now
            open_log.duration_minutes = max(0, round((now - open_log.clock_in).total_seconds() / 60))

    db.commit()
    db.refresh(attendant)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "attendants", attendant.id,
              before_state=before, after_state=serialize_model(attendant), reason="Clock in/out", ip_address=request.client.host)
    return _to_out(db, attendant)


def _open_session_minutes(log: AttendantDutyLog, now: datetime) -> int:
    return max(0, round((now - log.clock_in).total_seconds() / 60))


@router.get("/activity/summary", response_model=list[AttendantActivitySummaryOut])
async def attendant_activity_summary(days: int = 30, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "attendants", "view"):
        raise HTTPException(status_code=403, detail="Permission denied")
    now = datetime.utcnow()
    cutoff = now - timedelta(days=days)
    attendants = db.query(Attendant).order_by(Attendant.full_name).all()
    logs = db.query(AttendantDutyLog).filter(AttendantDutyLog.clock_in >= cutoff).all()
    by_attendant: dict[int, list[AttendantDutyLog]] = {}
    for log in logs:
        by_attendant.setdefault(log.attendant_id, []).append(log)

    result = []
    for a in attendants:
        a_logs = by_attendant.get(a.id, [])
        total_minutes = sum(
            log.duration_minutes if log.duration_minutes is not None else _open_session_minutes(log, now)
            for log in a_logs
        )
        session_count = len(a_logs)
        last_clock_in = max((log.clock_in for log in a_logs), default=None)
        closed = [log for log in a_logs if log.clock_out is not None]
        last_clock_out = max((log.clock_out for log in closed), default=None)
        photo_url = f"/uploads/attendants/{a.photo_file_name}" if a.photo_file_name else None
        result.append(AttendantActivitySummaryOut(
            attendant_id=a.id, full_name=a.full_name, photo_url=photo_url,
            is_active=a.is_active, on_duty=a.on_duty or False,
            total_hours=round(total_minutes / 60, 2), session_count=session_count,
            avg_session_hours=round((total_minutes / 60) / session_count, 2) if session_count else 0.0,
            last_clock_in=last_clock_in, last_clock_out=last_clock_out,
        ))
    result.sort(key=lambda r: r.total_hours, reverse=True)
    return result


@router.get("/activity/trend", response_model=AttendantActivityTrendOut)
async def attendant_activity_trend(days: int = 14, attendant_id: int | None = None, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "attendants", "view"):
        raise HTTPException(status_code=403, detail="Permission denied")
    now = datetime.utcnow()
    query = db.query(AttendantDutyLog)
    if attendant_id is not None:
        query = query.filter(AttendantDutyLog.attendant_id == attendant_id)
    window_start = (now - timedelta(days=days)).replace(hour=0, minute=0, second=0, microsecond=0)
    logs = query.filter(
        (AttendantDutyLog.clock_out >= window_start) | (AttendantDutyLog.clock_out.is_(None))
    ).all()

    labels, values = [], []
    for i in range(days - 1, -1, -1):
        day_start = (now - timedelta(days=i)).replace(hour=0, minute=0, second=0, microsecond=0)
        day_end = day_start + timedelta(days=1)
        minutes = 0
        for log in logs:
            session_end = log.clock_out or now
            overlap_start = max(log.clock_in, day_start)
            overlap_end = min(session_end, day_end)
            if overlap_end > overlap_start:
                minutes += (overlap_end - overlap_start).total_seconds() / 60
        labels.append(day_start.strftime("%b %d"))
        values.append(round(minutes / 60, 2))
    return AttendantActivityTrendOut(labels=labels, values=values)


@router.post("/{attendant_id}/photo", response_model=AttendantOut)
async def upload_attendant_photo(attendant_id: int, request: Request, file: UploadFile = File(...), db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "attendants", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    attendant = db.query(Attendant).filter(Attendant.id == attendant_id).first()
    if not attendant:
        raise HTTPException(status_code=404, detail="Attendant not found")
    ext = ALLOWED_PHOTO_TYPES.get(file.content_type)
    if not ext:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, or WEBP images are allowed")

    contents = await file.read()
    if len(contents) > 8 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Photo must be under 8MB")

    old_file_name = attendant.photo_file_name
    file_name = f"{uuid.uuid4().hex}.{ext}"
    (ATTENDANT_PHOTOS_DIR / file_name).write_bytes(contents)
    attendant.photo_file_name = file_name
    db.commit()
    db.refresh(attendant)

    if old_file_name:
        (ATTENDANT_PHOTOS_DIR / old_file_name).unlink(missing_ok=True)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "attendants", attendant.id,
              after_state={"photo_file_name": file_name}, ip_address=request.client.host)
    return _to_out(db, attendant)
