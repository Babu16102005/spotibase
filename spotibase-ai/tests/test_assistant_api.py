"""SpotiBase AI assistance API — QA suite (TestAgent).

Covers per workflow spec:
- FastAPI POST /assistant/understand:
    play calm Tamil -> PLAY_BY_MOOD, ani hits -> SEARCH_ARTIST(Anirudh),
    next -> NEXT bypass, unknown -> clarification + 3 suggestions
- POST /speech/voice with transcript_fallback (mock STT)
- GET /health
- Spring POST /api/v1/ai/text|voice contract {transcript,actions,response,results}
- SearchService top-5 voice path contract
- Redis cache hit / degrade
- validation paths, edge cases, failure behavior
"""
import io
import json
import os

os.environ.setdefault("AI_MODE", "mock")
os.environ.setdefault("STT_MODE", "mock")

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import llm_service, cache_service

client = TestClient(app)


# ---------------------------------------------------------------- helpers
def understand(text, context=None):
    body = {"text": text}
    if context is not None:
        body["context"] = context
    return client.post("/assistant/understand", json=body)


def voice(transcript_fallback=None, audio_bytes=b"fake-audio", filename="audio.webm",
          context=None, content_type="audio/webm"):
    files = {"audio": (filename, io.BytesIO(audio_bytes), content_type)}
    data = {}
    if transcript_fallback is not None:
        data["transcript_fallback"] = transcript_fallback
    if context is not None:
        data["context"] = json.dumps(context) if isinstance(context, dict) else context
    return client.post("/speech/voice", files=files, data=data)


@pytest.fixture(autouse=True)
def no_redis():
    """Isolate tests from a real Redis: force uncached mode unless a test opts in."""
    orig_client, orig_disabled = cache_service._client, cache_service._disabled
    cache_service._client = None
    cache_service._disabled = True
    yield
    cache_service._client, cache_service._disabled = orig_client, orig_disabled


# ================================================================ GET /health
class TestHealth:
    def test_health_ok(self):
        r = client.get("/health")
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "ok"
        assert body["qwen_loaded"] is True  # mock mode always ok
        assert body["whisper_loaded"] is True  # mock mode ok
        assert "qwen_model" in body and body["qwen_model"]
        assert "device" in body

    def test_ready(self):
        r = client.get("/ready")
        assert r.status_code == 200
        assert r.json() == {"ready": True}

    def test_root_lists_contract_routes(self):
        r = client.get("/")
        assert r.status_code == 200
        body = r.json()
        assert body["assistant"] == "/assistant/understand"
        assert body["voice"] == "/speech/voice"
        assert body["health"] == "/health"


# ================================================================ /assistant/understand — golden paths
class TestUnderstandGolden:
    def test_play_calm_tamil_is_play_by_mood(self):
        r = understand("play calm Tamil songs")
        assert r.status_code == 200
        body = r.json()
        assert body["clarificationNeeded"] is False
        assert len(body["actions"]) == 1
        assert body["actions"][0]["action"] == "PLAY_BY_MOOD"
        params = body["actions"][0]["parameters"]
        assert params.get("mood") == "CALM"
        assert params.get("language") == "TAMIL"
        # contract fields present
        assert body["parsedKeywords"]["mood"] == "CALM"
        assert body["parsedKeywords"]["language"] == "TAMIL"
        assert body["searchQuery"]
        assert body["displayText"]
        assert body["response"]

    def test_stressed_calm_tamil_excludes_sad(self):
        r = understand("I'm stressed today. Play calm Tamil songs. Don't play sad songs.")
        assert r.status_code == 200
        body = r.json()
        assert body["actions"][0]["action"] == "PLAY_BY_MOOD"
        assert body["actions"][0]["parameters"].get("exclude_mood") == ["SAD"]

    def test_ani_hits_resolves_artist_alias(self):
        r = understand("play ani hits")
        assert r.status_code == 200
        body = r.json()
        assert body["actions"][0]["action"] == "SEARCH_ARTIST"
        assert body["actions"][0]["parameters"]["artist"] == "Anirudh"
        assert body["parsedKeywords"]["artist"] == "Anirudh"

    def test_anirudh_typo_tolerant(self):
        r = understand("play aniruth hits")
        assert r.status_code == 200
        assert r.json()["actions"][0]["parameters"]["artist"] == "Anirudh"

    def test_next_bypasses_llm(self):
        for cmd in ["next", "Next", "  next  ", "skip", "next song"]:
            r = understand(cmd)
            assert r.status_code == 200, cmd
            body = r.json()
            assert body["actions"][0]["action"] == "NEXT", cmd
            assert body["clarificationNeeded"] is False
            assert body["searchQuery"] == ""  # controls carry no search semantics

    def test_unknown_returns_clarification_plus_3_suggestions(self):
        r = understand("xyzqw blarg flimflam")
        assert r.status_code == 200
        body = r.json()
        assert body["clarificationNeeded"] is True
        assert body["actions"] == []
        assert body["clarificationQuestion"]
        assert isinstance(body["suggestions"], list) and len(body["suggestions"]) == 3
        assert body["suggestions"] == list(llm_service.CLARIFICATION_SUGGESTIONS)

    def test_play_song_by_artist_explicit(self):
        r = understand("play Munbe Vaa by A R Rahman")
        assert r.status_code == 200
        body = r.json()
        assert body["actions"][0]["action"] == "SEARCH_SONG"
        assert body["actions"][0]["parameters"]["artist"] == "A R Rahman"

    def test_complex_two_actions_play_plus_playlist(self):
        r = understand(
            "I'm stressed. Give me calm Tamil songs, prefer dreamy, "
            "and add the first song to my Chill playlist."
        )
        assert r.status_code == 200
        body = r.json()
        actions = [a["action"] for a in body["actions"]]
        assert actions == ["PLAY_BY_MOOD", "ADD_TO_PLAYLIST"]
        assert body["actions"][1]["parameters"]["playlist"] == "Chill"
        assert body["actions"][1]["parameters"]["target"] == "FIRST_RESULT"

    def test_contextual_more_energetic_uses_last_mood(self):
        r = understand(
            "Actually make it more energetic.",
            context={"lastMood": "CALM", "playing": True, "queueSize": 3},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["actions"][0]["parameters"]["mood"] == "ENERGETIC"
        assert body["actions"][0]["parameters"]["based_on"] == "CURRENT_CONTEXT"

    def test_90s_melodies_decade_query(self):
        r = understand("play 90s melodies")
        assert r.status_code == 200
        body = r.json()
        assert body["actions"][0]["action"] == "SEARCH_SONG"
        assert "90s" in body["searchQuery"]

    def test_similar_to_this(self):
        r = understand("play something similar to this")
        assert r.status_code == 200
        body = r.json()
        assert body["actions"][0]["action"] == "PLAY_SIMILAR"
        assert body["actions"][0]["parameters"]["source"] == "CURRENT_SONG"


# ================================================================ validation / edge cases
class TestUnderstandValidation:
    def test_empty_string_rejected_422(self):
        r = understand("")
        assert r.status_code == 422

    def test_missing_text_rejected_422(self):
        r = client.post("/assistant/understand", json={})
        assert r.status_code == 422

    def test_null_text_rejected_422(self):
        r = client.post("/assistant/understand", json={"text": None})
        assert r.status_code == 422

    def test_oversize_text_rejected_422(self):
        r = understand("x" * 2001)
        assert r.status_code == 422

    def test_max_length_boundary_accepted(self):
        r = understand("play " + "a" * 1990)  # ~1995 chars, within 2000
        assert r.status_code == 200

    def test_whitespace_only_clarifies_not_500(self):
        r = understand("   ")
        assert r.status_code == 200
        assert r.json()["clarificationNeeded"] is True

    def test_special_chars_do_not_crash(self):
        r = understand("play \U0001f3b5 >}} <script>alert(1)</script> \"';--")
        assert r.status_code == 200
        assert "actions" in r.json()

    def test_like_current_simple_bypass(self):
        r = understand("like this song")
        # "like this song" is not in SIMPLE_PATTERNS ("like this"/"like") -> may go LLM path;
        # either LIKE_CURRENT or clarification-free response is acceptable, never 500
        assert r.status_code == 200

    def test_pause_resume_previous_bypass(self):
        for text, expected in [("pause", "PAUSE"), ("resume", "RESUME"),
                               ("previous", "PREVIOUS"), ("like", "LIKE_CURRENT")]:
            r = understand(text)
            assert r.status_code == 200, text
            assert r.json()["actions"][0]["action"] == expected, text

    def test_hallucinated_action_becomes_clarification(self, monkeypatch):
        monkeypatch.setattr(
            llm_service, "understand",
            lambda text, ctx=None: {"actions": [{"action": "DELETE_EVERYTHING", "parameters": {}}],
                                    "response": "evil", "parsedKeywords": None,
                                    "searchQuery": "x", "displayText": "evil"},
        )
        r = understand("do something weird")
        assert r.status_code == 200
        body = r.json()
        assert body["actions"] == []
        assert body["clarificationNeeded"] is True
        assert len(body["suggestions"]) == 3

    def test_all_actions_in_allowlist(self):
        """Every action the mock can emit must be in the 32-action allow-list."""
        samples = ["play calm songs", "play ani hits", "next", "pause",
                   "play something similar to this", "add this song to my queue",
                   "add this to my Chill playlist", "play rock songs", "tamil songs"]
        for s in samples:
            body = understand(s).json()
            for a in body["actions"]:
                assert a["action"] in llm_service.ALLOWED_ACTIONS, (s, a)


# ================================================================ /speech/voice
class TestVoice:
    def test_voice_with_transcript_fallback_mood(self):
        r = voice(transcript_fallback="play calm Tamil songs")
        assert r.status_code == 200
        body = r.json()
        assert body["actions"][0]["action"] == "PLAY_BY_MOOD"
        assert body["clarificationNeeded"] is False

    def test_voice_fallback_artist_alias(self):
        r = voice(transcript_fallback="play ani hits")
        assert r.status_code == 200
        assert r.json()["actions"][0]["parameters"]["artist"] == "Anirudh"

    def test_voice_fallback_next_bypass(self):
        r = voice(transcript_fallback="next")
        assert r.status_code == 200
        assert r.json()["actions"][0]["action"] == "NEXT"

    def test_voice_no_transcript_clarifies(self):
        r = voice()  # mock STT returns "" and no fallback
        assert r.status_code == 200
        body = r.json()
        assert body["actions"] == []
        assert body["clarificationNeeded"] is True
        assert "couldn't hear" in body["clarificationQuestion"].lower()

    def test_voice_oversize_audio_clarifies(self):
        big = b"x" * (15 * 1024 * 1024 + 1)
        r = voice(transcript_fallback="play calm songs", audio_bytes=big)
        assert r.status_code == 200
        body = r.json()
        assert body["clarificationNeeded"] is True
        assert "too large" in body["clarificationQuestion"].lower()

    def test_voice_bad_context_json_ignored(self):
        files = {"audio": ("audio.webm", io.BytesIO(b"fake"), "audio/webm")}
        data = {"transcript_fallback": "play calm Tamil songs", "context": "{not-json"}
        r = client.post("/speech/voice", files=files, data=data)
        assert r.status_code == 200
        assert r.json()["actions"][0]["action"] == "PLAY_BY_MOOD"

    def test_voice_valid_context_json(self):
        r = voice(transcript_fallback="make it more energetic",
                  context={"lastMood": "CALM", "playing": True, "queueSize": 1})
        assert r.status_code == 200
        assert r.json()["actions"][0]["parameters"]["mood"] == "ENERGETIC"

    def test_transcribe_mock_returns_empty(self):
        files = {"audio": ("audio.webm", io.BytesIO(b"fake-audio"), "audio/webm")}
        r = client.post("/speech/transcribe", files=files)
        assert r.status_code == 200
        assert r.json()["transcript"] == ""

    def test_transcribe_oversize_returns_error(self):
        big = b"x" * (15 * 1024 * 1024 + 1)
        files = {"audio": ("audio.webm", io.BytesIO(big), "audio/webm")}
        r = client.post("/speech/transcribe", files=files)
        assert r.status_code == 200
        assert "too large" in r.json()["error"].lower()


# ================================================================ /speech/partial (realtime)
class TestPartial:
    """Realtime partial preview: text-in, no STT, SEARCH-only, <500ms."""

    def _partial(self, text, context=None):
        body = {"text": text}
        if context is not None:
            body["context"] = context
        return client.post("/speech/partial", json=body)

    def test_partial_artist_alias_is_search_only(self):
        import time
        t0 = time.perf_counter()
        r = self._partial("play ani hits")
        ms = (time.perf_counter() - t0) * 1000
        assert r.status_code == 200
        body = r.json()
        assert body["clarificationNeeded"] is False
        assert body["actions"][0]["action"] == "SEARCH_ARTIST"
        assert body["actions"][0]["parameters"]["artist"] == "Anirudh"
        assert ms < 500, f"partial budget exceeded: {ms:.1f}ms"

    def test_partial_mood_maps_to_search_only_or_clarifies(self):
        # PLAY_BY_MOOD must never leak into a read-only preview: either it is
        # dropped (200 clarification + searchQuery preserved) or, if the
        # understand path emits a SEARCH action, only SEARCH passes.
        r = self._partial("play calm Tamil songs")
        assert r.status_code == 200
        body = r.json()
        for a in body["actions"]:
            assert a["action"] in {"SEARCH_SONG", "SEARCH_ARTIST", "SEARCH_ALBUM"}
        assert body["searchQuery"]  # caller can still render a preview

    def test_partial_control_action_never_passes(self):
        for text in ["next", "add this song to my queue", "like this", "pause"]:
            r = self._partial(text)
            assert r.status_code == 200, text
            body = r.json()
            for a in body["actions"]:
                assert a["action"] in {"SEARCH_SONG", "SEARCH_ARTIST", "SEARCH_ALBUM"}, (text, a)

    def test_partial_empty_rejected_422(self):
        r = self._partial("")
        assert r.status_code == 422

    def test_partial_whitespace_clarifies_not_500(self):
        r = self._partial("   ")
        assert r.status_code == 200
        assert r.json()["clarificationNeeded"] is True

    def test_partial_unknown_clarifies_with_suggestions(self):
        r = self._partial("xyzqw blarg flimflam")
        assert r.status_code == 200
        body = r.json()
        assert body["clarificationNeeded"] is True
        assert isinstance(body["suggestions"], list) and len(body["suggestions"]) >= 3

    def test_partial_repeat_uses_cache(self, monkeypatch):
        calls = []
        orig = llm_service._understand_uncached
        monkeypatch.setattr(llm_service, "_understand_uncached",
                            lambda *a, **k: calls.append(1) or orig(*a, **k))
        store = {}

        class Fake:
            def get(self, k):
                import json as j
                v = store.get(k)
                return j.dumps(v).encode() if v is not None else None

            def setex(self, k, ttl, v):
                import json as j
                store[k] = j.loads(v)

            def ping(self):
                return True

        monkeypatch.setattr(cache_service, "_client", Fake())
        monkeypatch.setattr(cache_service, "_disabled", False)
        try:
            assert self._partial("play ani hits").status_code == 200
            first_calls = len(calls)
            assert self._partial("play ani hits").status_code == 200
            # second identical call must come from Redis (no uncached recompute)
            assert len(calls) == first_calls
        finally:
            monkeypatch.setattr(cache_service, "_client", None)
            monkeypatch.setattr(cache_service, "_disabled", True)

    def test_partial_no_stt_side_effects(self, monkeypatch):
        called = []
        monkeypatch.setattr("app.routes.speech.stt_service.transcribe",
                            lambda *a, **k: called.append(1) or "")
        r = self._partial("play ani hits")
        assert r.status_code == 200
        assert called == []  # partial path never touches STT


# ================================================================ Redis cache
class TestRedisCache:
    def test_understand_key_stable_and_normalized(self):
        k1 = cache_service.understand_key("  Play CALM songs ", "mock", None)
        k2 = cache_service.understand_key("play calm songs", "mock", None)
        assert k1 == k2
        k3 = cache_service.understand_key("play calm songs", "mock", {"a": 1})
        assert k3 != k1  # context participates

    def test_cache_hit_skips_llm(self, monkeypatch):
        cached = {"actions": [{"action": "NEXT", "parameters": {}}],
                  "response": "cached", "clarificationNeeded": False,
                  "parsedKeywords": None, "searchQuery": "", "displayText": "cached"}
        monkeypatch.setattr(cache_service, "get_understand", lambda *a: cached)
        called = []
        monkeypatch.setattr(llm_service, "_understand_uncached",
                            lambda *a, **k: called.append(1) or cached)
        out = llm_service.understand("next")
        assert out == cached
        assert called == []  # LLM never invoked

    def test_clarifications_not_cached(self, monkeypatch):
        saved = []
        monkeypatch.setattr(cache_service, "get_understand", lambda *a: None)
        monkeypatch.setattr(cache_service, "put_understand",
                            lambda *a: saved.append(1))
        out = llm_service.understand("xyzqw blarg flimflam")
        assert out["clarificationNeeded"] is True
        assert saved == []

    def test_redis_down_degrades_to_uncached(self, monkeypatch):
        monkeypatch.setattr(cache_service, "_get_client", lambda: (_ for _ in ()).throw(
            ConnectionError("redis down")))
        # must not raise; mock path still answers
        out = llm_service.understand("play calm Tamil songs")
        assert out["actions"][0]["action"] == "PLAY_BY_MOOD"

    def test_fake_redis_roundtrip(self, monkeypatch):
        store = {}

        class Fake:
            def get(self, k):
                import json as j
                v = store.get(k)
                return j.dumps(v).encode() if v is not None else None

            def setex(self, k, ttl, v):
                import json as j
                store[k] = j.loads(v)
                assert ttl in (300, 600)

            def ping(self):
                return True

        monkeypatch.setattr(cache_service, "_client", Fake())
        monkeypatch.setattr(cache_service, "_disabled", False)
        res = {"actions": [{"action": "NEXT", "parameters": {}}], "response": "x",
               "clarificationNeeded": False}
        cache_service.put_understand("NeXt", "mock", None, res)
        assert cache_service.get_understand("next", "mock", None) == res


# ================================================================ Spring contract (static)
class TestSpringContract:
    """Spring Boot is not booted here; assert the wire contract files honor it so
    mobile <-> Spring <-> FastAPI stays compatible."""

    REPO = __import__("pathlib").Path(__file__).resolve().parents[2]

    def _read(self, rel):
        return (self.REPO / rel).read_text(encoding="utf-8")

    def test_assistant_response_has_mobile_contract_fields(self):
        src = self._read("backend/src/main/java/com/spotibase/ai/dto/AssistantResponse.java")
        for field in ["transcript", "actions", "response", "results",
                      "clarificationNeeded", "clarificationQuestion"]:
            assert field in src, f"missing AssistantResponse.{field}"

    def test_controller_exposes_text_voice_health(self):
        src = self._read("backend/src/main/java/com/spotibase/ai/controller/AssistantController.java")
        assert '"/text"' in src
        assert '"/voice"' in src
        assert '"/voice-partial"' in src
        assert '"/health"' in src
        assert "transcript_fallback" in src
        assert "PAYLOAD_TOO_LARGE" in src  # 15MB guard mirrors FastAPI
        assert "Missing audio file" in src

    def test_qwen_client_calls_fastapi_paths(self):
        src = self._read("backend/src/main/java/com/spotibase/ai/service/QwenClient.java")
        assert '"/assistant/understand"' in src
        assert '"/speech/voice"' in src
        assert '"/speech/partial"' in src
        assert "understandVoicePartialText" in src
        assert "PARTIAL_TIMEOUT" in src
        assert "transcript_fallback" in src

    def test_voice_partial_is_readonly_preview(self):
        svc = self._read("backend/src/main/java/com/spotibase/ai/service/AssistantService.java")
        assert "handleVoicePartial" in svc
        assert "PARTIAL_ALLOWED" in svc
        assert "searchSongsForVoice" in svc
        ctrl = self._read("backend/src/main/java/com/spotibase/ai/controller/AssistantController.java")
        assert "VoicePartialResponse" in ctrl
        assert "actionsPreview" in ctrl or "actions_preview" in ctrl or "ActionsPreview" in ctrl
        dto = self._read("backend/src/main/java/com/spotibase/ai/dto/VoicePartialResponse.java")
        for field in ["actionsPreview", "suggestions", "songs",
                      "clarificationNeeded", "clarificationQuestion"]:
            assert field in dto, f"missing VoicePartialResponse.{field}"

    def test_search_voice_path_is_top5(self):
        src = self._read("backend/src/main/java/com/spotibase/service/SearchService.java")
        assert "searchSongsForVoice" in src
        assert "getSuggestionsForVoice" in src
        assert "0, 5" in src  # page 0, size 5 -> top-5 for assistant dispatch

    def test_simple_detector_covers_next_bypass(self):
        src = self._read("backend/src/main/java/com/spotibase/ai/service/SimpleCommandDetector.java")
        assert "NEXT" in src and "next" in src.lower()
