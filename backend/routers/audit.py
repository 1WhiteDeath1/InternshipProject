"""Audit log router."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.models import AuditLog
from backend.auth import PermissionChecker

router = APIRouter()


@router.get("")
async def list_audit_logs(
    user_id: int = 0,
    action: str = "",
    entity_type: str = "",
    department: str = "",
    date_from: str = "",
    date_to: str = "",
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user=Depends(PermissionChecker("audit", "view")),
):
    query = db.query(AuditLog)
    if user_id:
        query = query.filter(AuditLog.user_id == user_id)
    if action:
        query = query.filter(AuditLog.action == action)
    if entity_type:
        query = query.filter(AuditLog.entity_type == entity_type)
    if department:
        query = query.filter(AuditLog.department == department)
    if date_from:
        query = query.filter(AuditLog.timestamp >= date_from)
    if date_to:
        query = query.filter(AuditLog.timestamp <= date_to + " 23:59:59")

    total = query.count()
    logs = query.order_by(AuditLog.timestamp.desc()).offset((page - 1) * page_size).limit(page_size).all()

    return {"items": [
        {"id": l.id, "user_id": l.user_id, "user_name": l.user_name,
         "action": l.action.value if l.action else None,
         "entity_type": l.entity_type, "entity_id": l.entity_id,
         "before_state": l.before_state, "after_state": l.after_state,
         "reason": l.reason, "department": l.department,
         "timestamp": l.timestamp, "ip_address": l.ip_address} for l in logs], "total": total}
