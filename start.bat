@echo off
echo ==========================================
echo  SAM Hotel ^& Mess Management System
echo ==========================================
echo Starting server...
echo.
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
echo.
echo Server stopped. Press any key to exit.
pause > nul
