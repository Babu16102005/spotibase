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

class ParsedKeywords(BaseModel):
    song: Optional[str] = None
    artist: Optional[str] = None
    mood: Optional[str] = None
    genre: Optional[str] = None
    language: Optional[str] = None
    verbs: List[str] = Field(default_factory=list)

class UnderstandResponse(BaseModel):
    """Prompt/response contract for /assistant/understand and /speech/voice.

    - actions: 0..N allow-listed actions (max 30-action vocabulary, see llm_service.ALLOWED_ACTIONS)
    - response: human-readable assistant reply (legacy field, == displayText in most cases)
    - parsedKeywords: YouTube-like keyword extraction {song, artist, mood, genre, language, verbs}
    - searchQuery: cleaned query for catalog search (stopwords stripped, aliases normalized)
    - displayText: UI-ready one-liner
    - clarificationNeeded/clarificationQuestion/suggestions: set when input is unknown
    """
    actions: List[AssistantCommand]
    response: str = ""
    clarificationNeeded: bool = False
    clarificationQuestion: Optional[str] = None
    suggestions: Optional[List[str]] = None
    parsedKeywords: Optional[ParsedKeywords] = None
    searchQuery: Optional[str] = None
    displayText: Optional[str] = None

class HealthResponse(BaseModel):
    status: str
    qwen_loaded: bool
    whisper_loaded: bool
    whisper_model: str
    qwen_model: str
    device: str
