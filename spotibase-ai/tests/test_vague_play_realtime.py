"""Vague play-intent realtime NLU — AIIntegrationAgent.

Vague play commands must ALWAYS yield a play-family action realtime, never a
clarification and never an empty mock fallback:

  - "play some Tamil songs" -> PLAY_BY_LANGUAGE {language: TAMIL}
  - "play any song"         -> PLAY_RANDOM {}
  - "play something nice"   -> PLAY_RANDOM {}
  - "play me a song"        -> PLAY_RANDOM {}  (was: clarification)

Mirrors the CF system-prompt rule (app/prompts/assistant_system.txt):
any play/listen/enjoy request + any other word -> closest PLAY_* action,
leftover words into query/parameters (politeness stripped).

Guards (unchanged):
  - bare "play" -> RESUME
  - "like this" / "like" -> LIKE_CURRENT
  - non-play gibberish ("xyzqw blarg flimflam") -> clarification
"""
import os
from pathlib import Path

os.environ.setdefault("AI_MODE", "mock")
os.environ.setdefault("STT_MODE", "mock")

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import llm_service as L
from app.services import cache_service

client = TestClient(app)

PLAY_FAMILY = {
    "PLAY", "PLAY_SONG", "SEARCH_SONG", "SEARCH_ARTIST", "SEARCH_ALBUM",
    "PLAY_BY_MOOD", "PLAY_BY_GENRE", "PLAY_BY_LANGUAGE", "PLAY_SIMILAR",
    "PLAY_RANDOM", "PLAY_LIKED",
}


@pytest.fixture(autouse=True)
def no_redis():
    orig_client, orig_disabled = cache_service._client, cache_service._disabled
    cache_service._client = None
    cache_service._disabled = True
    yield
    cache_service._client, cache_service._disabled = orig_client, orig_disabled


def mock_action_of(text):
    r = L._mock_understand(text)
    assert r["clarificationNeeded"] is False, (text, r)
    assert len(r["actions"]) >= 1, (text, r)
    return r


class TestVaguePlayProbes:
    def test_play_some_tamil_songs_is_language(self):
        r = mock_action_of("play some Tamil songs")
        assert r["actions"][0]["action"] == "PLAY_BY_LANGUAGE"
        assert r["actions"][0]["parameters"].get("language") == "TAMIL"

    def test_play_any_song_is_random(self):
        r = mock_action_of("play any song")
        assert r["actions"][0]["action"] == "PLAY_RANDOM"
        assert r["actions"][0]["parameters"] == {}
        assert r["searchQuery"] == ""

    def test_play_something_nice_is_random(self):
        r = mock_action_of("play something nice")
        assert r["actions"][0]["action"] == "PLAY_RANDOM"
        assert r["actions"][0]["parameters"] == {}
        assert r["searchQuery"] == ""

    def test_play_me_a_song_is_random_not_clarification(self):
        # Regression: mock used to return clarification (empty actions, sq "a").
        r = mock_action_of("play me a song")
        assert r["actions"][0]["action"] == "PLAY_RANDOM"
        assert r["actions"][0]["parameters"] == {}
        assert r["searchQuery"] == ""


class TestVaguePlayVariants:
    @pytest.mark.parametrize("text", [
        "play a song",
        "play me songs",
        "play songs",
        "play music",
        "play me something nice please",
        "listen to some Tamil songs",
        "enjoy some music",
    ])
    def test_variants_never_clarify(self, text):
        r = L._mock_understand(text)
        assert r["clarificationNeeded"] is False, (text, r)
        assert len(r["actions"]) >= 1, (text, r)
        assert r["actions"][0]["action"] in PLAY_FAMILY, (text, r)

    def test_polite_nice_songs_searches(self):
        r = mock_action_of("please play some nice songs")
        assert r["actions"][0]["action"] == "SEARCH_SONG"
        assert "Nice" in r["actions"][0]["parameters"].get("query", "")

    def test_gibberish_play_still_plays(self):
        # Backend best-effort partial-match chain QUEUES the closest match;
        # AI side must emit a play-family action, never clarification.
        r = mock_action_of("play xyzqwerty nonexistent")
        assert r["actions"][0]["action"] in PLAY_FAMILY

    def test_listen_tamil_is_language(self):
        r = mock_action_of("listen to some Tamil songs")
        assert r["actions"][0]["action"] == "PLAY_BY_LANGUAGE"


class TestVaguePlayGuards:
    def test_bare_play_stays_resume(self):
        r = L._mock_understand("play")
        assert [a["action"] for a in r["actions"]] == ["RESUME"]

    @pytest.mark.parametrize("text", ["like this", "like"])
    def test_like_stays_like_current(self, text):
        r = L._mock_understand(text)
        assert [a["action"] for a in r["actions"]] == ["LIKE_CURRENT"]

    def test_non_play_gibberish_still_clarifies(self):
        r = L._mock_understand("xyzqw blarg flimflam")
        assert r["clarificationNeeded"] is True
        assert r["actions"] == []

    def test_precise_meanings_kept(self):
        r = L._mock_understand("play Something by Anirudh")
        assert r["actions"][0]["action"] == "SEARCH_SONG"
        r = L._mock_understand("play something similar to this")
        assert r["actions"][0]["action"] == "PLAY_SIMILAR"


class TestCFPromptRule:
    PROMPT = Path(__file__).resolve().parents[1] / "app" / "prompts" / "assistant_system.txt"

    def test_prompt_has_play_intent_rule(self):
        src = self.PROMPT.read_text(encoding="utf-8")
        assert "Play-intent rule" in src
        assert "CLARIFICATION_NEEDED" in src
        assert "play / listen / enjoy" in src
        assert "PLAY_RANDOM" in src
        assert 'bare "play" alone stays RESUME' in src
        assert '"like this"' in src


class TestCFPathVague:
    def test_cf_empty_falls_back_to_play_random(self):
        # Live failure shape for "play something nice": CF 200 with empty
        # generation (chars=0) -> mock fallback must still play realtime.
        orig_mode, orig_call = L.AI_MODE, L._call_cf_workers
        L.AI_MODE = "cf_workers"
        L._call_cf_workers = lambda messages: ""
        try:
            r = L._understand_uncached("play me a song")
        finally:
            L.AI_MODE, L._call_cf_workers = orig_mode, orig_call
        assert r["clarificationNeeded"] is False
        assert r["actions"][0]["action"] == "PLAY_RANDOM"

    def test_cf_random_junk_query_enforced_empty(self):
        orig_mode, orig_call = L.AI_MODE, L._call_cf_workers
        L.AI_MODE = "cf_workers"
        L._call_cf_workers = lambda messages: (
            '{"actions": [{"action": "PLAY_RANDOM", "parameters": {}}], '
            '"response": "Playing a random song.", "searchQuery": "a"}'
        )
        try:
            r = L._understand_uncached("play me a song")
        finally:
            L.AI_MODE, L._call_cf_workers = orig_mode, orig_call
        assert r["actions"][0]["action"] == "PLAY_RANDOM"
        assert r["searchQuery"] == ""


class TestVaguePlayAPI:
    @pytest.mark.parametrize("text", [
        "play some Tamil songs",
        "play any song",
        "play something nice",
        "play me a song",
    ])
    def test_api_probes_never_clarify(self, text):
        r = client.post("/assistant/understand", json={"text": text})
        assert r.status_code == 200, text
        body = r.json()
        assert body["clarificationNeeded"] is False, (text, body)
        assert len(body["actions"]) >= 1, (text, body)
        assert body["actions"][0]["action"] in PLAY_FAMILY, (text, body)
