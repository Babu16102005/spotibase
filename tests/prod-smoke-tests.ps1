# =============================================================================
# SpotiBase Production Smoke Test Suite
# Runs against the LIVE production backend (http://localhost:8088)
# Verified against SecurityConfig: only auth/health/swagger/stream/suggestions/
# trending/featured endpoints are public - everything else requires a JWT.
# Usage: powershell -ExecutionPolicy Bypass -File tests\prod-smoke-tests.ps1
# =============================================================================
param(
    [string]$BaseUrl = "http://localhost:8088",
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
$script:Passed = 0
$script:Failed = 0
$script:Failures = @()

function Test-Case {
    param([string]$Name, [scriptblock]$Block)
    try {
        & $Block | Out-Null
        $script:Passed++
        if (-not $Quiet) { Write-Host "  [PASS] $Name" -ForegroundColor Green }
    } catch {
        $script:Failed++
        $script:Failures += "[FAIL] $Name - $($_.Exception.Message)"
        if (-not $Quiet) { Write-Host "  [FAIL] $Name - $($_.Exception.Message)" -ForegroundColor Red }
    }
}

function Invoke-Api {
    param(
        [string]$Method = "GET",
        [string]$Path,
        $Body = $null,
        [string]$Token = $null
    )
    $headers = @{}
    if ($Token) { $headers["Authorization"] = "Bearer $Token" }
    $params = @{
        Uri = "$BaseUrl$Path"
        Method = $Method
        UseBasicParsing = $true
        TimeoutSec = 30
        Headers = $headers
    }
    if ($null -ne $Body) {
        $params["ContentType"] = "application/json"
        $params["Body"] = ($Body | ConvertTo-Json -Depth 10)
    }
    Invoke-WebRequest @params
}

function Get-JsonContent {
    param($Response)
    $content = $Response.Content
    # PS 5.1 Invoke-WebRequest sometimes returns JSON bodies as byte[]
    if ($content -is [byte[]]) {
        $content = [System.Text.Encoding]::UTF8.GetString($content)
    }
    ($content | ConvertFrom-Json)
}

function Get-ErrorStatus {
    param($Exception)
    if ($Exception.Exception.Response) {
        return [int]$Exception.Exception.Response.StatusCode
    }
    return -1
}

Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "  SpotiBase Production Smoke Tests" -ForegroundColor Cyan
Write-Host "  Target: $BaseUrl" -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan

# -----------------------------------------------------------------------------
# 1. HEALTH & INFRASTRUCTURE (public endpoints)
# -----------------------------------------------------------------------------
Write-Host "`n[1] Health & Infrastructure" -ForegroundColor Yellow

Test-Case "GET /actuator/health returns UP (public)" {
    $r = Invoke-Api -Path "/actuator/health"
    if ($r.StatusCode -ne 200) { throw "Expected HTTP 200, got $($r.StatusCode)" }
    $body = Get-JsonContent $r
    if ($body.status -ne "UP") { throw "Expected status UP, got '$($body.status)'" }
}

Test-Case "GET /actuator/info is secured (403 for anonymous)" {
    try {
        Invoke-Api -Path "/actuator/info" | Out-Null
        throw "Expected 403, got 200"
    } catch {
        $status = Get-ErrorStatus $_
        if ($status -notin @(401, 403)) { throw "Expected 401/403, got $status" }
    }
}

Test-Case "GET /swagger-ui/index.html reachable (public)" {
    $r = Invoke-Api -Path "/swagger-ui/index.html"
    if ($r.StatusCode -ne 200) { throw "Expected HTTP 200, got $($r.StatusCode)" }
}

Test-Case "GET /api-docs exposes 50+ endpoints (public)" {
    $r = Invoke-Api -Path "/api-docs"
    $json = Get-JsonContent $r
    $count = @($json.paths.PSObject.Properties).Count
    if ($count -lt 50) { throw "Expected 50+ endpoints, got $count" }
}

# -----------------------------------------------------------------------------
# 2. PUBLIC CONTENT ENDPOINTS (per SecurityConfig permitAll)
# -----------------------------------------------------------------------------
Write-Host "`n[2] Public Content Endpoints" -ForegroundColor Yellow

Test-Case "GET /api/v1/search/suggestions (public, no auth)" {
    $r = Invoke-Api -Path "/api/v1/search/suggestions?query=love"
    if ($r.StatusCode -ne 200) { throw "Expected 200, got $($r.StatusCode)" }
}

Test-Case "GET /api/v1/search/trending (public, no auth)" {
    $r = Invoke-Api -Path "/api/v1/search/trending"
    if ($r.StatusCode -ne 200) { throw "Expected 200, got $($r.StatusCode)" }
}

Test-Case "GET /api/v1/playlists/featured (public, no auth)" {
    $r = Invoke-Api -Path "/api/v1/playlists/featured"
    if ($r.StatusCode -ne 200) { throw "Expected 200, got $($r.StatusCode)" }
}

Test-Case "GET /api/v1/songs/stream is PUBLIC (permitAll per SecurityConfig)" {
    $r = Invoke-Api -Path "/api/v1/songs/00000000-0000-0000-0000-000000000000/stream"
    # Endpoint is public by design; a real HTTP response (any of 200/302/404) proves
    # the permitAll rule works without auth (an auth-required endpoint would give 403).
    if ($r.StatusCode -notin @(200, 201, 302, 404)) {
        throw "Expected public access (2xx/302/404), got $($r.StatusCode)"
    }
}

Test-Case "GET /api/v1/home WITHOUT token is blocked (403/401)" {
    try {
        Invoke-Api -Path "/api/v1/home" | Out-Null
        throw "Expected 403 but request succeeded"
    } catch {
        $status = Get-ErrorStatus $_
        if ($status -notin @(401, 403)) { throw "Expected 401/403, got $status" }
    }
}

# -----------------------------------------------------------------------------
# 3. AUTHENTICATION FLOW (register -> login -> refresh -> me)
# -----------------------------------------------------------------------------
Write-Host "`n[3] Authentication Flow" -ForegroundColor Yellow

$testSuffix = Get-Date -Format "HHmmss"
$testEmail = "smoketest.$testSuffix@example.com"
$testUsername = "smoketest_$testSuffix"
$testPassword = "SmokeTest!2026"

Test-Case "POST /api/v1/auth/register creates account" {
    $r = Invoke-Api -Method "POST" -Path "/api/v1/auth/register" -Body @{
        email = $testEmail
        username = $testUsername
        password = $testPassword
    }
    if ($r.StatusCode -notin @(200, 201)) { throw "Expected 200/201, got $($r.StatusCode)" }
    $body = Get-JsonContent $r
    if (-not $body.accessToken) { throw "No access token returned" }
    $script:AccessToken = $body.accessToken
}

Test-Case "POST /api/v1/auth/login returns token pair" {
    $r = Invoke-Api -Method "POST" -Path "/api/v1/auth/login" -Body @{
        email = $testEmail
        password = $testPassword
    }
    if ($r.StatusCode -ne 200) { throw "Expected 200, got $($r.StatusCode)" }
    $body = Get-JsonContent $r
    if (-not $body.accessToken) { throw "No access token" }
    if (-not $body.refreshToken) { throw "No refresh token" }
    $script:AccessToken = $body.accessToken
    $script:RefreshToken = $body.refreshToken
}

Test-Case "POST /api/v1/auth/login rejects wrong password (401)" {
    try {
        Invoke-Api -Method "POST" -Path "/api/v1/auth/login" -Body @{
            email = $testEmail
            password = "WrongPassword!"
        } | Out-Null
        throw "Expected 401 but request succeeded"
    } catch {
        $status = Get-ErrorStatus $_
        if ($status -ne 401) { throw "Expected 401, got $status" }
    }
}

Test-Case "POST /api/v1/auth/refresh returns new token pair" {
    $r = Invoke-Api -Method "POST" -Path "/api/v1/auth/refresh" -Body @{
        refreshToken = $script:RefreshToken
    }
    if ($r.StatusCode -ne 200) { throw "Expected 200, got $($r.StatusCode)" }
    $body = Get-JsonContent $r
    if (-not $body.accessToken) { throw "No new access token" }
    $script:AccessToken = $body.accessToken
}

Test-Case "GET /api/v1/users/me returns profile with token" {
    $r = Invoke-Api -Path "/api/v1/users/me" -Token $script:AccessToken
    if ($r.StatusCode -ne 200) { throw "Expected 200, got $($r.StatusCode)" }
    $body = Get-JsonContent $r
    if ($body.email -ne $testEmail) { throw "Email mismatch: $($body.email) vs $testEmail" }
}

Test-Case "GET /api/v1/users/me WITHOUT token is 401/403" {
    try {
        Invoke-Api -Path "/api/v1/users/me" | Out-Null
        throw "Expected 401/403 but request succeeded"
    } catch {
        $status = Get-ErrorStatus $_
        if ($status -notin @(401, 403)) { throw "Expected 401/403, got $status" }
    }
}

Test-Case "GET /api/v1/users/me with GARBAGE token is 401/403" {
    try {
        Invoke-Api -Path "/api/v1/users/me" -Token "not.a.valid.jwt" | Out-Null
        throw "Expected 401/403 but request succeeded"
    } catch {
        $status = Get-ErrorStatus $_
        if ($status -notin @(401, 403)) { throw "Expected 401/403, got $status" }
    }
}

# -----------------------------------------------------------------------------
# 4. AUTHENTICATED CONTENT + CORE FLOWS
# -----------------------------------------------------------------------------
Write-Host "`n[4] Authenticated Content & Core Flows" -ForegroundColor Yellow

$authedContent = @(
    @{ Name = "GET /api/v1/home"; Path = "/api/v1/home" },
    @{ Name = "GET /api/v1/songs"; Path = "/api/v1/songs" },
    @{ Name = "GET /api/v1/songs/trending"; Path = "/api/v1/songs/trending" },
    @{ Name = "GET /api/v1/songs/new-releases"; Path = "/api/v1/songs/new-releases" },
    @{ Name = "GET /api/v1/songs/featured"; Path = "/api/v1/songs/featured" },
    @{ Name = "GET /api/v1/artists"; Path = "/api/v1/artists" },
    @{ Name = "GET /api/v1/artists/top"; Path = "/api/v1/artists/top" },
    @{ Name = "GET /api/v1/artists/featured"; Path = "/api/v1/artists/featured" },
    @{ Name = "GET /api/v1/albums"; Path = "/api/v1/albums" },
    @{ Name = "GET /api/v1/albums/new-releases"; Path = "/api/v1/albums/new-releases" },
    @{ Name = "GET /api/v1/albums/featured"; Path = "/api/v1/albums/featured" },
    @{ Name = "GET /api/v1/search?query=love"; Path = "/api/v1/search?query=love" },
    @{ Name = "GET /api/v1/library"; Path = "/api/v1/library" },
    @{ Name = "GET /api/v1/library/recent"; Path = "/api/v1/library/recent" },
    @{ Name = "GET /api/v1/library/liked-songs"; Path = "/api/v1/library/liked-songs" },
    @{ Name = "GET /api/v1/library/history"; Path = "/api/v1/library/history" },
    @{ Name = "GET /api/v1/library/artists"; Path = "/api/v1/library/artists" },
    @{ Name = "GET /api/v1/library/albums"; Path = "/api/v1/library/albums" },
    @{ Name = "GET /api/v1/settings"; Path = "/api/v1/settings" },
    @{ Name = "GET /api/v1/notifications"; Path = "/api/v1/notifications" },
    @{ Name = "GET /api/v1/notifications/unread-count"; Path = "/api/v1/notifications/unread-count" },
    @{ Name = "GET /api/v1/queue"; Path = "/api/v1/queue" }
)

foreach ($ep in $authedContent) {
    Test-Case "$($ep.Name) (with token)" {
        $r = Invoke-Api -Path $ep.Path -Token $script:AccessToken
        if ($r.StatusCode -ne 200) { throw "Expected 200, got $($r.StatusCode)" }
    }
}

Test-Case "POST /api/v1/playlists creates playlist" {
    $r = Invoke-Api -Method "POST" -Path "/api/v1/playlists" -Token $script:AccessToken -Body @{
        name = "Smoke Test Playlist $testSuffix"
        description = "Created by production smoke tests"
    }
    if ($r.StatusCode -notin @(200, 201)) { throw "Expected 200/201, got $($r.StatusCode)" }
    $body = Get-JsonContent $r
    if (-not $body.id) { throw "No playlist id returned" }
    $script:PlaylistId = $body.id
}

Test-Case "GET /api/v1/playlists/{id} returns created playlist" {
    $r = Invoke-Api -Path "/api/v1/playlists/$($script:PlaylistId)" -Token $script:AccessToken
    if ($r.StatusCode -ne 200) { throw "Expected 200, got $($r.StatusCode)" }
    $body = Get-JsonContent $r
    if ($body.id -ne $script:PlaylistId) { throw "Playlist id mismatch" }
}

Test-Case "GET /api/v1/library/playlists includes created playlist" {
    $r = Invoke-Api -Path "/api/v1/library/playlists" -Token $script:AccessToken
    if ($r.StatusCode -ne 200) { throw "Expected 200, got $($r.StatusCode)" }
    if ($r.Content -notmatch [regex]::Escape("Smoke Test Playlist $testSuffix")) {
        throw "Playlist not found in library"
    }
}

Test-Case "PUT /api/v1/settings/theme updates theme" {
    $r = Invoke-Api -Method "PUT" -Path "/api/v1/settings/theme" -Token $script:AccessToken -Body @{
        darkMode = $true
    }
    if ($r.StatusCode -notin @(200, 201)) { throw "Expected 200, got $($r.StatusCode)" }
}

# -----------------------------------------------------------------------------
# 5. ERROR HANDLING & SECURITY EDGE CASES
# -----------------------------------------------------------------------------
Write-Host "`n[5] Error Handling & Security Edge Cases" -ForegroundColor Yellow

Test-Case "GET /api/v1/songs/999999 (nonexistent, authed) returns 404" {
    try {
        Invoke-Api -Path "/api/v1/songs/999999" -Token $script:AccessToken | Out-Null
        throw "Expected 404 but request succeeded"
    } catch {
        $status = Get-ErrorStatus $_
        if ($status -ne 404) { throw "Expected 404, got $status" }
    }
}

Test-Case "POST /api/v1/auth/register duplicate email rejected (4xx)" {
    try {
        Invoke-Api -Method "POST" -Path "/api/v1/auth/register" -Body @{
            email = $testEmail
            username = "duplicateuser_$testSuffix"
            password = "AnotherPass!123"
        } | Out-Null
        throw "Expected 4xx but request succeeded"
    } catch {
        $status = Get-ErrorStatus $_
        if ($status -lt 400 -or $status -ge 500) { throw "Expected 4xx, got $status" }
    }
}

Test-Case "POST /api/v1/auth/register invalid email rejected (400 validation)" {
    try {
        Invoke-Api -Method "POST" -Path "/api/v1/auth/register" -Body @{
            email = "not-an-email"
            username = "invaliduser_$testSuffix"
            password = "short"
        } | Out-Null
        throw "Expected 400 but request succeeded"
    } catch {
        $status = Get-ErrorStatus $_
        if ($status -ne 400) { throw "Expected 400, got $status" }
    }
}

Test-Case "Admin endpoints blocked for regular user (401/403)" {
    try {
        Invoke-Api -Path "/api/v1/admin/dashboard" -Token $script:AccessToken | Out-Null
        throw "Expected 401/403 but request succeeded"
    } catch {
        $status = Get-ErrorStatus $_
        if ($status -notin @(401, 403)) { throw "Expected 401/403, got $status" }
    }
}

Test-Case "Admin endpoints blocked for anonymous (401/403)" {
    try {
        Invoke-Api -Path "/api/v1/admin/dashboard" | Out-Null
        throw "Expected 401/403 but request succeeded"
    } catch {
        $status = Get-ErrorStatus $_
        if ($status -notin @(401, 403)) { throw "Expected 401/403, got $status" }
    }
}

Test-Case "GET /api/v1/users/me/password (PUT-only route) returns 405" {
    try {
        $r = Invoke-Api -Method "GET" -Path "/api/v1/users/me/password" -Token $script:AccessToken
        throw "Expected 405 but request succeeded with $($r.StatusCode)"
    } catch {
        $status = Get-ErrorStatus $_
        if ($status -ne 405) { throw "Expected 405, got $status" }
    }
}

# -----------------------------------------------------------------------------
# SUMMARY
# -----------------------------------------------------------------------------
Write-Host "`n==============================================" -ForegroundColor Cyan
Write-Host "  RESULTS: $script:Passed passed, $script:Failed failed" -ForegroundColor $(if ($script:Failed -eq 0) { "Green" } else { "Red" })
Write-Host "==============================================" -ForegroundColor Cyan

if ($script:Failed -gt 0) {
    Write-Host "`nFailed cases:" -ForegroundColor Red
    $script:Failures | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    exit 1
}
exit 0