"""Communal per-head mess billing for permanent members."""
import hashlib
from datetime import datetime, date, timedelta
from calendar import monthrange
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.models import (
    Member, MemberStatus, MessBill, MessBillStatus, GuestMealCharge,
    PurchaseOrder, POStatus, Booking, KitchenOrder, Room, Alert, AlertStatus, AlertSeverity,
)
from backend.schemas import GuestMealChargeCreate, DiscountApplyRequest
from backend.auth import get_current_user, check_permission, PermissionChecker
from backend.audit import log_audit, serialize_model, AuditAction
from backend.logging_config import get_logger
from backend.alerts import create_alert
from backend.services.mess_billing_calc import get_man_days, get_setting_float, get_setting_str
from backend.services.room_pricing import get_hra_rank_rate, get_hra_utility_rate, get_womens_bloc_rank_rate

logger = get_logger("app")
router = APIRouter(dependencies=[Depends(PermissionChecker("mess_billing", "view"))])


@router.get("/bills")
async def list_bills(
    member_id: int = 0, month: int = 0, year: int = 0, status: str = "",
    page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db), current_user=Depends(get_current_user),
):
    query = db.query(MessBill)
    if member_id:
        query = query.filter(MessBill.member_id == member_id)
    if month:
        query = query.filter(MessBill.month == month)
    if year:
        query = query.filter(MessBill.year == year)
    if status:
        query = query.filter(MessBill.status == status)

    total = query.count()
    bills = query.order_by(MessBill.year.desc(), MessBill.month.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {"items": [
        {"id": b.id, "member_id": b.member_id, "member_name": b.member.full_name if b.member else None,
         # Member "type" fields - joined in here (rather than a separate members
         # lookup) so a bill card can show who it's for without a second fetch.
         "member_rank": b.member.rank if b.member else None,
         "member_service_number": b.member.service_number if b.member else None,
         "member_mess_category": b.member.mess_category.value if b.member else None,
         "member_is_womens_bloc": bool(b.member.is_womens_bloc) if b.member else False,
         "month": b.month, "year": b.year, "man_days": b.man_days, "per_head_rate": float(b.per_head_rate),
         "base_menu_amount": float(b.base_menu_amount), "stay_amount": float(b.stay_amount or 0),
         "extra_meals_amount": float(b.extra_meals_amount or 0), "ala_carte_amount": float(b.ala_carte_amount or 0),
         "applied_discount_rate": float(b.applied_discount_rate or 0),
         "discount_amount": float(b.discount_amount or 0), "discount_reason": b.discount_reason,
         "total_amount": float(b.total_amount), "status": b.status.value, "generated_at": b.generated_at} for b in bills], "total": total}


def _invoice_qr_svg(payload: str) -> str:
    """Locally generated QR (reportlab - no internet, nothing leaves the
    LAN), returned as an inline-able SVG string. Duplicated from
    billing.py's helper of the same name rather than imported - both are
    small, self-contained, and this keeps the guest-billing and mess-billing
    domains decoupled."""
    from reportlab.graphics.barcode.qr import QrCodeWidget
    from reportlab.graphics.shapes import Drawing
    from reportlab.graphics import renderSVG
    qr = QrCodeWidget(payload)
    x0, y0, x1, y1 = qr.getBounds()
    size = 200.0
    drawing = Drawing(size, size, transform=[size / (x1 - x0), 0, 0, size / (y1 - y0), 0, 0])
    drawing.add(qr)
    svg = renderSVG.drawToString(drawing)
    return svg[svg.find("<svg"):]


def _mess_identity(db: Session) -> dict:
    return {
        "name": get_setting_str(db, "mess_name", "EME Officers Mess"),
        "address": get_setting_str(db, "mess_address", "204 Firdousi Road, Rawalpindi"),
        "phone": get_setting_str(db, "mess_phone", "Tele No. G.H.Q 31725"),
    }


@router.get("/room-lease-dispatch")
async def room_lease_dispatch(month: int = Query(..., ge=1, le=12), year: int = Query(...), db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Pipeline A (Month-End Split): aggregate org-facing document combining
    every member's room/HRA charge (MessBill.stay_amount) for a period into
    one dispatch, split into regular-HRA vs Women's Bloc subtotals. Purely a
    read/presentation view over already-generated MessBill rows - changes
    nothing about how the underlying bills were computed or are owed."""
    bills = db.query(MessBill).filter(MessBill.month == month, MessBill.year == year).order_by(MessBill.member_id).all()
    if not bills:
        raise HTTPException(status_code=404, detail="No mess bills generated yet for this period")

    members, hra_subtotal, womens_bloc_subtotal = [], 0.0, 0.0
    for b in bills:
        stay = float(b.stay_amount or 0)
        if stay == 0:
            continue
        member = b.member
        is_wb = bool(member.is_womens_bloc) if member else False
        members.append({
            "member_name": member.full_name if member else None,
            "service_number": member.service_number if member else None,
            "is_womens_bloc": is_wb, "stay_amount": stay,
        })
        if is_wb:
            womens_bloc_subtotal += stay
        else:
            hra_subtotal += stay
    total = hra_subtotal + womens_bloc_subtotal

    mess = _mess_identity(db)
    period_label = date(year, month, 1).strftime("%B %Y")
    verify_hash = hashlib.sha256(f"{month}-{year}|{total:.2f}".encode()).hexdigest()[:12].upper()

    return {
        "period": {"month": month, "year": year, "label": period_label},
        "members": members,
        "hra_subtotal": hra_subtotal, "womens_bloc_subtotal": womens_bloc_subtotal, "total": total,
        "mess": mess,
        "verify_hash": verify_hash,
        "qr_svg": _invoice_qr_svg(f"{mess['name']}\nRoom-Lease Dispatch: {period_label}\nTotal: Rs {total:,.0f}\nVerify: {verify_hash}"),
    }


@router.get("/bills/{bill_id}/diet-invoice")
async def diet_invoice(bill_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Pipeline B (Month-End Split): per-member printable dining-only
    breakdown of one MessBill - excludes the room/HRA (stay_amount) side
    entirely, since that's dispatched separately via room-lease-dispatch."""
    bill = db.query(MessBill).filter(MessBill.id == bill_id).first()
    if not bill:
        raise HTTPException(status_code=404, detail="Bill not found")
    member = bill.member

    dining_total = (float(bill.base_menu_amount or 0) - float(bill.discount_amount or 0)
                    + float(bill.extra_meals_amount or 0) + float(bill.ala_carte_amount or 0))

    mess = _mess_identity(db)
    period_label = date(bill.year, bill.month, 1).strftime("%B %Y")
    verify_hash = hashlib.sha256(f"{bill.id}|{dining_total:.2f}".encode()).hexdigest()[:12].upper()

    return {
        "bill_id": bill.id,
        "member": {"full_name": member.full_name if member else None, "service_number": member.service_number if member else None},
        "period": {"month": bill.month, "year": bill.year, "label": period_label},
        "man_days": bill.man_days, "per_head_rate": float(bill.per_head_rate),
        "base_menu_amount": float(bill.base_menu_amount), "extra_meals_amount": float(bill.extra_meals_amount or 0),
        "ala_carte_amount": float(bill.ala_carte_amount or 0), "discount_amount": float(bill.discount_amount or 0),
        "dining_total": dining_total, "status": bill.status.value,
        "mess": mess,
        "verify_hash": verify_hash,
        "qr_svg": _invoice_qr_svg(f"{mess['name']}\nDiet Invoice: {period_label}\nMember: {member.full_name if member else ''}\nTotal: Rs {dining_total:,.0f}\nVerify: {verify_hash}"),
    }


def _hra_charge_and_renew(db: Session, member: Member, period_start: date, period_end: date) -> float:
    """HRA residents are billed fresh each period from the current rank +
    room-class rate (not a stored booking total, so a rank correction or
    rate revision is reflected immediately). As a side effect, renews an
    ongoing booking's rolling checkout window if it's due soon - see the
    "indefinite residency" note in bookings.create_booking.

    Also covers a residency that ENDED during this period (checked_out via
    end-residency, check_out truncated to the departure date) so the final
    month is still billed rather than silently dropped."""
    booking = db.query(Booking).filter(
        Booking.member_id == member.id, Booking.nature_of_duty == "hra",
        Booking.check_in <= period_end,
        (
            (Booking.status == "checked_in") |
            ((Booking.status == "checked_out") & (Booking.check_out >= period_start))
        ),
    ).order_by(Booking.check_in.desc()).first()
    if not booking:
        return 0.0

    room = db.query(Room).filter(Room.id == booking.room_id).first()
    room_type = getattr(room.room_type, "value", room.room_type) if room else None
    hra_rate = get_womens_bloc_rank_rate(db, member.rank) if member.is_womens_bloc else get_hra_rank_rate(db, member.rank)
    utility_rate = get_hra_utility_rate(db, room_type, (room.ac_count if room else 1) or 1) if room_type else None
    amount = (hra_rate[1] + utility_rate) if (hra_rate and utility_rate is not None) else 0.0

    # Women's Bloc rates are seeded at Rs 0 until an admin fills them in -
    # don't let that silently bill a real resident's stay as free.
    if member.is_womens_bloc and hra_rate and hra_rate[1] == 0:
        logger.warning(f"Women's Bloc rate not yet set for rank band '{hra_rate[0]}' - "
                        f"billing member #{member.id} ({member.full_name}) Rs 0 for HRA this period")
        existing = db.query(Alert).filter(
            Alert.entity_type == "member", Alert.entity_id == member.id,
            Alert.status.in_([AlertStatus.NEW, AlertStatus.ACKNOWLEDGED]),
            Alert.module == "mess_billing",
            Alert.title.contains("Women's Bloc rate not set"),
        ).first()
        if not existing:
            create_alert(
                db, f"Women's Bloc rate not set: {member.full_name}",
                f"Rank band '{hra_rate[0]}' has no Women's Bloc rate configured yet - this member's HRA charge was billed as Rs 0 for {period_start.strftime('%b %Y')}. Set the rate under Members > Manage Women's Bloc Rates.",
                AlertSeverity.LOW, "mess_billing", "member", member.id,
            )

    if booking.status.value == "checked_in" and booking.check_out <= period_end + timedelta(days=60):
        booking.check_out += timedelta(days=365)

    return amount


@router.post("/generate")
async def generate_bills(month: int = Query(..., ge=1, le=12), year: int = Query(...), request: Request = None, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "mess_billing", "create"):
        raise HTTPException(status_code=403, detail="Permission denied")

    period_start = date(year, month, 1)
    period_end = date(year, month, monthrange(year, month)[1])
    period_start_dt = datetime.combine(period_start, datetime.min.time())
    period_end_dt = datetime.combine(period_end, datetime.max.time())

    # Total expenditure: SUM of received POs touched in this period.
    # KNOWN APPROXIMATION: PurchaseOrder has no explicit received_at column,
    # so `updated_at` (touched by confirm_receipt) stands in for it.
    total_expenditure = db.query(PurchaseOrder).filter(
        PurchaseOrder.status == POStatus.RECEIVED,
        PurchaseOrder.updated_at >= period_start_dt,
        PurchaseOrder.updated_at <= period_end_dt,
    ).all()
    total_expenditure = float(sum(po.total_amount for po in total_expenditure))

    active_members = db.query(Member).filter(Member.status == MemberStatus.ACTIVE).all()
    total_man_days = sum(get_man_days(db, m.id, month, year) for m in active_members)
    if total_man_days == 0:
        raise HTTPException(status_code=400, detail="No attendance recorded for this period - cannot compute a per-head rate")

    per_head_rate = total_expenditure / total_man_days
    fixed_menu_price = get_setting_float(db, "member_fixed_menu_base_price", 0.0)
    default_discount_rate = get_setting_float(db, "default_member_discount_rate", 0.0)

    generated, skipped = [], []
    hra_billed_count = 0
    for member in active_members:
        existing = db.query(MessBill).filter(MessBill.member_id == member.id, MessBill.month == month, MessBill.year == year).first()
        if existing and existing.status in (MessBillStatus.ISSUED, MessBillStatus.PAID):
            skipped.append(member.id)
            continue

        man_days = get_man_days(db, member.id, month, year)
        base_menu_amount = fixed_menu_price if fixed_menu_price > 0 else man_days * per_head_rate
        # HRA bookings are excluded here and priced separately below - an HRA
        # booking's stored total_amount is only a creation-time snapshot, and
        # counting it here too would double-bill the resident's move-in month.
        member_bookings = db.query(Booking).filter(
            Booking.member_id == member.id, Booking.nature_of_duty != "hra",
            Booking.check_in >= period_start, Booking.check_in <= period_end,
        ).all()
        hra_amount = _hra_charge_and_renew(db, member, period_start, period_end)
        if hra_amount:
            hra_billed_count += 1
        stay_amount = float(sum(b.total_amount or 0 for b in member_bookings)) + hra_amount
        extra_meals_amount = float(sum(
            c.amount for c in db.query(GuestMealCharge).filter(
                GuestMealCharge.sponsor_member_id == member.id, GuestMealCharge.date >= period_start, GuestMealCharge.date <= period_end,
            ).all()
        ))
        # Member's own a la carte custom orders for the period, billed at cost
        # (food_cost, no markup - MenuPrice is the guest-facing list, not
        # member-facing) and not yet pulled into a bill.
        ala_carte_orders = db.query(KitchenOrder).filter(
            KitchenOrder.member_id == member.id, KitchenOrder.is_ala_carte == True,
            KitchenOrder.status == "served", KitchenOrder.invoiced_at.is_(None),
            KitchenOrder.created_at >= period_start_dt, KitchenOrder.created_at <= period_end_dt,
        ).all()
        ala_carte_amount = float(sum(o.food_cost or 0 for o in ala_carte_orders))
        discount_rate = float(member.custom_discount_rate) if member.custom_discount_rate and member.custom_discount_rate > 0 else default_discount_rate
        discount_amount = base_menu_amount * discount_rate / 100
        total_amount = base_menu_amount - discount_amount + stay_amount + extra_meals_amount + ala_carte_amount

        if existing:
            bill = existing
        else:
            bill = MessBill(member_id=member.id, month=month, year=year)
            db.add(bill)

        bill.man_days = man_days
        bill.per_head_rate = per_head_rate
        bill.base_menu_amount = base_menu_amount
        bill.stay_amount = stay_amount
        bill.extra_meals_amount = extra_meals_amount
        bill.ala_carte_amount = ala_carte_amount
        bill.applied_discount_rate = discount_rate
        bill.discount_amount = discount_amount
        bill.total_amount = total_amount
        bill.generated_at = datetime.utcnow()
        bill.generated_by = current_user.id
        for o in ala_carte_orders:
            o.invoiced_at = datetime.utcnow()
        db.commit()
        db.refresh(bill)
        generated.append(bill.id)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.CREATE, "mess_bills", None,
              after_state={"month": month, "year": year, "generated": len(generated), "skipped_finalized": len(skipped),
                           "total_expenditure": total_expenditure, "total_man_days": total_man_days, "hra_residents_billed": hra_billed_count},
              ip_address=request.client.host if request else None)
    return {"generated": generated, "skipped_finalized": skipped, "per_head_rate": per_head_rate}


@router.post("/issue-all")
async def issue_all_bills(month: int = Query(..., ge=1, le=12), year: int = Query(...), request: Request = None, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Issue every draft bill for a period in one action, instead of clicking
    each one. Non-draft bills are left untouched."""
    if not check_permission(current_user, "mess_billing", "approve"):
        raise HTTPException(status_code=403, detail="Permission denied")

    drafts = db.query(MessBill).filter(
        MessBill.month == month, MessBill.year == year, MessBill.status == MessBillStatus.DRAFT,
    ).all()
    issued = []
    for bill in drafts:
        bill.status = MessBillStatus.ISSUED
        issued.append(bill.id)
    db.commit()

    log_audit(db, current_user.id, current_user.full_name, AuditAction.APPROVE, "mess_bills", None,
              after_state={"month": month, "year": year, "issued": len(issued)},
              ip_address=request.client.host if request else None)
    return {"issued": issued}


@router.post("/bills/{bill_id}/issue")
async def issue_bill(bill_id: int, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "mess_billing", "approve"):
        raise HTTPException(status_code=403, detail="Permission denied")
    bill = db.query(MessBill).filter(MessBill.id == bill_id).first()
    if not bill:
        raise HTTPException(status_code=404, detail="Bill not found")
    if bill.status != MessBillStatus.DRAFT:
        raise HTTPException(status_code=400, detail="Only a draft bill can be issued")

    before = serialize_model(bill)
    bill.status = MessBillStatus.ISSUED
    db.commit()
    db.refresh(bill)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.APPROVE, "mess_bills", bill.id, before_state=before, after_state=serialize_model(bill), ip_address=request.client.host)
    return bill


@router.post("/bills/{bill_id}/mark-paid")
async def mark_bill_paid(bill_id: int, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "mess_billing", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    bill = db.query(MessBill).filter(MessBill.id == bill_id).first()
    if not bill:
        raise HTTPException(status_code=404, detail="Bill not found")
    if bill.status != MessBillStatus.ISSUED:
        raise HTTPException(status_code=400, detail="Only an issued bill can be marked paid")

    before = serialize_model(bill)
    bill.status = MessBillStatus.PAID
    db.commit()
    db.refresh(bill)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "mess_bills", bill.id, before_state=before, after_state=serialize_model(bill), ip_address=request.client.host)
    return bill


@router.post("/bills/{bill_id}/apply-discount")
async def apply_discount(bill_id: int, data: DiscountApplyRequest, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    # Authorization is derived entirely from the authenticated session - never
    # from client-supplied input. There is no "authorization id" field anywhere
    # in this request; a client-supplied id would be trivially spoofable.
    if not check_permission(current_user, "mess_billing", "approve"):
        raise HTTPException(status_code=403, detail="Permission denied")
    bill = db.query(MessBill).filter(MessBill.id == bill_id).first()
    if not bill:
        raise HTTPException(status_code=404, detail="Bill not found")
    if bill.status == MessBillStatus.PAID:
        raise HTTPException(status_code=400, detail="Cannot discount a paid bill")

    before = serialize_model(bill)
    pre_discount_menu = float(bill.base_menu_amount)
    if data.discount_rate is not None:
        bill.applied_discount_rate = data.discount_rate
        bill.discount_amount = pre_discount_menu * data.discount_rate / 100
    else:
        bill.discount_amount = data.discount_amount
        bill.applied_discount_rate = (data.discount_amount / pre_discount_menu * 100) if pre_discount_menu else 0

    bill.discount_approved_by = current_user.id
    bill.discount_reason = data.reason
    # Mirror the total formula in generate_bills exactly - every additive
    # component must be here, or applying a discount silently erases it. The a
    # la carte charges in particular were being dropped from the recomputed total.
    bill.total_amount = (
        pre_discount_menu
        - float(bill.discount_amount)
        + float(bill.stay_amount or 0)
        + float(bill.extra_meals_amount or 0)
        + float(bill.ala_carte_amount or 0)
    )
    db.commit()
    db.refresh(bill)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.OVERRIDE, "mess_bills", bill.id, before_state=before, after_state=serialize_model(bill), reason=data.reason, ip_address=request.client.host)
    return bill


# --- Guest meal charges ---

@router.get("/guest-charges")
async def list_guest_charges(sponsor_member_id: int = 0, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    query = db.query(GuestMealCharge)
    if sponsor_member_id:
        query = query.filter(GuestMealCharge.sponsor_member_id == sponsor_member_id)
    charges = query.order_by(GuestMealCharge.date.desc()).all()
    return [{"id": c.id, "sponsor_member_id": c.sponsor_member_id, "guest_name": c.guest_name,
             "date": c.date, "meal_type": c.meal_type.value, "amount": float(c.amount), "notes": c.notes} for c in charges]


@router.post("/guest-charges")
async def create_guest_charge(data: GuestMealChargeCreate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "mess_billing", "create"):
        raise HTTPException(status_code=403, detail="Permission denied")
    if not db.query(Member).filter(Member.id == data.sponsor_member_id).first():
        raise HTTPException(status_code=404, detail="Sponsor member not found")

    charge = GuestMealCharge(**data.model_dump(), created_by=current_user.id)
    db.add(charge)
    db.commit()
    db.refresh(charge)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.CREATE, "guest_meal_charges", charge.id, after_state=serialize_model(charge), ip_address=request.client.host)
    return charge
