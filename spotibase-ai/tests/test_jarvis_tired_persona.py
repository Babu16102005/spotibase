"""Jarvis persona + tired-care NLU — AIIntegrationAgent.

Covers:
- tired/exhausted/drained/worn out/long day -> PLAY_BY_MOOD HAPPY + caring Jarvis reply
- "hey jarvis" / "ok jarvis" prefix stripped before understanding (both paths)
- Persona tone: every key mock reply calls user "boss", short spoken-style, reflects action
- CF prompt contains JARVIS persona + tired-care + wake-word rules
"""
import os
from pathlib import Path

os.environ.setdefault("AI_MODE", "mock")
os.environ.setdefault("STT_MODE", "mock")

from app.services import llm_service as L


def mock_of(text):
    return L._mock_understand(text)


class TestTiredVariants:
    def test_tired_maps_happy_caring(self):
        for t in [
            "i feel tired",
            "hey jarvis, i feel tired",
            "I'm exhausted",
            "feeling drained after work",
            "worn out",
            "had a long day",
            "I had a long day, play something",
        ]:
            r = mock_of(t)
            assert r["clarificationNeeded"] is False, (t, r)
            assert r["actions"][0]["action"] == "PLAY_BY_MOOD", (t, r)
            assert r["actions"][0]["parameters"].get("mood") == "HAPPY", (t, r)
            resp = (r.get("response") or "").lower()
            assert "boss" in resp, (t, r)
            # care word + action word
            assert any(w in resp for w in ["rest", "take care", "feel better", "lift"]), (t, r)
            assert any(w in resp for w in ["play", "feel-good", "feel good", "songs"]), (t, r)

    def test_tired_mood_map_entries(self):
        for k in ["tired", "exhausted", "drained", "worn out", "long day"]:
            assert L.MOOD_MAP.get(k) == "HAPPY", k

    def test_tired_never_clarifies(self):
        for t in ["i feel tired", "i'm exhausted", "worn out", "had a long day"]:
            r = mock_of(t)
            assert r["clarificationNeeded"] is False, (t, r)
            assert len(r["actions"]) >= 1, (t, r)


class TestWakePrefix:
    def test_hey_jarvis_tired_same_as_bare(self):
        a = mock_of("i feel tired")
        b = mock_of("hey jarvis, i feel tired")
        assert [x["action"] for x in a["actions"]] == [x["action"] for x in b["actions"]]
        assert a["actions"][0]["parameters"].get("mood") == "HAPPY"
        assert b["actions"][0]["parameters"].get("mood") == "HAPPY"

    def test_hey_jarvis_pause(self):
        for t in ["hey jarvis pause the music", "hey jarvis, pause", "ok jarvis pause the music", "jarvis pause"]:
            r = mock_of(t)
            assert r["actions"][0]["action"] == "PAUSE", (t, r)
            assert "boss" in (r.get("response") or "").lower(), (t, r)

    def test_ok_jarvis_tired(self):
        r = mock_of("ok jarvis, i feel tired")
        assert r["actions"][0]["action"] == "PLAY_BY_MOOD"
        assert r["actions"][0]["parameters"].get("mood") == "HAPPY"

    def test_strip_helper_idempotent(self):
        assert L._strip_jarvis_wake("hey jarvis, i feel tired").strip().lower() == "i feel tired"
        assert L._strip_jarvis_wake("ok jarvis pause the music").strip().lower() == "pause the music"
        assert L._strip_jarvis_wake("i feel tired").strip().lower() == "i feel tired"

    def test_cf_path_strips_wake(self):
        # CF empty generation falls back to mock, which must still strip wake + tired.
        orig_mode, orig_call = L.AI_MODE, L._call_cf_workers
        L.AI_MODE = "cf_workers"
        L._call_cf_workers = lambda messages: ""
        try:
            r = L._understand_uncached("hey jarvis, i feel tired")
        finally:
            L.AI_MODE, L._call_cf_workers = orig_mode, orig_call
        assert r["actions"][0]["action"] == "PLAY_BY_MOOD"
        assert r["actions"][0]["parameters"].get("mood") == "HAPPY"

    def test_uncached_strips_wake_for_simple(self):
        orig_mode = L.AI_MODE
        L.AI_MODE = "mock"
        try:
            r = L._understand_uncached("hey jarvis pause the music")
        finally:
            L.AI_MODE = orig_mode
        assert r["actions"][0]["action"] == "PAUSE"


class TestPersonaTone:
    def test_key_replies_call_boss(self):
        probes = {
            "pause the music": "PAUSE",
            "play any song": "PLAY_RANDOM",
            "play my liked songs": "PLAY_LIKED",
            "play calm Tamil songs": "PLAY_BY_MOOD",
            "i feel tired": "PLAY_BY_MOOD",
        }
        for text, expected in probes.items():
            r = mock_of(text)
            assert r["actions"][0]["action"] == expected, (text, r)
            resp = (r.get("response") or "")
            assert "boss" in resp.lower(), (text, r)
            # short spoken-style: 1-2 sentences (<=2 periods), no bullet lists
            assert resp.count("\n-") == 0, (text, r)
            assert len([s for s in resp.split(".") if s.strip()]) <= 2, (text, resp)
            # never robotic "executed."
            assert "executed" not in resp.lower(), (text, r)

    def test_tired_response_has_care_plus_action(self):
        r = mock_of("hey jarvis, i feel tired")
        resp = (r.get("response") or "").lower()
        assert "boss" in resp
        assert "rest" in resp
        assert "feel-good" in resp or "feel good" in resp
        assert "play" in resp


class TestCFPromptPersona:
    PROMPT = Path(__file__).resolve().parents[1] / "app" / "prompts" / "assistant_system.txt"

    def test_prompt_has_jarvis_persona(self):
        src = self.PROMPT.read_text(encoding="utf-8")
        assert "JARVIS" in src
        assert "boss" in src.lower()
        assert "1-2 sentences" in src or "short" in src.lower()
        assert "bullet" in src.lower()

    def test_prompt_has_tired_rule(self):
        src = self.PROMPT.read_text(encoding="utf-8").lower()
        assert "tired" in src
        assert "exhausted" in src
        assert "drained" in src
        assert "worn out" in src
        assert "long day" in src
        assert "play_by_mood" in src
        assert "happy" in src

    def test_prompt_has_wake_rule(self):
        src = self.PROMPT.read_text(encoding="utf-8").lower()
        assert "hey jarvis" in src
        assert "ok jarvis" in src
