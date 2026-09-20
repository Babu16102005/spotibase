from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os
from dotenv import load_dotenv

load_dotenv()

from app.routes import assistant, speech, health, audio_tag

app = FastAPI(
    title="SpotiBase AI - FastAPI AI Server",
    description="STT (faster-whisper) + Qwen2.5-3B-Instruct -> Structured Actions. Private service, called by Spring Boot.",
    version="1.0.0"
)

# CORS - only for dev; in prod Spring Boot is the only caller (private network)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, tags=["health"])
app.include_router(assistant.router, prefix="/assistant", tags=["assistant"])
app.include_router(speech.router, prefix="/speech", tags=["speech"])
app.include_router(audio_tag.router, prefix="/audio", tags=["audio"])

@app.get("/")
def root():
    return {
        "service": "spotibase-ai",
        "mode": os.getenv("AI_MODE", "mock"),
        "docs": "/docs",
        "health": "/health",
        "assistant": "/assistant/understand",
        "voice": "/speech/voice",
        "transcribe": "/speech/transcribe"
    }

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("AI_PORT", "7860"))
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, reload=True)
