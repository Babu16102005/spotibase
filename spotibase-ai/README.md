# SpotiBase AI - FastAPI AI Server

Private AI runtime for SpotiBase. **Never exposed to mobile directly** — Spring Boot calls it over private HTTP (`AI_SERVICE_URL`).

```
Mobile -> Spring Boot (/api/v1/ai/*) -> FastAPI (this service) -> Qwen / Whisper -> Actions -> Spring Boot executes -> DB / STOMP / Player
```

## Modes

| `AI_MODE` | Behaviour | RAM | When |
|---|---|---|---|
| `mock` (default) | Rule-based keyword mock (no model download). Covers 80% commands. | ~200MB | Dev / CI / demos |
| `transformers` | Loads `Qwen2.5-3B-Instruct` locally via transformers | ~8GB RAM / 6GB VRAM | Prod with GPU or large CPU |
| `hf_api` | Calls HuggingFace Inference API (`HF_TOKEN`) | ~200MB | No GPU, needs internet |

| `STT_MODE` | `STT_MODEL` | When |
|---|---|---|
| `mock` | - | Dev |
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

# -> {"actions":[{"action":"PLAY_BY_MOOD","parameters":{"mood":"CALM","language":"TAMIL"}}],...}

curl -X POST http://localhost:7860/speech/voice \
  -F audio=@test.webm \
  -F transcript_fallback="next song"
```

## With real models

```bash
# Local Qwen
set AI_MODE=transformers
set QWEN_MODEL=Qwen/Qwen2.5-3B-Instruct
uvicorn app.main:app --port 7860

# Faster-whisper
set STT_MODE=faster-whisper
set STT_MODEL=small
```

## Docker

```bash
docker build -t spotibase-ai .
docker run -p 7860:7860 -e AI_MODE=mock spotibase-ai
# compose (added to docker-compose.yml as spotibase-ai service)
docker compose -f docker-compose.yml --profile ai up -d
```

## Env vars

| Var | Default | Notes |
|---|---|---|
| `AI_MODE` | `mock` | `mock` / `transformers` / `hf_api` |
| `QWEN_MODEL` | `Qwen/Qwen2.5-3B-Instruct` | HF repo |
| `HF_TOKEN` | - | For hf_api |
| `STT_MODE` | `mock` | `mock` / `faster-whisper` |
| `STT_MODEL` | `small` | `tiny` / `small` / `medium` |
| `AI_PORT` | `7860` | FastAPI port |

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
| POST | `/assistant/understand` | `{text, context}` -> `{actions, response}` |
| POST | `/speech/transcribe` | `audio` -> `{transcript}` |
| POST | `/speech/voice` | `audio` + `transcript_fallback` -> `{actions}` |

All responses validate against allowed `AssistantAction` enum — hallucinated actions are rejected and returned as clarification.
