"""Authentication router - login, logout, password management."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.models import User, UserStatus, Role
from backend.schemas import LoginRequest, Token, PasswordChange
from backend.auth import hash_password, verify_password, create_access_token, get_current_user
from backend.audit import log_audit, serialize_model, AuditAction
from backend.logging_config import get_logger
from backend.config import settings

logger = get_logger("security")
router = APIRouter()


@router.post("/login", response_model=Token)
async def login(
    req: LoginRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.username == req.username).first()

    if not user:
        logger.warning(f"Login failed: unknown user {req.username} from {request.client.host}")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    if user.status == UserStatus.LOCKED:
        if user.locked_until and user.locked_until > datetime.utcnow():
            logger.warning(f"Login attempt on locked account: {req.username}")
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is locked")
        else:
            user.status = UserStatus.ACTIVE
            user.login_attempts = 0
            user.locked_until = None

    if not verify_password(req.password, user.hashed_password):
        user.login_attempts = (user.login_attempts or 0) + 1
        if user.login_attempts >= settings.MAX_LOGIN_ATTEMPTS:
            user.status = UserStatus.LOCKED
            user.locked_until = datetime.utcnow() + __import__("datetime").timedelta(minutes=settings.LOCKOUT_DURATION_MINUTES)
            db.commit()
            logger.warning(f"Account locked: {req.username}")
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account locked due to failed attempts")
        db.commit()
        logger.warning(f"Login failed: wrong password for {req.username}")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    # Success
    user.login_attempts = 0
    user.locked_until = None
    user.last_login = datetime.utcnow()
    db.commit()

    token = create_access_token({"sub": str(user.id), "username": user.username, "role_id": user.role_id})

    log_audit(db, user.id, user.full_name, AuditAction.LOGIN, "users", user.id, ip_address=request.client.host)
    logger.info(f"User logged in: {user.username}")

    return Token(
        access_token=token,
        user={
            "id": user.id,
            "username": user.username,
            "full_name": user.full_name,
            "email": user.email,
            "role_id": user.role_id,
            "is_supervisor": user.role.is_supervisor if user.role else False,
            "role_name": user.role.name if user.role else None,
        }
    )


@router.post("/logout")
async def logout(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    log_audit(db, current_user.id, current_user.full_name, AuditAction.LOGOUT, "users", current_user.id, ip_address=request.client.host)
    logger.info(f"User logged out: {current_user.username}")
    return {"message": "Logged out successfully"}


@router.post("/change-password")
async def change_password(
    data: PasswordChange,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not verify_password(data.old_password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")

    current_user.hashed_password = hash_password(data.new_password)
    db.commit()

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "users", current_user.id, reason="Password changed")
    return {"message": "Password changed successfully"}


@router.get("/me")
async def get_me(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "username": current_user.username,
        "full_name": current_user.full_name,
        "email": current_user.email,
        "role_id": current_user.role_id,
        "is_supervisor": current_user.role.is_supervisor if current_user.role else False,
        "role_name": current_user.role.name if current_user.role else None,
        "status": current_user.status.value if current_user.status else None,
        "preferences": current_user.preferences,
    }
