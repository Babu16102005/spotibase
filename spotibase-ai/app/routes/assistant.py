import logging
import time
from fastapi import APIRouter
from app.schemas.assistant import UnderstandRequest, UnderstandResponse, AssistantCommand
from app.services import llm_service

logger = logging.getLogger("spotibase-ai.assistant")
if not logger.handlers:
    logging.basicConfig(level=logging.INFO)

router = APIRouter()

# Single source of truth lives in llm_service; mirrored here for fast validation.
ALLOWED = llm_service.ALLOWED_ACTIONS


@router.post("/understand", response_model=UnderstandResponse)
def understand(req: UnderstandRequest):
    """
    Text -> Structured Actions via Qwen (or mock fallback).
    Called by Spring Boot AssistantService (private network, not exposed to mobile).

    Prompt/response contract:
      in:  {text, context?}
      out: {actions[0..N], response, parsedKeywords{song,artist,mood,genre,language,verbs},
            searchQuery, displayText, clarificationNeeded?, clarificationQuestion?, suggestions?}
    Safety: only ALLOWED actions pass; hallucinated actions -> clarification with 3 suggestions.
    Perf: repeat texts served from Redis (300s TTL); latency logged.
    """
    t0 = time.perf_counter()
    ctx = req.context.model_dump() if req.context else None
    result = llm_service.understand(req.text, ctx)

    # Normalize to response model, ensure only allowed actions pass
    actions = []
    for a in result.get("actions", []):
        act = a.get("action", "").upper()
        if act in ALLOWED:
            actions.append(AssistantCommand(action=act, parameters=a.get("parameters", {})))
        else:
            # hallucinated action -> ask clarification with 3 suggestions
            logger.warning("[assistant] hallucinated action=%r text=%r", a.get("action"), req.text[:80])
            return UnderstandResponse(
                actions=[],
                response="",
                clarificationNeeded=True,
                clarificationQuestion=(
                    "I didn't understand that. Could you rephrase? Try: "
                    + ", ".join(f"'{s}'" for s in llm_service.CLARIFICATION_SUGGESTIONS)
                ),
                suggestions=list(llm_service.CLARIFICATION_SUGGESTIONS),
                parsedKeywords=result.get("parsedKeywords"),
                searchQuery=result.get("searchQuery"),
                displayText="I didn't understand that. Could you rephrase?",
            )

    resp = UnderstandResponse(
        actions=actions,
        response=result.get("response", ""),
        clarificationNeeded=result.get("clarificationNeeded", False),
        clarificationQuestion=result.get("clarificationQuestion"),
        suggestions=result.get("suggestions"),
        parsedKeywords=result.get("parsedKeywords"),
        searchQuery=result.get("searchQuery"),
        displayText=result.get("displayText") or result.get("response", ""),
    )
    logger.info("[assistant] text=%r actions=%s cache_ttl=300s latency_ms=%.1f",
                req.text[:80], [a.action for a in actions], (time.perf_counter() - t0) * 1000)
    return resp
