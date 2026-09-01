from fastapi import APIRouter, UploadFile, File, Form
from typing import Optional
from app.schemas.assistant import AssistantContext, UnderstandResponse
from app.services import stt_service, llm_service

router = APIRouter()

@router.post("/transcribe", response_model=dict)
async def transcribe(audio: UploadFile = File(..., description="Audio file webm/wav/mp3")):
    data = await audio.read()
    if len(data) > 15 * 1024 * 1024:
        return {"error": "Audio too large (max 15MB)"}
    text = stt_service.transcribe(data, audio.filename or "audio.webm")
    # In mock mode text is empty -> client should send transcript fallback; we return empty to signal
    return {"transcript": text, "language": None}

@router.post("/voice", response_model=UnderstandResponse)
async def voice(
    audio: UploadFile = File(..., description="Audio file"),
    context: Optional[str] = Form(None),
    transcript_fallback: Optional[str] = Form(None, description="Fallback transcript when STT mock")
):
    """
    Single call: Audio -> STT -> Qwen -> Actions
    Used by Spring Boot /api/v1/ai/voice (private). Mobile sends to Spring Boot, Spring Boot forwards here.
    """
    data = await audio.read()
    text = stt_service.transcribe(data, audio.filename or "audio.webm")
    # In mock mode, use fallback transcript supplied by client/test
    if not text and transcript_fallback:
        text = transcript_fallback
    if not text:
        return UnderstandResponse(actions=[], response="", clarificationNeeded=True, clarificationQuestion="I couldn't hear you. Please try again.")

    ctx = None
    if context:
        import json
        try:
            ctx = AssistantContext(**json.loads(context))
        except:
            ctx = None

    result = llm_service.understand(text, ctx.model_dump() if ctx else None)
    # Reuse same normalization as assistant route
    from app.schemas.assistant import AssistantCommand
    allowed = {
        "PLAY","PAUSE","RESUME","NEXT","PREVIOUS",
        "PLAY_SONG","SEARCH_SONG","SEARCH_ARTIST","SEARCH_ALBUM",
        "PLAY_BY_MOOD","PLAY_BY_GENRE","PLAY_BY_LANGUAGE","PLAY_SIMILAR",
        "ADD_TO_QUEUE","REMOVE_FROM_QUEUE","CLEAR_QUEUE",
        "LIKE_CURRENT","UNLIKE_CURRENT",
        "ADD_TO_PLAYLIST","REMOVE_FROM_PLAYLIST","CREATE_PLAYLIST",
        "SHUFFLE_ON","SHUFFLE_OFF","REPEAT_ON","REPEAT_OFF","SET_VOLUME",
        "GET_CURRENT_SONG","GET_QUEUE","GET_RECOMMENDATIONS","CLARIFICATION_NEEDED"
    }
    actions = []
    for a in result.get("actions", []):
        act = a.get("action","").upper()
        if act in allowed:
            actions.append(AssistantCommand(action=act, parameters=a.get("parameters", {})))
    return UnderstandResponse(
        actions=actions,
        response=result.get("response",""),
        clarificationNeeded=result.get("clarificationNeeded", False),
        clarificationQuestion=result.get("clarificationQuestion")
    )
