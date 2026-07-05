"""Billing and invoicing router."""
import uuid
from datetime import datetime, date, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.models import Invoice, InvoiceItem, InvoicePayment, Booking, InvoiceStatus, ClientCategory, MealAttendance, KitchenOrder, MenuPrice
from backend.schemas import InvoiceCreate, InvoiceItemCreate, PaymentCreate, DiscountApplyRequest
from backend.auth import get_current_user, check_permission
from backend.audit import log_audit, serialize_model, AuditAction
from backend.logging_config import get_logger
from backend.services.mess_billing_calc import get_setting_float

logger = get_logger("app")
router = APIRouter()


def _build_invoice(db: Session, booking: Booking, items: list, current_user, issue_date: date, due_date: date, tax_amount: float = 0.0, discount: float = 0.0, notes: str = None) -> Invoice:
    """Shared invoice-assembly logic used by both the manual create_invoice
    endpoint and Instant Checkout: scales meal-charge line items by the
    booking's client-category multiplier, assigns a race-free invoice number,
    and creates the InvoiceItem rows."""
    meal_multiplier = 1.0
    if booking.client_category == ClientCategory.NON_MEMBER_NON_CIVILIAN:
        meal_multiplier = get_setting_float(db, "non_civilian_meal_multiplier", 1.0)
    elif booking.client_category == ClientCategory.NON_MEMBER_CIVILIAN:
        meal_multiplier = get_setting_float(db, "civilian_meal_multiplier", 1.0)

    effective_prices = [(item.unit_price * meal_multiplier if item.is_meal_charge else item.unit_price) for item in items]
    total = sum(price * item.quantity for price, item in zip(effective_prices, items))

    invoice = Invoice(
        invoice_number=f"TMP-{uuid.uuid4().hex}", booking_id=booking.id,
        issue_date=issue_date, due_date=due_date,
        subtotal=total, tax_amount=tax_amount,
        discount=discount, total_amount=total + tax_amount - discount,
        notes=notes, created_by=current_user.id,
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
         "notes": inv.notes, "created_at": inv.created_at,
         "items": [{"id": i.id, "description": i.description, "quantity": i.quantity,
                    "unit_price": float(i.unit_price), "total_price": float(i.total_price)} for i in inv.items]} for inv in invoices], "total": total}


@router.post("/invoices")
async def create_invoice(data: InvoiceCreate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "billing", "create"):
        raise HTTPException(status_code=403, detail="Permission denied")

    booking = db.query(Booking).filter(Booking.id == data.booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    if booking.status.value not in ("checked_in", "checked_out"):
        raise HTTPException(status_code=400, detail=f"Cannot invoice a booking with status '{booking.status.value}' - guest must be checked in")

    # Check for existing invoice
    existing = db.query(Invoice).filter(Invoice.booking_id == data.booking_id, Invoice.status != InvoiceStatus.VOID).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Invoice already exists: {existing.invoice_number}")

    invoice = _build_invoice(db, booking, data.items, current_user, data.issue_date, data.due_date, data.tax_amount, data.discount, data.notes)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.CREATE, "invoices", invoice.id, after_state=serialize_model(invoice), ip_address=request.client.host)
    return {"id": invoice.id, "invoice_number": invoice.invoice_number, "total_amount": float(invoice.total_amount)}


def _gather_unbilled_items(db: Session, booking_id: int):
    """Collects everything not yet invoiced for a booking: room amount, priced
    routine-meal MealAttendance rows, and priced a la carte KitchenOrders.
    Returns (items: List[InvoiceItemCreate], unpriced: List[str], attendance_rows,
    ala_carte_orders, amounts: {room, routine_meals, ala_carte}) so both a
    read-only balance check and the mutating checkout can share it."""
    booking = db.query(Booking).filter(Booking.id == booking_id).first()
    items, unpriced = [], []
    amounts = {"room": 0.0, "routine_meals": 0.0, "ala_carte": 0.0}

    if booking.total_amount:
        amounts["room"] = float(booking.total_amount)
        items.append(InvoiceItemCreate(description=f"Room {booking.room.room_number if booking.room else ''} stay".strip(), quantity=1, unit_price=amounts["room"], is_meal_charge=False))

    attendance_rows = db.query(MealAttendance).filter(
        MealAttendance.booking_id == booking_id, MealAttendance.invoiced_at.is_(None),
        MealAttendance.status.in_(["booked", "attended"]),
    ).all()
    for a in attendance_rows:
        price = _resolve_menu_price(db, a.recipe_id)
        label = f"{a.meal_type.value.title()} - {a.recipe.name if a.recipe else 'meal'}"
        if price > 0:
            items.append(InvoiceItemCreate(description=label, quantity=1, unit_price=price, is_meal_charge=True))
            amounts["routine_meals"] += price
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
            items.append(InvoiceItemCreate(description=label, quantity=o.quantity_ordered, unit_price=price, is_meal_charge=False))
            amounts["ala_carte"] += price * o.quantity_ordered
        else:
            unpriced.append(label)

    return items, unpriced, attendance_rows, ala_carte_orders, amounts


@router.get("/bookings/{booking_id}/running-balance")
async def running_balance(booking_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Read-only balance for the Clerk Desk card - never mutates anything."""
    booking = db.query(Booking).filter(Booking.id == booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    _, unpriced, _, _, amounts = _gather_unbilled_items(db, booking_id)
    return {
        "room_amount": amounts["room"], "routine_meals_amount": amounts["routine_meals"],
        "ala_carte_amount": amounts["ala_carte"], "total": sum(amounts.values()),
        "unpriced_items": unpriced,
    }


@router.post("/bookings/{booking_id}/instant-checkout")
async def instant_checkout(booking_id: int, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Compiles room + routine-meal + a la carte charges for a checked-in
    guest into one Invoice in a single click. Guest/booking-only - members
    settle through the existing monthly Mess Bill cycle instead."""
    if not check_permission(current_user, "billing", "create"):
        raise HTTPException(status_code=403, detail="Permission denied")
    booking = db.query(Booking).filter(Booking.id == booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking.status.value not in ("checked_in", "checked_out"):
        raise HTTPException(status_code=400, detail=f"Cannot check out a booking with status '{booking.status.value}' - guest must be checked in")
    existing = db.query(Invoice).filter(Invoice.booking_id == booking_id, Invoice.status != InvoiceStatus.VOID).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Invoice already exists: {existing.invoice_number}")

    items, unpriced, attendance_rows, ala_carte_orders, _ = _gather_unbilled_items(db, booking_id)
    if not items:
        raise HTTPException(status_code=400, detail="Nothing to invoice for this booking")

    today = date.today()
    invoice = _build_invoice(db, booking, items, current_user, today, today)

    for a in attendance_rows:
        a.invoiced_at = datetime.utcnow()
    for o in ala_carte_orders:
        o.invoiced_at = datetime.utcnow()
    db.commit()

    log_audit(db, current_user.id, current_user.full_name, AuditAction.CREATE, "invoices", invoice.id, after_state=serialize_model(invoice), ip_address=request.client.host)
    return {
        "id": invoice.id, "invoice_number": invoice.invoice_number, "total_amount": float(invoice.total_amount),
        "items": [{"description": i.description, "quantity": float(i.quantity), "unit_price": float(i.unit_price), "total_price": float(i.total_price)} for i in invoice.items],
        "unpriced_items": unpriced,
    }


@router.post("/invoices/{invoice_id}/void")
async def void_invoice(invoice_id: int, reason: str, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "billing", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    inv = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if inv.status == InvoiceStatus.VOID:
        raise HTTPException(status_code=400, detail="Invoice is already void")

    before = serialize_model(inv)
    inv.status = InvoiceStatus.VOID
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
    if not check_permission(current_user, "billing", "create"):
        raise HTTPException(status_code=403, detail="Permission denied")
    inv = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
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


@router.post("/invoices/{invoice_id}/apply-discount")
async def apply_invoice_discount(invoice_id: int, data: DiscountApplyRequest, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    # Authorization is derived entirely from the authenticated session, mirroring
    # mess_billing.py:apply_discount - never a client-supplied id.
    if not check_permission(current_user, "billing", "approve"):
        raise HTTPException(status_code=403, detail="Permission denied")
    inv = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
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


@router.get("/dashboard-stats")
async def billing_stats(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    today = date.today()
    month_start = today.replace(day=1)

    today_revenue = db.query(Invoice).filter(
        Invoice.created_at >= datetime.combine(today, datetime.min.time()),
        Invoice.status.in_(["issued", "paid"]),
    ).count()

    today_total = sum(float(inv.total_amount) for inv in db.query(Invoice).filter(
        Invoice.created_at >= datetime.combine(today, datetime.min.time()),
        Invoice.status.in_(["issued", "paid"]),
    ).all())

    month_total = sum(float(inv.total_amount) for inv in db.query(Invoice).filter(
        Invoice.issue_date >= month_start,
        Invoice.status.in_(["issued", "paid"]),
    ).all())

    overdue = db.query(Invoice).filter(Invoice.status == InvoiceStatus.OVERDUE).count()

    return {
        "today_revenue": today_total,
        "today_invoice_count": today_revenue,
        "month_revenue": month_total,
        "overdue_invoices": overdue,
    }
