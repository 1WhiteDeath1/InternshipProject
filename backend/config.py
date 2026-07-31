"""Application configuration."""
import os
import sys
from pathlib import Path
from pydantic_settings import BaseSettings

BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parent

# Under a PyInstaller build, __file__ lives inside the (read-only, reinstall-
# clobbered) app bundle, so writable data goes to a stable per-user folder
# instead - keeps the DB/logs/uploads across upgrades and needs no admin
# write access. Plain `python -m uvicorn ...` dev runs are untouched.
if getattr(sys, "frozen", False):
    DATA_DIR = Path(os.getenv("LOCALAPPDATA", str(BASE_DIR))) / "EME MESS" / "data"
else:
    DATA_DIR = BASE_DIR

DB_PATH = DATA_DIR / "hotel_mess.db"
LOGS_DIR = DATA_DIR / "logs"
BRANDING_FILE = DATA_DIR / "branding_config.enc"
BACKUP_DIR = DATA_DIR / "backups"
UPLOADS_DIR = DATA_DIR / "uploads"

for d in [DATA_DIR, LOGS_DIR, BACKUP_DIR, UPLOADS_DIR]:
    d.mkdir(parents=True, exist_ok=True)

class Settings(BaseSettings):
    SECRET_KEY: str = os.getenv("SECRET_KEY", "hotel-mess-secret-key-change-in-production")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480
    MAX_LOGIN_ATTEMPTS: int = 5
    LOCKOUT_DURATION_MINUTES: int = 30
    DEFAULT_PAGE_SIZE: int = 25
    BACKUP_RETENTION_DAYS: int = 30
    AUTO_BACKUP_HOUR: int = 2

    class Config:
        env_file = ".env"

settings = Settings()
