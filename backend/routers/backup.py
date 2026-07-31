"""Backup management router."""
import os
import shutil
import zipfile
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from backend.database import get_db, engine
from backend.config import BACKUP_DIR, DB_PATH, LOGS_DIR
from backend.auth import PermissionChecker
from backend.audit import log_audit, AuditAction
from backend.logging_config import get_logger

logger = get_logger("app")
router = APIRouter()


@router.get("/list")
async def list_backups(current_user=Depends(PermissionChecker("backup", "view"))):
    backups = []
    if BACKUP_DIR.exists():
        for f in sorted(BACKUP_DIR.glob("*.zip"), reverse=True):
            backups.append({
                "filename": f.name,
                "size": f.stat().st_size,
                "created": datetime.fromtimestamp(f.stat().st_mtime),
            })
    return backups


@router.post("/create")
async def create_backup(current_user=Depends(PermissionChecker("backup", "create"))):
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    filename = f"backup_{timestamp}.zip"
    filepath = BACKUP_DIR / filename

    with zipfile.ZipFile(filepath, 'w', zipfile.ZIP_DEFLATED) as zf:
        if DB_PATH.exists():
            zf.write(DB_PATH, arcname="hotel_mess.db")
        # Include logs
        if LOGS_DIR.exists():
            for log_file in LOGS_DIR.glob("*.log"):
                zf.write(log_file, arcname=f"logs/{log_file.name}")

    log_audit(None, current_user.id, current_user.full_name, AuditAction.CREATE, "backups", reason=f"Manual backup: {filename}")
    logger.info(f"Backup created: {filename}")
    return {"message": "Backup created", "filename": filename}


@router.get("/download/{filename}")
async def download_backup(filename: str, current_user=Depends(PermissionChecker("backup", "view"))):
    filepath = BACKUP_DIR / filename
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="Backup not found")
    return FileResponse(filepath, filename=filename, media_type="application/zip")
