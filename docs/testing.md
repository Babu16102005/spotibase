# SpotiBase — Testing

Three test layers: backend JUnit tests, mobile Jest tests, and the end-to-end production smoke suite. CI runs all of them on every push/PR to `main` and `develop`.

## 1. Backend tests (JUnit 5 + Spring Boot Test)

**Location:** `backend/src/test/java/com/spotibase/`

- `service/` — 10 service tests: `AuthServiceTest`, `UserServiceTest`, `SongServiceTest`, `SettingsServiceTest`, `SearchServiceTest`, `QueueServiceTest`, `PlaylistServiceTest`, `NotificationServiceTest`, `LikeServiceTest`, `AdminServiceTest`
- `controller/` — 7 controller tests: `AuthControllerTest`, `SongControllerTest`, `SearchControllerTest`, `QueueControllerTest`, `PlaylistControllerTest`, `AdminControllerTest`, plus `DebugAdminTest`
- `security/` — `JwtTokenProviderTest`, `JwtAuthenticationFilterTest`
- `dto/DtoValidationTest`, `exception/GlobalExceptionHandlerTest`
- `support/` — `BaseWebMvcTest`, `TestSecurityConfig`, `TestUsers`

**Count:** 323 `@Test` methods. Testcontainers (core + postgresql) is on the test classpath for container-based integration work.

**Run locally:**

```powershell
cd backend
mvn test
```

CI runs the suite with an explicit test profile and external-service properties against a Postgres 16 service container. If local runs fail on missing configuration, mirror the CI flags (see `.github/workflows/backend.yml`):

```powershell
mvn -B test -DskipITs -Dspring.profiles.active=test `
  -Dsupabase.url=jdbc:postgresql://localhost:5432/spotibase_test `
  -Dsupabase.service-role-key=test -Dsupabase.storage.bucket=test `
  -Dr2.account-id=test -Dr2.access-key-id=test -Dr2.secret-access-key=test `
  -Dr2.bucket-name=test -Dr2.public-url=http://localhost:9000 `
  -Djwt.secret=test-secret-key-for-testing-purposes-only-must-be-32-chars-min `
  -Djwt.expiration=3600000 -Djwt.refresh-expiration=604800000 `
  -Dmail.host=localhost -Dmail.port=1025 -Dmail.username=test -Dmail.password=test `
  -Dmail.from=test@spotibase.local -Dopenai.api-key=test `
  -Dapp.base-url=http://localhost:8088 -Dapp.frontend-url=http://localhost:3000
```

Reports land in `backend/target/surefire-reports/`; JaCoCo coverage in `backend/target/site/jacoco/`.

## 2. Mobile tests (Jest)

**Location:** `mobile/src/**/*.test.ts(x)` — 11 files, 119 test cases:

| File | Covers |
|---|---|
| `api/client.test.ts` | API client setup and URL resolution |
| `utils/index.test.ts` | shared utilities |
| `store/authStore.test.ts`, `store/playerStore.test.ts`, `store/themeStore.test.ts` | Zustand stores |
| `components/SongCard.test.tsx`, `SkeletonLoader.test.tsx`, `SectionHeader.test.tsx`, `MiniPlayer.test.tsx` | UI components |
| `screens/auth/LoginScreen.test.tsx`, `RegisterScreen.test.tsx` | auth screens |

**Run locally:**

```powershell
cd mobile
npm test            # jest
npm test -- --watch # watch mode
npm run lint        # eslint src --ext .ts,.tsx
npm run typecheck   # tsc --noEmit
```

CI runs `npm test -- --ci --coverage --maxWorkers=2` and uploads `mobile/coverage/` as an artifact.

## 3. Production smoke tests (PowerShell)

**Location:** `tests/prod-smoke-tests.ps1` — 48 test cases against the live production backend.

**Requires a running stack** (backend on :8088). The `run-project.ps1` launcher runs them automatically as step 3; run them standalone with:

```powershell
powershell -ExecutionPolicy Bypass -File tests\prod-smoke-tests.ps1
# against a different host:
powershell -ExecutionPolicy Bypass -File tests\prod-smoke-tests.ps1 -BaseUrl "http://myserver:8088"
# machine-readable, failures only:
powershell -ExecutionPolicy Bypass -File tests\prod-smoke-tests.ps1 -Quiet
```

Exit code 0 = all green, 1 = one or more failures (failure names are printed and also available via the `-Quiet` summary).

**What the 48 tests cover:**

| Section | Cases | What it proves |
|---|---|---|
| 1. Health & infrastructure | 4 | `/actuator/health` UP (public); `/actuator/info` secured; Swagger UI reachable; `/api-docs` exposes 50+ endpoints |
| 2. Public content endpoints | 5 | suggestions, trending and featured playlists work anonymously; song streaming is public; `/api/v1/home` is blocked without a token |
| 3. Authentication flow | 7 | register → login (token pair) → refresh → `/users/me`; wrong password 401; missing and garbage tokens rejected |
| 4. Authenticated content & core flows | 26 | 22 GET endpoints (home, songs, artists, albums, search, library, settings, notifications, queue) with a valid token; playlist create/get/library/theme update |
| 5. Error handling & security edge cases | 6 | nonexistent song 404; duplicate email 4xx; invalid email 400; admin endpoints blocked for regular users and anonymous; wrong method 405 |

The suite creates a throwaway account per run (`smoketest.<timestamp>@example.com`) and a test playlist; it does not clean them up.

## 4. What CI runs

`.github/workflows/ci.yml` orchestrates:

1. `validate` — path filter decides which pipelines run (`backend/**`, `mobile/**`, docs-only changes skip both).
2. `backend.yml` — `mvn test` against a Postgres 16 service (flags above), then package the jar, push a `ghcr.io` image, and run the (stubbed) staging/production deploy hooks.
3. `mobile.yml` — `npm run lint` + `npm run typecheck` + Jest with coverage, then `npm run web:build` (verifies `index.html`, `manifest.json`, `sw.js` exist), EAS Android/iOS builds on main/develop pushes, and Vercel preview/production deploys.
4. `docker-compose-test` — integration smoke: builds both images, boots Postgres + backend on :8088, polls `/actuator/health` until UP, boots the web image on :3000 and curls it.
5. `notify` — summarizes the three pipeline results.

## 5. Test checklist before a release

- [ ] `mvn test` green in `backend/`
- [ ] `npm test`, `npm run lint`, `npm run typecheck` green in `mobile/`
- [ ] `run-project.ps1` starts the stack and all 48 smoke tests pass
- [ ] Manual pass: register/login, stream a song (R2 redirect), create a collaborative playlist, download a song, toggle theme
