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
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload
from backend.database import get_db
from backend.config import UPLOADS_DIR
from backend.models import (
    Room, Booking, GuestMovement, RoomStatus, BookingStatus,
    RoomRate, DutyRate, RoomPhoto, Member, MemberStatus, SmsMessage, Guest,
    Invoice, BookingCharge, Attendant, AlertSeverity,
)
from backend.services import sms as sms_service
from backend.schemas import BookingCreate, BookingUpdate
from backend.auth import get_current_user, check_permission, require_supervisor
from backend.audit import log_audit, serialize_model, AuditAction
from backend.logging_config import get_logger
from backend.alerts import create_alert
from backend.services.mess_billing_calc import get_setting_float
from backend.services.room_pricing import (
    compute_booking_price, reprice_for_departure, get_room_rate, get_duty_rate,
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


def _can_view_rooms(user) -> bool:
    """Read access to room/booking data: either Booking NCO's full bookings:view,
    or the narrower read-only rooms_overview:view (Manager/Deputy Manager's Rooms
    page - status, calendar, booking history, no write affordances)."""
    return check_permission(user, "bookings", "view") or check_permission(user, "rooms_overview", "view")


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
    # billing:create is an extra allowance beyond _can_view_rooms: the global
    # "Log Charge" shortcut (QuickChargeModal, Clerk-only) searches this list
    # for the occupied room/guest to charge against - Clerk has no
    # bookings:view or rooms_overview:view, only billing itself.
    if not (_can_view_rooms(current_user) or check_permission(current_user, "billing", "create")):
        raise HTTPException(status_code=403, detail="Permission denied")
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
            "floor": r.floor, "capacity": r.capacity, "ac_count": r.ac_count or 1,
            "base_price": float(r.base_price),
            "amenities": r.amenities, "status": st["status"],
            "housekeeping_status": r.housekeeping_status or "clean",
            "current_guest": current.guest_name if current else None,
            "current_check_out": current.check_out if current else None,
            "current_booking_id": current.id if current else None,
            "current_nature_of_duty": current.nature_of_duty if current else None,
            "current_is_indefinite": bool(current and current.is_indefinite),
            # Guest's scheduled departure has arrived/passed - the desk must
            # extend the stay or check them out.
            "checkout_due": bool(current and current.nature_of_duty != "hra" and current.check_out <= date.today()),
            "arrival_guest": arrival.guest_name if arrival else None,
            "arrival_booking_id": arrival.id if arrival else None,
            "arrival_nature_of_duty": arrival.nature_of_duty if arrival else None,
            "is_active": r.is_active,
            "photos": _photo_list(db, r.id),
            "attendant_id": r.attendant_id,
            "attendant_name": r.attendant.full_name if r.attendant else None,
        })

    return {"items": result, "total": total, "page": page, "page_size": page_size}


@router.post("/rooms")
async def create_room(data: dict, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "bookings", "create"):
        raise HTTPException(status_code=403, detail="Permission denied")
    room = Room(
        room_number=data["room_number"], room_type=data["room_type"],
        floor=data.get("floor", 1), capacity=data.get("capacity", 2),
        ac_count=data.get("ac_count", 1),
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


@router.put("/rooms/{room_id}/attendant")
async def set_room_attendant(room_id: int, data: dict, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Quick-reassign the room's default attendant - a high-frequency action,
    deliberately a single lightweight call rather than the full room-update
    endpoint. Does NOT touch any currently in-progress stay's own
    attendant_id snapshot (that only changes at check-in)."""
    if not check_permission(current_user, "bookings", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    attendant_id = data.get("attendant_id")
    if attendant_id is not None:
        attendant = db.query(Attendant).filter(Attendant.id == attendant_id, Attendant.is_active == True).first()
        if not attendant:
            raise HTTPException(status_code=400, detail="Attendant not found or inactive")

    before = room.attendant_id
    room.attendant_id = attendant_id
    db.commit()

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "rooms", room.id,
              before_state={"attendant_id": before}, after_state={"attendant_id": attendant_id},
              reason="Attendant reassignment", ip_address=request.client.host)
    return {"message": "Attendant updated", "attendant_id": attendant_id}


@router.put("/rooms/{room_id}")
async def update_room(room_id: int, data: dict, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "bookings", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    before = serialize_model(room)
    for field in ["room_type", "floor", "capacity", "ac_count", "base_price", "amenities", "status", "notes"]:
        if field in data:
            setattr(room, field, data[field])
    if "maintenance_until" in data:
        room.maintenance_until = date.fromisoformat(data["maintenance_until"]) if data["maintenance_until"] else None
    db.commit()
    db.refresh(room)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "rooms", room.id, before_state=before, after_state=serialize_model(room), ip_address=request.client.host)
    return room


@router.put("/rooms/{room_id}/capacity")
async def set_room_capacity(room_id: int, data: dict, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Narrow slice of update_room, gated by settings:edit instead of
    bookings:edit - Manager/Deputy Manager own room-capacity policy (fixing a
    stale/wrong number from Settings) but don't otherwise operate Bookings
    (see the Manager comment block in migrations/access.py), the same pattern
    as set_housekeeping/set_room_attendant scoping down a single field."""
    if not check_permission(current_user, "settings", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    capacity = data.get("capacity")
    if not isinstance(capacity, int) or isinstance(capacity, bool) or capacity < 1:
        raise HTTPException(status_code=400, detail="capacity must be a positive integer")

    before = room.capacity
    room.capacity = capacity
    db.commit()
    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "rooms", room.id,
              before_state={"capacity": before}, after_state={"capacity": capacity},
              reason="Room capacity updated from Settings", ip_address=request.client.host)
    return {"message": f"Room {room.room_number} capacity set to {capacity}", "capacity": capacity}


@router.get("/rooms/{room_id}/calendar")
async def room_calendar(
    room_id: int, year: int = 0, month: int = 0,
    db: Session = Depends(get_db), current_user=Depends(get_current_user),
):
    """A month of stays for one room - feeds the room detail panel. Returns
    guest name/phone/rank - PII, gated the same as the rest of Bookings."""
    if not _can_view_rooms(current_user):
        raise HTTPException(status_code=403, detail="Permission denied")
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
            "floor": room.floor, "capacity": room.capacity, "ac_count": room.ac_count or 1,
            "base_price": float(room.base_price),
            "status": states["status"], "housekeeping_status": room.housekeeping_status or "clean",
            "photos": _photo_list(db, room.id),
            "attendant_id": room.attendant_id,
            "attendant_name": room.attendant.full_name if room.attendant else None,
            "notes": room.notes,
            "maintenance_until": room.maintenance_until,
        },
        "current_booking": {
            "id": current.id, "booking_reference": current.booking_reference,
            "guest_name": current.guest_name, "guest_phone": current.guest_phone,
            "rank": current.rank, "check_in": current.check_in, "check_out": current.check_out,
            "total_amount": float(current.total_amount) if current.total_amount else 0,
            "nature_of_duty": current.nature_of_duty, "is_indefinite": bool(current.is_indefinite),
            # Full profile for the occupied-room panel
            "client_category": current.client_category.value if current.client_category else None,
            "guest_id_type": current.guest_id_type, "guest_id_number": current.guest_id_number,
            "pa_number": current.pa_number, "unit_address": current.unit_address,
            "reference_person": current.reference_person,
            "source": current.source or "walk_in", "online_voucher_no": current.online_voucher_no,
            "advance_payment_amount": float(current.advance_payment_amount) if current.advance_payment_amount else 0,
            "advance_paid_at": current.advance_paid_at,
            "mattress_count": current.mattress_count or 0,
            "special_requests": current.special_requests,
            "actual_check_in": current.actual_check_in,
            "checkout_due": bool(current.nature_of_duty != "hra" and current.check_out <= today),
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
    member_id: int = 0, include_booked: bool = False, room_id: int = 0, stay_type: str = "",
    room_type: str = "",
    db: Session = Depends(get_db), current_user=Depends(get_current_user),
):
    """All rooms priced for a prospective stay, with conflicts computed by
    date overlap - the single source of truth for 'what can I sell'.

    Pass room_id to scope this to one room - used as a single-room price
    quote (e.g. the in-panel booking form) instead of a duplicate endpoint;
    include_booked is implied true in that case so a conflicting room still
    returns its pricing/conflict details rather than an empty result.

    unavailable_reason embeds the conflicting guest's name - PII, gated the
    same as the rest of Bookings."""
    if not check_permission(current_user, "bookings", "view"):
        raise HTTPException(status_code=403, detail="Permission denied")
    if check_out <= check_in:
        raise HTTPException(status_code=400, detail="check_out must be after check_in")

    query = db.query(Room).filter(Room.is_active == True)
    if room_id:
        query = query.filter(Room.id == room_id)
        include_booked = True
    if room_type:
        query = query.filter(Room.room_type == room_type)
    rooms = query.order_by(Room.room_number).all()
    room_ids = [r.id for r in rooms]
    if room_id and not rooms:
        raise HTTPException(status_code=404, detail="Room not found")

    conflicts = {}
    next_start = {}
    if room_ids:
        # A CHECKED_IN booking's recorded check_out is only a plan - the
        # guest may be overstaying past it and hasn't actually left, so its
        # occupancy is treated as open-ended for conflict purposes (same
        # status-based reasoning /rooms already uses) rather than trusting
        # Booking.check_out to have closed the window.
        overlapping = db.query(Booking).filter(
            Booking.room_id.in_(room_ids), Booking.status.in_(ACTIVE_STATUSES),
            Booking.check_in < check_out,
            or_(Booking.check_out > check_in, Booking.status == BookingStatus.CHECKED_IN),
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
            stay_type=stay_type or None,
        )
        items.append({
            "id": r.id, "room_number": r.room_number, "room_type": r.room_type.value,
            "floor": r.floor, "capacity": r.capacity,
            "housekeeping_status": r.housekeeping_status or "clean",
            "available": is_available,
            "unavailable_reason": "maintenance" if in_maintenance else (
                (f"Occupied - overstaying past {conflict.check_out.strftime('%d %b')} checkout "
                 f"({conflict.guest_name}, {conflict.booking_reference})"
                 if conflict.status == BookingStatus.CHECKED_IN and conflict.check_out <= date.today() else
                 f"Booked {conflict.check_in.strftime('%d %b')}-{conflict.check_out.strftime('%d %b')} "
                 f"({conflict.guest_name}, {conflict.booking_reference})") if conflict else None),
            "next_booking_start": next_start.get(r.id),
            "pricing": pricing,
        })

    return {"items": items, "check_in": check_in, "check_out": check_out, "total": len(items)}


def _next_month(d: date) -> date:
    return date(d.year + 1, 1, 1) if d.month == 12 else date(d.year, d.month + 1, 1)


@router.get("/calendar-summary")
async def calendar_summary(
    start: date, end: date, granularity: str = Query("day", pattern="^(day|month)$"),
    db: Session = Depends(get_db), current_user=Depends(get_current_user),
):
    """Aggregate occupancy across ALL rooms over an arbitrary range, powering
    the Bookings Calendar tab: Week/Month views (granularity=day) and Year
    view (granularity=month). Unlike a current-status snapshot, 'occupied'
    counts checked_in AND checked_out bookings overlapping a date, so past
    dates stay accurate after a guest has since checked out.

    Day cells embed guest names/ranks - PII, gated the same as the rest of
    Bookings."""
    if not _can_view_rooms(current_user):
        raise HTTPException(status_code=403, detail="Permission denied")
    if end <= start:
        raise HTTPException(status_code=400, detail="end must be after start")

    total_rooms = db.query(Room).filter(Room.is_active == True).count()
    bookings = db.query(Booking).options(joinedload(Booking.room)).filter(
        Booking.check_in < end, Booking.check_out > start,
        Booking.status.in_(("confirmed", "checked_in", "checked_out")),
    ).all()

    if granularity == "day":
        days = (end - start).days
        if days > 366:
            raise HTTPException(status_code=400, detail="Range too large for day granularity - use month")
        result = []
        for i in range(days):
            d = start + timedelta(days=i)
            occupied = reserved = arrivals = departures = 0
            guests = []
            # Same occupancy-kind split the grid views colour by, aggregated
            # per day so a month cell can show its mix (how much of today's
            # occupancy is long-term residency vs actual room turnover)
            # rather than only a single occupied/total ratio.
            kind_counts = {"hra": 0, "indefinite": 0, "guest": 0, "reserved": 0}
            for b in bookings:
                occupying = b.check_in <= d < b.check_out
                if occupying and b.status.value in ("checked_in", "checked_out"):
                    occupied += 1
                    if b.nature_of_duty == "hra":
                        kind_counts["hra"] += 1
                    elif b.is_indefinite:
                        kind_counts["indefinite"] += 1
                    else:
                        kind_counts["guest"] += 1
                elif occupying and b.status.value == "confirmed":
                    reserved += 1
                    kind_counts["reserved"] += 1
                if occupying:
                    guests.append({"guest_name": b.guest_name, "rank": b.rank, "room_id": b.room_id,
                                    "room_number": b.room.room_number if b.room else None, "status": b.status.value,
                                    "nature_of_duty": b.nature_of_duty or "visit",
                                    "is_indefinite": bool(b.is_indefinite)})
                if b.check_in == d:
                    arrivals += 1
                if b.check_out == d and b.status.value in ("checked_in", "checked_out"):
                    departures += 1
            result.append({"date": d, "total_rooms": total_rooms, "occupied": occupied,
                            "reserved": reserved, "arrivals": arrivals, "departures": departures,
                            "kind_counts": kind_counts, "guests": guests})
        return {"granularity": "day", "start": start, "end": end, "days": result}

    months = []
    cur = date(start.year, start.month, 1)
    limit = date(end.year, end.month, 1)
    while cur <= limit:
        months.append(cur)
        cur = _next_month(cur)

    result = []
    for m_start in months:
        m_end = _next_month(m_start)
        nights_total = total_rooms * (m_end - m_start).days
        occupied_nights = 0
        bookings_count = 0
        for b in bookings:
            overlap_start, overlap_end = max(b.check_in, m_start), min(b.check_out, m_end)
            if overlap_start < overlap_end and b.status.value in ("checked_in", "checked_out"):
                occupied_nights += (overlap_end - overlap_start).days
            if m_start <= b.check_in < m_end:
                bookings_count += 1
        revenue = db.query(func.sum(Invoice.total_amount)).filter(
            Invoice.created_at >= datetime.combine(m_start, datetime.min.time()),
            Invoice.created_at < datetime.combine(m_end, datetime.min.time()),
            Invoice.status.in_(("issued", "paid")),
        ).scalar() or 0
        result.append({
            "month": m_start.strftime("%Y-%m"),
            "occupancy_rate": round(occupied_nights / nights_total * 100, 1) if nights_total else 0,
            "bookings_count": bookings_count, "revenue": float(revenue),
        })
    return {"granularity": "month", "start": start, "end": end, "months": result}


def _grid_cell(d: date, booking, in_maintenance: bool) -> dict:
    """One room x day cell for the Calendar tab's grid views.

    Carries the booking's KIND (nature_of_duty) and open-endedness alongside
    the coarse status, so the UI can colour an HRA residency differently from
    a night's guest stay, and can mark a stay whose stored check_out is a
    far-future placeholder rather than a real departure date (is_indefinite -
    see create_booking). booking_status is kept distinct from status because
    'occupied' covers both checked_in and checked_out: only a still-open stay
    should render as continuing past the window edge."""
    if in_maintenance:
        return {"date": d, "status": "maintenance", "guest_name": None, "booking_reference": None,
                "nature_of_duty": None, "is_indefinite": False, "booking_status": None}
    if booking:
        return {
            "date": d,
            "status": "occupied" if booking.status.value in ("checked_in", "checked_out") else "reserved",
            "guest_name": booking.guest_name, "booking_reference": booking.booking_reference,
            "nature_of_duty": booking.nature_of_duty or "visit",
            "is_indefinite": bool(booking.is_indefinite),
            "booking_status": booking.status.value,
        }
    return {"date": d, "status": "vacant", "guest_name": None, "booking_reference": None,
            "nature_of_duty": None, "is_indefinite": False, "booking_status": None}


@router.get("/room-week")
async def room_week(
    start: date = None, db: Session = Depends(get_db), current_user=Depends(get_current_user),
):
    """Per-room, per-day state over a 7-day window - the Calendar tab's Week
    view. Unlike the old /timeline this replaced, a cell counts as 'occupied'
    for checked_in AND checked_out bookings (not just checked_in), so a
    guest who has since checked out still shows correctly on their
    historical dates instead of the cell reverting to vacant. Maintenance is
    a persistent room flag (not date-ranged), so it applies uniformly."""
    if not _can_view_rooms(current_user):
        raise HTTPException(status_code=403, detail="Permission denied")
    start = start or date.today()
    window_end = start + timedelta(days=7)
    date_list = [start + timedelta(days=i) for i in range(7)]

    rooms = db.query(Room).filter(Room.is_active == True).order_by(Room.floor, Room.room_number).all()
    room_ids = [r.id for r in rooms]

    by_room_day = {}
    if room_ids:
        bookings = db.query(Booking).filter(
            Booking.room_id.in_(room_ids), Booking.status.in_(("confirmed", "checked_in", "checked_out")),
            Booking.check_in < window_end, Booking.check_out > start,
        ).all()
        priority = {"checked_in": 3, "checked_out": 2, "confirmed": 1}
        for b in bookings:
            for d in date_list:
                if b.check_in <= d < b.check_out:
                    slot = by_room_day.setdefault((b.room_id, d), None)
                    if slot is None or priority.get(b.status.value, 0) > priority.get(slot.status.value, 0):
                        by_room_day[(b.room_id, d)] = b

    result = []
    for r in rooms:
        in_maintenance = r.status == RoomStatus.MAINTENANCE
        cells = [_grid_cell(d, by_room_day.get((r.id, d)), in_maintenance) for d in date_list]
        result.append({
            "id": r.id, "room_number": r.room_number, "room_type": r.room_type.value,
            "floor": r.floor, "cells": cells,
        })

    return {"start": start, "dates": date_list, "rooms": result}


@router.get("/room-month")
async def room_month(
    year: int = 0, month: int = 0, db: Session = Depends(get_db), current_user=Depends(get_current_user),
):
    """Per-room, per-day state over a full calendar month (days 1..N) - the
    bird's-eye room-by-room month view. Same cell/status logic as
    /room-week (occupied covers both checked_in and checked_out so a stay
    still shows correctly on its past dates after the guest checks out)."""
    if not _can_view_rooms(current_user):
        raise HTTPException(status_code=403, detail="Permission denied")
    today = date.today()
    year = year or today.year
    month = month or today.month
    if not 1 <= month <= 12:
        raise HTTPException(status_code=400, detail="month must be 1-12")
    month_start = date(year, month, 1)
    month_end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    date_list = [month_start + timedelta(days=i) for i in range((month_end - month_start).days)]

    rooms = db.query(Room).filter(Room.is_active == True).order_by(Room.floor, Room.room_number).all()
    room_ids = [r.id for r in rooms]

    by_room_day = {}
    if room_ids:
        bookings = db.query(Booking).filter(
            Booking.room_id.in_(room_ids), Booking.status.in_(("confirmed", "checked_in", "checked_out")),
            Booking.check_in < month_end, Booking.check_out > month_start,
        ).all()
        priority = {"checked_in": 3, "checked_out": 2, "confirmed": 1}
        for b in bookings:
            for d in date_list:
                if b.check_in <= d < b.check_out:
                    slot = by_room_day.setdefault((b.room_id, d), None)
                    if slot is None or priority.get(b.status.value, 0) > priority.get(slot.status.value, 0):
                        by_room_day[(b.room_id, d)] = b

    result = []
    for r in rooms:
        in_maintenance = r.status == RoomStatus.MAINTENANCE
        cells = [_grid_cell(d, by_room_day.get((r.id, d)), in_maintenance) for d in date_list]
        result.append({
            "id": r.id, "room_number": r.room_number, "room_type": r.room_type.value,
            "floor": r.floor, "cells": cells,
        })

    return {"year": year, "month": month, "dates": date_list, "rooms": result}


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
    status: str = "", search: str = "", room_id: int = 0, date: date = None,
    page: int = Query(1, ge=1), page_size: int = Query(25, ge=1),
    db: Session = Depends(get_db), current_user=Depends(get_current_user),
):
    if not _can_view_rooms(current_user):
        raise HTTPException(status_code=403, detail="Permission denied")
    query = db.query(Booking)
    if status:
        query = query.filter(Booking.status == status)
    if date:
        # Bookings occupying this calendar day - powers the Calendar tab's
        # day-summary popover (regardless of current status, same as
        # calendar-summary's occupancy logic).
        query = query.filter(Booking.check_in <= date, Booking.check_out > date)
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
         "reference_person": b.reference_person,
         "nature_of_duty": b.nature_of_duty, "mattress_count": b.mattress_count or 0,
         "late_checkout_fee": float(b.late_checkout_fee) if b.late_checkout_fee else 0,
         "actual_check_in": b.actual_check_in, "actual_check_out": b.actual_check_out,
         "cancel_reason": b.cancel_reason,
         "source": b.source or "walk_in", "online_voucher_no": b.online_voucher_no,
         "arrival_deadline": b.arrival_deadline,
         "arrival_overdue": bool(
             b.status == BookingStatus.CONFIRMED and b.arrival_deadline and b.arrival_deadline < datetime.now()),
         "created_at": b.created_at} for b in bookings], "total": total}


def _overlap_query(db: Session, room_id: int, check_in: date, check_out: date):
    return db.query(Booking).filter(
        Booking.room_id == room_id,
        Booking.status.in_(ACTIVE_STATUSES),
        Booking.check_in < check_out,
        Booking.check_out > check_in,
    )


def _do_check_in(db: Session, booking: Booking, current_user, attendant_id: int | None = None):
    booking.status = BookingStatus.CHECKED_IN
    booking.actual_check_in = datetime.now()
    booking.room.status = RoomStatus.OCCUPIED
    if attendant_id is not None:
        booking.attendant_id = attendant_id
    db.commit()
    db.add(GuestMovement(
        booking_id=booking.id, movement_type="check_in",
        to_room_id=booking.room_id, processed_by=current_user.id,
        notes=f"Guest {booking.guest_name} checked in",
    ))
    db.commit()


def _find_or_create_guest(db: Session, data: BookingCreate) -> Guest:
    """Matches a returning guest by ID number first (most reliable), then
    phone, so repeat visitors are recognized across stays even if their name
    is entered slightly differently. Keeps contact/address current on match."""
    guest = None
    if data.guest_id_number:
        guest = db.query(Guest).filter(Guest.id_number == data.guest_id_number).first()
    if not guest and data.guest_phone:
        guest = db.query(Guest).filter(Guest.phone == data.guest_phone).first()
    if guest:
        guest.full_name = data.guest_name
        if data.guest_phone:
            guest.phone = data.guest_phone
        if data.guest_id_type:
            guest.id_type = data.guest_id_type
        if data.guest_id_number:
            guest.id_number = data.guest_id_number
        if data.unit_address:
            guest.unit_address = data.unit_address
    else:
        guest = Guest(full_name=data.guest_name, phone=data.guest_phone, id_type=data.guest_id_type,
                       id_number=data.guest_id_number, unit_address=data.unit_address)
        db.add(guest)
    db.flush()
    return guest


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
    #
    # A non-HRA "indefinite stay" (data.is_indefinite) gets the same
    # placeholder-date treatment but WITHOUT a renewal job - HRA's rolling
    # window only exists because HRA residents are billed monthly; regular
    # guests are billed per-stay at actual checkout (never an open running
    # tab, per policy), so a single long window is enough and real checkout
    # always overwrites it via the normal early-departure re-pricing path.
    # pricing_check_out drives compute_booking_price separately from the
    # stored check_out for an indefinite stay: the pricing engine multiplies
    # nightly rate x nights (unlike HRA's flat monthly_total), so pricing off
    # the 3650-day placeholder would produce a nonsense total. Price it as a
    # single night instead - real checkout always re-prices to actual nights
    # via reprice_for_departure regardless of what total_amount started as.
    if data.nature_of_duty == "hra":
        # A known future departure (hra_expected_checkout) overrides the
        # rolling placeholder - the renewal job (_hra_charge_and_renew) only
        # pushes check_out forward when it's within 60 days of the current
        # billing period, so a real date further out is left alone until then.
        check_out = data.hra_expected_checkout or (data.check_in + timedelta(days=365))
        pricing_check_out = check_out
    elif data.is_indefinite:
        check_out = data.check_in + timedelta(days=3650)
        pricing_check_out = data.check_in + timedelta(days=1)
    else:
        check_out = data.check_out
        pricing_check_out = check_out

    # Arrival deadline: the guest must be checked in by this time or staff may
    # void the booking. Defaults to the deadline hour on the check-in day; a
    # same-day booking made near/past that hour gets a grace window instead.
    # HRA residencies and instant walk-in check-ins don't need one.
    arrival_deadline = None
    if data.nature_of_duty != "hra" and not data.check_in_now:
        deadline_hour = int(get_setting_float(db, "arrival_deadline_hour", 18))
        grace_hours = get_setting_float(db, "arrival_grace_hours", 3)
        arrival_deadline = datetime.combine(data.check_in, time(min(max(deadline_hour, 0), 23)))
        earliest = datetime.now() + timedelta(hours=grace_hours)
        if data.check_in == date.today() and arrival_deadline < earliest:
            arrival_deadline = earliest

    existing = _overlap_query(db, data.room_id, data.check_in, check_out).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Room is not available for these dates. Overlaps with booking {existing.booking_reference}")

    room = db.query(Room).filter(Room.id == data.room_id).first()
    if not room or room.status == "maintenance":
        raise HTTPException(status_code=400, detail="Room is not available")

    # Over-capacity no longer blocks the booking (room capacities are
    # sometimes wrong/stale, and the desk shouldn't be stuck unable to house
    # someone over a data-entry issue) - it goes through and Manager gets
    # alerted instead, who can fix the room's capacity from Settings if it's
    # actually wrong (see set_room_capacity below).
    guest_count = (data.adults or 0) + (data.children or 0)
    over_capacity = bool(room.capacity and guest_count > room.capacity)

    pricing = compute_booking_price(
        db, room, check_in=data.check_in, check_out=pricing_check_out,
        client_category=data.client_category, nature_of_duty=data.nature_of_duty,
        rank=(member.rank if member else data.rank), da_multiplier=data.da_multiplier,
        mattress_count=data.mattress_count, member_id=data.member_id,
        stay_type=data.stay_type,
    )

    guest = _find_or_create_guest(db, data)

    booking = Booking(
        booking_reference=f"TMP-{uuid.uuid4().hex}", guest_name=data.guest_name, guest_phone=data.guest_phone,
        guest_email=data.guest_email, guest_id_type=data.guest_id_type,
        guest_id_number=data.guest_id_number, guest_id=guest.id, room_id=data.room_id,
        check_in=data.check_in, check_out=check_out,
        adults=data.adults, children=data.children,
        status="confirmed", special_requests=data.special_requests,
        client_category=data.client_category, member_id=data.member_id,
        rank=(member.rank if member else data.rank), pa_number=data.pa_number, unit_address=data.unit_address,
        reference_person=(data.reference_person or "").strip() or None,
        nature_of_duty=data.nature_of_duty, da_multiplier=data.da_multiplier,
        mattress_count=data.mattress_count, is_indefinite=data.is_indefinite,
        source=data.source, online_voucher_no=(data.online_voucher_no or "").strip() or None,
        advance_payment_amount=data.advance_payment_amount if data.source == "online" else 0,
        advance_paid_at=data.advance_paid_at if data.source == "online" else None,
        arrival_deadline=arrival_deadline,
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

    # Booking is already committed as 'confirmed' at this point - a dirty room
    # must not fail the request (that loses nothing server-side but strands the
    # form client-side, and a retry hits a baffling self-overlap 409). Succeed
    # with a warning instead; the desk checks the guest in once the room is clean.
    warnings = []
    if over_capacity:
        warnings.append(f"Room {room.room_number} accommodates {room.capacity} guest(s); this booking has "
                         f"{guest_count} (adults + children) - Manager has been alerted.")
        create_alert(
            db, f"Room over capacity: {booking.guest_name}",
            f"{current_user.full_name} booked {booking.guest_name} into Room {room.room_number} "
            f"(capacity {room.capacity}) with {guest_count} guest(s).",
            AlertSeverity.MEDIUM, "bookings", "booking", booking.id,
        )
    if data.check_in_now:
        effective_attendant_id = data.attendant_id if data.attendant_id is not None else room.attendant_id
        if (room.housekeeping_status or "clean") != "clean":
            warnings.append(f"Room {room.room_number} is not ready ({room.housekeeping_status}) - "
                             f"booking saved without check-in. Mark the room clean, then check in from the Dashboard.")
        elif effective_attendant_id is None:
            warnings.append(f"No attendant assigned to room {room.room_number} - "
                             f"booking saved without check-in. Assign an attendant, then check in from the Dashboard.")
        else:
            if data.attendant_id is not None and data.attendant_id != room.attendant_id:
                room.attendant_id = data.attendant_id
            _do_check_in(db, booking, current_user, attendant_id=effective_attendant_id)
    warning = " ".join(warnings) if warnings else None

    sms = sms_service.queue_booking_sms(db, booking)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.CREATE, "bookings", booking.id, after_state=serialize_model(booking), ip_address=request.client.host)
    return {"id": booking.id, "booking_reference": booking.booking_reference,
            "status": booking.status.value, "total_amount": pricing["total"], "pricing": pricing,
            "arrival_deadline": booking.arrival_deadline,
            "warning": warning,
            "sms_status": sms.status if sms else None}


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

    over_capacity_room = None
    if "room_id" in changes and new_room_id != booking.room_id:
        new_room = db.query(Room).filter(Room.id == new_room_id).first()
        if not new_room:
            raise HTTPException(status_code=404, detail="Room not found")
        guest_count = (booking.adults or 0) + (booking.children or 0)
        # Doesn't block (see create_booking) - Manager gets alerted below instead.
        if new_room.capacity and guest_count > new_room.capacity:
            over_capacity_room = new_room

    for field, value in changes.items():
        if value is not None:
            setattr(booking, field, value)
    db.commit()
    db.refresh(booking)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "bookings", booking.id, before_state=before, after_state=serialize_model(booking), ip_address=request.client.host)
    if over_capacity_room:
        guest_count = (booking.adults or 0) + (booking.children or 0)
        create_alert(
            db, f"Room over capacity: {booking.guest_name}",
            f"{current_user.full_name} moved {booking.guest_name} into Room {over_capacity_room.room_number} "
            f"(capacity {over_capacity_room.capacity}) with {guest_count} guest(s).",
            AlertSeverity.MEDIUM, "bookings", "booking", booking.id,
        )
    return booking


@router.post("/{booking_id}/check-in")
async def check_in(booking_id: int, request: Request, force: bool = False, attendant_id: int | None = None, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
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
    if room.status == RoomStatus.MAINTENANCE:
        raise HTTPException(status_code=400, detail=f"Room {room.room_number} is under maintenance and cannot be checked into.")
    if (room.housekeeping_status or "clean") != "clean":
        raise HTTPException(status_code=400, detail=f"Room {room.room_number} is not ready ({room.housekeeping_status}). Mark it clean before checking in.")

    # An attendant must be responsible for the room before a guest checks in -
    # either explicitly selected now, or already the room's default assignment.
    effective_attendant_id = attendant_id if attendant_id is not None else room.attendant_id
    if effective_attendant_id is None:
        raise HTTPException(status_code=400, detail="Select a room attendant before checking in.")
    attendant = db.query(Attendant).filter(Attendant.id == effective_attendant_id, Attendant.is_active == True).first()
    if not attendant:
        raise HTTPException(status_code=400, detail="Selected attendant was not found or is inactive.")
    if attendant_id is not None and attendant_id != room.attendant_id:
        room.attendant_id = attendant_id

    _do_check_in(db, booking, current_user, attendant_id=effective_attendant_id)
    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "bookings", booking.id, reason="Check-in", ip_address=request.client.host)
    return {"message": "Guest checked in successfully"}


def perform_check_out(db: Session, booking: Booking, current_user) -> float:
    """Check-out routine: computes the late fee, flips the booking and room
    state, and records the guest movement. Deliberately reachable ONLY
    through billing.instant_checkout - checkout always means settling the
    bill, so a guest can never be checked out unbilled (the standalone
    /check-out endpoint that allowed that was removed). Returns the late
    fee charged."""
    now = datetime.now()

    # Bill the ACTUAL stay: an overstayed night is charged, an unused night
    # is not. The booked span is re-priced over check_in -> today and the
    # booking's check_out truncated/pushed to the real departure, so the
    # calendar reflects reality and released nights are sellable again.
    effective_out, pricing = reprice_for_departure(db, booking, now.date())
    if pricing is not None:
        booking.check_out = effective_out
        booking.total_amount = pricing["total"]
        booking.rate_breakdown = json.dumps(pricing)

    # Late checkout fee: Rs/hour past the standard checkout time on the
    # (actual) departure date, capped at the cutoff hour (per the rate card:
    # "Rs.1000/- per hour, max upto 1500 hrs"). Local wall-clock time on
    # purpose - this is an on-premise system billing local hours.
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
    return late_fee


@router.post("/{booking_id}/end-residency")
async def end_residency(booking_id: int, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """End an HRA monthly residency - the one checkout that doesn't produce a
    bill, because residents settle through the monthly Mess Bill cycle (their
    final month is charged by the next mess-billing run). Guests must go
    through billing.instant_checkout instead."""
    if not check_permission(current_user, "bookings", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    booking = db.query(Booking).filter(Booking.id == booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking.nature_of_duty != "hra":
        raise HTTPException(status_code=400, detail="Only HRA residencies can be ended this way - guests check out via Checkout & Bill")
    if booking.status != BookingStatus.CHECKED_IN:
        raise HTTPException(status_code=400, detail="Resident is not checked in")

    before = serialize_model(booking)
    today = date.today()
    booking.status = BookingStatus.CHECKED_OUT
    booking.actual_check_out = datetime.now()
    # Truncate the rolling ~365-day residency window to the real departure so
    # the calendar/history reflect the actual stay and the room's future
    # dates don't show a year of phantom occupancy.
    booking.check_out = max(today, booking.check_in + timedelta(days=1))
    booking.room.status = RoomStatus.VACANT
    booking.room.housekeeping_status = "dirty"  # into the housekeeping queue
    db.commit()

    db.add(GuestMovement(
        booking_id=booking.id, movement_type="check_out",
        from_room_id=booking.room_id, processed_by=current_user.id,
        notes=f"HRA residency of {booking.guest_name} ended",
    ))
    db.commit()

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "bookings", booking.id,
              before_state=before, after_state=serialize_model(booking),
              reason="HRA residency ended", ip_address=request.client.host)
    return {"message": f"Residency ended - Room {booking.room.room_number} sent to housekeeping. Final charges settle via the monthly Mess Bill."}


@router.put("/{booking_id}/category")
async def override_booking_category(booking_id: int, data: dict, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Manager-only override of a booking's client_category (e.g. a guest was
    logged as civilian but is actually a retired officer) - re-prices the
    stay with the pricing engine so the bill total stays consistent with the
    corrected category. Narrow "approve" action, not general bookings:edit -
    this is Manager's one specific lever into Bookings, not full access to
    the module (see access.py's Manager "bookings": "A" comment)."""
    if not check_permission(current_user, "bookings", "approve"):
        raise HTTPException(status_code=403, detail="Permission denied")
    booking = db.query(Booking).filter(Booking.id == booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking.status == BookingStatus.CHECKED_OUT:
        raise HTTPException(status_code=400, detail="Booking is already checked out - use a bill line-item correction instead of a category override")
    if booking.status in (BookingStatus.CANCELLED, BookingStatus.NO_SHOW):
        raise HTTPException(status_code=400, detail=f"Cannot change category on a {booking.status.value} booking")

    new_category = (data or {}).get("client_category")
    if not new_category:
        raise HTTPException(status_code=400, detail="client_category is required")

    before = serialize_model(booking)
    booking.client_category = new_category
    pricing = compute_booking_price(
        db, booking.room, check_in=booking.check_in, check_out=booking.check_out,
        client_category=new_category, nature_of_duty=booking.nature_of_duty,
        rank=booking.rank, da_multiplier=float(booking.da_multiplier) if booking.da_multiplier else None,
        mattress_count=booking.mattress_count or 0, member_id=booking.member_id, stay_type=booking.stay_type,
        discount_rate=float(booking.discount_rate) if booking.discount_rate else 0,
    )
    booking.total_amount = pricing["total"] + (float(booking.late_checkout_fee) if booking.late_checkout_fee else 0)
    booking.rate_breakdown = json.dumps(pricing)
    db.commit()
    db.refresh(booking)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.OVERRIDE, "bookings", booking.id,
              before_state=before, after_state=serialize_model(booking),
              reason=(data or {}).get("reason") or f"Category overridden to {new_category}", ip_address=request.client.host)
    return {"message": f"Category updated to {new_category}", "total_amount": float(booking.total_amount)}


@router.get("/current-guests")
async def list_current_guests(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Every currently checked-in, non-HRA guest for the Guest Discounts page
    - HRA residents settle through the monthly Mess Bill and are managed on
    the separate Member Discounts page instead (see mess_billing.py's
    custom_discount_rate). Same narrow "approve" gate as the category
    override above - Manager's one specific lever into Bookings."""
    if not check_permission(current_user, "bookings", "approve"):
        raise HTTPException(status_code=403, detail="Permission denied")
    bookings = db.query(Booking).options(joinedload(Booking.room)).filter(
        Booking.status == "checked_in",
        or_(Booking.nature_of_duty.is_(None), Booking.nature_of_duty != "hra"),
    ).order_by(Booking.check_in.desc()).all()
    return [{
        "id": b.id, "guest_name": b.guest_name, "rank": b.rank,
        "room_number": b.room.room_number if b.room else None,
        "client_category": b.client_category.value if b.client_category else None,
        "discount_rate": float(b.discount_rate) if b.discount_rate else 0,
        "total_amount": float(b.total_amount) if b.total_amount else 0,
        "check_in": b.check_in, "check_out": b.check_out,
    } for b in bookings]


@router.put("/{booking_id}/discount")
async def override_booking_discount(booking_id: int, data: dict, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Manager-only standing discount on a currently in-house guest's stay
    (Guest Discounts page). Stored on the booking and applied inside
    compute_booking_price() - not a one-off edit to total_amount - so it
    survives every re-price this stay goes through afterward (category
    change, early/late actual checkout). No invoice exists yet for an
    in-house guest (this app bills at checkout, not before), which is why
    this can't reuse the Clerk Desk master-invoice discount action. Same
    narrow "approve" gate as the category override above."""
    if not check_permission(current_user, "bookings", "approve"):
        raise HTTPException(status_code=403, detail="Permission denied")
    booking = db.query(Booking).filter(Booking.id == booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking.status == BookingStatus.CHECKED_OUT:
        raise HTTPException(status_code=400, detail="Booking is already checked out - use a bill line-item correction instead of a discount override")
    if booking.status in (BookingStatus.CANCELLED, BookingStatus.NO_SHOW):
        raise HTTPException(status_code=400, detail=f"Cannot change discount on a {booking.status.value} booking")

    discount_rate = (data or {}).get("discount_rate")
    if discount_rate is None or not (0 <= discount_rate <= 100):
        raise HTTPException(status_code=400, detail="discount_rate is required and must be between 0 and 100")

    before = serialize_model(booking)
    booking.discount_rate = discount_rate
    pricing = compute_booking_price(
        db, booking.room, check_in=booking.check_in, check_out=booking.check_out,
        client_category=booking.client_category, nature_of_duty=booking.nature_of_duty,
        rank=booking.rank, da_multiplier=float(booking.da_multiplier) if booking.da_multiplier else None,
        mattress_count=booking.mattress_count or 0, member_id=booking.member_id, stay_type=booking.stay_type,
        discount_rate=discount_rate,
    )
    booking.total_amount = pricing["total"] + (float(booking.late_checkout_fee) if booking.late_checkout_fee else 0)
    booking.rate_breakdown = json.dumps(pricing)
    db.commit()
    db.refresh(booking)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.OVERRIDE, "bookings", booking.id,
              before_state=before, after_state=serialize_model(booking),
              reason=(data or {}).get("reason") or f"Discount set to {discount_rate}%", ip_address=request.client.host)
    return {"message": f"Discount updated to {discount_rate}%", "total_amount": float(booking.total_amount)}


@router.post("/{booking_id}/extend")
async def extend_booking(booking_id: int, data: dict, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Extend a checked-in guest's stay to a new checkout date.

    Same room when the extension window is free; when the room is already
    reserved, pass transfer_room_id to move the guest to another room for the
    whole (extended) stay instead - the conflict response carries enough
    detail for the desk to offer that choice. The stay is re-priced with the
    pricing engine over the full check_in -> new_check_out span."""
    if not check_permission(current_user, "bookings", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    booking = db.query(Booking).filter(Booking.id == booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking.status != BookingStatus.CHECKED_IN:
        raise HTTPException(status_code=400, detail="Only a checked-in guest's stay can be extended")
    if booking.nature_of_duty == "hra":
        raise HTTPException(status_code=400, detail="HRA residencies roll forward automatically - no extension needed")

    try:
        new_check_out = date.fromisoformat(str((data or {}).get("new_check_out", "")))
    except ValueError:
        raise HTTPException(status_code=400, detail="new_check_out must be a valid date (YYYY-MM-DD)")
    if new_check_out <= booking.check_out and not (data or {}).get("transfer_room_id"):
        raise HTTPException(status_code=400, detail=f"New checkout must be after the current one ({booking.check_out.strftime('%d %b %Y')})")
    if new_check_out <= date.today():
        raise HTTPException(status_code=400, detail="New checkout must be after today")

    transfer_room_id = int((data or {}).get("transfer_room_id") or 0)
    before = serialize_model(booking)
    target_room = booking.room

    if transfer_room_id and transfer_room_id != booking.room_id:
        target_room = db.query(Room).filter(Room.id == transfer_room_id, Room.is_active == True).first()
        if not target_room or target_room.status == RoomStatus.MAINTENANCE:
            raise HTTPException(status_code=400, detail="Transfer room is not available")
        # The guest moves NOW, so the target room must have no one physically
        # inside (a due-out guest whose dates no longer overlap still occupies
        # the room until they actually check out).
        occupant = db.query(Booking).filter(
            Booking.room_id == transfer_room_id, Booking.status == BookingStatus.CHECKED_IN,
        ).first()
        if occupant:
            raise HTTPException(status_code=409, detail=f"Room {target_room.room_number} still has {occupant.guest_name} inside ({occupant.booking_reference}) - check them out first")
        # ...and be free from today through the new checkout
        clash = _overlap_query(db, transfer_room_id, date.today(), new_check_out).filter(Booking.id != booking.id).first()
        if clash:
            raise HTTPException(status_code=409, detail=f"Room {target_room.room_number} is not free either - overlaps with {clash.booking_reference}")
    else:
        # Same-room extension: the added window must be free
        clash = _overlap_query(db, booking.room_id, booking.check_out, new_check_out).filter(Booking.id != booking.id).first()
        if clash:
            # Scenario B: the room is reserved - the desk must transfer or check out.
            raise HTTPException(status_code=409, detail=(
                f"Room {booking.room.room_number} is reserved from {clash.check_in.strftime('%d %b')} "
                f"({clash.guest_name}, {clash.booking_reference}). Transfer the guest to another room or check them out."))

    old_room = booking.room
    pricing = compute_booking_price(
        db, target_room, check_in=booking.check_in, check_out=new_check_out,
        client_category=booking.client_category, nature_of_duty=booking.nature_of_duty,
        rank=booking.rank, da_multiplier=float(booking.da_multiplier) if booking.da_multiplier else None,
        mattress_count=booking.mattress_count or 0, member_id=booking.member_id,
        discount_rate=float(booking.discount_rate) if booking.discount_rate else 0,
    )

    transferred = target_room.id != booking.room_id
    booking.check_out = new_check_out
    booking.total_amount = pricing["total"] + (float(booking.late_checkout_fee) if booking.late_checkout_fee else 0)
    booking.rate_breakdown = json.dumps(pricing)
    if transferred:
        booking.room_id = target_room.id
        target_room.status = RoomStatus.OCCUPIED
        old_room.status = RoomStatus.VACANT
        old_room.housekeeping_status = "dirty"
    db.commit()

    if transferred:
        db.add(GuestMovement(
            booking_id=booking.id, movement_type="room_change",
            from_room_id=old_room.id, to_room_id=target_room.id, processed_by=current_user.id,
            notes=f"Extended to {new_check_out.strftime('%d %b %Y')} with transfer {old_room.room_number} -> {target_room.room_number}",
        ))
        db.commit()

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "bookings", booking.id,
              before_state=before, after_state=serialize_model(booking),
              reason=f"Stay extended to {new_check_out}" + (f", transferred to room {target_room.room_number}" if transferred else ""),
              ip_address=request.client.host)
    return {
        "message": f"Stay extended to {new_check_out.strftime('%d %b %Y')}" + (f" - guest moved to Room {target_room.room_number}" if transferred else ""),
        "check_out": new_check_out, "room_id": target_room.id, "room_number": target_room.room_number,
        "total_amount": float(booking.total_amount), "pricing": pricing, "transferred": transferred,
    }


def _block_if_unbilled_charges(db: Session, booking_id: int):
    """Cancelling/voiding a booking would orphan any ad-hoc charges added to
    it (Dhobi, Extra Messing...) - they'd never appear on a bill again.
    Force the desk to resolve them first."""
    unbilled = db.query(BookingCharge).filter(
        BookingCharge.booking_id == booking_id, BookingCharge.invoiced_at.is_(None),
    ).all()
    if unbilled:
        total = sum(float(c.amount) for c in unbilled)
        heads = ", ".join(c.head for c in unbilled[:3]) + ("…" if len(unbilled) > 3 else "")
        raise HTTPException(status_code=400, detail=(
            f"This booking has unbilled charges ({heads} - Rs {total:,.0f}). "
            f"Remove them from the guest's billing profile or bill them first."))


@router.post("/{booking_id}/cancel")
async def cancel_booking(booking_id: int, request: Request, data: dict = None, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "bookings", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    booking = db.query(Booking).filter(Booking.id == booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking.status.value not in ("pending", "confirmed"):
        raise HTTPException(status_code=400, detail=f"Cannot cancel a booking with status '{booking.status.value}'")
    _block_if_unbilled_charges(db, booking_id)

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
    _block_if_unbilled_charges(db, booking_id)

    before = serialize_model(booking)
    booking.status = BookingStatus.NO_SHOW
    db.commit()

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "bookings", booking.id,
              before_state=before, after_state=serialize_model(booking), reason="Marked no-show", ip_address=request.client.host)
    return {"message": f"Booking {booking.booking_reference} marked as no-show"}


@router.post("/{booking_id}/void-expired")
async def void_expired(booking_id: int, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Void a confirmed booking whose guest did not arrive by the arrival
    deadline. Separate from no-show (which needs the whole check-in date to
    have passed) - this frees the room the same evening."""
    if not check_permission(current_user, "bookings", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    booking = db.query(Booking).filter(Booking.id == booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking.status != BookingStatus.CONFIRMED:
        raise HTTPException(status_code=400, detail="Only confirmed (not yet checked-in) bookings can be voided")
    if not booking.arrival_deadline:
        raise HTTPException(status_code=400, detail="This booking has no arrival deadline")
    if booking.arrival_deadline >= datetime.now():
        raise HTTPException(status_code=400, detail=f"Arrival deadline is {booking.arrival_deadline.strftime('%d %b %Y %I:%M %p')} - not expired yet")
    _block_if_unbilled_charges(db, booking_id)

    before = serialize_model(booking)
    booking.status = BookingStatus.CANCELLED
    booking.cancel_reason = f"Voided - guest did not arrive by {booking.arrival_deadline.strftime('%d %b %Y %I:%M %p')}"
    db.commit()

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "bookings", booking.id,
              before_state=before, after_state=serialize_model(booking), reason=booking.cancel_reason, ip_address=request.client.host)
    return {"message": f"Booking {booking.booking_reference} voided - room is free again"}


# --- SMS outbox ---

@router.get("/sms-outbox")
async def sms_outbox(status: str = "", page: int = Query(1, ge=1), page_size: int = Query(25, ge=1),
                     db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "bookings", "view"):
        raise HTTPException(status_code=403, detail="Permission denied")
    query = db.query(SmsMessage)
    if status:
        query = query.filter(SmsMessage.status == status)
    total = query.count()
    messages = query.order_by(SmsMessage.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {"items": [
        {"id": m.id, "booking_id": m.booking_id,
         "booking_reference": m.booking.booking_reference if m.booking else None,
         "guest_name": m.booking.guest_name if m.booking else None,
         "phone": m.phone, "body": m.body, "status": m.status, "error": m.error,
         "created_at": m.created_at, "sent_at": m.sent_at} for m in messages], "total": total}


@router.post("/sms/{sms_id}/retry")
async def sms_retry(sms_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Re-attempt gateway delivery of a pending/failed message."""
    if not check_permission(current_user, "bookings", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    msg = db.query(SmsMessage).filter(SmsMessage.id == sms_id).first()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    if msg.status == "sent":
        raise HTTPException(status_code=400, detail="Message was already sent")
    sent = sms_service.try_send(db, msg)
    if not sent and not msg.error:
        raise HTTPException(status_code=400, detail="No SMS gateway configured (sms_gateway_url setting) - copy the text and send manually, then mark it sent")
    return {"status": msg.status, "error": msg.error}


@router.post("/sms/{sms_id}/mark-sent")
async def sms_mark_sent(sms_id: int, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Manual-delivery path: staff sent the text from a phone themselves."""
    if not check_permission(current_user, "bookings", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    msg = db.query(SmsMessage).filter(SmsMessage.id == sms_id).first()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    if msg.status == "sent":
        raise HTTPException(status_code=400, detail="Message was already sent")
    msg.status = "sent"
    msg.sent_at = datetime.utcnow()
    msg.sent_by = current_user.id
    msg.error = None
    db.commit()
    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "sms_messages", msg.id,
              reason="Marked sent manually", ip_address=request.client.host)
    return {"status": "sent"}


@router.get("/guest-movements")
async def list_movements(booking_id: int = 0, page: int = Query(1, ge=1), page_size: int = Query(25, ge=1), db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "bookings", "view"):
        raise HTTPException(status_code=403, detail="Permission denied")
    query = db.query(GuestMovement)
    if booking_id:
        query = query.filter(GuestMovement.booking_id == booking_id)
    total = query.count()
    movements = query.order_by(GuestMovement.timestamp.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {"items": movements, "total": total}


# --- Occupancy ---

@router.get("/occupancy")
async def get_occupancy(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    # Returns guest names/rooms/arrival-departure lists - PII, not just a
    # room-count summary, so it needs the same gate as the rest of Bookings.
    if not check_permission(current_user, "bookings", "view"):
        raise HTTPException(status_code=403, detail="Permission denied")
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
    # Departures include guests OVERDUE to leave (check_out already passed but
    # still checked in) - those need desk action most urgently, and the room
    # grid's checkout_due badge alone was easy to miss. HRA residencies roll
    # forward monthly and are never "due out".
    departure_bookings = db.query(Booking).filter(
        Booking.check_out <= today, Booking.status == "checked_in",
        or_(Booking.nature_of_duty.is_(None), Booking.nature_of_duty != "hra"),
    ).order_by(Booking.check_out.asc()).all()
    housekeeping_queue = [
        {"room_id": r.id, "room_number": r.room_number, "housekeeping_status": r.housekeeping_status or "clean"}
        for r in rooms if (r.housekeeping_status or "clean") != "clean"
    ]

    from backend.models import User
    finalizer_ids = {b.kitchen_finalized_by for b in departure_bookings if b.kitchen_finalized_by} | \
        {b.booking_finalized_by for b in departure_bookings if b.booking_finalized_by}
    names_by_id = {u.id: u.full_name for u in db.query(User).filter(User.id.in_(finalizer_ids)).all()} if finalizer_ids else {}

    return {
        "total_rooms": total_rooms, "occupied": counts["occupied"], "reserved": counts["reserved"],
        "vacant": counts["vacant"], "maintenance": counts["maintenance"],
        "needs_housekeeping": dirty,
        "occupancy_rate": round(counts["occupied"] / total_rooms * 100, 1) if total_rooms else 0,
        "today_arrivals": len(arrival_bookings), "today_departures": len(departure_bookings),
        "arrivals": [{"booking_id": b.id, "guest_name": b.guest_name, "room_id": b.room_id,
                       "room_number": room_number_by_id.get(b.room_id), "booking_reference": b.booking_reference,
                       "arrival_deadline": b.arrival_deadline,
                       "arrival_overdue": bool(b.arrival_deadline and b.arrival_deadline < datetime.now())} for b in arrival_bookings],
        "departures": [{"booking_id": b.id, "guest_name": b.guest_name, "room_id": b.room_id,
                         "room_number": room_number_by_id.get(b.room_id), "booking_reference": b.booking_reference,
                         "overdue": b.check_out < today,
                         "days_overdue": (today - b.check_out).days,
                         "kitchen_finalized_at": b.kitchen_finalized_at, "kitchen_finalized_by_name": names_by_id.get(b.kitchen_finalized_by),
                         "booking_finalized_at": b.booking_finalized_at, "booking_finalized_by_name": names_by_id.get(b.booking_finalized_by),
                         } for b in departure_bookings],
        "housekeeping_queue": housekeeping_queue,
    }


@router.post("/{booking_id}/finalize")
async def finalize_booking_checkout_readiness(booking_id: int, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Booking NCO's checkout-readiness sign-off - "nothing more to add from
    the room/attendant side, guest is ready for the Clerk to check out."
    Mirrors Kitchen NCO's own finalize (backend/routers/kitchen.py's
    finalize_kitchen_departure) - see Booking.kitchen_finalized_at's model
    docstring. Neither stamp blocks or triggers checkout."""
    if not check_permission(current_user, "bookings", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    booking = db.query(Booking).filter(Booking.id == booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking.status.value != "checked_in":
        raise HTTPException(status_code=400, detail="Only a checked-in guest can be finalized for checkout")

    before = serialize_model(booking)
    booking.booking_finalized_at = datetime.utcnow()
    booking.booking_finalized_by = current_user.id
    db.commit()
    db.refresh(booking)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "bookings", booking.id,
              before_state=before, after_state=serialize_model(booking), ip_address=request.client.host)
    create_alert(
        db, f"Room charges finalized: {booking.guest_name}",
        f"{current_user.full_name} confirmed {booking.guest_name}'s (Room {booking.room.room_number if booking.room else '-'}) "
        f"room/attendant charges are final - ready to check out.",
        AlertSeverity.LOW, "bookings", "booking", booking.id,
    )
    return {"booking_finalized_at": booking.booking_finalized_at, "booking_finalized_by_name": current_user.full_name}
