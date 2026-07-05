"""Communal per-head mess billing for permanent members."""
from datetime import datetime, date
from calendar import monthrange
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.models import (
    Member, MemberStatus, MessBill, MessBillStatus, GuestMealCharge,
    PurchaseOrder, POStatus, Booking, KitchenOrder,
)
from backend.schemas import GuestMealChargeCreate, DiscountApplyRequest
from backend.auth import get_current_user, check_permission
from backend.audit import log_audit, serialize_model, AuditAction
from backend.logging_config import get_logger
from backend.services.mess_billing_calc import get_man_days, get_setting_float

logger = get_logger("app")
router = APIRouter()


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
         "month": b.month, "year": b.year, "man_days": b.man_days, "per_head_rate": float(b.per_head_rate),
         "base_menu_amount": float(b.base_menu_amount), "stay_amount": float(b.stay_amount or 0),
         "extra_meals_amount": float(b.extra_meals_amount or 0), "ala_carte_amount": float(b.ala_carte_amount or 0),
         "applied_discount_rate": float(b.applied_discount_rate or 0),
         "discount_amount": float(b.discount_amount or 0), "discount_reason": b.discount_reason,
         "total_amount": float(b.total_amount), "status": b.status.value, "generated_at": b.generated_at} for b in bills], "total": total}


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
    for member in active_members:
        existing = db.query(MessBill).filter(MessBill.member_id == member.id, MessBill.month == month, MessBill.year == year).first()
        if existing and existing.status in (MessBillStatus.ISSUED, MessBillStatus.PAID):
            skipped.append(member.id)
            continue

        man_days = get_man_days(db, member.id, month, year)
        base_menu_amount = fixed_menu_price if fixed_menu_price > 0 else man_days * per_head_rate
        member_bookings = db.query(Booking).filter(
            Booking.member_id == member.id, Booking.check_in >= period_start, Booking.check_in <= period_end,
        ).all()
        stay_amount = float(sum(b.total_amount or 0 for b in member_bookings))
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
              after_state={"month": month, "year": year, "generated": len(generated), "skipped_finalized": len(skipped), "total_expenditure": total_expenditure, "total_man_days": total_man_days},
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
    bill.total_amount = pre_discount_menu - float(bill.discount_amount) + float(bill.stay_amount or 0) + float(bill.extra_meals_amount or 0)
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
