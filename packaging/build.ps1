# Rebuilds the EME MESS Windows installer end-to-end: frontend -> PyInstaller
# onedir bundle -> Inno Setup installer. Run from anywhere; paths are
# resolved relative to this script.
#
#   powershell -ExecutionPolicy Bypass -File packaging\build.ps1
#
# Output: packaging\output\EME-MESS-Setup-<version>.exe
# One-time setup (already done on this machine): the project's venv needs
# pyinstaller + pyinstaller-hooks-contrib, and Inno Setup 6 must be installed.

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$Venv = Join-Path $RepoRoot "backend\venv\Scripts"
$BuildDir = Join-Path $PSScriptRoot "_build"
$Iscc = "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"

Write-Host "==> [1/4] Verifying seed DB demo logins" -ForegroundColor Cyan
& "$Venv\python.exe" (Join-Path $PSScriptRoot "verify_seed_db.py")
if ($LASTEXITCODE -ne 0) { throw "Seed DB verification failed - see above. Fix packaging\seed_data\hotel_mess.db before building." }

Write-Host "==> [2/4] Building frontend (npm run build)" -ForegroundColor Cyan
Push-Location $RepoRoot
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
} finally {
    Pop-Location
}

Write-Host "==> [3/4] Building EME-MESS.exe with PyInstaller" -ForegroundColor Cyan
& "$Venv\python.exe" -m PyInstaller --noconfirm `
    --distpath "$BuildDir\dist" `
    --workpath "$BuildDir\work" `
    (Join-Path $PSScriptRoot "EME-MESS.spec")
if ($LASTEXITCODE -ne 0) { throw "PyInstaller build failed" }

Write-Host "==> [4/4] Compiling installer with Inno Setup" -ForegroundColor Cyan
if (-not (Test-Path $Iscc)) { throw "Inno Setup Compiler not found at $Iscc" }
& $Iscc (Join-Path $PSScriptRoot "installer.iss")
if ($LASTEXITCODE -ne 0) { throw "Inno Setup compile failed" }

Write-Host "`nDone. Installer is in packaging\output\" -ForegroundColor Green
Get-ChildItem (Join-Path $PSScriptRoot "output") -Filter "*.exe" | Select-Object Name, @{N="SizeMB";E={[math]::Round($_.Length/1MB,1)}}
