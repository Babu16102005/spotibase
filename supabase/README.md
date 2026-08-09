# SpotiBase — Supabase Project

Supabase CLI project for **SpotiBase** (music streaming app: Spring Boot backend +
React frontend + Expo mobile).

This directory contains everything needed to provision the SpotiBase
PostgreSQL schema, storage bucket, and row-level security on any Supabase
project (local or hosted):

```
supabase/
├── config.toml          # Local dev stack configuration (Supabase CLI v2.x)
├── migrations/          # SQL migrations (versioned, applied in order)
│   ├── V1__create_users.sql ... V19__...   # Canonical schema (copied 1:1 from
│   │                                       #   backend/src/main/resources/db/migration)
│   ├── V20__create_storage_buckets.sql     # "spotibase" storage bucket + policies
│   └── V21__enable_rls.sql                 # RLS on application tables
└── .temp/               # CLI metadata (linked project, versions) — gitignored
```

The migrations in `V1…V19` are **byte-identical copies** of the backend's
canonical Flyway migrations (`backend/src/main/resources/db/migration/`).
They are the source of truth for the schema; the legacy monolithic
`supabase-schema.sql` at the repo root is kept for reference only (it mirrors
V1–V18 and was used for the original manual setup — see "Legacy schema note"
below).

---

## 1. Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (required for local dev)
- [Supabase CLI](https://supabase.com/docs/guides/cli) (`supabase --version` — developed against v2.100.x)
- A Supabase project (hosted) — the remote Postgres version is **17**, which is
  what `config.toml` pins for local dev (`[db] major_version = 17`).

---

## 2. Link to your hosted project

This repo's CLI metadata (`.temp/linked-project.json`) already points at the
remote project. To re-link on another machine:

```bash
supabase link --project-ref <your-project-ref>
```

Get the ref from your project's **Project Settings → General → Reference**,
or from the database connection string:
`postgresql://postgres.<ref>@aws-1-ap-south-1.pooler.supabase.com:5432/postgres`.
You'll be prompted for your database password (the `postgres` role password —
also set as `SUPABASE_DB_PASSWORD` in `.env`).

> `.temp/` is gitignored, so the link is per-machine.

---

## 3. Local development

All commands run from the repo root (or `supabase/`).

```bash
supabase start        # Pull images, start local stack (API :54321, DB :54322, Studio :54323)
supabase db reset     # Drop + recreate the LOCAL database from migrations/ (fresh start)
supabase db push      # Push NEW migration files to the LINKED (remote) database
supabase stop         # Stop the local stack (keep data volume)
```

After `supabase start`, the CLI prints the local keys:

| Item | Local value |
|---|---|
| API URL | `http://127.0.0.1:54321` |
| DB URL | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| Studio | `http://127.0.0.1:54323` |
| anon key / service role key | printed by `supabase start` (auto-generated placeholders) |

Pointing the backend at the local stack:

```bash
# .env (local dev)
SPRING_DATASOURCE_URL=jdbc:postgresql://127.0.0.1:54322/postgres
SPRING_DATASOURCE_USERNAME=postgres
SPRING_DATASOURCE_PASSWORD=postgres
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=<service_role_key from supabase start>
SUPABASE_ANON_KEY=<anon_key from supabase start>
```

> ⚠️ **Flyway vs Supabase migrations — use only one on any given database.**
> The backend runs Flyway (`baseline-on-migrate: true`, `baseline-version: 18`)
> and the two tools do **not** share a history table. If you provision a DB
> with `supabase db reset` / `supabase db push` (which applies V1…V21), set
> the backend's Flyway baseline to `21` (or disable Flyway) before pointing
> the backend at that DB — otherwise Flyway will try to re-apply V19 and fail
> ("relation already exists"). Conversely, if the remote DB is already managed
> by Flyway, **do not** run `supabase db push` against it. The current
> production remote was manually seeded with `supabase-schema.sql` (V1–V18)
> and is managed by the backend's Flyway; treat `supabase/migrations` as the
> canonical provisioning source for local dev and for bootstrapping fresh
> hosted environments.

---

## 4. Migration inventory

| # | File | Purpose |
|---|------|---------|
| V1 | `V1__create_users.sql` | `users`, `user_favorite_genres` + indexes |
| V2 | `V2__create_genres.sql` | `genres` |
| V3 | `V3__create_artists.sql` | `artists` |
| V4 | `V4__create_albums.sql` | `albums` |
| V5 | `V5__create_songs.sql` | `songs` + full-text search trigger |
| V6 | `V6__create_playlists.sql` | `playlists` |
| V7 | `V7__create_playlist_songs.sql` | `playlist_songs` |
| V8 | `V8__create_liked_songs.sql` | `liked_songs` |
| V9 | `V9__create_liked_albums.sql` | `liked_albums` |
| V10 | `V10__create_liked_artists.sql` | `liked_artists` |
| V11 | `V11__create_followers.sql` | `followers` (self-referential, no self-follow) |
| V12 | `V12__create_listening_history.sql` | `listening_history` |
| V13 | `V13__create_recently_played.sql` | `recently_played` |
| V14 | `V14__create_queues.sql` | `queues` |
| V15 | `V15__create_notifications.sql` | `notifications` (JSONB payload) |
| V16 | `V16__create_downloads.sql` | `downloads` |
| V17 | `V17__create_user_settings.sql` | `user_settings` |
| V18 | `V18__create_indexes.sql` | trigram indexes, `pg_trgm`/`uuid-ossp`, `updated_at` triggers |
| V19 | `V19__add_contributing_artists_and_denormalized_fields.sql` | `song_contributing_artists`, `album_artist_id`, denormalized song fields, composite query indexes, sync triggers |
| **V20** | `V20__create_storage_buckets.sql` | **Supabase Storage**: `spotibase` bucket + RLS policies (public read, service-role writes) |
| **V21** | `V21__enable_rls.sql` | **RLS** on all 19 application tables, service-role-only access |

V20 and V21 are Supabase-specific (no backend Flyway counterpart — the backend
is baselined at V18, and V19 already exists there with different content, so
the storage/RLS migrations start at **V20+** to keep numbering compatible).

---

## 5. Storage buckets ↔ backend config

The backend (`backend/src/main/resources/application.yml` → `supabase.*`)
talks to **one bucket** named `spotibase` (public) with these paths:

| Backend property | Value | Paths written | Used for |
|---|---|---|---|
| `supabase.storage.bucket` | `spotibase` | — | bucket name |
| `supabase.storage.songs-path` | `songs` | `songs/{artistId}/<uuid>.<ext>` | audio (fallback; **R2** is primary for songs) |
| `supabase.storage.covers-path` | `covers` | `covers/{ownerId}/<uuid>.<ext>` | album/playlist covers |
| `supabase.storage.avatars-path` | `avatars` | `avatars/{userId}/<uuid>.<ext>` | user avatars |

Public URL pattern: `https://<ref>.supabase.co/storage/v1/object/public/spotibase/<path>`.

`V20__create_storage_buckets.sql` provisions the bucket with:
- `public = true` (public URLs + signed URLs work for unauthenticated playback/display),
- `file_size_limit = 52,428,800` bytes (50 MiB — matches the backend's 50 MB cap),
- `allowed_mime_types` = images + audio (what `StorageService.validateAudioFile` / `validateImageFile` accept).

### Bucket security model (V20)

- **Read**: public — anyone can read objects (`spotibase_public_read` SELECT
  policy); the bucket is public by design so cover/avatar/song URLs work
  without auth.
- **Write/Update/Delete**: `service_role` **only**. The app signs in with its
  own JWT (`SecurityConfig.java`), so clients never hold a valid Supabase
  token; every upload/delete goes through the Spring backend with the
  service-role key (`StorageService`). There is deliberately no
  anon/authenticated write policy.

### Caveat — the backend auto-creates the bucket

`StorageService.ensureBucketExists()` (runs on startup) creates the bucket via
REST if it's missing, with `public = true` but **without** the size limit or
mime-type allowlist. That auto-creation is a convenience fallback; the
migration is the authoritative definition. If the backend ever creates the
bucket first, `V20`'s `ON CONFLICT (id) DO UPDATE` will re-apply the correct
settings on the next migration run. For local dev, `config.toml` also declares
`[storage.buckets.spotibase]` with matching settings so the local stack starts
with the right bucket from the beginning.

---

## 6. Row Level Security (V21)

RLS is enabled on all 19 application tables with **no** anon/authenticated
policies and a single permissive `service_role` policy per table.

Why this is safe: the backend connects as the `postgres` superuser
(`postgres.<ref>` on the pooler), and superusers/owners bypass RLS — the
backend's JDBC path is unaffected. RLS only hardens the PostgREST API
surface: with the anon key alone, `https://<ref>.supabase.co/rest/v1/*` now
returns empty/denied instead of exposing `users.email`, `password_hash`,
listening history, etc.

If a future feature needs PostgREST/realtime data access, add narrowly-scoped
policies per feature — don't grant blanket anon access.

---

## 7. Legacy schema note

`supabase-schema.sql` at the repo root is the **legacy reference** of the
original manual setup (V1–V18 content, applied in the Supabase SQL editor
before Flyway was baselined at V18). It is kept as-is for history and is
**not** used by the CLI. The authoritative schema lives in
`supabase/migrations/` (and the backend's `db/migration/`). If you ever need
to regenerate a single-file dump from the migrations:

```bash
supabase db dump --db-url "$DATABASE_URL" -f supabase-schema.sql   # or per-schema
```

To keep the legacy file in sync with migrations, update it manually whenever
V20+/V21+ or future migrations change the schema — or drop it once everyone
has migrated to the CLI workflow.
