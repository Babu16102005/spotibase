# =============================================================================
# SpotiBase - ONE COMMAND PRODUCTION LAUNCHER
# Starts the production backend (Spring Boot jar on :8088) AND
# serves the production frontend (Expo web bundle on :3000).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File run-project.ps1          # start both
#   powershell -ExecutionPolicy Bypass -File run-project.ps1 -Stop    # stop both
#   powershell -ExecutionPolicy Bypass -File run-project.ps1 -SkipTests  # start without smoke tests
# =============================================================================

param(
    [switch]$Stop,
    [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$backendPort = 8088
$frontendPort = 3000

function Test-PortListening([int]$port) {
    $line = netstat -ano | Select-String "LISTENING" | Select-String ":$port "
    return ($null -ne $line)
}

# ---------------------------------------------------------------------------
# STOP MODE
# ---------------------------------------------------------------------------
if ($Stop) {
    Write-Host "`n=== Stopping SpotiBase production stack ===" -ForegroundColor Yellow

    $backendProc = Get-Process -ErrorAction SilentlyContinue |
        Where-Object { $_.ProcessName -eq 'java' -and $_.Id -eq (Get-Content "$root\backend\backend.pid" -ErrorAction SilentlyContinue) }
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

    $frontendProc = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*serve-frontend.js*' }
    foreach ($p in $frontendProc) {
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Host "  [OK] Frontend stopped (PID $($p.ProcessId))" -ForegroundColor Green
    }
    if (-not $frontendProc) {
        Write-Host "  [--] Frontend not running" -ForegroundColor Gray
    }

    Remove-Item "$root\backend\backend.pid" -ErrorAction SilentlyContinue
    Write-Host "`n=== Stack stopped ===" -ForegroundColor Green
    exit 0
}

# ---------------------------------------------------------------------------
# START MODE
# ---------------------------------------------------------------------------
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "  SpotiBase - Production Launcher" -ForegroundColor Cyan
Write-Host "  Backend  : http://localhost:$backendPort" -ForegroundColor Cyan
Write-Host "  Frontend : http://localhost:$frontendPort" -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan

# ---- 1. BACKEND -----------------------------------------------------------
if (Test-PortListening $backendPort) {
    Write-Host "`n[1/3] Backend ALREADY RUNNING on :$backendPort - skipping start" -ForegroundColor Green
} else {
    Write-Host "`n[1/3] Starting production backend on :$backendPort ..." -ForegroundColor Yellow
    if (-not (Test-Path "$root\backend\target\spotibase-backend-1.0.0.jar")) {
        Write-Host "  Building production jar..." -ForegroundColor Yellow
        Push-Location "$root\backend"
        try { mvn clean package -DskipTests -B "-Dstyle.color=never" | Out-Null } finally { Pop-Location }
    }
    & powershell -ExecutionPolicy Bypass -File "$root\backend\run-prod.ps1"

    Write-Host "  Waiting for backend health..." -ForegroundColor Yellow
    $healthy = $false
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Seconds 2
        try {
            $h = Invoke-WebRequest -Uri "http://localhost:$backendPort/actuator/health" -UseBasicParsing -TimeoutSec 5
            if ($h.StatusCode -eq 200) { $healthy = $true; break }
        } catch { }
    }
    if (-not $healthy) {
        Write-Host "  [FAIL] Backend did not become healthy. Check backend\prod_stdout.log" -ForegroundColor Red
        exit 1
    }
    Write-Host "  [OK] Backend healthy - http://localhost:$backendPort" -ForegroundColor Green
}

# ---- 2. FRONTEND ----------------------------------------------------------
if (Test-PortListening $frontendPort) {
    Write-Host "`n[2/3] Frontend ALREADY RUNNING on :$frontendPort - skipping start" -ForegroundColor Green
} else {
    Write-Host "`n[2/3] Starting production frontend on :$frontendPort ..." -ForegroundColor Yellow
    if (-not (Test-Path "$root\mobile\dist-prod\index.html")) {
        Write-Host "  Building frontend web bundle (expo export)..." -ForegroundColor Yellow
        Push-Location "$root\mobile"
        try { npx expo export --platform web --output-dir dist-prod 2>&1 | Select-Object -Last 3 } finally { Pop-Location }
    }
    $fproc = Start-Process -FilePath "node" `
        -ArgumentList @("$root\serve-frontend.js", "$frontendPort") `
        -WorkingDirectory $root `
        -RedirectStandardOutput "$root\frontend_stdout.log" `
        -RedirectStandardError "$root\frontend_stderr.log" `
        -PassThru -NoNewWindow
    Start-Sleep -Seconds 3
    try {
        $f = Invoke-WebRequest -Uri "http://localhost:$frontendPort" -UseBasicParsing -TimeoutSec 5
        if ($f.StatusCode -eq 200) {
            Write-Host "  [OK] Frontend serving - http://localhost:$frontendPort (PID $($fproc.Id))" -ForegroundColor Green
        }
    } catch {
        Write-Host "  [FAIL] Frontend not reachable. Check frontend_stderr.log" -ForegroundColor Red
    }
}

# ---- 3. VERIFY ------------------------------------------------------------
Write-Host "`n[3/3] Running production verification (48 smoke tests)..." -ForegroundColor Yellow
if ($SkipTests) {
    Write-Host "  Skipped (-SkipTests)" -ForegroundColor Gray
} else {
    & powershell -ExecutionPolicy Bypass -File "$root\tests\prod-smoke-tests.ps1"
}

Write-Host "`n==============================================" -ForegroundColor Cyan
Write-Host "  SpotiBase is RUNNING IN PRODUCTION" -ForegroundColor Green
Write-Host "    Frontend : http://localhost:$frontendPort" -ForegroundColor Cyan
Write-Host "    Backend  : http://localhost:$backendPort" -ForegroundColor Cyan
Write-Host "    API Docs : http://localhost:$backendPort/swagger-ui/index.html" -ForegroundColor Cyan
Write-Host "    Health   : http://localhost:$backendPort/actuator/health" -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan