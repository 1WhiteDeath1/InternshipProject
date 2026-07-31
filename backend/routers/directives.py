"""Directives router: one-way Manager -> role instruction feed."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.models import Directive, DirectiveStatus, Role
from backend.schemas import DirectiveCreate
from backend.auth import get_current_user, check_permission
from backend.audit import log_audit, serialize_model, AuditAction

router = APIRouter()


def _out(d: Directive) -> dict:
    return {
        "id": d.id, "from_user_id": d.from_user_id, "from_user_name": d.from_user.full_name if d.from_user else None,
        "to_role_id": d.to_role_id, "to_role_name": d.to_role.name if d.to_role else None,
        "message": d.message, "status": d.status.value,
        "acknowledged_by": d.acknowledged_by,
        "acknowledged_by_name": d.acknowledger.full_name if d.acknowledger else None,
        "acknowledged_at": d.acknowledged_at, "created_at": d.created_at,
    }


@router.get("")
async def list_directives(
    page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db), current_user=Depends(get_current_user),
):
    """A user sees directives addressed to their own role, plus (if they can
    also create directives, i.e. Manager) the ones they've sent - so the
    sender can confirm what went out without a separate "sent" view."""
    if not check_permission(current_user, "directives", "view"):
        raise HTTPException(status_code=403, detail="Permission denied")
    query = db.query(Directive)
    if check_permission(current_user, "directives", "create"):
        query = query.filter((Directive.to_role_id == current_user.role_id) | (Directive.from_user_id == current_user.id))
    else:
        query = query.filter(Directive.to_role_id == current_user.role_id)
    total = query.count()
    items = query.order_by(Directive.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {"items": [_out(d) for d in items], "total": total, "page": page, "page_size": page_size}


@router.get("/unread-count")
async def unread_count(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "directives", "view"):
        raise HTTPException(status_code=403, detail="Permission denied")
    count = db.query(Directive).filter(
        Directive.to_role_id == current_user.role_id, Directive.status == DirectiveStatus.NEW,
    ).count()
    return {"count": count}


@router.post("")
async def create_directive(data: DirectiveCreate, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "directives", "create"):
        raise HTTPException(status_code=403, detail="Permission denied")
    role = db.query(Role).filter(Role.id == data.to_role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    directive = Directive(from_user_id=current_user.id, to_role_id=data.to_role_id, message=data.message.strip())
    db.add(directive)
    db.commit()
    db.refresh(directive)
    log_audit(db, current_user.id, current_user.full_name, AuditAction.CREATE, "directives", directive.id, after_state=serialize_model(directive))
    return _out(directive)


@router.post("/{directive_id}/acknowledge")
async def acknowledge_directive(directive_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "directives", "view"):
        raise HTTPException(status_code=403, detail="Permission denied")
    directive = db.query(Directive).filter(Directive.id == directive_id).first()
    if not directive:
        raise HTTPException(status_code=404, detail="Directive not found")
    if directive.to_role_id != current_user.role_id:
        raise HTTPException(status_code=403, detail="This directive is not addressed to your role")
    before = serialize_model(directive)
    directive.status = DirectiveStatus.ACKNOWLEDGED
    directive.acknowledged_by = current_user.id
    directive.acknowledged_at = datetime.utcnow()
    db.commit()
    db.refresh(directive)
    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "directives", directive.id, before_state=before, after_state=serialize_model(directive))
    return _out(directive)
