"""Database connection and session management."""
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, declarative_base
from backend.config import DB_PATH

DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    echo=False,
    pool_pre_ping=True,
)

# Enable foreign key support for SQLite, and make concurrent writes queue
# instead of instantly failing. WAL (Write-Ahead Logging) lets readers and a
# writer run without blocking each other - the default rollback-journal mode
# takes a brief exclusive lock on every commit that blocks reads too. A
# second writer that arrives while another commit is in flight still has to
# wait its turn (SQLite only ever has one writer at a time, WAL or not), but
# busy_timeout makes it retry for up to 5s instead of failing immediately
# with "database is locked" - comfortable headroom for the up to ~15
# concurrent connections this app's pool allows (pool_size=5 + max_overflow=10,
# SQLAlchemy's default), let alone 5 real simultaneous users, since a single
# SQLite commit on local disk normally takes low single-digit milliseconds.
@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_conn, connection_record):
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.close()

# expire_on_commit=False: keep ORM instances populated after commit. Without
# this, every log_audit() commit expires the objects the calling endpoint just
# created, so a bare `return <orm object>` serializes to `{}` (the attributes
# are gone until touched, and FastAPI's encoder reads __dict__ without
# triggering a lazy reload). The post-commit negative-stock re-checks still call
# db.refresh() explicitly, so they read authoritative DB state regardless.
SessionLocal = sessionmaker(autocommit=False, autoflush=False, expire_on_commit=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
