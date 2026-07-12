"""Room pricing engine implementing the mess rate card.

Three billing modes, resolved in this order:
- nature_of_duty == "hra": monthly resident - a flat monthly figure (rank
  HRA + room-class utilities), not a nightly charge. Surfaced here as a
  quote/preview; the actual recurring charge is applied by
  mess_billing.generate_bills each period, not by this booking's total.
- nature_of_duty == "official_duty": daily-allowance rate by rank band,
  multiplied by the officer's DA entitlement (1 or 1.5).
- otherwise: the room-class x guest-category matrix, itemized into
  rent/electricity/generator/gas/internet components.

Rates live in the room_rates / duty_rates / hra_rank_rates / hra_utility_rates
tables so the mess can enter revisions; the DEFAULT_* dicts (transcribed
from the official card) are used as a fallback when no row exists yet.
"""
from datetime import date, timedelta
from sqlalchemy.orm import Session
from backend.models import RoomRate, DutyRate, HraRankRate, HraUtilityRate
from backend.services.mess_billing_calc import get_setting_float

RATE_COMPONENTS = ("rent", "electricity", "generator", "gas", "internet")

# room_type -> guest_category -> (rent, elec, gen, gas, internet)
# Transcribed from the "Guest Room Charges" rate card. DG Suite figures were
# partially legible on the source document and mirror the suite rates - edit
# via the rates API once the mess confirms them.
DEFAULT_ROOM_RATES = {
    "vip": {
        "serving_officer": (2500, 500, 300, 100, 100),
        "retired_officer": (3000, 500, 300, 100, 100),
        "civilian": (7000, 1000, 300, 100, 100),
    },
    "suite_1ac": {
        "serving_officer": (3000, 1000, 300, 100, 100),
        "retired_officer": (4500, 1000, 300, 100, 100),
        "civilian": (11500, 1500, 300, 100, 100),
    },
    "suite_2ac": {
        "serving_officer": (3000, 1000, 300, 100, 100),
        "retired_officer": (4500, 1000, 300, 100, 100),
        "civilian": (11500, 1500, 300, 100, 100),
    },
    "dg_suite": {
        "serving_officer": (3000, 1000, 300, 100, 100),
        "retired_officer": (4500, 1000, 300, 100, 100),
        "civilian": (11500, 1500, 300, 100, 100),
    },
}

# 1-DA guest room charge per rank band ("GRs Charges On Duty" tables).
DEFAULT_DUTY_RATES = {
    "maj_capt": ("Maj / Capt", 3840),
    "ltcol_brig": ("Lt Col - Brig", 4920),
    "maj_gen": ("Maj Gen", 6000),
    "ltgen_gen": ("Lt Gen - Gen", 7200),
}

# Monthly HRA rate per rank ("HRA Revised Rate - 2017"). Finer-grained than
# DEFAULT_DUTY_RATES - the HRA card prices Capt/Maj and Lt Col-Col/Brig
# separately instead of merging them into one band.
DEFAULT_HRA_RANK_RATES = {
    "capt": ("Capt", 8755),
    "maj": ("Maj", 12288),
    "ltcol_col": ("Lt Col / Col", 15325),
    "brig": ("Brig", 15758),
    "maj_gen": ("Maj Gen", 17469),
}

# Monthly flat utility charge for an HRA resident's room class.
DEFAULT_HRA_UTILITY_RATES = {
    "vip": 22500,
    "suite_1ac": 25500,
    "suite_2ac": 29500,
    "dg_suite": 29500,
}

# Ordered: longer/more specific rank names must match before their suffixes
# ("maj gen" before "maj", "lt gen" before "gen").
_RANK_BANDS = (
    ("maj gen", "maj_gen"),
    ("major general", "maj_gen"),
    ("lt gen", "ltgen_gen"),
    ("gen", "ltgen_gen"),
    ("brig", "ltcol_brig"),
    ("lt col", "ltcol_brig"),
    ("col", "ltcol_brig"),
    ("maj", "maj_capt"),
    ("capt", "maj_capt"),
    ("lt", "maj_capt"),
)

# HRA-specific bands: Capt and Maj are priced separately, and Lt Col/Col
# are merged (one HRA figure) but kept apart from Brig.
_HRA_RANK_BANDS = (
    ("maj gen", "maj_gen"),
    ("major general", "maj_gen"),
    ("brig", "brig"),
    ("lt col", "ltcol_col"),
    ("col", "ltcol_col"),
    ("maj", "maj"),
    ("capt", "capt"),
)


def rank_to_band(rank: str):
    if not rank:
        return None
    r = rank.strip().lower().replace(".", "")
    for prefix, band in _RANK_BANDS:
        if r.startswith(prefix):
            return band
    return None


def hra_rank_to_band(rank: str):
    if not rank:
        return None
    r = rank.strip().lower().replace(".", "")
    for prefix, band in _HRA_RANK_BANDS:
        if r.startswith(prefix):
            return band
    return None


def normalize_category(client_category: str) -> str:
    """Map legacy client categories onto the rate card's three columns."""
    value = getattr(client_category, "value", client_category) or ""
    if value in ("serving_officer", "retired_officer", "civilian"):
        return value
    if value == "non_member_civilian":
        return "civilian"
    # permanent members and non-civilian guests bill at serving-officer rates
    return "serving_officer"


def get_room_rate(db: Session, room_type: str, guest_category: str):
    """Itemized nightly components for a room class + category, or None."""
    row = db.query(RoomRate).filter(
        RoomRate.room_type == room_type, RoomRate.guest_category == guest_category
    ).first()
    if row:
        return {c: float(getattr(row, c) or 0) for c in RATE_COMPONENTS}
    defaults = DEFAULT_ROOM_RATES.get(room_type, {}).get(guest_category)
    if defaults:
        return dict(zip(RATE_COMPONENTS, (float(v) for v in defaults)))
    return None


def get_duty_rate(db: Session, rank: str):
    """(rank_band, 1-DA amount) for an officer's rank, or None."""
    band = rank_to_band(rank)
    if not band:
        return None
    row = db.query(DutyRate).filter(DutyRate.rank_band == band).first()
    if row:
        return band, float(row.da_amount)
    default = DEFAULT_DUTY_RATES.get(band)
    return (band, float(default[1])) if default else None


def get_hra_rank_rate(db: Session, rank: str):
    """(rank_band, monthly HRA amount) for a resident officer's rank, or None."""
    band = hra_rank_to_band(rank)
    if not band:
        return None
    row = db.query(HraRankRate).filter(HraRankRate.rank_band == band).first()
    if row:
        return band, float(row.monthly_amount)
    default = DEFAULT_HRA_RANK_RATES.get(band)
    return (band, float(default[1])) if default else None


def get_hra_utility_rate(db: Session, room_type: str):
    """Monthly flat utility charge for an HRA resident's room class, or None."""
    row = db.query(HraUtilityRate).filter(HraUtilityRate.room_type == room_type).first()
    if row:
        return float(row.monthly_amount)
    default = DEFAULT_HRA_UTILITY_RATES.get(room_type)
    return float(default) if default is not None else None


def reprice_for_departure(db: Session, booking, departure: date):
    """Re-price a guest booking over its ACTUAL stay span when the departure
    date differs from the booked check-out: an overstayed night is billed, an
    unused night is not (folio practice - the bill covers nights actually
    stayed). Same-day hours past the standard checkout time are the late-fee
    logic's job, not a re-price.

    Returns (effective_check_out, pricing) - pricing is None when no re-price
    applies (HRA residencies bill monthly; unchanged dates need no recompute).
    Used by perform_check_out (mutating) and by the running-balance preview
    (read-only) so the Clerk Desk total always equals the invoice."""
    if booking.nature_of_duty == "hra":
        return booking.check_out, None
    effective = max(departure, booking.check_in + timedelta(days=1))  # minimum 1-night stay
    if effective == booking.check_out:
        return effective, None
    pricing = compute_booking_price(
        db, booking.room, check_in=booking.check_in, check_out=effective,
        client_category=booking.client_category, nature_of_duty=booking.nature_of_duty,
        rank=booking.rank, da_multiplier=float(booking.da_multiplier) if booking.da_multiplier else None,
        mattress_count=booking.mattress_count or 0, member_id=booking.member_id,
    )
    return effective, pricing


def compute_booking_price(
    db: Session, room, *, check_in: date, check_out: date,
    client_category: str, nature_of_duty: str = "visit", rank: str = None,
    da_multiplier: float = None, mattress_count: int = 0, member_id: int = None,
) -> dict:
    nights = max((check_out - check_in).days, 1)
    category = normalize_category(client_category)
    room_type = getattr(room.room_type, "value", room.room_type)

    components = {}
    nightly = 0.0
    monthly_total = None
    mode = "base_price"
    note = None
    skip_mattress = False

    if nature_of_duty == "hra":
        mode = "hra_monthly"
        skip_mattress = True
        hra_rank = rank
        if member_id:
            from backend.models import Member  # local import: avoid a pricing<->models circular import at module load
            member = db.query(Member).filter(Member.id == member_id).first()
            if member:
                hra_rank = member.rank
        hra_rate = get_hra_rank_rate(db, hra_rank)
        utility_rate = get_hra_utility_rate(db, room_type)
        if hra_rate and utility_rate is not None:
            band, hra_amount = hra_rate
            components = {"hra_rank_rate": hra_amount, "utility_charge": utility_rate}
            monthly_total = round(hra_amount + utility_rate, 2)
            note = f"{DEFAULT_HRA_RANK_RATES.get(band, (band,))[0]} HRA (Rs {hra_amount:,.0f}) + room utilities (Rs {utility_rate:,.0f}) - charged monthly via the mess bill, not per night"
        else:
            note = "No HRA rate found for this rank/room class yet - link a member with a recognised rank so the mess bill can price this residency"
    elif nature_of_duty == "official_duty" and (duty := get_duty_rate(db, rank)):
        band, da_amount = duty
        mult = float(da_multiplier) if da_multiplier else 1.5
        nightly = round(da_amount * mult, 2)
        components = {"da_charge": nightly}
        mode = "official_duty"
        note = f"{DEFAULT_DUTY_RATES.get(band, (band,))[0]} @ {mult:g} DA (Rs {da_amount:,.0f}/DA), all utilities inclusive"
    else:
        member_rate = get_setting_float(db, "member_room_night_rate", 0.0) if member_id else 0.0
        rate = get_room_rate(db, room_type, category)
        if member_rate > 0:
            nightly = member_rate
            components = {"rent": nightly}
            mode = "member_rate"
        elif rate:
            components = rate
            nightly = round(sum(rate.values()), 2)
            mode = "rate_card"
        else:
            nightly = float(room.base_price)
            components = {"rent": nightly}
            note = "No rate-card entry for this room class - using the room's base price"

    mattress_count = 0 if skip_mattress else (mattress_count or 0)
    mattress_daily = get_setting_float(
        db, "mattress_civilian_daily" if category == "civilian" else "mattress_officer_daily",
        300.0 if category == "civilian" else 150.0,
    )
    mattress_total = round(mattress_count * mattress_daily * nights, 2)
    room_total = round(nightly * nights, 2)
    total = monthly_total if monthly_total is not None else round(room_total + mattress_total, 2)

    return {
        "pricing_mode": mode,
        "guest_category": category,
        "nights": nights,
        "components": components,
        "nightly_total": nightly,
        "room_total": room_total,
        "monthly_total": monthly_total,
        "mattress_count": mattress_count,
        "mattress_daily": mattress_daily if mattress_count else 0,
        "mattress_total": mattress_total,
        "total": total,
        "note": note,
    }
