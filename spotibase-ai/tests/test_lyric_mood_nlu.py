"""Lyric-line + feel-good mood NLU — AIIntegrationAgent.

Human-like AI:
  (1) user says ANY LINE of a song ("play that song which goes ...",
      "the song that says ...", "play the song ... lyrics ...", or a bare
      lyric line with/without leading play) -> SEARCH_SONG with the FULL
      lyric line preserved in query for the backend identification chain
      (local lyrics -> websearch -> library match). Only framing
      ("which goes", "song that says", "lyrics") is stripped; the lyric is
      never truncated to junk single words. Short exact titles unchanged.
  (2) "play feel good songs" (+ variants) -> PLAY_BY_MOOD HAPPY.

Mirrors CF system-prompt rules (app/prompts/assistant_system.txt):
  Lyric-identification rule + Mood-inference rule.
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


class TestMoodMapVariants:
    def test_feel_good_family_maps_happy(self):
        for k in ["feel good", "feel-good", "feelgood",
                  "makes me happy", "make me happy",
                  "uplifting", "cheerful"]:
            assert L.MOOD_MAP.get(k) == "HAPPY", k

    def test_generalized_synonyms_present(self):
        # canonical HAPPY/SAD/ENERGETIC/CALM/ROMANTIC/PARTY/FOCUSED coverage
        checks = {
            "upbeat": "HAPPY", "joyful": "HAPPY",
            "lonely": "SAD", "heartbreak": "SAD",
            "hype": "ENERGETIC", "pumped up": "ENERGETIC",
            "relaxing": "CALM", "mellow": "CALM",
            "romance": "ROMANTIC", "dance": "PARTY",
            "focus": "FOCUSED", "studying": "FOCUSED",
        }
        for k, v in checks.items():
            assert L.MOOD_MAP.get(k) == v, (k, v)


class TestFeelGoodMoodProbes:
    @pytest.mark.parametrize("text", [
        "play feel good songs",
        "play feel-good songs",
        "play feelgood songs",
        "play songs that make me happy",
        "play songs that makes me happy",
        "play uplifting songs",
        "play cheerful songs",
    ])
    def test_feel_good_variants_are_happy(self, text):
        r = mock_action_of(text)
        assert r["actions"][0]["action"] == "PLAY_BY_MOOD", (text, r)
        assert r["actions"][0]["parameters"].get("mood") == "HAPPY", (text, r)

    @pytest.mark.parametrize("text,mood", [
        ("play sad songs", "SAD"),
        ("play lonely songs", "SAD"),
        ("play energetic songs", "ENERGETIC"),
        ("play hype songs", "ENERGETIC"),
        ("play calm songs", "CALM"),
        ("play relaxing songs", "CALM"),
        ("play romantic songs", "ROMANTIC"),
        ("play dance songs", "PARTY"),
        ("play focused songs", "FOCUSED"),
    ])
    def test_generalized_moods(self, text, mood):
        r = mock_action_of(text)
        assert r["actions"][0]["action"] == "PLAY_BY_MOOD", (text, r)
        assert r["actions"][0]["parameters"].get("mood") == mood, (text, r)


class TestLyricLineProbes:
    def test_which_goes_english_quoted(self):
        r = mock_action_of('play that song which goes "hello from the other side"')
        assert r["actions"][0]["action"] == "SEARCH_SONG", r
        q = r["actions"][0]["parameters"].get("query", "")
        assert "hello from the other side" in q.lower(), (q, r)
        assert "hello from the other side" in (r["searchQuery"] or "").lower(), r
        # full line preserved, not junk single word
        assert len((r["searchQuery"] or "").split()) >= 4, r

    def test_that_says_tamil(self):
        r = mock_action_of("play the song that says neethane en ponvasantham")
        assert r["actions"][0]["action"] == "SEARCH_SONG", r
        q = r["actions"][0]["parameters"].get("query", "")
        assert "neethane en ponvasantham" in q.lower(), (q, r)
        assert "neethane en ponvasantham" in (r["searchQuery"] or "").lower(), r

    def test_lyrics_keyword_tamil(self):
        r = mock_action_of("play the song with lyrics munbe vaa en anbe vaa")
        assert r["actions"][0]["action"] == "SEARCH_SONG", r
        q = (r["actions"][0]["parameters"].get("query", "") or "").lower()
        assert "munbe vaa" in q, (q, r)
        assert len((r["searchQuery"] or "").split()) >= 4, r

    def test_bare_english_lyric_no_play(self):
        r = mock_action_of("hello from the other side")
        assert r["actions"][0]["action"] == "SEARCH_SONG", r
        assert "hello from the other side" in (r["searchQuery"] or "").lower(), r

    def test_bare_tamil_lyric_no_play(self):
        r = mock_action_of("kanmani anbodu kadhalan naan ezhuthum kadithame")
        assert r["actions"][0]["action"] == "SEARCH_SONG", r
        assert "kanmani anbodu" in (r["searchQuery"] or "").lower(), r

    def test_short_title_unchanged(self):
        r = mock_action_of("play shape of you")
        assert r["actions"][0]["action"] == "SEARCH_SONG", r
        assert "shape of you" in (r["searchQuery"] or "").lower(), r

    def test_lyric_never_clarifies(self):
        for t in [
            'play that song which goes "hello from the other side"',
            "play the song that says neethane en ponvasantham",
            "hello from the other side",
        ]:
            r = L._mock_understand(t)
            assert r["clarificationNeeded"] is False, (t, r)
            assert len(r["actions"]) >= 1, (t, r)


class TestLyricMoodGuards:
    def test_gibberish_still_clarifies(self):
        r = L._mock_understand("xyzqw blarg flimflam")
        assert r["clarificationNeeded"] is True
        assert r["actions"] == []

    def test_bare_play_stays_resume(self):
        r = L._mock_understand("play")
        assert [a["action"] for a in r["actions"]] == ["RESUME"]

    def test_mood_request_not_lyric(self):
        r = mock_action_of("play feel good songs")
        assert r["actions"][0]["action"] == "PLAY_BY_MOOD"
        assert r["actions"][0]["parameters"].get("mood") == "HAPPY"


class TestCFPromptRules:
    PROMPT = Path(__file__).resolve().parents[1] / "app" / "prompts" / "assistant_system.txt"

    def test_prompt_has_lyric_rule(self):
        src = self.PROMPT.read_text(encoding="utf-8")
        assert "Lyric-identification rule" in src
        assert "FULL lyric" in src or "FULL lyric line" in src
        assert "which goes" in src
        assert "song that says" in src
        assert "SEARCH_SONG" in src
        assert "websearch" in src.lower() or "web-search" in src.lower()

    def test_prompt_has_mood_rule(self):
        src = self.PROMPT.read_text(encoding="utf-8")
        assert "Mood-inference rule" in src
        assert "feelgood" in src
        assert "makes me happy" in src
        assert "uplifting" in src
        assert "PLAY_BY_MOOD" in src
        assert '{"mood": "HAPPY"}' in src or '"mood": "HAPPY"' in src


class TestCFPathLyricMood:
    def test_cf_empty_falls_back_to_lyric(self):
        orig_mode, orig_call = L.AI_MODE, L._call_cf_workers
        L.AI_MODE = "cf_workers"
        L._call_cf_workers = lambda messages: ""
        try:
            r = L._understand_uncached('play that song which goes "hello from the other side"')
        finally:
            L.AI_MODE, L._call_cf_workers = orig_mode, orig_call
        assert r["clarificationNeeded"] is False
        assert r["actions"][0]["action"] == "SEARCH_SONG"
        assert "hello from the other side" in (r["searchQuery"] or "").lower(), r

    def test_cf_empty_falls_back_to_happy(self):
        orig_mode, orig_call = L.AI_MODE, L._call_cf_workers
        L.AI_MODE = "cf_workers"
        L._call_cf_workers = lambda messages: ""
        try:
            r = L._understand_uncached("play feel good songs")
        finally:
            L.AI_MODE, L._call_cf_workers = orig_mode, orig_call
        assert r["actions"][0]["action"] == "PLAY_BY_MOOD"
        assert r["actions"][0]["parameters"].get("mood") == "HAPPY"

    def test_cf_search_query_backfill_prefers_lyric(self):
        # Live failure: CF returns correct query param but backfill invents
        # framing junk ("That Which Goes ...") for searchQuery. The lyric
        # contract fix forces both to the full line.
        orig_mode, orig_call = L.AI_MODE, L._call_cf_workers
        L.AI_MODE = "cf_workers"
        L._call_cf_workers = lambda messages: (
            '{"actions": [{"action": "SEARCH_SONG", '
            '"parameters": {"query": "hello from the other side"}}], '
            '"response": "Searching for hello from the other side."}'
        )
        try:
            r = L._understand_uncached('play that song which goes "hello from the other side"')
        finally:
            L.AI_MODE, L._call_cf_workers = orig_mode, orig_call
        assert r["actions"][0]["action"] == "SEARCH_SONG"
        assert "hello from the other side" in (r["searchQuery"] or "").lower(), r
        assert "which goes" not in (r["searchQuery"] or "").lower(), r

    def test_lyric_fix_helper_forces_full_line(self):
        j = {"actions": [{"action": "SEARCH_SONG", "parameters": {"query": "hello"}}],
             "response": "x", "searchQuery": "That Which Goes Hello"}
        out = L._apply_lyric_contract_fix(
            j, 'play that song which goes hello from the other side',
            'play that song which goes hello from the other side')
        assert "hello from the other side" in (out["searchQuery"] or "").lower(), out


class TestLyricMoodAPI:
    @pytest.mark.parametrize("text", [
        'play that song which goes "hello from the other side"',
        "play the song that says neethane en ponvasantham",
        "hello from the other side",
        "play feel good songs",
        "play uplifting songs",
    ])
    def test_api_probes(self, text):
        r = client.post("/assistant/understand", json={"text": text})
        assert r.status_code == 200, text
        body = r.json()
        assert body["clarificationNeeded"] is False, (text, body)
        assert len(body["actions"]) >= 1, (text, body)
        if "feel good" in text or "uplifting" in text:
            assert body["actions"][0]["action"] == "PLAY_BY_MOOD", (text, body)
            assert body["actions"][0]["parameters"].get("mood") == "HAPPY", (text, body)
        else:
            assert body["actions"][0]["action"] == "SEARCH_SONG", (text, body)
            assert body["searchQuery"] and len(body["searchQuery"].split()) >= 3, (text, body)
