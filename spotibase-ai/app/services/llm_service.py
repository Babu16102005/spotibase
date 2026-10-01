import os
import json
import re
import time
import logging
import difflib
from pathlib import Path
from typing import List, Optional, Dict, Any

# Simple fallback + optional real Qwen loader
# Set AI_MODE=mock for instant dev without downloading 3B weights
# Set AI_MODE=transformers to load Qwen2.5-3B-Instruct locally
# Set AI_MODE=hf_api to call HuggingFace Inference API (needs HF_TOKEN env, never hardcoded)
# Set AI_MODE=cf_workers to call Cloudflare Workers AI (needs CF_ACCOUNT_ID + CF_AI_TOKEN env, never hardcoded)

logger = logging.getLogger("spotibase-ai.llm")
if not logger.handlers:
    logging.basicConfig(level=logging.INFO)

AI_MODE = os.getenv("AI_MODE", "mock")  # mock | transformers | hf_api | cf_workers
QWEN_MODEL = os.getenv("QWEN_MODEL", "Qwen/Qwen2.5-3B-Instruct")
HF_TOKEN = os.getenv("HF_TOKEN", "")  # secret via env only

# Cloudflare Workers AI (cf_workers mode). Secrets via env only — never log the token.
CF_ACCOUNT_ID = os.getenv("CF_ACCOUNT_ID", "")
CF_AI_TOKEN = os.getenv("CF_AI_TOKEN", "")
CF_MODEL = os.getenv("CF_MODEL", "@cf/qwen/qwen3-30b-a3b-fp8")
try:
    CF_TIMEOUT_S = float(os.getenv("CF_TIMEOUT_S", "4.0"))
except ValueError:
    CF_TIMEOUT_S = 4.0
PROMPT_PATH = Path(__file__).parent.parent / "prompts" / "assistant_system.txt"

SYSTEM_PROMPT = ""
if PROMPT_PATH.exists():
    SYSTEM_PROMPT = PROMPT_PATH.read_text(encoding="utf-8")

# Lazy holders
_qwen_pipeline = None
_qwen_tokenizer = None


def _load_qwen_transformers():
    global _qwen_pipeline
    if _qwen_pipeline is not None:
        return _qwen_pipeline
    try:
        from transformers import AutoModelForCausalLM, AutoTokenizer, pipeline
        import torch
        print(f"[LLM] Loading {QWEN_MODEL} on {'cuda' if torch.cuda.is_available() else 'cpu'} ...")
        tokenizer = AutoTokenizer.from_pretrained(QWEN_MODEL, trust_remote_code=True)
        model = AutoModelForCausalLM.from_pretrained(
            QWEN_MODEL,
            trust_remote_code=True,
            torch_dtype="auto",
            device_map="auto",
        )
        _qwen_pipeline = pipeline("text-generation", model=model, tokenizer=tokenizer, max_new_tokens=512)
        print("[LLM] Qwen loaded")
        return _qwen_pipeline
    except Exception as e:
        print(f"[LLM] Failed to load Qwen: {e}")
        return None


# ---------------------------------------------------------------------------
# 32-action allow-list (single source of truth — routes import this).
# ---------------------------------------------------------------------------
ALLOWED_ACTIONS = frozenset({
    "PLAY", "PAUSE", "RESUME", "NEXT", "PREVIOUS",
    "PLAY_SONG", "SEARCH_SONG", "SEARCH_ARTIST", "SEARCH_ALBUM",
    "PLAY_BY_MOOD", "PLAY_BY_GENRE", "PLAY_BY_LANGUAGE", "PLAY_SIMILAR",
    "PLAY_RANDOM", "PLAY_LIKED",
    "ADD_TO_QUEUE", "REMOVE_FROM_QUEUE", "CLEAR_QUEUE",
    "LIKE_CURRENT", "UNLIKE_CURRENT",
    "ADD_TO_PLAYLIST", "REMOVE_FROM_PLAYLIST", "CREATE_PLAYLIST",
    "SHUFFLE_ON", "SHUFFLE_OFF", "REPEAT_ON", "REPEAT_OFF", "SET_VOLUME",
    "GET_CURRENT_SONG", "GET_QUEUE", "GET_RECOMMENDATIONS", "CLARIFICATION_NEEDED",
})

CLARIFICATION_SUGGESTIONS = [
    "Play calm Tamil songs",
    "Play Anirudh hits",
    "Play 90s melodies",
]

# ---- Mood / keyword heuristics (used in mock + as fallback) ----
# Canonical moods: HAPPY/SAD/ENERGETIC/CALM/ROMANTIC/PARTY/FOCUSED (+ legacy
# CHILL/DREAMY/MELANCHOLIC/MOTIVATED/NOSTALGIC kept for compat — do not rename).
# Feeling-word variants NEVER clarify: any feeling word -> PLAY_BY_MOOD.
MOOD_MAP = {
    "calm": "CALM", "calming": "CALM", "calm down": "CALM",
    "relax": "CALM", "relaxed": "CALM", "relaxing": "CALM",
    "peaceful": "CALM", "soothing": "CALM", "mellow": "CALM",
    "unwind": "CALM", "laid back": "CALM", "chill out": "CALM",
    "chill": "CHILL",
    "happy": "HAPPY", "happiness": "HAPPY", "feel happy": "HAPPY",
    "joy": "HAPPY", "joyful": "HAPPY", "joyous": "HAPPY",
    "cheerful": "HAPPY", "cheer up": "HAPPY", "cheer me up": "HAPPY",
    "feel good": "HAPPY", "feel-good": "HAPPY", "feelgood": "HAPPY",
    "makes me happy": "HAPPY", "make me happy": "HAPPY",
    "uplifting": "HAPPY", "uplift": "HAPPY", "upbeat": "HAPPY",
    "good mood": "HAPPY", "positive": "HAPPY",
    "sad": "SAD", "sadness": "SAD", "depressed": "SAD", "blue": "SAD",
    "lonely": "SAD", "heartbreak": "SAD", "heartbroken": "SAD",
    "gloomy": "SAD", "upset": "SAD",
    "melancholic": "MELANCHOLIC", "melancholy": "MELANCHOLIC",
    "energetic": "ENERGETIC", "energy": "ENERGETIC", "high energy": "ENERGETIC",
    "pumped": "ENERGETIC", "pumped up": "ENERGETIC", "pump up": "ENERGETIC",
    "hype": "ENERGETIC", "hype up": "ENERGETIC",
    "workout": "ENERGETIC", "gym": "ENERGETIC", "running": "ENERGETIC", "exercise": "ENERGETIC",
    "party": "PARTY", "dance": "PARTY", "club": "PARTY",
    "celebration": "PARTY", "celebrate": "PARTY", "festive": "PARTY",
    "romantic": "ROMANTIC", "romance": "ROMANTIC", "love": "ROMANTIC",
    "lovely": "ROMANTIC", "date night": "ROMANTIC", "valentine": "ROMANTIC",
    "dreamy": "DREAMY",
    "focused": "FOCUSED", "focus": "FOCUSED", "study": "FOCUSED", "studying": "FOCUSED",
    "concentrate": "FOCUSED", "concentration": "FOCUSED", "deep work": "FOCUSED",
    "motivated": "MOTIVATED",
    "nostalgic": "NOSTALGIC",
}

LANGUAGES = ["tamil", "english", "hindi", "telugu", "malayalam", "kannada", "bengali", "punjabi", "marathi"]

# canonical genre -> normalized token used in action params
GENRES = {
    "pop": "POP", "rock": "ROCK", "hip hop": "HIP_HOP", "hip-hop": "HIP_HOP", "hiphop": "HIP_HOP",
    "melody": "MELODY", "melodies": "MELODY", "melodie": "MELODY",
    "classical": "CLASSICAL", "electronic": "ELECTRONIC", "edm": "ELECTRONIC",
    "folk": "FOLK", "kuthu": "KUTHU", "devotional": "DEVOTIONAL",
    "lofi": "LOFI", "lo-fi": "LOFI", "jazz": "JAZZ", "blues": "BLUES",
    "rap": "RAP", "indie": "INDIE", "retro": "RETRO", "disco": "DISCO",
}

VIBES = ["chill", "dreamy", "party", "dark", "peaceful", "intense", "feel good", "relaxing"]

# Artist aliases: typo-tolerant, YouTube-style. 20+ entries. Canonical values are stable
# (frontend matches on these strings — do not rename existing ones).
ARTIST_ALIASES = {
    "anirudh ravichander": "Anirudh",
    "anirudh": "Anirudh",
    "ani": "Anirudh",
    "aniruth": "Anirudh",      # common typo
    "aneerudh": "Anirudh",     # common typo
    "a r rahman": "A R Rahman",
    "ar rahman": "A R Rahman",
    "a.r.rahman": "A R Rahman",
    "rahman": "A R Rahman",
    "arr": "A R Rahman",
    "yuvan shankar raja": "Yuvan",
    "yuvan shankar": "Yuvan",
    "yuvan": "Yuvan",
    "yuwan": "Yuvan",          # typo
    "hip hop tamizha": "Hiphop Tamizha",
    "hiphop tamizha": "Hiphop Tamizha",
    "hiphop": "Hiphop Tamizha",
    "g v prakash kumar": "G V Prakash",
    "gv prakash": "G V Prakash",
    "g v prakash": "G V Prakash",
    "gv": "G V Prakash",
    "ilaiyaraaja": "Ilaiyaraaja",
    "ilayaraja": "Ilaiyaraaja",   # common spelling
    "illayaraja": "Ilaiyaraaja",  # typo
    "s p balasubrahmanyam": "S P Balasubrahmanyam",
    "sp balasubrahmanyam": "S P Balasubrahmanyam",
    "spb": "S P Balasubrahmanyam",
    "sid sriram": "Sid Sriram",
    "sidsriram": "Sid Sriram",
    "sith sriram": "Sid Sriram",  # STT typo
    "shreya ghoshal": "Shreya Ghoshal",
    "shreya": "Shreya Ghoshal",
    "arijit singh": "Arijit Singh",
    "arijit": "Arijit Singh",
    "arjit": "Arijit Singh",      # typo
    "harris jayaraj": "Harris Jayaraj",
    "harris": "Harris Jayaraj",
    "thaman s": "Thaman S",
    "s thaman": "Thaman S",
    "thaman": "Thaman S",
    "devi sri prasad": "Devi Sri Prasad",
    "dsp": "Devi Sri Prasad",
    "santhosh narayanan": "Santhosh Narayanan",
    "santosh narayanan": "Santhosh Narayanan",  # typo
    "santhosh": "Santhosh Narayanan",
    "d imman": "D Imman",
    "imman": "D Imman",
    "s p b": "S P Balasubrahmanyam",  # dotted "S.P.B" normalizes to "s p b"
    "vijay antony": "Vijay Antony",
    "dhanush": "Dhanush",
}

# Words stripped when building a YouTube-like searchQuery. Verbs are extracted
# BEFORE stripping so intent is not lost.
_LEADING_FILLER_RE = re.compile(
    r"^(please\s+|kindly\s+|could\s+you\s+|can\s+you\s+|would\s+you\s+|"
    r"i\s+want\s+to\s+|i\s+wanna\s+|i\s+would\s+like\s+to\s+|want\s+to\s+|wanna\s+|"
    r"let\s+me\s+|lemme\s+|play\s+me\s+|play\s+|put\s+on\s+|put\s+|start\s+|"
    r"listen\s+to\s+|listen\s+|find\s+me\s+|find\s+|search\s+for\s+|search\s+|"
    r"show\s+me\s+|show\s+|i\s+need\s+|give\s+me\s+|i\s+love\s+|heyy?\s+|hey\s+)",
)

_TRAILING_FILLER_RE = re.compile(
    r"\s+(please|kindly|for\s+me|for\s+my\s+\w+|right\s+now|rightnow|now|today|"
    r"tonight|yaar|da|di|bro|dey|song|songs|track|tracks|music|video|videos|"
    r"audio|tune|tunes|number|numbers|pls|plz)\s*$",
)

_VERB_PATTERNS = [
    (r"\bplay\b", "play"),
    (r"\bpause\b", "pause"),
    (r"\bresume\b|\bcontinue\b", "resume"),
    (r"\bnext\b|\bskip\b", "next"),
    (r"\bprevious\b|\bprev\b|\bgo\s+back\b", "previous"),
    (r"\blike\b", "like"),
    (r"\bunlike\b|\bdislike\b", "unlike"),
    (r"\bshuffle\b", "shuffle"),
    (r"\brepeat\b|\bloop\b", "repeat"),
    (r"\bqueue\b", "queue"),
    (r"\badd\b", "add"),
    (r"\bremove\b|\bdelete\b", "remove"),
    (r"\bclear\b", "clear"),
    (r"\bcreate\b|\bmake\b.*playlist", "create"),
    (r"\bsearch\b|\bfind\b|\bshow\b|\blook\s+for\b", "search"),
    (r"\bvolume\b|\blouder\b|\bquieter\b|\bmute\b", "volume"),
    (r"\bsimilar\b", "similar"),
]

SIMPLE_PATTERNS = {
    r"^\s*(next|skip|next song)\s*$": ("NEXT", {}),
    r"^\s*pause(\s+(the\s+)?(song|music))?\s*$": ("PAUSE", {}),
    r"^\s*(resume|continue|play|resume the song)\s*$": ("RESUME", {}),
    r"^\s*(previous|prev|go back)\s*$": ("PREVIOUS", {}),
    r"^\s*like\s*(this|song)?\s*$": ("LIKE_CURRENT", {}),
    r"^\s*unlike\s*": ("UNLIKE_CURRENT", {}),
    r"^\s*shuffle on": ("SHUFFLE_ON", {}),
    r"^\s*shuffle off": ("SHUFFLE_OFF", {}),
    r"^\s*repeat on|^\s*loop on|^\s*repeat this": ("REPEAT_ON", {}),
    r"^\s*repeat off|^\s*loop off": ("REPEAT_OFF", {}),
    r"^\s*(clear (the )?queue|clear queue)\s*$": ("CLEAR_QUEUE", {}),
    r"^\s*(what'?s playing|current song|now playing)\s*$": ("GET_CURRENT_SONG", {}),
    r"^\s*(show (my )?queue|what'?s in (the )?queue)\s*$": ("GET_QUEUE", {}),
    r"^\s*volume (up|down|\d+).*|^\s*(mute|unmute)\s*$": ("SET_VOLUME", {}),
}


def _simple_detect(text: str):
    t = text.strip().lower()
    for pat, (act, params) in SIMPLE_PATTERNS.items():
        if re.match(pat, t):
            return [{"action": act, "parameters": params}]
    return None


# ---------------------------------------------------------------------------
# PLAY_RANDOM / PLAY_LIKED realtime wording analysis (new actions).
# Checked in _mock_understand: PLAY_LIKED before mood/artist/by branches so
# "play the like playlist any song" wins over junk SEARCH; PLAY_RANDOM late
# (after PLAY_SIMILAR) so "play something similar to this" and
# "play Something by Anirudh" keep their precise meanings.
# No conflict with LIKE_CURRENT ("like this"/"like") — liked requires
# past-tense "liked", "favourite(s)", or adjacent "like playlist".
# No conflict with SHUFFLE_ON/OFF ("shuffle on") — random requires the
# exact phrase "shuffle play".
# ---------------------------------------------------------------------------
_LIKED_RE = re.compile(
    r"\bliked\b|\bfavou?rites?\b|\blike\s+playlist\b",
)
_LIKED_FUZZY_VOCAB = ["liked", "favorite", "favourite", "favorites", "favourites"]

_RANDOM_RE = re.compile(
    r"\bany\b|\banything\b|\bsurprise\s+me\b|\brandom\b|\bshuffle\s+play\b",
)
_RANDOM_FUZZY_VOCAB = ["anything", "something", "random", "surprise"]


def _is_liked_request(norm: str) -> bool:
    """True when the user wants their liked-songs library played."""
    if _LIKED_RE.search(norm):
        return True
    # typo-tolerant: "likked", "favourate", "favrite", ... (case already lowered)
    for tok in re.findall(r"[a-z]+", norm):
        if len(tok) < 4:
            continue
        m = difflib.get_close_matches(tok, _LIKED_FUZZY_VOCAB, n=1, cutoff=0.83)
        if m:
            return True
    return False


def _is_random_request(norm: str, parsed: dict) -> bool:
    """True when the user wants a random catalog song (no filter facets)."""
    if _RANDOM_RE.search(norm):
        return True
    # generic "something" -> random ONLY when it carries no precise meaning:
    # exclude PLAY_SIMILAR ("something similar to this") and explicit
    # "play Something by <artist>" (artist/ by-phrase) and any facet query.
    if re.search(r"\bsomething\b", norm):
        if "similar" in norm:
            return False
        if re.search(r"\bby\b", norm):
            return False
        if parsed.get("artist"):
            return False
        if parsed.get("moods") or parsed.get("language") or parsed.get("genre"):
            return False
        return True
    # typo-tolerant fallback for longer random words ("someting", "randon",
    # "suprise"). Short "any"/"eny" stays exact-only to avoid hijacking.
    for tok in re.findall(r"[a-z]+", norm):
        if len(tok) < 5:
            continue
        m = difflib.get_close_matches(tok, _RANDOM_FUZZY_VOCAB, n=1, cutoff=0.83)
        if m:
            if m[0] == "something":
                if "similar" in norm or re.search(r"\bby\b", norm):
                    continue
                if parsed.get("artist"):
                    continue
            return True
    return False


# ---------------------------------------------------------------------------
# Normalization + typo-tolerant helpers (lightweight, no heavy models)
# ---------------------------------------------------------------------------

def normalize_entry(text: Optional[str]) -> str:
    """Typo-tolerant entry point: lowercase, trim, collapse whitespace, strip quotes."""
    if not text:
        return ""
    t = text.strip().lower()
    t = t.strip("\"'“”‘’`")
    # Dotted initials ("G.V. Prakash", "S.P.B", "A.R. Rahman") -> spaced
    # so they match space-form aliases ("g v prakash", "s p b", "a r rahman").
    t = re.sub(r"\.", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def _extract_verbs(t: str) -> List[str]:
    verbs: List[str] = []
    for pat, name in _VERB_PATTERNS:
        if re.search(pat, t):
            if name not in verbs:
                verbs.append(name)
    return verbs


def _fuzzy_word(word: str, vocab: List[str], cutoff: float = 0.82) -> Optional[str]:
    """Return closest vocab entry for a possibly-misspelled word, else None."""
    if word in vocab:
        return word
    m = difflib.get_close_matches(word, vocab, n=1, cutoff=cutoff)
    return m[0] if m else None


def _canonical_artist(t: str) -> Optional[tuple]:
    """Return (canonical, matched_alias) for exact or typo-tolerant artist match.

    Longest aliases first so 'yuvan shankar raja' wins over 'yuvan'.
    Falls back to difflib on single tokens for STT/typing errors.

    Guards:
      - word-boundary exact match so 'ani' doesn't hijack 'spanish'/'rani'
        substrings ('organic'/'morning' safe).
      - fuzzy fallback is EXACT-ONLY for short aliases ('ani','arr','gv',
        'spb','dsp'): 'mani'/'rani'/'pani' must not map to Anirudh.
    """
    for alias in sorted(ARTIST_ALIASES.keys(), key=len, reverse=True):
        # normalize dotted alias form ("a.r.rahman") to spaced form so it
        # still matches after normalize_entry turned dots into spaces.
        alias_norm = re.sub(r"\s+", " ", alias.replace(".", " ")).strip()
        # word-boundary match so 'ani' doesn't hijack 'organic'/'morning' etc.
        if re.search(r"\b" + re.escape(alias_norm) + r"\b", t):
            return ARTIST_ALIASES[alias], alias
    # Fuzzy fallback: each input token vs single-word aliases (long only).
    # Short aliases (len<=3) are exact-only: 'mani' vs 'ani' = 0.857 would
    # otherwise hijack 'Mani'/'Rani' hits into Anirudh.
    single = [a for a in ARTIST_ALIASES.keys() if " " not in a and "." not in a and len(a) > 3]
    for tok in re.findall(r"[a-z]+", t):
        if len(tok) < 4:
            continue
        m = difflib.get_close_matches(tok, single, n=1, cutoff=0.83)
        if m:
            return ARTIST_ALIASES[m[0]], m[0]
    return None


def _detect_mood(t: str) -> List[str]:
    found: List[str] = []
    for k, v in MOOD_MAP.items():
        # word-boundary match so 'relax' doesn't fire inside 'relaxing' fragments
        pat = r"(^|\W)" + re.escape(k) + r"($|\W)" if " " not in k else re.escape(k)
        if re.search(pat, t) and v not in found:
            found.append(v)
    # fuzzy single-token fallback (e.g. 'hapy' -> 'happy', 'energtic' -> 'energetic')
    # cutoff 0.86 (not 0.82): 'something' vs 'soothing' = 0.823 must NOT
    # fire CALM for "play Something by Anirudh".
    if not found:
        vocab = [k for k in MOOD_MAP.keys() if " " not in k]
        for tok in re.findall(r"[a-z]+", t):
            if len(tok) < 4:
                continue
            m = _fuzzy_word(tok, vocab, cutoff=0.86)
            if m and MOOD_MAP[m] not in found:
                found.append(MOOD_MAP[m])
    return found


def _detect_language(t: str) -> Optional[str]:
    for lang in LANGUAGES:
        if re.search(r"(^|\W)" + re.escape(lang) + r"($|\W)", t):
            return lang.upper()
    for tok in re.findall(r"[a-z]+", t):
        if len(tok) < 4:
            continue
        m = _fuzzy_word(tok, LANGUAGES)
        if m:
            return m.upper()
    return None


def _detect_genre(t: str) -> Optional[str]:
    for g in sorted(GENRES.keys(), key=len, reverse=True):
        if re.search(r"(^|\W)" + re.escape(g) + r"($|\W)", t):
            return GENRES[g]
    for tok in re.findall(r"[a-z\-]+", t):
        m = _fuzzy_word(tok, list(GENRES.keys()))
        if m:
            return GENRES[m]
    return None


def _detect_vibes(t: str) -> List[str]:
    vibes: List[str] = []
    for v in VIBES:
        if re.search(r"(^|\W)" + re.escape(v) + r"($|\W)", t) and v.upper().replace(" ", "_") not in vibes:
            vibes.append(v.upper().replace(" ", "_"))
    return vibes


# ---------------------------------------------------------------------------
# Lyric-line identification (human-like AI: ANY song line -> SEARCH_SONG).
# Long descriptive / quoted / narrative inputs carry a lyric line framed by
# cues like "which goes", "song that says", "lyrics". The FULL lyric line is
# preserved in query for the backend identification chain
# (local lyrics -> websearch -> library match). Only framing is stripped;
# the lyric itself is never truncated to junk single words. Short exact-title
# inputs (no cue, no quotes) are untouched and keep the legacy path.
# ---------------------------------------------------------------------------
_LYRIC_CUE_PATTERNS = [
    r"which\s+goes(?:\s+something\s+like|\s+a\s+little\s+like|\s+like)?",
    r"that\s+goes(?:\s+like)?",
    r"goes\s+something\s+like",
    r"goes\s+like",
    r"song\s+that\s+says",
    r"song\s+which\s+says",
    r"song\s+that\s+goes",
    r"song\s+which\s+goes",
    r"that\s+says",
    r"which\s+says",
    r"song\s+with\s+(?:the\s+)?lyrics?",
    r"with\s+the\s+lyrics?",
    r"with\s+lyrics?",
    r"song\s+with\s+lines?",
    r"lines?\s+that\s+go",
    r"line\s+that\s+goes",
    r"\blyrics?\b",
    r"\blyric\b",
    r"\bgoes\b",
    r"\bsays\b",
]
# longest cues first so "which goes like" wins over bare "goes"
_LYRIC_CUE_PATTERNS = sorted(_LYRIC_CUE_PATTERNS, key=len, reverse=True)


def _extract_quoted_lyric(text: str) -> Optional[str]:
    """Return inner quoted lyric ("...", "...") when present, else None.

    Double/curly quotes always count; single quotes only when they are
    standalone delimiters (surrounded by boundaries), so apostrophes in
    don't / I'm never fake a lyric.
    """
    try:
        m = re.search(r'["\u201c\u201d](.+?)["\u201c\u201d]', text)
        if m and m.group(1).strip() and len(m.group(1).strip()) >= 2:
            return re.sub(r"\s+", " ", m.group(1).strip())
        # single-quote delimiters must sit on token boundaries:
        # opening preceded by start/space/bracket, closing followed by
        # space/end/punctuation (don't / I'm have letter on both sides).
        m2 = re.search(r"(?:^|[\s\(\[\{\>])'([^']{2,}?)'(?=[\s\.\,\!\?\:\;\)\]\}]|$)", text)
        if m2 and len(m2.group(1).strip().split()) >= 2:
            return re.sub(r"\s+", " ", m2.group(1).strip())
    except Exception:
        pass
    return None


def _has_lyric_cue(norm: str) -> bool:
    """True when normalized text carries lyric-identification framing."""
    try:
        for pat in _LYRIC_CUE_PATTERNS:
            if re.search(pat, norm):
                return True
    except Exception:
        pass
    return False


def _extract_lyric_query(norm: str, raw_text: str) -> Optional[str]:
    """Extract the FULL lyric line from a framed request.

    Priority:
      1. quoted text ("hello ...") when a cue is present OR the quote holds
         >=2 words (covers: play that song which goes "hello ..." and
         play "munbe vaa ..." title-in-quotes).
      2. text AFTER the earliest lyric cue ("which goes X" -> "X",
         "song that says X" -> "X", "with lyrics X" -> "X").
    Returns None when no framed lyric is present (short titles untouched).
    Strips ONLY framing (quotes, cue, leading play filler, trailing colons);
    never truncates the lyric line itself.
    """
    try:
        quoted = _extract_quoted_lyric(raw_text or norm)
        if quoted:
            # quoted + cue is always a lyric; bare quoted >=2 words is also a
            # lyric/title line worth preserving verbatim.
            if _has_lyric_cue(norm) or len(quoted.split()) >= 2:
                cleaned = quoted.strip(" :-\u2013\u2014,.!\"'\u201c\u201d\u2018\u2019`").strip()
                return cleaned or quoted
        # earliest cue wins (lyric starts right after it)
        best: Optional[tuple] = None  # (start, end)
        for pat in _LYRIC_CUE_PATTERNS:
            m = re.search(pat, norm)
            if m:
                span = (m.start(), m.end())
                if best is None or span[0] < best[0]:
                    best = span
        if best is not None:
            after = norm[best[1]:].strip()
            # cue leftovers: leading "like/as/:" and stray quotes
            after = re.sub(r"^(like|as)\b\s*", "", after).strip()
            after = after.strip(" :-\u2013\u2014,.!\"'\u201c\u201d\u2018\u2019`")
            after = re.sub(r"\s+", " ", after).strip()
            # strip a trailing framing noun left from "play the song lyrics X song"
            # only when lyric is long (don't eat a 1-word title ending in song)
            if len(after.split()) > 3:
                after = re.sub(r"\s+(song|songs|music|lyrics?)\s*$", "", after).strip()
            if after and len(after) >= 2:
                return after
    except Exception:
        pass
    return None


def _is_bare_lyric_candidate(norm: str, parsed: dict) -> bool:
    """True for a bare lyric line (no verb, no facets) worth identifying.

    Guards so short gibberish ("xyzqw blarg flimflam", 3 words) still
    clarifies while a real lyric line (4+ words, no mood/artist/lang/genre)
    becomes SEARCH_SONG with the full line. Play-verb lines are handled by
    the residual/vague-play paths above; this is the no-verb fallback.
    """
    try:
        if parsed.get("artist") or parsed.get("moods") or parsed.get("language") or parsed.get("genre"):
            return False
        if parsed.get("vibes"):
            return False
        words = [w for w in re.findall(r"[A-Za-z\u00C0-\u024F\u1E00-\u1EFF\u0400-\u04FF\u0B80-\u0BFF]+", norm)]
        # Tamil-script lines have no spaces issue; also accept length heuristic
        if len(words) >= 4 and len(norm) >= 12:
            return True
        # Tamil script (U+0B80-0BFF) lyric without spaces still counts when long
        if len(norm) >= 15 and re.search(r"[\u0B80-\u0BFF]", norm):
            return True
    except Exception:
        pass
    return False


def _strip_to_keywords(norm: str) -> str:
    """Strip play/song/music/please stopwords -> core YouTube-like keywords."""
    t = norm
    # strip repeatedly (e.g. 'please play ... songs please')
    for _ in range(3):
        new = _LEADING_FILLER_RE.sub("", t).strip()
        new = _TRAILING_FILLER_RE.sub("", new).strip()
        # bare leading articles — but NOT the "a" in "a r rahman" initials.
        # (?![a-z]\b) keeps "a r ..." / "s p ..." intact.
        new = re.sub(r"^(a|an|the|some)\s+(?![a-z]\b)", "", new).strip()
        if new == t:
            break
        t = new
    # 'hits' suffix is meaningful ('anirudh hits') — keep it
    t = re.sub(r"\s+", " ", t).strip()
    return t


def _smart_title(s: str) -> str:
    """Title-case without mangling '90s' -> '90S' ('90s'.title() bug)."""
    return " ".join(w[:1].upper() + w[1:] if w else "" for w in (s or "").split())


def _parse_keywords(norm: str) -> Dict[str, Any]:
    """Extract {song, artist, mood, genre, language, verbs} from normalized text."""
    verbs = _extract_verbs(norm)
    moods = _detect_mood(norm)
    lang = _detect_language(norm)
    genre = _detect_genre(norm)
    vibes = _detect_vibes(norm)
    artist_hit = _canonical_artist(norm)
    artist = artist_hit[0] if artist_hit else None

    core = _strip_to_keywords(norm)

    # Remove detected facets from core to isolate the probable song/title remainder.
    # Word-boundary removal so 'relax' inside 'relaxing' doesn't leave 'ing'.
    # NOTE: strip the 'dont play sad' filter FIRST, before 'sad' mood removal
    # leaves a stray 'dont play' fragment behind.
    remainder = core
    remainder = re.sub(r"don'?t\s+play\s+sad", " ", remainder)
    remainder = re.sub(r"\bnot\s+sad\b", " ", remainder)
    if artist_hit:
        # alias may be dotted ("a.r.rahman") while core is spaced ("a r rahman")
        alias_norm = re.sub(r"\s+", " ", artist_hit[1].replace(".", " ")).strip()
        remainder = re.sub(r"(^|\W)" + re.escape(alias_norm) + r"($|\W)", " ", remainder).strip()
    for lang_tok in LANGUAGES:
        remainder = re.sub(r"(^|\W)" + re.escape(lang_tok) + r"($|\W)", " ", remainder)
    for g in sorted(GENRES.keys(), key=len, reverse=True):
        remainder = re.sub(r"(^|\W)" + re.escape(g) + r"($|\W)", " ", remainder)
    for mk in MOOD_MAP.keys():
        remainder = re.sub(r"(^|\W)" + re.escape(mk) + r"($|\W)", " ", remainder)
    for v in VIBES:
        remainder = re.sub(r"(^|\W)" + re.escape(v) + r"($|\W)", " ", remainder)
    remainder = re.sub(r"\b(super\s*hits?|superhits?|hits?|mixes?|playlists?|queue|songs?|music|tracks?|melodies)\b", " ", remainder)
    # lone 'super' left from 'super hits' ("anirudh super hits" -> "super") is noise
    remainder = re.sub(r"\bsuper\b", " ", remainder)
    remainder = re.sub(r"\bby\b", " ", remainder)
    # leftover shards of the exclude-filter ('dont', stray 'play') are not titles
    remainder = re.sub(r"\bdon'?t\b", " ", remainder)
    remainder = re.sub(r"\s+", " ", remainder).strip(" -–—:,.!")
    # a lone 'play' left after facet stripping (e.g. 'dont play sad' case) is filler
    if remainder.strip().lower() in {"play"}:
        remainder = ""

    song = _smart_title(remainder) if remainder and len(remainder) >= 2 else None
    # If remainder is just noise, drop it
    if song and song.lower() in {"me", "a", "the", "my", "please", "some", "ing", "this", "that", "it",
                                 "dont", "don't", "play", "dont play", "don't play"}:
        song = None

    return {
        "song": song,
        "artist": artist,
        "mood": moods[0] if moods else None,
        "moods": moods,
        "genre": genre,
        "language": lang,
        "vibes": vibes,
        "verbs": verbs,
        "coreKeywords": core,
    }


def _build_search_query(parsed: Dict[str, Any], norm: str) -> str:
    """YouTube-like query: prefer explicit song+artist, else stripped core keywords."""
    parts: List[str] = []
    if parsed.get("song"):
        parts.append(parsed["song"])
    if parsed.get("artist"):
        # avoid duplicating artist if song remainder already contains it
        if not parsed.get("song") or parsed["artist"].lower() not in parsed["song"].lower():
            parts.append(parsed["artist"])
    if not parts:
        core = parsed.get("coreKeywords") or _strip_to_keywords(norm)
        # filters are not searchable keywords
        core = re.sub(r"don'?t\s+play\s+sad", " ", core)
        core = re.sub(r"\bnot\s+sad\b", " ", core)
        core = _TRAILING_FILLER_RE.sub("", core).strip()
        core = re.sub(r"\s+", " ", core).strip()
        if core:
            return core
        return norm
    # enrich short queries with mood/language so 'happy tamil' stays searchable
    query = " ".join(parts)
    extras: List[str] = []
    if parsed.get("mood") and parsed["mood"].lower() not in query.lower():
        extras.append(_smart_title(parsed["mood"].lower()))
    if parsed.get("language") and parsed["language"].lower() not in query.lower():
        extras.append(_smart_title(parsed["language"].lower()))
    if extras and len(query.split()) <= 3:
        query = f"{query} {' '.join(extras)}".strip()
    return query


def _build_display_text(action: str, parsed: Dict[str, Any], search_query: str) -> str:
    if action in ("PLAY_BY_MOOD", "PLAY_BY_LANGUAGE", "PLAY_BY_GENRE"):
        bits = []
        if parsed.get("mood"):
            bits.append(_smart_title(parsed["mood"].lower()))
        if parsed.get("language"):
            bits.append(_smart_title(parsed["language"].lower()))
        if parsed.get("genre"):
            bits.append(_smart_title(parsed["genre"].lower()))
        # mood+artist queries ("play calm Anirudh") must not drop the artist
        if parsed.get("artist"):
            bits.append(parsed["artist"])
        label = " ".join(bits) if bits else "matching"
        return f"Playing {label} songs."
    if action in ("SEARCH_ARTIST", "PLAY_SONG", "SEARCH_SONG"):
        who = parsed.get("artist") or search_query
        if parsed.get("song") and parsed.get("artist"):
            return f"Playing {parsed['song']} by {parsed['artist']}."
        return f"Searching for {who}."
    if action == "PLAY_SIMILAR":
        return "Playing songs similar to this one."
    if action == "PLAY_RANDOM":
        return "Playing a random song."
    if action == "PLAY_LIKED":
        return "Playing your liked songs."
    if action in ("NEXT", "PREVIOUS", "PAUSE", "RESUME"):
        return f"{action.title()} executed."
    return f"Searching for {search_query}." if search_query else "Done."


def _with_contract(actions: List[dict], parsed: Dict[str, Any], norm: str,
                   response: str, extra: Optional[dict] = None) -> dict:
    """Attach the prompt/response contract fields to every mock result."""
    search_query = _build_search_query(parsed, norm)
    out: Dict[str, Any] = {
        "actions": actions,
        "response": response,
        "clarificationNeeded": False,
        "parsedKeywords": {
            "song": parsed.get("song"),
            "artist": parsed.get("artist"),
            "mood": parsed.get("mood"),
            "genre": parsed.get("genre"),
            "language": parsed.get("language"),
            "verbs": parsed.get("verbs", []),
        },
        "searchQuery": search_query,
        "displayText": response,
    }
    if extra:
        out.update(extra)
    # displayText defaults to response unless caller overrides
    if "displayText" not in (extra or {}):
        out["displayText"] = response
    return out


def _clarify(norm: str, parsed: Dict[str, Any], question: Optional[str] = None) -> dict:
    search_query = _build_search_query(parsed, norm)
    q = question or (
        "I didn't catch that. Try one of these: "
        + ", ".join(f"'{s}'" for s in CLARIFICATION_SUGGESTIONS)
    )
    return {
        "actions": [],
        "response": "",
        "clarificationNeeded": True,
        "clarificationQuestion": q,
        "suggestions": list(CLARIFICATION_SUGGESTIONS),
        "parsedKeywords": {
            "song": parsed.get("song"),
            "artist": parsed.get("artist"),
            "mood": parsed.get("mood"),
            "genre": parsed.get("genre"),
            "language": parsed.get("language"),
            "verbs": parsed.get("verbs", []),
        },
        "searchQuery": search_query,
        "displayText": q,
    }


def _mock_understand(text: str, context=None) -> dict:
    """Rule-based mock that covers 80%+ of commands without an LLM.

    YouTube-like keyword understanding:
      - typo-tolerant entry (lowercase/trim/fuzzy)
      - play/song/music/please stopwords stripped for searchQuery
      - {song, artist, mood, genre, language, verbs} extraction
      - alias normalization (ani->Anirudh, arr->A R Rahman, ...)
      - 'play X by Y', 'X hits', mood+language handling
    """
    t0 = time.perf_counter()
    norm = normalize_entry(text)
    if not norm:
        parsed = {"song": None, "artist": None, "mood": None, "genre": None,
                  "language": None, "verbs": [], "coreKeywords": ""}
        res = _clarify(norm, parsed, "I couldn't hear you. Please try again.")
        logger.info("[LLM mock] empty_input latency_ms=%.1f", (time.perf_counter() - t0) * 1000)
        return res

    # check simple controls first (no LLM needed) — no catalog search involved
    simple = _simple_detect(text)
    if simple:
        parsed = _parse_keywords(norm)
        # controls carry no song/search semantics; clear misleading remainder
        parsed = dict(parsed, song=None, coreKeywords="")
        act = simple[0]["action"]
        resp = f"{act.title()} executed."
        if act == "NEXT":
            resp = "Skipping to the next song."
        elif act == "PREVIOUS":
            resp = "Going back to the previous song."
        elif act == "PAUSE":
            resp = "Pausing the music."
        elif act == "RESUME":
            resp = "Resuming playback."
        res = _with_contract(simple, parsed, norm, resp)
        res["searchQuery"] = ""
        logger.info("[LLM mock] simple action=%s latency_ms=%.1f text=%r",
                    act, (time.perf_counter() - t0) * 1000, text[:80])
        return res

    parsed = _parse_keywords(norm)
    verbs = parsed["verbs"]
    artist = parsed["artist"]
    mood = parsed["mood"]
    moods = parsed.get("moods", [])
    lang = parsed.get("language")
    genre = parsed.get("genre")
    vibes = parsed.get("vibes", [])
    song = parsed.get("song")

    # ---- "add ... to (my) <playlist>" ----
    # Strip the playlist clause BEFORE facet detection so the playlist NAME
    # (e.g. 'Chill' in 'Chill playlist') doesn't fake a mood/vibe signal.
    if "add" in norm and "playlist" in norm:
        m = re.search(r"to\s+(?:my\s+)?(.+?)\s+playlist", norm)
        pl = m.group(1).strip() if m and m.group(1).strip() else "Chill"
        # guard: 'playlist' word itself leaking into name
        pl = re.sub(r"\b(playlist|my)\b", "", pl, flags=re.I).strip() or "Chill"
        pl = _smart_title(pl)
        # Facets live BETWEEN 'add' and 'to <playlist>': 'add <facets> to my X playlist'.
        # Extract that middle span so 'add calm tamil songs to my Workout playlist'
        # yields PLAY_BY_MOOD + ADD_TO_PLAYLIST instead of wiping everything.
        mid = None
        m_mid = re.search(r"\badd\b(.+?)\bto\s+(?:my\s+)?.+?playlist", norm)
        if m_mid and m_mid.group(1).strip():
            mid = re.sub(r"\s+", " ", m_mid.group(1).strip())
        else:
            mid = re.sub(r"\badd\b.*\bplaylist\b", " ", norm)
            mid = re.sub(r"\s+", " ", mid).strip()
        facets = _parse_keywords(mid) if mid and mid not in {"", "this", "it", "that"} else None
        # Positional references ("the first song", "this song") are not titles:
        # a lone "First"/"Next" with no other facet means FIRST_RESULT, not a search.
        if facets and (facets.get("song") or "").lower() in {"first", "1st", "next", "current"} \
                and not (facets.get("moods") or facets.get("genre")
                         or facets.get("language") or facets.get("artist")):
            facets = None
        actions: List[dict] = []
        has_facets = bool(facets and (facets.get("moods") or facets.get("genre")
                                      or facets.get("language") or facets.get("artist")
                                      or facets.get("song")))
        # Fallback: facets BEFORE 'add' ("Give me calm Tamil songs ... and add
        # the first song to my Chill playlist") — mid is positional, but the
        # full request carries mood/language. The PLAY part must reflect those.
        # Strip the playlist clause first so the playlist NAME ("Chill") does
        # not fake a mood/vibe signal for bare "add this to my Chill playlist".
        if not has_facets:
            no_pl = re.sub(r"\bto\s+(?:my\s+)?.+?playlist\b", " ", norm)
            no_pl = re.sub(r"\s+", " ", no_pl).strip()
            full = _parse_keywords(no_pl) if no_pl else None
            if full and (full.get("moods") or full.get("language")
                         or full.get("genre") or full.get("artist")):
                facets = {
                    "song": None, "artist": full.get("artist"),
                    "mood": full["moods"][0] if full.get("moods") else None,
                    "moods": list(full.get("moods") or []),
                    "genre": full.get("genre"), "language": full.get("language"),
                    "vibes": list(full.get("vibes") or []),
                    "verbs": list(full.get("verbs") or []),
                    "coreKeywords": full.get("coreKeywords", ""),
                }
                has_facets = True
        if has_facets:
            assert facets is not None
            params: Dict[str, Any] = {}
            if facets.get("moods"):
                params["mood"] = facets["moods"][0]
            if facets.get("language"):
                params["language"] = facets["language"]
            if facets.get("genre"):
                params["genre"] = facets["genre"]
            if facets.get("vibes"):
                params["vibe"] = facets["vibes"]
            if facets.get("artist"):
                params["artist"] = facets["artist"]
            if facets.get("song"):
                params["song"] = facets["song"]
            if "don't play sad" in norm or "dont play sad" in norm or "not sad" in norm:
                params["exclude_mood"] = ["SAD"]
            actions.append({"action": "PLAY_BY_MOOD" if (facets.get("moods") or facets.get("language") or facets.get("genre")) else "SEARCH_SONG",
                            "parameters": params})
        actions.append({"action": "ADD_TO_PLAYLIST", "parameters": {"playlist": pl, "target": "FIRST_RESULT"}})
        # Contract: bare 'add this to <playlist>' has no searchable facets — report
        # clean empty keywords, not the playlist name leaking as mood/song.
        contract_parsed = facets if has_facets else {
            "song": None, "artist": None, "mood": None, "moods": [],
            "genre": None, "language": None, "vibes": [], "verbs": ["add"],
            "coreKeywords": "",
        }
        if has_facets:
            resp = f"Playing and adding first result to {pl} playlist."
        else:
            resp = f"Adding current song to {pl} playlist."
        res = _with_contract(actions, contract_parsed, norm, resp)
        res["searchQuery"] = "" if not has_facets else res.get("searchQuery", "")
        logger.info("[LLM mock] add_to_playlist pl=%s latency_ms=%.1f", pl, (time.perf_counter() - t0) * 1000)
        return res

    if "queue" in norm and "add" in norm:
        actions = [{"action": "ADD_TO_QUEUE", "parameters": {"target": "CURRENT_SONG"}}]
        res = _with_contract(actions, parsed, norm, "Adding current song to queue.")
        logger.info("[LLM mock] add_to_queue latency_ms=%.1f", (time.perf_counter() - t0) * 1000)
        return res

    # ---- NEW: PLAY_LIKED (user's liked-songs library, params {}) ----
    # Before mood/artist/by branches so liked wins over junk SEARCH when both
    # match ("play the like playlist any song" contains "any" + liked).
    if _is_liked_request(norm):
        liked_parsed = dict(parsed, song=None, coreKeywords="")
        resp = "Playing your liked songs."
        actions = [{"action": "PLAY_LIKED", "parameters": {}}]
        res = _with_contract(actions, liked_parsed, norm, resp)
        res["searchQuery"] = ""
        res["displayText"] = resp
        logger.info("[LLM mock] play_liked latency_ms=%.1f text=%r",
                    (time.perf_counter() - t0) * 1000, text[:80])
        return res

    # ---- Lyric-line identification (human-like: ANY song line -> SEARCH_SONG)
    # Framed lyric requests ("which goes ...", "song that says ...", "lyrics",
    # quoted "...") ALWAYS resolve to SEARCH_SONG with the FULL line preserved
    # for the backend identification chain (local lyrics -> websearch ->
    # library match). Only framing is stripped. Checked BEFORE mood/artist/by
    # so a lyric containing a feeling/artist word still identifies the song.
    # Short exact titles (no cue, no quotes) return None here and keep legacy.
    lyric_line = _extract_lyric_query(norm, text)
    if lyric_line:
        lyric_q = _smart_title(lyric_line)
        lyric_params: Dict[str, Any] = {"query": lyric_q}
        # preserve artist when the request names one alongside the lyric
        # ("play that song which goes ... by Anirudh")
        if artist:
            lyric_params["artist"] = artist
        lyric_parsed = dict(parsed, song=lyric_q, coreKeywords=lyric_line)
        lyric_resp = f"Searching for {lyric_q}."
        lyric_actions = [{"action": "SEARCH_SONG", "parameters": lyric_params}]
        res = _with_contract(lyric_actions, lyric_parsed, norm, lyric_resp)
        # contract: full lyric line is the searchable query (never junk words)
        res["searchQuery"] = lyric_q
        res["displayText"] = lyric_resp
        logger.info("[LLM mock] lyric query=%r latency_ms=%.1f",
                    lyric_line[:80], (time.perf_counter() - t0) * 1000)
        return res

    # ---- "play <song> by <artist>" (explicit, highest precision) ----
    m_by = re.search(r"play\s+(.+?)\s+by\s+([a-zA-Z0-9 .&'\-]+)", norm)
    if m_by:
        raw_song = re.sub(r"\s+", " ", m_by.group(1).strip()).strip()
        raw_artist = re.sub(r"\s+", " ", m_by.group(2).strip()).strip()
        # clean song side of trailing fillers
        raw_song = _TRAILING_FILLER_RE.sub("", raw_song).strip()
        # resolve artist via aliases (incl. fuzzy)
        hit = _canonical_artist(raw_artist)
        canon_artist = hit[0] if hit else _smart_title(raw_artist)
        # If the song side is PURE facets ("play happy tamil by Anirudh"),
        # it is not a title: treat as artist-only so we don't invent a song
        # called "Happy Tamil".
        _facet_check = raw_song.lower() if raw_song else ""
        for _w in list(MOOD_MAP.keys()) + LANGUAGES + list(GENRES.keys()) + VIBES:
            _facet_check = re.sub(r"(^|\W)" + re.escape(_w) + r"($|\W)", " ", _facet_check)
        _facet_check = re.sub(r"\b(super\s*hits?|superhits?|hits?|mixes?|playlists?|queue|songs?|music|tracks?|melodies)\b", " ", _facet_check)
        _facet_check = re.sub(r"\s+", " ", _facet_check).strip()
        if raw_song and not _facet_check:
            # pure-facet song side -> artist intent with mood/lang preserved
            parsed2 = dict(parsed, song=None, artist=canon_artist)
            params = {"artist": canon_artist}
            if moods:
                params["mood"] = moods[0]
            if lang:
                params["language"] = lang
            if genre:
                params["genre"] = genre
            actions = [{"action": "SEARCH_ARTIST", "parameters": params}]
            resp = f"Searching for {canon_artist}."
            res = _with_contract(actions, parsed2, norm, resp)
            res["displayText"] = resp
            return res
        clean_song = _smart_title(raw_song) if raw_song else None
        parsed2 = dict(parsed, song=clean_song, artist=canon_artist)
        params = {"song": clean_song, "artist": canon_artist}
        # keep mood/lang if also present
        if moods:
            params["mood"] = moods[0]
        if lang:
            params["language"] = lang
        actions = [{"action": "SEARCH_SONG", "parameters": params}]
        resp = f"Playing {clean_song} by {canon_artist}." if clean_song else f"Searching for {canon_artist}."
        res = _with_contract(actions, parsed2, norm, resp)
        res["displayText"] = resp
        logger.info("[LLM mock] play-by song=%r artist=%r latency_ms=%.1f",
                    clean_song, canon_artist, (time.perf_counter() - t0) * 1000)
        return res

    # generic "by <artist>" / "search <artist>"
    if "search" in norm or re.search(r"\bby\b", norm):
        m = re.search(r"by\s+([a-zA-Z0-9 .&'\-]+)", norm)
        if m:
            raw = m.group(1).strip()
            # cut trailing fillers ('songs', 'please', ...)
            raw = _TRAILING_FILLER_RE.sub("", raw).strip()
            raw = re.sub(r"\s+(songs?|music|please)$", "", raw).strip()
            hit = _canonical_artist(raw)
            canon = hit[0] if hit else _smart_title(raw)
            parsed2 = dict(parsed, artist=canon)
            # if a song remainder exists too, prefer SEARCH_SONG
            if song and song.lower() not in canon.lower():
                params = {"song": song, "artist": canon}
                if moods:
                    params["mood"] = moods[0]
                if lang:
                    params["language"] = lang
                if genre:
                    params["genre"] = genre
                actions = [{"action": "SEARCH_SONG", "parameters": params}]
                resp = f"Playing {song} by {canon}."
            else:
                params = {"artist": canon}
                if moods:
                    params["mood"] = moods[0]
                if lang:
                    params["language"] = lang
                if genre:
                    params["genre"] = genre
                actions = [{"action": "SEARCH_ARTIST", "parameters": params}]
                resp = f"Searching for {canon}."
            res = _with_contract(actions, parsed2, norm, resp)
            res["displayText"] = resp
            return res
        m2 = re.search(r"search\s+([a-zA-Z0-9 .&'\-]+)", norm)
        if m2:
            raw = _TRAILING_FILLER_RE.sub("", m2.group(1).strip()).strip()
            hit = _canonical_artist(raw)
            canon = hit[0] if hit else _smart_title(raw)
            parsed2 = dict(parsed, artist=canon)
            params = {"artist": canon}
            if moods:
                params["mood"] = moods[0]
            if lang:
                params["language"] = lang
            if genre:
                params["genre"] = genre
            actions = [{"action": "SEARCH_ARTIST", "parameters": params}]
            res = _with_contract(actions, parsed2, norm, f"Searching for {canon}.")
            return res

    # ---- "<artist> hits / songs" e.g. 'anirudh hits', 'yuvan songs', '90s hits' ----
    # NOTE: mood/language/genre are preserved in params (e.g. 'play calm
    # Anirudh songs' -> SEARCH_ARTIST + mood CALM) so the hits shortcut does
    # not silently drop facets. Ordering stays hits-before-mood for the
    # required "Anirudh songs / ARR songs / A R Rahman hits" -> SEARCH_ARTIST.
    m_hits = re.match(r"(.+?)\s+(hits?|super\s*hits?|superhits?|songs?|mix|mixes|melodies|playlists?)\s*$", norm)
    if m_hits:
        prefix = m_hits.group(1).strip()
        # strip leading play verbs already handled in core, but be safe
        prefix = _LEADING_FILLER_RE.sub("", prefix).strip()
        hit = _canonical_artist(prefix)
        if hit:
            parsed2 = dict(parsed, artist=hit[0], song=None)
            params = {"artist": hit[0]}
            if moods:
                params["mood"] = moods[0]
            if lang:
                params["language"] = lang
            if genre:
                params["genre"] = genre
            if vibes:
                params["vibe"] = vibes
            actions = [{"action": "SEARCH_ARTIST", "parameters": params}]
            resp = f"Playing {hit[0]} hits."
            res = _with_contract(actions, parsed2, norm, resp)
            res["displayText"] = resp
            logger.info("[LLM mock] artist-hits artist=%s latency_ms=%.1f",
                        hit[0], (time.perf_counter() - t0) * 1000)
            return res
        # decade hits: '90s hits', '80s melodies' — use cleaned core, not raw 'play ...'
        if re.match(r"^(90s|80s|70s|2k|2000s|latest|trending)", prefix):
            core_q = _smart_title(parsed.get("coreKeywords") or prefix)
            params: Dict[str, Any] = {"genre": genre} if genre else {}
            params["query"] = core_q
            if lang:
                params["language"] = lang
            actions = [{"action": "SEARCH_SONG", "parameters": params}]
            res = _with_contract(actions, parsed, norm, f"Playing {core_q}.")
            res["searchQuery"] = core_q
            return res

    # ---- mood / language / genre / vibe (checked BEFORE bare artist so
    # facet queries like 'play calm Tamil songs' don't get hijacked by
    # short artist aliases) ----
    if moods or lang or genre or vibes:
        params = {}
        if moods:
            params["mood"] = moods[0]
        if lang:
            params["language"] = lang
        if genre:
            params["genre"] = genre
        if vibes:
            params["vibe"] = vibes
        # mood+artist queries ("play calm Anirudh") must not drop the artist
        if artist:
            params["artist"] = artist
        if song and song.lower() not in (artist or "").lower() and len(song.split()) >= 2:
            params["song"] = song
        if "don't play sad" in norm or "dont play sad" in norm or "not sad" in norm:
            params["exclude_mood"] = ["SAD"]
        if "more energetic" in norm and context and context.get("lastMood"):
            params["mood"] = "ENERGETIC"
            params["based_on"] = "CURRENT_CONTEXT"
        # purely language ('tamil songs') -> PLAY_BY_LANGUAGE; purely genre -> PLAY_BY_GENRE
        action = "PLAY_BY_MOOD"
        if not moods and lang and not genre:
            action = "PLAY_BY_LANGUAGE"
        elif not moods and genre and not lang:
            action = "PLAY_BY_GENRE"
        actions = [{"action": action, "parameters": params}]
        resp = _build_display_text(action, parsed, _build_search_query(parsed, norm))
        res = _with_contract(actions, parsed, norm, resp)
        logger.info("[LLM mock] mood action=%s params=%s latency_ms=%.1f",
                    action, params, (time.perf_counter() - t0) * 1000)
        return res

    # ---- bare artist mention ('ani', 'play anirudh', 'yuvan songs') ----
    if artist:
        # 'play X' where X is purely an artist -> SEARCH_ARTIST (frontend plays top result)
        # Preserve mood/language/genre/vibe facets (e.g. 'play Tamil Anirudh
        # songs' keeps language TAMIL; 'Anirudh calm songs' keeps mood CALM).
        base_params = {"artist": artist}
        if moods:
            base_params["mood"] = moods[0]
        if lang:
            base_params["language"] = lang
        if genre:
            base_params["genre"] = genre
        if vibes:
            base_params["vibe"] = vibes
        actions = [{"action": "SEARCH_ARTIST", "parameters": dict(base_params)}]
        # if we also isolated a song title alongside the artist, upgrade to SEARCH_SONG
        if song and song.lower() not in artist.lower() and len(song.split()) >= 2:
            params2 = {"song": song, "artist": artist}
            if moods:
                params2["mood"] = moods[0]
            if lang:
                params2["language"] = lang
            if genre:
                params2["genre"] = genre
            actions = [{"action": "SEARCH_SONG", "parameters": params2}]
            resp = f"Playing {song} by {artist}."
            res = _with_contract(actions, dict(parsed, song=song), norm, resp)
            res["displayText"] = resp
            return res
        resp = f"Searching for {artist}."
        res = _with_contract(actions, parsed, norm, resp)
        res["displayText"] = resp
        logger.info("[LLM mock] artist artist=%s latency_ms=%.1f", artist, (time.perf_counter() - t0) * 1000)
        return res

    if "similar" in norm and "this" in norm:
        actions = [{"action": "PLAY_SIMILAR", "parameters": {"source": "CURRENT_SONG"}}]
        res = _with_contract(actions, parsed, norm, "Playing songs similar to this one.")
        return res

    # ---- NEW: PLAY_RANDOM (random catalog song, params {}) ----
    # After PLAY_SIMILAR / mood / artist branches so precise meanings win
    # ("play something similar to this" -> PLAY_SIMILAR, "play Something by
    # Anirudh" -> SEARCH_SONG). Bare PLAY ("play" alone -> RESUME) is
    # untouched: this only fires on explicit random wording.
    if _is_random_request(norm, parsed):
        random_parsed = dict(parsed, song=None, coreKeywords="")
        resp = "Playing a random song."
        actions = [{"action": "PLAY_RANDOM", "parameters": {}}]
        res = _with_contract(actions, random_parsed, norm, resp)
        res["searchQuery"] = ""
        res["displayText"] = resp
        logger.info("[LLM mock] play_random latency_ms=%.1f text=%r",
                    (time.perf_counter() - t0) * 1000, text[:80])
        return res

    # ---- residual 'play <something>' -> YouTube-like SEARCH_SONG ----
    if "play" in verbs or "search" in verbs:
        core = parsed.get("coreKeywords") or _strip_to_keywords(norm)
        # pure filler ("play me songs" -> core "songs") is not a query:
        # fall through to the vague-play fallback (PLAY_RANDOM) below.
        if core and core.strip().lower() in {
            "song", "songs", "music", "tune", "tunes", "track", "tracks",
            "video", "videos", "audio", "songs ",
        }:
            core = ""
        if core and len(core) >= 2:
            core_q = _smart_title(core)
            params = {"query": core_q}
            if lang:
                params["language"] = lang
            if genre:
                params["genre"] = genre
            if moods:
                params["mood"] = moods[0]
            actions = [{"action": "SEARCH_SONG", "parameters": params}]
            resp = f"Searching for {core_q}."
            res = _with_contract(actions, parsed, norm, resp)
            res["displayText"] = resp
            logger.info("[LLM mock] residual-play query=%r latency_ms=%.1f",
                        core, (time.perf_counter() - t0) * 1000)
            return res

    # ---- vague play-intent never clarifies (mirrors CF system-prompt rule) ----
    # Any play/listen/enjoy request with extra words ALWAYS yields a play-family
    # action realtime — never CLARIFICATION_NEEDED. Leftover words go into
    # query/parameters (politeness stripped: please/some/me/a/the). Guards above
    # stay: bare "play" -> RESUME (SIMPLE_PATTERNS), "like this" -> LIKE_CURRENT.
    if re.search(r"\b(play|listen|enjoy)\b", norm):
        words = norm.split()
        if len(words) > 1:
            remainder = parsed.get("coreKeywords") or _strip_to_keywords(norm)
            for _ in range(3):
                new = re.sub(
                    r"^(please|kindly|some|me|a|the|an|my|to|for|of|enjoy|listen|play)\b\s*",
                    "", remainder, flags=re.I).strip()
                new = re.sub(
                    r"\s+(please|song|songs|music|track|tracks|tune|tunes|video|videos|audio|number|numbers|pls|plz)\s*$",
                    "", new, flags=re.I).strip()
                new = re.sub(r"\s+", " ", new).strip()
                if new == remainder:
                    break
                remainder = new
            noise = {"a", "an", "the", "some", "me", "my", "please", "kindly",
                     "this", "that", "it", "song", "songs", "music", "pls", "plz",
                     "to", "for", "of", "enjoy", "listen", "play"}
            if remainder and len(remainder) >= 2 and remainder.lower() not in noise:
                core_q = _smart_title(remainder)
                params: Dict[str, Any] = {"query": core_q}
                if lang:
                    params["language"] = lang
                if genre:
                    params["genre"] = genre
                if moods:
                    params["mood"] = moods[0]
                actions = [{"action": "SEARCH_SONG", "parameters": params}]
                resp = f"Searching for {core_q}."
                res = _with_contract(actions, parsed, norm, resp)
                res["displayText"] = resp
                logger.info("[LLM mock] vague-play query=%r latency_ms=%.1f",
                            remainder, (time.perf_counter() - t0) * 1000)
                return res
            # empty/politeness-only remainder ("play me a song") -> generic play
            rand_parsed = dict(parsed, song=None, coreKeywords="")
            resp = "Playing a random song."
            actions = [{"action": "PLAY_RANDOM", "parameters": {}}]
            res = _with_contract(actions, rand_parsed, norm, resp)
            res["searchQuery"] = ""
            res["displayText"] = resp
            logger.info("[LLM mock] vague-play-random latency_ms=%.1f text=%r",
                        (time.perf_counter() - t0) * 1000, text[:80])
            return res

    # ---- bare lyric line (no verb, no facets) -> SEARCH_SONG ----
    # A bare lyric line without leading play ("hello from the other side",
    # Tamil "kanmani anbodu ...") must still identify the song via the backend
    # chain (local lyrics -> websearch -> library match). Only long,
    # facet-free inputs qualify so short gibberish ("xyzqw blarg flimflam")
    # still clarifies.
    if _is_bare_lyric_candidate(norm, parsed):
        bare_q = _smart_title(re.sub(r"\s+", " ", norm).strip(" :-\u2013\u2014,.!\"'\u201c\u201d\u2018\u2019`"))
        bare_params: Dict[str, Any] = {"query": bare_q}
        bare_parsed = dict(parsed, song=bare_q, coreKeywords=norm)
        bare_resp = f"Searching for {bare_q}."
        bare_actions = [{"action": "SEARCH_SONG", "parameters": bare_params}]
        res = _with_contract(bare_actions, bare_parsed, norm, bare_resp)
        res["searchQuery"] = bare_q
        res["displayText"] = bare_resp
        logger.info("[LLM mock] bare-lyric query=%r latency_ms=%.1f",
                    norm[:80], (time.perf_counter() - t0) * 1000)
        return res

    # fallback clarification with 3 suggestions
    logger.info("[LLM mock] clarification latency_ms=%.1f text=%r",
                (time.perf_counter() - t0) * 1000, text[:80])
    return _clarify(norm, parsed)


def _sanitize_actions(actions: Any) -> tuple:
    """Keep only allow-listed actions. Returns (clean_actions, had_hallucination)."""
    clean: List[dict] = []
    hallucinated = False
    for a in actions or []:
        act = str(a.get("action", "")).upper() if isinstance(a, dict) else ""
        if act in ALLOWED_ACTIONS:
            params = a.get("parameters", {}) if isinstance(a, dict) else {}
            clean.append({"action": act, "parameters": params if isinstance(params, dict) else {}})
        else:
            hallucinated = True
    return clean, hallucinated


def _enforce_no_search_contract(j: dict) -> dict:
    """PLAY_RANDOM / PLAY_LIKED carry no search semantics: force empty
    searchQuery (the generic setdefault backfill would otherwise invent junk
    like "Any" / "My Liked" from parsed keywords when the model omits the
    field). Also clears a stray parsed song title. Never raises."""
    try:
        acts = [a.get("action") for a in j.get("actions", []) if isinstance(a, dict)]
    except Exception:
        return j
    if acts and all(a in ("PLAY_RANDOM", "PLAY_LIKED") for a in acts):
        j["searchQuery"] = ""
        try:
            pk = j.get("parsedKeywords")
            if isinstance(pk, dict):
                pk["song"] = None
        except Exception:
            pass
        if not j.get("displayText"):
            j["displayText"] = j.get("response", "")
    return j


def _apply_lyric_contract_fix(j: dict, norm: str, text: str) -> dict:
    """Force CF/transformers SEARCH_SONG contract to the FULL lyric line.

    Live models already emit the right action query (lyric preserved) but the
    generic backfill derives searchQuery from parsed keywords, which still
    contain framing ("That Which Goes ..."). When a framed lyric is present,
    override searchQuery + parsed song with the clean lyric so both fields
    carry the full line for the backend identification chain
    (local lyrics -> websearch -> library match). Never raises.
    """
    try:
        lyric = _extract_lyric_query(norm, text)
        if not lyric:
            return j
        lq = _smart_title(lyric)
        j["searchQuery"] = lq
        try:
            for a in j.get("actions", []) or []:
                if isinstance(a, dict) and a.get("action") == "SEARCH_SONG":
                    params = a.get("parameters") or {}
                    q = str(params.get("query") or params.get("song") or "")
                    ql = q.lower()
                    # replace only when missing or framing-contaminated; a clean
                    # model lyric (contains the line) is normalized to lq.
                    framing = ("which goes" in ql or "that goes" in ql
                               or "goes like" in ql or "that says" in ql
                               or "which says" in ql or "lyrics" in ql
                               or "lyric" in ql)
                    if (not q or lyric.lower() not in ql or framing):
                        # keep artist facet when the model provided one
                        artist = params.get("artist")
                        params["query"] = lq
                        if artist:
                            params["artist"] = artist
                        a["parameters"] = params
        except Exception:
            pass
        try:
            pk = j.get("parsedKeywords")
            if isinstance(pk, dict):
                pk["song"] = lq
        except Exception:
            pass
    except Exception:
        pass
    return j


# ---------------------------------------------------------------------------
# Cloudflare Workers AI (AI_MODE=cf_workers)
# ---------------------------------------------------------------------------

def _cf_user_content(text: str, context=None) -> str:
    """User message = text + compact JSON context (so the model sees lastMood etc.)."""
    try:
        if context:
            ctx_str = json.dumps(context, ensure_ascii=False, default=str)
            return f"{text}\n\nContext: {ctx_str}"
    except Exception:
        pass
    return text or ""


def _extract_cf_text(payload: Any) -> str:
    """Dual-shape parse: result.response | result.choices[0].message.content.

    Workers AI chat models return {"result": {"response": "..."}} while some
    return OpenAI-style {"result": {"choices": [{"message": {"content": "..."}}]}}.
    Returns "" when nothing usable is present. Never raises.
    """
    try:
        if not isinstance(payload, dict):
            return ""
        result = payload.get("result")
        if isinstance(result, str):
            return result
        if isinstance(result, dict):
            resp = result.get("response")
            if isinstance(resp, str) and resp.strip():
                return resp
            choices = result.get("choices")
            if isinstance(choices, list) and choices:
                first = choices[0]
                if isinstance(first, dict):
                    msg = first.get("message")
                    if isinstance(msg, dict) and isinstance(msg.get("content"), str):
                        return msg["content"]
                    if isinstance(first.get("text"), str):
                        return first["text"]
        # some gateways echo top-level response
        top = payload.get("response")
        if isinstance(top, str):
            return top
    except Exception:
        pass
    return ""


def _call_cf_workers(messages: List[Dict[str, str]]) -> Optional[str]:
    """POST messages to Cloudflare Workers AI and return raw generated text.

    - URL: https://api.cloudflare.com/client/v4/accounts/{id}/ai/run/{model}
    - Body: {messages, max_tokens 512, temperature 0.2}
    - 2 attempts (CF_TIMEOUT_S then 1.0s), retry on 429/5xx/timeout only.
    - Missing CF_ACCOUNT_ID/CF_AI_TOKEN -> None (caller falls back to mock).
    - Never raises; never logs the token. Returns None on any failure.
    """
    if not CF_ACCOUNT_ID or not CF_AI_TOKEN:
        logger.debug("[LLM CF] missing CF_ACCOUNT_ID/CF_AI_TOKEN -> mock fallback")
        return None
    try:
        import httpx
    except Exception as e:
        logger.debug("[LLM CF] httpx unavailable: %s", e)
        return None
    url = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/ai/run/{CF_MODEL}"
    headers = {"Authorization": "Bearer " + CF_AI_TOKEN, "Content-Type": "application/json"}
    body = {"messages": messages, "max_tokens": 512, "temperature": 0.2}
    timeouts = [CF_TIMEOUT_S, 1.0]
    for attempt, timeout_s in enumerate(timeouts, start=1):
        t0 = time.perf_counter()
        try:
            r = httpx.post(url, headers=headers, json=body, timeout=timeout_s)
            status = r.status_code
            if status == 200:
                try:
                    payload = r.json()
                except Exception as e:
                    logger.warning("[LLM CF] attempt %d bad JSON latency_ms=%.1f: %s",
                                   attempt, (time.perf_counter() - t0) * 1000, e)
                    return None
                gen = _extract_cf_text(payload)
                logger.info("[LLM CF] attempt %d ok model=%s latency_ms=%.1f chars=%d",
                            attempt, CF_MODEL, (time.perf_counter() - t0) * 1000, len(gen or ""))
                return gen or None
            if status == 429 or 500 <= status <= 599:
                logger.warning("[LLM CF] attempt %d retryable status=%d model=%s latency_ms=%.1f",
                               attempt, status, CF_MODEL, (time.perf_counter() - t0) * 1000)
                continue  # second attempt (shorter timeout) or fall through to None
            logger.warning("[LLM CF] attempt %d non-retryable status=%d model=%s latency_ms=%.1f",
                           attempt, status, CF_MODEL, (time.perf_counter() - t0) * 1000)
            return None
        except Exception as e:
            # Retry ONLY on timeouts; other transport errors fall back immediately.
            is_timeout = False
            try:
                import httpx as _httpx
                is_timeout = isinstance(e, _httpx.TimeoutException)
            except Exception:
                pass
            if not is_timeout and isinstance(e, TimeoutError):
                is_timeout = True
            # httpx timeout message check as last resort (never logs token/body)
            if not is_timeout and "timeout" in type(e).__name__.lower():
                is_timeout = True
            if is_timeout:
                logger.warning("[LLM CF] attempt %d timeout (%.1fs) model=%s latency_ms=%.1f: %s",
                               attempt, timeout_s, CF_MODEL,
                               (time.perf_counter() - t0) * 1000, type(e).__name__)
                continue
            logger.warning("[LLM CF] attempt %d non-retryable error model=%s latency_ms=%.1f: %s",
                           attempt, CF_MODEL, (time.perf_counter() - t0) * 1000, type(e).__name__)
            return None
    return None


def understand(text: str, context=None) -> dict:
    """
    Main entry: text -> {actions, response, clarificationNeeded?, parsedKeywords, searchQuery, displayText}
    Tries real Qwen if configured, else mock.
    Repeat inputs are served from shared Redis (see cache_service).
    Never raises for cache/LLM failures — falls back to mock. No secrets hardcoded.
    """
    t0 = time.perf_counter()
    # 0. Shared-cache lookup (deterministic per normalized text + context)
    try:
        from app.services import cache_service
        hit = cache_service.get_understand(text, AI_MODE, context)
        if isinstance(hit, dict) and "actions" in hit:
            logger.info("[LLM] cache_hit mode=%s latency_ms=%.1f text=%r",
                        AI_MODE, (time.perf_counter() - t0) * 1000, (text or "")[:80])
            return hit
    except Exception as e:
        logger.debug("[LLM] cache lookup failed: %s", e)

    result = _understand_uncached(text, context)

    # Don't cache clarifications or empty-action results: only successful
    # understands (>=1 action) are reusable. Empty actions[] (e.g. one CF
    # empty response) would otherwise poison identical retries for 300s.
    # Clarifications depend on transient context/failures.
    actions = result.get("actions")
    if (not result.get("clarificationNeeded")
            and isinstance(actions, list) and len(actions) >= 1):
        try:
            from app.services import cache_service
            cache_service.put_understand(text, AI_MODE, context, result)
        except Exception as e:
            logger.debug("[LLM] cache save failed: %s", e)
    logger.info("[LLM] understand mode=%s actions=%s latency_ms=%.1f",
                AI_MODE, [a.get("action") for a in result.get("actions", [])],
                (time.perf_counter() - t0) * 1000)
    return result


def _understand_uncached(text: str, context=None) -> dict:
    """
    Main entry: text -> {actions, response, clarificationNeeded?}
    Tries real Qwen if configured, else mock.
    """
    # 1. Simple detector bypass (no LLM) — delegate to mock for consistent
    # contract (friendly displayText, empty searchQuery for controls).
    simple = _simple_detect(text)
    if simple:
        return _mock_understand(text, context)

    if AI_MODE == "mock":
        return _mock_understand(text, context)

    if AI_MODE == "transformers":
        pipe = _load_qwen_transformers()
        if pipe is None:
            return _mock_understand(text, context)
        try:
            messages = [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": text}]
            # Qwen chat template
            prompt = pipe.tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
            out = pipe(prompt, do_sample=False, temperature=0.2)[0]["generated_text"]
            # extract json
            # out contains prompt + generation; slice
            gen = out[len(prompt):] if out.startswith(prompt) else out
            # find json block (non-greedy so trailing text doesn't swallow the object)
            m = re.search(r"\{.*?\}", gen, re.S)
            if m:
                j = json.loads(m.group(0))
                # validate actions exist
                if "actions" in j:
                    clean, hall = _sanitize_actions(j.get("actions"))
                    if hall:
                        norm = normalize_entry(text)
                        return _clarify(norm, _parse_keywords(norm),
                                        "I didn't understand that. Could you rephrase? "
                                        f"Try: {', '.join(repr(s) for s in CLARIFICATION_SUGGESTIONS)}")
                    j["actions"] = clean
                    j = _enforce_no_search_contract(j)
                    # backfill contract fields if model omitted them
                    norm = normalize_entry(text)
                    parsed = _parse_keywords(norm)
                    j.setdefault("parsedKeywords", {
                        "song": parsed.get("song"), "artist": parsed.get("artist"),
                        "mood": parsed.get("mood"), "genre": parsed.get("genre"),
                        "language": parsed.get("language"), "verbs": parsed.get("verbs", []),
                    })
                    j.setdefault("searchQuery", _build_search_query(parsed, norm))
                    j.setdefault("displayText", j.get("response", ""))
                    j.setdefault("clarificationNeeded", False)
                    j = _apply_lyric_contract_fix(j, norm, text)
                    return j
            return _mock_understand(text, context)
        except Exception as e:
            print(f"[LLM] inference failed: {e}")
            return _mock_understand(text, context)

    if AI_MODE == "hf_api":
        # Call HuggingFace Inference API (2 attempts, then mock fallback)
        import httpx
        last_err: Optional[Exception] = None
        for attempt in (1, 2):
            try:
                headers = {"Authorization": f"Bearer {HF_TOKEN}"} if HF_TOKEN else {}
                prompt = SYSTEM_PROMPT + "\n\nUser: " + text + "\n\nAssistant JSON:"
                r = httpx.post(f"https://api-inference.huggingface.co/models/{QWEN_MODEL}",
                               headers=headers, json={"inputs": prompt, "parameters": {"max_new_tokens": 512, "temperature": 0.2}}, timeout=30)
                r.raise_for_status()
                body = r.json()
                gen = body[0].get("generated_text", "") if isinstance(body, list) else body.get("generated_text", "")
                m = re.search(r"\{.*?\}", gen, re.S)
                if m:
                    j = json.loads(m.group(0))
                    if "actions" in j:
                        clean, hall = _sanitize_actions(j.get("actions"))
                        if hall:
                            norm = normalize_entry(text)
                            return _clarify(norm, _parse_keywords(norm))
                        j["actions"] = clean
                        j = _enforce_no_search_contract(j)
                        return j
                return _mock_understand(text, context)
            except Exception as e:
                last_err = e
                print(f"[LLM HF] attempt {attempt} failed: {e}")
                time.sleep(0.5 * attempt)
        print(f"[LLM HF] all retries failed ({last_err}), falling back to mock")
        return _mock_understand(text, context)

    if AI_MODE == "cf_workers":
        # Cloudflare Workers AI: chat messages -> JSON actions. Missing secret
        # -> mock. Transport/parse failures -> mock. Never raises.
        try:
            messages = [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": _cf_user_content(text, context)},
            ]
            gen = _call_cf_workers(messages)
            if not gen:
                return _mock_understand(text, context)
            # greedy JSON block (model may wrap JSON in prose/fences)
            m = re.search(r"\{.*\}", gen, re.S)
            if m:
                try:
                    j = json.loads(m.group(0))
                except Exception as e:
                    logger.warning("[LLM CF] JSON parse failed: %s gen=%r", type(e).__name__, (gen or "")[:200])
                    return _mock_understand(text, context)
                if "actions" in j:
                    clean, hall = _sanitize_actions(j.get("actions"))
                    if hall:
                        norm = normalize_entry(text)
                        return _clarify(norm, _parse_keywords(norm),
                                        "I didn't understand that. Could you rephrase? "
                                        f"Try: {', '.join(repr(s) for s in CLARIFICATION_SUGGESTIONS)}")
                    # Empty-action CF responses must not win: fall back to mock
                    # so controls (e.g. "pause the music") still resolve and the
                    # empty result is never cached (poison guard).
                    if not clean:
                        return _mock_understand(text, context)
                    j["actions"] = clean
                    j = _enforce_no_search_contract(j)
                    # backfill contract fields if model omitted them
                    norm = normalize_entry(text)
                    parsed = _parse_keywords(norm)
                    j.setdefault("parsedKeywords", {
                        "song": parsed.get("song"), "artist": parsed.get("artist"),
                        "mood": parsed.get("mood"), "genre": parsed.get("genre"),
                        "language": parsed.get("language"), "verbs": parsed.get("verbs", []),
                    })
                    j.setdefault("searchQuery", _build_search_query(parsed, norm))
                    j.setdefault("displayText", j.get("response", ""))
                    j.setdefault("clarificationNeeded", False)
                    j = _apply_lyric_contract_fix(j, norm, text)
                    return j
            return _mock_understand(text, context)
        except Exception as e:
            logger.warning("[LLM CF] understand failed (%s) -> mock fallback", type(e).__name__)
            return _mock_understand(text, context)

    return _mock_understand(text, context)


def health():
    qwen_ok = False
    if AI_MODE == "mock":
        qwen_ok = True  # mock always ok
    elif AI_MODE == "transformers":
        qwen_ok = _qwen_pipeline is not None
    elif AI_MODE == "cf_workers":
        # configured when both account + token are present (token never logged)
        qwen_ok = bool(CF_ACCOUNT_ID and CF_AI_TOKEN)
    try:
        import torch
        device = "cuda" if torch.cuda.is_available() else "cpu"
        if AI_MODE == "mock":
            device = "mock"
        elif AI_MODE == "cf_workers":
            device = "cf_workers"
    except Exception:
        if AI_MODE == "mock":
            device = "mock"
        elif AI_MODE == "cf_workers":
            device = "cf_workers"
        else:
            device = "cpu"
    model = CF_MODEL if AI_MODE == "cf_workers" else QWEN_MODEL
    return {"qwen_loaded": qwen_ok, "qwen_model": model, "device": device}
