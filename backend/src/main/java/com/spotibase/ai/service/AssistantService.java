package com.spotibase.ai.service;

import com.spotibase.ai.AssistantAction;
import com.spotibase.ai.dto.AssistantCommand;
import com.spotibase.ai.dto.AssistantContext;
import com.spotibase.ai.dto.AssistantResponse;
import com.spotibase.ai.dto.VoicePartialResponse;
import com.spotibase.dto.response.SongResponse;
import com.spotibase.service.SearchService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.*;

@Service
@Slf4j
@RequiredArgsConstructor
public class AssistantService {

    private final SimpleCommandDetector simpleDetector;
    private final QwenClient qwenClient;
    private final ActionDispatcher dispatcher;
    private final SearchService searchService;

    /**
     * Realtime-partial allow-list: SEARCH-only preview. Mirrors FastAPI
     * {@code /speech/partial} PARTIAL_ALLOWED. Anything else is dropped so
     * this path can never queue, like, or edit playlists.
     */
    private static final Set<AssistantAction> PARTIAL_ALLOWED = EnumSet.of(
            AssistantAction.SEARCH_SONG, AssistantAction.SEARCH_ARTIST, AssistantAction.SEARCH_ALBUM);

    private static final List<String> PARTIAL_FALLBACK_SUGGESTIONS = List.of(
            "Play calm Tamil songs", "Play Anirudh hits", "Play 90s melodies");

    public AssistantResponse handleText(String userId, String text, AssistantContext context) {
        log.info("AI text request user={} text='{}'", userId, text);

        // 1. Simple command bypass (no LLM)
        Optional<AssistantCommand> simple = simpleDetector.detect(text);
        if (simple.isPresent()) {
            AssistantCommand cmd = simple.get();
            Map<String, Object> result = dispatcher.dispatch(userId, cmd, contextToMap(context));
            String resp = switch (cmd.getAction()) {
                case PAUSE -> "Pausing the song.";
                case RESUME -> "Resuming playback.";
                case NEXT -> "Skipping to next song.";
                case PREVIOUS -> "Going to previous song.";
                case LIKE_CURRENT -> "Liked the current song.";
                default -> cmd.getAction().name() + " executed.";
            };
            return AssistantResponse.builder()
                    .transcript(text)
                    .actions(List.of(cmd))
                    .response(resp)
                    .results(List.of(result))
                    .build();
        }

        // 2. Call Qwen (FastAPI) - fallback to mock if unavailable
        var qwenOpt = qwenClient.understandText(text, context);
        List<AssistantCommand> actions;
        String response;
        boolean clarification = false;
        String clarQ = null;

        if (qwenOpt.isPresent()) {
            var qr = qwenOpt.get();
            actions = qr.actions();
            response = qr.response();
            clarification = qr.clarificationNeeded();
            clarQ = qr.clarificationQuestion();
            if (actions.isEmpty() && !clarification) {
                // Qwen returned nothing -> fallback mock already handled inside QwenClient
                clarification = true;
                clarQ = "Could you rephrase?";
            }
        } else {
            // Mock fallback when FastAPI down
            log.warn("Qwen unavailable, using mock for text='{}'", text);
            actions = List.of(AssistantCommand.builder().action(AssistantAction.CLARIFICATION_NEEDED).parameters(Map.of()).build());
            response = "";
            clarification = true;
            clarQ = "AI service is currently unavailable. Try simple commands like 'next' or 'pause'.";
        }

        if (clarification) {
            return AssistantResponse.builder()
                    .transcript(text)
                    .actions(List.of())
                    .response("")
                    .clarificationNeeded(true)
                    .clarificationQuestion(clarQ)
                    .build();
        }

        // 3. Dispatch each action sequentially, collect results
        List<Map<String, Object>> results = new ArrayList<>();
        Map<String, Object> ctxMap = contextToMap(context);
        // Keep first result songId for multi-action like SEARCH/PLAY + ADD_TO_PLAYLIST
        for (AssistantCommand cmd : actions) {
            Map<String, Object> res = dispatcher.dispatch(userId, cmd, ctxMap);
            results.add(res);
            // Propagate for SEARCH too (not just PLAY_BY_MOOD): any result with
            // a non-empty songs[] feeds FIRST_RESULT follow-ups.
            if (res.containsKey("songs") && res.get("songs") instanceof List<?> songs && !songs.isEmpty()) {
                ctxMap.put("firstResultSongId", songs.get(0).toString());
            }
        }

        if (response == null || response.isBlank()) {
            response = "Done. Executed " + actions.size() + " action(s).";
        }

        return AssistantResponse.builder()
                .transcript(text)
                .actions(actions)
                .response(response)
                .results(results)
                .build();
    }

    public AssistantResponse handleVoice(String userId, byte[] audio, String filename, String transcriptFallback, AssistantContext context) {
        // Delegate STT+understand to FastAPI
        var qwenOpt = qwenClient.understandVoice(audio, filename, transcriptFallback, context);
        if (qwenOpt.isEmpty()) {
            // If voice path fails, fallback to text path with fallback transcript
            if (transcriptFallback != null && !transcriptFallback.isBlank()) {
                return handleText(userId, transcriptFallback, context);
            }
            return AssistantResponse.builder()
                    .transcript("")
                    .actions(List.of())
                    .clarificationNeeded(true)
                    .clarificationQuestion("I couldn't hear you. Please try again.")
                    .build();
        }
        var qr = qwenOpt.get();
        if (qr.clarificationNeeded()) {
            return AssistantResponse.builder()
                    .transcript(transcriptFallback != null ? transcriptFallback : "")
                    .actions(List.of())
                    .clarificationNeeded(true)
                    .clarificationQuestion(qr.clarificationQuestion())
                    .build();
        }
        // Dispatch
        List<Map<String, Object>> results = new ArrayList<>();
        Map<String, Object> ctxMap = contextToMap(context);
        // Voice path parity with handleText: propagate firstResultSongId for
        // SEARCH/PLAY results too, so follow-up actions (ADD_TO_PLAYLIST, etc.)
        // can use FIRST_RESULT.
        for (AssistantCommand cmd : qr.actions()) {
            Map<String, Object> res = dispatcher.dispatch(userId, cmd, ctxMap);
            results.add(res);
            if (res.containsKey("songs") && res.get("songs") instanceof List<?> songs && !songs.isEmpty()) {
                ctxMap.put("firstResultSongId", songs.get(0).toString());
            }
        }
        return AssistantResponse.builder()
                .transcript(transcriptFallback)
                .actions(qr.actions())
                .response(qr.response())
                .results(results)
                .build();
    }

    /**
     * Realtime partial preview: {@code {text, context}} to FastAPI
     * {@code POST /speech/partial} (800ms budget) then a read-only top-5
     * catalog lookup. NEVER dispatches, queues, likes, edits playlists, or
     * pushes realtime events — the full {@link #handleVoice} (3s) path
     * executes. Every failure returns a clarification preview (200 shape),
     * never throws.
     */
    public VoicePartialResponse handleVoicePartial(String userId, String text, AssistantContext context) {
        String transcript = text != null ? text : "";
        if (transcript.isBlank()) {
            return VoicePartialResponse.builder()
                    .transcript(transcript)
                    .actionsPreview(List.of())
                    .suggestions(new ArrayList<>(PARTIAL_FALLBACK_SUGGESTIONS))
                    .songs(List.of())
                    .searchQuery("")
                    .displayText("Keep speaking…")
                    .clarificationNeeded(true)
                    .clarificationQuestion("Keep speaking — I didn't catch that yet.")
                    .build();
        }

        var partialOpt = qwenClient.understandVoicePartialText(transcript, context);
        List<AssistantCommand> preview;
        List<String> suggestions;
        String searchQuery;
        boolean clarification = false;
        String clarQ = null;

        if (partialOpt.isPresent()) {
            var pr = partialOpt.get();
            // Belt-and-braces: FastAPI already filters to SEARCH-only, but
            // re-apply the allow-list here so a future AI drift can never
            // leak a queue/like action into a read-only preview.
            preview = pr.actionsPreview() != null
                    ? pr.actionsPreview().stream()
                            .filter(c -> c != null && c.getAction() != null && PARTIAL_ALLOWED.contains(c.getAction()))
                            .toList()
                    : List.of();
            suggestions = pr.suggestions() != null && !pr.suggestions().isEmpty()
                    ? pr.suggestions()
                    : new ArrayList<>(PARTIAL_FALLBACK_SUGGESTIONS);
            searchQuery = pr.searchQuery() != null ? pr.searchQuery() : "";
            clarification = pr.clarificationNeeded() || preview.isEmpty();
            clarQ = pr.clarificationQuestion();
            if (preview.isEmpty() && (clarQ == null || clarQ.isBlank())) {
                clarQ = "Keep speaking — try one of the suggestions below.";
            }
        } else {
            // 800ms timeout / AI down: read-only clarification preview with
            // fast suggestions derived from the raw transcript (no LLM).
            log.debug("Voice partial unavailable user={} text='{}', returning clarification preview",
                    userId, transcript.length() > 40 ? transcript.substring(0, 40) : transcript);
            preview = List.of();
            searchQuery = transcript.trim();
            suggestions = fastSuggestions(searchQuery);
            clarification = true;
            clarQ = "Keep speaking — try one of the suggestions below.";
        }

        // Read-only top-5 voice search (<150ms via V24 FTS+trigram+prefix
        // indexes). searchSongsForVoice never writes; no dispatcher call here.
        List<SongResponse> songs = List.of();
        String lookupQuery = !searchQuery.isBlank() ? searchQuery : transcript.trim();
        if (!lookupQuery.isBlank()) {
            try {
                songs = searchService.searchSongsForVoice(lookupQuery, userId);
            } catch (Exception e) {
                log.warn("Voice partial search failed for '{}'", lookupQuery, e);
                songs = List.of();
            }
            if (suggestions.size() <= 1) {
                try {
                    List<String> fast = searchService.getSuggestionsForVoice(lookupQuery);
                    if (!fast.isEmpty()) suggestions = fast;
                } catch (Exception e) {
                    log.debug("Voice partial suggestions failed: {}", e.getMessage());
                }
            }
        }

        String display = !songs.isEmpty() ? "Found " + songs.size() + " preview result(s)"
                : (clarQ != null ? clarQ : "Keep speaking…");
        return VoicePartialResponse.builder()
                .transcript(transcript)
                .actionsPreview(preview)
                .suggestions(suggestions)
                .songs(songs)
                .searchQuery(searchQuery)
                .displayText(display)
                .clarificationNeeded(clarification)
                .clarificationQuestion(clarification ? clarQ : null)
                .build();
    }

    /**
     * Instant offline suggestions for the partial-timeout path: echo the raw
     * transcript plus the default hints (no LLM, no DB).
     */
    private List<String> fastSuggestions(String query) {
        List<String> out = new ArrayList<>();
        if (query != null && !query.isBlank()) {
            out.add(query.trim());
        }
        for (String s : PARTIAL_FALLBACK_SUGGESTIONS) {
            if (out.size() >= 4) break;
            if (!out.contains(s)) out.add(s);
        }
        return out;
    }

    private Map<String, Object> contextToMap(AssistantContext ctx) {
        if (ctx == null) return new HashMap<>();
        Map<String, Object> m = new HashMap<>();
        if (ctx.getCurrentSongId() != null) m.put("currentSongId", ctx.getCurrentSongId());
        if (ctx.getCurrentArtist() != null) m.put("currentArtist", ctx.getCurrentArtist());
        if (ctx.getCurrentAlbum() != null) m.put("currentAlbum", ctx.getCurrentAlbum());
        if (ctx.getCurrentPlaylist() != null) m.put("currentPlaylist", ctx.getCurrentPlaylist());
        m.put("playing", ctx.isPlaying());
        m.put("queueSize", ctx.getQueueSize());
        if (ctx.getLastMood() != null) m.put("lastMood", ctx.getLastMood());
        return m;
    }
}
