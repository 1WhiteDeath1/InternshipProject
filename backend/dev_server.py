"""Dev-only entrypoint for the local preview harness, which assigns a free
port per session via the PORT env var instead of the fixed 8000 the
start.bat/start.sh scripts use. Publishes the bound port to a well-known temp
file so vite.config.ts's proxy (a separately-launched process) can find it."""
import os
import tempfile
import uvicorn

PORT_FILE = os.path.join(tempfile.gettempdir(), "hotel-mess-dev-backend-port.txt")

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    with open(PORT_FILE, "w") as f:
        f.write(str(port))
    uvicorn.run("backend.main:app", host="0.0.0.0", port=port, reload=False)
