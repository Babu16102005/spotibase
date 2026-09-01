from fastapi import APIRouter
from app.schemas.assistant import HealthResponse
from app.services import llm_service, stt_service
import os

router = APIRouter()

@router.get("/health", response_model=HealthResponse)
def health():
    llm = llm_service.health()
    stt = stt_service.health()
    return HealthResponse(
        status="ok",
        qwen_loaded=llm["qwen_loaded"],
        whisper_loaded=stt["whisper_loaded"],
        whisper_model=stt["whisper_model"],
        qwen_model=llm["qwen_model"],
        device=llm["device"]
    )

@router.get("/ready")
def ready():
    return {"ready": True}
