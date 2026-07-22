"""Security module router."""
from datetime import datetime, time
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.models import SecurityLog, IncidentReport, AlertSeverity
from backend.schemas import SecurityLogCreate, IncidentReportCreate, IncidentReportUpdate
from backend.auth import get_current_user, check_permission, PermissionChecker
from backend.audit import log_audit, serialize_model, AuditAction
from backend.logging_config import get_logger

logger = get_logger("app")
router = APIRouter(dependencies=[Depends(PermissionChecker("security", "view"))])


@router.get("/logs")
async def list_security_logs(
    event_type: str = "", page: int = Query(1, ge=1), page_size: int = Query(25, ge=1),
    db: Session = Depends(get_db), current_user=Depends(get_current_user),
):
    query = db.query(SecurityLog)
    if event_type:
        query = query.filter(SecurityLog.event_type == event_type)
    total = query.count()
    logs = query.order_by(SecurityLog.timestamp.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {"items": logs, "total": total}


@router.post("/logs")
async def create_security_log(data: SecurityLogCreate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "security", "create"):
        raise HTTPException(status_code=403, detail="Permission denied")
    log = SecurityLog(**data.model_dump(), processed_by=current_user.id)
    db.add(log)
    db.commit()
    db.refresh(log)

    # After-hours check
    hour = datetime.utcnow().hour
    if hour < 6 or hour > 22:
        from backend.alerts import create_alert
        create_alert(db, "After-hours access", f"Security event logged at {datetime.utcnow().strftime('%H:%M')}", AlertSeverity.MEDIUM, "security")

    log_audit(db, current_user.id, current_user.full_name, AuditAction.CREATE, "security_logs", log.id, after_state=serialize_model(log), ip_address=request.client.host)
    return log


# --- Incident Reports ---

@router.get("/incidents")
async def list_incidents(
    status: str = "", page: int = Query(1, ge=1), page_size: int = Query(25, ge=1),
    db: Session = Depends(get_db), current_user=Depends(get_current_user),
):
    query = db.query(IncidentReport)
    if status:
        query = query.filter(IncidentReport.status == status)
    total = query.count()
    incidents = query.order_by(IncidentReport.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {"items": incidents, "total": total}


@router.post("/incidents")
async def create_incident(data: IncidentReportCreate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "security", "create"):
        raise HTTPException(status_code=403, detail="Permission denied")
    inc = IncidentReport(**data.model_dump(), reported_by=current_user.id)
    db.add(inc)
    db.commit()
    db.refresh(inc)

    if data.severity in ["high", "critical"]:
        from backend.alerts import create_alert
        create_alert(db, f"Incident: {data.title}", data.description, 
                     AlertSeverity(data.severity), "security", "incident", inc.id)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.CREATE, "incident_reports", inc.id, after_state=serialize_model(inc), ip_address=request.client.host)
    return inc


@router.put("/incidents/{incident_id}")
async def update_incident(incident_id: int, data: IncidentReportUpdate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "security", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    inc = db.query(IncidentReport).filter(IncidentReport.id == incident_id).first()
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(inc, field, value)
    if data.status == "resolved":
        inc.resolved_at = datetime.utcnow()
    db.commit()
    db.refresh(inc)
    return inc
