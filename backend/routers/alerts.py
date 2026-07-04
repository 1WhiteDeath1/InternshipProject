"""Alerts router."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.models import Alert, AlertStatus
from backend.auth import get_current_user, require_supervisor

router = APIRouter()


@router.get("")
async def list_alerts(
    status: str = "", severity: str = "", module: str = "",
    page: int = Query(1, ge=1), page_size: int = Query(25, ge=1),
    db: Session = Depends(get_db), current_user=Depends(get_current_user),
):
    query = db.query(Alert)
    if status:
        query = query.filter(Alert.status == status)
    if severity:
        query = query.filter(Alert.severity == severity)
    if module:
        query = query.filter(Alert.module == module)

    total = query.count()
    alerts = query.order_by(Alert.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {"items": [
        {"id": a.id, "title": a.title, "message": a.message,
         "severity": a.severity.value, "status": a.status.value,
         "module": a.module, "created_at": a.created_at} for a in alerts], "total": total}


@router.get("/unread-count")
async def unread_count(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    count = db.query(Alert).filter(Alert.status == AlertStatus.NEW).count()
    return {"count": count}


@router.post("/{alert_id}/acknowledge")
async def acknowledge_alert(alert_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    alert = db.query(Alert).filter(Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    alert.status = AlertStatus.ACKNOWLEDGED
    alert.acknowledged_by = current_user.id
    from datetime import datetime
    alert.acknowledged_at = datetime.utcnow()
    db.commit()
    return {"message": "Alert acknowledged"}


@router.post("/{alert_id}/resolve")
async def resolve_alert(alert_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    alert = db.query(Alert).filter(Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    alert.status = AlertStatus.RESOLVED
    alert.resolved_by = current_user.id
    from datetime import datetime
    alert.resolved_at = datetime.utcnow()
    db.commit()
    return {"message": "Alert resolved"}


@router.post("/run-checks")
async def run_checks(db: Session = Depends(get_db), current_user=Depends(require_supervisor)):
    from backend.alerts import run_all_checks
    from backend.services.anomaly_engine import run_anomaly_checks
    result = run_all_checks(db)
    result.update(run_anomaly_checks(db))
    return result
