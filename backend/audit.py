"""Immutable audit logging system."""
import json
from datetime import datetime
from typing import Optional, Any
from sqlalchemy.orm import Session
from backend.models import AuditLog, AuditAction
from backend.logging_config import get_logger

logger = get_logger("app")


def log_audit(
    db: Session,
    user_id: Optional[int],
    user_name: Optional[str],
    action: AuditAction,
    entity_type: str,
    entity_id: Optional[int] = None,
    before_state: Optional[Any] = None,
    after_state: Optional[Any] = None,
    reason: Optional[str] = None,
    department: Optional[str] = None,
    ip_address: Optional[str] = None,
) -> AuditLog:
    """Create an immutable audit log entry."""
    entry = AuditLog(
        user_id=user_id,
        user_name=user_name,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        before_state=json.dumps(before_state) if before_state else None,
        after_state=json.dumps(after_state) if after_state else None,
        reason=reason,
        department=department,
        ip_address=ip_address,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    logger.info(f"AUDIT: {action.value} on {entity_type}#{entity_id} by {user_name}")
    return entry


def serialize_model(obj: Any) -> dict:
    """Serialize a SQLAlchemy model to a dict for audit logging."""
    if obj is None:
        return None
    data = {}
    for col in obj.__table__.columns:
        val = getattr(obj, col.name)
        if val is not None:
            if isinstance(val, datetime):
                data[col.name] = val.isoformat()
            elif isinstance(val, (int, float, str, bool)):
                data[col.name] = val
            else:
                data[col.name] = str(val)
    return data
