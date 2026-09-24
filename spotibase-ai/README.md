# SpotiBase AI - FastAPI AI Server

Private AI runtime for SpotiBase. **Never exposed to mobile directly** — Spring Boot calls it over private HTTP (`AI_SERVICE_URL`).

```
Mobile -> Spring Boot (/api/v1/ai/*) -> FastAPI (this service) -> Qwen / Whisper -> Actions -> Spring Boot executes -> DB / STOMP / Player
```

## Modes

| `AI_MODE` | Behaviour | RAM | When |
|---|---|---|---|
| `mock` (default) | Rule-based YouTube-like keyword mock (no model download). Covers 80%+ commands. | ~200MB | Dev / CI / demos |
| `transformers` | Loads `Qwen2.5-3B-Instruct` locally via transformers | ~8GB RAM / 6GB VRAM | Prod with GPU or large CPU |
| `hf_api` | Calls HuggingFace Inference API (`HF_TOKEN`) | ~200MB | No GPU, needs internet |
| `cf_workers` | Calls Cloudflare Workers AI (`CF_ACCOUNT_ID` + `CF_AI_TOKEN`, token never logged, default `CF_MODEL=@cf/qwen/qwen3-30b-a3b-fp8`, 2 attempts: `CF_TIMEOUT_S` 2.5s then 1.0s, retry 429/5xx/timeout only, else mock fallback) | ~200MB | Low-latency prod without GPU |

| `STT_MODE` | `STT_MODEL` | When |
|---|---|---|
| `mock` | - | Dev (returns `""`, use `transcript_fallback`) |
| `faster-whisper` | `tiny` / `small` / `medium` | Prod (small = 244MB, good quality/speed) |

## Quick start (mock, no GPU needed)

```bash
cd spotibase-ai
python -m venv venv
venv\Scripts\activate  # Windows
pip install -r requirements.txt
uvicorn app.main:app --reload --port 7860
# docs: http://localhost:7860/docs
# health: http://localhost:7860/health
```

Test:

```bash
curl -X POST http://localhost:7860/assistant/understand \
  -H "Content-Type: application/json" \
  -d '{"text": "Play calm Tamil songs"}'

# -> {"actions":[{"action":"PLAY_BY_MOOD","parameters":{"mood":"CALM","language":"TAMIL"}}],
#     "parsedKeywords":{"song":null,"artist":null,"mood":"CALM","genre":null,"language":"TAMIL","verbs":["play"]},
#     "searchQuery":"calm tamil","displayText":"Playing Calm Tamil songs.",...}

curl -X POST http://localhost:7860/speech/voice \
  -F audio=@test.webm \
  -F transcript_fallback="next song"
```

## Prompt / response contract

System prompt: `app/prompts/assistant_system.txt` (30-action allow-list, mood/genre/language vocab).

Request (`POST /assistant/understand`):

```json
{ "text": "play Munbe Vaa by A R Rahman", "context": { "lastMood": "CALM" } }
```

Response (mock + real models share this shape):

```json
{
  "actions": [{ "action": "SEARCH_SONG", "parameters": { "song": "Munbe Vaa", "artist": "A R Rahman" } }],
  "response": "Playing Munbe Vaa by A R Rahman.",
  "clarificationNeeded": false,
  "clarificationQuestion": null,
  "suggestions": null,
  "parsedKeywords": { "song": "Munbe Vaa", "artist": "A R Rahman", "mood": null, "genre": null, "language": null, "verbs": ["play", "search"] },
  "searchQuery": "Munbe Vaa A R Rahman",
  "displayText": "Playing Munbe Vaa by A R Rahman."
}
```

Unknown input returns clarification with **3 suggestions**:

```json
{
  "actions": [],
  "clarificationNeeded": true,
  "clarificationQuestion": "I didn't catch that. Try one of these: 'Play calm Tamil songs', 'Play Anirudh hits', 'Play 90s melodies'",
  "suggestions": ["Play calm Tamil songs", "Play Anirudh hits", "Play 90s melodies"],
  "parsedKeywords": { "song": null, "artist": null, "mood": null, "genre": null, "language": null, "verbs": [] },
  "searchQuery": "<cleaned keywords>",
  "displayText": "<same as clarificationQuestion>"
}
```

Mock keyword rules (`app/services/llm_service.py::_mock_understand`):

- Entry normalization: lowercase → trim → collapse whitespace → strip quotes (typo-tolerant;
  artist/mood/genre/language also fuzzy-matched via `difflib`, e.g. `aniruth`→`Anirudh`).
- Stopwords stripped for `searchQuery`: leading `play/put on/listen to/find/search/show/please…`,
  trailing `song(s)/music/track(s)/video/please/for me/now/yaar…`, leading articles.
- `parsedKeywords` = `{song, artist, mood, genre, language, verbs}`.
- Artist aliases normalized (20+, incl. typos): `ani/anirudh/aniruth/aneerudh`→`Anirudh`,
  `arr/rahman`→`A R Rahman`, `yuvan/yuwan`→`Yuvan`, `hiphop`→`Hiphop Tamizha`,
  `gv`→`G V Prakash`, `ilayaraja/illayaraja`→`Ilaiyaraaja`, `spb`→`S P Balasubrahmanyam`,
  `arjit`→`Arijit Singh`, `harris`→`Harris Jayaraj`, `thaman/dsp/santhosh/imman…`, etc.
- Patterns: `play X by Y` → `SEARCH_SONG{song:X, artist:Y}`; `<artist> hits/songs/mix`
  → `SEARCH_ARTIST`; `mood + language` (e.g. `happy tamil songs`) → `PLAY_BY_MOOD`;
  bare `play <keywords>` → `SEARCH_SONG{query}`; controls (`next/pause/like/…`) bypass the LLM.
- Safety: only the 30-action allow-list is ever emitted (`llm_service.ALLOWED_ACTIONS`);
  anything else → clarification. No SQL/DB access, no invented IDs, secrets via env only
  (`HF_TOKEN`, `CF_ACCOUNT_ID`/`CF_AI_TOKEN`, `REDIS_URL` — never hardcoded, CF token never logged).
  `hf_api` retries once then falls back to mock; `cf_workers` tries twice
  (`CF_TIMEOUT_S` then 1.0s, retrying 429/5xx/timeout only, missing secret → mock immediately)
  then falls back to mock.

## With real models

```bash
# Local Qwen
set AI_MODE=transformers
set QWEN_MODEL=Qwen/Qwen2.5-3B-Instruct
uvicorn app.main:app --port 7860

# Faster-whisper
set STT_MODE=faster-whisper
set STT_MODEL=small

# Cloudflare Workers AI (no GPU, low latency; missing secret falls back to mock)
set AI_MODE=cf_workers
set CF_ACCOUNT_ID=your_cloudflare_account_id
set CF_AI_TOKEN=your_cloudflare_ai_token
set CF_MODEL=@cf/qwen/qwen3-30b-a3b-fp8
set CF_TIMEOUT_S=2.5
uvicorn app.main:app --port 7860
```

### Enabling faster-whisper (optional, NOT forced)

Mock is the default and needs nothing. To get real speech-to-text:

1. **Install the model lib** (once per env):
   ```bash
   pip install faster-whisper==1.0.1
   # requirements.txt keeps this commented so mock installs stay light
   ```
2. **ffmpeg must be on PATH** — `Dockerfile` already installs it
   (`apt-get install ffmpeg`), so Docker needs no change. On Windows:
   `winget install ffmpeg` or `choco install ffmpeg`, then reopen the terminal.
3. **Set env** (no code change):
   ```bash
   # Windows (cmd)
   set STT_MODE=faster-whisper
   set STT_MODEL=small   # tiny=75MB/fast, small=244MB/balanced (default), medium=769MB/best
   # Linux / Docker
   export STT_MODE=faster-whisper STT_MODEL=small
   docker run -p 7860:7860 -e STT_MODE=faster-whisper -e STT_MODEL=small spotibase-ai
   ```
4. **Verify**: `GET /health` → `whisper_loaded:true`; `POST /speech/transcribe`
   returns a non-empty `transcript`. `STT_MODE=mock` keeps returning `""`
   (voice clients then send `transcript_fallback` — that path is always active).
5. **Cache**: repeat clips skip Whisper via Redis (`AI_CACHE_STT_TTL=600`, default 600s).

## Docker

```bash
docker build -t spotibase-ai .
docker run -p 7860:7860 -e AI_MODE=mock spotibase-ai
# compose (added to docker-compose.yml as spotibase-ai service)
docker compose -f docker-compose.yml --profile ai up -d
```

## Env vars (no secrets hardcoded)

| Var | Default | Notes |
|---|---|---|
| `AI_MODE` | `mock` | `mock` / `transformers` / `hf_api` / `cf_workers` |
| `QWEN_MODEL` | `Qwen/Qwen2.5-3B-Instruct` | HF repo (transformers/hf_api) |
| `HF_TOKEN` | - | For hf_api (env/secret only) |
| `CF_ACCOUNT_ID` | - | For cf_workers (env/secret only) |
| `CF_AI_TOKEN` | - | For cf_workers (env/secret only, never logged) |
| `CF_MODEL` | `@cf/qwen/qwen3-30b-a3b-fp8` | Workers AI model id |
| `CF_TIMEOUT_S` | `2.5` | First-attempt timeout s (retry once with 1.0s; 429/5xx/timeout only) |
| `STT_MODE` | `mock` | `mock` / `faster-whisper` |
| `STT_MODEL` | `small` | `tiny` / `small` / `medium` |
| `AI_PORT` | `7860` | FastAPI port |
| `REDIS_URL` | `redis://localhost:6379/0` | Shared cache (optional; uncached if unreachable) |
| `AI_CACHE_UNDERSTAND_TTL` | `300` | Understand cache seconds |
| `AI_CACHE_STT_TTL` | `600` | STT cache seconds |

Spring Boot env:

| Var | Purpose |
|---|---|
| `AI_ENABLED` | feature flag |
| `AI_SERVICE_URL` | `http://spotibase-ai:7860` (docker) or `http://localhost:7860` (jar) |
| `AI_RATE_LIMIT_PER_USER` | Bucket4j per user |
| `AI_GLOBAL_RATE_LIMIT` | global cap |

## Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | qwen/whisper loaded, device |
| POST | `/assistant/understand` | `{text, context}` -> `{actions, response, parsedKeywords, searchQuery, displayText}` |
| POST | `/speech/transcribe` | `audio` -> `{transcript}` (`""` in mock) |
| POST | `/speech/voice` | `audio` + `transcript_fallback` -> `{actions, ...}` (fallback always honored) |

All responses validate against allowed `AssistantAction` enum — hallucinated actions are rejected and returned as clarification with 3 suggestions. Every request logs latency (`understand`, `stt`, `cache hit/miss`) for ops visibility.
