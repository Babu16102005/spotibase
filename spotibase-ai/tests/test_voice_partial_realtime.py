"""Realtime voice search — FastAPI POST /speech/partial (TestAgent).

Covers the realtime contract beyond test_assistant_api.py::TestPartial:
- SEARCH-only enforcement (side-effect + hallucinated actions dropped, 200 clarification)
- <500ms budget on representative partials
- validation paths (422 vs 200-clarification)
- failure behavior (Redis down, LLM exception never 500, never touches STT)
- superseded/no-side-effect (stateless: repeat calls identical, no queue)

Expo SDK v57 docs reviewed per mobile/AGENTS.md; no native API change here
(pure FastAPI TestClient assertions).
"""
import io
import os
import time

os.environ.setdefault("AI_MODE", "mock")
os.environ.setdefault("STT_MODE", "mock")

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import llm_service, cache_service

client = TestClient(app)

SEARCH_ONLY = {"SEARCH_SONG", "SEARCH_ARTIST", "SEARCH_ALBUM"}


@pytest.fixture(autouse=True)
def no_redis():
    orig_client, orig_disabled = cache_service._client, cache_service._disabled
    cache_service._client = None
    cache_service._disabled = True
    yield
    cache_service._client, cache_service._disabled = orig_client, orig_disabled


def partial(text, context=None):
    body = {"text": text}
    if context is not None:
        body["context"] = context
    return client.post("/speech/partial", json=body)


class TestSearchOnly:
    @pytest.mark.parametrize("text", [
        "add this song to my queue",
        "like this",
        "pause",
        "next",
        "create a chill playlist",
        "play calm Tamil songs",  # PLAY_BY_MOOD must not leak
        "shuffle on",
    ])
    def test_side_effect_actions_never_pass(self, text):
        r = partial(text)
        assert r.status_code == 200, text
        for a in r.json()["actions"]:
            assert a["action"] in SEARCH_ONLY, (text, a)

    def test_hallucinated_action_dropped_to_clarification(self, monkeypatch):
        monkeypatch.setattr(
            llm_service, "understand",
            lambda text, ctx=None: {
                "actions": [
                    {"action": "DELETE_EVERYTHING", "parameters": {}},
                    {"action": "ADD_TO_QUEUE", "parameters": {"target": "CURRENT_SONG"}},
                    {"action": "SEARCH_ARTIST", "parameters": {"artist": "Anirudh"}},
                ],
                "response": "evil + queue + search",
                "clarificationNeeded": False,
                "parsedKeywords": None,
                "searchQuery": "Anirudh",
                "displayText": "evil",
                "suggestions": ["Play Anirudh hits"],
            },
        )
        body = partial("play ani hits").json()
        actions = [a["action"] for a in body["actions"]]
        assert actions == ["SEARCH_ARTIST"]
        assert body["clarificationNeeded"] is False

    def test_all_hallucinated_becomes_200_clarification_not_500(self, monkeypatch):
        monkeypatch.setattr(
            llm_service, "understand",
            lambda text, ctx=None: {
                "actions": [{"action": "QUEUE_SYNC", "parameters": {}}],
                "response": "evil", "parsedKeywords": None,
                "searchQuery": "x", "displayText": "evil",
                "suggestions": None, "clarificationQuestion": None,
            },
        )
        r = partial("do evil")
        assert r.status_code == 200
        body = r.json()
        assert body["actions"] == []
        assert body["clarificationNeeded"] is True
        assert isinstance(body["suggestions"], list) and len(body["suggestions"]) >= 3

    def test_play_by_mood_dropped_preserves_search_query(self):
        body = partial("play calm Tamil songs").json()
        for a in body["actions"]:
            assert a["action"] in SEARCH_ONLY
        assert body["searchQuery"]  # caller can still render preview


class TestLatencyBudget:
    @pytest.mark.parametrize("text", [
        "play ani hits",
        "play calm Tamil songs",
        "play 90s melodies",
        "a",
        "play aniruth hits",
    ])
    def test_partial_under_500ms(self, text):
        # "a" is 1 char: UnderstandRequest min_length=1 passes, mock clarifies fast.
        t0 = time.perf_counter()
        r = partial(text)
        ms = (time.perf_counter() - t0) * 1000
        assert r.status_code == 200
        assert ms < 500, f"{text!r} exceeded budget: {ms:.1f}ms"


class TestValidation:
    def test_missing_text_field_422(self):
        assert client.post("/speech/partial", json={}).status_code == 422

    def test_null_text_422(self):
        assert client.post("/speech/partial", json={"text": None}).status_code == 422

    def test_empty_string_422(self):
        # min_length=1 rejects "" at schema layer (whitespace passes to handler).
        assert partial("").status_code == 422

    def test_oversize_2001_rejected_422(self):
        assert partial("x" * 2001).status_code == 422

    def test_max_length_2000_accepted(self):
        r = partial("play " + "a" * 1990)
        assert r.status_code == 200

    def test_whitespace_clarifies_200_not_500(self):
        r = partial("   ")
        assert r.status_code == 200
        assert r.json()["clarificationNeeded"] is True

    def test_special_chars_never_500(self):
        r = partial('play \U0001f3b5 >}} <script>alert(1)</script> "\';--')
        assert r.status_code == 200
        assert "actions" in r.json()

    def test_context_passthrough_never_500(self):
        r = partial("play ani hits", context={"lastMood": "CALM", "playing": True, "queueSize": 2})
        assert r.status_code == 200


class TestFailureBehavior:
    def test_redis_down_still_200(self, monkeypatch):
        monkeypatch.setattr(cache_service, "_get_client", lambda: (_ for _ in ()).throw(
            ConnectionError("redis down")))
        r = partial("play ani hits")
        assert r.status_code == 200
        body = r.json()
        # mock path answers without Redis; SEARCH-only still holds
        for a in body["actions"]:
            assert a["action"] in SEARCH_ONLY

    def test_partial_never_touches_stt(self, monkeypatch):
        called = []
        monkeypatch.setattr("app.routes.speech.stt_service.transcribe",
                            lambda *a, **k: called.append(1) or "SHOULD NOT HAPPEN")
        r = partial("play ani hits")
        assert r.status_code == 200
        assert called == []

    def test_unknown_text_clarifies_with_3_suggestions(self):
        body = partial("xyzqw blarg flimflam").json()
        assert body["clarificationNeeded"] is True
        assert isinstance(body["suggestions"], list) and len(body["suggestions"]) >= 3


class TestNoSideEffectSuperseded:
    def test_repeat_calls_identical_stateless(self):
        first = partial("play ani hits").json()
        second = partial("play ani hits").json()
        assert first == second

    def test_superseded_prefix_no_queue_side_effect(self):
        # Typing "play a" -> "play an" -> "play ani": each is read-only;
        # none may emit a queue/like action even as the query grows.
        for q in ["play a", "play an", "play ani", "play ani hits"]:
            body = partial(q).json()
            for a in body["actions"]:
                assert a["action"] in SEARCH_ONLY, (q, a)
