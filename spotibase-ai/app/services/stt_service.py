import os
import tempfile
from pathlib import Path

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
        return None

def transcribe(audio_bytes: bytes, filename: str = "audio.webm") -> str:
    """
    audio_bytes -> transcript
    In mock mode returns placeholder; in real mode uses faster-whisper.
    """
    if STT_MODE == "mock":
        # For dev without model, return a deterministic placeholder based on size
        # Client should send real transcript via fallback field if needed
        return ""

    model = _load_whisper()
    if model is None:
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
        return text
    finally:
        try:
            Path(tmp_path).unlink(missing_ok=True)
        except:
            pass

def health():
    loaded = _whisper is not None if STT_MODE != "mock" else True
    return {"whisper_loaded": loaded, "whisper_model": STT_MODEL}
