"""Entry point for the packaged EME-MESS.exe (built via PyInstaller).

Boots the same FastAPI app used in dev (backend.main:app) on the loopback
interface only - this build is a single-machine local server for one client
to bug-test on their own PC, not something exposed to the network - then
opens the default browser once the server is accepting connections. Kept as
a console app (not windowed) on purpose: a tester hitting an error should see
the traceback instead of a silently-dead process.
"""
import shutil
import socket
import sys
import threading
import time
import webbrowser
from pathlib import Path

import uvicorn

HOST = "127.0.0.1"
PORT = 8000


def _port_is_free(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex((host, port)) != 0


def _seed_database_if_missing() -> None:
    # First run on a fresh install: prime the DB with the same demo data
    # (rooms, bookings, one user per role - see backend/seed_demo.py) that
    # dev testing already uses, so the client has something to click through
    # instead of an empty shell with no way to log in.
    from backend.config import DB_PATH

    if DB_PATH.exists():
        return
    seed_db = Path(sys._MEIPASS) / "seed_data" / "hotel_mess.db"
    if seed_db.exists():
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(seed_db, DB_PATH)


def _pause() -> None:
    try:
        input("Press Enter to exit...")
    except EOFError:
        pass


def _open_browser_when_ready() -> None:
    for _ in range(120):
        if not _port_is_free(HOST, PORT):
            webbrowser.open(f"http://{HOST}:{PORT}")
            return
        time.sleep(0.5)


def main() -> None:
    print("EME MESS - starting up...")

    if not _port_is_free(HOST, PORT):
        print(f"\nPort {PORT} is already in use.")
        print("EME MESS may already be running - check your taskbar, or close")
        print("whatever else is using that port, then try again.")
        _pause()
        return

    threading.Thread(target=_open_browser_when_ready, daemon=True).start()

    _seed_database_if_missing()

    from backend.main import app

    try:
        uvicorn.run(app, host=HOST, port=PORT, log_level="info")
    except Exception:
        import traceback

        traceback.print_exc()
        print("\nEME MESS crashed - see the error above.")
        _pause()


if __name__ == "__main__":
    main()
