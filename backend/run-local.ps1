# Helper: run the SpotiBase backend locally with the repo .env loaded.
# Usage:  powershell -ExecutionPolicy Bypass -File backend\run-local.ps1
# The app is memory-constrained on dev machines, so Maven and the app JVM
# both get capped heaps (see notes in backend/README if it OOMs again).

$ErrorActionPreference = 'Stop'

$envFile = Join-Path $PSScriptRoot '..\.env'
if (-not (Test-Path $envFile)) {
    Write-Error "Missing $envFile - copy .env.example to .env first"
    exit 1
}

# Load KEY=VALUE lines from .env into the current process environment
# (values keep quotes stripped; comments/blank lines are skipped).
Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith('#') -and $line.Contains('=')) {
        $key, $value = $line -split '=', 2
        $key = $key.Trim()
        $value = $value.Trim().Trim('"').Trim("'")
        [Environment]::SetEnvironmentVariable($key, $value, 'Process')
    }
}

Write-Host "Loaded $envFile" -ForegroundColor Green

if (-not $env:SPRING_DATASOURCE_URL) {
    Write-Host ""
    Write-Host "Missing SPRING_DATASOURCE_URL in .env." -ForegroundColor Red
    Write-Host "For Supabase pooler, add a URL like:" -ForegroundColor Yellow
    Write-Host "SPRING_DATASOURCE_URL=jdbc:postgresql://<region>.pooler.supabase.com:6543/postgres?sslmode=require" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "This runner will not fall back to application.yml defaults because stale database defaults caused repeated startup failures." -ForegroundColor Yellow
    exit 1
}

if (-not $env:SPRING_DATASOURCE_USERNAME) {
    if ($env:SUPABASE_PROJECT_REF) {
        $env:SPRING_DATASOURCE_USERNAME = "postgres.$env:SUPABASE_PROJECT_REF"
        Write-Host "Derived SPRING_DATASOURCE_USERNAME for Supabase pooler." -ForegroundColor Green
    } else {
        Write-Host "Missing SPRING_DATASOURCE_USERNAME or SUPABASE_PROJECT_REF in .env." -ForegroundColor Red
        exit 1
    }
}

if (-not $env:SPRING_DATASOURCE_PASSWORD) {
    if ($env:SUPABASE_DB_PASSWORD) {
        $env:SPRING_DATASOURCE_PASSWORD = $env:SUPABASE_DB_PASSWORD
        Write-Host "Using SUPABASE_DB_PASSWORD for SPRING_DATASOURCE_PASSWORD." -ForegroundColor Green
    } else {
        Write-Host "Missing SPRING_DATASOURCE_PASSWORD or SUPABASE_DB_PASSWORD in .env." -ForegroundColor Red
        exit 1
    }
}

$psql = Get-Command psql -ErrorAction SilentlyContinue
if ($psql) {
    $jdbcPattern = '^jdbc:postgresql://(?<host>[^/:?]+)(:(?<port>\d+))?/(?<database>[^?]+)(\?(?<query>.*))?$'
    if ($env:SPRING_DATASOURCE_URL -match $jdbcPattern) {
        $hostName = $matches.host
        $port = if ($matches.port) { $matches.port } else { '5432' }
        $database = $matches.database
        $query = $matches.query
        $sslMode = 'prefer'
        if ($query -and $query -match '(^|&)sslmode=([^&]+)') {
            $sslMode = $matches[2]
        }

        Write-Host "Checking database credentials before Spring Boot starts..." -ForegroundColor Cyan
        $previousPgPassword = $env:PGPASSWORD
        $env:PGPASSWORD = $env:SPRING_DATASOURCE_PASSWORD
        try {
            $connection = "host=$hostName port=$port dbname=$database user=$env:SPRING_DATASOURCE_USERNAME sslmode=$sslMode"
            & $psql.Source $connection -q -t -c "select 1" 1>$null
            if ($LASTEXITCODE -ne 0) {
                Write-Host ""
                Write-Host "Database preflight failed. Check SPRING_DATASOURCE_URL, SPRING_DATASOURCE_USERNAME, and SPRING_DATASOURCE_PASSWORD in .env." -ForegroundColor Red
                Write-Host "The backend was not started, which avoids the repeated Spring/Flyway bean error cascade." -ForegroundColor Yellow
                exit 1
            }
        } finally {
            $env:PGPASSWORD = $previousPgPassword
        }
        Write-Host "Database credentials accepted." -ForegroundColor Green
    }
}

$env:MAVEN_OPTS = '-Xmx768m -XX:MaxMetaspaceSize=384m'
Push-Location (Join-Path $PSScriptRoot '.')
try {
    mvn "-Dmaven.test.skip=true" spring-boot:run "-Dspring-boot.run.jvmArguments=-Xmx512m" "-Dstyle.color=never"
} finally {
    Pop-Location
}
