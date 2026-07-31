"""Rates domain schemas: tariff matrix and Women's Bloc rank rates."""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field, ConfigDict


class TariffRateCreate(BaseModel):
    rank: str = Field(..., min_length=1, max_length=50)
    room_type: str = Field(..., min_length=1, max_length=20)
    stay_type: str = Field(..., min_length=1, max_length=20)
    nightly_rate: float = Field(..., ge=0)

class TariffRateOut(TariffRateCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    updated_at: datetime

class WomensBlocRankRateCreate(BaseModel):
    rank_band: str = Field(..., min_length=1, max_length=30)
    label: Optional[str] = None
    monthly_amount: float = Field(..., ge=0)

class WomensBlocRankRateOut(WomensBlocRankRateCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    updated_at: datetime

class RoomRateCreate(BaseModel):
    room_type: str = Field(..., min_length=1, max_length=20)
    guest_category: str = Field(..., min_length=1, max_length=30)
    rent: float = Field(..., ge=0)
    electricity: float = Field(..., ge=0)
    generator: float = Field(..., ge=0)
    gas: float = Field(..., ge=0)
    internet: float = Field(..., ge=0)

class RoomRateOut(RoomRateCreate):
    model_config = ConfigDict(from_attributes=True)
    id: Optional[int] = None
    updated_at: Optional[datetime] = None

class DutyRateCreate(BaseModel):
    rank_band: str = Field(..., min_length=1, max_length=30)
    label: Optional[str] = None
    da_amount: float = Field(..., ge=0)

class DutyRateOut(DutyRateCreate):
    model_config = ConfigDict(from_attributes=True)
    id: Optional[int] = None
    updated_at: Optional[datetime] = None

class HraRankRateCreate(BaseModel):
    rank_band: str = Field(..., min_length=1, max_length=30)
    label: Optional[str] = None
    monthly_amount: float = Field(..., ge=0)

class HraRankRateOut(HraRankRateCreate):
    model_config = ConfigDict(from_attributes=True)
    id: Optional[int] = None
    updated_at: Optional[datetime] = None

class HraUtilityRateCreate(BaseModel):
    room_type: str = Field(..., min_length=1, max_length=20)
    monthly_amount: float = Field(..., ge=0)

class HraUtilityRateOut(HraUtilityRateCreate):
    model_config = ConfigDict(from_attributes=True)
    id: Optional[int] = None
    updated_at: Optional[datetime] = None
