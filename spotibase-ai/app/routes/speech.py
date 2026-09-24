import logging
import time
from fastapi import APIRouter, UploadFile, File, Form
from typing import Optional
from app.schemas.assistant import AssistantContext, UnderstandRequest, UnderstandResponse
from app.services import stt_service, llm_service

logger = logging.getLogger("spotibase-ai.speech")
if not logger.handlers:
    logging.basicConfig(level=logging.INFO)

router = APIRouter()

# Keep in sync with llm_service.ALLOWED_ACTIONS (single source of truth).
ALLOWED = llm_service.ALLOWED_ACTIONS

# Realtime-partial allow-list: SEARCH-only preview. Anything that would cause
# a side-effect if dispatched (queue/like/playlist/player-controls) is
# dropped here so the partial path is always read-only. Callers must use the
# full /speech/voice (3s) path to execute.
PARTIAL_ALLOWED = frozenset({"SEARCH_SONG", "SEARCH_ARTIST", "SEARCH_ALBUM"})


@router.post("/transcribe", response_model=dict)
async def transcribe(audio: UploadFile = File(..., description="Audio file webm/wav/mp3")):
    """Audio -> transcript. In STT_MODE=mock returns '' (client uses transcript_fallback)."""
    t0 = time.perf_counter()
    data = await audio.read()
    if len(data) > 15 * 1024 * 1024:
        return {"error": "Audio too large (max 15MB)"}
    text = stt_service.transcribe(data, audio.filename or "audio.webm")
    # In mock mode text is empty -> client should send transcript fallback; we return empty to signal
    logger.info("[speech/transcribe] bytes=%d file=%s mock=%s latency_ms=%.1f transcript=%r",
                len(data), audio.filename, stt_service.STT_MODE == "mock",
                (time.perf_counter() - t0) * 1000, (text or "")[:80])
    return {"transcript": text, "language": None}


@router.post("/voice", response_model=UnderstandResponse)
async def voice(
    audio: UploadFile = File(..., description="Audio file"),
    context: Optional[str] = Form(None),
    transcript_fallback: Optional[str] = Form(None, description="Fallback transcript when STT mock")
):
    """
    Single call: Audio -> STT -> Qwen/mock -> Actions
    Used by Spring Boot /api/v1/ai/voice (private). Mobile sends to Spring Boot, Spring Boot forwards here.

    STT_MODE=mock returns "" from Whisper, so transcript_fallback (typed text or
    device-side STT) is used instead. Repeat clips skip Whisper via Redis (600s TTL),
    repeat texts skip the LLM via Redis (300s TTL). Latency is logged per stage.
    """
    t0 = time.perf_counter()
    data = await audio.read()
    if len(data) > 15 * 1024 * 1024:
        logger.info("[speech/voice] too_large bytes=%d file=%s", len(data), audio.filename)
        return UnderstandResponse(
            actions=[], response="", clarificationNeeded=True,
            clarificationQuestion="Audio too large (max 15MB)",
            suggestions=list(llm_service.CLARIFICATION_SUGGESTIONS),
            searchQuery="", displayText="Audio too large (max 15MB)",
        )
    text = stt_service.transcribe(data, audio.filename or "audio.webm")
    stt_ms = (time.perf_counter() - t0) * 1000
    used_fallback = False
    # In mock mode, use fallback transcript supplied by client/test
    if not text and transcript_fallback:
        text = transcript_fallback
        used_fallback = True
    if not text:
        logger.info("[speech/voice] empty_transcript fallback=%s stt_ms=%.1f",
                    bool(transcript_fallback), stt_ms)
        return UnderstandResponse(
            actions=[], response="", clarificationNeeded=True,
            clarificationQuestion="I couldn't hear you. Please try again.",
            suggestions=list(llm_service.CLARIFICATION_SUGGESTIONS),
            searchQuery="", displayText="I couldn't hear you. Please try again.",
        )

    ctx = None
    if context:
        import json
        try:
            ctx = AssistantContext(**json.loads(context))
        except Exception as e:
            logger.debug("[speech/voice] bad context json: %s", e)
            ctx = None

    result = llm_service.understand(text, ctx.model_dump() if ctx else None)
    # Reuse same normalization as assistant route
    from app.schemas.assistant import AssistantCommand
    actions = []
    for a in result.get("actions", []):
        act = a.get("action", "").upper()
        if act in ALLOWED:
            actions.append(AssistantCommand(action=act, parameters=a.get("parameters", {})))
        else:
            logger.warning("[speech/voice] hallucinated action=%r", a.get("action"))
    logger.info("[speech/voice] transcript=%r fallback=%s stt_ms=%.1f total_ms=%.1f actions=%s",
                text[:80], used_fallback, stt_ms,
                (time.perf_counter() - t0) * 1000, [a.action for a in actions])
    return UnderstandResponse(
        actions=actions,
        response=result.get("response", ""),
        clarificationNeeded=result.get("clarificationNeeded", False),
        clarificationQuestion=result.get("clarificationQuestion"),
        suggestions=result.get("suggestions"),
        parsedKeywords=result.get("parsedKeywords"),
        searchQuery=result.get("searchQuery"),
        displayText=result.get("displayText") or result.get("response", ""),
    )


@router.post("/partial", response_model=UnderstandResponse)
def partial(req: UnderstandRequest):
    """
    Realtime partial preview: Text -> Qwen/mock -> SEARCH-only Actions.

    Called by Spring Boot POST /api/v1/ai/voice-partial (private network)
    while the user is still speaking. Differences from /speech/voice:

    - No STT: input is already text (device-side partial transcript).
      Never touches stt_service, so no audio latency.
    - Cache-first: llm_service.understand() serves repeat texts from
      shared Redis (300s TTL); mock path is ~1ms. Budget <500ms total.
    - SEARCH-only: only SEARCH_SONG / SEARCH_ARTIST / SEARCH_ALBUM pass.
      Queue/like/playlist/player actions are dropped so the preview is
      always read-only (never queue). The full /speech/voice (3s) path
      executes the real actions.
    - Reuses llm_service._sanitize_actions (allow-list) + Redis; never raises
      for cache/LLM failures (falls back to mock/clarification, 200 shape).
    """
    from app.schemas.assistant import AssistantCommand
    t0 = time.perf_counter()
    text = (req.text or "").strip()
    if not text:
        logger.info("[speech/partial] empty_input latency_ms=%.1f",
                    (time.perf_counter() - t0) * 1000)
        return UnderstandResponse(
            actions=[], response="", clarificationNeeded=True,
            clarificationQuestion="I couldn't hear you. Please try again.",
            suggestions=list(llm_service.CLARIFICATION_SUGGESTIONS),
            searchQuery="", displayText="I couldn't hear you. Please try again.",
        )

    ctx = req.context.model_dump() if req.context else None
    # Cache-first understand (shared Redis inside; never raises).
    result = llm_service.understand(text, ctx)

    # Reuse the single-source-of-truth sanitizer, then narrow to SEARCH-only.
    clean, hallucinated = llm_service._sanitize_actions(result.get("actions"))
    if hallucinated:
        logger.warning("[speech/partial] hallucinated action dropped text=%r", text[:80])
    preview = [a for a in clean if a.get("action") in PARTIAL_ALLOWED]
    dropped = len(clean) - len(preview)
    if dropped:
        logger.info("[speech/partial] dropped %d non-search action(s) text=%r",
                    dropped, text[:80])

    actions = [
        AssistantCommand(action=a["action"], parameters=a.get("parameters", {}))
        for a in preview
    ]
    total_ms = (time.perf_counter() - t0) * 1000
    if not actions:
        # 200-clarification (never an error): keep searchQuery + suggestions
        # so the caller can still render a read-only preview.
        q = result.get("searchQuery") or ""
        logger.info("[speech/partial] no_search_actions text=%r total_ms=%.1f",
                    text[:80], total_ms)
        return UnderstandResponse(
            actions=[],
            response="",
            clarificationNeeded=True,
            clarificationQuestion=result.get("clarificationQuestion") or (
                "Keep speaking — try one of these: "
                + ", ".join(f"'{s}'" for s in llm_service.CLARIFICATION_SUGGESTIONS)
            ),
            suggestions=result.get("suggestions") or list(llm_service.CLARIFICATION_SUGGESTIONS),
            parsedKeywords=result.get("parsedKeywords"),
            searchQuery=q,
            displayText=result.get("clarificationQuestion") or "Keep speaking…",
        )
    logger.info("[speech/partial] text=%r total_ms=%.1f actions=%s",
                text[:80], total_ms, [a.action for a in actions])
    return UnderstandResponse(
        actions=actions,
        response=result.get("response", ""),
        clarificationNeeded=False,
        clarificationQuestion=None,
        suggestions=result.get("suggestions"),
        parsedKeywords=result.get("parsedKeywords"),
        searchQuery=result.get("searchQuery"),
        displayText=result.get("displayText") or result.get("response", ""),
    )
