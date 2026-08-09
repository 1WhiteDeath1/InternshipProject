"""Entry point for the packaged EME-MESS.exe (built via PyInstaller).

Boots the same FastAPI app used in dev (backend.main:app), listening on
every network interface (BIND_HOST) so other PCs/tablets on the same LAN
(Booking desk, Kitchen, Clerk desk, etc.) can reach it at
http://<this-PC's-LAN-IP>:8000 - not just the machine it's installed on.
Windows Firewall will likely prompt to allow this the first time it runs;
that prompt must be accepted (Allow on Private networks) for other devices
to connect. Opens the local machine's own browser to localhost once the
server is accepting connections. Kept as a console app (not windowed) on
purpose: a tester hitting an error should see the traceback instead of a
silently-dead process.
"""
import shutil
import socket
import sys
import threading
import time
import webbrowser
from pathlib import Path

import uvicorn

BIND_HOST = "0.0.0.0"  # listen on every interface, so other LAN devices can connect
LOCAL_HOST = "127.0.0.1"  # for this machine's own port-check / browser tab
PORT = 8000


def _port_is_free(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex((host, port)) != 0


def _local_lan_ip() -> str | None:
    """Best-effort LAN IP for this machine, so the console can print the URL
    other devices should use. No packet is actually sent - connect() on a UDP
    socket just picks the outbound interface/address for that route."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except OSError:
        return None


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
        if not _port_is_free(LOCAL_HOST, PORT):
            webbrowser.open(f"http://{LOCAL_HOST}:{PORT}")
            lan_ip = _local_lan_ip()
            if lan_ip:
                print(f"\nOther devices on this network can connect at: http://{lan_ip}:{PORT}")
            return
        time.sleep(0.5)


def main() -> None:
    print("EME MESS - starting up...")

    if not _port_is_free(LOCAL_HOST, PORT):
        print(f"\nPort {PORT} is already in use.")
        print("EME MESS may already be running - check your taskbar, or close")
        print("whatever else is using that port, then try again.")
        _pause()
        return

    threading.Thread(target=_open_browser_when_ready, daemon=True).start()

    # Everything below - seeding, and importing backend.main (which runs
    # Base.metadata.create_all() + every domain's migrations at import time,
    # not inside a FastAPI startup event) - used to run outside this
    # try/except. Any exception there crashed the process before uvicorn.run
    # was ever reached, and since a double-clicked console app's window
    # closes the instant the process exits, the traceback vanished with it -
    # "the window just closes" with no way to see why. Wrapping the whole
    # thing guarantees _pause() always runs first.
    try:
        _seed_database_if_missing()

        from backend.main import app

        uvicorn.run(app, host=BIND_HOST, port=PORT, log_level="info")
    except Exception:
        import traceback

        traceback.print_exc()
        print("\nEME MESS crashed - see the error above.")
        _pause()


if __name__ == "__main__":
    main()
