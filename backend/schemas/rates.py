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
