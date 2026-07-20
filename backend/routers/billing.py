"""Billing and invoicing router."""
import hashlib
import json
import uuid
from datetime import datetime, date, timedelta
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Body
from sqlalchemy import and_, exists, or_
from sqlalchemy.orm import Session, joinedload
from backend.database import get_db
from backend.models import (
    Invoice, InvoiceItem, InvoicePayment, Booking, BookingCharge, InvoiceStatus,
    ClientCategory, MealAttendance, KitchenOrder, MenuPrice,
)
from backend.schemas import InvoiceItemCreate, BookingChargeCreate, PaymentCreate, DiscountApplyRequest, ComplimentaryRequest
from backend.auth import get_current_user, check_permission
from backend.audit import log_audit, serialize_model, AuditAction
from backend.logging_config import get_logger
from backend.services.mess_billing_calc import get_setting_float, get_setting_str
from backend.services.room_pricing import reprice_for_departure

logger = get_logger("app")
router = APIRouter()


def _meal_multiplier(db: Session, booking: Booking) -> float:
    """The client-category multiplier applied to meal-charge line items. Shared
    by the running-balance preview and the actual invoice build, so the Clerk
    Desk total a clerk sees can never diverge from what Instant Checkout charges."""
    if booking.client_category == ClientCategory.NON_MEMBER_NON_CIVILIAN:
        return get_setting_float(db, "non_civilian_meal_multiplier", 1.0)
    if booking.client_category == ClientCategory.NON_MEMBER_CIVILIAN:
        return get_setting_float(db, "civilian_meal_multiplier", 1.0)
    return 1.0


def _build_invoice(db: Session, booking: Booking, items: list, current_user, issue_date: date, due_date: date, tax_amount: float = 0.0, discount: float = 0.0, notes: str = None, bill_type: str = "combined") -> Invoice:
    """Shared invoice-assembly logic used by both the manual create_invoice
    endpoint and Instant Checkout: scales meal-charge line items by the
    booking's client-category multiplier, assigns a race-free invoice number,
    and creates the InvoiceItem rows."""
    meal_multiplier = _meal_multiplier(db, booking)

    effective_prices = [(item.unit_price * meal_multiplier if item.is_meal_charge else item.unit_price) for item in items]
    total = sum(price * item.quantity for price, item in zip(effective_prices, items))

    invoice = Invoice(
        invoice_number=f"TMP-{uuid.uuid4().hex}", booking_id=booking.id,
        issue_date=issue_date, due_date=due_date,
        subtotal=total, tax_amount=tax_amount,
        discount=discount, total_amount=total + tax_amount - discount,
        notes=notes, created_by=current_user.id, bill_type=bill_type,
        # A checkout bill handed to the guest is final the moment it exists -
        # 'issued', not 'draft', so revenue stats and overdue tracking see it.
        status=InvoiceStatus.ISSUED,
    )
    db.add(invoice)
    db.commit()
    db.refresh(invoice)

    # Friendly number derived from the autoincrement id (assigned above), not a
    # pre-insert count() - avoids a race where two concurrent creates generate the
    # same invoice number.
    invoice.invoice_number = f"INV-{datetime.utcnow().strftime('%Y%m')}-{invoice.id:05d}"

    for price, item in zip(effective_prices, items):
        ii = InvoiceItem(
            invoice_id=invoice.id, description=item.description,
            quantity=item.quantity, unit_price=price,
            total_price=price * item.quantity,
        )
        db.add(ii)
    db.commit()
    db.refresh(invoice)
    return invoice


def _resolve_menu_price(db: Session, recipe_id: int) -> float:
    if not recipe_id:
        return 0.0
    mp = db.query(MenuPrice).filter(MenuPrice.recipe_id == recipe_id, MenuPrice.is_active == True).first()
    return float(mp.price) if mp else 0.0


@router.get("/invoices")
async def list_invoices(
    status: str = "", search: str = "",
    page: int = Query(1, ge=1), page_size: int = Query(25, ge=1),
    db: Session = Depends(get_db), current_user=Depends(get_current_user),
):
    query = db.query(Invoice)
    if status:
        query = query.filter(Invoice.status == status)
    if search:
        query = query.filter(Invoice.invoice_number.contains(search))

    total = query.count()
    invoices = query.order_by(Invoice.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()

    return {"items": [
        {"id": inv.id, "invoice_number": inv.invoice_number, "booking_id": inv.booking_id,
         "guest_name": inv.booking.guest_name if inv.booking else None,
         "room_number": inv.booking.room.room_number if inv.booking and inv.booking.room else None,
         "issue_date": inv.issue_date, "due_date": inv.due_date,
         "subtotal": float(inv.subtotal), "tax_amount": float(inv.tax_amount),
         "discount": float(inv.discount), "total_amount": float(inv.total_amount),
         "amount_paid": float(inv.amount_paid), "status": inv.status.value,
         "bill_type": inv.bill_type or "combined", "is_complimentary": bool(inv.is_complimentary),
         "notes": inv.notes, "created_at": inv.created_at,
         "items": [{"id": i.id, "description": i.description, "quantity": i.quantity,
                    "unit_price": float(i.unit_price), "total_price": float(i.total_price)} for i in inv.items]} for inv in invoices], "total": total}


def _gather_unbilled_items(db: Session, booking_id: int):
    """Collects everything not yet invoiced for a booking, split into the two
    checkout bills: room_items (guest room charges + non-mess ad-hoc charges
    like Dhobi/Breakage/Allied) and mess_items (routine meals, a la carte,
    mess ad-hoc charges like Extra Messing / Sui Gas on Messing). Returned as
    a dict so both the read-only balance check and the mutating checkout can
    share it."""
    booking = db.query(Booking).filter(Booking.id == booking_id).first()
    room_items, mess_items, unpriced = [], [], []
    amounts = {"room": 0.0, "routine_meals": 0.0, "ala_carte": 0.0,
               "room_charges": 0.0, "mess_charges": 0.0}
    # Preview must reflect the same meal scaling the invoice will apply, or the
    # Clerk Desk total shown before checkout won't match the invoice produced.
    meal_multiplier = _meal_multiplier(db, booking)

    room_total = float(booking.total_amount) if booking.total_amount else 0.0
    late_fee = float(booking.late_checkout_fee) if booking.late_checkout_fee else 0.0
    mattress_total = 0.0
    try:
        mattress_total = float((json.loads(booking.rate_breakdown or "{}") or {}).get("mattress_total") or 0)
    except (ValueError, TypeError):
        pass
    check_out_label = booking.check_out
    # For a guest still in-house, preview the ACTUAL-stay price as of today
    # (overstayed nights added, unused nights dropped) - the same re-price
    # perform_check_out will apply, so preview always equals invoice. A
    # checked-out booking's stored figures already reflect it.
    if booking.status.value == "checked_in":
        effective_out, projected = reprice_for_departure(db, booking, date.today())
        if projected is not None:
            room_total = projected["total"]
            mattress_total = float(projected.get("mattress_total") or 0)
            check_out_label = effective_out

    if room_total:
        amounts["room"] = room_total
        # Break the paper bill's separate heads out of the booking total:
        # Extra Mattress (from the pricing snapshot) and the late checkout fee
        # each get their own line; the remainder is Guest Room Charges.
        base_room = max(room_total - late_fee - mattress_total, 0.0)
        room_no = booking.room.room_number if booking.room else ""
        label = (f"Guest Room Charges - Room {room_no} "
                 f"(From {booking.check_in.strftime('%d-%m-%y')} to {check_out_label.strftime('%d-%m-%y')})").strip()
        room_items.append(InvoiceItemCreate(description=label, quantity=1, unit_price=base_room, is_meal_charge=False))
        if mattress_total > 0:
            room_items.append(InvoiceItemCreate(description="Extra Mattress", quantity=1, unit_price=mattress_total, is_meal_charge=False))
        if late_fee > 0:
            room_items.append(InvoiceItemCreate(description="Late Checkout Fee", quantity=1, unit_price=late_fee, is_meal_charge=False))

    attendance_rows = db.query(MealAttendance).filter(
        MealAttendance.booking_id == booking_id, MealAttendance.invoiced_at.is_(None),
        MealAttendance.status.in_(["booked", "attended", "no_show"]),
    ).all()
    for a in attendance_rows:
        price = _resolve_menu_price(db, a.recipe_id)
        if a.status == "no_show":
            label = f"No-Show Charge ({a.date.strftime('%d %b')} {a.meal_type.value.title()})"
        else:
            label = f"{a.meal_type.value.title()} - {a.recipe.name if a.recipe else 'meal'}"
        if price > 0:
            # Line item stays at the raw menu price with is_meal_charge=True;
            # _build_invoice applies the multiplier. The preview amount, however,
            # must bake it in here so running-balance == invoice total.
            mess_items.append(InvoiceItemCreate(description=label, quantity=1, unit_price=price, is_meal_charge=True))
            amounts["routine_meals"] += price * meal_multiplier
        else:
            unpriced.append(label)

    ala_carte_orders = db.query(KitchenOrder).filter(
        KitchenOrder.booking_id == booking_id, KitchenOrder.is_ala_carte == True,
        KitchenOrder.status == "served", KitchenOrder.invoiced_at.is_(None),
    ).all()
    for o in ala_carte_orders:
        price = _resolve_menu_price(db, o.recipe_id)
        label = f"A la carte - {o.recipe.name if o.recipe else 'item'}"
        if price > 0:
            mess_items.append(InvoiceItemCreate(description=label, quantity=o.quantity_ordered, unit_price=price, is_meal_charge=False))
            amounts["ala_carte"] += price * o.quantity_ordered
        else:
            unpriced.append(label)

    charge_rows = db.query(BookingCharge).filter(
        BookingCharge.booking_id == booking_id, BookingCharge.invoiced_at.is_(None),
    ).all()
    for c in charge_rows:
        item = InvoiceItemCreate(description=c.head, quantity=1, unit_price=float(c.amount), is_meal_charge=False)
        if c.is_mess_charge:
            mess_items.append(item)
            amounts["mess_charges"] += float(c.amount)
        else:
            room_items.append(item)
            amounts["room_charges"] += float(c.amount)

    return {
        "room_items": room_items, "mess_items": mess_items, "unpriced": unpriced,
        "attendance_rows": attendance_rows, "ala_carte_orders": ala_carte_orders,
        "charge_rows": charge_rows, "amounts": amounts, "booking": booking,
    }


def _guest_display_name(booking: Booking) -> str:
    """Rank-prefixed guest name, without doubling the rank when the name was
    entered already carrying it ('Brig Nasir Iqbal' + rank 'Brig')."""
    name = booking.guest_name or "-"
    rank = (booking.rank or "").strip()
    if rank and not name.lower().startswith(rank.lower()):
        return f"{rank} {name}"
    return name


def _booking_bill_header(booking: Booking) -> dict:
    """Everything the printable draft-bill header needs, straight from the
    paper format: Online V/No, PA No, Rank, Name, Room No, Address."""
    return {
        "guest_name": booking.guest_name, "rank": booking.rank,
        "pa_number": booking.pa_number, "unit_address": booking.unit_address,
        "room_number": booking.room.room_number if booking.room else None,
        "check_in": booking.check_in, "check_out": booking.check_out,
        "reference_person": booking.reference_person,
        "source": booking.source or "walk_in", "online_voucher_no": booking.online_voucher_no,
        "booking_reference": booking.booking_reference,
    }


def _running_balance_payload(db: Session, booking: Booking) -> dict:
    """Read-only unbilled balance for one booking - never mutates anything.
    Shared by the single-booking endpoint and the Clerk Desk worklist."""
    gathered = _gather_unbilled_items(db, booking.id)
    amounts = gathered["amounts"]
    booking_id = booking.id
    invoices = db.query(Invoice).filter(
        Invoice.booking_id == booking_id, Invoice.status != InvoiceStatus.VOID,
    ).all()
    billed_types = {inv.bill_type for inv in invoices}
    room_billed, mess_billed = "room" in billed_types, "mess" in billed_types
    # A billed side's charges are already on an invoice - drop that side from
    # the unbilled preview instead of re-showing (and re-summing) it.
    room_items = [] if room_billed else gathered["room_items"]
    mess_items = [] if mess_billed else gathered["mess_items"]
    room_bill = 0.0 if room_billed else amounts["room"] + amounts["room_charges"]
    mess_bill = 0.0 if mess_billed else amounts["routine_meals"] + amounts["ala_carte"] + amounts["mess_charges"]
    # What the guest still owes on bills that already exist but aren't paid off.
    outstanding = sum(float(i.total_amount) - float(i.amount_paid) for i in invoices)
    # Itemized previews for the Clerk Desk's side-by-side Room / Food boxes -
    # meal lines shown at the effective (multiplied) price the invoice will use.
    meal_multiplier = _meal_multiplier(db, booking)
    preview = lambda item: {  # noqa: E731 - tiny local shaping helper
        "description": item.description,
        "amount": round((item.unit_price * meal_multiplier if item.is_meal_charge else item.unit_price) * item.quantity, 2),
    }
    return {
        "room_amount": amounts["room"], "routine_meals_amount": amounts["routine_meals"],
        "ala_carte_amount": amounts["ala_carte"],
        "room_charges_amount": amounts["room_charges"], "mess_charges_amount": amounts["mess_charges"],
        "room_bill_total": room_bill, "mess_bill_total": mess_bill,
        "room_items": [preview(i) for i in room_items],
        "mess_items": [preview(i) for i in mess_items],
        # No pre-payment concept, so what's owed = everything not yet billed
        # plus the unpaid balance of any bill already generated.
        "total": room_bill + mess_bill,
        "outstanding_invoices": outstanding,
        "balance_due": room_bill + mess_bill + outstanding,
        "unpriced_items": gathered["unpriced"],
        "room_billed": room_billed, "mess_billed": mess_billed,
    }


@router.get("/bookings/{booking_id}/running-balance")
async def running_balance(booking_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    booking = db.query(Booking).filter(Booking.id == booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    return _running_balance_payload(db, booking)


def _bill_exists(bill_type: str):
    """EXISTS clause: this booking already has a live bill of this type.
    Legacy 'combined' invoices cover both types."""
    return exists().where(and_(
        Invoice.booking_id == Booking.id,
        Invoice.status != InvoiceStatus.VOID,
        Invoice.bill_type.in_((bill_type, "combined")),
    ))


@router.get("/desk")
async def clerk_desk(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """The Clerk Desk worklist in one request: every guest who still needs
    billing attention, each with their running balance embedded.

    - checked-in guests (HRA residents excluded - they settle via the
      monthly Mess Bill and must never be checkout-able here),
    - ALL checked-out bookings still missing a room or mess bill - a real
      query, not a recent-N heuristic, so a deferred bill can never fall
      off the list no matter how much time passes, and
    - every generated-but-unsettled invoice, guests checking out TODAY
      first - so payment collection lives entirely on this desk instead of
      requiring a trip to the Billing page when the print dialog was
      closed without recording payment."""
    checked_in = db.query(Booking).options(joinedload(Booking.room)).filter(
        Booking.status == "checked_in",
        or_(Booking.nature_of_duty.is_(None), Booking.nature_of_duty != "hra"),
    ).order_by(Booking.created_at.desc()).all()

    pending_checkout = db.query(Booking).options(joinedload(Booking.room)).filter(
        Booking.status == "checked_out",
        ~and_(_bill_exists("room"), _bill_exists("mess")),
    ).order_by(Booking.actual_check_out.desc()).all()

    # Unsettled bills: anything live with money still owing. Legacy invoices
    # predate the created-as-issued rule, so 'draft' is included too.
    today = date.today()
    open_invoices = db.query(Invoice).options(joinedload(Invoice.booking).joinedload(Booking.room)).filter(
        Invoice.status.in_((InvoiceStatus.DRAFT, InvoiceStatus.ISSUED)),
    ).order_by(Invoice.created_at.desc()).all()
    unsettled = []
    for inv in open_invoices:
        balance = float(inv.total_amount) - float(inv.amount_paid)
        if balance <= 0.01:
            continue
        b = inv.booking
        unsettled.append({
            "id": inv.id, "invoice_number": inv.invoice_number,
            "bill_type": inv.bill_type or "combined",
            "total_amount": float(inv.total_amount), "amount_paid": float(inv.amount_paid),
            "balance_due": balance,
            "booking_id": inv.booking_id,
            "guest_name": b.guest_name if b else None, "rank": b.rank if b else None,
            "room_number": b.room.room_number if b and b.room else None,
            "issue_date": inv.issue_date,
            # The guest is standing at the desk right now - settle these first.
            "checking_out_now": bool(b and b.actual_check_out and b.actual_check_out.date() == today),
        })
    unsettled.sort(key=lambda r: not r["checking_out_now"])  # stable: keeps newest-first within each group

    return {
        "items": [{
            "id": b.id, "booking_reference": b.booking_reference,
            "guest_name": b.guest_name, "rank": b.rank,
            "room_number": b.room.room_number if b.room else None,
            "status": b.status.value,
            "balance": _running_balance_payload(db, b),
        } for b in checked_in + pending_checkout],
        "unsettled_invoices": unsettled,
    }


# --- Ad-hoc booking charges (Dhobi, Breakage, Allied, Extra Messing...) ---

@router.get("/bookings/{booking_id}/charges")
async def list_booking_charges(booking_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    charges = db.query(BookingCharge).filter(BookingCharge.booking_id == booking_id).order_by(BookingCharge.created_at.desc()).all()
    return [{"id": c.id, "head": c.head, "amount": float(c.amount), "is_mess_charge": c.is_mess_charge,
             "invoiced": c.invoiced_at is not None, "created_at": c.created_at} for c in charges]


@router.post("/bookings/{booking_id}/charges")
async def add_booking_charge(booking_id: int, data: BookingChargeCreate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    # Decoupled billing: a mess charge (Extra Messing, Sui Gas...) is Mess
    # Staff's domain, everything else (Dhobi, Breakage, Allied...) is
    # Booking Staff's - each guarded by its own existing permission module.
    required_module = "mess_billing" if data.is_mess_charge else "billing"
    if not check_permission(current_user, required_module, "create"):
        raise HTTPException(status_code=403, detail="Permission denied")
    booking = db.query(Booking).filter(Booking.id == booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking.status.value not in ("confirmed", "checked_in"):
        raise HTTPException(status_code=400, detail=f"Cannot add charges to a booking with status '{booking.status.value}'")
    charge = BookingCharge(booking_id=booking_id, head=data.head.strip(), amount=data.amount,
                           is_mess_charge=data.is_mess_charge, created_by=current_user.id)
    db.add(charge)
    db.commit()
    db.refresh(charge)
    log_audit(db, current_user.id, current_user.full_name, AuditAction.CREATE, "booking_charges", charge.id,
              after_state=serialize_model(charge), ip_address=request.client.host)
    return {"id": charge.id, "head": charge.head, "amount": float(charge.amount), "is_mess_charge": charge.is_mess_charge}


@router.delete("/charges/{charge_id}")
async def delete_booking_charge(charge_id: int, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    charge = db.query(BookingCharge).filter(BookingCharge.id == charge_id).first()
    if not charge:
        raise HTTPException(status_code=404, detail="Charge not found")
    required_module = "mess_billing" if charge.is_mess_charge else "billing"
    if not check_permission(current_user, required_module, "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    if charge.invoiced_at is not None:
        raise HTTPException(status_code=400, detail="Charge is already on an invoice - void the invoice instead")
    before = serialize_model(charge)
    db.delete(charge)
    db.commit()
    log_audit(db, current_user.id, current_user.full_name, AuditAction.SOFT_DELETE, "booking_charges", charge_id,
              before_state=before, reason="Charge removed before invoicing", ip_address=request.client.host)
    return {"message": "Charge removed"}


def _invoice_out(inv: Invoice) -> dict:
    return {
        "id": inv.id, "invoice_number": inv.invoice_number, "bill_type": inv.bill_type or "combined",
        "issue_date": inv.issue_date, "subtotal": float(inv.subtotal),
        "total_amount": float(inv.total_amount), "amount_paid": float(inv.amount_paid),
        "balance_due": float(inv.total_amount) - float(inv.amount_paid),
        "status": inv.status.value, "is_complimentary": bool(inv.is_complimentary),
        "items": [{"description": i.description, "quantity": float(i.quantity),
                   "unit_price": float(i.unit_price), "total_price": float(i.total_price)} for i in inv.items],
    }


@router.post("/bookings/{booking_id}/instant-checkout")
async def instant_checkout(booking_id: int, request: Request, bill_types: Optional[List[str]] = Body(default=None, embed=True),
                            db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Compiles all unbilled charges for a checked-in guest - room charges
    (guest room charges + dhobi/breakage/allied...) and mess charges
    (routine meals, a la carte, extra messing...) - into ONE final invoice,
    the Clerk's single combined bill. bill_types selects which side to
    include now - defaults to both, but either can be settled alone and the
    other finalized later (e.g. an a la carte order still pending); if both
    happen to be billed in the same call they land on the SAME invoice, not
    two. No advance is applied - payment is settled here at checkout, via the
    Pay Together / per-bill payment actions the print dialog offers.
    Guest/booking-only - members settle through the monthly Mess Bill cycle
    instead."""
    booking = db.query(Booking).filter(Booking.id == booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking.status.value not in ("checked_in", "checked_out"):
        raise HTTPException(status_code=400, detail=f"Cannot check out a booking with status '{booking.status.value}' - guest must be checked in")
    if booking.nature_of_duty == "hra":
        raise HTTPException(status_code=400, detail="HRA residents settle via the monthly Mess Bill - this residency cannot be checked out here")

    # Booking/Mess Staff only ever log charges (add_booking_charge, gated
    # separately below) - generating the actual invoice is the Clerk's job.
    if not check_permission(current_user, "clerk_desk", "create"):
        raise HTTPException(status_code=403, detail="Permission denied")

    requested = set(bill_types) if bill_types else {"room", "mess"}
    if requested - {"room", "mess"}:
        raise HTTPException(status_code=400, detail="bill_types must be 'room' and/or 'mess'")
    # 'combined' (this endpoint's normal output now) covers both sides at
    # once; legacy 'room'/'mess' rows (from before bills were merged) each
    # cover only their own side.
    already_billed_types = {inv.bill_type for inv in db.query(Invoice).filter(
        Invoice.booking_id == booking_id, Invoice.status != InvoiceStatus.VOID,
    ).all()}
    room_done = bool(already_billed_types & {"room", "combined"})
    mess_done = bool(already_billed_types & {"mess", "combined"})
    # Silently skip a side that's already billed instead of failing the whole
    # request - Clerk always asks for "both", and one side may have been
    # settled earlier (e.g. an a la carte order still pending at the time).
    if room_done:
        requested.discard("room")
    if mess_done:
        requested.discard("mess")

    # Actually check the guest out FIRST (status, room freed to housekeeping,
    # late fee assessed) so the fee lands on the room bill and the Clerk Desk
    # card disappears. Previously this endpoint only invoiced, leaving the
    # booking checked_in - the card stayed put and a second click 409'd.
    late_fee = 0.0
    if booking.status.value == "checked_in":
        from backend.routers.bookings import perform_check_out
        late_fee = perform_check_out(db, booking, current_user)

    gathered = _gather_unbilled_items(db, booking_id)
    room_items = gathered["room_items"] if "room" in requested else []
    mess_items = gathered["mess_items"] if "mess" in requested else []
    if not room_items and not mess_items:
        raise HTTPException(status_code=400, detail="Nothing to invoice for this booking")

    today = date.today()
    now = datetime.utcnow()
    # One invoice, not two: when both sides are being billed in this call
    # they're merged into a single combined bill; if only one side has
    # anything to bill right now, the invoice is labeled for just that side
    # (still a single row, matching what a later "generate remaining bill"
    # call for the other side would also produce).
    if room_items and mess_items:
        bill_type = "combined"
    elif room_items:
        bill_type = "room"
    else:
        bill_type = "mess"
    invoice = _build_invoice(db, booking, room_items + mess_items, current_user, today, today, bill_type=bill_type)
    if room_items:
        for c in gathered["charge_rows"]:
            if not c.is_mess_charge:
                c.invoiced_at = now
    if mess_items:
        for a in gathered["attendance_rows"]:
            a.invoiced_at = now
        for o in gathered["ala_carte_orders"]:
            o.invoiced_at = now
        for c in gathered["charge_rows"]:
            if c.is_mess_charge:
                c.invoiced_at = now
    db.commit()
    invoices = [invoice]

    for inv in invoices:
        log_audit(db, current_user.id, current_user.full_name, AuditAction.CREATE, "invoices", inv.id,
                  after_state=serialize_model(inv), ip_address=request.client.host)

    grand_total = sum(float(i.total_amount) for i in invoices)
    return {
        "invoices": [_invoice_out(inv) for inv in invoices],
        "booking": _booking_bill_header(booking),
        "unpriced_items": gathered["unpriced"],
        "late_checkout_fee": late_fee,
        "grand_total": grand_total,
        "balance_due": grand_total,
    }


def _invoice_qr_svg(payload: str) -> str:
    """Locally generated QR (reportlab - no internet, nothing leaves the
    LAN), returned as an inline-able SVG string."""
    from reportlab.graphics.barcode.qr import QrCodeWidget
    from reportlab.graphics.shapes import Drawing
    from reportlab.graphics import renderSVG
    qr = QrCodeWidget(payload)
    x0, y0, x1, y1 = qr.getBounds()
    size = 200.0
    drawing = Drawing(size, size, transform=[size / (x1 - x0), 0, 0, size / (y1 - y0), 0, 0])
    drawing.add(qr)
    svg = renderSVG.drawToString(drawing)
    return svg[svg.find("<svg"):]  # strip the XML declaration so it can be inlined in HTML


@router.get("/bookings/{booking_id}/master-invoice")
async def master_invoice(booking_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Clerk consolidation: combines a stay's separate room and mess
    invoices (generated independently by Booking Staff and Mess Staff) into
    one comprehensive master invoice - one merged item list, one grand
    total, one printable document. Read-only; the underlying invoices stay
    exactly as they are, so nothing here can double-count revenue."""
    booking = db.query(Booking).filter(Booking.id == booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    invoices = db.query(Invoice).filter(
        Invoice.booking_id == booking_id, Invoice.status != InvoiceStatus.VOID,
    ).order_by(Invoice.issue_date, Invoice.id).all()
    if not invoices:
        raise HTTPException(status_code=404, detail="No bills generated yet for this stay")

    items = []
    for inv in invoices:
        label = {"room": "Room Bill", "mess": "Mess Bill"}.get(inv.bill_type or "combined", "Bill")
        for it in inv.items:
            items.append({
                "source": inv.bill_type or "combined", "source_label": label,
                "description": it.description, "quantity": float(it.quantity),
                "unit_price": float(it.unit_price), "total_price": float(it.total_price),
            })

    subtotal = sum(float(inv.subtotal) for inv in invoices)
    tax_amount = sum(float(inv.tax_amount) for inv in invoices)
    discount = sum(float(inv.discount) for inv in invoices)
    total_amount = sum(float(inv.total_amount) for inv in invoices)
    amount_paid = sum(float(inv.amount_paid) for inv in invoices)

    mess_name = get_setting_str(db, "mess_name", "EME Officers Mess")
    mess_address = get_setting_str(db, "mess_address", "204 Firdousi Road, Rawalpindi")
    mess_phone = get_setting_str(db, "mess_phone", "Tele No. G.H.Q 31725")
    verify_hash = hashlib.sha256(
        "|".join([str(inv.id) for inv in invoices] + [f"{total_amount:.2f}"]).encode()
    ).hexdigest()[:12].upper()

    return {
        "booking": _booking_bill_header(booking),
        "source_invoices": [{"id": inv.id, "invoice_number": inv.invoice_number, "bill_type": inv.bill_type or "combined"} for inv in invoices],
        "items": items,
        "subtotal": subtotal, "tax_amount": tax_amount, "discount": discount,
        "total_amount": total_amount, "amount_paid": amount_paid, "balance_due": total_amount - amount_paid,
        "is_complimentary": all(inv.is_complimentary for inv in invoices),
        "mess": {"name": mess_name, "address": mess_address, "phone": mess_phone},
        "verify_hash": verify_hash,
        "qr_svg": _invoice_qr_svg(f"{mess_name}\nMaster Invoice: {', '.join(i.invoice_number for i in invoices)}\nTotal: Rs {total_amount:,.0f}\nVerify: {verify_hash}"),
    }


def _live_invoices_for_master(db: Session, booking_id: int):
    invoices = db.query(Invoice).filter(
        Invoice.booking_id == booking_id, Invoice.status != InvoiceStatus.VOID,
    ).all()
    if not invoices:
        raise HTTPException(status_code=404, detail="No bills generated yet for this stay")
    if any(inv.status == InvoiceStatus.PAID for inv in invoices):
        raise HTTPException(status_code=400, detail="Cannot adjust a stay with an already-paid bill")
    return invoices


@router.post("/bookings/{booking_id}/master-invoice/complimentary")
async def master_invoice_complimentary(booking_id: int, data: ComplimentaryRequest, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Marks the WHOLE stay complimentary in one action - every live invoice
    (room + mess) for this booking, not just one. Clerk-only, admin-granted."""
    if not check_permission(current_user, "clerk_desk", "approve"):
        raise HTTPException(status_code=403, detail="Permission denied")
    invoices = _live_invoices_for_master(db, booking_id)

    for inv in invoices:
        before = serialize_model(inv)
        if data.is_complimentary:
            inv.discount = float(inv.subtotal)
            inv.tax_amount = 0
            inv.total_amount = 0
            inv.is_complimentary = True
            inv.complimentary_reason = data.reason
        else:
            inv.is_complimentary = False
            inv.complimentary_reason = None
            inv.discount = 0
            inv.total_amount = float(inv.subtotal) + float(inv.tax_amount)
        db.commit()
        db.refresh(inv)
        log_audit(db, current_user.id, current_user.full_name, AuditAction.OVERRIDE, "invoices", inv.id,
                  before_state=before, after_state=serialize_model(inv), reason=data.reason, ip_address=request.client.host)

    return {"booking_id": booking_id, "is_complimentary": data.is_complimentary,
            "total_amount": sum(float(inv.total_amount) for inv in invoices)}


@router.post("/bookings/{booking_id}/master-invoice/discount")
async def master_invoice_discount(booking_id: int, data: DiscountApplyRequest, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Applies one discount across the WHOLE stay's live invoices at once. A
    rate applies independently to each invoice's own subtotal; a flat amount
    is split proportionally by each invoice's share of the combined
    subtotal (the last invoice absorbs any rounding remainder)."""
    if not check_permission(current_user, "clerk_desk", "approve"):
        raise HTTPException(status_code=403, detail="Permission denied")
    invoices = _live_invoices_for_master(db, booking_id)

    combined_subtotal = sum(float(inv.subtotal) for inv in invoices)
    if data.discount_amount is not None and data.discount_amount > combined_subtotal:
        raise HTTPException(status_code=400, detail="Discount cannot exceed the combined subtotal")

    remaining = data.discount_amount if data.discount_amount is not None else None
    for idx, inv in enumerate(invoices):
        before = serialize_model(inv)
        if data.discount_rate is not None:
            inv_discount = round(float(inv.subtotal) * data.discount_rate / 100, 2)
        elif idx == len(invoices) - 1:
            inv_discount = round(remaining, 2)
        else:
            share = round(remaining * (float(inv.subtotal) / combined_subtotal), 2) if combined_subtotal else 0
            inv_discount = share
            remaining -= share
        inv.discount = inv_discount
        inv.total_amount = float(inv.subtotal) + float(inv.tax_amount) - inv_discount
        db.commit()
        db.refresh(inv)
        log_audit(db, current_user.id, current_user.full_name, AuditAction.OVERRIDE, "invoices", inv.id,
                  before_state=before, after_state=serialize_model(inv), reason=data.reason, ip_address=request.client.host)

    return {"booking_id": booking_id, "total_amount": sum(float(inv.total_amount) for inv in invoices)}


@router.get("/invoices/{invoice_id}/print-data")
async def invoice_print_data(invoice_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Everything needed to print one bill in the mess's paper format:
    invoice lines, booking-register header fields, mess identity, and a QR
    code carrying the bill summary."""
    inv = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    booking = inv.booking

    mess_name = get_setting_str(db, "mess_name", "EME Officers Mess")
    mess_address = get_setting_str(db, "mess_address", "204 Firdousi Road, Rawalpindi")
    mess_phone = get_setting_str(db, "mess_phone", "Tele No. G.H.Q 31725")

    balance = float(inv.total_amount) - float(inv.amount_paid)
    bill_label = {"room": "Room Bill", "mess": "Mess Bill"}.get(inv.bill_type or "combined", "Bill")
    # Tamper-evident summary hash for audit: recomputable from the stored
    # invoice, so a printed bill can be verified against the system later.
    verify_hash = hashlib.sha256(
        f"{inv.id}|{inv.invoice_number}|{float(inv.total_amount):.2f}|{inv.issue_date.isoformat()}".encode()
    ).hexdigest()[:12].upper()
    payload = "\n".join(filter(None, [
        mess_name,
        f"{bill_label}: {inv.invoice_number}",
        "COMPLIMENTARY" if inv.is_complimentary else None,
        f"Guest: {_guest_display_name(booking)}" if booking else None,
        f"Room: {booking.room.room_number}" if booking and booking.room else None,
        f"Stay: {booking.check_in.strftime('%d-%m-%y')} to {booking.check_out.strftime('%d-%m-%y')}" if booking else None,
        f"Online V/No: {booking.online_voucher_no}" if booking and booking.online_voucher_no else None,
        f"Total: Rs {float(inv.total_amount):,.0f}",
        f"Paid: Rs {float(inv.amount_paid):,.0f}",
        f"Balance: Rs {balance:,.0f}",
        f"Date: {inv.issue_date.strftime('%d-%m-%Y')}",
        f"Verify: {verify_hash}",
    ]))

    return {
        "invoice": _invoice_out(inv),
        "booking": _booking_bill_header(booking) if booking else None,
        "mess": {"name": mess_name, "address": mess_address, "phone": mess_phone},
        "verify_hash": verify_hash,
        "qr_svg": _invoice_qr_svg(payload),
    }


@router.post("/invoices/{invoice_id}/void")
async def void_invoice(invoice_id: int, reason: str, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    inv = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if not check_permission(current_user, "clerk_desk", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    if inv.status == InvoiceStatus.VOID:
        raise HTTPException(status_code=400, detail="Invoice is already void")

    before = serialize_model(inv)
    inv.status = InvoiceStatus.VOID

    # Release the source rows this bill had claimed, so a corrected bill can
    # be generated afterwards - otherwise the meals/charges stay stamped
    # invoiced_at forever and silently vanish from any future bill.
    if inv.booking_id:
        bill_type = inv.bill_type or "combined"
        if bill_type in ("mess", "combined"):
            for a in db.query(MealAttendance).filter(
                    MealAttendance.booking_id == inv.booking_id, MealAttendance.invoiced_at.isnot(None)).all():
                a.invoiced_at = None
            for o in db.query(KitchenOrder).filter(
                    KitchenOrder.booking_id == inv.booking_id, KitchenOrder.is_ala_carte == True,
                    KitchenOrder.invoiced_at.isnot(None)).all():
                o.invoiced_at = None
        charge_query = db.query(BookingCharge).filter(
            BookingCharge.booking_id == inv.booking_id, BookingCharge.invoiced_at.isnot(None))
        if bill_type == "mess":
            charge_query = charge_query.filter(BookingCharge.is_mess_charge == True)
        elif bill_type == "room":
            charge_query = charge_query.filter(BookingCharge.is_mess_charge == False)
        for c in charge_query.all():
            c.invoiced_at = None
    db.commit()

    log_audit(db, current_user.id, current_user.full_name, AuditAction.OVERRIDE, "invoices", inv.id, before_state=before, after_state=serialize_model(inv), reason=f"Voided: {reason}", ip_address=request.client.host)
    return {"message": "Invoice voided"}


@router.get("/invoices/{invoice_id}/payments")
async def list_payments(invoice_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    inv = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    payments = db.query(InvoicePayment).filter(InvoicePayment.invoice_id == invoice_id).order_by(InvoicePayment.created_at.desc()).all()
    return [{"id": p.id, "invoice_id": p.invoice_id, "amount": float(p.amount), "method": p.method,
             "notes": p.notes, "received_by": p.received_by, "created_at": p.created_at} for p in payments]


@router.post("/invoices/{invoice_id}/payments")
async def record_payment(invoice_id: int, data: PaymentCreate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    inv = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if not check_permission(current_user, "clerk_desk", "create"):
        raise HTTPException(status_code=403, detail="Permission denied")
    if inv.status == InvoiceStatus.VOID:
        raise HTTPException(status_code=400, detail="Cannot record a payment against a void invoice")

    balance_due = float(inv.total_amount) - float(inv.amount_paid)
    if data.amount > balance_due + 0.01:  # small epsilon for float rounding
        raise HTTPException(status_code=400, detail=f"Payment of {data.amount:.2f} exceeds balance due of {balance_due:.2f}")

    before = serialize_model(inv)
    payment = InvoicePayment(
        invoice_id=invoice_id, amount=data.amount, method=data.method,
        notes=data.notes, received_by=current_user.id,
    )
    db.add(payment)

    inv.amount_paid = float(inv.amount_paid) + data.amount
    if float(inv.amount_paid) >= float(inv.total_amount) - 0.01:
        inv.status = InvoiceStatus.PAID
    elif inv.status == InvoiceStatus.DRAFT:
        inv.status = InvoiceStatus.ISSUED

    db.commit()
    db.refresh(inv)
    db.refresh(payment)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "invoices", inv.id,
              before_state=before, after_state=serialize_model(inv),
              reason=f"Payment of {data.amount:.2f} recorded", ip_address=request.client.host)
    return {"id": payment.id, "amount_paid": float(inv.amount_paid), "balance_due": float(inv.total_amount) - float(inv.amount_paid), "status": inv.status.value}


@router.get("/payments/{payment_id}/receipt-data")
async def payment_receipt_data(payment_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Print data for the mess's cash-receipt format ('Received from ... the
    sum of Rupees ... on account of Mess Bill ... by Cash/Cheque')."""
    payment = db.query(InvoicePayment).filter(InvoicePayment.id == payment_id).first()
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    inv = payment.invoice
    booking = inv.booking if inv else None

    mess_name = get_setting_str(db, "mess_name", "EME Officers Mess")
    mess_address = get_setting_str(db, "mess_address", "204 Firdousi Road, Rawalpindi")
    mess_phone = get_setting_str(db, "mess_phone", "Tele No. G.H.Q 31725")

    guest = _guest_display_name(booking) if booking else "-"
    payload = "\n".join([
        mess_name,
        f"Receipt No: {payment.id}",
        f"Received from: {guest}",
        f"Amount: Rs {float(payment.amount):,.0f}",
        f"On account of: {inv.bill_type or 'mess'} bill {inv.invoice_number}" if inv else "",
        f"By: {payment.method or 'Cash'}",
        f"Date: {payment.created_at.strftime('%d-%m-%Y')}",
    ])

    return {
        "receipt_no": payment.id,
        "date": payment.created_at,
        "received_from": guest,
        "amount": float(payment.amount),
        "method": payment.method or "Cash",
        "notes": payment.notes,
        "on_account_of": f"{({'room': 'Room Bill', 'mess': 'Mess Bill'}.get(inv.bill_type or 'combined', 'Bill'))} {inv.invoice_number}" if inv else None,
        "invoice_number": inv.invoice_number if inv else None,
        "room_number": booking.room.room_number if booking and booking.room else None,
        "mess": {"name": mess_name, "address": mess_address, "phone": mess_phone},
        "qr_svg": _invoice_qr_svg(payload),
    }


@router.post("/invoices/{invoice_id}/apply-discount")
async def apply_invoice_discount(invoice_id: int, data: DiscountApplyRequest, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    # Authorization is derived entirely from the authenticated session, mirroring
    # mess_billing.py:apply_discount - never a client-supplied id.
    inv = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if not check_permission(current_user, "clerk_desk", "approve"):
        raise HTTPException(status_code=403, detail="Permission denied")
    if inv.status in (InvoiceStatus.VOID, InvoiceStatus.PAID):
        raise HTTPException(status_code=400, detail=f"Cannot discount an invoice with status '{inv.status.value}'")

    before = serialize_model(inv)
    discount_amount = data.discount_amount if data.discount_amount is not None else float(inv.subtotal) * data.discount_rate / 100
    if discount_amount > float(inv.subtotal):
        raise HTTPException(status_code=400, detail="Discount cannot exceed the invoice subtotal")

    inv.discount = discount_amount
    inv.total_amount = float(inv.subtotal) + float(inv.tax_amount) - discount_amount
    db.commit()
    db.refresh(inv)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.OVERRIDE, "invoices", inv.id, before_state=before, after_state=serialize_model(inv), reason=data.reason, ip_address=request.client.host)
    return {"id": inv.id, "discount": float(inv.discount), "total_amount": float(inv.total_amount)}


@router.post("/invoices/{invoice_id}/complimentary")
async def mark_invoice_complimentary(invoice_id: int, data: ComplimentaryRequest, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Marks the whole invoice complimentary (Rs 0), distinct from a partial
    discount - same approval tier as apply-discount since it waives revenue."""
    inv = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if not check_permission(current_user, "clerk_desk", "approve"):
        raise HTTPException(status_code=403, detail="Permission denied")
    if inv.status in (InvoiceStatus.VOID, InvoiceStatus.PAID):
        raise HTTPException(status_code=400, detail=f"Cannot make an invoice with status '{inv.status.value}' complimentary")

    before = serialize_model(inv)
    if data.is_complimentary:
        inv.discount = float(inv.subtotal)
        inv.tax_amount = 0
        inv.total_amount = 0
        inv.is_complimentary = True
        inv.complimentary_reason = data.reason
    else:
        inv.is_complimentary = False
        inv.complimentary_reason = None
        inv.discount = 0
        inv.total_amount = float(inv.subtotal) + float(inv.tax_amount)
    db.commit()
    db.refresh(inv)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.OVERRIDE, "invoices", inv.id,
              before_state=before, after_state=serialize_model(inv), reason=data.reason, ip_address=request.client.host)
    return {"id": inv.id, "is_complimentary": inv.is_complimentary, "discount": float(inv.discount), "total_amount": float(inv.total_amount)}


@router.get("/dashboard-stats")
async def billing_stats(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    today = date.today()
    month_start = today.replace(day=1)

    today_invoices = db.query(Invoice).filter(
        Invoice.issue_date == today,
        Invoice.status.in_(["issued", "paid"]),
    ).all()

    month_total = sum(float(inv.total_amount) for inv in db.query(Invoice).filter(
        Invoice.issue_date >= month_start,
        Invoice.status.in_(["issued", "paid"]),
    ).all())

    # Overdue is derived, not a stored status: an issued bill past its due
    # date with money still owing. (Nothing in the system ever transitions an
    # invoice to the stored OVERDUE status.)
    overdue = db.query(Invoice).filter(
        Invoice.status == InvoiceStatus.ISSUED, Invoice.due_date < today,
    ).count()

    return {
        "today_revenue": sum(float(inv.total_amount) for inv in today_invoices),
        "today_invoice_count": len(today_invoices),
        "month_revenue": month_total,
        "overdue_invoices": overdue,
    }
