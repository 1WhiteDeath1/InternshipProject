"""Bookings and room management router."""
import uuid
from datetime import datetime, date
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, or_
from backend.database import get_db
from backend.models import Room, Booking, GuestMovement, RoomStatus, BookingStatus, Invoice, InvoiceStatus
from backend.schemas import BookingCreate, BookingUpdate
from backend.auth import get_current_user, check_permission
from backend.audit import log_audit, serialize_model, AuditAction
from backend.logging_config import get_logger
from backend.services.mess_billing_calc import get_setting_float

logger = get_logger("app")
router = APIRouter()


# --- Rooms ---

@router.get("/rooms")
async def list_rooms(
    status: str = "", floor: int = 0, room_type: str = "",
    page: int = Query(1, ge=1), page_size: int = Query(50, ge=1),
    db: Session = Depends(get_db), current_user=Depends(get_current_user),
):
    query = db.query(Room).filter(Room.is_active == True)
    if status:
        query = query.filter(Room.status == status)
    if floor:
        query = query.filter(Room.floor == floor)
    if room_type:
        query = query.filter(Room.room_type == room_type)

    total = query.count()
    rooms = query.order_by(Room.room_number).offset((page - 1) * page_size).limit(page_size).all()

    # One query for all active bookings across these rooms instead of one query per room.
    room_ids = [r.id for r in rooms]
    active_by_room = {}
    if room_ids:
        active_bookings = db.query(Booking).filter(
            Booking.room_id.in_(room_ids),
            Booking.status.in_(["checked_in"]),
        ).order_by(Booking.created_at.desc()).all()
        for b in active_bookings:
            active_by_room.setdefault(b.room_id, b)  # first (most recent) wins per room

    result = []
    for r in rooms:
        current_guest = None
        check_out = None
        if r.status == RoomStatus.OCCUPIED:
            active = active_by_room.get(r.id)
            if active:
                current_guest = active.guest_name
                check_out = active.check_out

        result.append({
            "id": r.id, "room_number": r.room_number, "room_type": r.room_type.value,
            "floor": r.floor, "capacity": r.capacity, "base_price": float(r.base_price),
            "amenities": r.amenities, "status": r.status.value,
            "current_guest": current_guest, "current_check_out": check_out,
            "is_active": r.is_active,
        })

    return {"items": result, "total": total, "page": page, "page_size": page_size}


@router.post("/rooms")
async def create_room(data: dict, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "bookings", "create"):
        raise HTTPException(status_code=403, detail="Permission denied")
    room = Room(
        room_number=data["room_number"], room_type=data["room_type"],
        floor=data.get("floor", 1), capacity=data.get("capacity", 2),
        base_price=data["base_price"], amenities=data.get("amenities"),
    )
    db.add(room)
    db.commit()
    db.refresh(room)
    log_audit(db, current_user.id, current_user.full_name, AuditAction.CREATE, "rooms", room.id, after_state=serialize_model(room), ip_address=request.client.host)
    return room


@router.put("/rooms/{room_id}")
async def update_room(room_id: int, data: dict, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "bookings", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    before = serialize_model(room)
    for field in ["room_type", "floor", "capacity", "base_price", "amenities", "status"]:
        if field in data:
            setattr(room, field, data[field])
    db.commit()
    db.refresh(room)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "rooms", room.id, before_state=before, after_state=serialize_model(room), ip_address=request.client.host)
    return room


# --- Bookings ---

@router.get("")
async def list_bookings(
    status: str = "", search: str = "", room_id: int = 0,
    page: int = Query(1, ge=1), page_size: int = Query(25, ge=1),
    db: Session = Depends(get_db), current_user=Depends(get_current_user),
):
    query = db.query(Booking)
    if status:
        query = query.filter(Booking.status == status)
    if search:
        query = query.filter(
            (Booking.guest_name.contains(search)) |
            (Booking.guest_phone.contains(search)) |
            (Booking.booking_reference.contains(search))
        )
    if room_id:
        query = query.filter(Booking.room_id == room_id)

    total = query.count()
    bookings = query.order_by(Booking.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()

    return {"items": [
        {"id": b.id, "booking_reference": b.booking_reference, "guest_name": b.guest_name,
         "guest_phone": b.guest_phone, "guest_email": b.guest_email,
         "room_id": b.room_id, "room_number": b.room.room_number if b.room else None,
         "check_in": b.check_in, "check_out": b.check_out,
         "adults": b.adults, "children": b.children,
         "status": b.status.value, "special_requests": b.special_requests,
         "total_amount": float(b.total_amount) if b.total_amount else None,
         "client_category": b.client_category.value if b.client_category else None,
         "member_id": b.member_id, "member_name": b.member.full_name if b.member else None,
         "created_at": b.created_at} for b in bookings], "total": total}


@router.post("")
async def create_booking(data: BookingCreate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "bookings", "create"):
        raise HTTPException(status_code=403, detail="Permission denied")

    # Double-booking check
    existing = db.query(Booking).filter(
        Booking.room_id == data.room_id,
        Booking.status.in_(["confirmed", "checked_in"]),
        Booking.check_in < data.check_out,
        Booking.check_out > data.check_in,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Room is not available for these dates. Overlaps with booking {existing.booking_reference}")

    # Check room status
    room = db.query(Room).filter(Room.id == data.room_id).first()
    if not room or room.status == "maintenance":
        raise HTTPException(status_code=400, detail="Room is not available")

    nights = (data.check_out - data.check_in).days
    nightly_rate = float(room.base_price)
    if data.member_id:
        # Permanent members may have a preferential negotiated room rate.
        member_rate = get_setting_float(db, "member_room_night_rate", 0.0)
        if member_rate > 0:
            nightly_rate = member_rate
    total = nightly_rate * max(nights, 1)

    booking = Booking(
        booking_reference=f"TMP-{uuid.uuid4().hex}", guest_name=data.guest_name, guest_phone=data.guest_phone,
        guest_email=data.guest_email, guest_id_type=data.guest_id_type,
        guest_id_number=data.guest_id_number, room_id=data.room_id,
        check_in=data.check_in, check_out=data.check_out,
        adults=data.adults, children=data.children,
        status="confirmed", special_requests=data.special_requests,
        client_category=data.client_category, member_id=data.member_id,
        total_amount=total, processed_by=current_user.id,
    )
    db.add(booking)

    room.status = RoomStatus.RESERVED
    db.commit()
    db.refresh(booking)

    # Friendly reference derived from the autoincrement id (assigned above), not a
    # pre-insert count() - avoids a race where two concurrent creates generate the
    # same reference.
    booking.booking_reference = f"BK-{datetime.utcnow().strftime('%Y%m%d')}-{booking.id:04d}"
    db.commit()
    db.refresh(booking)

    # Post-commit re-check: SQLite serializes commits, so any truly concurrent request
    # that also passed the pre-check above is guaranteed visible here too. Resolve any
    # conflict deterministically in favor of the lowest booking id.
    overlapping = db.query(Booking).filter(
        Booking.room_id == data.room_id,
        Booking.status.in_(["confirmed", "checked_in"]),
        Booking.check_in < data.check_out,
        Booking.check_out > data.check_in,
    ).order_by(Booking.id.asc()).all()
    if overlapping and overlapping[0].id != booking.id:
        booking.status = BookingStatus.CANCELLED
        db.commit()
        still_active = db.query(Booking).filter(
            Booking.room_id == data.room_id,
            Booking.status.in_(["confirmed", "checked_in"]),
        ).first()
        room.status = RoomStatus.RESERVED if still_active else RoomStatus.VACANT
        db.commit()
        raise HTTPException(status_code=409, detail=f"Room is not available for these dates. Overlaps with booking {overlapping[0].booking_reference}")

    log_audit(db, current_user.id, current_user.full_name, AuditAction.CREATE, "bookings", booking.id, after_state=serialize_model(booking), ip_address=request.client.host)
    return {"id": booking.id, "booking_reference": booking.booking_reference, "status": booking.status.value, "total_amount": total}


@router.put("/{booking_id}")
async def update_booking(booking_id: int, data: BookingUpdate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "bookings", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    booking = db.query(Booking).filter(Booking.id == booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    before = serialize_model(booking)
    for field, value in data.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(booking, field, value)
    db.commit()
    db.refresh(booking)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "bookings", booking.id, before_state=before, after_state=serialize_model(booking), ip_address=request.client.host)
    return booking


@router.post("/{booking_id}/check-in")
async def check_in(booking_id: int, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "bookings", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    booking = db.query(Booking).filter(Booking.id == booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking.status != "confirmed":
        raise HTTPException(status_code=400, detail="Booking must be confirmed to check in")

    booking.status = BookingStatus.CHECKED_IN
    booking.room.status = RoomStatus.OCCUPIED
    db.commit()

    movement = GuestMovement(
        booking_id=booking.id, movement_type="check_in",
        to_room_id=booking.room_id, processed_by=current_user.id,
        notes=f"Guest {booking.guest_name} checked in",
    )
    db.add(movement)
    db.commit()

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "bookings", booking.id, reason="Check-in", ip_address=request.client.host)
    return {"message": "Guest checked in successfully"}


@router.post("/{booking_id}/check-out")
async def check_out(booking_id: int, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "bookings", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    booking = db.query(Booking).filter(Booking.id == booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking.status != BookingStatus.CHECKED_IN:
        raise HTTPException(status_code=400, detail="Guest must be checked in first")

    booking.status = BookingStatus.CHECKED_OUT
    booking.room.status = RoomStatus.VACANT
    db.commit()

    movement = GuestMovement(
        booking_id=booking.id, movement_type="check_out",
        from_room_id=booking.room_id, processed_by=current_user.id,
        notes=f"Guest {booking.guest_name} checked out",
    )
    db.add(movement)
    db.commit()

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "bookings", booking.id, reason="Check-out", ip_address=request.client.host)
    return {"message": "Guest checked out successfully"}


@router.get("/guest-movements")
async def list_movements(booking_id: int = 0, page: int = Query(1, ge=1), page_size: int = Query(25, ge=1), db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    query = db.query(GuestMovement)
    if booking_id:
        query = query.filter(GuestMovement.booking_id == booking_id)
    total = query.count()
    movements = query.order_by(GuestMovement.timestamp.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {"items": movements, "total": total}


# --- Occupancy ---

@router.get("/occupancy")
async def get_occupancy(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    total_rooms = db.query(Room).filter(Room.is_active == True).count()
    occupied = db.query(Room).filter(Room.status == RoomStatus.OCCUPIED).count()
    reserved = db.query(Room).filter(Room.status == RoomStatus.RESERVED).count()
    maintenance = db.query(Room).filter(Room.status == RoomStatus.MAINTENANCE).count()
    vacant = total_rooms - occupied - reserved - maintenance

    today = date.today()
    arrivals = db.query(Booking).filter(Booking.check_in == today, Booking.status == "confirmed").count()
    departures = db.query(Booking).filter(Booking.check_out == today, Booking.status == "checked_in").count()

    return {
        "total_rooms": total_rooms, "occupied": occupied, "reserved": reserved,
        "vacant": vacant, "maintenance": maintenance,
        "occupancy_rate": round(occupied / total_rooms * 100, 1) if total_rooms else 0,
        "today_arrivals": arrivals, "today_departures": departures,
    }
