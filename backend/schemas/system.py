"""System domain schemas: feature flags and settings."""
from typing import Optional
from pydantic import BaseModel, ConfigDict


class FeatureFlagOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    key: str
    name: str
    description: Optional[str]
    department: str
    enabled: bool

class FeatureFlagToggle(BaseModel):
    enabled: bool


class SettingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    key: str
    value: Optional[str]
    description: Optional[str]

class SettingUpdate(BaseModel):
    value: str
