@echo off
REM =============================================================================
REM SpotiBase - ONE CLICK LAUNCHER (calls the PowerShell script)
REM =============================================================================

set "ROOT=%~dp0"

echo =============================================================================
echo  SpotiBase - One Click Launcher
echo =============================================================================
echo.

REM Check if .env exists
if not exist "%ROOT%.env" (
    echo [ERROR] Missing .env file
    echo Please copy .env.example to .env and configure it.
    pause
    exit /b 1
)

REM Check if PowerShell script exists
if not exist "%ROOT%run-project.ps1" (
    echo [ERROR] Missing run-project.ps1
    pause
    exit /b 1
)

REM Pass all arguments to the PowerShell script
powershell -ExecutionPolicy Bypass -File "%ROOT%run-project.ps1" %*

echo.
echo Done. Press any key to close...
pause >nul