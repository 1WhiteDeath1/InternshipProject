"""Role management router."""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.models import Role, RolePermission
from backend.schemas import RoleCreate, RoleUpdate, RoleOut, RolePermissionOut
from backend.auth import require_supervisor
from backend.audit import log_audit, serialize_model, AuditAction

router = APIRouter()


@router.get("")
async def list_roles(db: Session = Depends(get_db), current_user=Depends(require_supervisor)):
    roles = db.query(Role).all()
    return [
        {
            "id": r.id, "name": r.name, "description": r.description,
            "is_supervisor": r.is_supervisor, "created_at": r.created_at,
            "permissions": [
                {"id": p.id, "module": p.module, "action": p.action, "data_scope": p.data_scope}
                for p in r.permissions
            ],
        }
        for r in roles
    ]


@router.post("")
async def create_role(data: RoleCreate, request: Request, db: Session = Depends(get_db), current_user=Depends(require_supervisor)):
    if db.query(Role).filter(Role.name == data.name).first():
        raise HTTPException(status_code=400, detail="Role name already exists")

    role = Role(name=data.name, description=data.description, is_supervisor=data.is_supervisor)
    db.add(role)
    db.commit()
    db.refresh(role)

    for perm in data.permissions:
        p = RolePermission(role_id=role.id, module=perm.module, action=perm.action, data_scope=perm.data_scope)
        db.add(p)
    db.commit()
    db.refresh(role)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.CREATE, "roles", role.id, after_state=serialize_model(role), ip_address=request.client.host)
    return {"id": role.id, "name": role.name, "is_supervisor": role.is_supervisor, "permissions": data.permissions}


@router.put("/{role_id}")
async def update_role(role_id: int, data: RoleUpdate, request: Request, db: Session = Depends(get_db), current_user=Depends(require_supervisor)):
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")

    before = serialize_model(role)
    if data.name:
        role.name = data.name
    if data.description is not None:
        role.description = data.description
    if data.is_supervisor is not None:
        role.is_supervisor = data.is_supervisor

    if data.permissions is not None:
        db.query(RolePermission).filter(RolePermission.role_id == role_id).delete()
        for perm in data.permissions:
            p = RolePermission(role_id=role.id, module=perm.module, action=perm.action, data_scope=perm.data_scope)
            db.add(p)

    db.commit()
    db.refresh(role)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "roles", role.id, before_state=before, after_state=serialize_model(role), ip_address=request.client.host)
    return {"message": "Role updated"}
