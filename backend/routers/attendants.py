"""Room attendant directory - profiles, photo upload, and the room-count
each attendant currently carries (1 attendant -> many rooms)."""
import uuid
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.config import UPLOADS_DIR
from backend.models import Attendant, Room
from datetime import datetime
from backend.schemas import AttendantCreate, AttendantUpdate, AttendantOut, AttendantDuty
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
    attendant.on_duty = data.on_duty
    attendant.on_duty_since = datetime.utcnow() if data.on_duty else None
    db.commit()
    db.refresh(attendant)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "attendants", attendant.id,
              before_state=before, after_state=serialize_model(attendant), reason="Clock in/out", ip_address=request.client.host)
    return _to_out(db, attendant)


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
