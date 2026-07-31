"""Admin-editable view of the official rate card (Guest Room Charges, GRs
Charges on Duty, HRA Revised Rate, HRA utility charges) that
backend/services/room_pricing.py has always priced bookings from via its
DEFAULT_* fallback dicts - those tables (RoomRate, DutyRate, HraRankRate,
HraUtilityRate) never had a CRUD surface, so a rate revision meant editing
code. GET here returns one row per fixed key using the SAME getter functions
the pricing engine calls (DB override if saved, else the code default), so
what a Manager sees always matches what a booking is actually charged;
PUT persists an override row. Mirrors tariffs.py/womens_bloc_rates.py's
upsert-by-natural-key pattern. Gated on the existing 'tariffs' permission -
this is the same rate-card page, not a new module."""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.models import RoomRate, DutyRate, HraRankRate, HraUtilityRate
from backend.schemas import (
    RoomRateCreate, RoomRateOut, DutyRateCreate, DutyRateOut,
    HraRankRateCreate, HraRankRateOut, HraUtilityRateCreate, HraUtilityRateOut,
)
from backend.auth import get_current_user, check_permission
from backend.audit import log_audit, serialize_model, AuditAction
from backend.services.room_pricing import (
    get_room_rate, get_hra_utility_rate,
    DEFAULT_DUTY_RATES, DEFAULT_HRA_RANK_RATES, DEFAULT_HRA_UTILITY_RATES,
)

router = APIRouter()

ROOM_TYPES = ("standard", "suite", "dg_suite")
GUEST_CATEGORIES = ("serving_officer", "retired_officer", "civilian")


def _require_edit(current_user):
    if not check_permission(current_user, "tariffs", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")


@router.get("/room-rates", response_model=list[RoomRateOut])
async def list_room_rates(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    out = []
    for room_type in ROOM_TYPES:
        for category in GUEST_CATEGORIES:
            components = get_room_rate(db, room_type, category)
            out.append(RoomRateOut(room_type=room_type, guest_category=category, **components))
    return out


@router.put("/room-rates")
async def upsert_room_rate(data: RoomRateCreate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_edit(current_user)
    row = db.query(RoomRate).filter(
        RoomRate.room_type == data.room_type, RoomRate.guest_category == data.guest_category,
    ).first()
    before = serialize_model(row) if row else None
    if row:
        for field in ("rent", "electricity", "generator", "gas", "internet"):
            setattr(row, field, getattr(data, field))
        row.updated_by = current_user.id
    else:
        row = RoomRate(**data.model_dump(), updated_by=current_user.id)
        db.add(row)
    db.commit()
    db.refresh(row)
    log_audit(db, current_user.id, current_user.full_name,
              AuditAction.UPDATE if before else AuditAction.CREATE, "room_rates", row.id,
              before_state=before, after_state=serialize_model(row), ip_address=request.client.host)
    return row


@router.get("/duty-rates", response_model=list[DutyRateOut])
async def list_duty_rates(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    out = []
    for rank_band, (label, default_amount) in DEFAULT_DUTY_RATES.items():
        row = db.query(DutyRate).filter(DutyRate.rank_band == rank_band).first()
        amount = float(row.da_amount) if row else float(default_amount)
        out.append(DutyRateOut(rank_band=rank_band, label=(row.label if row and row.label else label), da_amount=amount))
    return out


@router.put("/duty-rates")
async def upsert_duty_rate(data: DutyRateCreate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_edit(current_user)
    row = db.query(DutyRate).filter(DutyRate.rank_band == data.rank_band).first()
    before = serialize_model(row) if row else None
    if row:
        row.label = data.label
        row.da_amount = data.da_amount
        row.updated_by = current_user.id
    else:
        row = DutyRate(**data.model_dump(), updated_by=current_user.id)
        db.add(row)
    db.commit()
    db.refresh(row)
    log_audit(db, current_user.id, current_user.full_name,
              AuditAction.UPDATE if before else AuditAction.CREATE, "duty_rates", row.id,
              before_state=before, after_state=serialize_model(row), ip_address=request.client.host)
    return row


@router.get("/hra-rank-rates", response_model=list[HraRankRateOut])
async def list_hra_rank_rates(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    out = []
    for rank_band, (label, default_amount) in DEFAULT_HRA_RANK_RATES.items():
        row = db.query(HraRankRate).filter(HraRankRate.rank_band == rank_band).first()
        amount = float(row.monthly_amount) if row else float(default_amount)
        out.append(HraRankRateOut(rank_band=rank_band, label=(row.label if row and row.label else label), monthly_amount=amount))
    return out


@router.put("/hra-rank-rates")
async def upsert_hra_rank_rate(data: HraRankRateCreate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_edit(current_user)
    row = db.query(HraRankRate).filter(HraRankRate.rank_band == data.rank_band).first()
    before = serialize_model(row) if row else None
    if row:
        row.label = data.label
        row.monthly_amount = data.monthly_amount
        row.updated_by = current_user.id
    else:
        row = HraRankRate(**data.model_dump(), updated_by=current_user.id)
        db.add(row)
    db.commit()
    db.refresh(row)
    log_audit(db, current_user.id, current_user.full_name,
              AuditAction.UPDATE if before else AuditAction.CREATE, "hra_rank_rates", row.id,
              before_state=before, after_state=serialize_model(row), ip_address=request.client.host)
    return row


@router.get("/hra-utility-rates", response_model=list[HraUtilityRateOut])
async def list_hra_utility_rates(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    out = []
    for key in DEFAULT_HRA_UTILITY_RATES:
        base_type = "suite" if key in ("suite_1ac", "suite_2ac") else key
        ac_count = 2 if key == "suite_2ac" else 1
        amount = get_hra_utility_rate(db, base_type, ac_count)
        out.append(HraUtilityRateOut(room_type=key, monthly_amount=amount))
    return out


@router.put("/hra-utility-rates")
async def upsert_hra_utility_rate(data: HraUtilityRateCreate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _require_edit(current_user)
    row = db.query(HraUtilityRate).filter(HraUtilityRate.room_type == data.room_type).first()
    before = serialize_model(row) if row else None
    if row:
        row.monthly_amount = data.monthly_amount
        row.updated_by = current_user.id
    else:
        row = HraUtilityRate(**data.model_dump(), updated_by=current_user.id)
        db.add(row)
    db.commit()
    db.refresh(row)
    log_audit(db, current_user.id, current_user.full_name,
              AuditAction.UPDATE if before else AuditAction.CREATE, "hra_utility_rates", row.id,
              before_state=before, after_state=serialize_model(row), ip_address=request.client.host)
    return row
