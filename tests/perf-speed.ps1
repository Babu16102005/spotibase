# =============================================================================
# SpotiBase E2E Speed Harness
# Measures cold/warm p50/p95 latency for the 10 hot API paths against a
# running backend (default http://localhost:8088).
#
# Expo v57 docs reviewed per mobile/AGENTS.md (2026-09-27): this harness is
# backend perf tooling only - no mobile/Expo SDK code is touched.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File tests\perf-speed.ps1
#   powershell -ExecutionPolicy Bypass -File tests\perf-speed.ps1 `
#       -BaseUrl http://localhost:8088 -WarmIterations 10
#
# Contract notes (verified against backend sources):
#   * SecurityConfig: ONLY /api/v1/auth/**, /api/v1/public/**, /ws/**,
#     swagger/api-docs, /actuator/health, song stream (GET/HEAD/OPTIONS),
#     /api/v1/search/suggestions, /api/v1/search/trending,
#     /api/v1/playlists/featured are public. Everything else needs a JWT.
#   * POST /api/v1/auth/login  (public, BCrypt - inherently slower)
#   * POST /api/v1/ai/text     (auth + JSON {"text": "..."}; AI_MODE=mock)
#   * GET  /api/v1/search REQUIRES auth (SearchController derefs user id)
#   * GET  /api/v1/library    REQUIRES auth (LibraryController derefs user id)
#   * GET  /api/v1/youtube/trending REQUIRES auth; mock catalogue when no key
#   * "cold" = first timed sample in this run (server/JVM already steady-state
#     if the backend has uptime; honest first-sample, NOT a reboot test).
#     "warm" = steady-state distribution over -WarmIterations samples.
# =============================================================================
param(
    [string]$BaseUrl = "http://localhost:8088",
    [int]$WarmIterations = 10,
    [string]$OutJson = "tests/perf-speed-results.json",
    # SLO thresholds (ms) applied to WARM p95 unless noted
    [int]$SloReadsMs = 1000,
    [int]$SloLoginMs = 2500,
    [int]$SloYoutubeMs = 2500,
    [int]$SloAiMs = 15000,
    [int]$TimeoutSec = 25
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------- helpers ---
function Invoke-Timed {
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
        TimeoutSec = $TimeoutSec
        Headers = $headers
    }
    if ($null -ne $Body) {
        $params["ContentType"] = "application/json"
        $params["Body"] = ($Body | ConvertTo-Json -Depth 10)
    }
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $status = -1
    try {
        $r = Invoke-WebRequest @params
        $status = [int]$r.StatusCode
    } catch {
        if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
        elseif ($_.Exception.Message -match 'timed out|Timeout') { $status = 0 }
    } finally {
        $sw.Stop()
    }
    return @{ Ms = $sw.Elapsed.TotalMilliseconds; Status = $status }
}

function Get-Pct {
    param([double[]]$Sorted, [double]$P)
    if ($Sorted.Count -eq 0) { return [double]::NaN }
    if ($Sorted.Count -eq 1) { return $Sorted[0] }
    $rank = [Math]::Ceiling($P / 100.0 * $Sorted.Count) - 1
    if ($rank -lt 0) { $rank = 0 }
    if ($rank -ge $Sorted.Count) { $rank = $Sorted.Count - 1 }
    return $Sorted[$rank]
}

function Measure-Endpoint {
    param(
        [string]$Name, [string]$Method, [string]$Path,
        $Body = $null, [string]$Token = $null, [int]$SloMs = 1000
    )
    # Cold: single first sample (cache/JIT first-touch in this run)
    $cold = Invoke-Timed -Method $Method -Path $Path -Body $Body -Token $Token
    # Warm: steady-state distribution
    $warm = @()
    $warmStatuses = @()
    for ($i = 0; $i -lt $WarmIterations; $i++) {
        $s = Invoke-Timed -Method $Method -Path $Path -Body $Body -Token $Token
        $warm += $s.Ms
        $warmStatuses += $s.Status
    }
    $sorted = @($warm | Sort-Object)
    $okWarm = @($warmStatuses | Where-Object { $_ -ge 200 -and $_ -lt 300 }).Count
    $p50 = Get-Pct $sorted 50
    $p95 = Get-Pct $sorted 95
    $mean = ($warm | Measure-Object -Average).Average
    $pass = ($p95 -le $SloMs) -and ($cold.Status -ge 200 -and $cold.Status -lt 300) -and ($okWarm -eq $WarmIterations)
    return [pscustomobject]@{
        Endpoint = $Name
        Method = $Method
        Path = $Path
        SloMs = $SloMs
        ColdMs = [Math]::Round($cold.Ms, 1)
        ColdStatus = $cold.Status
        WarmN = $WarmIterations
        WarmMinMs = [Math]::Round($sorted[0], 1)
        WarmP50Ms = [Math]::Round($p50, 1)
        WarmP95Ms = [Math]::Round($p95, 1)
        WarmMeanMs = [Math]::Round($mean, 1)
        WarmMaxMs = [Math]::Round($sorted[-1], 1)
        WarmOk = "$okWarm/$WarmIterations"
        SloPass = $pass
    }
}

# ---------------------------------------------------------------- preamble ---
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "  SpotiBase E2E Speed Harness" -ForegroundColor Cyan
Write-Host "  Target: $BaseUrl  (warm N=$WarmIterations)" -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan

try {
    $h = Invoke-WebRequest -Uri "$BaseUrl/actuator/health" -UseBasicParsing -TimeoutSec 10
    $hc = $h.Content
    if ($hc -is [byte[]]) { $hc = [System.Text.Encoding]::UTF8.GetString($hc) }
    Write-Host "Backend health: $hc" -ForegroundColor Green
} catch {
    Write-Host "BLOCKED: backend not reachable at $BaseUrl : $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Start it first (backend/run-local.ps1 or docker compose up), then re-run." -ForegroundColor Yellow
    exit 2
}

# Infra snapshot: Redis (via docker, best-effort) -----------------------------
Write-Host "`n[infra] Redis" -ForegroundColor Yellow
try {
    $stats = docker exec spotibase-redis redis-cli INFO stats 2>&1 | Out-String
    $hits = ($stats | Select-String 'keyspace_hits:(\d+)' -AllMatches).Matches | ForEach-Object { $_.Groups[1].Value } | Select-Object -Last 1
    $miss = ($stats | Select-String 'keyspace_misses:(\d+)' -AllMatches).Matches | ForEach-Object { $_.Groups[1].Value } | Select-Object -Last 1
    $keys = (docker exec spotibase-redis redis-cli DBSIZE 2>&1 | Out-String).Trim()
    $mem = (docker exec spotibase-redis redis-cli INFO memory 2>&1 | Select-String 'used_memory_human:(.*)') | ForEach-Object { $_.Matches[0].Groups[1].Value.Trim() }
    $hitRate = if (([double]$hits + [double]$miss) -gt 0) { [Math]::Round(100 * [double]$hits / ([double]$hits + [double]$miss), 1) } else { 0 }
    Write-Host "  keys=$keys mem=$mem hits=$hits misses=$miss hitRate=${hitRate}%"
    $script:redisSnap = @{ keys = "$keys"; mem = "$mem"; hits = "$hits"; misses = "$miss"; hitRatePct = $hitRate }
} catch {
    Write-Host "  (redis snapshot unavailable: $($_.Exception.Message))" -ForegroundColor DarkYellow
    $script:redisSnap = @{ note = "unavailable: $($_.Exception.Message)" }
}

# Infra snapshot: Postgres V23/V25 indexes (best-effort via local psql) --------
Write-Host "[infra] Postgres (V23/V25 index check)" -ForegroundColor Yellow
try {
    $psql = (Get-Command psql -ErrorAction Stop).Source
    $cfg = @{}
    foreach ($l in (Get-Content .env | Where-Object { $_ -match '^(SPRING_DATASOURCE_USERNAME|SPRING_DATASOURCE_PASSWORD)=' })) {
        $k, $v = $l -split '=', 2; $cfg[$k] = $v
    }
    $env:PGPASSWORD = $cfg['SPRING_DATASOURCE_PASSWORD']
    $conn = "host=aws-0-ap-northeast-2.pooler.supabase.com port=6543 dbname=postgres user=$($cfg['SPRING_DATASOURCE_USERNAME']) sslmode=require"
    $idx = & $psql "$conn" -t -c "SELECT count(*) FROM pg_indexes WHERE indexname IN ('idx_songs_active_created','idx_songs_active_playcount','idx_songs_active_new','idx_songs_active_name','idx_songs_artist_name_trgm','idx_songs_album_name_trgm','idx_users_email_active','idx_recently_played_user_played_cover','idx_songs_genre_playcount','idx_songs_active_release');" 2>&1 | Out-String
    $fly = & $psql "$conn" -t -c "SELECT max(version) FROM flyway_schema_history WHERE success;" 2>&1 | Out-String
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
    Write-Host "  V23/V25 spot-check indexes present: $($idx.Trim())/10, flyway max version: $($fly.Trim())"
    $script:pgSnap = @{ v23v25Present = $idx.Trim(); flywayMax = $fly.Trim() }
} catch {
    Write-Host "  (postgres snapshot unavailable: $($_.Exception.Message))" -ForegroundColor DarkYellow
    $script:pgSnap = @{ note = "unavailable: $($_.Exception.Message)" }
}

# AI service snapshot -----------------------------------------------------------
Write-Host "[infra] AI service (:7860)" -ForegroundColor Yellow
try {
    $ai = (Invoke-WebRequest -Uri 'http://localhost:7860/health' -UseBasicParsing -TimeoutSec 5).Content
    Write-Host "  $ai"
    $script:aiSnap = @{ health = "$ai" }
} catch {
    Write-Host "  (AI service unreachable: $($_.Exception.Message))" -ForegroundColor DarkYellow
    $script:aiSnap = @{ note = "unreachable" }
}

# Auth setup: throwaway user -> JWT --------------------------------------------
$stamp = Get-Date -Format "HHmmss"
$testEmail = "perfspeed.$stamp@example.com"
$testPass = "PerfSpeed!2026"
Write-Host "`n[setup] registering $testEmail" -ForegroundColor Yellow
$reg = Invoke-Timed -Method "POST" -Path "/api/v1/auth/login" -Body @{ email = "nope.invalid@example.com"; password = "x" }
Write-Host "  (sanity: invalid login -> HTTP $($reg.Status), $($([Math]::Round($reg.Ms,1))) ms)"

$regBody = @{ email = $testEmail; username = "perfspeed_$stamp"; password = $testPass }
Invoke-Timed -Method "POST" -Path "/api/v1/auth/register" -Body $regBody | Out-Null
$loginResp = $null
try {
    $loginResp = Invoke-WebRequest -Uri "$BaseUrl/api/v1/auth/login" -Method POST `
        -ContentType "application/json" -UseBasicParsing -TimeoutSec 30 `
        -Body (@{ email = $testEmail; password = $testPass } | ConvertTo-Json)
} catch {
    Write-Host "BLOCKED: login failed for fresh user: $($_.Exception.Message)" -ForegroundColor Red
    exit 2
}
$c = $loginResp.Content
if ($c -is [byte[]]) { $c = [System.Text.Encoding]::UTF8.GetString($c) }
$token = ($c | ConvertFrom-Json).accessToken
if (-not $token) { Write-Host "BLOCKED: no accessToken in login response" -ForegroundColor Red; exit 2 }
Write-Host "  login OK, token acquired (len $($token.Length))" -ForegroundColor Green

# ---------------------------------------------------------------- measure ----
Write-Host "`n[measure] cold (1x) + warm (${WarmIterations}x) per endpoint" -ForegroundColor Yellow
$results = @()
$results += Measure-Endpoint -Name "home"             -Method "GET"  -Path "/api/v1/home?page=0"              -Token $token -SloMs $SloReadsMs
$results += Measure-Endpoint -Name "songs p0 x30"     -Method "GET"  -Path "/api/v1/songs?page=0&size=30"     -Token $token -SloMs $SloReadsMs
$results += Measure-Endpoint -Name "albums"           -Method "GET"  -Path "/api/v1/albums?page=0&size=20"    -Token $token -SloMs $SloReadsMs
$results += Measure-Endpoint -Name "artists"          -Method "GET"  -Path "/api/v1/artists?page=0&size=20"   -Token $token -SloMs $SloReadsMs
$results += Measure-Endpoint -Name "playlists"        -Method "GET"  -Path "/api/v1/playlists"                -Token $token -SloMs $SloReadsMs
$results += Measure-Endpoint -Name "search ?query="   -Method "GET"  -Path "/api/v1/search?query=love"        -Token $token -SloMs $SloReadsMs
$results += Measure-Endpoint -Name "library"          -Method "GET"  -Path "/api/v1/library"                 -Token $token -SloMs $SloReadsMs
$results += Measure-Endpoint -Name "auth/login"       -Method "POST" -Path "/api/v1/auth/login"               -Body @{ email = $testEmail; password = $testPass } -SloMs $SloLoginMs
$results += Measure-Endpoint -Name "youtube/trending" -Method "GET"  -Path "/api/v1/youtube/trending"        -Token $token -SloMs $SloYoutubeMs
$results += Measure-Endpoint -Name "ai/text"          -Method "POST" -Path "/api/v1/ai/text"                  -Body @{ text = "Suggest a chill evening playlist vibe in one sentence." } -Token $token -SloMs $SloAiMs

# ---------------------------------------------------------------- report -----
Write-Host ""
$fmt = "{0,-16} {1,4} {2,9} {3,9} {4,9} {5,9} {6,9} {7,-9} {8}"
Write-Host ($fmt -f "endpoint", "m", "cold", "p50", "p95", "mean", "max", "warm-ok", "SLO") -ForegroundColor Cyan
foreach ($r in $results) {
    $slo = if ($r.SloPass) { "PASS" } else { "FAIL" }
    $color = if ($r.SloPass) { "Green" } else { "Red" }
    Write-Host ($fmt -f $r.Endpoint, $r.Method,
        "$($r.ColdMs)ms", "$($r.WarmP50Ms)ms", "$($r.WarmP95Ms)ms",
        "$($r.WarmMeanMs)ms", "$($r.WarmMaxMs)ms", $r.WarmOk, "$slo($($r.SloMs)ms)") -ForegroundColor $color
}

Write-Host "`n[top offenders by warm p95]" -ForegroundColor Yellow
$results | Sort-Object WarmP95Ms -Descending | Select-Object -First 3 | ForEach-Object {
    Write-Host "  $($_.Endpoint): p95 $($_.WarmP95Ms)ms (cold $($_.ColdMs)ms, status $($_.ColdStatus))"
}

$passed = @($results | Where-Object { $_.SloPass }).Count
$failed = $results.Count - $passed
Write-Host "`nSLO: $passed/$($results.Count) endpoints pass" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Red" })

# Persist JSON ------------------------------------------------------------------
$payload = [pscustomobject]@{
    ts = (Get-Date).ToString("o")
    baseUrl = $BaseUrl
    warmN = $WarmIterations
    slos = @{ readsMs = $SloReadsMs; loginMs = $SloLoginMs; youtubeMs = $SloYoutubeMs; aiMs = $SloAiMs }
    redis = $script:redisSnap
    postgres = $script:pgSnap
    ai = $script:aiSnap
    frontendMmkv = @{
        note = "static analysis (no device attached): mobile/src/cache/* only"
        homeFeedFreshMs = 45000
        songsFreshMs = 60000
        cached = @("home (homeData/homeDataAt)", "songs p0x30 (allSongsData/songsAt)")
        uncachedAlwaysNetwork = @("albums", "artists", "playlists", "library", "search", "youtube", "ai")
    }
    results = $results
}
$dir = Split-Path $OutJson -Parent
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory $dir | Out-Null }
$payload | ConvertTo-Json -Depth 10 | Out-File $OutJson -Encoding utf8
Write-Host "results -> $OutJson"

if ($failed -gt 0) { exit 1 }
exit 0
