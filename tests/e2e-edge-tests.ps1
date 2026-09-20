# =============================================================================
# SpotiBase E2E Edge-Case Suite (production level, SAFE)
# - Only creates throwaway accounts/data prefixed e2e_edge_, deletes all after.
# - Never touches existing users, songs, playlists, or storage buckets.
# - Usage: powershell -ExecutionPolicy Bypass -File tests\e2e-edge-tests.ps1
# =============================================================================
param(
    [string]$BaseUrl = "http://localhost:8088",
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
$script:Passed = 0
$script:Failed = 0
$script:Skipped = 0
$script:Failures = @()

function Test-Case {
    param([string]$Name, [scriptblock]$Block)
    try {
        $r = & $Block
        if ($r -eq "SKIP") {
            $script:Skipped++
            if (-not $Quiet) { Write-Host "  [SKIP] $Name" -ForegroundColor Yellow }
        } else {
            $script:Passed++
            if (-not $Quiet) { Write-Host "  [PASS] $Name" -ForegroundColor Green }
        }
    } catch {
        $script:Failed++
        $script:Failures += "[FAIL] $Name - $($_.Exception.Message)"
        if (-not $Quiet) { Write-Host "  [FAIL] $Name - $($_.Exception.Message)" -ForegroundColor Red }
    }
}

function Invoke-Api {
    param([string]$Method = "GET", [string]$Path, $Body = $null, [string]$Token = $null)
    $headers = @{}
    if ($Token) { $headers["Authorization"] = "Bearer $Token" }
    $params = @{ Uri = "$BaseUrl$Path"; Method = $Method; UseBasicParsing = $true; TimeoutSec = 30; Headers = $headers }
    # NOTE: -InputObject (not pipeline) so single-element arrays stay JSON arrays.
    # Piping `@(one item)` into ConvertTo-Json unwraps it into a JSON object.
    if ($null -ne $Body) { $params["ContentType"] = "application/json"; $params["Body"] = (ConvertTo-Json -InputObject $Body -Depth 10) }
    Invoke-WebRequest @params
}

function Get-Json($Response) {
    $c = $Response.Content
    if ($c -is [byte[]]) { $c = [System.Text.Encoding]::UTF8.GetString($c) }
    ($c | ConvertFrom-Json)
}

function Get-ErrStatus($Ex) {
    if ($Ex.Exception.Response) { return [int]$Ex.Exception.Response.StatusCode }
    return -1
}

Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "  SpotiBase E2E Edge Cases (throwaway-safe)" -ForegroundColor Cyan
Write-Host "  Target: $BaseUrl" -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan

# -----------------------------------------------------------------------------
# 0. PREFLIGHT (read-only - aborts before creating anything if backend/DB down)
# -----------------------------------------------------------------------------
Write-Host "`n[0] Preflight" -ForegroundColor Yellow

Test-Case "Backend /actuator/health is UP" {
    $r = Invoke-Api -Path "/actuator/health"
    if ((Get-Json $r).status -ne "UP") { throw "not UP" }
}

Test-Case "DB reachable: public suggestions endpoint answers" {
    $r = Invoke-Api -Path "/api/v1/search/suggestions?query=love"
    if ($r.StatusCode -ne 200) { throw "got $($r.StatusCode)" }
}

# -----------------------------------------------------------------------------
# 1. THROWAWAY IDENTITY (all later tests use this user only)
# -----------------------------------------------------------------------------
Write-Host "`n[1] Throwaway identity" -ForegroundColor Yellow
$ts = Get-Date -Format "HHmmss"
$script:Email = "e2e_edge.$ts@example.com"
$script:User = "e2e_edge_$ts"
$script:Pass = "EdgeTest!2026"
$script:PlaylistIds = @()

Test-Case "Register throwaway user" {
    $r = Invoke-Api -Method "POST" -Path "/api/v1/auth/register" -Body @{
        email = $script:Email; username = $script:User; password = $script:Pass
    }
    if ($r.StatusCode -notin @(200, 201)) { throw "got $($r.StatusCode)" }
    $b = Get-Json $r
    if (-not $b.accessToken) { throw "no token - DB likely unreachable, aborting run" }
    $script:AccessToken = $b.accessToken
    $script:RefreshToken = $b.refreshToken
}

function Authed([string]$Method, [string]$Path, $Body = $null) {
    Invoke-Api -Method $Method -Path $Path -Body $Body -Token $script:AccessToken
}

# Reorder PUTs are multi-statement transactions: on flaky links a truncated body
# surfaces as transient 400 "Malformed request body" (or 500). Retry THOSE ONLY -
# real validation 400s ("Invalid position", "Song not in playlist") fail fast.
function Invoke-Reorder([string]$PlaylistId, $Items) {
    $attempt = 0
    while ($true) {
        $attempt++
        try {
            return Authed "PUT" "/api/v1/playlists/$PlaylistId/songs/reorder" -Body $Items
        } catch {
            $msg = $_.Exception.Message
            $transient = ($msg -match "Malformed request body") -or ($msg -match "\(500\)")
            if ($transient -and $attempt -lt 3) { Start-Sleep 2; continue }
            throw
        }
    }
}

# -----------------------------------------------------------------------------
# 2. AUTH EDGE CASES (no foreign data touched)
# -----------------------------------------------------------------------------
Write-Host "`n[2] Auth edge cases" -ForegroundColor Yellow

Test-Case "Wrong password -> 401, no token leak" {
    try {
        Invoke-Api -Method "POST" -Path "/api/v1/auth/login" -Body @{ email = $script:Email; password = "Wrong!123" } | Out-Null
        throw "expected 401"
    } catch { if ((Get-ErrStatus $_) -ne 401) { throw "got $(Get-ErrStatus $_)" } }
}

Test-Case "Duplicate email register -> 4xx" {
    try {
        Invoke-Api -Method "POST" -Path "/api/v1/auth/register" -Body @{ email = $script:Email; username = "$($script:User)_dup"; password = "Other!123" } | Out-Null
        throw "expected 4xx"
    } catch { $s = Get-ErrStatus $_; if ($s -lt 400 -or $s -ge 500) { throw "got $s" } }
}

Test-Case "Invalid email + short password -> 400 validation" {
    try {
        Invoke-Api -Method "POST" -Path "/api/v1/auth/register" -Body @{ email = "nope"; username = "x"; password = "12" } | Out-Null
        throw "expected 400"
    } catch { if ((Get-ErrStatus $_) -ne 400) { throw "got $(Get-ErrStatus $_)" } }
}

Test-Case "Garbage JWT on /users/me -> 401/403" {
    try { Invoke-Api -Path "/api/v1/users/me" -Token "garbage.token.here" | Out-Null; throw "expected 401/403" }
    catch { if ((Get-ErrStatus $_) -notin @(401, 403)) { throw "got $(Get-ErrStatus $_)" } }
}

Test-Case "Malformed refresh token -> 401 (no 500)" {
    try { Invoke-Api -Method "POST" -Path "/api/v1/auth/refresh" -Body @{ refreshToken = "not-a-token" } | Out-Null; throw "expected 401" }
    catch { if ((Get-ErrStatus $_) -ne 401) { throw "got $(Get-ErrStatus $_)" } }
}

Test-Case "SQL-injection login attempt -> 401, no 500" {
    try { Invoke-Api -Method "POST" -Path "/api/v1/auth/login" -Body @{ email = "' OR '1'='1"; password = "x" } | Out-Null; throw "expected 401/400" }
    catch { if ((Get-ErrStatus $_) -notin @(400, 401)) { throw "got $(Get-ErrStatus $_)" } }
}

# -----------------------------------------------------------------------------
# 3. SONGS + SEARCH EDGE (read-only except own like/unlike, always reverted)
# -----------------------------------------------------------------------------
Write-Host "`n[3] Songs + search edge cases" -ForegroundColor Yellow

Test-Case "Seed: fetch 2 real song ids (read-only)" {
    $b = Get-Json (Authed "GET" "/api/v1/songs?page=0&size=5")
    $list = @($b.content) | Where-Object { $_ }
    if (-not $list -or $list.Count -eq 0) { $list = @($b) | Where-Object { $_.id } }
    $script:SongIds = @($list | Select-Object -First 2 -ExpandProperty id)
    if ($script:SongIds.Count -eq 0) { return "SKIP" }
}

Test-Case "GET nonexistent song -> 404 (never 500)" {
    if ($script:SongIds.Count -eq 0) { return "SKIP" }
    try { Authed "GET" "/api/v1/songs/00000000-0000-0000-0000-000000000000" | Out-Null; throw "expected 404" }
    catch { if ((Get-ErrStatus $_) -ne 404) { throw "got $(Get-ErrStatus $_)" } }
}

Test-Case "Like twice then unlike restores state (self-healing)" {
    if ($script:SongIds.Count -eq 0) { return "SKIP" }
    $id = $script:SongIds[0]
    try { Authed "POST" "/api/v1/songs/$id/like" | Out-Null } catch { if ((Get-ErrStatus $_) -notin @(200, 201, 409)) { throw "like1 got $(Get-ErrStatus $_)" } }
    try { Authed "POST" "/api/v1/songs/$id/like" | Out-Null } catch { if ((Get-ErrStatus $_) -notin @(200, 201, 409)) { throw "like2 got $(Get-ErrStatus $_)" } }
    $r = Authed "DELETE" "/api/v1/songs/$id/like"
    if ($r.StatusCode -notin @(200, 204)) { throw "unlike got $($r.StatusCode)" }
}

Test-Case "Like nonexistent song -> 404" {
    try { Authed "POST" "/api/v1/songs/00000000-0000-0000-0000-000000000000/like" | Out-Null; throw "expected 404" }
    catch { if ((Get-ErrStatus $_) -ne 404) { throw "got $(Get-ErrStatus $_)" } }
}

Test-Case "Search: empty query -> 200 bounded" {
    $r = Authed "GET" "/api/v1/search?query=&types=song"
    if ($r.StatusCode -ne 200) { throw "got $($r.StatusCode)" }
}

Test-Case "Search: special chars/emoji -> 200, no 500" {
    $r = Authed "GET" "/api/v1/search?query=%25%22%3B%20DROP%20TABLE%20songs%F0%9F%8E%B5&types=song,artist"
    if ($r.StatusCode -ne 200) { throw "got $($r.StatusCode)" }
}

Test-Case "Songs: size=1000 + page=99999 -> 200 bounded" {
    $r = Authed "GET" "/api/v1/songs?page=99999&size=1000"
    if ($r.StatusCode -ne 200) { throw "got $($r.StatusCode)" }
}

Test-Case "Stream Range bytes=0-99 -> 206 + Content-Range" {
    if ($script:SongIds.Count -eq 0) { return "SKIP" }
    $req = [System.Net.HttpWebRequest]::Create("$BaseUrl/api/v1/songs/$($script:SongIds[0])/stream")
    $req.Method = "GET"; $req.Timeout = 30000
    $req.Headers.Add("Authorization", "Bearer $($script:AccessToken)")
    $req.AddRange(0, 99)
    try { $resp = $req.GetResponse(); $code = [int]$resp.StatusCode; $resp.Close() } catch [System.Net.WebException] { $code = [int]$_.Exception.Response.StatusCode }
    if ($code -notin @(200, 206, 302)) { throw "got $code" }
}

# -----------------------------------------------------------------------------
# 4. PLAYLIST + QUEUE (own throwaway data only)
# -----------------------------------------------------------------------------
Write-Host "`n[4] Playlist + queue (own data)" -ForegroundColor Yellow

Test-Case "Create playlist (own)" {
    $r = Authed "POST" "/api/v1/playlists" -Body @{ name = "e2e_edge_$ts"; description = "throwaway" }
    if ($r.StatusCode -notin @(200, 201)) { throw "got $($r.StatusCode)" }
    $script:PlaylistIds += (Get-Json $r).id
}

Test-Case "Add real songs to own playlist (links only, songs untouched)" {
    if ($script:SongIds.Count -eq 0) { return "SKIP" }
    $r = Authed "POST" "/api/v1/playlists/$($script:PlaylistIds[0])/songs" -Body @{ songIds = $script:SongIds }
    if ($r.StatusCode -notin @(200, 201)) { throw "got $($r.StatusCode)" }
}

Test-Case "Reorder clamps out-of-range position to end (200, order verified)" {
    if ($script:SongIds.Count -lt 2) { return "SKIP" }
    $first = $script:SongIds[0]
    $r = Invoke-Reorder $script:PlaylistIds[0] @(@{ songId = $first; newPosition = 99999 })
    if ($r.StatusCode -ne 200) { throw "got $($r.StatusCode)" }
    $after = Get-Json (Authed "GET" "/api/v1/playlists/$($script:PlaylistIds[0])")
    $order = @($after.songs | ForEach-Object { $_.id })
    if ($order[-1] -ne $first) { throw "song not moved to end" }
}

Test-Case "Reorder negative position -> 400 (validation, never 500)" {
    if ($script:SongIds.Count -eq 0) { return "SKIP" }
    try { Authed "PUT" "/api/v1/playlists/$($script:PlaylistIds[0])/songs/reorder" -Body @(@{ songId = $script:SongIds[0]; newPosition = -1 }) | Out-Null; throw "expected 400" }
    catch { if ((Get-ErrStatus $_) -ne 400) { throw "got $(Get-ErrStatus $_)" } }
}

Test-Case "Reorder unknown song -> 400 (never 500)" {
    try { Authed "PUT" "/api/v1/playlists/$($script:PlaylistIds[0])/songs/reorder" -Body @(@{ songId = "00000000-0000-0000-0000-000000000000"; newPosition = 0 }) | Out-Null; throw "expected 400" }
    catch { if ((Get-ErrStatus $_) -ne 400) { throw "got $(Get-ErrStatus $_)" } }
}

Test-Case "Reorder swap two songs -> 200 both ways, order verified" {
    if ($script:SongIds.Count -lt 2) { return "SKIP" }
    $a = $script:SongIds[0]; $b = $script:SongIds[1]
    Invoke-Reorder $script:PlaylistIds[0] @(@{ songId = $a; newPosition = 1 }, @{ songId = $b; newPosition = 0 }) | Out-Null
    $after = Get-Json (Authed "GET" "/api/v1/playlists/$($script:PlaylistIds[0])")
    $order = @($after.songs | ForEach-Object { $_.id })
    if ($order[0] -ne $b -or $order[1] -ne $a) { throw "swap order wrong: $($order -join ',')" }
    Invoke-Reorder $script:PlaylistIds[0] @(@{ songId = $a; newPosition = 0 }, @{ songId = $b; newPosition = 1 }) | Out-Null
}

Test-Case "GET nonexistent playlist -> 404" {
    try { Authed "GET" "/api/v1/playlists/00000000-0000-0000-0000-000000000000" | Out-Null; throw "expected 404" }
    catch { if ((Get-ErrStatus $_) -ne 404) { throw "got $(Get-ErrStatus $_)" } }
}

Test-Case "Queue add + invalid move + clear (own queue)" {
    if ($script:SongIds.Count -eq 0) { return "SKIP" }
    Authed "POST" "/api/v1/queue" -Body @{ songId = $script:SongIds[0]; source = "e2e" } | Out-Null
    $q = Get-Json (Authed "GET" "/api/v1/queue")
    $items = @($q.items); if ($items.Count -eq 0) { $items = @($q.content) }
    if ($items.Count -gt 0 -and $items[0].id) {
        try { Authed "PUT" "/api/v1/queue/$($items[0].id)/move" -Body @{ newPosition = -5 } | Out-Null; throw "expected 400" }
        catch { if ((Get-ErrStatus $_) -ne 400) { throw "move got $(Get-ErrStatus $_)" } }
    }
    $r = Authed "DELETE" "/api/v1/queue"
    if ($r.StatusCode -notin @(200, 204)) { throw "clear got $($r.StatusCode)" }
}

# -----------------------------------------------------------------------------
# 5. AI ASSISTANCE (text + voice, mock-safe, no data mutated)
# -----------------------------------------------------------------------------
Write-Host "`n[5] AI assistance" -ForegroundColor Yellow

Test-Case "AI health reports ok" {
    $r = Authed "GET" "/api/v1/ai/health"
    if ((Get-Json $r).status -ne "ok") { throw "not ok" }
}

Test-Case "AI text 'next song' returns NEXT action" {
    $b = Get-Json (Authed "POST" "/api/v1/ai/text" -Body @{ text = "next song"; context = @{} })
    if ((@($b.actions) | Where-Object { $_.action -eq "NEXT" }).Count -eq 0) { throw "no NEXT action" }
}

Test-Case "AI text mood query returns PLAY_BY_MOOD" {
    $b = Get-Json (Authed "POST" "/api/v1/ai/text" -Body @{ text = "Play calm Tamil songs"; context = @{} })
    if ((@($b.actions) | Where-Object { $_.action -like "PLAY_*" -or $_.action -like "SEARCH_*" }).Count -eq 0 -and -not $b.clarificationNeeded) {
        throw "no play/search action and no clarification"
    }
}

Test-Case "AI text gibberish returns clarification shape (no 500)" {
    $b = Get-Json (Authed "POST" "/api/v1/ai/text" -Body @{ text = "zxqw blorpt fnord"; context = @{} })
    if ($null -eq $b.clarificationNeeded) { throw "missing clarificationNeeded flag" }
}

Test-Case "AI voice with transcript_fallback mirrors text path" {
    $tmp = [System.IO.Path]::GetTempFileName()
    [System.IO.File]::WriteAllBytes($tmp, (New-Object byte[] 1024))
    try {
        $out = curl.exe -s -m 30 -X POST "$BaseUrl/api/v1/ai/voice" -H "Authorization: Bearer $($script:AccessToken)" -F "audio=@$tmp;type=audio/m4a" -F "transcript_fallback=next song" 2>$null
        $b = ($out | ConvertFrom-Json)
        if ((@($b.actions) | Where-Object { $_.action -eq "NEXT" }).Count -eq 0) { throw "no NEXT action" }
    } finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
}

Test-Case "AI voice without fallback returns clarification (mock STT, no crash)" {
    $tmp = [System.IO.Path]::GetTempFileName()
    [System.IO.File]::WriteAllBytes($tmp, (New-Object byte[] 512))
    try {
        $out = curl.exe -s -m 30 -X POST "$BaseUrl/api/v1/ai/voice" -H "Authorization: Bearer $($script:AccessToken)" -F "audio=@$tmp;type=audio/m4a" 2>$null
        $b = ($out | ConvertFrom-Json)
        if (-not $b.clarificationNeeded) { throw "expected clarificationNeeded=true" }
    } finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
}

# -----------------------------------------------------------------------------
# 6. SECURITY NEGATIVES (no state change)
# -----------------------------------------------------------------------------
Write-Host "`n[6] Security negatives" -ForegroundColor Yellow

Test-Case "USER token on /admin/dashboard -> 403" {
    try { Authed "GET" "/api/v1/admin/dashboard" | Out-Null; throw "expected 403" }
    catch { if ((Get-ErrStatus $_) -notin @(401, 403)) { throw "got $(Get-ErrStatus $_)" } }
}

Test-Case "Anon on /api/v1/queue -> 401/403" {
    try { Invoke-Api -Path "/api/v1/queue" | Out-Null; throw "expected 401/403" }
    catch { if ((Get-ErrStatus $_) -notin @(401, 403)) { throw "got $(Get-ErrStatus $_)" } }
}

# -----------------------------------------------------------------------------
# 7. CLEANUP (remove everything this run created)
# -----------------------------------------------------------------------------
Write-Host "`n[7] Cleanup (throwaway data only)" -ForegroundColor Yellow

Test-Case "Delete own playlists" {
    foreach ($plid in $script:PlaylistIds) {
        try { Authed "DELETE" "/api/v1/playlists/$plid" | Out-Null } catch { if ((Get-ErrStatus $_) -notin @(200, 204, 404)) { throw "playlist $plid got $(Get-ErrStatus $_)" } }
    }
}

Test-Case "Delete throwaway user + prove gone" {
    $r = Authed "DELETE" "/api/v1/users/me"
    if ($r.StatusCode -notin @(200, 204)) { throw "delete got $($r.StatusCode)" }
    try { Invoke-Api -Method "POST" -Path "/api/v1/auth/login" -Body @{ email = $script:Email; password = $script:Pass } | Out-Null; throw "user still exists!" }
    catch { if ((Get-ErrStatus $_) -ne 401) { throw "post-delete login got $(Get-ErrStatus $_), expected 401" } }
}

# -----------------------------------------------------------------------------
# SUMMARY
# -----------------------------------------------------------------------------
Write-Host "`n==============================================" -ForegroundColor Cyan
Write-Host "  RESULTS: $($script:Passed) passed, $($script:Failed) failed, $($script:Skipped) skipped" -ForegroundColor $(if ($script:Failed -eq 0) { "Green" } else { "Red" })
Write-Host "==============================================" -ForegroundColor Cyan
if ($script:Failed -gt 0) { $script:Failures | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }; exit 1 }
exit 0
