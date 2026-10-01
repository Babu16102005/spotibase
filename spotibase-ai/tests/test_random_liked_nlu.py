"""PLAY_RANDOM / PLAY_LIKED realtime NLU — Jarvis (spotibase-ai).

Realtime commands "play any song" and "play the like playlist / liked songs"
must play from the REAL library (PLAY_RANDOM / PLAY_LIKED with {} params),
never a junk SEARCH_SONG ("Any", "Like Playlist Any", "My Liked") and never
a clarification.

Guards:
- "play Something by Anirudh" stays SEARCH_SONG (explicit artist wins).
- "play something similar to this" stays PLAY_SIMILAR.
- Bare "play" stays RESUME (backend random-fallbacks separately).
- "shuffle on" stays SHUFFLE_ON; "like" stays LIKE_CURRENT.
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


class TestPlayRandom:
    def test_play_any_song_is_random(self):
        r = action_of("play any song")
        assert r["actions"][0]["action"] == "PLAY_RANDOM"
        assert r["actions"][0]["parameters"] == {}
        assert r["searchQuery"] == ""

    def test_random_variants(self):
        for t in [
            "play anything",
            "play something good",
            "play a random song",
            "surprise me",
            "shuffle play",
        ]:
            r = action_of(t)
            assert r["actions"][0]["action"] == "PLAY_RANDOM", t
            assert r["actions"][0]["parameters"] == {}, t

    def test_random_case_insensitive(self):
        for t in ["PLAY ANY SONG", "Play Anything", "pLaY a RaNdOm SoNg"]:
            r = action_of(t)
            assert r["actions"][0]["action"] == "PLAY_RANDOM", t

    def test_random_typo_tolerant(self):
        # "someting" ~ "something", "randon" ~ "random", "suprise" ~ "surprise"
        for t in ["play someting", "play a randon song", "suprise me"]:
            r = action_of(t)
            assert r["actions"][0]["action"] == "PLAY_RANDOM", t


class TestPlayLiked:
    def test_play_my_liked_songs(self):
        r = action_of("play my liked songs")
        assert r["actions"][0]["action"] == "PLAY_LIKED"
        assert r["actions"][0]["parameters"] == {}
        assert r["searchQuery"] == ""

    def test_like_playlist_any_song_prefers_liked(self):
        # Mentions BOTH liked + "any song": liked library wins over random.
        r = action_of("play the like playlist any song")
        assert r["actions"][0]["action"] == "PLAY_LIKED"
        assert r["actions"][0]["parameters"] == {}

    def test_liked_variants(self):
        for t in [
            "play songs I liked",
            "play my favourites",
            "play my favorites",
            "play my liked playlist",
            "play the like playlist",
        ]:
            r = action_of(t)
            assert r["actions"][0]["action"] == "PLAY_LIKED", t
            assert r["actions"][0]["parameters"] == {}, t

    def test_liked_case_insensitive(self):
        for t in ["PLAY MY LIKED SONGS", "Play My Favourites"]:
            r = action_of(t)
            assert r["actions"][0]["action"] == "PLAY_LIKED", t

    def test_liked_typo_tolerant(self):
        for t in ["play my likked songs", "play my favourates"]:
            r = action_of(t)
            assert r["actions"][0]["action"] == "PLAY_LIKED", t


class TestRandomLikedGuards:
    def test_something_by_artist_stays_search(self):
        r = action_of("play Something by Anirudh")
        assert r["actions"][0]["action"] == "SEARCH_SONG"
        assert r["actions"][0]["parameters"]["song"] == "Something"

    def test_similar_stays_play_similar(self):
        r = action_of("play something similar to this")
        assert r["actions"][0]["action"] == "PLAY_SIMILAR"

    def test_bare_play_stays_resume(self):
        r = action_of("play")
        assert r["actions"][0]["action"] == "RESUME"

    def test_shuffle_on_not_random(self):
        r = action_of("shuffle on")
        assert r["actions"][0]["action"] == "SHUFFLE_ON"

    def test_like_alone_not_play_liked(self):
        r = action_of("like")
        assert r["actions"][0]["action"] == "LIKE_CURRENT"

    def test_new_actions_in_allowlist(self):
        assert "PLAY_RANDOM" in L.ALLOWED_ACTIONS
        assert "PLAY_LIKED" in L.ALLOWED_ACTIONS
        assert len(L.ALLOWED_ACTIONS) == 32


class TestNoSearchContractGuard:
    """LLM live paths backfill searchQuery from keywords when the model omits
    it — that invents junk ("Any" / "My Liked") for PLAY_RANDOM/PLAY_LIKED.
    The guard forces searchQuery="" so the backend plays from the REAL
    library instead of searching junk."""

    def test_guard_clears_junk_search_query_random(self):
        j = {"actions": [{"action": "PLAY_RANDOM", "parameters": {}}],
             "response": "Playing a random song.",
             "parsedKeywords": {"song": "Any", "artist": None},
             "searchQuery": "Any"}
        out = L._enforce_no_search_contract(j)
        assert out["searchQuery"] == ""
        assert out["parsedKeywords"]["song"] is None
        assert out["actions"][0]["action"] == "PLAY_RANDOM"

    def test_guard_clears_junk_search_query_liked(self):
        j = {"actions": [{"action": "PLAY_LIKED", "parameters": {}}],
             "response": "Playing your liked songs.",
             "searchQuery": "My Liked"}
        out = L._enforce_no_search_contract(j)
        assert out["searchQuery"] == ""

    def test_guard_leaves_other_actions_alone(self):
        j = {"actions": [{"action": "SEARCH_SONG", "parameters": {"query": "Any"}}],
             "searchQuery": "Any"}
        out = L._enforce_no_search_contract(j)
        assert out["searchQuery"] == "Any"

    def test_cf_path_random_has_empty_search_query(self):
        # Simulate CF model returning PLAY_RANDOM with NO searchQuery field
        # (the exact live failure: backfill invented "Any").
        orig_mode, orig_call = L.AI_MODE, L._call_cf_workers
        L.AI_MODE = "cf_workers"
        L._call_cf_workers = lambda messages: (
            '{"actions": [{"action": "PLAY_RANDOM", "parameters": {}}], '
            '"response": "Playing a random song."}'
        )
        try:
            r = L._understand_uncached("play any song")
        finally:
            L.AI_MODE, L._call_cf_workers = orig_mode, orig_call
        assert r["actions"][0]["action"] == "PLAY_RANDOM"
        assert r["actions"][0]["parameters"] == {}
        assert r["searchQuery"] == "", r

    def test_cf_path_liked_has_empty_search_query(self):
        orig_mode, orig_call = L.AI_MODE, L._call_cf_workers
        L.AI_MODE = "cf_workers"
        L._call_cf_workers = lambda messages: (
            '{"actions": [{"action": "PLAY_LIKED", "parameters": {}}], '
            '"response": "Playing your liked songs."}'
        )
        try:
            r = L._understand_uncached("play my liked songs")
        finally:
            L.AI_MODE, L._call_cf_workers = orig_mode, orig_call
        assert r["actions"][0]["action"] == "PLAY_LIKED"
        assert r["searchQuery"] == "", r
