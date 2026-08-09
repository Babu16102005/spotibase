# SpotiBase — Local Development Setup

This guide covers a full local dev environment: the Spring Boot backend, the Expo mobile app, and the database/storage options.

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Java | 17 (Temurin recommended) | Matches `java.version` in `backend/pom.xml` |
| Maven | 3.9.x | CI pins 3.9.6; any 3.9+ works |
| Node.js | 20.x | CI pins 20 (LTS) |
| npm | 9+ | Ships with Node 20 |
| Docker (optional) | 24+ with Compose v2 | For the dev compose stack |
| Expo CLI | Latest | `npx expo` resolves it per-project |
| EAS CLI (optional) | Latest | Only for native builds: `npm install -g eas-cli` |

## 1. Environment file

```powershell
Copy-Item .env.example .env
```

The backend reads `.env` from the repo root when launched via `backend\run-prod.ps1` (the production launcher) — the script loads it into the process environment before starting the jar. Docker Compose also interpolates variables from the same file.

Minimal set to boot the backend against a Supabase database:

- `SUPABASE_PROJECT_REF` — your project ref (e.g. `abcdefghijklmnop`) and `SUPABASE_DB_USERNAME`/`SUPABASE_DB_PASSWORD` (see below)
- `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`
- `JWT_SECRET` — generate with `openssl rand -base64 32`

Everything else (`R2_*`, `MAIL_*`, `OPENAI_API_KEY`, social keys) can be added as you work on those features.

### Environment variable naming caveats

Three naming mismatches exist between `.env.example` and what `application.yml` actually reads. Until they are reconciled, set both forms:

| Feature | `.env.example` / compose uses | Backend actually reads |
|---|---|---|
| Supabase URL | `SUPABASE_URL` | `SUPABASE_PROJECT_REF` (app builds `https://<ref>.supabase.co`) |
| SMTP | `MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD` | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD` |
| JWT expiry | `JWT_EXPIRATION`, `JWT_REFRESH_EXPIRATION` | Hardcoded 24 h access / 30 d refresh — env vars ignored |

## 2. Database: Supabase vs local

### Option A — Supabase (cloud, matches production)

1. Create a project at [supabase.com](https://supabase.com).
2. Open the SQL editor and run `supabase-schema.sql` (creates all 18 tables, extensions `pg_trgm` and `uuid-ossp`).
3. Set the datasource in `.env`:

```
SUPABASE_PROJECT_REF=your-ref
SUPABASE_DB_USERNAME=postgres
SUPABASE_DB_PASSWORD=your-db-password
```

The backend defaults to the Supabase pooler in session mode: `jdbc:postgresql://aws-1-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=require`, with the username composed as `<username>.<project-ref>` (required on the pooler). Override with `SPRING_DATASOURCE_URL`, `SPRING_DATASOURCE_USERNAME`, `SPRING_DATASOURCE_PASSWORD` if needed.

4. Flyway runs on boot: `baseline-on-migrate: true` with `baseline-version: 18`, so only migrations `V19+` apply to a schema created from `supabase-schema.sql`. Migrations `V1`–`V18` live in `backend/src/main/resources/db/migration/` and are applied automatically on a fresh database.

### Option B — Docker Postgres (local)

```powershell
docker compose -f docker-compose.yml up -d spotibase-db
```

- Host port **5433**, database/user/password `spotibase` / `spotibase` / `spotibase_local_dev`
- Flyway migrations are mounted into `/docker-entrypoint-initdb.d/` so a fresh volume is initialized with the schema
- The dev compose backend points at this database (`SPRING_DATASOURCE_URL=jdbc:postgresql://spotibase-db:5432/spotibase?sslmode=disable`) — no Supabase pooler needed

## 3. Backend (Spring Boot)

Build and run the jar against Supabase:

```powershell
cd backend
mvn clean package -DskipTests
powershell -ExecutionPolicy Bypass -File run-prod.ps1
```

`run-prod.ps1` loads the root `.env`, forces `SERVER_PORT=8088` and `SPRING_PROFILES_ACTIVE=prod`, and starts `target\spotibase-backend-1.0.0.jar` with `-Xms512m -Xmx1024m`. Logs go to `backend\prod_stdout.log` / `backend\prod_stderr.log`; the PID is written to `backend\backend.pid`.

During development with live reload you can instead use:

```powershell
cd backend
# ensure the vars below are exported, or run from a shell that sourced .env
$env:SPRING_DATASOURCE_URL = "jdbc:postgresql://localhost:5433/spotibase?sslmode=disable"
$env:SPRING_DATASOURCE_USERNAME = "spotibase"
$env:SPRING_DATASOURCE_PASSWORD = "spotibase_local_dev"
mvn spring-boot:run
```

The default datasource points at the Supabase pooler; export the variables above (or set them in `.env` and use `run-prod.ps1`) to run against the local Docker Postgres instead.

Verify:

- `http://localhost:8088/actuator/health` → `{"status":"UP"}`
- `http://localhost:8088/swagger-ui/index.html` → Swagger UI
- `http://localhost:8088/api-docs` → OpenAPI JSON

Notes:

- The app runs on **8088**, not the `application.yml` default of 8080 (port 8080 is often taken by a local web server). `APP_BASE_URL` in `.env` must match the real public URL of the API.
- Redis is disabled in the app: `RedisAutoConfiguration` is excluded, caching uses the in-memory `simple` provider, and `RedisConfig.java` is commented out. The Redis containers in compose are provisioned but currently unused.
- The OpenAI starter is configured (`gpt-4o-mini`, temperature 0.7) but no code path calls it yet; recommendations are computed from listening-history SQL.
- `spring.mail.health` is disabled so health never reports DOWN when SMTP is unset.

## 4. Mobile app (Expo)

```powershell
cd mobile
npm install          # runs patch-package postinstall
npx expo start       # Metro dev server
```

- Press `w` for web, `a` for Android emulator, `i` for iOS simulator (macOS only).
- The app targets Expo SDK 57 / React Native 0.86 / React 19.2.

### API URL

The API base URL is baked in at build time from `EXPO_PUBLIC_API_URL` (see `mobile/src/api/client.ts`):

```powershell
# dev against a locally running backend
$env:EXPO_PUBLIC_API_URL = "http://localhost:8088/api/v1"
npx expo start
```

With no variable set, the client falls back to `http://localhost:8088/api/v1`. For a physical device, use your machine's LAN IP instead of `localhost`. Supabase keys for the mobile app: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`.

### Web build (PWA)

```powershell
npm run web:build                 # expo export --platform web --output-dir dist-prod + scripts/postexport.js
node ..\serve-frontend.js 3000    # serves mobile/dist-prod with SPA fallback
```

or `npm run web:serve` (`npx serve dist-prod`).

### Native builds

```powershell
npm run android    # expo run:android
npm run ios        # expo run:ios
```

Store builds use EAS. The repo does not commit an `eas.json` (CI writes it from a secret), and `app.json` carries a placeholder `extra.eas.projectId` ("spotibase") — create `mobile/eas.json` locally and set a real project ID before running `eas build`.

## 5. Useful scripts

| Script | Purpose |
|---|---|
| `run-project.ps1` | Full production stack on localhost (backend :8088, web :3000, smoke tests) |
| `tests\prod-smoke-tests.ps1` | 48 smoke tests against `http://localhost:8088` (see `docs/testing.md`) |
| `bulk_upload_flac.py` | Batch-upload FLAC files (with `scan_flac*.py` for catalog inspection) |
| `serve-frontend.js` | Static server for `mobile/dist-prod` |
