# =============================================================================
# SpotiBase Mobile - ONE CLICK DEV LAUNCHER
# Starts the backend (Spring Boot on :8088) AND
# Expo dev server for mobile (iOS/Android/Web)
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File mobile\run-mobile.ps1          # start both
#   powershell -ExecutionPolicy Bypass -File mobile\run-mobile.ps1 -Stop    # stop both
#   powershell -ExecutionPolicy Bypass -File mobile\run-mobile.ps1 -NoBackend  # only Expo
# =============================================================================

param(
    [switch]$Stop,
    [switch]$NoBackend
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$repoRoot = Split-Path $root -Parent
$backendPort = 8088

function Test-PortListening([int]$port) {
    $line = netstat -ano | Select-String "LISTENING" | Select-String ":$port "
    return ($null -ne $line)
}

# ---------------------------------------------------------------------------
# STOP MODE
# ---------------------------------------------------------------------------
if ($Stop) {
    Write-Host "`n=== Stopping SpotiBase mobile dev stack ===" -ForegroundColor Yellow

    # Stop backend
    if (-not $NoBackend) {
        $backendProc = Get-Process -ErrorAction SilentlyContinue |
            Where-Object { $_.ProcessName -eq 'java' -and $_.Id -eq (Get-Content "$repoRoot\backend\backend.pid" -ErrorAction SilentlyContinue) }
        if ($backendProc) {
            Stop-Process -Id $backendProc.Id -Force
            Write-Host "  [OK] Backend stopped (PID $($backendProc.Id))" -ForegroundColor Green
        } elseif (Test-PortListening $backendPort) {
            $pidOnPort = (netstat -ano | Select-String "LISTENING" | Select-String ":$backendPort " | ForEach-Object { ($_.Line -split '\s+')[-1] } | Select-Object -First 1)
            Stop-Process -Id $pidOnPort -Force -ErrorAction SilentlyContinue
            Write-Host "  [OK] Backend stopped (PID $pidOnPort on :$backendPort)" -ForegroundColor Green
        } else {
            Write-Host "  [--] Backend not running" -ForegroundColor Gray
        }
    }

    # Stop Expo
    $expoProc = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq 'node.exe' -and ($_.CommandLine -like '*expo*') }
    foreach ($p in $expoProc) {
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Host "  [OK] Expo stopped (PID $($p.ProcessId))" -ForegroundColor Green
    }
    if (-not $expoProc) {
        Write-Host "  [--] Expo not running" -ForegroundColor Gray
    }

    Remove-Item "$repoRoot\backend\backend.pid" -ErrorAction SilentlyContinue
    Write-Host "`n=== Mobile dev stack stopped ===" -ForegroundColor Green
    exit 0
}

# ---------------------------------------------------------------------------
# START MODE
# ---------------------------------------------------------------------------
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "  SpotiBase Mobile - Dev Launcher" -ForegroundColor Cyan
Write-Host "  Backend : http://localhost:$backendPort" -ForegroundColor Cyan
Write-Host "  Expo    : will show QR code for device/simulator" -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan

# ---- 1. BACKEND -----------------------------------------------------------
if (-not $NoBackend) {
    if (Test-PortListening $backendPort) {
        Write-Host "`n[1/2] Backend ALREADY RUNNING on :$backendPort - skipping start" -ForegroundColor Green
    } else {
        Write-Host "`n[1/2] Starting dev backend on :$backendPort ..." -ForegroundColor Yellow
        Push-Location "$repoRoot\backend"
        try {
            & powershell -ExecutionPolicy Bypass -File "$repoRoot\backend\run-local.ps1"
            Write-Host "  [OK] Backend started - http://localhost:$backendPort" -ForegroundColor Green
        } finally {
            Pop-Location
        }
    }
} else {
    Write-Host "`n[1/2] Skipping backend (-NoBackend)" -ForegroundColor Gray
}

# ---- 2. EXPO --------------------------------------------------------------
Write-Host "`n[2/2] Starting Expo dev server..." -ForegroundColor Yellow

# Check .env
if (-not (Test-Path "$repoRoot\.env")) {
    Write-Host "  [WARN] .env not found. Copy .env.example to .env if needed." -ForegroundColor Yellow
}

Push-Location $root
try {
    # This blocks and shows QR code — press 'w' for web, 'a' for Android, 'i' for iOS
    npx expo start --clear
} finally {
    Pop-Location
}

Write-Host "`n==============================================" -ForegroundColor Cyan
Write-Host "  Expo dev server exited" -ForegroundColor Yellow
Write-Host "==============================================" -ForegroundColor Cyan