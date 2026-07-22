"""Dynamic tariff matrix: rank x room_type x stay_type -> nightly rate.
Optional override layer in front of the existing rate-card/duty/HRA engine
(backend/services/room_pricing.py) - a booking only uses a tariff row when
one exists for its exact rank/room_type/stay_type combination."""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.models import TariffRate
from backend.schemas import TariffRateCreate, TariffRateOut
from backend.auth import get_current_user, check_permission
from backend.audit import log_audit, serialize_model, AuditAction
from backend.services.room_pricing import get_tariff_rate

router = APIRouter()


@router.get("", response_model=list[TariffRateOut])
async def list_tariffs(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    return db.query(TariffRate).order_by(TariffRate.rank, TariffRate.room_type, TariffRate.stay_type).all()


@router.get("/lookup")
async def lookup_tariff(rank: str, room_type: str, stay_type: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    rate = get_tariff_rate(db, rank, room_type, stay_type)
    return {"nightly_rate": rate}


@router.put("")
async def upsert_tariff(data: TariffRateCreate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "tariffs", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    row = db.query(TariffRate).filter(
        TariffRate.rank == data.rank, TariffRate.room_type == data.room_type, TariffRate.stay_type == data.stay_type,
    ).first()
    before = serialize_model(row) if row else None
    if row:
        row.nightly_rate = data.nightly_rate
        row.updated_by = current_user.id
    else:
        row = TariffRate(**data.model_dump(), updated_by=current_user.id)
        db.add(row)
    db.commit()
    db.refresh(row)

    log_audit(db, current_user.id, current_user.full_name,
              AuditAction.UPDATE if before else AuditAction.CREATE, "tariff_rates", row.id,
              before_state=before, after_state=serialize_model(row), ip_address=request.client.host)
    return row


@router.delete("/{tariff_id}")
async def delete_tariff(tariff_id: int, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "tariffs", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    row = db.query(TariffRate).filter(TariffRate.id == tariff_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Tariff not found")
    before = serialize_model(row)
    db.delete(row)
    db.commit()
    log_audit(db, current_user.id, current_user.full_name, AuditAction.SOFT_DELETE, "tariff_rates", tariff_id,
              before_state=before, reason="Tariff row removed", ip_address=request.client.host)
    return {"message": "Tariff removed"}
