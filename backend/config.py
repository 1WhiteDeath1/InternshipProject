"""Application configuration."""
import os
from pathlib import Path
from pydantic_settings import BaseSettings

BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parent
DB_PATH = BASE_DIR / "hotel_mess.db"
LOGS_DIR = BASE_DIR / "logs"
BRANDING_FILE = BASE_DIR / "branding_config.enc"
BACKUP_DIR = BASE_DIR / "backups"

for d in [LOGS_DIR, BACKUP_DIR]:
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
