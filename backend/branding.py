"""Branding protection - encrypted configuration."""
import json
import base64
from pathlib import Path
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from backend.config import BRANDING_FILE
from backend.schemas import BrandingConfig

DEFAULT_CONFIG = BrandingConfig()
SALT = b"sam_hotel_mess_salt_v1"


def _get_key(password: str) -> bytes:
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=SALT,
        iterations=100000,
    )
    key = base64.urlsafe_b64encode(kdf.derive(password.encode()))
    return key


def create_default_branding_file():
    if not BRANDING_FILE.exists():
        key = _get_key("2225550100")
        f = Fernet(key)
        data = DEFAULT_CONFIG.model_dump_json().encode()
        encrypted = f.encrypt(data)
        BRANDING_FILE.write_bytes(encrypted)


def load_branding_config(password: str = "2225550100") -> BrandingConfig:
    try:
        key = _get_key(password)
        f = Fernet(key)
        encrypted = BRANDING_FILE.read_bytes()
        data = f.decrypt(encrypted)
        return BrandingConfig(**json.loads(data))
    except Exception:
        return DEFAULT_CONFIG


def update_branding_config(password: str, config: BrandingConfig) -> bool:
    try:
        key = _get_key(password)
        f = Fernet(key)
        data = config.model_dump_json().encode()
        encrypted = f.encrypt(data)
        BRANDING_FILE.write_bytes(encrypted)
        return True
    except Exception:
        return False
