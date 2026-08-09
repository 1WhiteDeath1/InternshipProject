# -*- mode: python ; coding: utf-8 -*-
# Build with (from repo root, using the project's own venv):
#   backend\venv\Scripts\python.exe -m PyInstaller --noconfirm packaging\EME-MESS.spec
# See packaging/build.ps1 for the full rebuild pipeline (frontend + this + installer).
import os
from PyInstaller.utils.hooks import collect_all, collect_submodules

REPO_ROOT = os.path.abspath(os.path.join(SPECPATH, ".."))

datas = [
    (os.path.join(REPO_ROOT, "dist"), "dist"),
    (os.path.join(REPO_ROOT, "packaging", "seed_data", "hotel_mess.db"), "seed_data"),
]
binaries = []
hiddenimports = [
    "passlib.handlers.bcrypt",
    "jose.backends.cryptography_backend",
    "uvicorn.logging",
    "uvicorn.loops.auto",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan.on",
    "multipart",
]
hiddenimports += collect_submodules("backend")

# These ship data files (ONNX models, native DLLs, font/encoding tables) and
# lazy-loaded submodules that PyInstaller's static import scan won't find on
# its own. reportlab in particular loads its font/encoding modules (used by
# the invoice QR code, backend/routers/billing.py's _invoice_qr_svg) via
# dynamic imports at runtime, not plain `import` statements - without this,
# every invoice-printing action 500s in the packaged exe despite working
# fine from a normal venv in dev.
for pkg in ("rapidocr_onnxruntime", "onnxruntime", "cv2", "reportlab"):
    pkg_datas, pkg_binaries, pkg_hidden = collect_all(pkg)
    datas += pkg_datas
    binaries += pkg_binaries
    hiddenimports += pkg_hidden

a = Analysis(
    [os.path.join(REPO_ROOT, "packaging", "launcher.py")],
    pathex=[REPO_ROOT],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="EME-MESS",
    console=True,
    disable_windowed_traceback=False,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    name="EME-MESS",
)
