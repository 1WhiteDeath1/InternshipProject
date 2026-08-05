"""Hall/function event bookings - a group event with a free-text, per-dish
priced menu and a kitchen prep lifecycle, distinct from the guest-Room
Booking flow (see backend/models/events.py). Deputy Manager creates/owns the
booking (events:create/edit); Kitchen NCO sets the menu and advances prep
status (events:edit); Clerk generates the invoice once it's completed
(clerk_desk:create, same permission that gates every other invoice-creating
action in this app)."""
import uuid
from datetime import date, datetime
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.models import (
    Event, EventMenuItem, EventStatus, EventBillingType, Guest, Invoice, InvoiceItem, InvoiceStatus,
)
from backend.schemas import EventCreate, EventUpdate, EventStatusUpdate, EventPostponeRequest, EventMenuItemCreate, EventActualCostUpdate
from backend.auth import get_current_user, check_permission
from backend.audit import log_audit, serialize_model, AuditAction

router = APIRouter()


def _find_or_create_event_contact(db: Session, name: str, phone: str | None) -> Guest:
    """Matches an existing contact by phone only (name alone is too weak a
    key - two different people can share a name). No match, or no phone
    given, creates a fresh Guest."""
    guest = db.query(Guest).filter(Guest.phone == phone).first() if phone else None
    if guest:
        guest.full_name = name
    else:
        guest = Guest(full_name=name, phone=phone)
        db.add(guest)
        db.flush()
    return guest


def _enum_value(v) -> str:
    return v.value if hasattr(v, "value") else v


def _event_total(ev: Event) -> float:
    return sum(float(mi.estimated_price) * mi.quantity for mi in ev.menu_items)


def _event_out(db: Session, ev: Event) -> dict:
    invoiced = db.query(Invoice).filter(Invoice.event_id == ev.id, Invoice.status != InvoiceStatus.VOID).first()
    return {
        "id": ev.id, "title": ev.title,
        "guest_id": ev.guest_id, "guest_name": ev.guest.full_name if ev.guest else None,
        "guest_phone": ev.guest.phone if ev.guest else None,
        "hall_name": ev.hall_name, "capacity": ev.capacity, "headcount": ev.headcount,
        "event_date": ev.event_date, "requirements": ev.requirements, "arrangement": ev.arrangement,
        "billing_type": _enum_value(ev.billing_type), "status": _enum_value(ev.status),
        "total_estimated_amount": round(_event_total(ev), 2),
        "menu_items": [{"id": mi.id, "dish_name": mi.dish_name, "estimated_price": float(mi.estimated_price),
                         "quantity": mi.quantity} for mi in ev.menu_items],
        "invoice_id": invoiced.id if invoiced else None,
        "invoice_number": invoiced.invoice_number if invoiced else None,
        "invoice_amount": float(invoiced.total_amount) if invoiced else None,
        "actual_cost": float(ev.actual_cost) if ev.actual_cost is not None else None,
        # Margin = what was billed minus what it actually cost to put on -
        # only meaningful once both figures exist.
        "margin": (round(float(invoiced.total_amount) - float(ev.actual_cost), 2)
                   if invoiced and ev.actual_cost is not None else None),
        "created_at": ev.created_at,
    }


def _brief(ev: Event) -> dict:
    return {"id": ev.id, "title": ev.title, "event_date": ev.event_date, "headcount": ev.headcount,
            "hall_name": ev.hall_name, "status": _enum_value(ev.status)}


def _hall_conflict(db: Session, hall_name: str, event_date: date, exclude_event_id: int | None = None) -> Event | None:
    """Same hall, same date, not cancelled - there's no fixed hall catalog
    (any free-text area name is bookable), so this is a same-name, same-day
    overlap rather than a resource-table join. exclude_event_id lets update/
    postpone check against every OTHER event without tripping on itself."""
    q = db.query(Event).filter(
        Event.hall_name == hall_name, Event.event_date == event_date, Event.status != EventStatus.CANCELLED,
    )
    if exclude_event_id is not None:
        q = q.filter(Event.id != exclude_event_id)
    return q.first()


def _capacity_warning(capacity: int, headcount: int) -> str | None:
    """Advisory only - the booker may have a legitimate reason (standing
    room, an outdoor area) so this warns rather than blocks."""
    if headcount > capacity:
        return f"Headcount ({headcount}) exceeds the hall's stated capacity ({capacity})."
    return None


@router.post("")
async def create_event(data: EventCreate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "events", "create"):
        raise HTTPException(status_code=403, detail="Permission denied")
    try:
        billing_type = EventBillingType(data.billing_type)
    except ValueError:
        raise HTTPException(status_code=400, detail="billing_type must be 'split' or 'single_payer'")
    hall_name = data.hall_name.strip()
    conflict = _hall_conflict(db, hall_name, data.event_date)
    if conflict:
        raise HTTPException(status_code=409, detail=f"{hall_name} is already booked on {data.event_date} for \"{conflict.title}\"")
    guest = _find_or_create_event_contact(db, data.guest_name, data.guest_phone)
    ev = Event(
        title=data.title.strip(), guest_id=guest.id, hall_name=hall_name,
        capacity=data.capacity, headcount=data.headcount, event_date=data.event_date,
        requirements=data.requirements, arrangement=data.arrangement,
        billing_type=billing_type, created_by=current_user.id,
    )
    db.add(ev)
    db.commit()
    db.refresh(ev)
    log_audit(db, current_user.id, current_user.full_name, AuditAction.CREATE, "events", ev.id,
              after_state=serialize_model(ev), ip_address=request.client.host)
    out = _event_out(db, ev)
    out["capacity_warning"] = _capacity_warning(ev.capacity, ev.headcount)
    return out


@router.get("")
async def list_events(status: str = "", db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "events", "view"):
        raise HTTPException(status_code=403, detail="Permission denied")
    q = db.query(Event)
    if status:
        q = q.filter(Event.status == status)
    events = q.order_by(Event.event_date).all()
    return {"items": [_event_out(db, e) for e in events]}


@router.get("/dashboard-widget")
async def events_dashboard_widget(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Manager-dashboard feed: today's events (if any), the nearest 3
    upcoming, and the total upcoming count so the widget can show a
    "+N more" badge the way an Android calendar widget does."""
    if not check_permission(current_user, "events", "view"):
        raise HTTPException(status_code=403, detail="Permission denied")
    today = date.today()
    active = db.query(Event).filter(Event.status != EventStatus.CANCELLED).order_by(Event.event_date).all()
    today_events = [e for e in active if e.event_date == today]
    upcoming_all = sorted((e for e in active if e.event_date > today), key=lambda e: e.event_date)
    return {
        "today": [_brief(e) for e in today_events],
        "upcoming": [_brief(e) for e in upcoming_all[:3]],
        "upcoming_total": len(upcoming_all),
    }


@router.get("/{event_id}")
async def get_event(event_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "events", "view"):
        raise HTTPException(status_code=403, detail="Permission denied")
    ev = db.query(Event).filter(Event.id == event_id).first()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    return _event_out(db, ev)


@router.put("/{event_id}")
async def update_event(event_id: int, data: EventUpdate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "events", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    ev = db.query(Event).filter(Event.id == event_id).first()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    new_hall = data.hall_name.strip() if data.hall_name is not None else ev.hall_name
    new_date = data.event_date if data.event_date is not None else ev.event_date
    if new_hall != ev.hall_name or new_date != ev.event_date:
        conflict = _hall_conflict(db, new_hall, new_date, exclude_event_id=ev.id)
        if conflict:
            raise HTTPException(status_code=409, detail=f"{new_hall} is already booked on {new_date} for \"{conflict.title}\"")
    before = serialize_model(ev)
    for field in ("title", "hall_name", "capacity", "headcount", "event_date", "requirements", "arrangement"):
        val = getattr(data, field)
        if val is not None:
            setattr(ev, field, val.strip() if isinstance(val, str) else val)
    if data.billing_type is not None:
        try:
            ev.billing_type = EventBillingType(data.billing_type)
        except ValueError:
            raise HTTPException(status_code=400, detail="billing_type must be 'split' or 'single_payer'")
    db.commit()
    db.refresh(ev)
    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "events", ev.id,
              before_state=before, after_state=serialize_model(ev), ip_address=request.client.host)
    out = _event_out(db, ev)
    out["capacity_warning"] = _capacity_warning(ev.capacity, ev.headcount)
    return out


@router.post("/{event_id}/status")
async def set_event_status(event_id: int, data: EventStatusUpdate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Forward prep-lifecycle moves (booked -> menu_set -> preparing ->
    completed) plus cancel. Postponing (moving the date) is its own endpoint
    since it needs a reason and doesn't change status."""
    if not check_permission(current_user, "events", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    ev = db.query(Event).filter(Event.id == event_id).first()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    if ev.status == EventStatus.CANCELLED:
        raise HTTPException(status_code=400, detail="This event is cancelled")
    try:
        new_status = EventStatus(data.status)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid status")
    before = serialize_model(ev)
    ev.status = new_status
    db.commit()
    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "events", ev.id,
              before_state=before, after_state=serialize_model(ev), ip_address=request.client.host)
    return _event_out(db, ev)


@router.post("/{event_id}/postpone")
async def postpone_event(event_id: int, data: EventPostponeRequest, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """The booker's own call when the chosen hall turns out to be the wrong
    size or otherwise unavailable - a manual reschedule, checked against the
    same hall/date conflict guard as create/update so it can't land on top
    of another event."""
    if not check_permission(current_user, "events", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    ev = db.query(Event).filter(Event.id == event_id).first()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    if ev.status == EventStatus.CANCELLED:
        raise HTTPException(status_code=400, detail="This event is cancelled")
    conflict = _hall_conflict(db, ev.hall_name, data.new_date, exclude_event_id=ev.id)
    if conflict:
        raise HTTPException(status_code=409, detail=f"{ev.hall_name} is already booked on {data.new_date} for \"{conflict.title}\"")
    before = serialize_model(ev)
    ev.event_date = data.new_date
    db.commit()
    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "events", ev.id,
              before_state=before, after_state=serialize_model(ev), reason=data.reason, ip_address=request.client.host)
    return _event_out(db, ev)


@router.post("/{event_id}/menu-items")
async def add_menu_item(event_id: int, data: EventMenuItemCreate, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "events", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    ev = db.query(Event).filter(Event.id == event_id).first()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    mi = EventMenuItem(event_id=ev.id, dish_name=data.dish_name.strip(),
                        estimated_price=data.estimated_price, quantity=data.quantity)
    db.add(mi)
    db.commit()
    db.refresh(mi)
    return {"id": mi.id, "dish_name": mi.dish_name, "estimated_price": float(mi.estimated_price), "quantity": mi.quantity}


@router.delete("/menu-items/{item_id}")
async def delete_menu_item(item_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "events", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    mi = db.query(EventMenuItem).filter(EventMenuItem.id == item_id).first()
    if not mi:
        raise HTTPException(status_code=404, detail="Menu item not found")
    db.delete(mi)
    db.commit()
    return {"message": "Menu item removed"}


@router.post("/{event_id}/generate-invoice")
async def generate_event_invoice(event_id: int, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Same gate as every other invoice-creating action (instant-checkout,
    walk-in mess bill): clerk_desk:create. Requires the event to be
    completed and not already invoiced."""
    if not check_permission(current_user, "clerk_desk", "create"):
        raise HTTPException(status_code=403, detail="Permission denied")
    ev = db.query(Event).filter(Event.id == event_id).first()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    if ev.status != EventStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="Only a completed event can be invoiced")
    if not ev.menu_items:
        raise HTTPException(status_code=400, detail="Add at least one menu item before generating an invoice")
    existing = db.query(Invoice).filter(Invoice.event_id == ev.id, Invoice.status != InvoiceStatus.VOID).first()
    if existing:
        raise HTTPException(status_code=400, detail="This event has already been invoiced")

    subtotal = _event_total(ev)
    today = date.today()
    note = (f"Cost split among {ev.headcount} guests" if ev.billing_type == EventBillingType.SPLIT
            else "Billed to the event organizer (single payer)")
    invoice = Invoice(
        invoice_number=f"TMP-{uuid.uuid4().hex}", guest_id=ev.guest_id, event_id=ev.id,
        issue_date=today, due_date=today, subtotal=subtotal, total_amount=subtotal,
        bill_type="event", status=InvoiceStatus.ISSUED, notes=f"{ev.title} - {note}", created_by=current_user.id,
    )
    db.add(invoice)
    db.commit()
    db.refresh(invoice)
    invoice.invoice_number = f"INV-{datetime.utcnow().strftime('%Y%m')}-{invoice.id:05d}"
    for mi in ev.menu_items:
        db.add(InvoiceItem(invoice_id=invoice.id, description=mi.dish_name, quantity=mi.quantity,
                            unit_price=float(mi.estimated_price), total_price=float(mi.estimated_price) * mi.quantity))
    db.commit()
    db.refresh(invoice)
    log_audit(db, current_user.id, current_user.full_name, AuditAction.CREATE, "invoices", invoice.id,
              after_state=serialize_model(invoice), reason=f"Event invoice: {ev.title}", ip_address=request.client.host)
    return {"invoice_id": invoice.id, "invoice_number": invoice.invoice_number, "total_amount": float(invoice.total_amount)}


@router.put("/{event_id}/actual-cost")
async def set_event_actual_cost(event_id: int, data: EventActualCostUpdate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """What the event actually cost to run - logged by Clerk (clerk_desk:edit,
    same money-facing permission that gates everything else Clerk does) so it
    can be compared against what was billed on the invoice. Deliberately not
    gated on events:edit - Clerk shouldn't be able to touch the hall/menu/
    requirements, only record actual spend."""
    if not check_permission(current_user, "clerk_desk", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    ev = db.query(Event).filter(Event.id == event_id).first()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    before = serialize_model(ev)
    ev.actual_cost = data.actual_cost
    db.commit()
    db.refresh(ev)
    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "events", ev.id,
              before_state=before, after_state=serialize_model(ev), reason="Logged actual event cost", ip_address=request.client.host)
    return _event_out(db, ev)
