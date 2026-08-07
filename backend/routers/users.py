"""User management router."""
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from sqlalchemy import func
from backend.database import get_db
from backend.models import User, Role, UserStatus
from backend.schemas import UserCreate, UserUpdate, UserOut, UserListResponse
from backend.auth import get_current_user, hash_password, PermissionChecker
from backend.audit import log_audit, serialize_model, AuditAction
from backend.logging_config import get_logger

logger = get_logger("app")
router = APIRouter()


@router.get("", response_model=UserListResponse)
async def list_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    search: str = "",
    status: str = "",
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("users", "view")),
):
    query = db.query(User)
    if search:
        query = query.filter(
            (User.username.contains(search)) |
            (User.full_name.contains(search)) |
            (User.email.contains(search))
        )
    if status:
        query = query.filter(User.status == status)

    total = query.count()
    users = query.order_by(User.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()

    items = []
    for u in users:
        items.append(UserOut(
            id=u.id, username=u.username, email=u.email, full_name=u.full_name,
            role_id=u.role_id, status=u.status.value if u.status else "active",
            last_login=u.last_login, created_at=u.created_at, updated_at=u.updated_at,
            role_name=u.role.name if u.role else None,
            is_supervisor=u.role.is_supervisor if u.role else False,
        ))

    return UserListResponse(items=items, total=total, page=page, page_size=page_size)


@router.post("", response_model=UserOut)
async def create_user(
    data: UserCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("users", "create")),
):
    if db.query(User).filter(User.username == data.username).first():
        raise HTTPException(status_code=400, detail="Username already exists")
    if db.query(User).filter(User.email == data.email).first():
        raise HTTPException(status_code=400, detail="Email already exists")

    role = db.query(Role).filter(Role.id == data.role_id).first()
    if not role:
        raise HTTPException(status_code=400, detail="Role not found")

    user = User(
        username=data.username,
        email=data.email,
        full_name=data.full_name,
        hashed_password=hash_password(data.password),
        role_id=data.role_id,
        status=UserStatus(data.status) if data.status else UserStatus.ACTIVE,
        created_by=current_user.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.CREATE, "users", user.id, after_state=serialize_model(user), ip_address=request.client.host)
    logger.info(f"User created: {user.username} by {current_user.username}")

    return UserOut(
        id=user.id, username=user.username, email=user.email, full_name=user.full_name,
        role_id=user.role_id, status=user.status.value, last_login=user.last_login,
        created_at=user.created_at, updated_at=user.updated_at,
        role_name=role.name, is_supervisor=role.is_supervisor,
    )


@router.put("/{user_id}", response_model=UserOut)
async def update_user(
    user_id: int,
    data: UserUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("users", "edit")),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    before = serialize_model(user)

    if data.email:
        user.email = data.email
    if data.full_name:
        user.full_name = data.full_name
    if data.role_id:
        user.role_id = data.role_id
    if data.status:
        user.status = UserStatus(data.status)
        if data.status == UserStatus.ACTIVE.value:
            user.login_attempts = 0
            user.locked_until = None
    if data.preferences:
        user.preferences = data.preferences

    db.commit()
    db.refresh(user)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "users", user.id, before_state=before, after_state=serialize_model(user), ip_address=request.client.host)

    return UserOut(
        id=user.id, username=user.username, email=user.email, full_name=user.full_name,
        role_id=user.role_id, status=user.status.value, last_login=user.last_login,
        created_at=user.created_at, updated_at=user.updated_at,
        role_name=user.role.name if user.role else None,
        is_supervisor=user.role.is_supervisor if user.role else False,
    )


@router.delete("/{user_id}")
async def delete_user(
    user_id: int,
    reason: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("users", "edit")),
):
    """Soft-delete: deactivates the account rather than removing the row.
    Dozens of tables (audit log, bookings, invoices, kitchen orders...) carry
    a users.id FK back to whoever performed the action - a hard delete would
    either violate those FKs or silently orphan the audit trail. Deactivating
    (same UserStatus.INACTIVE the status dropdown already offers) blocks
    login via get_current_user's active-status check while keeping history
    intact, mirroring how Members are "transferred"/"left" rather than
    physically removed."""
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    before = serialize_model(user)
    user.status = UserStatus.INACTIVE
    db.commit()

    log_audit(db, current_user.id, current_user.full_name, AuditAction.SOFT_DELETE, "users", user.id, before_state=before, after_state=serialize_model(user), reason=reason, ip_address=request.client.host)
    logger.info(f"User deactivated: {user.username} by {current_user.username}")

    return {"message": "User deactivated"}


@router.post("/{user_id}/unlock")
async def unlock_user(
    user_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("users", "edit")),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    before = serialize_model(user)
    user.status = UserStatus.ACTIVE
    user.login_attempts = 0
    user.locked_until = None
    db.commit()

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "users", user.id, before_state=before, after_state=serialize_model(user), reason="Account unlocked by supervisor", ip_address=request.client.host)
    logger.info(f"User unlocked: {user.username} by {current_user.username}")

    return {"message": "User account unlocked"}
