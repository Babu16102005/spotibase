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

$env:MAVEN_OPTS = '-Xmx768m -XX:MaxMetaspaceSize=384m'
Push-Location (Join-Path $PSScriptRoot '.')
try {
    mvn spring-boot:run "-Dspring-boot.run.jvmArguments=-Xmx512m" "-Dstyle.color=never"
} finally {
    Pop-Location
}
