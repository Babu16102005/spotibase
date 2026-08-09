# SpotiBase Backend - Quick Run
Set-Location $PSScriptRoot

$env:SERVER_PORT="8088"
# Supabase direct connection hosts (db.<ref>.supabase.co) are IPv6-only.
# This machine has no IPv6 route, so we use the IPv4 pooler (session mode, port 6543).
$env:SPRING_DATASOURCE_URL="jdbc:postgresql://aws-1-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=require"
$env:SPRING_DATASOURCE_USERNAME="postgres.dpyzyeoyeuajtmkqmase"
$env:SPRING_DATASOURCE_PASSWORD="sathishbabu16102005"
$env:SUPABASE_PROJECT_REF="dpyzyeoyeuajtmkqmase"
$env:SUPABASE_DB_PASSWORD="sathishbabu16102005"
$env:SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRweXp5ZW95ZXVhanRta3FtYXNlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyMjQ0MDksImV4cCI6MjEwMDgwMDQwOX0.FZw_vKTPxf97kkkw_qpAv1r1JVd_heBoqfYhv8Aa86g"
$env:SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRweXp5ZW95ZXVhanRta3FtYXNlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTIyNDQwOSwiZXhwIjoyMTAwODAwNDA5fQ.uIn5HVNcfec6VsMAgUvLL3XwseL8hl-Y_OPH7yY-XAc"
$env:SUPABASE_JWT_SECRET="P3kTbzjIWmP8wQluYrMMrCVD7X+lCSg54F0u9aTQOAHX3NYa4ESVRQ8h4eW7ck+iQYIIa0ZWvpI+jLcUChq2lA=="
$env:REDIS_HOST="localhost"
$env:REDIS_PORT="6379"
$env:OPENAI_API_KEY="sk-placeholder"
$env:SMTP_USERNAME="placeholder"
$env:SMTP_PASSWORD="placeholder"

Write-Host "Starting SpotiBase Backend..." -ForegroundColor Green
Write-Host "Connecting via Supabase IPv4 pooler (session mode)..." -ForegroundColor Yellow
mvn spring-boot:run
