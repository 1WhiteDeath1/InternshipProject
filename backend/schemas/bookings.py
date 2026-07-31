"""Bookings domain schemas."""
from datetime import datetime, date
from typing import Optional
from pydantic import BaseModel, Field, ConfigDict, model_validator


class GuestBookingSummary(BaseModel):
    """A booking, summarized for a guest's profile (schemas.guests.GuestProfileOut)."""
    id: int
    booking_reference: str
    room_number: Optional[str] = None
    check_in: date
    check_out: date
    status: str
    rank: Optional[str] = None
    client_category: str
    total_amount: Optional[float] = None


class BookingBase(BaseModel):
    guest_name: str = Field(..., min_length=1, max_length=200)
    guest_phone: Optional[str] = None
    guest_email: Optional[str] = None
    guest_id_type: Optional[str] = None
    guest_id_number: Optional[str] = None
    room_id: int
    check_in: date
    check_out: date
    adults: int = Field(1, ge=1)
    children: int = Field(0, ge=0)
    special_requests: Optional[str] = None
    client_category: str = "non_member_civilian"
    member_id: Optional[int] = None
    # Booking-register fields
    rank: Optional[str] = Field(None, max_length=50)
    pa_number: Optional[str] = Field(None, max_length=50)
    unit_address: Optional[str] = Field(None, max_length=255)
    nature_of_duty: str = "visit"
    da_multiplier: Optional[float] = None
    mattress_count: int = Field(0, ge=0, le=10)
    source: str = "walk_in"
    online_voucher_no: Optional[str] = Field(None, max_length=50)
    # Online bookings pay the room charge in full, in advance, outside SAM -
    # advance_paid_at is the actual receipt date (not the booking date), so
    # the auto-applied payment at checkout is dated correctly for collections
    # reporting rather than looking like it arrived on checkout day.
    advance_payment_amount: Optional[float] = Field(None, ge=0)
    advance_paid_at: Optional[date] = None
    reference_person: Optional[str] = Field(None, max_length=100)
    attendant_id: Optional[int] = None
    stay_type: Optional[str] = None
    # Non-HRA open-ended stay - no known departure date yet. The submitted
    # check_out is ignored server-side and replaced with a far-future
    # placeholder (see create_booking); real checkout re-prices to actual nights.
    is_indefinite: bool = False

    @model_validator(mode="after")
    def _check_dates(self):
        if self.check_out <= self.check_in:
            raise ValueError("check_out must be after check_in")
        # Civilians must name a reference ("C/O ..." in the paper register);
        # officers / institutional guests are identifiable by rank & service, so
        # the reference stays optional for them.
        if self.client_category in ("civilian", "non_member_civilian") and not (self.reference_person or "").strip():
            raise ValueError("Civilian guests require a reference person (C/O)")
        if self.nature_of_duty not in ("visit", "leave", "official_duty", "hra"):
            raise ValueError("nature_of_duty must be one of: visit, leave, official_duty, hra")
        if self.da_multiplier is not None and self.da_multiplier not in (1.0, 1.5):
            raise ValueError("da_multiplier must be 1 or 1.5")
        if self.source not in ("walk_in", "online"):
            raise ValueError("source must be walk_in or online")
        if self.source == "online" and not (self.online_voucher_no or "").strip():
            raise ValueError("Online bookings need the portal voucher number (Online V/No)")
        if self.source == "online" and not (self.advance_payment_amount and self.advance_payment_amount > 0):
            raise ValueError("Online bookings are paid in full in advance - enter the amount received")
        if self.source == "online" and not self.advance_paid_at:
            raise ValueError("Online bookings need the date the advance was actually received")
        return self

class BookingCreate(BookingBase):
    check_in_now: bool = False  # walk-in fast path: create and check in immediately

class BookingUpdate(BaseModel):
    guest_name: Optional[str] = None
    guest_phone: Optional[str] = None
    guest_email: Optional[str] = None
    room_id: Optional[int] = None
    check_in: Optional[date] = None
    check_out: Optional[date] = None
    status: Optional[str] = None
    special_requests: Optional[str] = None

    @model_validator(mode="after")
    def _check_dates(self):
        if self.check_in is not None and self.check_out is not None and self.check_out <= self.check_in:
            raise ValueError("check_out must be after check_in")
        return self

class BookingOut(BookingBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    booking_reference: str
    status: str
    total_amount: Optional[float] = None
    processed_by: Optional[int] = None
    created_at: datetime
    room_number: Optional[str] = None
    member_name: Optional[str] = None

class GuestMovementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    booking_id: int
    movement_type: str
    timestamp: datetime
    processed_by: Optional[int] = None
    notes: Optional[str] = None
