"""Bookings and room management router.

Occupancy is DERIVED from bookings + today's date, never trusted from the
stored Room.status column (which only remains authoritative for
maintenance). This is what lets the same room hold multiple future
bookings and still show as bookable today.
"""
import json
import uuid
from math import ceil
from datetime import datetime, date, time, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile, File
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.config import UPLOADS_DIR
from backend.models import (
    Room, Booking, GuestMovement, RoomStatus, BookingStatus,
    RoomRate, DutyRate, RoomPhoto, Member, MemberStatus,
)
from backend.schemas import BookingCreate, BookingUpdate
from backend.auth import get_current_user, check_permission, require_supervisor
from backend.audit import log_audit, serialize_model, AuditAction
from backend.logging_config import get_logger
from backend.services.mess_billing_calc import get_setting_float
from backend.services.room_pricing import (
    compute_booking_price, get_room_rate, get_duty_rate,
    DEFAULT_ROOM_RATES, DEFAULT_DUTY_RATES, RATE_COMPONENTS,
)

logger = get_logger("app")
router = APIRouter()

ROOM_PHOTOS_DIR = UPLOADS_DIR / "rooms"
ROOM_PHOTOS_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_PHOTO_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}


def _photo_list(db: Session, room_id: int):
    photos = db.query(RoomPhoto).filter(RoomPhoto.room_id == room_id).order_by(RoomPhoto.sort_order, RoomPhoto.id).all()
    return [{"id": p.id, "url": f"/uploads/rooms/{room_id}/{p.file_name}"} for p in photos]

ACTIVE_STATUSES = ("confirmed", "checked_in")
HOUSEKEEPING_STATES = ("clean", "dirty", "cleaning")


def _derived_states(db: Session, rooms, today: date):
    """Compute each room's live status for *today* from its bookings.

    Priority: occupied (checked-in guest) > maintenance (stored override)
    > reserved (confirmed booking covering today) > vacant.
    Returns {room_id: {"status", "current", "arrival"}}.
    """
    room_ids = [r.id for r in rooms]
    states = {r.id: {"status": "vacant", "current": None, "arrival": None} for r in rooms}
    if not room_ids:
        return states

    checked_in = db.query(Booking).filter(
        Booking.room_id.in_(room_ids), Booking.status == BookingStatus.CHECKED_IN,
    ).order_by(Booking.created_at.desc()).all()
    for b in checked_in:
        if states[b.room_id]["current"] is None:
            states[b.room_id].update(status="occupied", current=b)

    covering = db.query(Booking).filter(
        Booking.room_id.in_(room_ids), Booking.status == BookingStatus.CONFIRMED,
        Booking.check_in <= today, Booking.check_out > today,
    ).order_by(Booking.check_in.asc()).all()
    for b in covering:
        s = states[b.room_id]
        if s["arrival"] is None:
            s["arrival"] = b
        if s["status"] == "vacant":
            s["status"] = "reserved"

    for r in rooms:
        if r.status == RoomStatus.MAINTENANCE and states[r.id]["status"] != "occupied":
            states[r.id]["status"] = "maintenance"
    return states


# --- Rooms ---

@router.get("/rooms")
async def list_rooms(
    status: str = "", floor: int = 0, room_type: str = "",
    page: int = Query(1, ge=1), page_size: int = Query(50, ge=1),
    db: Session = Depends(get_db), current_user=Depends(get_current_user),
):
    query = db.query(Room).filter(Room.is_active == True)
    if floor:
        query = query.filter(Room.floor == floor)
    if room_type:
        query = query.filter(Room.room_type == room_type)

    total = query.count()
    rooms = query.order_by(Room.room_number).offset((page - 1) * page_size).limit(page_size).all()
    states = _derived_states(db, rooms, date.today())

    result = []
    for r in rooms:
        st = states[r.id]
        current, arrival = st["current"], st["arrival"]
        if status and st["status"] != status:
            continue
        result.append({
            "id": r.id, "room_number": r.room_number, "room_type": r.room_type.value,
            "floor": r.floor, "capacity": r.capacity, "base_price": float(r.base_price),
            "amenities": r.amenities, "status": st["status"],
            "housekeeping_status": r.housekeeping_status or "clean",
            "current_guest": current.guest_name if current else None,
            "current_check_out": current.check_out if current else None,
            "current_booking_id": current.id if current else None,
            "current_nature_of_duty": current.nature_of_duty if current else None,
            "arrival_guest": arrival.guest_name if arrival else None,
            "arrival_booking_id": arrival.id if arrival else None,
            "arrival_nature_of_duty": arrival.nature_of_duty if arrival else None,
            "is_active": r.is_active,
            "photos": _photo_list(db, r.id),
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


@router.post("/rooms/{room_id}/photos")
async def upload_room_photo(room_id: int, request: Request, file: UploadFile = File(...), db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "bookings", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    ext = ALLOWED_PHOTO_TYPES.get(file.content_type)
    if not ext:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, or WEBP images are allowed")

    contents = await file.read()
    if len(contents) > 8 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Photo must be under 8MB")

    room_dir = ROOM_PHOTOS_DIR / str(room_id)
    room_dir.mkdir(parents=True, exist_ok=True)
    file_name = f"{uuid.uuid4().hex}.{ext}"
    (room_dir / file_name).write_bytes(contents)

    next_order = (db.query(RoomPhoto).filter(RoomPhoto.room_id == room_id).count())
    photo = RoomPhoto(room_id=room_id, file_name=file_name, sort_order=next_order, uploaded_by=current_user.id)
    db.add(photo)
    db.commit()

    log_audit(db, current_user.id, current_user.full_name, AuditAction.CREATE, "room_photos", photo.id,
              after_state={"room_id": room_id, "file_name": file_name}, ip_address=request.client.host)
    return {"photos": _photo_list(db, room_id)}


@router.delete("/rooms/{room_id}/photos/{photo_id}")
async def delete_room_photo(room_id: int, photo_id: int, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "bookings", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    photo = db.query(RoomPhoto).filter(RoomPhoto.id == photo_id, RoomPhoto.room_id == room_id).first()
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")

    file_path = ROOM_PHOTOS_DIR / str(room_id) / photo.file_name
    file_path.unlink(missing_ok=True)
    db.delete(photo)
    db.commit()

    log_audit(db, current_user.id, current_user.full_name, AuditAction.SOFT_DELETE, "room_photos", photo_id,
              reason="Photo removed", ip_address=request.client.host)
    return {"photos": _photo_list(db, room_id)}


@router.put("/rooms/{room_id}/housekeeping")
async def set_housekeeping(room_id: int, data: dict, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "bookings", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    new_status = (data or {}).get("status", "")
    if new_status not in HOUSEKEEPING_STATES:
        raise HTTPException(status_code=400, detail=f"status must be one of {', '.join(HOUSEKEEPING_STATES)}")
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    before = room.housekeeping_status
    room.housekeeping_status = new_status
    db.commit()
    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "rooms", room.id,
              before_state={"housekeeping_status": before}, after_state={"housekeeping_status": new_status},
              reason="Housekeeping update", ip_address=request.client.host)
    return {"message": f"Room {room.room_number} marked {new_status}", "housekeeping_status": new_status}


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


@router.get("/rooms/{room_id}/calendar")
async def room_calendar(
    room_id: int, year: int = 0, month: int = 0,
    db: Session = Depends(get_db), current_user=Depends(get_current_user),
):
    """A month of stays for one room - feeds the room detail panel."""
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    today = date.today()
    year = year or today.year
    month = month or today.month
    if not 1 <= month <= 12:
        raise HTTPException(status_code=400, detail="month must be 1-12")
    month_start = date(year, month, 1)
    month_end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)

    bookings = db.query(Booking).filter(
        Booking.room_id == room_id,
        Booking.status.in_(["confirmed", "checked_in", "checked_out"]),
        Booking.check_in < month_end,
        Booking.check_out > month_start,
    ).order_by(Booking.check_in.asc()).all()

    states = _derived_states(db, [room], today)[room.id]
    current = states["current"]

    return {
        "room": {
            "id": room.id, "room_number": room.room_number, "room_type": room.room_type.value,
            "floor": room.floor, "capacity": room.capacity, "base_price": float(room.base_price),
            "status": states["status"], "housekeeping_status": room.housekeeping_status or "clean",
            "photos": _photo_list(db, room.id),
        },
        "current_booking": {
            "id": current.id, "booking_reference": current.booking_reference,
            "guest_name": current.guest_name, "guest_phone": current.guest_phone,
            "rank": current.rank, "check_in": current.check_in, "check_out": current.check_out,
            "total_amount": float(current.total_amount) if current.total_amount else 0,
            "nature_of_duty": current.nature_of_duty,
        } if current else None,
        "year": year, "month": month,
        "stays": [{
            "id": b.id, "booking_reference": b.booking_reference, "guest_name": b.guest_name,
            "status": b.status.value, "check_in": b.check_in, "check_out": b.check_out,
            "nature_of_duty": b.nature_of_duty,
        } for b in bookings],
    }


# --- Availability (date-first booking flow) ---

@router.get("/availability")
async def availability(
    check_in: date, check_out: date,
    client_category: str = "civilian", nature_of_duty: str = "visit",
    rank: str = "", da_multiplier: float = 0, mattress_count: int = 0,
    member_id: int = 0, include_booked: bool = False, room_id: int = 0,
    db: Session = Depends(get_db), current_user=Depends(get_current_user),
):
    """All rooms priced for a prospective stay, with conflicts computed by
    date overlap - the single source of truth for 'what can I sell'.

    Pass room_id to scope this to one room - used as a single-room price
    quote (e.g. the in-panel booking form) instead of a duplicate endpoint;
    include_booked is implied true in that case so a conflicting room still
    returns its pricing/conflict details rather than an empty result."""
    if check_out <= check_in:
        raise HTTPException(status_code=400, detail="check_out must be after check_in")

    query = db.query(Room).filter(Room.is_active == True)
    if room_id:
        query = query.filter(Room.id == room_id)
        include_booked = True
    rooms = query.order_by(Room.room_number).all()
    room_ids = [r.id for r in rooms]
    if room_id and not rooms:
        raise HTTPException(status_code=404, detail="Room not found")

    conflicts = {}
    next_start = {}
    if room_ids:
        overlapping = db.query(Booking).filter(
            Booking.room_id.in_(room_ids), Booking.status.in_(ACTIVE_STATUSES),
            Booking.check_in < check_out, Booking.check_out > check_in,
        ).order_by(Booking.check_in.asc()).all()
        for b in overlapping:
            conflicts.setdefault(b.room_id, b)

        upcoming = db.query(Booking).filter(
            Booking.room_id.in_(room_ids), Booking.status.in_(ACTIVE_STATUSES),
            Booking.check_in >= check_in,
        ).order_by(Booking.check_in.asc()).all()
        for b in upcoming:
            next_start.setdefault(b.room_id, b.check_in)

    items = []
    for r in rooms:
        conflict = conflicts.get(r.id)
        in_maintenance = r.status == RoomStatus.MAINTENANCE
        is_available = conflict is None and not in_maintenance
        if not is_available and not include_booked:
            continue

        pricing = compute_booking_price(
            db, r, check_in=check_in, check_out=check_out,
            client_category=client_category, nature_of_duty=nature_of_duty,
            rank=rank or None, da_multiplier=da_multiplier or None,
            mattress_count=mattress_count, member_id=member_id or None,
        )
        items.append({
            "id": r.id, "room_number": r.room_number, "room_type": r.room_type.value,
            "floor": r.floor, "capacity": r.capacity,
            "housekeeping_status": r.housekeeping_status or "clean",
            "available": is_available,
            "unavailable_reason": "maintenance" if in_maintenance else (
                f"Booked {conflict.check_in.strftime('%d %b')}-{conflict.check_out.strftime('%d %b')} "
                f"({conflict.guest_name}, {conflict.booking_reference})" if conflict else None),
            "next_booking_start": next_start.get(r.id),
            "pricing": pricing,
        })

    return {"items": items, "check_in": check_in, "check_out": check_out, "total": len(items)}


@router.get("/timeline")
async def timeline(
    days: int = Query(7, ge=1, le=31), start: date = None,
    db: Session = Depends(get_db), current_user=Depends(get_current_user),
):
    """Per-room, per-day state over a date window - one query binned in
    Python, powers the 7-Day Overview page. Maintenance is a persistent
    room flag (not date-ranged), so it applies uniformly across the window;
    everything else is derived from booking overlap same as elsewhere."""
    start = start or date.today()
    window_end = start + timedelta(days=days)
    date_list = [start + timedelta(days=i) for i in range(days)]

    rooms = db.query(Room).filter(Room.is_active == True).order_by(Room.floor, Room.room_number).all()
    room_ids = [r.id for r in rooms]

    by_room_day = {}
    if room_ids:
        bookings = db.query(Booking).filter(
            Booking.room_id.in_(room_ids), Booking.status.in_(ACTIVE_STATUSES),
            Booking.check_in < window_end, Booking.check_out > start,
        ).all()
        priority = {"checked_in": 2, "confirmed": 1}
        for b in bookings:
            for d in date_list:
                if b.check_in <= d < b.check_out:
                    slot = by_room_day.setdefault((b.room_id, d), None)
                    if slot is None or priority.get(b.status.value, 0) > priority.get(slot.status.value, 0):
                        by_room_day[(b.room_id, d)] = b

    result = []
    for r in rooms:
        in_maintenance = r.status == RoomStatus.MAINTENANCE
        cells = []
        for d in date_list:
            booking = by_room_day.get((r.id, d))
            if in_maintenance:
                cells.append({"date": d, "status": "maintenance", "guest_name": None, "booking_reference": None})
            elif booking:
                status = "occupied" if booking.status == BookingStatus.CHECKED_IN else "reserved"
                cells.append({"date": d, "status": status, "guest_name": booking.guest_name, "booking_reference": booking.booking_reference})
            else:
                cells.append({"date": d, "status": "vacant", "guest_name": None, "booking_reference": None})
        result.append({
            "id": r.id, "room_number": r.room_number, "room_type": r.room_type.value,
            "floor": r.floor, "cells": cells,
        })

    return {"start": start, "days": days, "dates": date_list, "rooms": result}


# --- Rate card ---

@router.get("/rates")
async def get_rates(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Effective rate card: DB rows where entered, defaults elsewhere."""
    room_types = sorted(set(DEFAULT_ROOM_RATES) | {r.room_type for r in db.query(RoomRate).all()})
    matrix = []
    for rt in room_types:
        for cat in ("serving_officer", "retired_officer", "civilian"):
            rate = get_room_rate(db, rt, cat)
            if rate:
                matrix.append({"room_type": rt, "guest_category": cat, **rate,
                               "total": round(sum(rate.values()), 2)})
    duty = []
    for band, (label, default_amount) in DEFAULT_DUTY_RATES.items():
        row = db.query(DutyRate).filter(DutyRate.rank_band == band).first()
        duty.append({"rank_band": band, "label": label,
                     "da_amount": float(row.da_amount) if row else default_amount})
    return {
        "room_rates": matrix,
        "duty_rates": duty,
        "mattress_officer_daily": get_setting_float(db, "mattress_officer_daily", 150.0),
        "mattress_civilian_daily": get_setting_float(db, "mattress_civilian_daily", 300.0),
        "late_checkout_fee_per_hour": get_setting_float(db, "late_checkout_fee_per_hour", 1000.0),
    }


@router.put("/rates")
async def update_rates(data: dict, request: Request, db: Session = Depends(get_db), current_user=Depends(require_supervisor)):
    """Upsert rate-card rows (supervisor only - rates change by official letter)."""
    updated = 0
    for entry in data.get("room_rates", []):
        rt, cat = entry.get("room_type"), entry.get("guest_category")
        if not rt or cat not in ("serving_officer", "retired_officer", "civilian"):
            raise HTTPException(status_code=400, detail="Each room rate needs a room_type and a valid guest_category")
        row = db.query(RoomRate).filter(RoomRate.room_type == rt, RoomRate.guest_category == cat).first()
        if not row:
            row = RoomRate(room_type=rt, guest_category=cat)
            db.add(row)
        for comp in RATE_COMPONENTS:
            if comp in entry:
                setattr(row, comp, float(entry[comp]))
        row.updated_by = current_user.id
        updated += 1
    for entry in data.get("duty_rates", []):
        band = entry.get("rank_band")
        if band not in DEFAULT_DUTY_RATES:
            raise HTTPException(status_code=400, detail=f"Unknown rank_band '{band}'")
        row = db.query(DutyRate).filter(DutyRate.rank_band == band).first()
        if not row:
            row = DutyRate(rank_band=band, label=DEFAULT_DUTY_RATES[band][0])
            db.add(row)
        row.da_amount = float(entry.get("da_amount", row.da_amount or DEFAULT_DUTY_RATES[band][1]))
        row.updated_by = current_user.id
        updated += 1
    db.commit()
    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "room_rates", 0,
              after_state=data, reason="Rate card revision", ip_address=request.client.host)
    return {"message": f"Updated {updated} rate entries"}


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
         "guest_id_type": b.guest_id_type, "guest_id_number": b.guest_id_number,
         "room_id": b.room_id, "room_number": b.room.room_number if b.room else None,
         "check_in": b.check_in, "check_out": b.check_out,
         "adults": b.adults, "children": b.children,
         "status": b.status.value, "special_requests": b.special_requests,
         "total_amount": float(b.total_amount) if b.total_amount else None,
         "client_category": b.client_category.value if b.client_category else None,
         "member_id": b.member_id, "member_name": b.member.full_name if b.member else None,
         "rank": b.rank, "pa_number": b.pa_number, "unit_address": b.unit_address,
         "nature_of_duty": b.nature_of_duty, "mattress_count": b.mattress_count or 0,
         "late_checkout_fee": float(b.late_checkout_fee) if b.late_checkout_fee else 0,
         "actual_check_in": b.actual_check_in, "actual_check_out": b.actual_check_out,
         "cancel_reason": b.cancel_reason,
         "created_at": b.created_at} for b in bookings], "total": total}


def _overlap_query(db: Session, room_id: int, check_in: date, check_out: date):
    return db.query(Booking).filter(
        Booking.room_id == room_id,
        Booking.status.in_(ACTIVE_STATUSES),
        Booking.check_in < check_out,
        Booking.check_out > check_in,
    )


def _do_check_in(db: Session, booking: Booking, current_user):
    booking.status = BookingStatus.CHECKED_IN
    booking.actual_check_in = datetime.now()
    booking.room.status = RoomStatus.OCCUPIED
    db.commit()
    db.add(GuestMovement(
        booking_id=booking.id, movement_type="check_in",
        to_room_id=booking.room_id, processed_by=current_user.id,
        notes=f"Guest {booking.guest_name} checked in",
    ))
    db.commit()


@router.post("")
async def create_booking(data: BookingCreate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "bookings", "create"):
        raise HTTPException(status_code=403, detail="Permission denied")

    if data.check_in_now and data.check_in != date.today():
        raise HTTPException(status_code=400, detail="Walk-in check-in requires the stay to start today")

    member = None
    if data.nature_of_duty == "hra":
        if not data.member_id:
            raise HTTPException(status_code=400, detail="HRA residency must be linked to a member - select one from the roster")
        member = db.query(Member).filter(Member.id == data.member_id).first()
        if not member:
            raise HTTPException(status_code=404, detail="Member not found")
        if member.status != MemberStatus.ACTIVE:
            raise HTTPException(status_code=400, detail="Member is not active")

    # HRA is an indefinite residency, not a dated stay - the client's checkout
    # choice is ignored and replaced with a long rolling window that gets
    # pushed forward automatically each time mess_billing.generate_bills
    # bills this resident (see that function). This lets occupancy/overlap/
    # timeline logic keep treating every booking as date-bounded, unchanged.
    check_out = data.check_in + timedelta(days=365) if data.nature_of_duty == "hra" else data.check_out

    existing = _overlap_query(db, data.room_id, data.check_in, check_out).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Room is not available for these dates. Overlaps with booking {existing.booking_reference}")

    room = db.query(Room).filter(Room.id == data.room_id).first()
    if not room or room.status == "maintenance":
        raise HTTPException(status_code=400, detail="Room is not available")

    pricing = compute_booking_price(
        db, room, check_in=data.check_in, check_out=check_out,
        client_category=data.client_category, nature_of_duty=data.nature_of_duty,
        rank=(member.rank if member else data.rank), da_multiplier=data.da_multiplier,
        mattress_count=data.mattress_count, member_id=data.member_id,
    )

    booking = Booking(
        booking_reference=f"TMP-{uuid.uuid4().hex}", guest_name=data.guest_name, guest_phone=data.guest_phone,
        guest_email=data.guest_email, guest_id_type=data.guest_id_type,
        guest_id_number=data.guest_id_number, room_id=data.room_id,
        check_in=data.check_in, check_out=check_out,
        adults=data.adults, children=data.children,
        status="confirmed", special_requests=data.special_requests,
        client_category=data.client_category, member_id=data.member_id,
        rank=(member.rank if member else data.rank), pa_number=data.pa_number, unit_address=data.unit_address,
        nature_of_duty=data.nature_of_duty, da_multiplier=data.da_multiplier,
        mattress_count=data.mattress_count,
        total_amount=pricing["total"], rate_breakdown=json.dumps(pricing),
        processed_by=current_user.id,
    )
    db.add(booking)
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
    overlapping = _overlap_query(db, data.room_id, data.check_in, check_out).order_by(Booking.id.asc()).all()
    if overlapping and overlapping[0].id != booking.id:
        booking.status = BookingStatus.CANCELLED
        booking.cancel_reason = "Auto-cancelled: concurrent double booking"
        db.commit()
        raise HTTPException(status_code=409, detail=f"Room is not available for these dates. Overlaps with booking {overlapping[0].booking_reference}")

    if data.check_in_now:
        _do_check_in(db, booking, current_user)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.CREATE, "bookings", booking.id, after_state=serialize_model(booking), ip_address=request.client.host)
    return {"id": booking.id, "booking_reference": booking.booking_reference,
            "status": booking.status.value, "total_amount": pricing["total"], "pricing": pricing}


@router.put("/{booking_id}")
async def update_booking(booking_id: int, data: BookingUpdate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "bookings", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    booking = db.query(Booking).filter(Booking.id == booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    before = serialize_model(booking)
    changes = data.model_dump(exclude_unset=True)
    new_check_in = changes.get("check_in", booking.check_in)
    new_check_out = changes.get("check_out", booking.check_out)
    new_room_id = changes.get("room_id", booking.room_id)
    if ("check_in" in changes or "check_out" in changes or "room_id" in changes):
        clash = _overlap_query(db, new_room_id, new_check_in, new_check_out).filter(Booking.id != booking.id).first()
        if clash:
            raise HTTPException(status_code=409, detail=f"New dates overlap with booking {clash.booking_reference}")

    for field, value in changes.items():
        if value is not None:
            setattr(booking, field, value)
    db.commit()
    db.refresh(booking)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "bookings", booking.id, before_state=before, after_state=serialize_model(booking), ip_address=request.client.host)
    return booking


@router.post("/{booking_id}/check-in")
async def check_in(booking_id: int, request: Request, force: bool = False, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "bookings", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    booking = db.query(Booking).filter(Booking.id == booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking.status != "confirmed":
        raise HTTPException(status_code=400, detail="Booking must be confirmed to check in")

    today = date.today()
    if booking.check_in > today and not force:
        raise HTTPException(status_code=400, detail=f"Booking is not due until {booking.check_in.strftime('%d %b %Y')}. Use force to check in early.")

    occupant = db.query(Booking).filter(
        Booking.room_id == booking.room_id, Booking.status == BookingStatus.CHECKED_IN,
    ).first()
    if occupant:
        raise HTTPException(status_code=409, detail=f"Room still occupied by {occupant.guest_name} ({occupant.booking_reference}) - check them out first")

    room = booking.room
    if (room.housekeeping_status or "clean") != "clean" and not force:
        raise HTTPException(status_code=400, detail=f"Room {room.room_number} is not ready ({room.housekeeping_status}). Use force to check in anyway.")

    _do_check_in(db, booking, current_user)
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

    # Late checkout fee: Rs/hour past the standard checkout time on the
    # departure date, capped at the cutoff hour (per the rate card:
    # "Rs.1000/- per hour, max upto 1500 hrs"). Local wall-clock time on
    # purpose - this is an on-premise system billing local hours.
    now = datetime.now()
    std_hour = int(get_setting_float(db, "standard_checkout_hour", 12))
    cutoff_hour = int(get_setting_float(db, "late_checkout_cutoff_hour", 15))
    fee_per_hour = get_setting_float(db, "late_checkout_fee_per_hour", 1000.0)
    late_fee = 0.0
    std = datetime.combine(booking.check_out, time(std_hour))
    if now > std and fee_per_hour > 0:
        hours_late = ceil((now - std).total_seconds() / 3600)
        hours_late = min(hours_late, max(cutoff_hour - std_hour, 0))
        late_fee = round(hours_late * fee_per_hour, 2)

    booking.status = BookingStatus.CHECKED_OUT
    booking.actual_check_out = now
    if late_fee:
        booking.late_checkout_fee = late_fee
        booking.total_amount = (float(booking.total_amount) if booking.total_amount else 0) + late_fee
    booking.room.status = RoomStatus.VACANT
    booking.room.housekeeping_status = "dirty"  # into the housekeeping queue
    db.commit()

    db.add(GuestMovement(
        booking_id=booking.id, movement_type="check_out",
        from_room_id=booking.room_id, processed_by=current_user.id,
        notes=f"Guest {booking.guest_name} checked out" + (f" (late fee Rs {late_fee:,.0f})" if late_fee else ""),
    ))
    db.commit()

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "bookings", booking.id, reason="Check-out", ip_address=request.client.host)
    return {"message": "Guest checked out successfully", "late_checkout_fee": late_fee,
            "total_amount": float(booking.total_amount) if booking.total_amount else 0}


@router.post("/{booking_id}/cancel")
async def cancel_booking(booking_id: int, request: Request, data: dict = None, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "bookings", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    booking = db.query(Booking).filter(Booking.id == booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking.status.value not in ("pending", "confirmed"):
        raise HTTPException(status_code=400, detail=f"Cannot cancel a booking with status '{booking.status.value}'")

    before = serialize_model(booking)
    reason = (data or {}).get("reason") or "Cancelled by staff"
    booking.status = BookingStatus.CANCELLED
    booking.cancel_reason = reason
    db.commit()

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "bookings", booking.id,
              before_state=before, after_state=serialize_model(booking), reason=f"Cancelled: {reason}", ip_address=request.client.host)
    return {"message": f"Booking {booking.booking_reference} cancelled"}


@router.post("/{booking_id}/no-show")
async def mark_no_show(booking_id: int, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "bookings", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    booking = db.query(Booking).filter(Booking.id == booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking.status != BookingStatus.CONFIRMED:
        raise HTTPException(status_code=400, detail="Only confirmed bookings can be marked as no-show")
    if booking.check_in >= date.today():
        raise HTTPException(status_code=400, detail="Guest is not overdue yet - no-show applies after the check-in date has passed")

    before = serialize_model(booking)
    booking.status = BookingStatus.NO_SHOW
    db.commit()

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "bookings", booking.id,
              before_state=before, after_state=serialize_model(booking), reason="Marked no-show", ip_address=request.client.host)
    return {"message": f"Booking {booking.booking_reference} marked as no-show"}


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
    rooms = db.query(Room).filter(Room.is_active == True).all()
    states = _derived_states(db, rooms, date.today())
    counts = {"occupied": 0, "reserved": 0, "maintenance": 0, "vacant": 0}
    dirty = 0
    for r in rooms:
        counts[states[r.id]["status"]] += 1
        if (r.housekeeping_status or "clean") != "clean":
            dirty += 1
    total_rooms = len(rooms)

    today = date.today()
    room_number_by_id = {r.id: r.room_number for r in rooms}
    arrival_bookings = db.query(Booking).filter(Booking.check_in == today, Booking.status == "confirmed").order_by(Booking.check_in.asc()).all()
    departure_bookings = db.query(Booking).filter(Booking.check_out == today, Booking.status == "checked_in").order_by(Booking.check_out.asc()).all()
    housekeeping_queue = [
        {"room_id": r.id, "room_number": r.room_number, "housekeeping_status": r.housekeeping_status or "clean"}
        for r in rooms if (r.housekeeping_status or "clean") != "clean"
    ]

    return {
        "total_rooms": total_rooms, "occupied": counts["occupied"], "reserved": counts["reserved"],
        "vacant": counts["vacant"], "maintenance": counts["maintenance"],
        "needs_housekeeping": dirty,
        "occupancy_rate": round(counts["occupied"] / total_rooms * 100, 1) if total_rooms else 0,
        "today_arrivals": len(arrival_bookings), "today_departures": len(departure_bookings),
        "arrivals": [{"booking_id": b.id, "guest_name": b.guest_name, "room_id": b.room_id,
                       "room_number": room_number_by_id.get(b.room_id), "booking_reference": b.booking_reference} for b in arrival_bookings],
        "departures": [{"booking_id": b.id, "guest_name": b.guest_name, "room_id": b.room_id,
                         "room_number": room_number_by_id.get(b.room_id), "booking_reference": b.booking_reference} for b in departure_bookings],
        "housekeeping_queue": housekeeping_queue,
    }
