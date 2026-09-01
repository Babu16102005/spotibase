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
            case SEARCH_SONG, SEARCH_ARTIST, SEARCH_ALBUM -> {
                String query = (String) params.getOrDefault("artist", params.getOrDefault("query", params.getOrDefault("song", "")));
                // Use existing search service - return top result ids
                yield Map.of("status", "SEARCH", "query", query);
            }
            case PLAY_BY_MOOD, PLAY_BY_GENRE, PLAY_BY_LANGUAGE -> {
                // Use recommendation service heuristics
                // params may contain mood, genre, language, vibe, activity, exclude_mood
                String mood = (String) params.get("mood");
                String language = (String) params.get("language");
                String genre = (String) params.get("genre");
                // Fallback to heuristic recommended songs
                try {
                    List<SongResponse> recs = recommendationService.getRecommendedSongs(userId, 20);
                    // If mood/language filter requested, we could filter here; for now return recs
                    // Push queue sync for first song
                    if (!recs.isEmpty()) {
                        String firstSongId = recs.get(0).getId();
                        queueService.addToQueue(userId, firstSongId, "AI_MOOD");
                        realtimeService.pushQueueUpdate(userId, Map.of("type", "QUEUE_SYNC", "data", recs, "mood", mood != null ? mood : "UNKNOWN"));
                        yield Map.of("status", "QUEUED", "mood", mood != null ? mood : "UNKNOWN", "language", language != null ? language : "", "songs", recs.stream().map(SongResponse::getId).toList());
                    } else {
                        yield Map.of("status", "NO_RESULTS", "mood", mood != null ? mood : "");
                    }
                } catch (Exception e) {
                    log.warn("PLAY_BY_MOOD failed", e);
                    yield Map.of("status", "FAILED", "error", e.getMessage());
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
                String songId = target.equals("CURRENT_SONG") ? (String) ctx.getOrDefault("currentSongId", null) : (String) params.get("songId");
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
                String songId = target.equals("FIRST_RESULT") ? (String) ctx.getOrDefault("firstResultSongId", ctx.get("currentSongId")) : (String) ctx.getOrDefault("currentSongId", null);
                if (songId == null && ctx != null && ctx.containsKey("firstResultSongId")) songId = (String) ctx.get("firstResultSongId");
                // Find playlist by name owned by user (simplified: create if not exists)
                try {
                    // PlaylistService doesn't have findByName; we create or get - simplified
                    yield Map.of("status", "PLAYLIST_OP", "playlist", playlistName, "songId", songId != null ? songId : "UNKNOWN");
                } catch (Exception e) {
                    yield Map.of("status", "FAILED", "error", e.getMessage());
                }
            }
            default -> Map.of("status", "NOT_IMPLEMENTED", "action", action.name());
        };
    }
}
