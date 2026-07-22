"""Rates domain: the rate-card tables (room rates, duty/HRA/Women's Bloc rank
rates, HRA utility rates, and the optional tariff-matrix override)."""
from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Numeric, UniqueConstraint
from backend.database import Base


class RoomRate(Base):
    """Nightly rate matrix from the official rate card: one row per
    room class x guest category, itemized into the components the mess
    bills separately (rent, electricity, generator, gas, internet/cable).
    Editable data - rates get revised by official letter."""
    __tablename__ = "room_rates"
    __table_args__ = (UniqueConstraint("room_type", "guest_category", name="uq_room_rate"),)

    id = Column(Integer, primary_key=True)
    room_type = Column(String(20), nullable=False)  # RoomType value
    guest_category = Column(String(30), nullable=False)  # serving_officer | retired_officer | civilian
    rent = Column(Numeric(10, 2), nullable=False, default=0)
    electricity = Column(Numeric(10, 2), nullable=False, default=0)
    generator = Column(Numeric(10, 2), nullable=False, default=0)
    gas = Column(Numeric(10, 2), nullable=False, default=0)
    internet = Column(Numeric(10, 2), nullable=False, default=0)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = Column(Integer, ForeignKey("users.id"))


class DutyRate(Base):
    """Daily-allowance room charge for serving officers on official duty,
    per rank band. Bookings bill at da_amount x da_multiplier (1 or 1.5)."""
    __tablename__ = "duty_rates"

    id = Column(Integer, primary_key=True)
    rank_band = Column(String(30), nullable=False, unique=True)  # maj_capt | ltcol_brig | maj_gen | ltgen_gen
    label = Column(String(100))
    da_amount = Column(Numeric(10, 2), nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = Column(Integer, ForeignKey("users.id"))


class HraRankRate(Base):
    """Monthly HRA (Hostel Rent Allowance) rate for a permanent resident
    officer, per rank band - finer-grained than DutyRate's bands since the
    HRA card prices Capt/Maj and Lt Col-Col/Brig separately."""
    __tablename__ = "hra_rank_rates"

    id = Column(Integer, primary_key=True)
    rank_band = Column(String(30), nullable=False, unique=True)  # capt | maj | ltcol_col | brig | maj_gen
    label = Column(String(100))
    monthly_amount = Column(Numeric(10, 2), nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = Column(Integer, ForeignKey("users.id"))


class WomensBlocRankRate(Base):
    """Monthly rank-based rate for a resident in the Women's Bloc wing -
    structurally identical to HraRankRate (same rank bands via
    hra_rank_to_band/_HRA_RANK_BANDS) but a separate table, since the two are
    orthogonal: a resident can be in the Women's Bloc wing and still keep
    their existing officers/jcos/ors mess_category. Seeded with Rs 0
    placeholder defaults - see DEFAULT_WOMENS_BLOC_RANK_RATES."""
    __tablename__ = "womens_bloc_rank_rates"

    id = Column(Integer, primary_key=True)
    rank_band = Column(String(30), nullable=False, unique=True)  # capt | maj | ltcol_col | brig | maj_gen
    label = Column(String(100))
    monthly_amount = Column(Numeric(10, 2), nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = Column(Integer, ForeignKey("users.id"))


class HraUtilityRate(Base):
    """Monthly flat utility charge (elec/gen/gas/internet bundled) for an
    HRA resident's room class - separate from RoomRate's nightly guest
    components."""
    __tablename__ = "hra_utility_rates"

    id = Column(Integer, primary_key=True)
    room_type = Column(String(20), nullable=False, unique=True)  # RoomType value
    monthly_amount = Column(Numeric(10, 2), nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = Column(Integer, ForeignKey("users.id"))


class TariffRate(Base):
    """Optional tiered override matrix: rank x room_type x stay_type ->
    nightly rate. When a matching row exists, compute_booking_price uses it
    ahead of the rate-card/duty/HRA engine above; otherwise that existing
    engine still applies unchanged. rank/room_type/stay_type are plain
    strings (not FKs) - the same convention RoomRate/DutyRate already use,
    since rank has never been a first-class entity in this schema."""
    __tablename__ = "tariff_rates"
    __table_args__ = (UniqueConstraint("rank", "room_type", "stay_type", name="uq_tariff_rate"),)

    id = Column(Integer, primary_key=True)
    rank = Column(String(50), nullable=False)
    room_type = Column(String(20), nullable=False)  # RoomType value
    stay_type = Column(String(20), nullable=False)  # official | private | family
    nightly_rate = Column(Numeric(10, 2), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = Column(Integer, ForeignKey("users.id"))
