# SpotiBase — Project Progress Report

> **Date:** 27 August 2026  
> **Branch:** `main` @ `ad3a247` (enhancing the fx)  
> **Purpose:** Baseline audit before **AI features integration** — what exists, what is AI-ready, what must change.  
> **Stack:** Spring Boot 3.4.1 (Java 17) + Expo SDK 57 (React Native 0.86 / React 19.2) + PostgreSQL 16 (Supabase) + Cloudflare R2 + Supabase Storage  
> **Report Owner:** OrchestratorAgent (Planner → SystemDesigner → Review workflow)

---

## Table of Contents
1. [Executive Summary](#1-executive-summary)
2. [Repository Snapshot](#2-repository-snapshot)
3. [Architecture — As Built](#3-architecture--as-built)
4. [Progress Dashboard](#4-progress-dashboard)
5. [Backend Deep Dive (113 source files)](#5-backend-deep-dive)
6. [Mobile / Web PWA Deep Dive](#6-mobile--web-pwa-deep-dive)
7. [Database & Migrations](#7-database--migrations)
8. [Infrastructure, DevOps & CI/CD](#8-infrastructure-devops--cicd)
9. [Storage & Free-Tier Safety](#9-storage--free-tier-safety)
10. [Realtime System (STOMP)](#10-realtime-system)
11. [Testing & Quality Gates](#11-testing--quality-gates)
12. [Current AI State — Audit](#12-current-ai-state--audit)
13. [AI Integration Readiness & Gap Analysis](#13-ai-integration-readiness--gap-analysis)
14. [Recommended AI Feature Backlog](#14-recommended-ai-feature-backlog)
15. [Concrete Integration Plan (AI Phase)](#15-concrete-integration-plan-ai-phase)
16. [Risks, Tech Debt & Open Issues](#16-risks-tech-debt--open-issues)
17. [Artifacts Inventory](#17-artifacts-inventory)
18. [Next 30 / 60 / 90 Days](#18-next-30--60--90-days)
19. [Appendix](#19-appendix)

---

## 1. Executive Summary

SpotiBase is **functionally complete as a Spotify-class streaming platform** (auth, catalog, player, queue, playlists, search, home feed, library, downloads, notifications, admin, realtime collaboration, offline-ready mobile + web PWA). The monorepo builds and ships via 3 paths (Windows launcher, `docker-compose.yml` dev, `docker-compose.prod.yml` prod with nginx).

**Overall completion: ~82%**

| Domain | Status | Notes |
|---|---|---|
| Backend REST API | **90%** | 15 controllers · 16 services · Flyway 20 migrations · Swagger live |
| Database | **95%** | `supabase-schema.sql` + V1-V20 Flyway, FTS + trigram indexes, denormalized cache fields |
| Mobile / PWA | **80%** | Expo SDK 57, 14 screens, ~35 components, Zustand + TanStack Query, MMKV offline, TrackPlayer + Shaka |
| Realtime | **85%** | STOMP `/ws` presence + queue sync + collaborative playlists |
| Storage | **95%** | R2 (songs, Range streaming) + Supabase Storage (covers/avatars) + 9.5 GB safety cap |
| Infra / DevOps | **85%** | Docker dev+prod, nginx rate-limit, 3 GitHub Actions workflows, Vercel + EAS hooks |
| **AI** | **30%** | Dependency present but **auto-config disabled**, no `ChatClient` wiring, heuristic recommendations only |
| Testing | **85%** | 323 backend JUnit + 119 Jest + 48 PowerShell smoke tests; CI runs all |

**AI Verdict:** The platform is *AI-wiring ready* but **not AI-feature ready**. `OPENAI_API_KEY` is plumbed through `.env.example`, `application.yml`, and `docker-compose.*`, and `spring-ai-openai-spring-boot-starter:1.0.0-M5` is on the classpath — but `OpenAiAutoConfiguration` is explicitly **excluded**, no service injects `ChatClient`/`ChatModel`, and `RecommendationService` is pure SQL-heuristic (collaborative filtering via native queries). Enabling AI is a **contained, low-risk change** — no schema rework required, but you should add a vector path if you want semantic search / embeddings.

> **Uncommitted changes at audit time:** `application.yml`, `V18__create_indexes.sql`, `V19__add_contributing_artists_and_denormalized_fields.sql` are modified and not yet committed. Commit or stash before branching `feat/ai`.

---

## 2. Repository Snapshot

```
D:\babu_projects\spotibase
├── backend/                 # Spring Boot 3.4.1, Java 17, Maven, Dockerfile
│   ├── src/main/java/com/spotibase   # 113 .java sources
│   ├── src/main/resources             # application.yml + db/migration V1..V20
│   ├── src/test/java                 # 24 test classes (323 tests)
│   ├── target/spotibase-backend-1.0.0.jar
│   ├── Dockerfile, run-prod.ps1, run-local.ps1
│   └── pom.xml
├── mobile/                  # Expo SDK 57, React 19.2, RN 0.86, TS 6
│   ├── src/                 # screens, components, store, api, hooks, realtime, theme, utils
│   ├── dist-prod/           # expo export --platform web
│   ├── scripts/postexport.js
│   ├── Dockerfile.web
│   └── package.json
├── nginx/prod.conf          # SSL, rate-limit api/auth/stream, /ws/ proxy (24h timeout)
├── docker-compose.yml       # dev: postgres:5433, backend:8080, redis:6379
├── docker-compose.prod.yml  # prod: postgres, redis, backend:8088, mobile-web:3000, nginx?
├── supabase-schema.sql      # canonical DDL (18 versions, 425 lines)
├── supabase/                # Supabase CLI config
├── docs/                    # setup.md, api-overview.md, deployment.md, testing.md
├── tests/prod-smoke-tests.ps1  # 48 smoke tests
├── .github/workflows/       # ci.yml, backend.yml, mobile.yml, eas-build.yml
├── serve-frontend.js        # static PWA server (SPA fallback)
├── run-project.ps1 / .bat   # one-command production launcher
├── .env / .env.example      # 124-line documented env template
└── bulk_upload_flac.py, scan_flac*.py, read_flac_metadata.py
```

**Git head:**
```
ad3a247 enhancing the fx
d0fb136 more changes
7f87218 ci: diagnostic v2 for npm ci failure
... (main, 17 commits since Initial commit)
```

---

## 3. Architecture — As Built

```
 ┌──────────────────────────────┐      ┌──────────────────────────────┐
 │  Mobile (Expo SDK 57)        │      │  Web PWA (expo export)       │
 │  iOS / Android / Web         │      │  :3000 (serve-frontend.js)   │
 └──────────────┬───────────────┘      └──────────────┬───────────────┘
                │ REST /api/v1 + STOMP /ws              │
                └──────────────────┬────────────────────┘
                                   ▼
                  ┌─────────────────────────────────┐
                  │  nginx reverse proxy (prod)     │
                  │  SSL · rate-limit · /ws/ (24h)  │
                  └───────────────┬─────────────────┘
                                  │ :8088
                  ┌───────────────▼──────────────────┐
                  │  Spring Boot 3.4.1 (Java 17)     │
                  │  15 Controllers · 16 Services    │
                  │  Security (JJWT 0.12.6)          │
                  │  WebSocket (STOMP)               │
                  │  Flyway · MapStruct · Bucket4j  │
                  │  Spring AI (OpenAI starter M5)  │◄── DISABLED
                  └──────┬───┬───┬───┬──────┬───────┘
                         │   │   │   │      │
              ┌──────────┘   │   │   │      └──────────┐
              ▼              ▼   ▼   ▼                 ▼
        ┌──────────┐  ┌──────┐ ┌───┐ ┌──────────┐ ┌──────────┐
        │ Postgres │  │Redis7│ │ R2│ │ Supabase │ │ OpenAI   │
        │ Supabase │  │(not │ │S3 │ │ Storage  │ │ gpt-4o-  │
        │ pooler   │  │wired)│ │Range│ │ covers/  │ │ mini     │
        │ 16-alpine│  │     │ │   │ │ avatars  │ │ (key     │
        └──────────┘  └──────┘ └───┘ └──────────┘ │ present) │
                                                  └──────────┘
```

### 3.1 Request Flow

| Path | Flow |
|---|---|
| **Auth** | `POST /api/v1/auth/*` → `AuthController` → `AuthService` + `JwtTokenProvider` → `users` table · JWT 24h/30d |
| **Catalog** | `Song/Album/ArtistController` → Service → JPA + `R2StorageService`/`StorageService` + jaudiotagger metadata |
| **Search** | `SearchController` → `SearchService` (FTS `tsvector` + `pg_trgm` trigram, filters `language/year/genre/sort`) |
| **Home feed** | `HomeController` → `RecommendationService.getHomeSections()` → native SQL collaborative filtering + `LikeRepository` + `ListeningHistory` |
| **Realtime** | SockJS+raw WS `/ws` → `WebSocketConfig` (broker `/topic,/queue,/user`, app prefix `/app`) → `RealtimeService` + `RealtimeController` |
| **Streaming** | `GET /songs/{id}/stream` (public) → 302 to R2 Range URL or signed Supabase URL → increments `play_count` |

---

## 4. Progress Dashboard

| Feature Group | Sub-features | Progress | Evidence |
|---|---|---|---|
| **Auth** | register, login, JWT pair, refresh, forgot/reset, Google/Apple social | **95%** | `AuthController` (6 endpoints), `JwtTokenProvider`, `JwtAuthenticationFilter`, `CustomUserDetailsService`, Apple `client-id` config |
| **Users** | profile CRUD, avatar/cover upload, follow graph, stats | **90%** | `UserController` 12 endpoints, `UserService`, `followers` table |
| **Songs** | CRUD, FLAC 50→250MB, jaudiotagger, trending/new/featured, like, stream 302 | **92%** | `SongController` 13 endpoints, `SongService`, `R2StorageService`, `StorageService` |
| **Albums** | CRUD, liked, featured/new-releases, soft delete | **90%** | `AlbumController`, `AlbumService` |
| **Artists** | CRUD (admin), follow, top/featured | **88%** | `ArtistController`, `ArtistService` |
| **Playlists** | CRUD, duplicate/merge/reorder, public/collab toggles, collaborators, featured (public) | **93%** | `PlaylistController` 17 endpoints, `PlaylistSong`, `PlaylistCollaborator` |
| **Queue** | get/add/play-next/remove/move/clear/save+restore | **90%** | `QueueController` 9 endpoints, `QueueService`, MMKV cache 100 cap |
| **Library** | playlists/albums/artists/liked-songs/recent/history | **90%** | `LibraryController` 7 endpoints |
| **Search** | FTS + trigram, filters, suggestions & trending (public) | **92%** | `SearchService`, `V18` GIN indexes, `SearchController` 3 endpoints |
| **Home** | personalized sections + daily mixes | **90%** | `HomeController` → `RecommendationService` (8 methods: dailyMix, weeklyMix, discoverWeekly, releaseRadar, madeForYou, similarSongs, recommendedSongs, basedOnListening) |
| **Downloads** | per-song quality, stats, offline play tracking | **88%** | `DownloadController` 7 endpoints, `DownloadService` |
| **Notifications** | list/unread/mark-read + STOMP push | **85%** | `NotificationController`, `NotificationService`, `/user/queue/notifications` |
| **Admin** | dashboard, users/roles, moderation, featured, analytics (overview/growth/top-*) | **88%** | `AdminController` 11 endpoints, `AdminService` |
| **Realtime** | presence, cross-device queue, collab playlist | **85%** | `RealtimeController`, `RealtimeService`, `WebSocketConfig` |
| **Settings** | streaming/download quality, theme, audio prefs | **85%** | `SettingsController`, `SettingsService` |
| **Storage safety** | 9.5 GB cap (of 10 GB free tier), badge + progress bar | **95%** | `StorageService` + `SongService.createSongsBulk` both enforce `SUM(s.fileSize)` check |
| **Offline** | MMKV cache, queue save/restore, downloads | **82%** | `getStorage('spotibase-cache')`, `homeCache`, `queueStorage` |
| **PWA** | expo export + service worker + manifest | **80%** | `mobile/dist-prod`, `serve-frontend.js`, `scripts/postexport.js` |
| **AI** | prompt → recommendation | **30%** | starter on classpath, config key present, auto-config **excluded** |

**Single metric:** if you cut a release today, you ship a **usable Spotify clone**; AI would be the *differentiator*, not a blocker.

---

## 5. Backend Deep Dive

**Build:** `pom.xml` — `spring-boot-starter-parent:3.4.1`, `java.version:17`, `jjwt:0.12.6`, `mapstruct:1.6.3`, `springdoc:2.7.0`, `aws-s3-sdk:2.29.9`, `jaudiotagger:2.0.3`, `bucket4j:8.7.0`, `spring-ai-openai:1.0.0-M5` (BOM).  
**Sources:** 113 `*.java` under `com.spotibase` across 9 packages.

### 5.1 Layer Breakdown

| Layer | Files | Key Classes |
|---|---|---|
| `controller` | 15 | `AuthController`, `UserController`, `SongController`, `AlbumController`, `ArtistController`, `PlaylistController`, `QueueController`, `LibraryController`, `SearchController`, `HomeController`, `NotificationController`, `DownloadController`, `SettingsController`, `AdminController`, `RealtimeController` |
| `service` | 16 | `AuthService`, `UserService`, `SongService`, `AlbumService`, `ArtistService`, `PlaylistService`, `QueueService`, `SearchService`, `RecommendationService`, `LikeService`, `NotificationService`, `DownloadService`, `SettingsService`, `AdminService`, `StorageService`, `R2StorageService`, `RealtimeService`, + 2 schedulers (`RecentlyPlayedCleanupScheduler`, `OrphanStorageCleanupScheduler`) |
| `entity` | ~22 | `User`, `Song`, `Album`, `Artist`, `Genre`, `Playlist`, `PlaylistSong`, `PlaylistCollaborator`, `SongContributingArtist`, `Queue`, `ListeningHistory`, `RecentlyPlayed`, `Notification`, `Download`, `UserSetting`, `Role`, `ContributionRole`, ... |
| `repository` | ~20 | `UserRepository`, `SongRepository`, `AlbumRepository`, `ArtistRepository`, `GenreRepository`, `PlaylistRepository`, `PlaylistCollaboratorRepository`, `LikeRepository`, `NotificationRepository`, `DownloadRepository`, `UserSettingRepository`, ... + native queries in `RecommendationService` via `EntityManager` |
| `security` | 5 | `SecurityConfig`, `JwtTokenProvider`, `JwtAuthenticationFilter`, `CustomUserDetailsService`, `CustomUserDetails`, `CurrentUser` |
| `config` | 5 | `AppConfig`, `WebConfig`, `WebSocketConfig`, `RedisConfig` (disabled), `OpenApiConfig` |
| `dto` | ~20 | `request/*` (Register, Login, CreateSong, CreateAlbum, CreatePlaylist, Update*, SearchRequest, Requeue...) + `response/*` (SongResponse, AlbumResponse, HomeResponse, SearchResponse, PagedResponse...) |
| `exception` | — | `GlobalExceptionHandler` + `ErrorResponse` (uniform `{error,message,path,validationErrors}`) |
| `mapper` | — | MapStruct mappers |
| `util` | — | helpers |

### 5.2 API Surface (from `docs/api-overview.md` + controllers)

Base path `/api/v1` · `Content-Type: application/json` · Auth: `Bearer <accessToken>` · Errors via `ErrorResponse` · Pagination `PagedResponse {content,page,size,totalElements,totalPages,first,last}` · Live docs at `/swagger-ui/index.html` and `/api-docs`.

| Group | Method coverage | Auth note |
|---|---|---|
| `auth` | 6 endpoints (register/login/refresh/social/forgot/reset) | public |
| `users` | 12 endpoints (`/me`, avatar/cover, follow graph) | JWT |
| `songs` | 13 endpoints (CRUD + trending/new/featured/like/stream) | ARTIST/ADMIN for writes, stream is public 302 |
| `albums` | 9 endpoints | ARTIST/ADMIN writes |
| `artists` | 8 endpoints | ADMIN writes |
| `playlists` | 17 endpoints (duplicate/merge/reorder/collab/featured public) | JWT |
| `queue` | 9 endpoints | JWT |
| `library` | 7 endpoints | JWT |
| `search` | 3 endpoints (`/?query&types&filters`, `/suggestions` public, `/trending` public) | mixed |
| `home` | 1 endpoint `GET /` | JWT (guest-safe) |
| `notifications` | 4 endpoints | JWT |
| `downloads` | 7 endpoints | USER+ |
| `settings` | 3 endpoints | JWT |
| `admin` | 11 endpoints (dashboard/users/role/feature/analytics) | ADMIN |
| `ws` | `/ws` STOMP (SockJS + raw) | session-bound |

### 5.3 Notable Implementation Details

- **JWT:** `JwtTokenProvider` hardcoded 24h access / 30d refresh in `application.yml` (`jwt.expiration:86400000`, `refresh-expiration:2592000000`) — `.env.example` documents `JWT_EXPIRATION`/`JWT_REFRESH_EXPIRATION` but app reads `jwt.*`; `.env` mismatch noted.
- **Multipart:** `spring.servlet.multipart.max-file-size:250MB`, `max-request-size:300MB` (README still says 50 MB — update before launch).
- **Hikari:** aggressive cycling (`idle-timeout:15s`, `max-lifetime:30s`) to survive Supabase pooler drops.
- **Flyway:** `baseline-on-migrate:true`, `baseline-version:18`, `validate-on-migrate:false` — legacy `supabase-schema.sql` is the baseline.
- **Rate limiting:** `Bucket4j` dependency present; nginx prod also rate-limits `api/auth/stream`.
- **CORS:** `app.cors.allowed-origins` from `CORS_ALLOWED_ORIGINS` (default `localhost:3000, localhost:8081, exp://…`).

---

## 6. Mobile / Web PWA Deep Dive

**Toolchain:** `Expo SDK 57`, `React 19.2.3`, `React Native 0.86.2`, `TypeScript 6.0.3`, `Zustand 5`, `TanStack Query 5`, `axios 1.18`, `@stomp/stompjs 7.3`, `react-native-track-player 5 alpha`, `shaka-player 4.16`, `react-native-mmkv 4.3`, `react-native-reanimated 4.5`, `gesture-handler 2.32`.  
**Scripts:** `start`, `android`, `ios`, `web`, `web:build` (`expo export --platform web --output-dir dist-prod && node scripts/postexport.js`), `web:serve`, `test --runInBand`, `lint`, `typecheck`.

### 6.1 Structure

```
mobile/src
├── screens/   admin, album, artist, auth (Login/Register/socialAuth), home, library (+Downloads),
│              notifications, player, playlist, profile, search, settings, songs (AllSongs)
├── components/  SongCard/Row, AlbumCard, ArtistCard, PlaylistCard, PlayerSheet, MiniPlayer, PlayBar,
│               SongRow, SongUploader, DownloadButton, BulkAddToPlaylistModal, SongBulkActionBar,
│               GlobalBulkSelectionBar, Sidebar, SectionHeader, SkeletonLoader, TimelineLoadingBeam,
│               Aurora/SoftAurora/Velaris/VelarisShader/MoltenMetal, GlassButton, Icon, GreetingHeader
├── store/     authStore, playerStore (TrackPlayer + shaka, queue 100 cap, MMKV cache),
│              notificationStore, downloadStore, selectionStore, themeStore
├── api/       client.ts (axios, BASE_URL → EXPO_PUBLIC_API_URL fallback http://localhost:8088/api/v1,
│              homeApi, searchApi, queueApi, songApi, ...)
├── realtime/  client.ts (stompjs, /ws)
├── hooks/     useAuth, usePlayer
├── navigation/ RootNavigator
├── theme/     tokens
├── utils/     playerSharedValue, getStorage, getGreeting
└── types/     HomeSection, SongResponse, PlaybackState, ...
```

### 6.2 Player & Offline

- `playerStore.ts` wraps `react-native-track-player` (native) + `shaka-player` (web) with `MAX_QUEUE_CAPACITY=100`, MMKV persistence under `spotibase_queue_cache`, `playMultiple`, shuffle/repeat/volume, mini-player expand state.
- `homeCache` (`homeData`) and `queueStorage` keep last home feed and queue across cold starts.
- `DownloadsScreen` + `downloadStore` track per-song quality and `PUT /downloads/{songId}/play` for offline play counting.

### 6.3 Styling & Effects

Custom visual layer (`Aurora`, `VelarisShader`, `MoltenMetal`) — keep GPU budgets in mind when adding AI-spun visuals (e.g., cover generation).

---

## 7. Database & Migrations

**Engine:** PostgreSQL 16 (`postgres:16-alpine`). Prod uses Supabase pooler (`aws-1-ap-south-1.pooler.supabase.com:6543`, session mode, IPv4-safe).  
**Migrations:** Flyway `classpath:db/migration` — **V1..V20** committed; baseline 18 so V19+V20 apply on migrate.

| Version | Table / Change |
|---|---|
| V1 | `users` + `user_favorite_genres` |
| V2 | `genres` |
| V3 | `artists` |
| V4 | `albums` (featured/archived/type) |
| V5 | `songs` (FTS `fts_vector`, play_count, file metadata) |
| V6 | `playlists` |
| V7 | `playlist_songs` (position unique) |
| V8-10 | `liked_songs`, `liked_albums`, `liked_artists` |
| V11 | `followers` (self-follow check) |
| V12 | `listening_history` (duration, source, skipped) |
| V13 | `recently_played` (item_type/item_id) |
| V14 | `queues` |
| V15 | `notifications` (type, data_json JSONB) |
| V16 | `downloads` (quality/status) |
| V17 | `user_settings` |
| V18 | trigram indexes (`pg_trgm`), `update_updated_at` trigger |
| **V19** | `song_contributing_artists` M2M + `songs.album_artist_id`, `primary_artist_name`, `album_name`, `cover_url_cached` + home/artist/album composite indexes |
| **V20** | `liked_playlists` |

**Indexes of note:** `GIN(fts_vector)`, `GIN(name gin_trgm_ops)` on songs/artists/albums, `idx_songs_home_feed (archived, featured DESC, release_date DESC) WHERE archived=FALSE`, `idx_songs_artist_page`, `idx_songs_album_page (disc_number, track_number)`.

**Current DDL drift:** `V18` and `V19` are modified in working tree (diff: index rework + contributing-artists backfill). Flyway `validate-on-migrate:false` masks this — reconcile before `feat/ai` branches.

---

## 8. Infrastructure, DevOps & CI/CD

### 8.1 Docker

| Compose | Services | Ports | Notes |
|---|---|---|---|
| `docker-compose.yml` (dev) | `spotibase-db` (postgres:16), `spotibase-backend` (:8080), `redis:7` | 5433→5432, 8080, 6379 | Backend builds from `backend/Dockerfile`; migrations volume-mounted; requires `.env` Supabase + R2 + OpenAI keys |
| `docker-compose.prod.yml` | `postgres`, `redis`, `backend` (:8088), `mobile-web` (:3000), `nginx` (optional profile `proxy`) | 8088, 3000, 80/443 | Self-contained; merge with dev file fails (duplicate `spotibase-redis` name) — run standalone |

**Launcher:** `run-project.ps1` (builds jar if missing `mvn clean package -DskipTests`, starts backend on :8088, exports web if missing, serves on :3000, runs 48 smoke tests; flags `-Stop`, `-SkipTests`) + `run-project.bat` wrapper.

### 8.2 nginx (`nginx/prod.conf`)

- SSL termination, rate-limit zones `api/auth/stream`, `/ws/` proxy with `24h` read timeout, :8088 backend, :3000 web.

### 8.3 CI/CD (`.github/workflows/`)

| Workflow | Triggers | Jobs |
|---|---|---|
| `ci.yml` | push/PR → `main`/`develop` | `validate` path detection → `backend` + `mobile` → `docker-compose-test` (build both images, Postgres+backend on :8088, health-check) → `notify` |
| `backend.yml` | push/PR | Postgres 16 service, `mvn test` with `spring.profiles.active=test`, package jar, `ghcr.io` push, deploy-staging/production hooks |
| `mobile.yml` | push/PR | lint+typecheck, Jest coverage, `expo export` verify `index.html/manifest.json/sw.js`, EAS Android/iOS, Vercel preview/prod |
| `eas-build.yml` | — | EAS native builds |

> README notes `eas.json` is not committed — CI injects from secret; create locally for personal builds.

---

## 9. Storage & Free-Tier Safety

| Bucket | Provider | Content | Access |
|---|---|---|---|
| **Songs** | Cloudflare R2 (S3 API, `aws-sdk:s3:2.29.9`) | `songs/*`, Range streaming | `R2StorageService` 302 redirect, `Range` header passthrough |
| **Covers/Avatars** | Supabase Storage (S3-compatible) | `covers/*`, `avatars/*` | `StorageService` via Supabase S3 API |

**Free-tier guard (10 GB):** hard cap at **9.5 GB** (10,200,547,328 bytes). Both `StorageService.uploadSong` and `SongService.createSongsBulk` run `SELECT SUM(s.fileSize) WHERE archived=FALSE` and reject with `400 Storage limit reached (9.5 GB safety cap…)` when exceeded. Admin dashboard shows live progress bar (% of 10 GB, badge `FREE TIER ACTIVE` vs `UPLOADS RESTRICTED`); uploader disables automatically. Covers/avatars are not counted — monitor separately.

---

## 10. Realtime System

**Endpoint:** `/ws` (registered both SockJS and raw WS; no HTTP auth gate — STOMP session carries identity).  
**Config:** `WebSocketConfig` — broker prefixes `/topic,/queue,/user`, app prefix `/app`, `enableSimpleBroker` + `setUserDestinationPrefix("/user")`.

| Direction | Destination | Payload | Purpose |
|---|---|---|---|
| Client → `/app/presence.online` | — | mark online, broadcast |
| Client → `/app/presence.offline` | — | mark offline |
| Client → `/app/queue.sync` | `playbackState` | cross-device sync |
| Client → `/app/playlist.{id}.edit` | edit payload (+ server-added `editor`) | collab edit |
| Client → `/app/playlist.{id}.join/leave` | — | `MEMBER_JOINED/LEFT` |
| Server → `/topic/presence` | `{userId, online}` | presence fan-out |
| Server → `/topic/playlists/{id}` | edit / membership | playlist live |
| Server → `/user/queue/notifications` | `Notification` | `RealtimeService.pushNotification` |
| Server → `/user/queue/queue-updates` | `{type:QUEUE_SYNC, data, from}` | `RealtimeService.pushQueueUpdate` |

Mobile: `mobile/src/realtime/client.ts` via `@stomp/stompjs`.

---

## 11. Testing & Quality Gates

| Suite | Location | Count | Command | CI |
|---|---|---|---|---|
| **Backend JUnit 5** | `backend/src/test/java` (service/controller/security/dto/exception/support) | **323** `@Test` | `cd backend; mvn test` | `backend.yml` with `spring.profiles.active=test` + Postgres 16 service |
| **Mobile Jest** | `mobile/src/**/*.test.tsx` (components, stores, utils, api, screens) | **119** | `cd mobile; npm test -- --runInBand` | `mobile.yml` (lint→typecheck→jest coverage→export) |
| **Prod smoke** | `tests/prod-smoke-tests.ps1` | **48** | `powershell -ExecutionPolicy Bypass -File tests\prod-smoke-tests.ps1` | `-SkipTests` flag in launcher |
| **Lint / types** | `mobile` | — | `npm run lint` / `npm run typecheck` | `mobile.yml` |

CI also has `docker-compose-test` (build images, boot Postgres+backend on :8088, health-check) gated behind `validate`.

**Coverage gaps to close before AI:** no contract tests for `/ws`, no R2/Supabase storage integration test, no load test for 302 streaming, no vector/embedding regression suite yet.

---

## 12. Current AI State — Audit

### 12.1 What exists

| Artifact | Value |
|---|---|
| **Dependency** | `spring-ai-openai-spring-boot-starter:1.0.0-M5` + `spring-ai-bom:1.0.0-M5` in `backend/pom.xml` |
| **Config key** | `spring.ai.openai.api-key: ${OPENAI_API_KEY}` + `chat.options.model:gpt-4o-mini` + `temperature:0.7` in `application.yml` |
| **Env plumbing** | `OPENAI_API_KEY` in `.env.example`, `docker-compose.yml`, `docker-compose.prod.yml`, `backend/run-prod.ps1` |
| **Domain** | No dedicated AI table/column yet; recommendations derive from `listening_history` + `liked_*` + `user.favoriteGenres` |
| **Heuristic recsys** | `RecommendationService` — 8 methods, all **pure SQL** (native `EntityManager` queries), no LLM call |
| **Docs** | README Tech Stack lists `Spring AI (OpenAI starter)`; `application.yml` comments call out Redis disabled in favor of simple cache |

### 12.2 What is disabled / missing

```yaml
# application.yml — this exclusion is the gate
spring:
  autoconfigure:
    exclude:
      - org.springframework.ai.autoconfigure.openai.OpenAiAutoConfiguration
      - org.springframework.boot.autoconfigure.data.redis.RedisAutoConfiguration
```
- **No bean:** `ChatClient`, `ChatModel`, `OpenAiChatModel`, `VectorStore`, `EmbeddingModel` — none are injectable while excluded.
- **No controller/service:** no `AiController`, no `AiService`, no prompt templates, no `spring.ai.vectorstore` config.
- **No frontend surface:** no `aiApi` in `mobile/src/api/client.ts`, no AI screen/component.
- **No persistence for AI:** no `ai_conversations`, `ai_playlists`, `song_embeddings` tables; no `pgvector` extension.
- **Stale starter:** `1.0.0-M5` is a milestone; current Spring AI is **1.0.x GA** (breaking package moves from `org.springframework.ai.autoconfigure.openai` → `org.springframework.ai.openai.autoconfigure`).

### 12.3 How `RecommendationService` works today (so you know what AI will replace/augment)

```
getDailyMix()       → top genres from listening_history (skipped=false) → 30 unheard songs per genre by play_count
getWeeklyMix()      → users with overlapping taste (top 10) → random 30 they heard that you haven't
getDiscoverWeekly() → user's favoriteGenres + country→language → 30 popular unheard
getReleaseRadar()   → liked_artists → songs release_date >= now-2w
getMadeForYou()     → 5 most-recent genres → 30 popular unheard
getSimilarSongs()   → same genre, nearest play_count
getRecommendedSongs()→ genre OR language overlap → 30 by play_count (fallback: global top)
getBasedOnListening()→ last 10 unskipped plays → genre expansion
getHomeSections()   → composes the above into HomeResponse sections
```
All fast, deterministic, and testable — keep them as **fallbacks** when LLM is unavailable.

---

## 13. AI Integration Readiness & Gap Analysis

### 13.1 Readiness Matrix

| Capability | Ready? | Detail |
|---|---|---|
| Secrets management | ✅ | `OPENAI_API_KEY` already in `.env` + compose + launcher |
| Model config | ✅ (disabled) | `gpt-4o-mini`, `temperature:0.7` in `application.yml` |
| HTTP client | ✅ | `spring-boot-starter-webflux` (WebClient) on classpath for streaming |
| User context | ✅ | `listening_history`, `liked_songs/albums/artists/playlists`, `recently_played`, `user_settings`, `user.favoriteGenres` all queryable |
| Catalog text | ✅ | `songs.name`, `artists.name`, `albums.name`, `genres.name`, `songs.language/composer/lyrics` — FTS vectors exist |
| Streaming infra | ✅ | Can surface AI suggestions inline with existing `homeApi` / `searchApi` |
| Realtime | ✅ | Can push AI playlist updates over existing STOMP `pushNotification` |
| **Auto-config** | ❌ | Excluded — must be re-enabled |
| **Vector search** | ❌ | No `pgvector`, no `song_embeddings`, no `EmbeddingModel` |
| **Prompt layer** | ❌ | No `PromptTemplate` / system prompt / guardrails |
| **Eval & cost caps** | ❌ | No token budget, rate-limit, or fallback metrics |
| **Mobile UI** | ❌ | No AI entry points (chat, prompt bar, AI playlist badge) |

### 13.2 Decisions to make before coding

| Decision | Options | Recommendation |
|---|---|---|
| **Spring AI version** | Stay at M5 vs upgrade to 1.0.x GA | **Upgrade to 1.0.0+ GA** (Milestone is EOL, auto-config packages moved) |
| **Vector store** | Postgres `pgvector` vs in-memory SimpleVectorStore vs Redis (currently disabled) vs external Pinecone/Weaviate | **Start simple:** `SimpleVectorStore` seeded from catalog for MVP; migrate to `pgvector` when embedding count > 10k |
| **Embeddings source** | OpenAI `text-embedding-3-small` vs local | **OpenAI `text-embedding-3-small`** to match `gpt-4o-mini` billing |
| **LLM scope** | Home + Search only vs full platform (playlist title/description, mood tags, chatbot) | **Phase 1:** Home + Search + AI Playlist; defer chatbot |
| **Cost guard** | Token cap / user, daily global cap | **Bucket4j** per-user + global cap, fallback to heuristic `RecommendationService` |
| **Persistence** | New tables vs reuse | **Add** `ai_playlists`, `ai_conversations` (optional), `song_embeddings` (optional) — keep existing tables untouched |
| **Frontend** | New tab vs inline | **Inline** — AI sections inside `HomeScreen`, prompt bar inside `SearchScreen` |

---

## 14. Recommended AI Feature Backlog

Prioritized for a solo/small-team build. Each is a vertical slice (backend + mobile).

| # | Feature | Backend | Mobile | Effort | Value |
|---|---|---|---|---|---|
| **A1** | **AI Home Sections** — replace/augment 2–3 `RecommendationService` sections with LLM-curated mixes (“Because you’ve had a lo-fi morning”, “Rainy 11pm mix”) | `AiRecommendationService` calling `ChatClient` with user taste snapshot (top genres/artists, recent plays) + catalog sample; prompt returns `{title, subtitle, reason, songIds[]}`; fallback to heuristic | `HomeScreen` renders AI badges, reason line, retry | M | High |
| **A2** | **Semantic Search** — natural-language queries (“80s workout funk with slap bass”, “sad Bengali rain songs”) | Optional embeddings: embed query + pre-embedded catalog; re-rank FTS hits via LLM; else LLM query → structured filter `{genre, language, mood, year}` → `SearchService` | `SearchScreen` “AI Search” toggle + chip preview | M | High |
| **A3** | **AI Playlist Generate** — “make me a 20-song coding playlist, no vocals, 120 BPM feel” | `POST /api/v1/ai/playlists` (prompt, length, explicit filter) → LLM → validate songIds → create `Playlist` (type `AI`) → push STOMP | New `AiPlaylistSheet` / reuse `PlaylistScreen` with AI badge & regenerate | M | High |
| **A4** | **Playlist Title & Description Writer** | `POST /api/v1/ai/playlist/{id}/describe` | Inline in `PlaylistScreen` (magic-wand button) | S | Med |
| **A5** | **Mood / Tag Auto-Label** | Batch background job embeddings → mood tags → `songs` new column or join table | Search filters + song overflow menu | M | Med |
| **A6** | **Ask SpotiBase (Chatbot)** — scoped music concierge (not open-ended) | `POST /api/v1/ai/chat` with conversation history + tool calls (search, play, playlist) → `ChatClient` + function callbacks | Dedicated `AiChatScreen` wired to STOMP | L | Med |
| **A7** | **Embeddings + pgvector** | Migration `V21__pgvector`, backfill job | — | L | Foundational |
| **A8** | **Voice prompt** (mobile `expo-speech` → transcript → A2/A3) | — | `expo-speech` + `expo-audio` | L | Low (phase 2) |

**MVP cut:** **A1 + A2 (no embeddings) + A3 + A4** = shippable AI in ~1–2 weeks solo. Add A7/A5/A6 after.

---

## 15. Concrete Integration Plan (AI Phase)

### 15.1 Backend — Step-by-Step (do in order)

**Step 0 — Baseline commit**
```powershell
git add backend/src/main/resources/application.yml `
       backend/src/main/resources/db/migration/V18__create_indexes.sql `
       backend/src/main/resources/db/migration/V19__add_contributing_artists_and_denormalized_fields.sql
git commit -m "chore: reconcile migration drift before ai branch"
git checkout -b feat/ai
```

**Step 1 — Upgrade & re-enable Spring AI**
- Bump `spring-ai-bom` + `spring-ai-openai-spring-boot-starter` from `1.0.0-M5` → `1.0.1` (latest GA at time of writing).
- Remove `OpenAiAutoConfiguration` from `spring.autoconfigure.exclude` (keep Redis disabled).
- Verify `application.yml` keys still bind (package may move to `spring.ai.openai` — check `spring-ai-docs`).

**Step 2 — Core AI service**
```java
// com.spotibase.service.AiRecommendationService
@Service @RequiredArgsConstructor @Slf4j
public class AiRecommendationService {
  private final ChatClient chatClient;        // from Spring AI
  private final RecommendationService fallback;
  private final SongRepository songRepository;
  // getAiHomeSections(userId) — build taste snapshot, call ChatClient with system+user prompt,
  // parse JSON {sections:[{title,reason,songIds[]}]}, validate ids, fallback on error/timeout
}
```
- System prompt: scoped (“You are SpotiBase’s music concierge. Only return JSON… Only pick from catalog ids provided… Never invent songs… Respect explicit filter…”).
- Guard: JSON schema validation + song existence check; on 429/5xx/parse error → delegate to `RecommendationService`.

**Step 3 — Controllers**
```java
@RestController @RequestMapping("/api/v1/ai") @RequiredArgsConstructor
public class AiController {
  @PostMapping("/home")        // AI home sections (alt to GET /home when ?ai=true)
  @PostMapping("/search")      // semantic search
  @PostMapping("/playlists")   // generate playlist from prompt
  @PostMapping("/playlist/{id}/describe")
  @PostMapping("/chat")        // optional phase 2
}
```
- Add `GET /api/v1/home?ai=true` alternative that merges heuristic + AI sections.
- Rate-limit with `Bucket4j` (e.g., 10 AI calls / user / hour, 500 global / hour).

**Step 4 — Persistence (only if needed for MVP)**
```sql
-- V21__ai_support.sql
CREATE TABLE ai_playlists (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  model VARCHAR(50) NOT NULL DEFAULT 'gpt-4o-mini',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
-- Add playlists.type='AI' (already VARCHAR(20) DEFAULT 'USER') — no DDL needed, just use it
-- Optional V22__song_embeddings.sql with pgvector (defer)
```

**Step 5 — Config & observability**
- `management.metrics` + `management.endpoint.health` already exposed; add `AiMetrics` (calls, fallback rate, latency, tokens).
- Log prompts at `DEBUG` only; never log `OPENAI_API_KEY`.

### 15.2 Mobile — Step-by-Step

1. **`src/api/client.ts`** — add `aiApi`:
   ```ts
   export const aiApi = {
     home: (signal?: AbortSignal) => apiClient.post<HomeResponse>('/ai/home', {}, { signal }),
     search: (q: string) => apiClient.post<SearchResponse>('/ai/search', { query: q }),
     generatePlaylist: (prompt: string, size=20) => apiClient.post<PlaylistResponse>('/ai/playlists', { prompt, size }),
     describePlaylist: (id: string) => apiClient.post<PlaylistResponse>(`/ai/playlist/${id}/describe`),
   };
   ```
2. **`HomeScreen.tsx`** — side-by-side fetch: heuristic `homeApi.getHome()` + `aiApi.home()` (with timeout); merge AI sections with `aiBadge: true` and `reason` subtitle. Cache still via `homeCache`.
3. **`SearchScreen.tsx`** — add “✨ AI Search” toggle + prompt bar; when active, call `aiApi.search` and show “Interpreted as: …” chip.
4. **`PlaylistScreen.tsx`** — “Generate with AI” FAB + “✨ Describe” wand; reuse `SongBulkActionBar` for AI playlist actions.
5. Optional `AiChatScreen` (phase 2) under `screens/ai/`.

### 15.3 Env & Build Changes

| File | Change |
|---|---|
| `application.yml` | Remove AI auto-config exclusion; optionally add `spring.ai.openai.chat.options.max-tokens`, `spring.ai.vectorstore.type=simple` |
| `backend/pom.xml` | Bump Spring AI to GA |
| `docker-compose.yml` / `prod.yml` | No change (already passes `OPENAI_API_KEY`) |
| `.env.example` | Add `AI_ENABLED=true`, `AI_DAILY_TOKEN_BUDGET=200000`, `AI_RATE_LIMIT_PER_USER=10` (documented, default sane) |
| `mobile/.env` | No new key (AI is server-side), but consider `EXPO_PUBLIC_AI_ENABLED` feature flag |

---

## 16. Risks, Tech Debt & Open Issues

| Area | Issue | Impact | Mitigation |
|---|---|---|---|
| **Migrations** | `V18`/`V19` modified in working tree, `validate-on-migrate:false` hides drift | Flyway history corruption on fresh DB | Commit reconciled migrations before `feat/ai`; consider `V21` repair rather than editing old |
| **JWT** | `.env.example` `JWT_EXPIRATION`/`JWT_REFRESH_EXPIRATION` vs app `jwt.expiration`/`refresh-expiration` mismatch prefix | Env has no effect | Align to `JWT_EXPIRATION` or update code to read that prefix |
| **Mail** | `.env.example` `SMTP_*` vs README’s `MAIL_*` legacy docs | Onboarding confusion | Already correct in `application.yml` (`SMTP_*`); fix README only |
| **Multipart** | README says 50 MB, `application.yml` is 250 MB / 300 MB | Mis-set expectations | Update README or revert limit before store review |
| **Redis** | `RedisConfig` excluded, cache is `simple` (in-memory, per-instance) | No shared cache; AI response caching won’t scale | Accept for MVP; revisit Redis before multi-instance prod |
| **Spring AI** | M5 milestone, excluded auto-config | Nothing AI works until fixed | Upgrade + re-enable as Step 1 above |
| **R2 recent cut** | README says R2 migration just landed (`4131dca`) | Smoke tests may not cover Range streaming | Add `tests/prod-smoke-tests.ps1` case for `GET /songs/{id}/stream` with `Range: bytes=0-` |
| **Frontend stderr** | `frontend_stderr.log` exists at repo root | Web build may have warnings | Check log before branching |
| **CI** | `docker-compose.prod.yml` header suggests `-f docker-compose.yml -f docker-compose.prod.yml` merge — fails due to duplicate container name | Dev confusion | Already documented in README; fix compose names if you want merged dev-prod override |

**Security notes for AI:** scope system prompt to music only; strip PII from taste snapshot (no email/username → only ids/titles); enforce per-user token budget; do not echo raw LLM output without JSON + id validation (prevents hallucinated song ids).

---

## 17. Artifacts Inventory

### 17.1 Backend artifaxy

| Kind | Count / Path |
|---|---|
| Controllers | 15 (`/api/v1/**` + `/ws`) |
| Services | 16 + 2 schedulers |
| Repositories | ~20 JPA |
| Entities | ~22 |
| DTOs (request/response) | ~30 |
| Config/Security/Exception/Mapper/Util | ~10 |
| Migrations | V1..V20 (1..18 baseline, 19..20 active) |
| Resources | `application.yml` (170 lines), `db/migration/*` |
| Build | `pom.xml` (211 lines), `Dockerfile`, `run-*.ps1` |
| Tests | 24 test classes, 323 tests, Testcontainers 1.20.4 |

### 17.2 Mobile artifaxy

| Kind | Path |
|---|---|
| Screens | 14 folders (`admin`, `album`, `artist`, `auth`, `home`, `library`, `notifications`, `player`, `playlist`, `profile`, `search`, `settings`, `songs`) |
| Components | ~35 (`SongCard/Row`, `AlbumCard`, `ArtistCard`, `PlaylistCard`, `PlayerSheet`, `MiniPlayer`, `Aurora/Velaris/MoltenMetal`, …) |
| Stores | 6 (`auth`, `player`, `notification`, `download`, `selection`, `theme`) |
| API | `api/client.ts` (`homeApi`, `searchApi`, `queueApi`, `songApi`, …) |
| Realtime | `realtime/client.ts` |
| Tests | `**/*.test.tsx` (119 Jest tests) |

### 17.3 Root & Docs

| Path | Purpose |
|---|---|
| `README.md` (247 lines) | Full monorepo guide — features, arch diagram, tech stack, layout, quick start, env table, mobile, testing, CI/CD |
| `docs/setup.md` | Local dev |
| `docs/api-overview.md` (282 lines) | Endpoint map + auth + error + pagination + STOMP + example session |
| `docs/deployment.md` | Prod Docker + nginx SSL + EAS |
| `docs/testing.md` | Test matrix |
| `supabase-schema.sql` (425 lines) | Canonical DDL |
| `docker-compose.yml` / `prod.yml` | Dev/prod stacks |
| `nginx/prod.conf` | Reverse proxy |
| `.github/workflows/ci.yml, backend.yml, mobile.yml, eas-build.yml` | CI/CD |
| `.env.example` (124 lines) | Documented env template |
| `serve-frontend.js` | Static PWA server |

---

## 18. Next 30 / 60 / 90 Days

### 30 days — AI MVP (ship)
- [ ] Commit migration drift, branch `feat/ai`
- [ ] Upgrade Spring AI M5 → 1.0.x GA, re-enable auto-config
- [ ] Implement `AiRecommendationService` + `AiController` (A1 + A3 + A4) with Bucket4j caps & heuristic fallback
- [ ] Wire `mobile/src/api/aiApi` + `HomeScreen` AI sections + `PlaylistScreen` generate/describe
- [ ] Add semantic search without embeddings (A2-light: LLM → structured filter)
- [ ] Add 10 backend + 6 mobile tests for AI paths (fallback, 429, hallucinated id)
- [ ] Update `docs/api-overview.md` + `.env.example` with AI section; add `docs/ai.md`

### 60 days — AI hardening
- [ ] Add `pgvector` + `song_embeddings` + nightly backfill job (A7); switch semantic search to vector re-rank
- [ ] Admin analytics: AI call volume, fallback %, top prompts, cost per user
- [ ] Re-enable Redis (or keep simple cache) for AI response caching keyed by `(userId, tasteHash)`
- [ ] `AiChatScreen` (A6) with scoped tool calls (search/play/playlist)

### 90 days — Polish & scale
- [ ] Mood tag backfill (A5) + search filter chips
- [ ] Voice prompt (A8) via `expo-speech`
- [ ] Load test streaming + AI endpoints; add `/ws` contract tests
- [ ] Store submission (EAS) with AI feature flag off-by-default, staged rollout via `EXPO_PUBLIC_AI_ENABLED`

---

## 19. Appendix

### 19.1 Key Versions (pinned)

| Dep | Version |
|---|---|
| `spring-boot-starter-parent` | 3.4.1 |
| `java.version` | 17 |
| `jjwt` | 0.12.6 |
| `mapstruct` | 1.6.3 |
| `springdoc-openapi` | 2.7.0 |
| `aws-sdk:s3` | 2.29.9 |
| `jaudiotagger` | 2.0.3 |
| `bucket4j-core` | 8.7.0 |
| `spring-ai-openai` | 1.0.0-M5 (→ upgrade to 1.0.1 GA) |
| `postgres` | 16-alpine |
| `redis` | 7 |
| `expo` | ~57.0.11 |
| `react-native` | 0.86.2 |
| `react` | 19.2.3 |
| `zustand` | 5.0.14 |
| `tanstack/react-query` | 5.101.4 |
| `track-player` | 5.0.0-alpha0 |
| `shaka-player` | 4.16.43 |

### 19.2 Environment — Minimal to boot AI locally

```powershell
Copy-Item .env.example .env
# then in .env set at minimum:
# SUPABASE_PROJECT_REF, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET,
# SUPABASE_DB_USERNAME / SUPABASE_DB_PASSWORD, JWT_SECRET (openssl rand -base64 32),
# OPENAI_API_KEY=sk-...
# R2_* (if testing upload/stream), otherwise leave empty to boot without storage
Copy-Item backend/.env.example backend/.env  # if you keep a backend-local env
```

### 19.3 Health & Docs URLs (once running)

| Endpoint | URL |
|---|---|
| Backend health | `http://localhost:8088/actuator/health` |
| Swagger | `http://localhost:8088/swagger-ui/index.html` |
| OpenAPI | `http://localhost:8088/api-docs` |
| Frontend | `http://localhost:3000` |
| WebSocket | `ws://localhost:8088/ws` (STOMP) |

### 19.4 How this report was built

`OrchestratorAgent` — `PlannerAgent` (task graph: audit repo → map arch → score features → audit AI → propose backlog) → `SystemDesignerAgent` (diagram + data flow) → `ReviewAgent` (cross-check `application.yml`, `pom.xml`, `supabase-schema.sql`, `docs/api-overview.md`, live controllers/services, git drift). Sources: file tree, `README.md`, `application.yml:170`, `pom.xml:211`, `supabase-schema.sql:425`, `docs/*`, `mobile/package.json`, `docker-compose*.yml`, `RecommendationService.java`, `HomeController.java`, `api/client.ts`, `playerStore.ts`, `git log/status/diff`.

---

**Owner action:** review §12–§15, pick MVP cut (suggested A1+A2-light+A3+A4), then say the word and this report’s plan converts 1:1 into tickets on your tracker (one file per ticket with blocking edges).

