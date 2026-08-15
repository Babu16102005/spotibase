@echo off
REM =============================================================================
REM SpotiBase Mobile - ONE CLICK DEV LAUNCHER (calls the PowerShell script)
REM =============================================================================

set "ROOT=%~dp0"
cd /d "%ROOT%"

echo =============================================================================
echo  SpotiBase Mobile - One Click Launcher
echo =============================================================================
echo.

REM Check if .env exists in repo root
if not exist "%ROOT%..\.env" (
    echo [WARN] Missing .env file in repo root
    echo Please copy .env.example to .env and configure it.
    echo.
)

REM Check if PowerShell script exists
if not exist "%ROOT%run-mobile.ps1" (
    echo [ERROR] Missing run-mobile.ps1
    pause
    exit /b 1
)

REM Pass all arguments to the PowerShell script
powershell -ExecutionPolicy Bypass -File "%ROOT%run-mobile.ps1" %*

echo.
echo Done. Press any key to close...
pause >nul