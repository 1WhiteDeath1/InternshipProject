"""Pre-build sanity check: confirms packaging/seed_data/hotel_mess.db's demo
users still log in with the documented demo password. Run automatically by
packaging/build.ps1 before packaging - catches a stale/hand-edited seed DB
(the 1.5.0 regression: a modified working DB got committed as the seed
template, so every demo login failed) before it ships in an installer.

Run manually: backend\\venv\\Scripts\\python.exe packaging\\verify_seed_db.py
"""
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from backend.auth import verify_password

# Must match DEMO_PASSWORD in backend/seed_demo.py
DEMO_PASSWORD = "123456"

SEED_DB = Path(__file__).resolve().parent / "seed_data" / "hotel_mess.db"


def main() -> int:
    if not SEED_DB.exists():
        print(f"ERROR: seed DB not found at {SEED_DB}")
        return 1

    con = sqlite3.connect(str(SEED_DB))
    rows = con.execute("SELECT username, hashed_password, status FROM users").fetchall()
    con.close()

    if not rows:
        print("ERROR: seed DB has no users - nothing to log in with.")
        return 1

    failures = [(username, status) for username, hashed_password, status in rows
                if not verify_password(DEMO_PASSWORD, hashed_password)]

    if failures:
        print(f"ERROR: {len(failures)} seed user(s) do NOT match the demo password '{DEMO_PASSWORD}':")
        for username, status in failures:
            print(f"  - {username} (status={status})")
        print(
            "\nThe seed DB is stale or was hand-edited. Regenerate it with a "
            "clean `python backend/seed_demo.py` run (point LOCALAPPDATA at an "
            "isolated scratch dir first, not your real dev DB) and copy the "
            "result over packaging/seed_data/hotel_mess.db."
        )
        return 1

    print(f"OK: all {len(rows)} seed users match the demo password '{DEMO_PASSWORD}'.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
