package com.spotibase.ai.service;

import com.spotibase.ai.AssistantAction;
import com.spotibase.ai.dto.AssistantCommand;
import com.spotibase.dto.response.SongResponse;
import com.spotibase.dto.response.YoutubeVideoResponse;
import com.spotibase.repository.LikeRepository;
import com.spotibase.repository.SongRepository;
import com.spotibase.service.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
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
    private final SongRepository songRepository;
    private final LikeRepository likeRepository;
    // Lyric-identification websearch leg. Null-guarded everywhere (fail-open
    // to local-only results) so old unit tests without this mock still pass.
    private final YoutubeService youtubeService;

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
                    // (a) HUMAN-LIKE LYRIC FIRST: a full lyric line autoplays
                    // (QUEUED) even though plain title searches below return
                    // SEARCH lists — a lyric line means "play this song".
                    List<SongResponse> lyricHits = lyricsMatchSafe(query, userId);
                    if (!lyricHits.isEmpty()) {
                        yield queueLyricAsPlaying(userId, query, lyricHits, "AI_LYRIC");
                    }
                    // Preserve voice/discovery filters instead of dropping them.
                    String language = strOrNull(params.get("language"));
                    String genre = firstNonBlank((String) params.get("genre"), (String) params.get("genreName"));
                    // Voice path uses top-5 fast union search (<150ms via FTS+trigram+ILIKE)
                    // Exact intent runs unwrapped so DB failures still surface as
                    // FAILED (fail-open try/catch); only fallbacks are fail-open.
                    var result = searchService.search(query, types, 0, 5, language, null, genre, "relevance", userId);
                    List<String> songIds = result.getSongs() != null
                            ? result.getSongs().stream().map(com.spotibase.dto.response.SongResponse::getId).toList()
                            : List.of();
                    if (!songIds.isEmpty()) {
                        String displayText = "Found " + songIds.size() + " result(s) for '" + query + "'";
                        Map<String, Object> out = new HashMap<>();
                        out.put("status", "SEARCH");
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
                    }
                    // BEST-EFFORT fallback chain (never defeatist while catalog non-empty):
                    // (b) relaxed filters -> (c) word-level OR -> (d) top popular.
                    // Lyric websearch runs FIRST so the correct song (local
                    // rematch or YouTube) wins over an irrelevant partial hit.
                    // Fallback wins autoplay (QUEUED + partial:true) so the player
                    // always has something, mirroring SEARCH_ARTIST autoplay.
                    Map<String, Object> ytSongAlbum = youtubeLyricFallback(userId, query);
                    if (ytSongAlbum != null) {
                        yield ytSongAlbum;
                    }
                    BestEffortSongHit fallback = bestEffortSearchFallback(
                            query, types, language, genre, userId);
                    if (fallback != null && !fallback.songs().isEmpty()) {
                        yield queueFallbackAsPlaying(userId, query, fallback.songs(),
                                "AI_SEARCH_FALLBACK", fallback.displaySuffix(), fallback.extraIds());
                    }
                    if (catalogEmpty()) {
                        yield Map.of("status", "NO_RESULTS", "query", query,
                                "songs", List.of(), "displayText", "No songs in your library yet");
                    }
                    yield Map.of("status", "NO_RESULTS", "query", query,
                            "songs", List.of(), "displayText", "No results for '" + query + "'");
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
                    // (a) HUMAN-LIKE LYRIC FIRST: a lyric line identifies its
                    // song even on the artist path (QUEUED autoplay).
                    List<SongResponse> lyricHits = lyricsMatchSafe(query, userId);
                    if (!lyricHits.isEmpty()) {
                        yield queueLyricAsPlaying(userId, query, lyricHits, "AI_LYRIC");
                    }
                    // Preserve voice/discovery filters instead of dropping them.
                    String language = strOrNull(params.get("language"));
                    String genre = firstNonBlank((String) params.get("genre"), (String) params.get("genreName"));
                    // Voice path uses top-5 fast union search (<150ms via FTS+trigram+ILIKE)
                    // Exact intent unwrapped so failures surface as FAILED.
                    var result = searchService.search(query, List.of("artist", "song"), 0, 5,
                            language, null, genre, "relevance", userId);
                    List<SongResponse> songObjs = result.getSongs() != null
                            ? result.getSongs() : List.of();
                    if (!songObjs.isEmpty()) {
                        List<String> songIds = songObjs.stream().map(SongResponse::getId).toList();
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
                    }
                    // BEST-EFFORT fallback: relaxed filters -> word-level OR -> popular.
                    // Lyric websearch runs FIRST so the correct song (local
                    // rematch or YouTube) wins over an irrelevant partial hit.
                    // First non-empty wins as QUEUED partial:true, always playing
                    // something while the catalog is non-empty.
                    Map<String, Object> ytArtist = youtubeLyricFallback(userId, query);
                    if (ytArtist != null) {
                        yield ytArtist;
                    }
                    BestEffortSongHit fallback = bestEffortSearchFallback(
                            query, List.of("artist", "song"), language, genre, userId);
                    if (fallback != null && !fallback.songs().isEmpty()) {
                        String label = artistLabel != null && !artistLabel.isBlank() ? artistLabel.trim() : query;
                        List<SongResponse> fbSongs = fallback.songs();
                        for (SongResponse s : fbSongs) {
                            try {
                                queueService.addToQueue(userId, s.getId(), "AI_ARTIST");
                            } catch (Exception qe) {
                                log.warn("Artist fallback queue failed for song {}", s.getId(), qe);
                                break;
                            }
                        }
                        realtimeService.pushQueueUpdate(userId,
                                Map.of("type", "QUEUE_SYNC", "data", fbSongs, "artist", label));
                        Map<String, Object> out = new HashMap<>();
                        out.put("status", "QUEUED");
                        out.put("query", query);
                        out.put("artist", label);
                        out.put("songs", fbSongs.stream().map(SongResponse::getId).toList());
                        out.put("displayText", closestMatchText(fbSongs));
                        out.put("partial", true);
                        if (fallback.extraIds() != null) {
                            if (fallback.extraIds().containsKey("artists")) out.put("artists", fallback.extraIds().get("artists"));
                            if (fallback.extraIds().containsKey("albums")) out.put("albums", fallback.extraIds().get("albums"));
                        }
                        yield out;
                    }
                    if (catalogEmpty()) {
                        yield Map.of("status", "NO_RESULTS", "query", query,
                                "songs", List.of(), "displayText", "No songs in your library yet");
                    }
                    yield Map.of("status", "NO_RESULTS", "query", query,
                            "songs", List.of(), "displayText", "No results for '" + query + "'");
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
                    // (a) HUMAN-LIKE LYRIC FIRST: full lyric line -> local lyrics.
                    List<SongResponse> lyricSongs = lyricsMatchSafe(query, userId);
                    if (!lyricSongs.isEmpty()) {
                        yield queueLyricAsPlaying(userId, query, lyricSongs, "AI_PLAY");
                    }
                    // Exact intent unwrapped so failures surface as FAILED.
                    List<SongResponse> songs = searchService.searchSongsForVoice(query, userId);
                    if (songs == null) songs = List.of();
                    if (!songs.isEmpty()) {
                        SongResponse first = songs.get(0);
                        queueService.addToQueue(userId, first.getId(), "AI_PLAY");
                        realtimeService.pushQueueUpdate(userId, Map.of("type", "QUEUE_SYNC", "data", songs));
                        String title = first.getTitle() != null && !first.getTitle().isBlank()
                                ? first.getTitle() : query;
                        yield Map.of("status", "QUEUED", "query", query,
                                "songs", songs.stream().map(SongResponse::getId).toList(),
                                "displayText", "Playing " + title);
                    }
                    // BEST-EFFORT fallback: lyric websearch -> word-level OR partial
                    // -> top popular. YouTube runs FIRST so the correct song
                    // (local rematch or YouTube) wins over an irrelevant word
                    // hit. First non-empty wins as QUEUED partial:true; NO_RESULTS
                    // only when the catalog itself is empty.
                    Map<String, Object> ytPlay = youtubeLyricFallback(userId, query);
                    if (ytPlay != null) {
                        yield ytPlay;
                    }
                    List<SongResponse> wordHits = wordLevelVoiceFallback(query, userId);
                    if (!wordHits.isEmpty()) {
                        yield queueFallbackAsPlaying(userId, query, wordHits,
                                "AI_PLAY", null, null);
                    }
                    List<SongResponse> popular = popularFallback(userId);
                    if (!popular.isEmpty()) {
                        yield queueFallbackAsPlaying(userId, query, popular,
                                "AI_PLAY", null, null);
                    }
                    if (catalogEmpty()) {
                        yield Map.of("status", "NO_RESULTS", "query", query,
                                "songs", List.of(), "displayText", "No songs in your library yet");
                    }
                    yield Map.of("status", "NO_RESULTS", "query", query,
                            "songs", List.of(), "displayText", "No results for '" + query + "'");
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
                    // Cold users (no listening history) get an EMPTY personalized
                    // pool, which made the mood filter below always miss and the
                    // chain fall through to unrelated popular songs. Seed from
                    // top songs so "feel good" actually plays HAPPY songs.
                    if (recs == null || recs.isEmpty()) {
                        recs = trendingSeedForMood(userId);
                    }
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
                    }
                    // BEST-EFFORT fallback chain: strip filters one by one,
                    // then word-level OR partial, then top popular. First
                    // non-empty wins as QUEUED partial:true — never defeatist
                    // while the catalog is non-empty.
                    String fallbackLabel = requestedMood != null && !requestedMood.isBlank() ? requestedMood
                            : requestedGenre != null && !requestedGenre.isBlank() ? requestedGenre
                            : requestedLanguage != null && !requestedLanguage.isBlank() ? requestedLanguage
                            : activity != null ? activity : "";
                    List<SongResponse> moodFallback = moodFallbackSongs(
                            recs, requestedMood, requestedGenre, requestedLanguage,
                            activity, excludeMood, fallbackLabel, userId);
                    if (!moodFallback.isEmpty()) {
                        String firstSongId = moodFallback.get(0).getId();
                        try {
                            queueService.addToQueue(userId, firstSongId, "AI_MOOD");
                        } catch (Exception qe) {
                            log.warn("Mood fallback queue failed for song {}", firstSongId, qe);
                        }
                        String syncLabel = !fallbackLabel.isBlank() ? fallbackLabel : "UNKNOWN";
                        realtimeService.pushQueueUpdate(userId,
                                Map.of("type", "QUEUE_SYNC", "data", moodFallback, "mood", syncLabel));
                        Map<String, Object> out = new HashMap<>();
                        out.put("status", "QUEUED");
                        out.put("mood", requestedMood != null ? requestedMood : "UNKNOWN");
                        out.put("genre", requestedGenre != null ? requestedGenre : "");
                        out.put("language", requestedLanguage != null ? requestedLanguage : "");
                        out.put("songs", moodFallback.stream().map(SongResponse::getId).toList());
                        out.put("displayText", closestMatchText(moodFallback));
                        out.put("partial", true);
                        yield out;
                    }
                    if (catalogEmpty()) {
                        yield Map.of("status", "NO_RESULTS",
                                "mood", requestedMood != null ? requestedMood : "",
                                "genre", requestedGenre != null ? requestedGenre : "",
                                "language", requestedLanguage != null ? requestedLanguage : "",
                                "songs", List.of(),
                                "displayText", "No songs in your library yet");
                    }
                    String label = requestedMood != null && !requestedMood.isBlank() ? requestedMood
                            : requestedGenre != null && !requestedGenre.isBlank() ? requestedGenre
                            : requestedLanguage != null ? requestedLanguage : "";
                    yield Map.of("status", "NO_RESULTS",
                            "mood", requestedMood != null ? requestedMood : "",
                            "genre", requestedGenre != null ? requestedGenre : "",
                            "language", requestedLanguage != null ? requestedLanguage : "",
                            "songs", List.of(),
                            "displayText", "No songs found for '" + label + "'");
                } catch (Exception e) {
                    log.warn("PLAY_BY_MOOD failed", e);
                    yield Map.of("status", "FAILED", "error", String.valueOf(e.getMessage()),
                            "songs", List.of(), "displayText", "Couldn't play that right now.");
                }
            }
            case PLAY_RANDOM -> {
                // Random catalog pick: one non-archived song, queue + QUEUE_SYNC.
                try {
                    var randomOpt = songRepository.findRandomActive();
                    if (randomOpt.isEmpty()) {
                        yield Map.of("status", "NO_RESULTS",
                                "songs", List.of(), "displayText", "No songs in your library yet");
                    }
                    String songId = randomOpt.get().getId();
                    SongResponse full;
                    try {
                        full = songService.getSongById(songId, userId);
                    } catch (Exception lookupEx) {
                        log.warn("PLAY_RANDOM lookup failed for {}", songId, lookupEx);
                        full = null;
                    }
                    queueService.addToQueue(userId, songId, "AI_RANDOM");
                    if (full != null) {
                        realtimeService.pushQueueUpdate(userId, Map.of("type", "QUEUE_SYNC", "data", List.of(full)));
                    } else {
                        realtimeService.pushQueueUpdate(userId,
                                Map.of("type", "QUEUE_SYNC", "data", List.of(songId)));
                    }
                    String title = (full != null && full.getTitle() != null && !full.getTitle().isBlank())
                            ? full.getTitle() : "your request";
                    yield Map.of("status", "QUEUED", "songs", List.of(songId),
                            "displayText", "Playing " + title);
                } catch (Exception e) {
                    log.warn("PLAY_RANDOM failed", e);
                    yield Map.of("status", "FAILED",
                            "songs", List.of(), "displayText", "Couldn't play that right now.",
                            "error", String.valueOf(e.getMessage()));
                }
            }
            case PLAY_LIKED -> {
                // Liked-songs autoplay: most recent 20, queue first + QUEUE_SYNC full list.
                try {
                    List<String> allLiked = likeRepository.findAllLikedSongIds(userId);
                    if (allLiked == null || allLiked.isEmpty()) {
                        yield Map.of("status", "NO_RESULTS",
                                "songs", List.of(), "displayText", "You haven't liked any songs yet");
                    }
                    List<String> ids = allLiked.stream().limit(20).toList();
                    List<SongResponse> songs = songService.getSongsByIds(ids, userId);
                    if (songs.isEmpty()) {
                        yield Map.of("status", "NO_RESULTS",
                                "songs", List.of(), "displayText", "You haven't liked any songs yet");
                    }
                    List<String> songIds = songs.stream().map(SongResponse::getId).toList();
                    try {
                        queueService.addToQueue(userId, songIds.get(0), "AI_LIKED");
                    } catch (Exception qe) {
                        log.warn("Liked autoplay queue failed for song {}", songIds.get(0), qe);
                    }
                    realtimeService.pushQueueUpdate(userId, Map.of("type", "QUEUE_SYNC", "data", songs));
                    yield Map.of("status", "QUEUED",
                            "songs", songIds,
                            "displayText", "Playing your liked songs (" + songs.size() + " songs)");
                } catch (Exception e) {
                    log.warn("PLAY_LIKED failed", e);
                    yield Map.of("status", "FAILED",
                            "songs", List.of(), "displayText", "Couldn't play that right now.",
                            "error", String.valueOf(e.getMessage()));
                }
            }
            case PLAY_YOUTUBE -> {
                // Direct YouTube play (lyric identified outside the local
                // catalog, or AI explicitly asks for a video). The app plays
                // it via youtubePlayerStore.playVideo({ videoId, title,
                // channelTitle, thumbnailUrl }) — no local queue involved.
                String videoId = strOrNull(params.get("videoId"));
                if (videoId == null) {
                    yield Map.of("status", "FAILED", "query", "",
                            "displayText", "No YouTube video to play.");
                }
                String ytTitle = firstNonBlank(strOrNull(params.get("title")), videoId);
                Map<String, Object> out = new HashMap<>();
                out.put("status", "QUEUED_YOUTUBE");
                out.put("videoId", videoId);
                out.put("title", ytTitle);
                String channelTitle = strOrNull(params.get("channelTitle"));
                if (channelTitle != null) out.put("channelTitle", channelTitle);
                String channelId = strOrNull(params.get("channelId"));
                if (channelId != null) out.put("channelId", channelId);
                String thumbnailUrl = strOrNull(params.get("thumbnailUrl"));
                if (thumbnailUrl != null) out.put("thumbnailUrl", thumbnailUrl);
                String source = strOrNull(params.get("source"));
                if (source != null) out.put("source", source);
                out.put("displayText", "Playing " + ytTitle + " on YouTube");
                yield out;
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

    // ========================================================================
    // BEST-EFFORT fallback chain: never reply negatively while the catalog is
    // non-empty. Exact intent runs first; on empty we retry relaxed
    // (strip language/genre/mood filters one by one) -> word-level OR partial
    // (split query words, match any) -> top popular (findTopSongs limit 5).
    // First non-empty wins as QUEUED partial:true with an honest
    // "Playing closest match: <title>" displayText. NO_RESULTS only when the
    // catalog itself is empty (or every fallback, including popular, is empty).
    // All helpers are fail-open: they catch and return empty, never throw.
    // ========================================================================

    private static final Set<String> VOICE_STOPWORDS = Set.of(
            "play", "playing", "played", "please", "some", "any", "song", "songs",
            "music", "track", "tracks", "tune", "tunes", "hit", "hits", "list",
            "me", "my", "the", "a", "an", "of", "for", "with", "by", "in", "on",
            "to", "and", "or", "our", "vibe", "vibes", "mood", "genre", "language");

    private record BestEffortSongHit(
            List<SongResponse> songs, String displaySuffix, Map<String, Object> extraIds) {}

    private List<SongResponse> voiceSearchSafe(String query, String userId) {
        try {
            if (query == null || query.isBlank()) return List.of();
            List<SongResponse> out = searchService.searchSongsForVoice(query, userId);
            return out != null ? out : List.of();
        } catch (Exception e) {
            log.warn("Best-effort voice search failed for '{}': {}", query, e.getMessage());
            return List.of();
        }
    }

    // ========================================================================
    // HUMAN-LIKE LYRIC IDENTIFICATION chain (any lyric line -> identify -> play):
    // (a) local lyrics match: ILIKE %line% on songs.lyrics (limit 5, trigram
    //     similarity first, plain ILIKE fallback inside SearchService);
    // (b) local title/artist match as today (each branch's exact intent);
    // (c) websearch identify: YoutubeService.search(line, 5) top video, then
    //     strip official-video/audio/lyrics noise to a probable song title;
    // (d) rematch the cleaned title against the local catalog;
    // (e) local hit -> QUEUED local autoplay (queue + QUEUE_SYNC);
    // (f) no local hit -> QUEUED_YOUTUBE {videoId, title, channelTitle} with
    //     displayText "Playing <title> on YouTube" (app plays via
    //     youtubePlayerStore.playVideo). NO_RESULTS only when BOTH sources
    //     are empty. Every leg is fail-open: YouTube errors/quota degrade to
    //     local-only results, never FAILED.
    // ========================================================================

    private List<SongResponse> lyricsMatchSafe(String query, String userId) {
        try {
            if (query == null || query.isBlank()) return List.of();
            List<SongResponse> out = searchService.searchSongsByLyrics(query, userId);
            return out != null ? out : List.of();
        } catch (Exception e) {
            log.warn("Best-effort lyrics search failed for '{}...': {}",
                    query.length() > 30 ? query.substring(0, 30) : query, e.getMessage());
            return List.of();
        }
    }

    private List<YoutubeVideoResponse> youtubeSearchSafe(String query, int limit) {
        try {
            if (youtubeService == null) return List.of();
            if (query == null || query.isBlank()) return List.of();
            var resp = youtubeService.search(query, Math.max(1, Math.min(limit, 10)));
            if (resp == null || resp.getVideos() == null) return List.of();
            return resp.getVideos();
        } catch (Exception e) {
            log.warn("Lyric YouTube identify failed for '{}...', local-only: {}",
                    query.length() > 30 ? query.substring(0, 30) : query, e.getMessage());
            return List.of();
        }
    }

    /**
     * Probable song title from a YouTube result title: strips
     * {@code - Topic} suffixes, {@code [Official Video]}/{@code (Lyric Video)}
     * style bracket noise, trailing {@code Video Song}/{@code Lyrics} suffixes,
     * then splits {@code "Artist - Title"} on {@code " - "} (title = part
     * after the dash, unless that part is pure noise). Never returns null.
     */
    static String cleanYoutubeTitleForCatalog(String raw) {
        if (raw == null) return "";
        String t = raw.trim();
        if (t.isEmpty()) return "";
        // Auto-generated artist-topic channels: "Title - Topic".
        t = t.replaceAll("(?i)\\s*-\\s*Topic\\s*$", "").trim();
        // Trailing YouTube suffixes without brackets: "Song - Lyrics",
        // "Title | Official Video", "Title - Full Video Song".
        t = t.replaceAll("(?i)\\s*[-–|:]+\\s*(official\\s+)?(full\\s+)?(video\\s+song|music\\s+video|lyric\\s*video|lyrics?)\\s*$", "").trim();
        // Bracketed noise anywhere: [Official Video], (Official Audio),
        // [Lyric Video], (Lyrics), (Visualizer), [M/V], (Live), ...
        t = t.replaceAll("(?i)\\[[^\\]]*(official|lyric|audio|music\\s*video|visualiz|m/?v|live|performance)[^\\]]*\\]", " ").trim();
        t = t.replaceAll("(?i)\\([^\\)]*(official|lyric|audio|music\\s*video|visualiz|m/?v|live|performance)[^\\)]*\\)", " ").trim();
        // Pipe remainder ("Title | Something") is channel/promo fluff.
        int pipe = t.indexOf('|');
        if (pipe > 0) t = t.substring(0, pipe).trim();
        // Bare trailing noise without a separator ("Title Video Song",
        // "Title Official Video") survives the pipe cut above.
        t = t.replaceAll("(?i)\\s*(official\\s+)?(full\\s+)?video\\s+song\\s*$", "").trim();
        t = t.replaceAll("(?i)\\s*official\\s+(music\\s+)?video\\s*$", "").trim();
        t = t.replaceAll("(?i)\\s*lyric\\s*video\\s*$", "").trim();
        t = t.replaceAll("(?i)\\s*lyrics?\\s*$", "").trim();
        // "Artist - Title": the song is after the dash. If the tail is pure
        // noise ("Song - Lyrics") keep the head instead.
        int dash = t.indexOf(" - ");
        if (dash < 0) dash = t.indexOf(" – ");
        if (dash < 0) dash = t.indexOf(" — ");
        if (dash >= 0) {
            String head = t.substring(0, dash).trim();
            String tail = t.substring(dash + 3).trim();
            if (!tail.isBlank() && !isNoiseOnly(tail)) {
                t = tail;
            } else if (!head.isBlank()) {
                t = head;
            }
        }
        t = t.replaceAll("\\s{2,}", " ").trim();
        if (t.length() > 1 && ((t.startsWith("\"") && t.endsWith("\""))
                || (t.startsWith("'") && t.endsWith("'")))) {
            t = t.substring(1, t.length() - 1).trim();
        }
        return t;
    }

    private static boolean isNoiseOnly(String s) {
        return s.matches("(?i)^(official|lyrics?|lyric\\s*video|audio|video|video\\s*song|music\\s*video|visualizer|m/?v|live|performance|full\\s*video)(\\s.*)?$");
    }

    private Map<String, Object> queueLyricAsPlaying(
            String userId, String query, List<SongResponse> songs, String source) {
        SongResponse first = songs.get(0);
        try {
            queueService.addToQueue(userId, first.getId(), source);
        } catch (Exception qe) {
            log.warn("Lyric autoplay queue failed for song {}", first.getId(), qe);
        }
        try {
            realtimeService.pushQueueUpdate(userId, Map.of("type", "QUEUE_SYNC", "data", songs));
        } catch (Exception pe) {
            log.warn("Lyric autoplay sync push failed: {}", pe.getMessage());
        }
        String title = first.getTitle() != null && !first.getTitle().isBlank()
                ? first.getTitle().trim() : query;
        Map<String, Object> out = new HashMap<>();
        out.put("status", "QUEUED");
        out.put("query", query != null ? query : "");
        out.put("songs", songs.stream().map(SongResponse::getId).toList());
        out.put("displayText", "Playing " + title);
        return out;
    }

    /**
     * Websearch leg of the lyric chain: identify the line via YouTube, rematch
     * locally, else hand the video to the app. Returns null when YouTube has
     * nothing (caller continues to local fallbacks / NO_RESULTS).
     */
    private Map<String, Object> youtubeLyricFallback(String userId, String query) {
        List<YoutubeVideoResponse> videos = youtubeSearchSafe(query, 5);
        YoutubeVideoResponse top = null;
        for (YoutubeVideoResponse v : videos) {
            if (v != null && v.getVideoId() != null && !v.getVideoId().isBlank()) {
                top = v;
                break;
            }
        }
        if (top == null) return null;
        String rawTitle = top.getTitle() != null && !top.getTitle().isBlank()
                ? top.getTitle().trim() : query;
        // (d) rematch the identified title against the local catalog.
        String cleaned = cleanYoutubeTitleForCatalog(rawTitle);
        List<SongResponse> local = voiceSearchSafe(
                cleaned != null && !cleaned.isBlank() ? cleaned : rawTitle, userId);
        if (!local.isEmpty()) {
            log.info("Lyric YouTube identify '{}...' -> '{}' rematched locally ({} songs)",
                    query.length() > 30 ? query.substring(0, 30) : query, cleaned, local.size());
            return queueLyricAsPlaying(userId, query, local, "AI_LYRIC_YT");
        }
        // (f) not in the library -> the app plays the YouTube video.
        log.info("Lyric YouTube identify '{}...' -> YouTube video {} ('{}'), no local match",
                query.length() > 30 ? query.substring(0, 30) : query, top.getVideoId(), rawTitle);
        Map<String, Object> out = new HashMap<>();
        out.put("status", "QUEUED_YOUTUBE");
        out.put("query", query != null ? query : "");
        out.put("videoId", top.getVideoId());
        out.put("title", rawTitle);
        if (top.getChannelTitle() != null) out.put("channelTitle", top.getChannelTitle());
        if (top.getChannelId() != null) out.put("channelId", top.getChannelId());
        if (top.getThumbnailUrl() != null) out.put("thumbnailUrl", top.getThumbnailUrl());
        if (top.getSource() != null) out.put("source", top.getSource());
        out.put("displayText", "Playing " + rawTitle + " on YouTube");
        return out;
    }

    private com.spotibase.dto.response.SearchResponse searchSafe(
            String query, List<String> types, String language, String genre, String userId) {
        try {
            var r = searchService.search(query, types, 0, 5, language, null, genre, "relevance", userId);
            if (r != null) return r;
        } catch (Exception e) {
            log.warn("Best-effort search failed for '{}': {}", query, e.getMessage());
        }
        return com.spotibase.dto.response.SearchResponse.builder()
                .query(query).songs(List.of()).build();
    }

    private List<String> significantWords(String query) {
        if (query == null || query.isBlank()) return List.of();
        String[] parts = query.toLowerCase().split("[^a-z0-9]+");
        LinkedHashSet<String> seen = new LinkedHashSet<>();
        for (String p : parts) {
            if (p == null) continue;
            String w = p.trim();
            if (w.length() < 2) continue;
            if (VOICE_STOPWORDS.contains(w)) continue;
            seen.add(w);
            if (seen.size() >= 5) break;
        }
        // Most specific first: longest words are less likely to be filler.
        List<String> out = new ArrayList<>(seen);
        out.sort((a, b) -> Integer.compare(b.length(), a.length()));
        return out;
    }

    private List<SongResponse> wordLevelVoiceFallback(String query, String userId) {
        for (String w : significantWords(query)) {
            List<SongResponse> hits = voiceSearchSafe(w, userId);
            if (!hits.isEmpty()) {
                log.info("Best-effort word-level hit for '{}' via word '{}' ({} songs)", query, w, hits.size());
                return hits;
            }
        }
        return List.of();
    }

    /**
     * Broad top-songs pool (limit 20) used ONLY to seed mood/genre/language
     * filtering when the personalized recommendation pool is empty (cold
     * users). Fail-open to the 5-song {@link #popularFallback}. Never throws.
     */
    private List<SongResponse> trendingSeedForMood(String userId) {
        try {
            List<SongResponse> trending = songService.getTrendingSongs(userId, 20);
            if (trending != null && !trending.isEmpty()) {
                log.info("Mood seed: {} top songs for empty recommendation pool", trending.size());
                return trending;
            }
        } catch (Exception e) {
            log.warn("Mood trending seed failed: {}", e.getMessage());
        }
        return popularFallback(userId);
    }

    private List<SongResponse> popularFallback(String userId) {
        // Top popular songs (findTopSongs limit 5 via getTrendingSongs).
        try {
            List<SongResponse> trending = songService.getTrendingSongs(userId, 5);
            if (trending != null && !trending.isEmpty()) {
                log.info("Best-effort popular fallback: {} songs", trending.size());
                return trending;
            }
        } catch (Exception e) {
            log.warn("Best-effort trending fallback failed: {}", e.getMessage());
        }
        try {
            if (songRepository == null) return List.of();
            var top = songRepository.findTopSongs(PageRequest.of(0, 5));
            if (top == null || top.isEmpty()) return List.of();
            List<SongResponse> out = songService.toSongResponses(top, userId);
            return out != null ? out : List.of();
        } catch (Exception e) {
            log.warn("Best-effort findTopSongs fallback failed: {}", e.getMessage());
            return List.of();
        }
    }

    private boolean catalogEmpty() {
        try {
            if (songRepository == null) return false;
            return songRepository.countActiveSongs() == 0;
        } catch (Exception e) {
            log.warn("Best-effort catalog count failed: {}", e.getMessage());
            return false;
        }
    }

    private String closestMatchText(List<SongResponse> songs) {
        if (songs == null || songs.isEmpty()) return "Playing closest match";
        SongResponse first = songs.get(0);
        String title = first.getTitle() != null && !first.getTitle().isBlank()
                ? first.getTitle().trim() : "your request";
        if (songs.size() > 1) {
            return "Playing closest match: " + title + " (" + songs.size() + " songs)";
        }
        return "Playing closest match: " + title;
    }

    private Map<String, Object> queueFallbackAsPlaying(
            String userId, String query, List<SongResponse> songs,
            String source, String displaySuffix, Map<String, Object> extraIds) {
        SongResponse first = songs.get(0);
        try {
            queueService.addToQueue(userId, first.getId(), source);
        } catch (Exception qe) {
            log.warn("Best-effort fallback queue failed for song {}", first.getId(), qe);
        }
        realtimeService.pushQueueUpdate(userId, Map.of("type", "QUEUE_SYNC", "data", songs));
        Map<String, Object> out = new HashMap<>();
        out.put("status", "QUEUED");
        out.put("query", query != null ? query : "");
        out.put("songs", songs.stream().map(SongResponse::getId).toList());
        String base = closestMatchText(songs);
        out.put("displayText", displaySuffix != null && !displaySuffix.isBlank()
                ? base + " " + displaySuffix : base);
        out.put("partial", true);
        if (extraIds != null) out.putAll(extraIds);
        return out;
    }

    private BestEffortSongHit bestEffortSearchFallback(
            String query, List<String> types, String language, String genre, String userId) {
        boolean hasLang = language != null && !language.isBlank();
        boolean hasGenre = genre != null && !genre.isBlank();
        // (b) strip filters one by one, keep song/artist words.
        if (hasLang || hasGenre) {
            List<String[]> combos = new ArrayList<>();
            if (hasLang && hasGenre) {
                combos.add(new String[]{language, null});
                combos.add(new String[]{null, genre});
            }
            combos.add(new String[]{null, null});
            for (String[] c : combos) {
                var r = searchSafe(query, types, c[0], c[1], userId);
                List<SongResponse> hits = r.getSongs() != null ? r.getSongs() : List.of();
                if (!hits.isEmpty()) {
                    log.info("Best-effort relaxed-filter hit for '{}' lang={} genre={} ({} songs)",
                            query, c[0], c[1], hits.size());
                    return new BestEffortSongHit(hits, null, extractExtraIds(r));
                }
            }
        }
        // (c) word-level OR partial: split query words, match any (no filters).
        for (String w : significantWords(query)) {
            var r = searchSafe(w, types, null, null, userId);
            List<SongResponse> hits = r.getSongs() != null ? r.getSongs() : List.of();
            if (!hits.isEmpty()) {
                log.info("Best-effort word-level hit for '{}' via word '{}' ({} songs)", query, w, hits.size());
                return new BestEffortSongHit(hits, null, extractExtraIds(r));
            }
        }
        // (d) top popular songs.
        List<SongResponse> popular = popularFallback(userId);
        if (!popular.isEmpty()) {
            return new BestEffortSongHit(popular, null, null);
        }
        return null;
    }

    private Map<String, Object> extractExtraIds(com.spotibase.dto.response.SearchResponse r) {
        if (r == null) return null;
        Map<String, Object> extra = new HashMap<>();
        try {
            if (r.getArtists() != null && !r.getArtists().isEmpty()) {
                extra.put("artists", r.getArtists().stream()
                        .map(com.spotibase.dto.response.ArtistResponse::getId).toList());
            }
            if (r.getAlbums() != null && !r.getAlbums().isEmpty()) {
                extra.put("albums", r.getAlbums().stream()
                        .map(com.spotibase.dto.response.AlbumResponse::getId).toList());
            }
        } catch (Exception e) {
            log.warn("Best-effort extra-ids extraction failed: {}", e.getMessage());
        }
        return extra.isEmpty() ? null : extra;
    }

    private List<SongResponse> moodFallbackSongs(
            List<SongResponse> recs, String mood, String genre, String language,
            String activity, String excludeMood, String label, String userId) {
        List<SongResponse> safeRecs = recs != null ? recs : List.of();
        boolean hasMood = mood != null && !mood.isBlank();
        boolean hasGenre = genre != null && !genre.isBlank();
        boolean hasLang = language != null && !language.isBlank();
        boolean hasActivity = activity != null && !activity.isBlank();
        boolean hasExclude = excludeMood != null && !excludeMood.isBlank();
        // (b1) drop exclude_mood first (broadens without losing intent).
        if (hasExclude && !safeRecs.isEmpty()) {
            List<SongResponse> hits = filterByMoodGenreLanguage(
                    safeRecs, mood, genre, language, activity, null);
            if (!hits.isEmpty()) {
                log.info("Best-effort mood fallback without exclude ({} songs)", hits.size());
                return hits;
            }
        }
        // (b2) strip language/genre/mood filters one by one.
        int activeFilters = (hasMood ? 1 : 0) + (hasGenre ? 1 : 0) + (hasLang ? 1 : 0) + (hasActivity ? 1 : 0);
        if (activeFilters > 1 && !safeRecs.isEmpty()) {
            // Try each single-filter version; first non-empty wins.
            String[][] singleAttempts = {
                    {mood, null, null, null},
                    {null, genre, null, null},
                    {null, null, language, null},
                    {null, null, null, activity},
            };
            for (String[] a : singleAttempts) {
                boolean anyRequested = (a[0] != null && !a[0].isBlank())
                        || (a[1] != null && !a[1].isBlank())
                        || (a[2] != null && !a[2].isBlank())
                        || (a[3] != null && !a[3].isBlank());
                if (!anyRequested) continue;
                List<SongResponse> hits = filterByMoodGenreLanguage(
                        safeRecs, a[0], a[1], a[2], a[3], null);
                if (!hits.isEmpty()) {
                    log.info("Best-effort mood single-filter fallback ({} songs)", hits.size());
                    return hits;
                }
            }
        }
        // (b3) unfiltered recs (personalized pool, no filter).
        if (!safeRecs.isEmpty()) {
            log.info("Best-effort mood fallback to unfiltered recs ({} songs)", safeRecs.size());
            return safeRecs.size() > 5 ? safeRecs.subList(0, 5) : safeRecs;
        }
        // (c) word-level OR partial on the label via voice search.
        if (label != null && !label.isBlank()) {
            List<SongResponse> wordHits = wordLevelVoiceFallback(label, userId);
            if (!wordHits.isEmpty()) return wordHits;
            // Also try the raw label itself (e.g. "Tamil" alone) before giving up.
            List<SongResponse> rawHits = voiceSearchSafe(label.trim(), userId);
            if (!rawHits.isEmpty()) {
                log.info("Best-effort mood raw-label hit for '{}' ({} songs)", label, rawHits.size());
                return rawHits;
            }
        }
        // (d) top popular songs.
        return popularFallback(userId);
    }
}
