"""Communal per-head mess billing for permanent members."""
import hashlib
from datetime import datetime, date, timedelta
from calendar import monthrange
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from backend.database import get_db
from sqlalchemy import func
from backend.models import (
    Member, MemberStatus, DiningStatus, MessBill, MessBillStatus, GuestMealCharge,
    MessBillCharge, MessBillPayment, GasChargeRate,
    StockBatch, Booking, KitchenOrder, Room, Alert, AlertStatus, AlertSeverity,
)
from backend.schemas import (
    GuestMealChargeCreate, DiscountApplyRequest,
    MessBillChargeCreate, MessBillChargeCorrection, MessBillFieldCorrection,
    MessBillPaymentCreate, LastDebitBalanceUpdate,
)
from backend.auth import get_current_user, check_permission, PermissionChecker
from backend.audit import log_audit, serialize_model, AuditAction
from backend.logging_config import get_logger
from backend.alerts import create_alert
from backend.services.mess_billing_calc import get_man_days, get_setting_float, get_setting_str
from backend.services.mess_charge_calc import get_member_gas_total
from backend.services.room_pricing import get_hra_rank_rate, get_hra_utility_rate, get_womens_bloc_rank_rate
from backend.services.master_bill import assemble_rows, MASTER_BILL_PRESET_HEADS


def _gas_percentage(db: Session) -> float:
    # Duplicated from billing.py's helper of the same name - both are tiny
    # and this keeps the guest-billing and mess-billing domains decoupled,
    # matching _invoice_qr_svg's existing duplication below.
    row = db.query(GasChargeRate).first()
    return float(row.percentage) if row else 0.0


PAYMENT_METHOD_ONLINE = "Online/AG Branch"
PAYMENT_METHOD_BANK = "Bank Transfer"
PAYMENT_METHOD_CASH = "Cash Deposit"


def _build_payment_breakdown(payments: list) -> dict:
    # Mirrors billing.py's helper of the same name/shape - kept duplicated
    # rather than shared so the guest-billing and mess-billing domains stay
    # decoupled (matches this file's existing _gas_percentage duplication).
    by_method = {PAYMENT_METHOD_ONLINE: 0.0, PAYMENT_METHOD_BANK: 0.0, PAYMENT_METHOD_CASH: 0.0, "other": 0.0}
    vouchers = []
    for p in payments:
        amount = float(p.amount)
        if p.method in by_method:
            by_method[p.method] += amount
        else:
            by_method["other"] += amount
        if p.voucher_number:
            vouchers.append(p.voucher_number)
    total_paid = sum(by_method.values())
    return {
        "online_ag_branch": round(by_method[PAYMENT_METHOD_ONLINE], 2),
        "online_ag_branch_vouchers": vouchers,
        "bank_transfer": round(by_method[PAYMENT_METHOD_BANK], 2),
        "cash_deposit": round(by_method[PAYMENT_METHOD_CASH], 2),
        "other": round(by_method["other"], 2),
        "total_paid": round(total_paid, 2),
        "payments": [{"id": p.id, "amount": float(p.amount), "method": p.method, "voucher_number": p.voucher_number,
                      "notes": p.notes, "created_at": p.created_at} for p in payments],
    }


def _prior_outstanding_for_member(db: Session, member_id: int) -> float:
    """Sum of everything still owed across every prior MessBill for this
    member (a previous month left unpaid/partially paid) - auto-fills a
    brand-new bill's Last Debit Balance; the Clerk can still edit it via
    set_mess_bill_last_debit_balance."""
    prior = db.query(MessBill).filter(MessBill.member_id == member_id).all()
    total = 0.0
    for bill in prior:
        payable = float(bill.total_amount or 0) + float(bill.last_debit_balance or 0)
        owed = payable - float(bill.amount_paid or 0)
        if owed > 0:
            total += owed
    return round(total, 2)

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
         "member_dining_status": (b.member.dining_status.value if b.member and b.member.dining_status else "dining"),
         "month": b.month, "year": b.year, "man_days": b.man_days, "per_head_rate": float(b.per_head_rate),
         "base_menu_amount": float(b.base_menu_amount), "stay_amount": float(b.stay_amount or 0),
         "extra_meals_amount": float(b.extra_meals_amount or 0), "ala_carte_amount": float(b.ala_carte_amount or 0),
         "gas_amount": float(b.gas_amount or 0),
         "applied_discount_rate": float(b.applied_discount_rate or 0),
         "discount_amount": float(b.discount_amount or 0), "discount_reason": b.discount_reason,
         "total_amount": float(b.total_amount), "amount_paid": float(b.amount_paid or 0),
         "last_debit_balance": float(b.last_debit_balance or 0),
         "status": b.status.value, "generated_at": b.generated_at} for b in bills], "total": total}


@router.get("/bills/outstanding-summary")
async def outstanding_bills_summary(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Draft/issued mess-bill counts and the issued total, computed
    server-side via GROUP BY - the Clerk dashboard's Outstanding figure
    previously summed a page_size=100 fetch of list_bills() client-side and
    silently under-reported once bills-not-yet-paid crossed 100 rows."""
    rows = db.query(
        MessBill.status, func.count(MessBill.id), func.coalesce(func.sum(MessBill.total_amount), 0),
    ).group_by(MessBill.status).all()
    out = {"draft_count": 0, "issued_count": 0, "issued_total": 0.0}
    for status_, count, total in rows:
        if status_ == MessBillStatus.DRAFT:
            out["draft_count"] = count
        elif status_ == MessBillStatus.ISSUED:
            out["issued_count"] = count
            out["issued_total"] = float(total)
    return out


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
                    + float(bill.extra_meals_amount or 0) + float(bill.ala_carte_amount or 0) + float(bill.gas_amount or 0))

    mess = _mess_identity(db)
    period_label = date(bill.year, bill.month, 1).strftime("%B %Y")
    verify_hash = hashlib.sha256(f"{bill.id}|{dining_total:.2f}".encode()).hexdigest()[:12].upper()

    return {
        "bill_id": bill.id,
        "member": {"full_name": member.full_name if member else None, "service_number": member.service_number if member else None},
        "period": {"month": bill.month, "year": bill.year, "label": period_label},
        "man_days": bill.man_days, "per_head_rate": float(bill.per_head_rate),
        "base_menu_amount": float(bill.base_menu_amount), "extra_meals_amount": float(bill.extra_meals_amount or 0),
        "ala_carte_amount": float(bill.ala_carte_amount or 0), "gas_amount": float(bill.gas_amount or 0),
        "discount_amount": float(bill.discount_amount or 0),
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
        # Out-of-Mess HRA residents never have a room Booking at all - bill
        # them the rank rate + the flat out-of-mess utility charge instead of
        # falling through to Rs 0. No booking to renew, unlike the in-mess
        # branch below.
        if member.is_hra and member.hra_stay_type == "out_of_mess":
            hra_rate = get_womens_bloc_rank_rate(db, member.rank) if member.is_womens_bloc else get_hra_rank_rate(db, member.rank)
            utility_rate = get_hra_utility_rate(db, "out_of_mess")
            return (hra_rate[1] + utility_rate) if (hra_rate and utility_rate is not None) else 0.0
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

    # Total expenditure: self-purchase stock spend (Daily Stock Intake /
    # Smart Intake batches) logged in this period - the mess buys its own
    # ingredients directly, so every StockBatch is committed spend.
    total_expenditure = float(db.query(func.sum(StockBatch.quantity * StockBatch.unit_cost)).filter(
        StockBatch.created_at >= period_start_dt, StockBatch.created_at <= period_end_dt,
    ).scalar() or 0)

    # Non-dining members are excluded entirely - not just skipped from
    # billing but from the man-day pool that sets the per-head rate, so a
    # member marked non-dining (e.g. away, or an HRA resident who isn't
    # actually eating there) doesn't distort the mess-wide rate either.
    active_members = db.query(Member).filter(
        Member.status == MemberStatus.ACTIVE, Member.dining_status != DiningStatus.NON_DINING,
    ).all()
    skipped_non_dining = [
        m.id for m in db.query(Member).filter(
            Member.status == MemberStatus.ACTIVE, Member.dining_status == DiningStatus.NON_DINING,
        ).all()
    ]
    total_man_days = sum(get_man_days(db, m.id, month, year) for m in active_members)
    if total_man_days == 0:
        raise HTTPException(status_code=400, detail="No attendance recorded for this period - cannot compute a per-head rate")

    per_head_rate = total_expenditure / total_man_days
    fixed_menu_price = get_setting_float(db, "member_fixed_menu_base_price", 0.0)
    default_discount_rate = get_setting_float(db, "default_member_discount_rate", 0.0)
    fallback_gas_percentage = _gas_percentage(db)

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
        # Member's own a la carte custom orders for the period, billed at
        # MenuItem.price - same rate guests pay - and not yet pulled into a bill.
        ala_carte_orders = db.query(KitchenOrder).filter(
            KitchenOrder.member_id == member.id, KitchenOrder.is_ala_carte == True,
            KitchenOrder.status == "served", KitchenOrder.invoiced_at.is_(None),
            KitchenOrder.created_at >= period_start_dt, KitchenOrder.created_at <= period_end_dt,
        ).all()
        ala_carte_amount = float(sum((o.menu_item.price if o.menu_item else 0) * o.quantity_ordered for o in ala_carte_orders))
        gas_amount = get_member_gas_total(db, member.id, month, year, fallback_percentage=fallback_gas_percentage)
        discount_rate = float(member.custom_discount_rate) if member.custom_discount_rate and member.custom_discount_rate > 0 else default_discount_rate
        discount_amount = base_menu_amount * discount_rate / 100
        total_amount = base_menu_amount - discount_amount + stay_amount + extra_meals_amount + ala_carte_amount + gas_amount

        if existing:
            bill = existing
        else:
            bill = MessBill(member_id=member.id, month=month, year=year,
                             last_debit_balance=_prior_outstanding_for_member(db, member.id))
            db.add(bill)

        bill.man_days = man_days
        bill.per_head_rate = per_head_rate
        bill.base_menu_amount = base_menu_amount
        bill.stay_amount = stay_amount
        bill.extra_meals_amount = extra_meals_amount
        bill.ala_carte_amount = ala_carte_amount
        bill.gas_amount = gas_amount
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
                           "skipped_non_dining": len(skipped_non_dining),
                           "total_expenditure": total_expenditure, "total_man_days": total_man_days, "hra_residents_billed": hra_billed_count},
              ip_address=request.client.host if request else None)
    return {"generated": generated, "skipped_finalized": skipped, "skipped_non_dining": skipped_non_dining, "per_head_rate": per_head_rate}


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
        + float(bill.gas_amount or 0)
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


# --- Ad-hoc charges (member-side "Other Charges" - Masjid, Library, Sweeper...) ---

@router.get("/bills/{bill_id}/charges")
async def list_mess_bill_charges(bill_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    charges = db.query(MessBillCharge).filter(MessBillCharge.mess_bill_id == bill_id).order_by(MessBillCharge.created_at.desc()).all()
    return [{"id": c.id, "head": c.head, "amount": float(c.amount), "reason": c.reason, "created_at": c.created_at} for c in charges]


@router.post("/bills/{bill_id}/charges")
async def add_mess_bill_charge(bill_id: int, data: MessBillChargeCreate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "mess_billing", "create"):
        raise HTTPException(status_code=403, detail="Permission denied")
    bill = db.query(MessBill).filter(MessBill.id == bill_id).first()
    if not bill:
        raise HTTPException(status_code=404, detail="Bill not found")
    if bill.bill_made_at is not None:
        raise HTTPException(status_code=400, detail="This bill has been made - further changes require reopening it")

    charge = MessBillCharge(mess_bill_id=bill_id, head=data.head.strip(), amount=data.amount, reason=data.reason.strip(), created_by=current_user.id)
    db.add(charge)
    db.commit()
    db.refresh(charge)
    log_audit(db, current_user.id, current_user.full_name, AuditAction.CREATE, "mess_bill_charges", charge.id, after_state=serialize_model(charge), reason=charge.reason, ip_address=request.client.host)
    return {"id": charge.id, "head": charge.head, "amount": float(charge.amount), "reason": charge.reason}


@router.delete("/charges/{charge_id}")
async def delete_mess_bill_charge(charge_id: int, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "mess_billing", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    charge = db.query(MessBillCharge).filter(MessBillCharge.id == charge_id).first()
    if not charge:
        raise HTTPException(status_code=404, detail="Charge not found")
    if charge.mess_bill.bill_made_at is not None:
        raise HTTPException(status_code=400, detail="This bill has been made - charges can no longer be removed here")
    before = serialize_model(charge)
    db.delete(charge)
    db.commit()
    log_audit(db, current_user.id, current_user.full_name, AuditAction.SOFT_DELETE, "mess_bill_charges", charge_id, before_state=before, reason="Charge removed before Make Bill", ip_address=request.client.host)
    return {"message": "Charge removed"}


@router.put("/charges/{charge_id}/correct")
async def correct_mess_bill_charge(charge_id: int, data: MessBillChargeCorrection, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Inline correction of an ad-hoc MessBillCharge row in the pre-lock
    Interactive Master Bill Table - mirrors billing.py's
    correct_master_bill_line; see that endpoint's docstring for why this
    isn't approval-gated the way a post-lock InvoiceEditRequest is."""
    if not check_permission(current_user, "mess_billing", "create"):
        raise HTTPException(status_code=403, detail="Permission denied")
    charge = db.query(MessBillCharge).filter(MessBillCharge.id == charge_id).first()
    if not charge:
        raise HTTPException(status_code=404, detail="Charge not found")
    bill = charge.mess_bill
    if bill.bill_made_at is not None:
        raise HTTPException(status_code=400, detail="This bill has been made - further changes require reopening it")

    old_amount = float(charge.amount)
    before = serialize_model(charge)
    charge.amount = data.new_amount
    bill.total_amount = float(bill.total_amount) + (data.new_amount - old_amount)
    db.commit()
    db.refresh(charge)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "mess_bill_charges", charge.id,
              before_state=before, after_state=serialize_model(charge), reason=data.correction_reason, ip_address=request.client.host)
    create_alert(
        db,
        title=f"Bill correction: {charge.head}",
        message=(f"{current_user.full_name} corrected '{charge.head}' on {bill.member.full_name if bill.member else 'member'}'s "
                  f"mess bill from Rs {old_amount:,.2f} to Rs {data.new_amount:,.2f}. Reason: {data.correction_reason}"),
        severity=AlertSeverity.MEDIUM, module="mess_billing", entity_type="mess_bill", entity_id=bill.id,
        detail={"charge_id": charge.id, "head": charge.head, "original_amount": old_amount,
                "corrected_amount": data.new_amount, "reason": data.correction_reason, "corrected_by": current_user.full_name},
    )
    return {"id": charge.id, "head": charge.head, "amount": float(charge.amount)}


@router.put("/bills/{bill_id}/correct-field")
async def correct_mess_bill_field(bill_id: int, data: MessBillFieldCorrection, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Inline correction of "Messing attendance" (base_menu_amount), "Guest
    Room Charges" (stay_amount), or "Sui Gas Charges on Messing" (gas_amount) -
    the three Master Bill rows for a member's bill that map to a single
    directly-stored column. "Extra Messing" is still a composite/computed
    figure with no single column to correct, so it's intentionally not
    offered here."""
    if not check_permission(current_user, "mess_billing", "create"):
        raise HTTPException(status_code=403, detail="Permission denied")
    bill = db.query(MessBill).filter(MessBill.id == bill_id).first()
    if not bill:
        raise HTTPException(status_code=404, detail="Bill not found")
    if bill.bill_made_at is not None:
        raise HTTPException(status_code=400, detail="This bill has been made - further changes require reopening it")

    field_labels = {"base_menu_amount": "Messing attendance", "stay_amount": "Guest Room Charges", "gas_amount": "Sui Gas Charges on Messing"}
    label = field_labels[data.field]
    old_amount = float(getattr(bill, data.field) or 0)
    before = serialize_model(bill)
    setattr(bill, data.field, data.new_amount)
    bill.total_amount = float(bill.total_amount) + (data.new_amount - old_amount)
    db.commit()
    db.refresh(bill)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "mess_bills", bill.id,
              before_state=before, after_state=serialize_model(bill), reason=data.correction_reason, ip_address=request.client.host)
    create_alert(
        db,
        title=f"Bill correction: {label}",
        message=(f"{current_user.full_name} corrected '{label}' on {bill.member.full_name if bill.member else 'member'}'s "
                  f"mess bill from Rs {old_amount:,.2f} to Rs {data.new_amount:,.2f}. Reason: {data.correction_reason}"),
        severity=AlertSeverity.MEDIUM, module="mess_billing", entity_type="mess_bill", entity_id=bill.id,
        detail={"field": data.field, "label": label, "original_amount": old_amount,
                "corrected_amount": data.new_amount, "reason": data.correction_reason, "corrected_by": current_user.full_name},
    )
    return {"field": data.field, "amount": float(getattr(bill, data.field))}


# --- Universal Master Bill (services/master_bill.py) ---

@router.put("/bills/{bill_id}/last-debit-balance")
async def set_mess_bill_last_debit_balance(bill_id: int, data: LastDebitBalanceUpdate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "mess_billing", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    bill = db.query(MessBill).filter(MessBill.id == bill_id).first()
    if not bill:
        raise HTTPException(status_code=404, detail="Bill not found")
    if bill.bill_made_at is not None:
        raise HTTPException(status_code=400, detail="This bill has been made - the carried-over balance can no longer be changed here")
    before = serialize_model(bill)
    bill.last_debit_balance = data.last_debit_balance
    db.commit()
    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "mess_bills", bill.id, before_state=before, after_state=serialize_model(bill), ip_address=request.client.host)
    return {"last_debit_balance": float(bill.last_debit_balance)}


@router.put("/bills/{bill_id}/serial-number")
async def set_mess_bill_serial_number(bill_id: int, bill_serial_number: str | None = None, request: Request = None, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "mess_billing", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    bill = db.query(MessBill).filter(MessBill.id == bill_id).first()
    if not bill:
        raise HTTPException(status_code=404, detail="Bill not found")
    if bill.bill_made_at is not None:
        raise HTTPException(status_code=400, detail="This bill has been made - the serial number can no longer be changed here")
    before = serialize_model(bill)
    bill.bill_serial_number = (bill_serial_number or "").strip() or None
    db.commit()
    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "mess_bills", bill.id, before_state=before, after_state=serialize_model(bill), ip_address=request.client.host if request else None)
    return {"bill_serial_number": bill.bill_serial_number}


@router.post("/bills/{bill_id}/make-bill")
async def make_mess_bill(bill_id: int, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "mess_billing", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    bill = db.query(MessBill).filter(MessBill.id == bill_id).first()
    if not bill:
        raise HTTPException(status_code=404, detail="Bill not found")
    if bill.bill_made_at is None:
        bill.bill_made_at = datetime.utcnow()
        db.commit()
        log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "mess_bills", bill.id, after_state={"bill_made_at": bill.bill_made_at.isoformat()}, ip_address=request.client.host)
    return {"bill_made_at": bill.bill_made_at}


@router.get("/bills/{bill_id}/master-bill")
async def get_mess_bill_master_bill(bill_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    bill = db.query(MessBill).filter(MessBill.id == bill_id).first()
    if not bill:
        raise HTTPException(status_code=404, detail="Bill not found")
    member = bill.member

    gas_base = float(bill.extra_meals_amount or 0) + float(bill.ala_carte_amount or 0)
    entries = [
        {"label": "Messing attendance", "amount": float(bill.base_menu_amount or 0),
         "reason": f"{bill.man_days} days @ Rs {float(bill.per_head_rate):.0f}/day"},
        {"label": "Extra Messing", "amount": gas_base},
        {"label": "Guest Room Charges", "amount": float(bill.stay_amount or 0)},
        {"label": "Sui Gas Charges on Messing", "amount": float(bill.gas_amount or 0)},
    ]
    charges = db.query(MessBillCharge).filter(MessBillCharge.mess_bill_id == bill_id).all()
    entries.extend({"label": c.head, "amount": float(c.amount), "reason": c.reason} for c in charges)

    assembled = assemble_rows(entries=entries, last_debit_balance=float(bill.last_debit_balance or 0), credits=float(bill.discount_amount or 0))

    # Pre-lock Interactive correction table targets - "Messing attendance"/
    # "Guest Room Charges"/"Sui Gas Charges on Messing" correct via
    # correct_mess_bill_field (a single stored column each); each ad-hoc
    # charge corrects via correct_mess_bill_charge. "Extra Messing" is still
    # composite/computed, so it's read-only here (source omitted).
    line_items = [
        {"source": "field", "field": "base_menu_amount", "label": "Messing attendance", "amount": float(bill.base_menu_amount or 0)},
        {"source": "field", "field": "stay_amount", "label": "Guest Room Charges", "amount": float(bill.stay_amount or 0)},
        {"source": "field", "field": "gas_amount", "label": "Sui Gas Charges on Messing", "amount": float(bill.gas_amount or 0)},
    ] + [{"source": "charge", "id": c.id, "label": c.head, "amount": float(c.amount), "reason": c.reason} for c in charges]

    payments = db.query(MessBillPayment).filter(MessBillPayment.mess_bill_id == bill.id).order_by(MessBillPayment.created_at).all()
    payment_breakdown = _build_payment_breakdown(payments)
    payment_breakdown["balance_due"] = round(assembled["net_debits"] - payment_breakdown["total_paid"], 2)

    period_label = date(bill.year, bill.month, 1).strftime("%B %Y")
    header = {
        "bill_for": period_label,
        "rank": member.rank if member else None,
        "name": member.full_name if member else None,
        "address_unit": member.unit if member else None,
        "date": bill.generated_at.date() if bill.generated_at else None,
    }
    return {
        "source": "mess_bill", "source_id": bill.id, "header": header, "mess": _mess_identity(db),
        "rows": assembled["rows"], "line_items": line_items, "last_debit_balance": float(bill.last_debit_balance or 0),
        "total_debit": assembled["total_debit"], "credits": assembled["credits"], "net_debits": assembled["net_debits"],
        "bill_serial_number": bill.bill_serial_number, "bill_made_at": bill.bill_made_at,
        "preset_heads": MASTER_BILL_PRESET_HEADS, "payment_breakdown": payment_breakdown,
        "status": bill.status.value,
    }


# --- Payments (MessBill had no payment/receipt concept before this) ---

@router.get("/bills/{bill_id}/payments")
async def list_mess_bill_payments(bill_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    payments = db.query(MessBillPayment).filter(MessBillPayment.mess_bill_id == bill_id).order_by(MessBillPayment.created_at.desc()).all()
    return [{"id": p.id, "amount": float(p.amount), "method": p.method, "voucher_number": p.voucher_number,
             "notes": p.notes, "created_at": p.created_at} for p in payments]


@router.post("/bills/{bill_id}/payments")
async def record_mess_bill_payment(bill_id: int, data: MessBillPaymentCreate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "mess_billing", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    bill = db.query(MessBill).filter(MessBill.id == bill_id).first()
    if not bill:
        raise HTTPException(status_code=404, detail="Bill not found")
    if bill.status == MessBillStatus.DRAFT:
        raise HTTPException(status_code=400, detail="Issue the bill before recording a payment")

    payment = MessBillPayment(mess_bill_id=bill_id, amount=data.amount, method=data.method,
                               voucher_number=data.voucher_number, notes=data.notes, received_by=current_user.id)
    db.add(payment)
    bill.amount_paid = float(bill.amount_paid or 0) + data.amount
    payable = float(bill.total_amount) + float(bill.last_debit_balance or 0)
    if bill.amount_paid >= payable - 0.01:
        bill.status = MessBillStatus.PAID
    elif bill.amount_paid > 0.01:
        bill.status = MessBillStatus.PARTIALLY_PAID
    db.commit()
    db.refresh(payment)
    log_audit(db, current_user.id, current_user.full_name, AuditAction.CREATE, "mess_bill_payments", payment.id, after_state=serialize_model(payment), ip_address=request.client.host)
    return {"id": payment.id, "amount": float(payment.amount), "bill_status": bill.status.value}


@router.get("/payments/{payment_id}/receipt-data")
async def mess_bill_payment_receipt_data(payment_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Same physical receipt format as billing.py's guest-payment receipt
    (mess_identity, dotted-field layout) - see PaymentReceiptView, which
    accepts kind='mess_bill' to call this instead of the invoice one."""
    if not (check_permission(current_user, "mess_billing", "view") or check_permission(current_user, "clerk_desk", "view")):
        raise HTTPException(status_code=403, detail="Permission denied")
    payment = db.query(MessBillPayment).filter(MessBillPayment.id == payment_id).first()
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    bill = payment.mess_bill
    member = bill.member if bill else None
    period_label = date(bill.year, bill.month, 1).strftime("%B %Y") if bill else ""

    mess = _mess_identity(db)
    verify_hash = hashlib.sha256(f"{payment.id}|{float(payment.amount):.2f}".encode()).hexdigest()[:12].upper()
    return {
        "receipt_no": payment.id, "date": payment.created_at.date(),
        "received_from": member.full_name if member else "-",
        "amount": float(payment.amount),
        "on_account_of": f"Mess Bill {period_label}" if bill else "Mess Bill",
        "method": payment.method or "Cash",
        "mess": mess,
        "qr_svg": _invoice_qr_svg(f"{mess['name']}\nReceipt No: {payment.id}\nReceived from: {member.full_name if member else ''}\nAmount: Rs {float(payment.amount):,.0f}\nVerify: {verify_hash}"),
    }
