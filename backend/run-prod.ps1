# SpotiBase Backend - Production Run
# Starts the packaged jar with production configuration against the Supabase DB.
# Usage:  powershell -ExecutionPolicy Bypass -File backend\run-prod.ps1
# Logs:   backend\prod_stdout.log / backend\prod_stderr.log
# PID:    backend\backend.pid

$ErrorActionPreference = 'Stop'
$scriptDir = $PSScriptRoot
$envFile = Join-Path $PSScriptRoot '..\.env'

if (-not (Test-Path $envFile)) {
    Write-Error "Missing $envFile"
    exit 1
}

if (-not (Test-Path (Join-Path $scriptDir 'target\spotibase-backend-1.0.0.jar'))) {
    Write-Error "Production jar missing - run: mvn clean package -DskipTests"
    exit 1
}

# ---- Load .env into process environment ----
Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith('#') -and $line.Contains('=')) {
        $key, $value = $line -split '=', 2
        $key = $key.Trim()
        $value = $value.Trim().Trim('"').Trim("'")
        [Environment]::SetEnvironmentVariable($key, $value, 'Process')
    }
}

# ---- Production JVM settings ----
# Port 8088 matches APP_BASE_URL in .env (port 8080 is occupied by local Apache)
$env:SERVER_PORT = "8088"
$env:SPRING_PROFILES_ACTIVE = "prod"
# Production logging level
$env:LOGGING_LEVEL_COM_SPOTIBASE = "INFO"
$env:SPRING_JPA_SHOW_SQL = "false"

$stdout = Join-Path $scriptDir 'prod_stdout.log'
$stderr = Join-Path $scriptDir 'prod_stderr.log'

Write-Host "Starting SpotiBase Backend (PRODUCTION)..." -ForegroundColor Green
Write-Host "  JAR:    $($scriptDir)\target\spotibase-backend-1.0.0.jar"
Write-Host "  Port:   $env:SERVER_PORT"
Write-Host "  DB:     $env:SPRING_DATASOURCE_URL"

$proc = Start-Process -FilePath "java" `
    -ArgumentList @(
        "-Xms512m", "-Xmx1024m",
        "-jar", (Join-Path $scriptDir 'target\spotibase-backend-1.0.0.jar')
    ) `
    -WorkingDirectory $scriptDir `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -PassThru -NoNewWindow

Set-Content -Path (Join-Path $scriptDir 'backend.pid') -Value $proc.Id
Write-Host "Started PID $($proc.Id) - logs: backend\prod_stdout.log / backend\prod_stderr.log"