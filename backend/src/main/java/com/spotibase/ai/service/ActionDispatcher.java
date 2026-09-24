package com.spotibase.ai.service;

import com.spotibase.ai.AssistantAction;
import com.spotibase.ai.dto.AssistantCommand;
import com.spotibase.dto.response.SongResponse;
import com.spotibase.service.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.*;

@Service
@Slf4j
@RequiredArgsConstructor
public class ActionDispatcher {

    private final RealtimeService realtimeService;
    private final SearchService searchService;
    private final RecommendationService recommendationService;
    private final QueueService queueService;
    private final LikeService likeService;
    private final PlaylistService playlistService;
    private final SongService songService;

    public Map<String, Object> dispatch(String userId, AssistantCommand cmd, Map<String, Object> ctx) {
        AssistantAction action = cmd.getAction();
        Map<String, Object> params = cmd.getParameters() != null ? cmd.getParameters() : Map.of();
        log.info("Dispatch {} for user {} params {}", action, userId, params);

        return switch (action) {
            case PAUSE, RESUME, NEXT, PREVIOUS, SHUFFLE_ON, SHUFFLE_OFF, REPEAT_ON, REPEAT_OFF, SET_VOLUME -> {
                String playerAction = action.name();
                // For simple playback, push via STOMP to user's ai-player channel
                String commandId = UUID.randomUUID().toString();
                Map<String, Object> payload = new HashMap<>();
                payload.put("type", "AI_PLAYER_COMMAND");
                payload.put("commandId", commandId);
                payload.put("action", playerAction);
                payload.put("parameters", params);
                payload.put("timestamp", System.currentTimeMillis());
                realtimeService.pushEvent(userId, "ai-player", payload);
                yield Map.of("status", "SENT", "commandId", commandId, "action", playerAction);
            }
            case SEARCH_SONG, SEARCH_ALBUM -> {
                String query = extractSearchQuery(params, action);
                if (query == null || query.isBlank()) {
                    yield Map.of("status", "NO_RESULTS", "query", "",
                            "songs", List.of(), "displayText", "What should I search for?");
                }
                try {
                    List<String> types = action == AssistantAction.SEARCH_SONG
                            ? List.of("song")
                            : List.of("album", "song");
                    // Preserve voice/discovery filters instead of dropping them.
                    String language = strOrNull(params.get("language"));
                    String genre = firstNonBlank((String) params.get("genre"), (String) params.get("genreName"));
                    // Voice path uses top-5 fast union search (<150ms via FTS+trigram+ILIKE)
                    var result = searchService.search(query, types, 0, 5, language, null, genre, "relevance", userId);
                    List<String> songIds = result.getSongs() != null
                            ? result.getSongs().stream().map(com.spotibase.dto.response.SongResponse::getId).toList()
                            : List.of();
                    String displayText = songIds.isEmpty()
                            ? "No results for '" + query + "'"
                            : "Found " + songIds.size() + " result(s) for '" + query + "'";
                    Map<String, Object> out = new HashMap<>();
                    out.put("status", songIds.isEmpty() ? "NO_RESULTS" : "SEARCH");
                    out.put("query", query);
                    out.put("songs", songIds);
                    out.put("displayText", displayText);
                    if (result.getArtists() != null && !result.getArtists().isEmpty()) {
                        out.put("artists", result.getArtists().stream()
                                .map(com.spotibase.dto.response.ArtistResponse::getId).toList());
                    }
                    if (result.getAlbums() != null && !result.getAlbums().isEmpty()) {
                        out.put("albums", result.getAlbums().stream()
                                .map(com.spotibase.dto.response.AlbumResponse::getId).toList());
                    }
                    yield out;
                } catch (Exception e) {
                    log.warn("Search dispatch failed for '{}'", query, e);
                    yield Map.of("status", "FAILED", "query", query,
                            "songs", List.of(), "displayText", "Search failed, try again.",
                            "error", String.valueOf(e.getMessage()));
                }
            }
            case SEARCH_ARTIST -> {
                // Autoplay like PLAY_BY_MOOD: queue the top-5 hits + QUEUE_SYNC,
                // displayText "Playing {artist} hits". Keeps NO_RESULTS/FAILED shapes.
                String query = extractSearchQuery(params, action);
                String artistLabel = firstNonBlank(strOrNull(params.get("artist")), query);
                if (query == null || query.isBlank()) {
                    yield Map.of("status", "NO_RESULTS", "query", "",
                            "songs", List.of(), "displayText", "What should I search for?");
                }
                try {
                    // Preserve voice/discovery filters instead of dropping them.
                    String language = strOrNull(params.get("language"));
                    String genre = firstNonBlank((String) params.get("genre"), (String) params.get("genreName"));
                    // Voice path uses top-5 fast union search (<150ms via FTS+trigram+ILIKE)
                    var result = searchService.search(query, List.of("artist", "song"), 0, 5,
                            language, null, genre, "relevance", userId);
                    List<SongResponse> songObjs = result.getSongs() != null
                            ? result.getSongs() : List.of();
                    List<String> songIds = songObjs.stream().map(SongResponse::getId).toList();
                    if (songIds.isEmpty()) {
                        yield Map.of("status", "NO_RESULTS", "query", query,
                                "songs", List.of(), "displayText", "No results for '" + query + "'");
                    }
                    for (SongResponse s : songObjs) {
                        try {
                            queueService.addToQueue(userId, s.getId(), "AI_ARTIST");
                        } catch (Exception qe) {
                            log.warn("Artist autoplay queue failed for song {}", s.getId(), qe);
                            break;
                        }
                    }
                    String label = artistLabel != null && !artistLabel.isBlank() ? artistLabel.trim() : query;
                    realtimeService.pushQueueUpdate(userId,
                            Map.of("type", "QUEUE_SYNC", "data", songObjs, "artist", label));
                    Map<String, Object> out = new HashMap<>();
                    out.put("status", "QUEUED");
                    out.put("query", query);
                    out.put("artist", label);
                    out.put("songs", songIds);
                    out.put("displayText", "Playing " + label + " hits");
                    if (result.getArtists() != null && !result.getArtists().isEmpty()) {
                        out.put("artists", result.getArtists().stream()
                                .map(com.spotibase.dto.response.ArtistResponse::getId).toList());
                    }
                    if (result.getAlbums() != null && !result.getAlbums().isEmpty()) {
                        out.put("albums", result.getAlbums().stream()
                                .map(com.spotibase.dto.response.AlbumResponse::getId).toList());
                    }
                    yield out;
                } catch (Exception e) {
                    log.warn("Artist autoplay dispatch failed for '{}'", query, e);
                    yield Map.of("status", "FAILED", "query", query,
                            "songs", List.of(), "displayText", "Search failed, try again.",
                            "error", String.valueOf(e.getMessage()));
                }
            }
            case PLAY, PLAY_SONG -> {
                // Direct play: resolve via fast voice search, queue first + QUEUE_SYNC, return songs[].
                String query = extractSearchQuery(params, action);
                String directSongId = strOrNull(params.get("songId"));
                if ((query == null || query.isBlank()) && directSongId == null) {
                    yield Map.of("status", "NO_RESULTS", "query", "",
                            "songs", List.of(), "displayText", "What should I play?");
                }
                try {
                    if (directSongId != null && (query == null || query.isBlank())) {
                        queueService.addToQueue(userId, directSongId, "AI_PLAY");
                        realtimeService.pushQueueUpdate(userId,
                                Map.of("type", "QUEUE_SYNC", "data", List.of(directSongId)));
                        yield Map.of("status", "QUEUED", "query", "", "songs", List.of(directSongId),
                                "displayText", "Playing your request");
                    }
                    List<SongResponse> songs = searchService.searchSongsForVoice(query, userId);
                    if (songs.isEmpty()) {
                        yield Map.of("status", "NO_RESULTS", "query", query,
                                "songs", List.of(), "displayText", "No results for '" + query + "'");
                    }
                    SongResponse first = songs.get(0);
                    queueService.addToQueue(userId, first.getId(), "AI_PLAY");
                    realtimeService.pushQueueUpdate(userId, Map.of("type", "QUEUE_SYNC", "data", songs));
                    String title = first.getTitle() != null && !first.getTitle().isBlank()
                            ? first.getTitle() : query;
                    yield Map.of("status", "QUEUED", "query", query,
                            "songs", songs.stream().map(SongResponse::getId).toList(),
                            "displayText", "Playing " + title);
                } catch (Exception e) {
                    log.warn("Play dispatch failed for '{}'", query, e);
                    yield Map.of("status", "FAILED", "query", query != null ? query : "",
                            "songs", List.of(), "displayText", "Couldn't play that right now.",
                            "error", String.valueOf(e.getMessage()));
                }
            }
            case PLAY_BY_MOOD, PLAY_BY_GENRE, PLAY_BY_LANGUAGE -> {
                // params may contain mood, genre, language, vibe, activity, exclude_mood
                String mood = firstNonBlank((String) params.get("mood"), (String) params.get("vibe"));
                String activity = (String) params.get("activity");
                String excludeMood = extractExcludeMood(params.get("exclude_mood"));
                String language = (String) params.get("language");
                String genre = (String) params.get("genre");
                // Per-action requested filter (PLAY_BY_MOOD->mood, PLAY_BY_GENRE->genre, PLAY_BY_LANGUAGE->language)
                String requestedMood = mood;
                String requestedGenre = action == AssistantAction.PLAY_BY_GENRE
                        ? firstNonBlank(genre, (String) params.get("genreName")) : genre;
                String requestedLanguage = action == AssistantAction.PLAY_BY_LANGUAGE ? language : language;
                if (action == AssistantAction.PLAY_BY_MOOD && (requestedMood == null || requestedMood.isBlank())
                        && activity != null) requestedMood = activity;
                try {
                    List<SongResponse> recs = recommendationService.getRecommendedSongs(userId, 20);
                    List<SongResponse> filtered = filterByMoodGenreLanguage(
                            recs, requestedMood, requestedGenre, requestedLanguage, activity, excludeMood);
                    if (!filtered.isEmpty()) {
                        String firstSongId = filtered.get(0).getId();
                        queueService.addToQueue(userId, firstSongId, "AI_MOOD");
                        String label = requestedMood != null && !requestedMood.isBlank() ? requestedMood
                                : requestedGenre != null && !requestedGenre.isBlank() ? requestedGenre
                                : requestedLanguage != null && !requestedLanguage.isBlank() ? requestedLanguage
                                : "UNKNOWN";
                        realtimeService.pushQueueUpdate(userId, Map.of("type", "QUEUE_SYNC", "data", filtered, "mood", label));
                        yield Map.of("status", "QUEUED",
                                "mood", requestedMood != null ? requestedMood : "UNKNOWN",
                                "genre", requestedGenre != null ? requestedGenre : "",
                                "language", requestedLanguage != null ? requestedLanguage : "",
                                "songs", filtered.stream().map(SongResponse::getId).toList(),
                                "displayText", "Playing " + label + " (" + filtered.size() + " songs)");
                    } else {
                        String label = requestedMood != null && !requestedMood.isBlank() ? requestedMood
                                : requestedGenre != null && !requestedGenre.isBlank() ? requestedGenre
                                : requestedLanguage != null ? requestedLanguage : "";
                        yield Map.of("status", "NO_RESULTS",
                                "mood", requestedMood != null ? requestedMood : "",
                                "genre", requestedGenre != null ? requestedGenre : "",
                                "language", requestedLanguage != null ? requestedLanguage : "",
                                "songs", List.of(),
                                "displayText", "No songs found for '" + label + "'");
                    }
                } catch (Exception e) {
                    log.warn("PLAY_BY_MOOD failed", e);
                    yield Map.of("status", "FAILED", "error", String.valueOf(e.getMessage()),
                            "songs", List.of(), "displayText", "Couldn't play that right now.");
                }
            }
            case PLAY_SIMILAR -> {
                String source = (String) params.getOrDefault("source", "CURRENT_SONG");
                String currentSongId = ctx != null ? (String) ctx.get("currentSongId") : null;
                if (currentSongId != null) {
                    List<SongResponse> similars = recommendationService.getSimilarSongs(currentSongId, 10);
                    if (!similars.isEmpty()) {
                        queueService.addToQueue(userId, similars.get(0).getId(), "AI_SIMILAR");
                        yield Map.of("status", "QUEUED_SIMILAR", "songs", similars.stream().map(SongResponse::getId).toList());
                    }
                }
                yield Map.of("status", "NO_CONTEXT");
            }
            case ADD_TO_QUEUE -> {
                String target = (String) params.getOrDefault("target", "CURRENT_SONG");
                String songId = null;
                if (target.equals("CURRENT_SONG")) {
                    songId = ctx != null ? (String) ctx.get("currentSongId") : null;
                } else {
                    songId = (String) params.get("songId");
                }
                if (songId != null) {
                    queueService.addToQueue(userId, songId, "AI_QUEUE");
                    yield Map.of("status", "ADDED_TO_QUEUE", "songId", songId);
                }
                yield Map.of("status", "FAILED", "reason", "No song to queue");
            }
            case LIKE_CURRENT, UNLIKE_CURRENT -> {
                String songId = ctx != null ? (String) ctx.get("currentSongId") : null;
                if (songId != null) {
                    if (action == AssistantAction.LIKE_CURRENT) {
                        likeService.likeSong(userId, songId);
                        yield Map.of("status", "LIKED", "songId", songId);
                    } else {
                        likeService.unlikeSong(userId, songId);
                        yield Map.of("status", "UNLIKED", "songId", songId);
                    }
                }
                yield Map.of("status", "FAILED", "reason", "No current song");
            }
            case ADD_TO_PLAYLIST, CREATE_PLAYLIST -> {
                String playlistName = (String) params.getOrDefault("playlist", "Chill");
                String target = (String) params.getOrDefault("target", "CURRENT_SONG");
                String songId = null;
                if (ctx != null) {
                    if (target.equals("FIRST_RESULT") && ctx.get("firstResultSongId") != null) {
                        songId = (String) ctx.get("firstResultSongId");
                    } else if (ctx.get("currentSongId") != null) {
                        songId = (String) ctx.get("currentSongId");
                    } else if (ctx.get("firstResultSongId") != null) {
                        songId = (String) ctx.get("firstResultSongId");
                    }
                }
                // Playlist write path is not implemented yet: do not claim success.
                // Return a clarification payload so mobile shows guidance instead of "Done".
                Map<String, Object> out = new HashMap<>();
                out.put("status", "CLARIFICATION_NEEDED");
                out.put("clarificationNeeded", true);
                out.put("playlist", playlistName);
                if (songId != null) out.put("songId", songId);
                out.put("displayText", "Playlist editing via voice isn't supported yet. Please add the song to '"
                        + playlistName + "' manually.");
                yield out;
            }
            default -> Map.of("status", "NOT_IMPLEMENTED", "action", action.name());
        };
    }

    /**
     * Artist-first query extraction for SEARCH_ARTIST: song+artist concat
     * (avoid duplication) -&gt; artist -&gt; query -&gt; title/name/album.
     * PLAY/PLAY_SONG concat song+artist when both are present (avoid dup),
     * otherwise fall back to the generic query-first order. Mood/genre/
     * language params are preserved by callers (passed to search filters),
     * never dropped here.
     */
    private String extractSearchQuery(Map<String, Object> params, AssistantAction action) {
        if (action == AssistantAction.SEARCH_ARTIST) {
            return extractArtistSearchQuery(params);
        }
        if (action == AssistantAction.PLAY || action == AssistantAction.PLAY_SONG) {
            String song = strOrNull(params.get("song"));
            String artist = strOrNull(params.get("artist"));
            if (song != null && artist != null) {
                return concatSongArtist(song, artist);
            }
        }
        return extractGenericQuery(params);
    }

    private String extractArtistSearchQuery(Map<String, Object> params) {
        String song = strOrNull(params.get("song"));
        String artist = strOrNull(params.get("artist"));
        if (song != null && artist != null) {
            return concatSongArtist(song, artist);
        }
        if (artist != null) {
            return artist;
        }
        for (String key : List.of("query", "title", "name", "album")) {
            String v = strOrNull(params.get(key));
            if (v != null) return v;
        }
        if (song != null) return song;
        return "";
    }

    private String concatSongArtist(String song, String artist) {
        String songL = song.toLowerCase();
        String artistL = artist.toLowerCase();
        if (songL.contains(artistL)) return song;
        if (artistL.contains(songL)) return artist;
        return (song + " " + artist).trim();
    }

    private String extractGenericQuery(Map<String, Object> params) {
        for (String key : List.of("query", "song", "title", "name", "artist", "album")) {
            String v = strOrNull(params.get(key));
            if (v != null) return v;
        }
        return "";
    }

    private String strOrNull(Object v) {
        if (v instanceof String s && !s.isBlank()) return s.trim();
        return null;
    }

    private String firstNonBlank(String... vals) {
        if (vals == null) return null;
        for (String v : vals) if (v != null && !v.isBlank()) return v;
        return null;
    }

    private String extractExcludeMood(Object value) {
        if (value instanceof String s) return s;
        if (value instanceof List<?> list && !list.isEmpty() && list.get(0) != null) {
            return String.valueOf(list.get(0));
        }
        return null;
    }

    /**
     * Filter recommendation candidates by the requested mood/genre/language.
     * Mood matches mood_tags/vibe_tags/activity_tags (case-insensitive, substring);
     * genre matches genreName/genreId; language matches language. exclude_mood removes
     * matches. When no filter is requested the input list passes through.
     */
    private List<SongResponse> filterByMoodGenreLanguage(List<SongResponse> recs,
                                                          String mood, String genre, String language,
                                                          String activity, String excludeMood) {
        if (recs == null || recs.isEmpty()) return List.of();
        boolean hasMood = mood != null && !mood.isBlank();
        boolean hasGenre = genre != null && !genre.isBlank();
        boolean hasLang = language != null && !language.isBlank();
        boolean hasActivity = activity != null && !activity.isBlank();
        boolean hasExclude = excludeMood != null && !excludeMood.isBlank();
        if (!hasMood && !hasGenre && !hasLang && !hasActivity && !hasExclude) return recs;
        String moodL = hasMood ? mood.toLowerCase() : null;
        String actL = hasActivity ? activity.toLowerCase() : null;
        String exclL = hasExclude ? excludeMood.toLowerCase() : null;
        List<SongResponse> out = new ArrayList<>();
        for (SongResponse s : recs) {
            if (hasExclude && tagContains(s, exclL)) continue;
            if (hasMood && !(tagContains(s, moodL))) continue;
            if (hasActivity && !(tagContains(s, actL))) continue;
            if (hasGenre && !genreMatches(s, genre)) continue;
            if (hasLang && (s.getLanguage() == null || !s.getLanguage().equalsIgnoreCase(language))) continue;
            out.add(s);
        }
        return out;
    }

    private boolean tagContains(SongResponse s, String needle) {
        if (needle == null) return false;
        if (containsAny(s.getMoodTags(), needle)) return true;
        if (containsAny(s.getVibeTags(), needle)) return true;
        return containsAny(s.getActivityTags(), needle);
    }

    private boolean containsAny(List<String> tags, String needle) {
        if (tags == null) return false;
        for (String t : tags) {
            if (t != null && (t.equalsIgnoreCase(needle) || t.toLowerCase().contains(needle))) return true;
        }
        return false;
    }

    private boolean genreMatches(SongResponse s, String genre) {
        if (genre == null) return true;
        if (s.getGenreName() != null && (s.getGenreName().equalsIgnoreCase(genre)
                || s.getGenreName().toLowerCase().contains(genre.toLowerCase()))) return true;
        return s.getGenreId() != null && s.getGenreId().equalsIgnoreCase(genre);
    }
}
