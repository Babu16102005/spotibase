import os
import tempfile
import time
import logging
from pathlib import Path

logger = logging.getLogger("spotibase-ai.stt")
if not logger.handlers:
    logging.basicConfig(level=logging.INFO)

STT_MODEL = os.getenv("STT_MODEL", "small")  # tiny | small | medium | large
STT_MODE = os.getenv("STT_MODE", "mock")  # mock | faster-whisper

_whisper = None

def _load_whisper():
    global _whisper
    if _whisper is not None:
        return _whisper
    if STT_MODE == "mock":
        return None
    try:
        from faster_whisper import WhisperModel
        print(f"[STT] Loading faster-whisper {STT_MODEL} ...")
        device = "cuda" if os.getenv("CUDA_VISIBLE_DEVICES") else "cpu"
        compute = "float16" if device == "cuda" else "int8"
        _whisper = WhisperModel(STT_MODEL, device=device, compute_type=compute)
        print("[STT] Whisper loaded")
        return _whisper
    except Exception as e:
        print(f"[STT] load failed: {e}")
        logger.warning("[STT] faster-whisper load failed (%s); returning empty transcript", e)
        return None

def transcribe(audio_bytes: bytes, filename: str = "audio.webm") -> str:
    """
    audio_bytes -> transcript
    In mock mode returns "" (STT_MODE=mock default) — callers MUST use the
    transcript_fallback form field (see routes/speech.py /voice).
    In faster-whisper mode uses WhisperModel(STT_MODEL); repeat clips are served
    from shared Redis (600s TTL, see cache_service) so Whisper is skipped.
    Latency is logged; failures degrade to "" (never raise).
    """
    t0 = time.perf_counter()
    if STT_MODE == "mock":
        # For dev without model, return empty so the transcript_fallback path is exercised.
        # Client should send real transcript via fallback field if needed.
        logger.info("[STT] mock mode -> empty transcript (use transcript_fallback) latency_ms=%.1f",
                    (time.perf_counter() - t0) * 1000)
        return ""

    # Cache hit skips Whisper entirely (keyed by audio bytes + model).
    try:
        from app.services import cache_service
        hit = cache_service.get_transcript(audio_bytes, STT_MODEL)
        if isinstance(hit, str) and hit:
            logger.info("[STT] cache_hit model=%s latency_ms=%.1f",
                        STT_MODEL, (time.perf_counter() - t0) * 1000)
            return hit
    except Exception as e:
        logger.debug("[STT] cache lookup failed: %s", e)

    model = _load_whisper()
    if model is None:
        logger.warning("[STT] model unavailable -> empty transcript latency_ms=%.1f",
                       (time.perf_counter() - t0) * 1000)
        return ""

    # Write to temp file - faster-whisper expects path
    suffix = Path(filename).suffix or ".webm"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        segments, info = model.transcribe(tmp_path, beam_size=5, language=None)
        text = " ".join([s.text.strip() for s in segments]).strip()
        print(f"[STT] lang={info.language} prob={info.language_probability:.2f} text={text[:120]}")
        logger.info("[STT] transcribed model=%s lang=%s bytes=%d latency_ms=%.1f text=%r",
                    STT_MODEL, getattr(info, "language", None), len(audio_bytes),
                    (time.perf_counter() - t0) * 1000, text[:80])
        try:
            from app.services import cache_service
            cache_service.put_transcript(audio_bytes, STT_MODEL, text)
        except Exception:
            pass
        return text
    except Exception as e:
        logger.warning("[STT] transcribe failed (%s) latency_ms=%.1f", e, (time.perf_counter() - t0) * 1000)
        return ""
    finally:
        try:
            Path(tmp_path).unlink(missing_ok=True)
        except Exception:
            pass

def health():
    loaded = _whisper is not None if STT_MODE != "mock" else True
    return {"whisper_loaded": loaded, "whisper_model": STT_MODEL}
