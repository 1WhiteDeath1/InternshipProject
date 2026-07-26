@echo off
setlocal
cd /d "%~dp0"

echo Creating a desktop shortcut for "Start SAM.bat"...

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ws = New-Object -ComObject WScript.Shell;" ^
    "$link = $ws.CreateShortcut((Join-Path $ws.SpecialFolders('Desktop') 'Start SAM.lnk'));" ^
    "$link.TargetPath = (Join-Path '%~dp0' 'Start SAM.bat');" ^
    "$link.WorkingDirectory = '%~dp0';" ^
    "$link.WindowStyle = 1;" ^
    "$link.Description = 'Start the SAM Hotel and Mess Management System';" ^
    "$link.Save()"

if %errorlevel%==0 (
    echo Done. Look for "Start SAM" on your Desktop.
) else (
    echo [!] Something went wrong creating the shortcut.
)
echo.
pause
