"""Structured logging configuration."""
import os
import logging
import logging.handlers
from pathlib import Path
from backend.config import LOGS_DIR


def setup_logging():
    LOGS_DIR.mkdir(parents=True, exist_ok=True)

    log_format = "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s"
    date_format = "%Y-%m-%d %H:%M:%S"
    formatter = logging.Formatter(log_format, datefmt=date_format)

    # Root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)

    # Console handler
    console = logging.StreamHandler()
    console.setFormatter(formatter)
    root_logger.addHandler(console)

    # App log - rotating daily
    app_handler = logging.handlers.TimedRotatingFileHandler(
        LOGS_DIR / "app.log",
        when="midnight",
        interval=1,
        backupCount=30,
        encoding="utf-8",
    )
    app_handler.setFormatter(formatter)
    app_handler.suffix = "%Y-%m-%d"
    app_logger = logging.getLogger("app")
    app_logger.addHandler(app_handler)

    # Security log
    sec_handler = logging.handlers.TimedRotatingFileHandler(
        LOGS_DIR / "security.log",
        when="midnight",
        interval=1,
        backupCount=30,
        encoding="utf-8",
    )
    sec_handler.setFormatter(formatter)
    sec_handler.suffix = "%Y-%m-%d"
    sec_logger = logging.getLogger("security")
    sec_logger.addHandler(sec_handler)

    # DB log
    db_handler = logging.handlers.TimedRotatingFileHandler(
        LOGS_DIR / "database.log",
        when="midnight",
        interval=1,
        backupCount=30,
        encoding="utf-8",
    )
    db_handler.setFormatter(formatter)
    db_handler.suffix = "%Y-%m-%d"
    db_logger = logging.getLogger("database")
    db_logger.addHandler(db_handler)

    return root_logger


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
