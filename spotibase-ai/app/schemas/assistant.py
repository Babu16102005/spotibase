from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any

class AssistantContext(BaseModel):
    currentSongId: Optional[str] = None
    currentArtist: Optional[str] = None
    currentAlbum: Optional[str] = None
    currentPlaylist: Optional[str] = None
    playing: bool = False
    queueSize: int = 0
    lastMood: Optional[str] = None
    lastSearch: Optional[str] = None

class UnderstandRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000, description="User transcript / text")
    context: Optional[AssistantContext] = None

class AssistantCommand(BaseModel):
    action: str
    parameters: Dict[str, Any] = Field(default_factory=dict)

class UnderstandResponse(BaseModel):
    actions: List[AssistantCommand]
    response: str = ""
    clarificationNeeded: bool = False
    clarificationQuestion: Optional[str] = None

class HealthResponse(BaseModel):
    status: str
    qwen_loaded: bool
    whisper_loaded: bool
    whisper_model: str
    qwen_model: str
    device: str
