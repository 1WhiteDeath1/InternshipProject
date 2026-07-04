"""FastAPI application entry point."""
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from backend.database import engine, Base
from backend.logging_config import setup_logging
from backend.branding import create_default_branding_file
from backend import routers

setup_logging()
create_default_branding_file()

# Create all tables
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="SAM Hotel & Mess Management",
    description="Production-grade Hotel & Mess Management System",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routers
app.include_router(routers.auth_router, prefix="/api/auth", tags=["Auth"])
app.include_router(routers.users_router, prefix="/api/users", tags=["Users"])
app.include_router(routers.roles_router, prefix="/api/roles", tags=["Roles"])
app.include_router(routers.inventory_router, prefix="/api/inventory", tags=["Inventory"])
app.include_router(routers.procurement_router, prefix="/api/procurement", tags=["Procurement"])
app.include_router(routers.bookings_router, prefix="/api/bookings", tags=["Bookings"])
app.include_router(routers.billing_router, prefix="/api/billing", tags=["Billing"])
app.include_router(routers.security_router, prefix="/api/security", tags=["Security"])
app.include_router(routers.reports_router, prefix="/api/reports", tags=["Reports"])
app.include_router(routers.audit_router, prefix="/api/audit", tags=["Audit"])
app.include_router(routers.alerts_router, prefix="/api/alerts", tags=["Alerts"])
app.include_router(routers.settings_router, prefix="/api/settings", tags=["Settings"])
app.include_router(routers.features_router, prefix="/api/features", tags=["Features"])
app.include_router(routers.import_export_router, prefix="/api/import-export", tags=["Import/Export"])
app.include_router(routers.backup_router, prefix="/api/backup", tags=["Backup"])
app.include_router(routers.branding_router, prefix="/api/branding", tags=["Branding"])

# Serve static files (React build)
dist_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "dist")
if os.path.exists(dist_path):
    app.mount("/assets", StaticFiles(directory=os.path.join(dist_path, "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_react(full_path: str):
        index_path = os.path.join(dist_path, "index.html")
        if os.path.exists(index_path):
            return FileResponse(index_path)
        return {"message": "Build the frontend first"}


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "version": "1.0.0"}
