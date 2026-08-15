# SpotiBase

SpotiBase is a full-stack, Spotify-inspired music streaming platform. A single Expo (React Native) client powers iOS, Android and a web PWA, backed by a Spring Boot REST API with JWT authentication, STOMP WebSockets for realtime features, and object storage split between Cloudflare R2 (song files) and Supabase Storage (covers and avatars).

This is a monorepo: `backend/` (Spring Boot), `mobile/` (Expo app), plus infrastructure and tooling at the root.

## Features

- **Authentication** — register, login, JWT access + refresh token pair, email password reset, and social login (Google/Apple provider endpoint)
- **Content** — songs, albums and artists with cover art; audio upload in multiple formats including FLAC (50 MB upload limit, metadata parsed with jaudiotagger)
- **Playlists** — create, update, duplicate, merge, reorder; public/private toggle; collaborative playlists with realtime edits and collaborators
- **Queue & player** — queue management, play-next, move, clear, and save/restore queue state (offline persistence)
- **Library** — liked songs/albums/artists, recently played, and full listening history
- **Downloads** — per-song downloads for offline playback (quality selection), stats, and play tracking
- **Notifications** — server-side notifications pushed in realtime over WebSocket
- **Search** — full-text search with filters (language, year, genre, sort), type-ahead suggestions, and trending searches
- **Home** — personalized sections and daily mixes computed from listening history and likes
- **Admin** — dashboard, user management and roles, song/album moderation (soft delete/restore), featured content, and analytics (overview, user growth, top songs, top genres)
- **Realtime** — STOMP WebSocket for presence, cross-device queue sync, and collaborative playlist updates
- **Storage & Free Tier Safety** — songs stored on Cloudflare R2 (S3-compatible) with Range-enabled streaming redirects; covers/avatars on Supabase Storage. Includes an automated **9.5 GB Restriction Threshold** (out of 10 GB Free Tier capacity) enforcing an admin upload soft cap to prevent free-tier overages.
- **Offline-ready mobile** — MMKV-backed cache, downloads screen, queue save/restore
- **Web PWA** — Expo web export (service worker + manifest) served as static files

## Architecture

```
+--------------------------+          +------------------------------+
|  Mobile app (Expo SDK 57)  |        |  Web PWA (expo web export)     |
|  iOS / Android / Web      |          |  served statically on :3000   |
+------------+--------------+          +--------------+---------------+
             |  REST /api/v1 (JSON)                    |  REST + STOMP WS
             |  + STOMP WS /ws                         |
             v                                         v
+----------------------------------------------------------------------+
|                  nginx reverse proxy (production only)               |
|  SSL termination, rate limiting (api/auth/stream), /ws/ WebSocket    |
+-----------------------------------+----------------------------------+
                                    | :8088
                                    v
+----------------------------------------------------------------------+
|              Spring Boot backend (port 8088, jar 1.0.0)              |
|  Auth | Users | Songs | Albums | Artists | Playlists | Queue |       |
|  Library | Search | Home | Notifications | Downloads | Settings |    |
|  Admin | Realtime (STOMP) | Recommendations                          |
+------+----------+----------+------------+-------------+-------------+
       |          |          |            |             |
       v          v          v            v             v
  +---------+ +--------+ +-----------+ +-----------+ +------------+
  |Postgres | | Redis  | |Cloudflare | | Supabase | | OpenAI     |
  |Supabase | |(7, in  | |R2 songs   | | Storage  | |(gpt-4o-mini|
  |pooler or| |compose,| |Range      | | covers / | | configured |
  |docker)  | |not yet | |streaming  | | avatars  | |            |
  +---------+ +--------+ +-----------+ +-----------+ +------------+
```

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Spring Boot 3.4.1 (Java 17), Spring Security + JJWT 0.12.6, Spring Data JPA/Hibernate, Flyway, Springdoc OpenAPI 2.7.0, Spring WebSocket (STOMP), Spring AI (OpenAI starter), Bucket4j rate limiting, MapStruct, Lombok |
| Database | PostgreSQL 16 (Supabase pooler in production, `postgres:16-alpine` in Docker), Redis 7 (provisioned in compose; not yet wired into the app) |
| Storage | Cloudflare R2 (song files, S3 API), Supabase Storage (covers/avatars) via AWS S3 SDK 2.29.9 |
| Mobile | Expo SDK 57, React Native 0.86, React 19.2, TypeScript, Zustand, TanStack Query, axios, @stomp/stompjs, react-native-track-player, shaka-player (web) |
| Infra | Docker Compose (dev + prod stacks), nginx reverse proxy, GitHub Actions CI/CD, Vercel (web deploys), EAS (native builds) |

## Repository layout

| Path | Contents |
|---|---|
| `backend/` | Spring Boot app — `target/spotibase-backend-1.0.0.jar`, `src/main`, `src/test`, `Dockerfile`, `run-prod.ps1` |
| `mobile/` | Expo app (iOS/Android/web) — `src/`, Jest tests, `Dockerfile.web` |
| `nginx/prod.conf` | Production reverse proxy (SSL, rate limiting, WebSocket) |
| `docker-compose.yml` | Dev stack: Postgres :5433, backend :8080, Redis :6379 |
| `docker-compose.prod.yml` | Prod stack: Postgres, Redis, backend :8088, mobile-web :3000, optional nginx |
| `supabase-schema.sql` | Full database schema (run in Supabase SQL editor) |
| `tests/prod-smoke-tests.ps1` | 48 production smoke tests against the live backend |
| `serve-frontend.js` | Minimal static server for the exported web bundle |
| `run-project.ps1` / `run-project.bat` | One-command production launcher |
| `.env.example` | Documented environment variables (copy to `.env`) |
| `.github/workflows/` | CI/CD: `ci.yml`, `backend.yml`, `mobile.yml` |
| `bulk_upload_flac.py`, `scan_flac*.py` | Catalog/upload tooling for FLAC libraries |

## Quick start

All three paths need the environment file first:

```powershell
Copy-Item .env.example .env
```

Then fill in `.env` with real values (see the environment table below). A valid `JWT_SECRET` and the Supabase credentials are required for the backend to start meaningfully; other keys can be added as features are exercised.

### Path A — One-command production launcher (Windows)

Requires Java 17+, Maven 3.9+, and Node.js (for the Expo web export). The launcher builds the backend jar if missing (`mvn clean package -DskipTests`), starts it against the Supabase database on **:8088**, exports the mobile web bundle if missing (`npx expo export --platform web --output-dir dist-prod`), serves it on **:3000**, then runs the 48 smoke tests.

```powershell
powershell -ExecutionPolicy Bypass -File run-project.ps1
```

| Flag | Purpose |
|---|---|
| `-Stop` | Stop backend (PID file / port 8088) and frontend (`serve-frontend.js`) |
| `-SkipTests` | Start both services without running the 48 smoke tests |

`run-project.bat` is a double-clickable wrapper that verifies `.env` exists and forwards arguments to the PowerShell script.

Services land at:

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:8088`
- Health: `http://localhost:8088/actuator/health`
- Swagger UI: `http://localhost:8088/swagger-ui/index.html`
- OpenAPI JSON: `http://localhost:8088/api-docs`

### Path B — Docker dev stack

```powershell
docker compose -f docker-compose.yml up -d
```

- Postgres 16 on host port **5433** (`spotibase` / `spotibase` / `spotibase_local_dev`), Flyway migrations mounted into `docker-entrypoint-initdb.d`
- Backend on host port **8080** (built from `backend/Dockerfile`)
- Redis 7 on host port **6379** (appendonly)

The dev backend expects `SUPABASE_PROJECT_REF`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` and `OPENAI_API_KEY` from `.env`; SMTP and R2 values default to empty.

### Path C — Docker production stack

The prod compose file is self-contained (its own Postgres, Redis, backend on **8088**, `mobile-web` on **3000**, optional nginx on 80/443):

```powershell
docker compose -f docker-compose.prod.yml up -d
```

With the reverse proxy:

```powershell
docker compose -f docker-compose.prod.yml --profile proxy up -d
```

Requires `POSTGRES_PASSWORD`, Supabase, R2, `JWT_SECRET`, `OPENAI_API_KEY`, `APP_BASE_URL`, `APP_FRONTEND_URL`, `CORS_ALLOWED_ORIGINS` and `DOMAIN` in `.env`. See `docs/deployment.md` for the full walkthrough, including the SSL certificate layout.

> Note: the header of `docker-compose.prod.yml` suggests merging the dev file with `-f docker-compose.yml -f docker-compose.prod.yml`; that merge fails today because both files define a container named `spotibase-redis`. Run the prod file standalone as shown above.

## Environment variables

Copy `.env.example` to `.env`. All names below are exact.

| Group | Variable | Purpose |
|---|---|---|
| Database | `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Local/prod Postgres bootstrap (Docker) |
| Supabase | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` | Storage + auth keys. Note: the app itself builds the API URL from `SUPABASE_PROJECT_REF` (see `backend/run-prod.ps1` and `application.yml`) |
| Supabase | `SUPABASE_STORAGE_BUCKET`, `SUPABASE_STORAGE_COVERS_PATH`, `SUPABASE_STORAGE_AVATARS_PATH` | Storage layout (defaults `spotibase`, `covers`, `avatars`) |
| R2 | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`, `R2_SONGS_PATH`, `R2_REGION` | Cloudflare R2 song storage |
| JWT | `JWT_SECRET` | Signing secret (min 32 chars: `openssl rand -base64 32`) |
| JWT | `JWT_EXPIRATION`, `JWT_REFRESH_EXPIRATION` | Documented as 1 h / 7 d. Caveat: the app currently hardcodes 24 h / 30 d in `application.yml` and does not read these |
| Mail | `MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_FROM` | SMTP for password reset. Caveat: the app reads `SMTP_HOST`/`SMTP_PORT`/`SMTP_USERNAME`/`SMTP_PASSWORD`; see docs for the exact mapping |
| OpenAI | `OPENAI_API_KEY` | AI recommendations (Spring AI, `gpt-4o-mini`) |
| App URLs | `APP_BASE_URL`, `APP_FRONTEND_URL`, `CORS_ALLOWED_ORIGINS` | Public URLs and CORS allow-list |
| Domain | `DOMAIN` | nginx `server_name` and SSL profile |
| Redis | `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` | Provisioned in compose; not currently consumed by the app |
| Mobile | `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Injected into the Expo bundle at build time |
| Optional | `GOOGLE_CLIENT_ID/SECRET`, `APPLE_CLIENT_ID/TEAM_ID/KEY_ID/PRIVATE_KEY`, `EXPO_PUSH_TOKEN`, `FCM_SERVER_KEY`, `APNS_KEY_ID/TEAM_ID/PRIVATE_KEY`, `SENTRY_DSN`, `LOG_LEVEL` | Social login, push, monitoring (all commented out in `.env.example`) |

## Mobile app

```powershell
cd mobile
npm install
npx expo start          # dev server (press w for web, a for Android, i for iOS)
npm run android         # expo run:android (native build)
npm run ios             # expo run:ios (native build)
```

Web production build and serve:

```powershell
npm run web:build               # expo export --platform web --output-dir dist-prod (+ postexport)
node ..\serve-frontend.js 3000  # static server on :3000 (SPA fallback)
# or: npm run web:serve         # npx serve dist-prod
```

`EXPO_PUBLIC_API_URL` (e.g. `https://api.yourdomain.com/api/v1`) is baked into the bundle at build time; the API client falls back to `http://localhost:8088/api/v1` when unset.

Native builds go through EAS (`eas build --platform android --profile production` / `--platform ios`). Note the repo does not commit an `eas.json`; CI injects one from a secret, so create one locally for personal builds.

## Testing

| Suite | Command | Count |
|---|---|---|
| Backend unit/controller tests (JUnit 5) | `cd backend; mvn test` | 323 tests |
| Mobile Jest tests | `cd mobile; npm test` | 119 tests |
| Mobile lint / typecheck | `npm run lint` / `npm run typecheck` | — |
| Production smoke tests (needs running stack) | `powershell -ExecutionPolicy Bypass -File tests\prod-smoke-tests.ps1` | 48 tests |

See `docs/testing.md` for details.

## CI/CD

GitHub Actions (`.github/workflows/`), triggered on push/PR to `main` and `develop`:

1. `ci.yml` — `validate` job detects changed paths, then runs the backend and mobile pipelines and a `docker-compose-test` integration job (builds both images, boots Postgres + backend on :8088, health-checks backend and the web bundle on :3000), finishing with a notify step.
2. `backend.yml` — Maven tests against a Postgres 16 service, package the jar, build/push a `ghcr.io` image, then deploy-staging (develop) / deploy-production (main) hooks.
3. `mobile.yml` — lint + typecheck, Jest with coverage, Expo web export (verifies `index.html`, `manifest.json`, `sw.js`), EAS Android/iOS builds, and Vercel preview/production deploys of the web build.

## Deployment

See `docs/deployment.md` for: the production Docker stack, full `.env` requirements, nginx SSL setup (certs in `nginx/ssl/`, `DOMAIN` variable, `proxy` profile), and EAS build steps for the stores.

## Storage Limits & Free Tier Restrictions

To safely operate within the **10 GB Free Tier limit** of Cloudflare R2 and Supabase Storage without incurring unexpected billing charges:

* **Free Tier Allocation:** 10.0 GB (10,737,418,240 bytes)
* **Administrative Restriction Cap:** **9.5 GB** (10,200,547,328 bytes)
* **Enforcement Mechanism:**
  - **Backend:** Both single song uploads (`StorageService.uploadSong`) and bulk song uploads (`SongService.createSongsBulk`) query active song storage usage (`SUM(s.fileSize)`). If total storage exceeds 9.5 GB, the request is rejected with `HTTP 400 Bad Request: Storage limit reached (9.5 GB safety cap of 10 GB free tier)`.
  - **Admin Dashboard:** Displays live storage level progress bar out of 10 GB with real-time percentage and badge indicator (`FREE TIER ACTIVE` vs `UPLOADS RESTRICTED`).
  - **Song Uploader:** Displays safety cap notice and automatically disables song uploads when the 9.5 GB restriction cap is reached.

## API documentation

- Swagger UI: `http://localhost:8088/swagger-ui/index.html` (also reachable via `/swagger-ui.html`)
- OpenAPI JSON: `http://localhost:8088/api-docs`
- Endpoint map, pagination and error conventions: `docs/api-overview.md`

## Troubleshooting

| Symptom | Check |
|---|---|
| Backend won't start | `backend\prod_stdout.log` and `backend\prod_stderr.log` (launcher), or `docker compose -f docker-compose.prod.yml logs backend` |
| Health shows DOWN | `http://localhost:8088/actuator/health` — DB reachable? `.env` correct? SMTP health is disabled by design so it never pulls health DOWN |
| Port already in use | Launcher skips or fails on :8088 / :3000. Note: local Apache often owns port 8080 — prod intentionally uses 8088 |
| JVM crash | Look for `hs_err_pid*.log` crash files in `backend/` (the JVM working directory) |
| Frontend not reachable | `frontend_stdout.log` / `frontend_stderr.log` at repo root; rebuild with `npm run web:build` |
| Smoke tests fail | Run `powershell -ExecutionPolicy Bypass -File tests\prod-smoke-tests.ps1 -Quiet` to get the failure list |

## Documentation index

- `docs/setup.md` — local development setup (backend, mobile, Supabase)
- `docs/api-overview.md` — REST endpoint map, auth model, WebSocket topics
- `docs/deployment.md` — production deployment walkthrough
- `docs/testing.md` — test suites, how to run them, CI coverage
#   s p o t i b a s e  
 