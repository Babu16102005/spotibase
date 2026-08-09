# SpotiBase — API Overview

Base path: `/api/v1` · Content type: `application/json` (file uploads use `multipart/form-data`) · Auth: `Authorization: Bearer <accessToken>`

Live reference: `http://localhost:8088/swagger-ui/index.html` (OpenAPI JSON at `http://localhost:8088/api-docs`).

## Authentication model

| Requirement | Applies to |
|---|---|
| Public (no auth) | `/api/v1/auth/**`, `/api/v1/public/**` (reserved; no controller mapped yet), `/ws/**`, `/swagger-ui/**`, `/api-docs/**`, `/v3/api-docs/**`, `/actuator/health`, `GET /api/v1/songs/*/stream`, `GET /api/v1/search/suggestions`, `GET /api/v1/search/trending`, `GET /api/v1/playlists/featured` |
| JWT required | Everything else — anonymous requests get 401/403 |
| `ROLE_ADMIN` | `/api/v1/admin/**` and any `/actuator/**` endpoint besides health |
| `ROLE_ARTIST` or `ROLE_ADMIN` | Creating/updating/deleting songs and albums |
| `ROLE_ADMIN` | Restore endpoints (`/songs/{id}/restore`, `/albums/{id}/restore`), artist create/update |
| `ROLE_USER` / `ROLE_PREMIUM_USER` / `ROLE_ARTIST` / `ROLE_ADMIN` | All download endpoints |

The access token is a signed JWT (jjwt 0.12.6). Get a pair from `POST /api/v1/auth/login` (`accessToken` + `refreshToken`); renew with `POST /api/v1/auth/refresh`. Expiries are currently hardcoded: 24 h access, 30 d refresh.

## Error format

All errors return `ErrorResponse`:

```json
{
  "error": "Not Found",
  "message": "Song not found with id: 123",
  "path": "/api/v1/songs/123",
  "validationErrors": { "email": "must be a well-formed email address" }
}
```

| HTTP status | Meaning |
|---|---|
| 400 | Validation failure (`validationErrors` populated), bad request, duplicate resource |
| 401 | Unauthorized — missing/invalid credentials, bad credentials, access denied |
| 404 | Resource not found (also unmapped URLs) |
| 405 | Method not allowed on a known path |
| 413 | Upload exceeds `spring.servlet.multipart` limits (50 MB file / 100 MB request) |
| 500 | Unhandled server error |

## Pagination

List endpoints accept `page` (0-based, default `0`) and `size` (default `20`) and return `PagedResponse`:

```json
{
  "content": [ ],
  "page": 0,
  "size": 20,
  "totalElements": 137,
  "totalPages": 7,
  "first": true,
  "last": false
}
```

Trending/featured/new-releases-style endpoints return plain arrays and take `limit` (default `20`).

## Endpoint map

### Auth — `POST /api/v1/auth` (all public)

| Method | Path | Notes |
|---|---|---|
| POST | `/register` | email, username, password |
| POST | `/login` | email + password → `{ accessToken, refreshToken }` |
| POST | `/refresh` | body `{ refreshToken }` → new token pair |
| POST | `/social/{provider}` | provider e.g. `google`, `apple` |
| POST | `/forgot-password` | email-triggered reset |
| POST | `/reset-password` | new password |

### Users — `/api/v1/users`

| Method | Path | Notes |
|---|---|---|
| GET | `/me` | current profile |
| PUT | `/me` | update profile |
| DELETE | `/me` | delete account |
| PUT | `/me/avatar` | multipart, field `file` |
| PUT | `/me/cover` | multipart, field `file` |
| PUT | `/me/password` | change password |
| GET | `/{id}` | public profile |
| GET | `/{id}/stats` | user stats |
| POST | `/{id}/follow` | follow user |
| DELETE | `/{id}/follow` | unfollow |
| GET | `/{id}/followers` | follower list |
| GET | `/{id}/following` | following list |

### Songs — `/api/v1/songs`

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/` | JWT | paged |
| GET | `/home` | JWT | home feed, sorted by `createdAt` desc |
| GET | `/search?q=` | JWT | fast song search |
| GET | `/{id}` | JWT | song detail |
| POST | `/` | ARTIST or ADMIN | multipart: `request` (JSON), `audioFile`, `coverFile` |
| PUT | `/{id}` | ARTIST or ADMIN | multipart as above |
| DELETE | `/{id}` | ARTIST or ADMIN | soft delete |
| POST | `/{id}/restore` | ADMIN | undo soft delete |
| GET | `/trending?limit=` | JWT | |
| GET | `/new-releases?limit=` | JWT | |
| GET | `/featured?limit=` | JWT | |
| POST | `/{id}/like` | JWT | 201 Created |
| DELETE | `/{id}/like` | JWT | 204 No Content |
| GET | `/{id}/stream` | **public** | 302 redirect to R2 (Range-capable) or signed Supabase URL; increments play count; supports `Range` headers |

### Albums — `/api/v1/albums`

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/` | JWT | paged |
| GET | `/{id}` | JWT | |
| POST | `/` | ARTIST or ADMIN | multipart: `request`, `coverFile` |
| PUT | `/{id}` | ARTIST or ADMIN | multipart: `request`, `coverFile` |
| DELETE | `/{id}` | ARTIST or ADMIN | soft delete |
| POST | `/{id}/restore` | ADMIN | |
| GET | `/featured?limit=` | JWT | |
| GET | `/new-releases?limit=` | JWT | |
| POST | `/{id}/like` | JWT | |
| DELETE | `/{id}/like` | JWT | |

### Artists — `/api/v1/artists`

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/` | JWT | paged |
| GET | `/{id}` | JWT | |
| POST | `/` | ADMIN | multipart: `name`, `bio`, `imageFile`, `coverFile` |
| PUT | `/{id}` | ADMIN | multipart, same fields |
| GET | `/top?limit=` | JWT | |
| GET | `/featured?limit=` | JWT | |
| POST | `/{id}/follow` | JWT | |
| DELETE | `/{id}/follow` | JWT | |

### Playlists — `/api/v1/playlists`

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/` | JWT | own playlists |
| GET | `/{id}` | JWT | |
| POST | `/` | JWT | body `{ name, description }` |
| PUT | `/{id}` | JWT | |
| DELETE | `/{id}` | JWT | |
| POST | `/{id}/duplicate` | JWT | |
| POST | `/{id}/merge?sourcePlaylistId=` | JWT | merge another playlist in |
| POST | `/{id}/songs` | JWT | add song |
| DELETE | `/{id}/songs/{songId}` | JWT | remove song |
| PUT | `/{id}/songs/reorder` | JWT | reorder tracks |
| PUT | `/{id}/public` | JWT | toggle visibility |
| PUT | `/{id}/collaborative` | JWT | toggle collaborative editing |
| POST | `/{id}/collaborators` | JWT | add collaborator |
| GET | `/featured?limit=` | **public** | |
| POST | `/{id}/like` | JWT | |
| DELETE | `/{id}/like` | JWT | |

### Queue — `/api/v1/queue`

| Method | Path | Notes |
|---|---|---|
| GET | `/` | current queue |
| POST | `/` | add items |
| POST | `/play-next` | play next |
| DELETE | `/{id}` | remove item |
| PUT | `/{id}/move` | reorder item |
| DELETE | `/` | clear queue |
| POST | `/save` | persist queue (offline sync) |
| POST | `/restore` | restore saved queue |

### Library — `/api/v1/library`

| Method | Path |
|---|---|
| GET | `/` |
| GET | `/playlists` |
| GET | `/albums` |
| GET | `/artists` |
| GET | `/liked-songs` |
| GET | `/recent` |
| GET | `/history` |

### Search — `/api/v1/search`

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/` | JWT | `query`, `types=song,album,artist,playlist`, `page`, `size`, `language`, `year`, `genre`, `sortBy` (default `relevance`) |
| GET | `/suggestions?query=&limit=` | **public** | type-ahead, returns string list |
| GET | `/trending?limit=` | **public** | trending search terms |

### Home — `/api/v1/home`

| Method | Path | Notes |
|---|---|---|
| GET | `/` | personalized sections + daily mixes via `RecommendationService` (listening history + likes) |

### Notifications — `/api/v1/notifications`

| Method | Path | Notes |
|---|---|---|
| GET | `/` | list |
| GET | `/unread-count` | |
| PUT | `/{id}/read` | mark read |
| PUT | `/read-all` | |

### Downloads — `/api/v1/downloads`

All endpoints require `USER`/`PREMIUM_USER`/`ARTIST`/`ADMIN`.

| Method | Path | Notes |
|---|---|---|
| POST | `/?songId=&quality=` | queue a download, quality default `HIGH` |
| GET | `/?status=` | list downloads, optional status filter |
| GET | `/stats` | download statistics |
| DELETE | `/{songId}` | remove one |
| DELETE | `/` | clear downloads |
| PUT | `/{songId}/play` | record offline play |

### Settings — `/api/v1/settings`

| Method | Path | Notes |
|---|---|---|
| GET | `/` | user settings |
| PUT | `/` | update settings |
| PUT | `/theme` | body e.g. `{ "darkMode": true }` |

### Admin — `/api/v1/admin` (requires `ROLE_ADMIN`)

| Method | Path | Notes |
|---|---|---|
| GET | `/dashboard` | admin summary |
| GET | `/users` | user list |
| PUT | `/users/{id}/role` | change role |
| DELETE | `/songs/{id}` | hard remove song |
| POST | `/feature/song` | feature a song |
| POST | `/feature/playlist` | feature a playlist |
| GET | `/analytics/overview` | platform metrics |
| GET | `/analytics/user-growth` | signup growth |
| GET | `/analytics/top-songs` | |
| GET | `/analytics/top-genres` | |

## Realtime (STOMP WebSocket)

Endpoint: `/ws` (registered both with SockJS and as a raw WebSocket; no auth gate — identity comes from the authenticated STOMP session). Broker prefixes: `/topic`, `/queue`, `/user`. Application prefix: `/app`. User destinations: `/user`.

### Client sends (destination under `/app`)

| Destination | Payload | Purpose |
|---|---|---|
| `/app/presence.online` | — | mark user online, broadcast presence |
| `/app/presence.offline` | — | mark user offline, broadcast presence |
| `/app/queue.sync` | `{ ...playbackState }` | sync playback to the user's other devices |
| `/app/playlist.{playlistId}.edit` | edit payload | collaborative playlist edit; `editor` added server-side |
| `/app/playlist.{playlistId}.join` | — | broadcast `MEMBER_JOINED` |
| `/app/playlist.{playlistId}.leave` | — | broadcast `MEMBER_LEFT` |

### Server pushes (subscribe)

| Topic | Events |
|---|---|
| `/topic/presence` | `{ userId, online: true/false }` |
| `/topic/playlists/{playlistId}` | playlist edits, `MEMBER_JOINED`, `MEMBER_LEFT` |
| `/user/queue/notifications` | notifications (via `RealtimeService.pushNotification`) |
| `/user/queue/queue-updates` | `{ type: "QUEUE_SYNC", data, from }` (via `RealtimeService.pushQueueUpdate`) |

Mobile client: `mobile/src/realtime/client.ts` (stompjs). In production, nginx proxies `/ws/` with a 24 h read timeout.

## Example session

```bash
# 1. Register or login
curl -X POST http://localhost:8088/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"secret"}'

# 2. Use the token
curl http://localhost:8088/api/v1/home \
  -H "Authorization: Bearer <accessToken>"

# 3. Public streaming endpoint (no token)
curl -I "http://localhost:8088/api/v1/songs/<songId>/stream"
```
