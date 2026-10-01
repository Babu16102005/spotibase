# PERF — Fast Loads (Spotify-like)

Current state: React Query SWR + unified TTLs + cursor paging + parallel
library + slim cards + HTTP caching. This doc is the contract — keep code
and doc in sync.

## 1. How data loading is organised

```
Screen (Home / Library / AllSongs / Search)
  │  paints synchronously from MMKV snapshot (initialData)
  │  useHome / useLibrary / useSongs / useSearch / useLibraryParts
  ▼
React Query cache (staleTime per bucket, gcTime 30m)
  │  stale? → network   fresh? → no network
  ▼
dedupedGet (transport single-flight: identical concurrent GETs share
one promise; AbortSignal requests are never coalesced)
  │  10s reads / 8s search / 30s ceiling / uploads timeout 0
  ▼
Backend: ?fields=card projection → clamped size → Cache-Control + ETag
  ▼
DB: V22 pg_trgm + V23/V25 covering + keyset indexes
```

Key files:

| Layer | File |
|---|---|
| TTL source of truth | `mobile/src/cache/ttl.ts` (`TTL_MS`) |
| Client defaults | `mobile/src/query/queryClient.ts` |
| Key factory (all hooks/prefetch/invalidate use this) | `mobile/src/query/queryKeys.ts` |
| Catalogue | `mobile/src/query/useSongs.ts` |
| Library (merged + granular) | `mobile/src/query/useLibrary.ts` |
| Home / search | `mobile/src/query/useHome.ts`, `mobile/src/query/useSearch.ts` |
| Prefetch helpers | `mobile/src/query/prefetch.ts` |
| Invalidation + mutation hooks | `mobile/src/query/invalidate.ts` |
| Transport dedupe + timeouts | `mobile/src/api/client.ts` (`dedupedGet`, `READ_TIMEOUT_MS`, `SEARCH_TIMEOUT_MS`) |
| Snapshots (instant paint) | `mobile/src/cache/homeFeedCache.ts`, `mobile/src/cache/songListCache.ts`, `readLibrarySnapshot` in `useLibrary.ts` |
| Images / lists | `mobile/src/components/AppImage.tsx`, `mobile/src/components/AppList.tsx`, `coverSource`/`getImageUrl` in `mobile/src/utils/index.ts` |
| Session ↔ cache wiring | `mobile/src/store/authStore.ts` |
| Backend cards | `backend/.../dto/response/SongCardResponse.java` |
| Backend cache/ETag | `SongController`, `HomeController`, `LibraryController`, `SearchController`, `config/EtagConfig.java` |
| DB | `V22__enable_pg_trgm.sql`, `V23__perf_spotify_indexes.sql`, `V25__home_covering_indexes.sql` |

SWR rules every hook follows:

- `initialData` = MMKV snapshot read (synchronous paint, no spinner on warm start).
- `staleTime` = bucket TTL (below); `gcTime` = 30 min (back-nav stays instant).
- `refetchOnWindowFocus: false`, `refetchOnReconnect: true`, `retry: 2` (search: `1`).
- Prefetch from `useFocusEffect` / post-login only fires when the entry is stale (`isFresh` / `getQueryState().dataUpdatedAt` check) and never throws.

## 2. TTL table (ms)

Defined once in `mobile/src/cache/ttl.ts`. Client default `staleTime: 45_000`
in `queryClient.ts` is the midpoint fallback; every hook overrides with its bucket.

| Bucket | TTL | Used by |
|---|---|---|
| `HOME` | `30_000` (30s) | `useHome`, `prefetchHome` |
| `LIBRARY` | `30_000` (30s) | `useLibrary`, `useLibraryParts` (all 5), `prefetchLibrary` |
| `SONGS` | `60_000` (60s) | `useSongs`, `prefetchSongs` / `prefetchNextSongsPage` (MMKV `songsAt` gate) |
| `SEARCH` | `60_000` (60s) | `useSearch` (per debounced query), `prefetchSearchTrending` |

`gcTime` is `30 * 60 * 1000` everywhere. Never declare a local freshness
window — import `TTL_MS` / `isFresh`.

## 3. `?fields=card` usage

`SongCardResponse.isCardView(fields)` — only the exact value `card` projects;
missing/blank/anything else returns `full` (backward-compat default).

Card shape (only these fields):

```json
{ "id": "...", "title": "...", "artistName": "...",
  "coverUrl": "...", "durationMs": 180000, "likeCount": 42 }
```

`likeCount` is `playCount` aliased. `lyrics`, `fileUrl` and all other
full-only fields are dropped — assert with `doesNotExist` (see
`PerfCardCacheTest`).

Where it applies: `GET /songs`, `/songs/cursor`, `/songs/home`,
`/songs/trending`, `/songs/featured`, `/songs/search`, `GET /home`
(projects items in every section), `/library/liked-songs`,
`/library/recent`, `/library/history` (slim + capped).

Use `card` for every scrolling list/tile. Use `full` only for detail screens
(player, song detail) and uploads/admin.

## 4. Cursor pagination

- Endpoint: `GET /songs/cursor?size=<n>&cursorId=<opaque>` (`songApi.getCursor`,
  `fetchSongsPage` in `useSongs.ts`).
- First page omits `cursorId`. Next pages pass the previous page's
  `nextCursor` verbatim (`getNextPageParam`). Page size rides in the query key:
  `['songs', 'infinite', limit]` (`SONGS_PAGE_SIZE`, default 20 in this tree).
- Backend is keyset-based (`SongService.getSongsAfterCursor`, no
  `OFFSET`/`COUNT` per page).
- Fallback: on `404`/`405` (backend without the endpoint) the fetcher switches
  to `songApi.getAll(page, limit)` once and stays in numeric mode for the rest
  of the list (`cursorUnsupported: true`). Any other status rethrows — no
  silent fallback.
- `flattenSongsPages` dedupes by `id` across pages.

## 5. Prefetch usage (`query/prefetch.ts`)

| Helper | Gate | Notes |
|---|---|---|
| `prefetchHome()` | `isFresh(dataUpdatedAt, TTL.HOME)` | `prefetchQuery(['home'])` |
| `prefetchLibrary()` | `isFresh(dataUpdatedAt, TTL.LIBRARY)` | `prefetchQuery(['library'])` |
| `prefetchSongs()` | `isFresh(getSongsAt(), TTL.SONGS)` | `prefetchInfiniteQuery(['songs','infinite',size], pages: 1)` |
| `prefetchNextSongsPage(limit, getNextParam)` | caller-supplied cursor | fetches one page ahead, appends via `setQueryData` (no spinner while scrolling) |
| `prefetchSearchTrending()` | none (cheap, landing data) | warms `['search','trending']` for `SearchScreen` |
| `warmCriticalCaches()` | — | `Promise.allSettled([home, library, songs])` after login / session restore |

Call from `useFocusEffect`, never from render. All helpers are best-effort
(`try/catch`, never block paint). Auth flows warm `home + songs` after
`loadSession` restore and after login/register/socialAuth (which `clear()` first).

## 6. Image sizing — 200 lists / 800 detail

- `coverSource(url, size)` → `getImageUrl(url, size)` → `{ uri }` or bundled
  `PLACEHOLDER_IMAGE` when empty (`mobile/src/utils/index.ts`).
- `getImageUrl` appends `?width=<size>&quality=80` for `supabase.co` CDN URLs
  (resized server-side, edge-cached); other hosts pass through untouched.
- Contract: **lists `coverSource(url, 200)`**, **detail `coverSource(url, 800)`**.
  `SongRow`, `SongCard`, `AlbumCard`, `ArtistCard`, `PlaylistCard` use 200;
  `AlbumScreen`, `PlaylistScreen`, `ArtistScreen`, `PlayerScreen` use 800.
  Default is 200 (`coverSource`) / 300 (`getImageUrl`) — pass explicitly.
- `AppImage` (`components/AppImage.tsx`): `expo-image` fast path when installed
  (`cachePolicy="memory-disk"`, `recyclingKey={id}`, `transition={200}`,
  placeholder) else RN `Image` with identical props. Check with
  `isExpoImageAvailable()`. Never import `expo-image` directly in screens.
- `AppList` (`components/AppList.tsx`): `FlashList` fast path
  (`estimatedItemSize={60}`, `drawDistance={500}`) else tuned `FlatList`
  fallback (strips FlashList-only props). Check with `isFlashListAvailable()`.

## 7. Cache invalidation rules (`query/invalidate.ts`)

Prefix invalidation — `['songs']` also clears `['songs','infinite',…]`,
`['library']` also clears `['library','parts',…]`:

| Helper | Key | Route new code through |
|---|---|---|
| `invalidateSongs()` | `['songs']` | like/unlike/delete/upload |
| `invalidateLibrary()` | `['library']` | + create playlist |
| `invalidateHome()` | `['home']` | song mutations |
| `invalidateSearch()` | `['search']` | search-affecting writes |
| `invalidateAll()` | all | rare, global refresh |
| `clearAllQueries()` → `queryClient.clear()` | teardown | account switch, login/register/socialAuth (before prefetch), logout |

Mutation hooks (all `onSettled`, so failures also refresh):

- `useLikeSong` / `useUnlikeSong` / `useDeleteSong` / `useUploadSongs` →
  songs + library + home.
- `useCreatePlaylist` → library only.

`logout()` (`store/authStore.ts`): `storage.clearAll()` (auth) +
`feedCache.clearAll()` (snapshots incl. persisted queue key) +
`queryClient.clear()` + player `clearQueue()` fire-and-forget, then resets
state. Direct `songApi`/`playlistApi` callers that bypass the hooks must call
the matching `invalidate*` explicitly until migrated.

## 8. Payload budgets

Backend clamps (never trust client `size`):

| Endpoint | Card cap | Full cap |
|---|---|---|
| `GET /songs`, `/songs/cursor`, `/songs/home` | `?fields=card` → **30** | default → **50** |
| `/songs/search`, `GET /search` | — | **20** |
| `/search/suggestions`, `/search/trending` | — | **20** (limit) |

HTTP caching:

- Authenticated (personalised overlay): `Cache-Control: private, max-age=30`
  (`catalogCacheControl(userId)`, library 30s, search 30s).
- Guest / shared: `Cache-Control: public, max-age=60` (home guest feed,
  suggestions, trending).
- ETag: `ShallowEtagHeaderFilter` (`config/EtagConfig.java`) on exact list
  paths only (`/home`, `/library*`, `/songs`, `/songs/cursor`, `/songs/home|search|trending|new-releases|featured`,
  `/search/suggestions`, `/search/trending`). Repeat GETs with `If-None-Match`
  → `304` without JSON. `/songs/{id}/stream` and `/songs/{id}` detail are
  deliberately excluded (own R2 ETag/206 contract).
- DB: V22 enables `pg_trgm`; V23 adds `idx_songs_active_created/playcount/new/name`,
  GIN trigram on `primary_artist_name`/`album_name`, `idx_users_email_active`,
  liked/history composite indexes; V25 adds home covering indexes.
- Client timeouts: reads 10s (`READ_TIMEOUT_MS`), search 8s
  (`SEARCH_TIMEOUT_MS`, non-deduped, `AbortSignal` per keystroke, 300ms debounce
  in `useSearch`), create ceiling 30s, uploads `timeout: 0`.

Budget rule: lists = card + ≤30 items + 200px thumbs; anything heavier needs
a comment explaining why.

## 9. How to verify

Unit / contract (must stay green):

```powershell
# Mobile — 10 tests: cursor size/cursorId/fallback, featured gating, invalidate keys, logout clear
cd mobile; npx jest src/query/perf.test.ts --runInBand

# Backend — 5 tests: card shape + clamps + Cache-Control (songs/cursor/search/suggestions)
cd backend; ./mvnw -q -Dtest=PerfCardCacheTest test
```

Manual (production check):

1. Cold start logged-in → home/library paint instantly from snapshot (no spinner), network only if stale.
2. All Songs scroll → no footer spinner on steady scroll (`prefetchNextSongsPage`), next page arrives before `onEndReached`.
3. Back-nav home → library → home: instant (30m `gcTime`), no refetch within TTL.
4. Like a song → library + home + catalogue refresh (invalidation).
5. Logout → login as another user: no data leakage (cache + snapshots cleared).
6. DevTools: list responses carry `Cache-Control: private, max-age=30` (authed)
   and repeat GETs return `304`; card JSON has no `lyrics`/`fileUrl`;
   images load `?width=200` variants in lists, `?width=800` on detail.
7. Throttle to Slow 3G: search stays cancellable (typing never shows stale
   results), reads fail fast at 10s/8s.

## 10. Expo SDK 57 notes

- Pinned: `expo ~57.0.26`, `react-native 0.86.3`, `react 19.2.3`
  (`mobile/package.json`). Versioned docs:
  https://docs.expo.dev/versions/v57.0.0/ — read before touching native deps.
- `expo-image` and `@shopify/flash-list` are **optional peers** (not in
  `package.json`): enable the fast paths with — never pin manually:

```powershell
cd mobile
npx expo install expo-image
npx expo install @shopify/flash-list
```

- Both wrappers `require()` at runtime and fall back silently, so Expo Go
  (no native module), jest, and web keep working without them. Gating a
  behaviour on the fast path: use `isExpoImageAvailable()` /
  `isFlashListAvailable()`, never a direct import in screens.
- New lists: use `AppList` + `AppImage` + `coverSource(url, 200)` +
  `recyclingKey={id}` from the start. New images: 200 in rows/tiles, 800 on
  detail — the CDN variant, not the original.
