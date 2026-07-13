"""Guest identity lookup - search-as-you-type support for check-in autocomplete."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.models import Guest
from backend.schemas import GuestOut
from backend.auth import get_current_user

router = APIRouter()


@router.get("/search", response_model=list[GuestOut])
async def search_guests(q: str = Query(..., min_length=2), db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    return db.query(Guest).filter(
        (Guest.full_name.contains(q)) | (Guest.phone.contains(q)) | (Guest.id_number.contains(q))
    ).order_by(Guest.updated_at.desc()).limit(8).all()
