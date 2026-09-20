# SpotiBase Backend - Quick Run
# Kept for compatibility; all secrets and database endpoints come from .env.

$runLocal = Join-Path $PSScriptRoot 'run-local.ps1'
& powershell -ExecutionPolicy Bypass -File $runLocal
