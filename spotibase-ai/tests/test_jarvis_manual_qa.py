"""Jarvis manual-QA regression — TestAgent additive suite.

Covers the exact phrases from the QA request that had NO dedicated test:
- "play Anirudh songs" / "ARR songs" top-1 -> SEARCH_ARTIST canonical
- "carry"/"marriage" must NOT hijack to ARR (substring guard)
- "play Munbe Vaa by ARR" explicit song+artist
- "play song" bare generic -> documents CURRENT behavior (SEARCH_SONG query Song).
  NOTE: spec expectation is clarification ("What should I play?"); this test
  pins current behavior and will need updating when the NLU gap is fixed.
  See Remaining gaps in QA report.

Expo v57 docs reviewed per mobile/AGENTS.md (no mobile code changed by this file).
"""
import os

os.environ.setdefault("AI_MODE", "mock")
os.environ.setdefault("STT_MODE", "mock")

from app.services import llm_service as L


def mock_of(text):
    return L._mock_understand(text)


class TestManualQaTop1:
    def test_play_anirudh_songs_top1(self):
        r = mock_of("play Anirudh songs")
        assert r["clarificationNeeded"] is False
        assert r["actions"][0]["action"] == "SEARCH_ARTIST"
        assert r["actions"][0]["parameters"]["artist"] == "Anirudh"

    def test_arr_songs_top1(self):
        r = mock_of("ARR songs")
        assert r["clarificationNeeded"] is False
        assert r["actions"][0]["action"] == "SEARCH_ARTIST"
        assert r["actions"][0]["parameters"]["artist"] == "A R Rahman"

    def test_anirudh_bare_songs_top1(self):
        r = mock_of("Anirudh songs")
        assert r["actions"][0]["parameters"]["artist"] == "Anirudh"


class TestCarryMarriageNoHijack:
    def test_carry_no_arr_hijack(self):
        r = mock_of("play carry songs")
        assert (r["parsedKeywords"] or {}).get("artist") is None
        assert r["actions"][0]["action"] == "SEARCH_SONG"

    def test_marriage_no_arr_hijack(self):
        r = mock_of("play marriage songs")
        assert (r["parsedKeywords"] or {}).get("artist") is None
        assert r["actions"][0]["action"] == "SEARCH_SONG"

    def test_carriage_carrier_safe(self):
        for t in ["play carriage songs", "play carrier songs"]:
            r = mock_of(t)
            assert (r["parsedKeywords"] or {}).get("artist") is None, t


class TestPlaySongBare:
    def test_play_song_current_behavior_pinned(self):
        """Vague play-intent fix: bare 'play song' -> PLAY_RANDOM (generic play).

        Previously pinned as SEARCH_SONG query 'Song' (junk literal search).
        Vague play requests now always yield a play-family action realtime and
        never clarify: pure-filler remainder ('song') means generic PLAY_RANDOM
        so the backend best-effort chain plays a real song.
        """
        r = mock_of("play song")
        assert r["actions"][0]["action"] == "PLAY_RANDOM"
        assert r["actions"][0]["parameters"] == {}
        assert r["searchQuery"] == ""
        # never clarification for play-intent
        assert r["clarificationNeeded"] is False


class TestMunbeVaaByArr:
    def test_munbe_vaa_by_arr_alias(self):
        r = mock_of("play Munbe Vaa by ARR")
        assert r["actions"][0]["action"] == "SEARCH_SONG"
        assert r["actions"][0]["parameters"]["artist"] == "A R Rahman"
        assert r["actions"][0]["parameters"]["song"] == "Munbe Vaa"

    def test_munbe_vaa_by_a_r_rahman(self):
        r = mock_of("Munbe Vaa by ARR")
        assert r["actions"][0]["parameters"]["artist"] == "A R Rahman"
