"""Guest identity - search-as-you-type support for check-in autocomplete, plus
the Customer Directory (list + full profile with stay/billing history)."""
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.models import Guest, Booking, Invoice
from backend.schemas import GuestOut, GuestListResponse, GuestListItem, GuestProfileOut, GuestBookingSummary, GuestInvoiceSummary, GuestQuickCreate
from backend.auth import get_current_user, check_permission
from backend.audit import log_audit, serialize_model, AuditAction

router = APIRouter()


@router.get("/search", response_model=list[GuestOut])
async def search_guests(q: str = Query(..., min_length=2), db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    # Also usable via bookings:view - Booking NCO doesn't hold the Customer
    # Directory permission, but still needs this for the check-in form's
    # name/CNIC autocomplete (_find_or_create_guest matching).
    if not (check_permission(current_user, "guests", "view") or check_permission(current_user, "bookings", "view")):
        raise HTTPException(status_code=403, detail="Permission denied")
    guests = db.query(Guest).filter(
        (Guest.full_name.contains(q)) | (Guest.phone.contains(q)) | (Guest.id_number.contains(q))
    ).order_by(Guest.updated_at.desc()).limit(8).all()
    results = []
    for g in guests:
        latest = db.query(Booking).filter(Booking.guest_id == g.id).order_by(Booking.check_in.desc()).first()
        results.append(GuestOut(
            id=g.id, full_name=g.full_name, phone=g.phone, id_type=g.id_type,
            id_number=g.id_number, unit_address=g.unit_address,
            last_client_category=latest.client_category.value if latest else None,
            last_rank=latest.rank if latest else None,
            last_nature_of_duty=latest.nature_of_duty if latest and latest.nature_of_duty != "hra" else None,
            last_stay_type=latest.stay_type if latest else None,
        ))
    return results


@router.post("", response_model=GuestOut)
async def quick_create_guest(data: GuestQuickCreate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Minimal identity-only creation for a walk-in with no room booking (e.g.
    a non-member added straight from the meal attendance omnibar) - just a
    name, optionally a phone number. Full guest records with ID/address still
    come from the booking check-in flow (_find_or_create_guest in bookings.py)."""
    if not check_permission(current_user, "guests", "create"):
        raise HTTPException(status_code=403, detail="Permission denied")
    guest = Guest(full_name=data.full_name.strip(), phone=data.phone)
    db.add(guest)
    db.commit()
    db.refresh(guest)
    log_audit(db, current_user.id, current_user.full_name, AuditAction.CREATE, "guests", guest.id, after_state=serialize_model(guest), ip_address=request.client.host)
    return guest


@router.get("", response_model=GuestListResponse)
async def list_guests(
    q: str = "", page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db), current_user=Depends(get_current_user),
):
    if not check_permission(current_user, "guests", "view"):
        raise HTTPException(status_code=403, detail="Permission denied")
    query = db.query(Guest)
    if q:
        query = query.filter(
            (Guest.full_name.contains(q)) | (Guest.phone.contains(q)) | (Guest.id_number.contains(q))
        )
    total = query.count()
    guests = query.order_by(Guest.full_name).offset((page - 1) * page_size).limit(page_size).all()

    items = []
    for g in guests:
        bookings = db.query(Booking).filter(Booking.guest_id == g.id).order_by(Booking.check_in.desc()).all()
        latest = bookings[0] if bookings else None
        items.append(GuestListItem(
            id=g.id, full_name=g.full_name, id_number=g.id_number, phone=g.phone,
            classification=latest.client_category.value if latest else None,
            rank=latest.rank if latest else None,
            last_arrival_date=latest.check_in if latest else None,
            total_arrivals=len(bookings),
        ))
    return GuestListResponse(items=items, total=total, page=page, page_size=page_size)


@router.get("/{guest_id}", response_model=GuestProfileOut)
async def get_guest_profile(guest_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "guests", "view"):
        raise HTTPException(status_code=403, detail="Permission denied")
    guest = db.query(Guest).filter(Guest.id == guest_id).first()
    if not guest:
        raise HTTPException(status_code=404, detail="Guest not found")

    bookings = db.query(Booking).filter(Booking.guest_id == guest_id).order_by(Booking.check_in.desc()).all()
    booking_summaries = [
        GuestBookingSummary(
            id=b.id, booking_reference=b.booking_reference,
            room_number=b.room.room_number if b.room else None,
            check_in=b.check_in, check_out=b.check_out, status=b.status.value,
            rank=b.rank, client_category=b.client_category.value,
            total_amount=float(b.total_amount) if b.total_amount is not None else None,
        ) for b in bookings
    ]

    booking_ids = [b.id for b in bookings]
    invoices = (
        db.query(Invoice).filter(Invoice.booking_id.in_(booking_ids)).order_by(Invoice.issue_date.desc()).all()
        if booking_ids else []
    )
    invoice_summaries = [
        GuestInvoiceSummary(
            id=i.id, invoice_number=i.invoice_number, bill_type=i.bill_type or "combined",
            issue_date=i.issue_date, total_amount=float(i.total_amount), amount_paid=float(i.amount_paid or 0),
            status=i.status.value, is_complimentary=bool(i.is_complimentary),
        ) for i in invoices
    ]

    return GuestProfileOut(
        id=guest.id, full_name=guest.full_name, phone=guest.phone, id_type=guest.id_type,
        id_number=guest.id_number, unit_address=guest.unit_address,
        created_at=guest.created_at, updated_at=guest.updated_at,
        bookings=booking_summaries, invoices=invoice_summaries,
    )
