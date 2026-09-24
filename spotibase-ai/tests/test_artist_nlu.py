"""Artist NLU regression — Jarvis (spotibase-ai).

Covers audit gaps in app/services/llm_service.py:
- aliases: ani/arr/rahman/aniruth typo -> canonical
- word-boundary: 'ani' must not hijack spanish/organic/morning/Mani/Rani
- dotted initials: G.V. Prakash / S.P.B -> canonical
- mood-before-artist: facets preserved, not dropped
- play X by Y explicit + hits/songs/mix patterns
- _parse_keywords article guard: 'a r rahman' keeps leading 'a'
- _build_search_query: artist-first query
"""
import os

os.environ.setdefault("AI_MODE", "mock")
os.environ.setdefault("STT_MODE", "mock")

from app.services import llm_service as L


def action_of(text):
    r = L._mock_understand(text)
    assert r["clarificationNeeded"] is False, (text, r)
    assert len(r["actions"]) >= 1, (text, r)
    return r


class TestRequiredMappings:
    def test_anirudh_songs_is_search_artist(self):
        r = action_of("Anirudh songs")
        assert r["actions"][0]["action"] == "SEARCH_ARTIST"
        assert r["actions"][0]["parameters"]["artist"] == "Anirudh"

    def test_arr_songs_is_search_artist(self):
        r = action_of("ARR songs")
        assert r["actions"][0]["action"] == "SEARCH_ARTIST"
        assert r["actions"][0]["parameters"]["artist"] == "A R Rahman"

    def test_a_r_rahman_hits_is_search_artist(self):
        r = action_of("A R Rahman hits")
        assert r["actions"][0]["action"] == "SEARCH_ARTIST"
        assert r["actions"][0]["parameters"]["artist"] == "A R Rahman"


class TestAliases:
    def test_ani_hits(self):
        r = action_of("play ani hits")
        assert r["actions"][0]["parameters"]["artist"] == "Anirudh"

    def test_aniruth_typo(self):
        r = action_of("play aniruth hits")
        assert r["actions"][0]["parameters"]["artist"] == "Anirudh"

    def test_rahman_bare(self):
        r = action_of("rahman hits")
        assert r["actions"][0]["parameters"]["artist"] == "A R Rahman"

    def test_arr_bare(self):
        r = action_of("arr")
        assert r["actions"][0]["parameters"]["artist"] == "A R Rahman"


class TestWordBoundary:
    def test_spanish_not_anirudh(self):
        r = action_of("play spanish songs")
        assert (r["parsedKeywords"] or {}).get("artist") is None
        assert r["actions"][0]["action"] == "SEARCH_SONG"

    def test_organic_morning_safe(self):
        for t in ["play organic songs", "play morning songs"]:
            r = action_of(t)
            assert (r["parsedKeywords"] or {}).get("artist") is None, t

    def test_mani_rani_not_anirudh(self):
        # fuzzy 'mani'/'rani' vs 'ani' = 0.857 must NOT map to Anirudh
        for t in ["play Mani hits", "play Rani songs", "play pani songs"]:
            r = action_of(t)
            assert (r["parsedKeywords"] or {}).get("artist") is None, t
            assert r["actions"][0]["action"] == "SEARCH_SONG", t


class TestDottedInitials:
    def test_gv_dotted(self):
        r = action_of("G.V. Prakash songs")
        assert r["actions"][0]["action"] == "SEARCH_ARTIST"
        assert r["actions"][0]["parameters"]["artist"] == "G V Prakash"

    def test_spb_dotted(self):
        r = action_of("S.P.B songs")
        assert r["actions"][0]["parameters"]["artist"] == "S P Balasubrahmanyam"

    def test_arr_dotted(self):
        r = action_of("A.R. Rahman hits")
        assert r["actions"][0]["parameters"]["artist"] == "A R Rahman"


class TestMoodArtistOrdering:
    def test_calm_anirudh_keeps_mood(self):
        r = action_of("play calm Anirudh songs")
        assert r["actions"][0]["action"] == "SEARCH_ARTIST"
        assert r["actions"][0]["parameters"]["artist"] == "Anirudh"
        assert r["actions"][0]["parameters"].get("mood") == "CALM"

    def test_tamil_anirudh_keeps_language(self):
        r = action_of("play Tamil Anirudh songs")
        assert r["actions"][0]["parameters"].get("language") == "TAMIL"

    def test_calm_anirudh_bare_keeps_artist(self):
        r = action_of("play calm Anirudh")
        assert r["actions"][0]["action"] == "PLAY_BY_MOOD"
        assert r["actions"][0]["parameters"].get("artist") == "Anirudh"


class TestPlayByAndHits:
    def test_play_x_by_y(self):
        r = action_of("play Munbe Vaa by A R Rahman")
        assert r["actions"][0]["action"] == "SEARCH_SONG"
        assert r["actions"][0]["parameters"]["artist"] == "A R Rahman"
        assert r["actions"][0]["parameters"]["song"] == "Munbe Vaa"

    def test_hits_mix_patterns(self):
        for t in ["Anirudh super hits", "Anirudh mixes", "yuvan songs"]:
            r = action_of(t)
            assert r["actions"][0]["action"] == "SEARCH_ARTIST", t

    def test_something_by_anirudh_no_false_mood(self):
        # 'something' vs 'soothing' = 0.823 must NOT fire CALM
        r = action_of("play Something by Anirudh")
        assert r["parsedKeywords"]["mood"] is None
        assert r["actions"][0]["parameters"]["song"] == "Something"


class TestParseAndQueryHelpers:
    def test_article_guard_a_r_rahman(self):
        n = L.normalize_entry("a r rahman hits")
        assert L._strip_to_keywords(n) == "a r rahman hits"
        p = L._parse_keywords(n)
        assert p["artist"] == "A R Rahman"
        assert p["song"] is None

    def test_build_search_query_artist_first(self):
        p = {"song": "Munbe Vaa", "artist": "A R Rahman", "mood": None,
             "language": None, "coreKeywords": ""}
        assert L._build_search_query(p, "play munbe vaa by a r rahman") == "Munbe Vaa A R Rahman"
