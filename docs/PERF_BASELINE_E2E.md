# SpotiBase E2E Performance Baseline

> Date: 2026-09-27 | Env: `docker-compose.yml` (backend:8088 + `postgres:16-alpine` + `redis:7-alpine` + `spotibase-ai:7860`) | Frontend: Expo/RN
> Source of truth for code refs: `backend/src/main/java/com/spotibase/{config/RedisCacheConfig.java,repository/SongRepository.java,service/{SongService,AlbumService,ArtistService,SearchService}.java}`, `application.yml`, Flyway `V23/V24/V25`, `mobile/src/{cache,screens,api}`.
> Related: `docs/PERF_SPOTIFY_SPEED.md` (songs/login deep dive).

## 1. SLOs

- **Warm (cache hit): p95 < 800ms.** Applies to all list/search feeds.
- **Cold (DB + indexes): p95 < 2s.** First miss after TTL expiry / restart.
- **Back-nav / focus return (MMKV, 60s freshness): < 100ms**, no network block.
- **Resilience:** Redis down → `HTTP 200` from DB (fail-open), no `500`.

## 2. Measured baseline (E2E, cold unless noted)

| Route | Time | vs SLO | Verdict |
|---|---|---|---|
| Home feed (`GET /api/v1/home` / `findHomeFeed`) | **~10s** | cold < 2s | ❌ FAIL |
| Albums list | **timeout** | cold < 2s | ❌ FAIL |
| Artists list | **~12s** | cold < 2s | ❌ FAIL |
| Search (`/api/v1/search`, multi-type) | **~8.6s** | cold < 2s | ❌ FAIL |
| Library (`/api/v1/library`, liked+history) | **~6.7s** | cold < 2s | ❌ FAIL |
| Songs page (`page+size`, `findAllActive`) | **~2s cold / 69ms cached** | cold < 2s / warm < 800ms | ⚠️ borderline cold / ✅ warm |
| Playlists list | **619ms** | warm < 800ms | ✅ PASS |
| YouTube proxy (`/api/v1/youtube/*`) | **1131ms** | cold < 2s | ✅ PASS (cold) |
| AI (`/api/v1/ai` via `spotibase-ai:7860`) | **1533ms** | cold < 2s | ✅ PASS (cold) |

Warm songs path proves the cache works when the DB path is cheap; everything else missed SLO cold because of the offenders in §4.

## 3. Cache (Redis)

- Shared `redis:7-alpine`, key prefix `spotibase:v2:` (`RedisCacheConfig.java`), JSON values (`GenericJackson2JsonRedisSerializer` + `JavaTimeModule`), `disableCachingNullValues`, transaction-aware disabled.
- TTLs (`application.yml` + `RedisCacheConfig`): `home 45s`, `songs 5m`, `albums 5m`, `artists 10m`, `playlists 2m`, `recommendations 2m`, `youtube-trending/search 5m`, `youtube-resolve 30m`, default `2m`.
- Fail-open: `timeout 1000ms` + `connect-timeout 1000ms` (`CacheResilienceConfig`); Lettuce pool `max-active 16 / max-idle 8 / min-idle 2`.
- **Observed hit rate: ~52%** (`INFO stats`: `keyspace_hits/(hits+misses)`). Low because home/albums/artists/search keys churn (45s–10m TTLs) and pre-fix callers bypassed cache with per-row / per-page DB fan-out. Songs `69ms` warm vs `2s` cold is the target pattern for all feeds.
- Check: `redis-cli info stats | grep -E 'keyspace_hits|keyspace_misses|evicted_keys'`; `redis-cli scan 0 MATCH 'spotibase:v2:*' COUNT 100`.

## 4. DB top offenders (pre-fix)

1. **Home:** `SongRepository.findHomeFeed` — `ORDER BY featured DESC, releaseDate DESC` + 6-join `FETCH` (artist/album/genre/albumArtist/contributingArtists) with `Page` + `COUNT(*)`. No covering index → heap fetches + sort on every load (~10s).
2. **Albums:** per-album song load + per-song liked check (N+1 → N×M). List path called `getAlbumById` per row.
3. **Artists:** 3 queries per artist (song count + follower count + liked check) = 3N. `~12s` pages.
4. **Search:** leading-wildcard `ILIKE '%q%'` on songs/artists/albums/playlists — full scans, no index use (~8.6s). No `LIMIT` discipline pre-fix.
5. **Library/songs pages:** `Page` (extra `COUNT(*)`) + `ORDER BY createdAt` without index match; `findAll` with entity fetch instead of id-scan + batch hydrate (~2s cold, 6.7s library).
6. **Recent/history:** unbounded `recently_played` / `listening_history` scans, no `setMaxResults` cap, missing covering indexes.
7. **Auth (latency contributor):** Supabase fallback + follower/following `COUNT` on hot login path; `auth-users` cache intentionally removed (see §7).

Indexes backing the fix: `V23` (active browse/top/new/name, `users(email) WHERE active`, liked/history joins, trigram), `V24` (prefix `varchar_pattern_ops`/`text_pattern_ops` + `lower()` GIN trigram + playlist trigram + mood GIN), `V25` (covering: `recently_played(user,played) INCLUDE(type,item)`, `songs(genre,playcount,created)`, `listening_history(user,song,played)`, `liked_*(user,liked) INCLUDE(id)`, `songs(release_date) INCLUDE(artist,genre)`).

## 5. Frontend causes (pre-fix)

- `PAGE_SIZE 10` → 3× round trips vs `30`; `staleTime ~0` + focus effect wiped list and refetched.
- No MMKV hydrate on launch (spinner instead of `<100ms` cached paint), no prefetch (`onEndReachedThreshold` too late), no in-flight dedupe (double `onEndReached` + focus race).
- Search fired per keystroke (no `300ms` debounce, no `AbortController`/supersede).
- Raw `Image` pulled full-size covers instead of `getImageUrl(url, 200)` CDN thumbs; FlatList un-tuned (`initialNumToRender`/`windowSize`/`getItemLayout` missing).

## 6. Fixes applied

| Fix | What changed | Files |
|---|---|---|
| **Batched liked flags** | Per-row `existsByUser/Song` → single `findLikedSongIds/AlbumIds/ArtistIds(userId, ids)` `IN` query (cap ≤50); same pattern in `QueueService`, `PlaylistService` | `AlbumService:227-228,348,390`, `ArtistService:264`, `SongService:getSongsByIds`, `LikeRepository` |
| **Summary albums** | List/search hydrate via `toAlbumSummary(album, liked)` + `getAlbumsByIds(ids, userId)` (1 fetch + 1 liked query); no per-album song load | `AlbumService:185-189,209-213,301,311,338-353,460-475`, `SearchService:230-240` |
| **GROUP BY artists** | Per-artist 3N → `getArtistsByIds`: 2 `GROUP BY` count queries + 1 liked `IN` query per page | `ArtistService:184,213-229+`, `SearchService:260-267` |
| **Slice pages (no COUNT)** | `findAllActive(Page)` → `findActiveIds(Pageable): Slice<String>` index-only id scan on `(archived, createdAt, id)` + `findByIdsWithCoreRelations` batch + `songs-base` cache; cursor `getSongsAfterCursor` keyset on `(createdAt, id)`; `size` clamped, `MAX_PAGE_SIZE 50` | `SongRepository:71-72,200-209`, `SongService:122-124,882-915` |
| **Prefix suggestions** | `"%q%"` scan → `lower(col) LIKE :prefix%` (V24 btree prefix idx) + `lower(col) % lower(:q)` trigram fallback; id-only scan + batched hydrate; voice paths capped at 5, `<150ms` target | `SearchService:63-100,106-191,199-212`, `V24__voice_prefix_fuzzy_search.sql` |
| **Bounded recent** | Unbounded recent/history → `setMaxResults`/`setFirstResult` caps + V25 covering indexes; `V25` makes recent/genre/history/liked/new-release feeds index-only | `V25__home_covering_indexes.sql`, `SearchService:181-182,227-228,255-256`, `LikeService:170`, `NotificationService:49` |
| Cache/timeouts (supporting) | Per-cache TTLs, `spotibase:v2:` prefix, 1000ms fail-open, Hikari `max 5/min 1`, batch_size 50 | `RedisCacheConfig.java`, `application.yml:15-40,72-84` |

Mobile counterpart (already in tree): `SONGS_PAGE_SIZE 30`, MMKV `allSongsData` + 60s freshness, React Query `staleTime 5m/gcTime 30m`, `inFlightRef` dedupe, prefetch at 0.7 / `len-8`, skeleton footer, `getItemLayout{60}`, `removeClippedSubviews`, `getImageUrl(_,200)`, debounced search, non-blocking session restore.

## 7. Remaining (not done)

1. **Home parallel fan-out** — `home` still assembles sections serially; run independent section fetches on `CompletableFuture` (bounded pool) and keep 45s TTL. No `CompletableFuture` in `*Service` yet.
2. **Auth cache** — `auth-users` cache stays **removed** (stale-permission risk); hot path is local-JWT-first + `idx_users_email_active`. Only re-add with explicit invalidation on role/password change + short TTL.
3. **Pool sizing** — Hikari `maximum-pool-size 5 / minimum-idle 1`, `max-lifetime 30s`, `connection-timeout 15s` (`application.yml:29-40`) is dev-safe, not prod-sized. Load-test before raising; watch `pg_stat_activity` + p95 cold.
4. **Virtualization** — FlatList tuning is partial (`initialNumToRender 10`, `windowSize 5` in songs list only). Roll out to home/search/library grids + enforce thumb widths (`getImageUrl(_,200)`) everywhere; consider `ETag/If-None-Match → 304` for warm revalidations.

## 8. Verify

```bash
# caches warm after one cold fetch
curl -s -o /dev/null -w '%{time_total}s %{http_code}\n' 'http://localhost:8088/api/v1/songs?page=0&size=30'
curl -s -o /dev/null -w '%{time_total}s %{http_code}\n' 'http://localhost:8088/api/v1/songs?page=0&size=30'
redis-cli info stats | grep -E 'keyspace_hits|keyspace_misses|evicted_keys'
redis-cli scan 0 MATCH 'spotibase:v2:*' COUNT 100

# fail-open (expect 200 with redis stopped)
docker compose stop redis
curl -s -o /dev/null -w '%{http_code}\n' 'http://localhost:8088/api/v1/songs?page=0&size=30'
docker compose up -d redis

# DB: EXPLAIN hot paths must hit V23/V24/V25 indexes (no seq scan on songs browse/top/new/search)
cd backend && mvn -q test
```

## 9. Gaps / assumptions

- Timings in §2 are the provided E2E baseline (cold, un-tuned client, seeded catalog); not re-measured in this doc pass. Re-run §8 after deploy and replace table.
- Redis `52%` is `INFO stats` cumulative since last restart, not per-route; per-route hit rates need app metrics/actuator.
- YouTube `1131ms` / AI `1533ms` include upstream (Google Data API v3 5s timeout, FastAPI `spotibase-ai:7860`); mock catalogue served when `YOUTUBE_API_KEY` empty or on 429.
