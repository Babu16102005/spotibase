import os
import json
import re
from pathlib import Path
from typing import List

# Simple fallback + optional real Qwen loader
# Set AI_MODE=mock for instant dev without downloading 3B weights
# Set AI_MODE=transformers to load Qwen2.5-3B-Instruct locally
# Set AI_MODE=hf_api to call HuggingFace Inference API (needs HF_TOKEN)

AI_MODE = os.getenv("AI_MODE", "mock")  # mock | transformers | hf_api
QWEN_MODEL = os.getenv("QWEN_MODEL", "Qwen/Qwen2.5-3B-Instruct")
HF_TOKEN = os.getenv("HF_TOKEN", "")
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

# ---- Mood / keyword heuristics (used in mock + as fallback) ----
MOOD_MAP = {
    "calm": "CALM", "relax": "CALM", "relaxed": "CALM", "peaceful": "CALM", "soothing": "CALM", "chill": "CHILL",
    "happy": "HAPPY", "joy": "HAPPY", "cheerful": "HAPPY", "feel good": "HAPPY", "feel-good": "HAPPY",
    "sad": "SAD", "melancholic": "MELANCHOLIC", "depressed": "SAD", "blue": "SAD",
    "energetic": "ENERGETIC", "energy": "ENERGETIC", "pumped": "ENERGETIC", "workout": "ENERGETIC", "gym": "ENERGETIC", "party": "PARTY",
    "romantic": "ROMANTIC", "love": "ROMANTIC", "dreamy": "DREAMY",
    "focused": "FOCUSED", "study": "FOCUSED", "concentrate": "FOCUSED",
    "motivated": "MOTIVATED",
    "nostalgic": "NOSTALGIC",
}

SIMPLE_PATTERNS = {
    r"^\s*(next|skip|next song)\s*$": ("NEXT", {}),
    r"^\s*(pause|pause the song|pause music)\s*$": ("PAUSE", {}),
    r"^\s*(resume|continue|play|resume the song)\s*$": ("RESUME", {}),
    r"^\s*(previous|prev|go back)\s*$": ("PREVIOUS", {}),
    r"^\s*like\s*(this|song)?\s*$": ("LIKE_CURRENT", {}),
    r"^\s*unlike\s*": ("UNLIKE_CURRENT", {}),
    r"^\s*shuffle on": ("SHUFFLE_ON", {}),
    r"^\s*shuffle off": ("SHUFFLE_OFF", {}),
}

def _simple_detect(text: str):
    t = text.strip().lower()
    for pat, (act, params) in SIMPLE_PATTERNS.items():
        if re.match(pat, t):
            return [{"action": act, "parameters": params}]
    return None

def _mock_understand(text: str, context=None) -> dict:
    """Rule-based mock that covers 80% of commands without LLM. Used when AI_MODE=mock or LLM fails."""
    t = text.lower()
    # multi-action split
    actions = []

    # check simple first
    simple = _simple_detect(text)
    if simple:
        return {"actions": simple, "response": f"Executing {simple[0]['action']}", "clarificationNeeded": False}

    # complex parsing - keyword spotting
    # Example: "Play calm Tamil songs" -> PLAY_BY_MOOD mood=CALM language=TAMIL
    # Detect mood
    found_moods = []
    for k, v in MOOD_MAP.items():
        if k in t:
            if v not in found_moods:
                found_moods.append(v)
    # language
    lang = None
    for l in ["tamil", "english", "hindi", "telugu", "malayalam", "kannada", "bengali"]:
        if l in t:
            lang = l.upper()
            break
    # genre
    genre = None
    for g in ["pop", "rock", "hip hop", "hip-hop", "melody", "classical", "electronic"]:
        if g in t:
            genre = g.replace("-", "_").upper()
            break
    # vibe
    vibes = []
    for v in ["chill", "dreamy", "party", "dark", "peaceful", "intense"]:
        if v in t:
            vibes.append(v.upper())

    # "add to playlist" / "add to queue"
    if "add" in t and "playlist" in t:
        # extract playlist name: "add ... to my Chill playlist" -> Chill
        m = re.search(r"to my (.+?) playlist", t)
        pl = m.group(1).strip().title() if m else "Chill"
        # if also play request, add both
        if found_moods or genre or lang:
            params = {}
            if found_moods: params["mood"] = found_moods[0]
            if lang: params["language"] = lang
            if genre: params["genre"] = genre
            if vibes: params["vibe"] = vibes
            # exclude sad
            if "don't play sad" in t or "dont play sad" in t or "not sad" in t:
                params["exclude_mood"] = ["SAD"]
            actions.append({"action": "PLAY_BY_MOOD", "parameters": params})
        actions.append({"action": "ADD_TO_PLAYLIST", "parameters": {"playlist": pl, "target": "FIRST_RESULT"}})
        return {"actions": actions, "response": f"Playing and adding first result to {pl} playlist."}

    if "queue" in t and "add" in t:
        return {"actions": [{"action": "ADD_TO_QUEUE", "parameters": {"target": "CURRENT_SONG"}}], "response": "Adding current song to queue."}

    # play by mood dominates
    if found_moods or lang or genre or vibes:
        params = {}
        if found_moods: params["mood"] = found_moods[0]
        if lang: params["language"] = lang
        if genre: params["genre"] = genre
        if vibes: params["vibe"] = vibes
        if "don't play sad" in t or "dont play sad" in t:
            params["exclude_mood"] = ["SAD"]
        # energetic override for "more energetic"
        if "more energetic" in t and context and context.get("lastMood"):
            params["mood"] = "ENERGETIC"
            params["based_on"] = "CURRENT_CONTEXT"
        return {"actions": [{"action": "PLAY_BY_MOOD", "parameters": params}], "response": "Playing matching songs."}

    if "similar" in t and "this" in t:
        return {"actions": [{"action": "PLAY_SIMILAR", "parameters": {"source": "CURRENT_SONG"}}], "response": "Playing similar songs."}

    # Artist aliases - handles "ani", "anirudh", "yuvan", "arr", "hiphop", etc. without needing "by"
    ARTIST_ALIASES = {
        "ani": "Anirudh", "anirudh": "Anirudh", "anirudh ravichander": "Anirudh",
        "yuvan": "Yuvan", "yuvan shankar": "Yuvan", "yuvan shankar raja": "Yuvan",
        "arr": "A R Rahman", "a r rahman": "A R Rahman", "rahman": "A R Rahman",
        "hiphop": "Hiphop Tamizha", "hip hop tamizha": "Hiphop Tamizha", "hiphop tamizha": "Hiphop Tamizha",
        "gv prakash": "G V Prakash", "gv": "G V Prakash",
        "dhanush": "Dhanush", "sid sriram": "Sid Sriram",
        "shreya": "Shreya Ghoshal", "arjit": "Arijit Singh", "arijit": "Arijit Singh",
    }
    for alias, canonical in ARTIST_ALIASES.items():
        if alias in t:
            # "ani song", "yuvan songs", "hiphop tamizha songs" -> SEARCH_ARTIST
            # Also handle "play ani", "ani songs" - detect alias even without "by"
            # If request also has play -> use SEARCH_ARTIST, frontend will play top result
            if "song" in t or "play" in t or "music" in t or alias in t:
                return {"actions": [{"action": "SEARCH_ARTIST", "parameters": {"artist": canonical}}], "response": f"Searching for {canonical}."}

    if "search" in t or "by" in t:
        # "Play songs by Anirudh" -> SEARCH_ARTIST
        m = re.search(r"by\s+([a-zA-Z0-9 ]+)", t)
        if m:
            artist = m.group(1).strip().title()
            # Map alias if matched
            low = artist.lower()
            if low in ARTIST_ALIASES:
                artist = ARTIST_ALIASES[low]
            return {"actions": [{"action": "SEARCH_ARTIST", "parameters": {"artist": artist}}], "response": f"Searching for {artist}."}
        # "search anirudh" without by
        m2 = re.search(r"search\s+([a-zA-Z0-9 ]+)", t)
        if m2:
            artist = m2.group(1).strip().title()
            return {"actions": [{"action": "SEARCH_ARTIST", "parameters": {"artist": artist}}], "response": f"Searching for {artist}."}

    # "play <artist>" without by - e.g., "play anirudh", "play yuvan hits"
    for alias, canonical in ARTIST_ALIASES.items():
        if t.strip() == alias or t.startswith(alias + " ") or ("play" in t and alias in t):
            return {"actions": [{"action": "SEARCH_ARTIST", "parameters": {"artist": canonical}}], "response": f"Searching for {canonical}."}

    # fallback clarification - be helpful
    return {"actions": [], "response": "", "clarificationNeeded": True, "clarificationQuestion": "Try: 'Play calm Tamil songs', 'Anirudh songs', 'Next song', 'Pause', or 'Like this song'"}

def understand(text: str, context=None) -> dict:
    """
    Main entry: text -> {actions, response, clarificationNeeded?}
    Tries real Qwen if configured, else mock.
    """
    # 1. Simple detector bypass (no LLM)
    simple = _simple_detect(text)
    if simple:
        return {"actions": simple, "response": f"{simple[0]['action'].title()} executed.", "clarificationNeeded": False}

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
            # find json block
            m = re.search(r"\{.*\}", gen, re.S)
            if m:
                j = json.loads(m.group(0))
                # validate actions exist
                if "actions" in j:
                    return j
            return _mock_understand(text, context)
        except Exception as e:
            print(f"[LLM] inference failed: {e}")
            return _mock_understand(text, context)

    if AI_MODE == "hf_api":
        # Call HuggingFace Inference API
        import httpx
        try:
            headers = {"Authorization": f"Bearer {HF_TOKEN}"} if HF_TOKEN else {}
            prompt = SYSTEM_PROMPT + "\n\nUser: " + text + "\n\nAssistant JSON:"
            r = httpx.post(f"https://api-inference.huggingface.co/models/{QWEN_MODEL}",
                           headers=headers, json={"inputs": prompt, "parameters": {"max_new_tokens": 512, "temperature": 0.2}}, timeout=30)
            r.raise_for_status()
            gen = r.json()[0].get("generated_text", "") if isinstance(r.json(), list) else r.json().get("generated_text", "")
            m = re.search(r"\{.*\}", gen, re.S)
            if m:
                return json.loads(m.group(0))
            return _mock_understand(text, context)
        except Exception as e:
            print(f"[LLM HF] failed: {e}")
            return _mock_understand(text, context)

    return _mock_understand(text, context)

def health():
    qwen_ok = False
    if AI_MODE == "mock":
        qwen_ok = True  # mock always ok
    elif AI_MODE == "transformers":
        qwen_ok = _qwen_pipeline is not None
    try:
        import torch
        device = "cuda" if torch.cuda.is_available() else "cpu"
        if AI_MODE == "mock":
            device = "mock"
    except:
        device = "mock" if AI_MODE == "mock" else "cpu"
    return {"qwen_loaded": qwen_ok, "qwen_model": QWEN_MODEL, "device": device}
