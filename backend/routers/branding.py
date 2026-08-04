"""Branding configuration router. GET is intentionally unauthenticated - the
splash screen needs the logo/title before a login token exists, and the data
carries nothing sensitive (badge text, splash title/subtitle). PUT is RBAC-gated
(branding:edit) rather than the old query-string password: that password was
purely an encryption-key seed with a hardcoded default, not a real secret, and
passing it as a query parameter put it in plain text into server access logs
and browser history for zero actual benefit."""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.schemas import BrandingConfig
from backend.branding import load_branding_config, update_branding_config, DEFAULT_PASSWORD
from backend.auth import get_current_user, check_permission
from backend.audit import log_audit
from backend.models import AuditAction

router = APIRouter()


@router.get("")
async def get_branding():
    return load_branding_config()


@router.put("")
async def update_branding(data: BrandingConfig, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "branding", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    before = load_branding_config()
    if not update_branding_config(DEFAULT_PASSWORD, data):
        raise HTTPException(status_code=500, detail="Failed to update branding")
    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "branding", 0,
              before_state=before.model_dump(), after_state=data.model_dump(), ip_address=request.client.host)
    return {"message": "Branding updated"}
