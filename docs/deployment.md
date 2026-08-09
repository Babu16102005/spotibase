# SpotiBase — Production Deployment

Two supported production paths:

1. **Docker Compose stack** — Postgres, Redis, backend (:8088), mobile web PWA (:3000), optional nginx reverse proxy with SSL.
2. **Windows launcher** — the jar + exported web bundle on a single machine (`run-project.ps1`), documented in the README.

This guide covers the Docker path, the `.env` requirements, nginx SSL, and EAS builds for the mobile stores.

## 1. Production Docker stack

### Prereqs

- Docker Engine with Compose v2
- A Supabase project with the schema applied (`supabase-schema.sql` in the SQL editor)
- A Cloudflare R2 bucket for song files
- (Optional) SMTP credentials, an OpenAI API key, and a domain with DNS pointing at the host

### .env requirements

Copy `.env.example` to `.env` and fill in:

| Variable | Required | Notes |
|---|---|---|
| `POSTGRES_PASSWORD` | yes | Prod Postgres password (keep strong) |
| `SUPABASE_ANON_KEY` | yes | Supabase keys |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | |
| `SUPABASE_JWT_SECRET` | yes | |
| `SUPABASE_STORAGE_BUCKET` / `..._COVERS_PATH` / `..._AVATARS_PATH` | no | defaults `spotibase` / `covers` / `avatars` |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | yes | Song storage |
| `R2_PUBLIC_URL`, `R2_SONGS_PATH`, `R2_REGION` | no | defaults `songs` / `auto` |
| `JWT_SECRET` | yes | min 32 chars |
| `OPENAI_API_KEY` | no | recommendations config |
| `APP_BASE_URL` | yes | public API origin, e.g. `https://api.yourdomain.com` |
| `APP_FRONTEND_URL` | yes | public web origin, e.g. `https://yourdomain.com` |
| `CORS_ALLOWED_ORIGINS` | yes | comma-separated origins |
| `DOMAIN` | yes | nginx `server_name`; required for the `proxy` profile |
| `MAIL_HOST`/`MAIL_PORT`/`MAIL_USERNAME`/`MAIL_PASSWORD` | no | see caveat below |

Caveats you must account for:

- The backend reads `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD` (application.yml), but `.env.example` and the prod compose file use `MAIL_*`. Until aligned, either export `SMTP_*` in the backend container or edit `docker-compose.prod.yml` to map `MAIL_*` → `SMTP_*`.
- The app builds its Supabase URL from `SUPABASE_PROJECT_REF` (`https://<ref>.supabase.co`), which the prod compose file does not pass. Export `SUPABASE_PROJECT_REF` for the backend service (the dev compose file does pass it).
- `JWT_EXPIRATION` / `JWT_REFRESH_EXPIRATION` are documented but ignored by the app (hardcoded 24 h / 30 d in `application.yml`).

### Deploy

```powershell
docker compose -f docker-compose.prod.yml up -d --build
```

Bring up the stack without the proxy (services on host ports 8088 and 3000) — good for a first run:

```powershell
docker compose -f docker-compose.prod.yml up -d
```

Wait for health (compose `healthcheck`s gate `depends_on`): backend checks `GET /actuator/health` with wget every 30 s; `mobile-web` checks `/`; Postgres and Redis check `pg_isready` / `redis-cli ping`.

Verify:

```powershell
curl http://localhost:8088/actuator/health   # {"status":"UP"}
curl http://localhost:3000                   # web PWA
```

Operations:

```powershell
docker compose -f docker-compose.prod.yml logs -f backend
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml down
```

> Do not merge the dev file: `docker compose -f docker-compose.yml -f docker-compose.prod.yml up` fails because both files define a container named `spotibase-redis` (plus the dev backend occupies :8080 and its own Postgres on :5433). The prod file is self-contained.

### What the stack contains

| Service | Image | Host port | Notes |
|---|---|---|---|
| `postgres` | postgres:16-alpine | — (internal) | 1 GB memory limit, migrations mounted into initdb, `SPRING_JPA_HIBERNATE_DDL_AUTO=validate` |
| `redis` | redis:7-alpine | — (internal) | `--maxmemory 256mb --maxmemory-policy allkeys-lru` |
| `backend` | built from `backend/Dockerfile` | 8088 | `SPRING_PROFILES_ACTIVE=prod`, Flyway enabled, actuator exposes `health,info,metrics,prometheus` with `show-details=always` |
| `mobile-web` | built from `mobile/Dockerfile.web` | 3000 | static Expo web export (nginx inside) |
| `nginx` | nginx:alpine | 80, 443 | optional — active only with the `proxy` profile |

## 2. nginx reverse proxy and SSL

The proxy (`nginx/prod.conf`) terminates TLS, rate-limits the API, and routes:

| Location | Upstream | Behavior |
|---|---|---|
| `/health` | `backend/actuator/health` | no auth, no rate limit, access log off |
| `/api/` | `backend` | rate limit `api` 100 r/s (burst 200); `auth` zone 10 r/s (burst 20) on login/register/refresh/forgot/reset; `stream` zone 50 r/s (burst 100) on `/api/v1/songs/.*/stream` with buffering off and 300 s timeouts |
| `/ws/` | `backend` | WebSocket upgrade headers, 24 h read/send timeouts |
| `/` | `mobile-web` | static assets cached `public, immutable` for 1 year; `sw.js` and `manifest.json` served no-cache |

### Enable the proxy profile

```powershell
docker compose -f docker-compose.prod.yml --profile proxy up -d
```

The nginx service requires `DOMAIN` in `.env` (used as `server_name ${DOMAIN:-localhost}`).

### Certificates

The container mounts `./nginx/ssl` as `/etc/nginx/ssl` and expects two files:

- `/etc/nginx/ssl/fullchain.pem`
- `/etc/nginx/ssl/privkey.pem`

Place your certificates on the host:

```powershell
mkdir nginx\ssl
Copy-Item fullchain.pem nginx\ssl\fullchain.pem
Copy-Item privkey.pem nginx\ssl\privkey.pem
```

The config also answers ACME challenges at `/.well-known/acme-challenge/` from `/var/www/certbot` — for Let's Encrypt, mount a certbot webroot there (e.g. add `- ./certbot/www:/var/www/certbot:ro` to the nginx service) and run certbot with `--webroot`.

All HTTP traffic on port 80 is redirected to HTTPS with HSTS; TLS 1.2/1.3 only. No ports are exposed to the internet except 80/443 once the proxy is up — the backend (:8088) and web (:3000) stay on the internal `spotibase-network`.

## 3. EAS builds (mobile stores)

Prereqs:

- `npm install -g eas-cli` and `eas login`
- A real EAS project. Note `mobile/app.json` has `extra.eas.projectId: "spotibase"` — a placeholder, not a UUID; replace it with your project ID (`eas init` does this) and create `mobile/eas.json` (not committed in this repo; CI writes it from the `EAS_CONFIG` secret).

Example `mobile/eas.json`:

```json
{
  "cli": { "version": ">= 10.0.0" },
  "build": {
    "production": { "distribution": "store" },
    "preview": { "distribution": "internal" }
  }
}
```

Build:

```bash
cd mobile
eas build --platform android --profile production
eas build --platform ios --profile production
```

Set the build-time env values (the API URL is baked into the bundle):

```bash
EXPO_PUBLIC_API_URL=https://api.yourdomain.com/api/v1 \
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co \
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_anon_key \
eas build --platform android --profile production
```

Submission is out of scope for the repo's CI (it builds and uploads artifacts; store credentials are configured per developer via `eas credentials`).

## 4. What CI deploys

See `.github/workflows/` — the pipelines build and publish artifacts; deployment steps are partially stubbed:

| Workflow | Push to `main` | Push to `develop` | PR |
|---|---|---|---|
| `backend.yml` | test → package jar → push `ghcr.io/<repo>/backend` → `deploy-production` (stub) | same, plus `deploy-staging` (stub) | tests only |
| `mobile.yml` | lint/typecheck → Jest → web export → EAS android/ios → Vercel production | EAS android/ios | web preview to Vercel |
| `ci.yml` | orchestrates both + `docker-compose-test` integration job | | |

## 5. Production checklist

- [ ] `.env` complete (see table above; mind the `SMTP_*` / `SUPABASE_PROJECT_REF` caveats)
- [ ] `DOMAIN` set and DNS A record points at the host (ports 80/443 open)
- [ ] `nginx/ssl/fullchain.pem` + `privkey.pem` in place
- [ ] Supabase schema applied (Flyway baseline 18; V19+ auto-migrate)
- [ ] R2 bucket exists; `R2_PUBLIC_URL` set if using a custom domain
- [ ] Smoke tests green: `powershell -ExecutionPolicy Bypass -File tests\prod-smoke-tests.ps1`
- [ ] Backups: `POSTGRES_PASSWORD` rotation, `postgres-data` volume backups, R2 lifecycle rules
