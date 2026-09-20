"""
Shared Redis cache for the SpotiBase AI server (FastAPI).

- understand(text) answers are cached by normalized-text hash (repeat voice/text
  commands skip the LLM entirely).
- STT transcripts are cached by audio SHA-256 (repeat voice clips skip Whisper).
- Redis is OPTIONAL: if unreachable/misconfigured every helper degrades to
  miss/no-op so requests never fail because of cache. Same Redis instance is
  shared with Spring Boot (localhost:6379 locally, `redis:6379` in compose).
"""
import hashlib
import json
import os

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
UNDERSTAND_TTL = int(os.getenv("AI_CACHE_UNDERSTAND_TTL", "300"))
STT_TTL = int(os.getenv("AI_CACHE_STT_TTL", "600"))

_client = None
_disabled = False


def _get_client():
    global _client, _disabled
    if _disabled:
        return None
    if _client is not None:
        return _client
    try:
        import redis
        c = redis.Redis.from_url(REDIS_URL, socket_connect_timeout=1.5, socket_timeout=1.5)
        c.ping()
        _client = c
        print(f"[CACHE] Redis connected ({REDIS_URL})")
        return _client
    except Exception as e:
        _disabled = True  # fail fast next time; retry on next process start
        print(f"[CACHE] Redis unavailable ({e}), running uncached")
        return None


def _load(key: str):
    c = _get_client()
    if c is None:
        return None
    try:
        raw = c.get(key)
        if raw is None:
            return None
        return json.loads(raw)
    except Exception:
        return None


def _save(key: str, value: dict, ttl: int):
    c = _get_client()
    if c is None:
        return
    try:
        c.setex(key, ttl, json.dumps(value, ensure_ascii=False))
    except Exception:
        pass


def normalize_text(text: str) -> str:
    return " ".join((text or "").strip().lower().split())


def understand_key(text: str, ai_mode: str, context) -> str:
    ctx = ""
    if context:
        try:
            ctx = json.dumps(context, sort_keys=True, ensure_ascii=False, default=str)
        except Exception:
            ctx = str(context)
    h = hashlib.sha256(f"understand:v1:{ai_mode}:{normalize_text(text)}:{ctx}".encode("utf-8")).hexdigest()
    return h


def get_understand(text: str, ai_mode: str, context):
    return _load(understand_key(text, ai_mode, context))


def put_understand(text: str, ai_mode: str, context, result: dict):
    if isinstance(result, dict):
        _save(understand_key(text, ai_mode, context), result, UNDERSTAND_TTL)


def stt_key(audio_bytes: bytes, model: str) -> str:
    h = hashlib.sha256(b"stt:v1:" + model.encode("utf-8") + b":" + audio_bytes).hexdigest()
    return h


def get_transcript(audio_bytes: bytes, model: str):
    hit = _load(stt_key(audio_bytes, model))
    if isinstance(hit, dict) and isinstance(hit.get("text"), str):
        return hit["text"]
    return None


def put_transcript(audio_bytes: bytes, model: str, text: str):
    if text:  # never cache empty/mock silence
        _save(stt_key(audio_bytes, model), {"text": text}, STT_TTL)


def health() -> dict:
    c = _get_client()
    if c is None:
        return {"redis": "unavailable (uncached mode)", "url": REDIS_URL}
    try:
        info = c.info("server")
        return {"redis": "connected", "url": REDIS_URL, "version": info.get("redis_version")}
    except Exception as e:
        return {"redis": f"error: {e}", "url": REDIS_URL}
