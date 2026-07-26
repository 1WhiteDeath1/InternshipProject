@echo off
setlocal enabledelayedexpansion
title SAM Hotel & Mess Management System - Launcher
cd /d "%~dp0"

echo ==========================================
echo  SAM Hotel ^& Mess Management System
echo  Starting backend + frontend...
echo ==========================================
echo.

REM --- Pick python: prefer the project venv, fall back to system python ---
set "PYTHON_EXE=%~dp0backend\venv\Scripts\python.exe"
if not exist "%PYTHON_EXE%" (
    set "PYTHON_EXE=python"
)

REM --- Refuse to start twice into the same ports ---
netstat -ano | findstr ":8000" | findstr "LISTENING" >nul
if %errorlevel%==0 (
    echo [!] Port 8000 is already in use - backend may already be running.
    echo     Close the existing SAM Backend window first if you want a clean restart.
    echo.
)
netstat -ano | findstr ":3000" | findstr "LISTENING" >nul
if %errorlevel%==0 (
    echo [!] Port 3000 is already in use - frontend may already be running.
    echo     Close the existing SAM Frontend window first if you want a clean restart.
    echo.
)

echo Launching backend (FastAPI/uvicorn) on port 8000...
start "SAM Backend" cmd /k ""%PYTHON_EXE%" -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload"

echo Waiting for backend to come up...
set "BACKEND_UP=0"
for /l %%i in (1,1,30) do (
    if "!BACKEND_UP!"=="0" (
        curl -s -o nul -w "%%{http_code}" http://127.0.0.1:8000/docs > "%TEMP%\sam_backend_check.txt" 2>nul
        set /p CODE=<"%TEMP%\sam_backend_check.txt"
        if "!CODE!"=="200" (
            set "BACKEND_UP=1"
        ) else (
            timeout /t 1 /nobreak >nul
        )
    )
)
del "%TEMP%\sam_backend_check.txt" >nul 2>&1

if "%BACKEND_UP%"=="1" (
    echo Backend is up.
) else (
    echo [!] Backend did not respond within 30s - check the "SAM Backend" window for errors.
)
echo.

echo Launching frontend (Vite dev server) on port 3000...
start "SAM Frontend" cmd /k "npm run dev"

echo Waiting for frontend to come up...
set "FRONTEND_UP=0"
for /l %%i in (1,1,30) do (
    if "!FRONTEND_UP!"=="0" (
        curl -s -o nul -w "%%{http_code}" http://127.0.0.1:3000 > "%TEMP%\sam_frontend_check.txt" 2>nul
        set /p CODE2=<"%TEMP%\sam_frontend_check.txt"
        if "!CODE2!"=="200" (
            set "FRONTEND_UP=1"
        ) else (
            timeout /t 1 /nobreak >nul
        )
    )
)
del "%TEMP%\sam_frontend_check.txt" >nul 2>&1

if "%FRONTEND_UP%"=="1" (
    echo Frontend is up.
    echo Opening browser...
    start "" http://localhost:3000
) else (
    echo [!] Frontend did not respond within 30s - check the "SAM Frontend" window for errors.
)

echo.
echo ==========================================
echo  SAM is starting in two separate windows:
echo    - "SAM Backend"  (FastAPI, port 8000)
echo    - "SAM Frontend" (Vite dev server, port 3000)
echo  Close this launcher window any time - it is
echo  not needed once both windows are open.
echo ==========================================
echo.
pause
