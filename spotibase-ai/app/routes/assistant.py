from fastapi import APIRouter
from app.schemas.assistant import UnderstandRequest, UnderstandResponse, AssistantCommand
from app.services import llm_service

router = APIRouter()

@router.post("/understand", response_model=UnderstandResponse)
def understand(req: UnderstandRequest):
    """
    Text -> Structured Actions via Qwen (or mock fallback).
    Called by Spring Boot AssistantService (private network, not exposed to mobile).
    """
    ctx = req.context.model_dump() if req.context else None
    result = llm_service.understand(req.text, ctx)

    # Normalize to response model, ensure only allowed actions pass
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
        else:
            # hallucinated action -> ask clarification
            return UnderstandResponse(actions=[], response="", clarificationNeeded=True, clarificationQuestion="I didn't understand that. Could you rephrase?")

    return UnderstandResponse(
        actions=actions,
        response=result.get("response",""),
        clarificationNeeded=result.get("clarificationNeeded", False),
        clarificationQuestion=result.get("clarificationQuestion")
    )
