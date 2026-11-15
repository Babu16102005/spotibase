"""CHAT + LLM-first routing — AIIntegrationAgent.

Covers the "realtime reply like ChatGPT" complaint:
- LLM-FIRST: only exact 1-2 word instant commands bypass the live LLM.
  Real sentences ("pause the music please", "i feel tired",
  "how are you jarvis") go to CF Qwen, never keyword rules.
- CHAT {} free conversation (how are you / thank you / who are you / jokes):
  friendly Jarvis reply in `response`, never clarification.
- Contract: CHAT {} = no music action, just display/speak `response` text.

Mock fallback (CF-down safety) + allow-list validation untouched.
"""
import os

os.environ.setdefault("AI_MODE", "mock")
os.environ.setdefault("STT_MODE", "mock")

from app.services import llm_service as L


def mock_of(text):
    return L._mock_understand(text)


class TestLLMFirstRouting:
    def test_bypass_only_single_two_word_instant(self):
        # instant commands still bypass
        for cmd in ["pause", "stop", "next", "skip", "resume", "continue",
                    "play", "previous", "prev", "go back", "next song",
                    "previous song", "  pause  ", "Next"]:
            assert L._simple_detect(cmd) is not None, cmd

    def test_real_sentences_never_bypass(self):
        # every real sentence must MISS the narrow bypass -> live LLM
        for s in ["pause the music please",
                  "pause the music",
                  "please pause the music",
                  "i feel tired",
                  "how are you",
                  "hey jarvis how are you",
                  "thank you",
                  "who are you",
                  "tell me a joke",
                  "stop the music please"]:
            assert L._simple_detect(s) is None, s

    def test_pause_the_music_please_goes_cf_not_bypass(self):
        # simulate live CF returning PAUSE for the polite sentence
        orig_mode, orig_call = L.AI_MODE, L._call_cf_workers
        L.AI_MODE = "cf_workers"
        seen = {}

        def fake_cf(messages):
            seen["messages"] = messages
            return ('{"actions": [{"action": "PAUSE", "parameters": {}}], '
                    '"response": "Got it, boss, pausing the music for you.", '
                    '"searchQuery": ""}')

        L._call_cf_workers = fake_cf
        try:
            # must NOT hit the bypass: _simple_detect is None
            assert L._simple_detect("pause the music please") is None
            r = L._understand_uncached("pause the music please")
        finally:
            L.AI_MODE, L._call_cf_workers = orig_mode, orig_call
        assert r["actions"][0]["action"] == "PAUSE", r
        assert r["actions"][0]["parameters"] == {}
        assert "boss" in (r.get("response") or "").lower()
        # proves it went to CF (user content carried the full sentence)
        assert seen.get("messages"), "CF never called — bypass hijacked it"
        user_blob = " ".join(m.get("content", "") for m in seen["messages"])
        assert "pause the music please" in user_blob.lower()

    def test_pause_the_music_mock_fallback_still_pauses(self):
        # CF down -> mock safety still resolves the control (not clarification)
        r = mock_of("pause the music please")
        assert r["clarificationNeeded"] is False, r
        assert r["actions"][0]["action"] == "PAUSE", r
        assert r["searchQuery"] == ""


class TestChatMock:
    def test_how_are_you_is_chat(self):
        for t in ["how are you",
                  "hey jarvis how are you",
                  "hey jarvis, how are you?",
                  "how are you jarvis"]:
            r = mock_of(t)
            assert r["clarificationNeeded"] is False, (t, r)
            assert r["actions"] == [{"action": "CHAT", "parameters": {}}], (t, r)
            assert r["searchQuery"] == "", (t, r)
            resp = (r.get("response") or "").lower()
            assert "boss" in resp, (t, r)
            assert len([s for s in r["response"].split(".") if s.strip()]) <= 2, (t, r)

    def test_thanks_is_chat_never_clarification(self):
        for t in ["thank you", "thanks", "thank you so much", "thanks a lot boss"]:
            r = mock_of(t)
            assert r["clarificationNeeded"] is False, (t, r)
            assert r["actions"][0]["action"] == "CHAT", (t, r)
            assert "boss" in (r.get("response") or "").lower(), (t, r)

    def test_who_are_you_is_chat(self):
        for t in ["who are you", "what are you", "what is your name"]:
            r = mock_of(t)
            assert r["actions"][0]["action"] == "CHAT", (t, r)
            assert "jarvis" in (r.get("response") or "").lower(), (t, r)

    def test_joke_is_chat(self):
        r = mock_of("tell me a joke")
        assert r["actions"][0]["action"] == "CHAT", r
        assert "boss" in (r.get("response") or "").lower(), r

    def test_greeting_is_chat(self):
        for t in ["hi", "hello", "hey"]:
            r = mock_of(t)
            assert r["actions"][0]["action"] == "CHAT", (t, r)

    def test_music_with_thanks_stays_music(self):
        # politeness inside a music request must not hijack to CHAT
        r = mock_of("play calm songs thank you")
        assert r["actions"][0]["action"] in (
            "PLAY_BY_MOOD", "PLAY_BY_LANGUAGE", "PLAY_BY_GENRE",
            "SEARCH_SONG", "SEARCH_ARTIST", "PLAY_RANDOM"), r

    def test_tired_stays_mood_not_chat(self):
        r = mock_of("i feel tired")
        assert r["actions"][0]["action"] == "PLAY_BY_MOOD", r
        assert r["actions"][0]["parameters"].get("mood") == "HAPPY", r

    def test_chat_in_allowlist(self):
        assert "CHAT" in L.ALLOWED_ACTIONS
        assert "PLAY_YOUTUBE" in L.ALLOWED_ACTIONS
        assert len(L.ALLOWED_ACTIONS) == 34


class TestChatContract:
    def test_no_search_guard_clears_chat(self):
        j = {"actions": [{"action": "CHAT", "parameters": {}}],
             "response": "Hey boss!",
             "parsedKeywords": {"song": "How Are You", "artist": None},
             "searchQuery": "How Are You"}
        out = L._enforce_no_search_contract(j)
        assert out["searchQuery"] == ""
        assert out["parsedKeywords"]["song"] is None

    def test_cf_path_chat_has_empty_search_query(self):
        orig_mode, orig_call = L.AI_MODE, L._call_cf_workers
        L.AI_MODE = "cf_workers"
        L._call_cf_workers = lambda messages: (
            '{"actions": [{"action": "CHAT", "parameters": {}}], '
            '"response": "I\'m doing great, boss!"}'
        )
        try:
            r = L._understand_uncached("how are you")
        finally:
            L.AI_MODE, L._call_cf_workers = orig_mode, orig_call
        assert r["actions"][0]["action"] == "CHAT"
        assert r["actions"][0]["parameters"] == {}
        assert r["searchQuery"] == "", r

    def test_cf_empty_for_chat_falls_back_to_mock_chat(self):
        orig_mode, orig_call = L.AI_MODE, L._call_cf_workers
        L.AI_MODE = "cf_workers"
        L._call_cf_workers = lambda messages: ""
        try:
            r = L._understand_uncached("how are you")
        finally:
            L.AI_MODE, L._call_cf_workers = orig_mode, orig_call
        assert r["clarificationNeeded"] is False, r
        assert r["actions"][0]["action"] == "CHAT", r

    def test_cf_pause_has_empty_search_query(self):
        # Controls carry no search semantics: CF omitting searchQuery must not
        # backfill junk ("Pause The").
        orig_mode, orig_call = L.AI_MODE, L._call_cf_workers
        L.AI_MODE = "cf_workers"
        L._call_cf_workers = lambda messages: (
            '{"actions": [{"action": "PAUSE", "parameters": {}}], '
            '"response": "Got it, boss, pausing the music for you."}'
        )
        try:
            r = L._understand_uncached("pause the music please")
        finally:
            L.AI_MODE, L._call_cf_workers = orig_mode, orig_call
        assert r["actions"][0]["action"] == "PAUSE"
        assert r["searchQuery"] == "", r

    def test_prompt_has_chat_rule(self):
        from pathlib import Path
        src = (Path(__file__).resolve().parents[1] / "app" / "prompts"
               / "assistant_system.txt").read_text(encoding="utf-8")
        assert "CHAT" in src
        assert "how are you" in src.lower()
        assert "thank you" in src.lower()
        assert "never clarify" in src.lower() or "NEVER return CLARIFICATION" in src
