"""Branding configuration router."""
from fastapi import APIRouter, Depends, HTTPException
from backend.schemas import BrandingConfig
from backend.branding import load_branding_config, update_branding_config
from backend.auth import get_current_user

router = APIRouter()


@router.get("")
async def get_branding():
    return load_branding_config()


@router.put("")
async def update_branding(data: BrandingConfig, password: str):
    if update_branding_config(password, data):
        return {"message": "Branding updated"}
    raise HTTPException(status_code=403, detail="Invalid password")
