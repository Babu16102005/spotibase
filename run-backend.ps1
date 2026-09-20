# run-backend.ps1
# Runs the SpotiBase Spring Boot backend loading all secrets from .env
# Usage: .\run-backend.ps1  (from any directory in the project)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $scriptDir ".env"
$backendPom = Join-Path $scriptDir "backend\pom.xml"

if (-not (Test-Path $envFile)) {
    Write-Error ".env file not found at $envFile"
    exit 1
}

Write-Host "Starting backend via backend\run-local.ps1 ..." -ForegroundColor Green

$runLocal = Join-Path $scriptDir "backend\run-local.ps1"
& powershell -ExecutionPolicy Bypass -File $runLocal
