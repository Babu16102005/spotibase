# SpotiBase Spotify-Speed Perf Notes

> Goal: Spotify-like list/login/back-nav speed with Redis cache-first + DB fail-open.
> Stack: Spring Boot (`spring.cache.type=redis`) + `redis:7-alpine` + Postgres + Expo/RN (MMKV + React Query).

## 1. Redis status + how to start

Compose service (`docker-compose.yml`):

```yaml
redis:
  image: redis:7-alpine
  container_name: spotibase-redis
  ports: ["6379:6379"]
  command: redis-server --appendonly yes
```

Backend env: `REDIS_HOST` (default `localhost`, `redis` in compose), `REDIS_PORT` (default `6379`).
AI service shares the same server via `REDIS_URL=redis://redis:6379/0`.
Backend client (`application.yml`): `timeout: 1000ms`, `connect-timeout: 1000ms`, Lettuce pool `max-active: 16, max-idle: 8, min-idle: 2`.

```bash
# start
docker compose up -d redis
docker compose ps redis

# liveness
redis-cli ping                    # expect PONG
redis-cli -n 0 info stats | head -40
redis-cli -n 0 info keyspace

# inspect SpotiBase keys (prefix spotibase::)
redis-cli scan 0 MATCH 'spotibase::*' COUNT 100
redis-cli keys 'spotibase::songs*'

# live traffic while tapping app
redis-cli monitor | head -100

# hit rate / evictions
redis-cli info stats | grep -E 'keyspace_hits|keyspace_misses|evicted_keys'
```

If Redis is down the app still returns `200` from DB (fail-open, see `CacheResilienceConfig`). No `500` on cache outage by design.

## 2. Speed analysis summary (what was slow)

| Area | Cold | Warm | Root cause |
|---|---|---|---|
| Songs list | N+1 per row + `COUNT(*)` per page + `ORDER BY createdAt` with no index | repeated full queries, no cache | `SongService` loaded liked flags / counts per song; unindexed `createdAt` sort; frontend `PAGE_SIZE 10` caused many round trips; focus effect wiped list and refetched; raw `Image` pulled full-size covers |
| Login | Supabase fallback on every login + follower/following `COUNT` per login | no user cache | auth always hit Supabase + DB counts even for local users |
| Frontend nav | back-nav refetched | no SWR window | `staleTime ~0`, focus wipe, no MMKV hydrate, no prefetch, no in-flight dedupe, search fired per keystroke |

## 3. What was fixed

### Backend — Redis (`RedisCacheConfig.java`, `CacheResilienceConfig`, `application.yml`)

- JSON values (`GenericJackson2JsonRedisSerializer` + `JavaTimeModule`, ISO-8601, ignore-unknown-props) — inspectable, language-agnostic, survives additive DTO changes.
- Key prefix `spotibase::` for namespace isolation on the shared Redis.
- Per-cache TTLs: `home 45s`, `songs 5m`, `albums 5m`, `artists 10m`, `playlists 2m`, `recommendations 2m`, `auth-users 10m`, default `2m`, `disableCachingNullValues`.
- Fast fail-open timeouts: `1000ms` command + connect timeout so cold-start/cross-AZ spikes degrade to DB instead of `500`.
- Transaction-aware cache disabled for lower write latency; errors handled fail-open.

### Backend — `SongService.java`

- Cached bases: `songs::id:{id}`, `songs::trending:{limit}`, `songs::new:{limit}`, `songs::featured:{limit}` + batched `findAllById` (`#ids.size() <= 50`) — kills N+1.
- Batched `liked` flag resolution instead of per-row queries.
- Atomic play-count: `incrementPlayCountAtomic(id)` (`UPDATE ... SET play_count = play_count + 1`) — no read-modify-write race.
- Cursor endpoint: `getSongsAfterCursor(cursorId, size, userId)` — keyset on `(createdAt, id)`, no `OFFSET`/`COUNT` per page. First page `cursorId == null`.
- Validation: page `size` clamped server-side; cursor resolved via `findById` so callers never parse timestamps.

### Backend — DB `V23__perf_spotify_indexes.sql` (Flyway, plain `CREATE INDEX IF NOT EXISTS`)

- `idx_songs_active_created (archived, created_at DESC, id)` — default browse.
- `idx_songs_active_playcount (archived, play_count DESC, created_at DESC)` — top charts.
- `idx_songs_active_new (archived, created_at DESC, release_date DESC)` — new releases.
- `idx_songs_active_name (archived, name)` — name lookup.
- `idx_songs_artist_name_trgm` / `idx_songs_album_name_trgm` GIN trigram (needs `V22 pg_trgm`) — fuzzy search.
- `idx_users_email_active (email) WHERE active` — login/session lookup.
- `idx_liked_songs_user_song`, `idx_listening_history_user_song`, `idx_listening_history_user_skipped_played` — liked/history joins.

### Backend — Auth fast path

- Local JWT/user check first; Supabase only as fallback (no network on the hot path).
- `auth-users` cache `10m` (`idx_users_email_active` backs the miss path).
- JWKS cached with TTL + short connect/read timeouts so login never blocks on key fetch.

### Mobile (`AllSongsScreen.tsx`, `songListCache.ts`, `App.tsx`, `utils`)

- `SONGS_PAGE_SIZE = 30` (was 10) — 3× fewer round trips; shared between list + prefetch.
- SWR: MMKV `allSongsData` + `songsAt`, `SONGS_FRESH_MS = 60_000`; React Query `staleTime 5m`, `gcTime 30m`.
- In-flight guard `inFlightRef: Set<number>` — dedupes double `onEndReached` + focus/prefetch races.
- Prefetch at `onEndReachedThreshold 0.7` + `onViewableItemsChanged` when `maxIndex >= songs.length - 8`; `prefetchSongs()` warms cache on login submit/session restore (best-effort, skipped if fresh).
- Skeleton footer (`SongSkeleton ×3`) + `You're all caught up` end-state; `initialNumToRender 10`, `maxToRenderPerBatch 10`, `windowSize 5`, `getItemLayout {length: 60}`, `removeClippedSubviews`.
- Thumbs via `getImageUrl(url, 200)` (Supabase CDN resize) instead of raw full-size `Image`.
- Non-blocking session restore (`loadSession()` fire-and-forget in `App.tsx`); search debounced `300ms` with `AbortController`/supersede semantics (stale responses discarded, local filter merges instantly).

## 4. Never-reload guarantee

- Cache-first render: `useState(() => getCachedSongs())` — list paints from MMKV in `<100ms`, no spinner when cache exists.
- `useFocusEffect`: if `songs.length === 0` → `fetchPage(0, replace=true)`; else if `!isSongsFresh()` → `fetchPage(0, replace=false)` background merge (deduped by id, last-write-wins). **Never wipes the list on focus.**
- Background revalidations merge only; pull-to-refresh is the only explicit `replace=true` path.
- Future: `ETag`/`If-None-Match` on songs pages so warm revalidates return `304` with no body.

## 5. Verify

```bash
# backend tests (cache + SongService + auth slices)
cd backend && mvn -q test

# mobile typecheck
cd mobile && npx tsc --noEmit

# Redis has catalog keys after one cold songs fetch
redis-cli scan 0 MATCH 'spotibase::songs*' COUNT 100

# cold vs warm songs page (first = miss, second = hit)
time curl -s -o /dev/null -w '%{time_total}s %{http_code}\n' \
  'http://localhost:8088/api/songs?page=0&size=30'
time curl -s -o /dev/null -w '%{time_total}s %{http_code}\n' \
  'http://localhost:8088/api/songs?page=0&size=30'

# Redis-down resilience (stop redis, expect 200 from DB, then restart)
docker compose stop redis
curl -s -o /dev/null -w '%{http_code}\n' 'http://localhost:8088/api/songs?page=0&size=30'
docker compose up -d redis
```

Manual: cold launch → songs paint; background app → foreground → list is instant with no flash; scroll to 70% → next page prefetches; pull-to-refresh replaces; login with cached user is local-only fast path.

## 6. SLOs

- Songs cached page: `p95 < 300ms`; cold (DB + index) `p95 < 800ms`.
- Login local fast path: `p95 < 500ms` (no Supabase round trip on hot path).
- Back-nav / focus return within 60s freshness: `<100ms` from MMKV, no network block.
- Redis down: songs + login still `HTTP 200` via DB (degraded latency acceptable, no `500`).
- DB: no sequential scans on `songs` browse/top/new/search hot paths (`EXPLAIN` hits V23 indexes).
