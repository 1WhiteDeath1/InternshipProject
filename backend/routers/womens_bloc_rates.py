"""Women's Bloc monthly rank-rate CRUD - same rank bands as HraRankRate, a
separate table since the two are orthogonal (a resident can be Women's Bloc
and keep their existing officers/jcos/ors mess_category). Mirrors
backend/routers/tariffs.py's upsert-by-natural-key pattern, the one working
precedent for this class of admin-editable rate table."""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.models import WomensBlocRankRate
from backend.schemas import WomensBlocRankRateCreate, WomensBlocRankRateOut
from backend.auth import get_current_user, check_permission
from backend.audit import log_audit, serialize_model, AuditAction

router = APIRouter()


@router.get("", response_model=list[WomensBlocRankRateOut])
async def list_womens_bloc_rates(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    return db.query(WomensBlocRankRate).order_by(WomensBlocRankRate.rank_band).all()


@router.put("")
async def upsert_womens_bloc_rate(data: WomensBlocRankRateCreate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "bookings", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    row = db.query(WomensBlocRankRate).filter(WomensBlocRankRate.rank_band == data.rank_band).first()
    before = serialize_model(row) if row else None
    if row:
        row.label = data.label
        row.monthly_amount = data.monthly_amount
        row.updated_by = current_user.id
    else:
        row = WomensBlocRankRate(**data.model_dump(), updated_by=current_user.id)
        db.add(row)
    db.commit()
    db.refresh(row)

    log_audit(db, current_user.id, current_user.full_name,
              AuditAction.UPDATE if before else AuditAction.CREATE, "womens_bloc_rank_rates", row.id,
              before_state=before, after_state=serialize_model(row), ip_address=request.client.host)
    return row


@router.delete("/{rate_id}")
async def delete_womens_bloc_rate(rate_id: int, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "bookings", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    row = db.query(WomensBlocRankRate).filter(WomensBlocRankRate.id == rate_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Rate not found")
    before = serialize_model(row)
    db.delete(row)
    db.commit()
    log_audit(db, current_user.id, current_user.full_name, AuditAction.SOFT_DELETE, "womens_bloc_rank_rates", rate_id,
              before_state=before, reason="Rate row removed", ip_address=request.client.host)
    return {"message": "Rate removed"}
