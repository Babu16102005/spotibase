package com.spotibase.ai.service;

import com.spotibase.ai.AssistantAction;
import com.spotibase.ai.dto.AssistantCommand;
import com.spotibase.ai.dto.AssistantContext;
import com.spotibase.ai.dto.AssistantResponse;
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
        // Keep first result songId for multi-action like PLAY + ADD_TO_PLAYLIST
        for (AssistantCommand cmd : actions) {
            Map<String, Object> res = dispatcher.dispatch(userId, cmd, ctxMap);
            results.add(res);
            // If this was PLAY_BY_MOOD and produced songs, store first for next action
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
        for (AssistantCommand cmd : qr.actions()) {
            results.add(dispatcher.dispatch(userId, cmd, ctxMap));
        }
        return AssistantResponse.builder()
                .transcript(transcriptFallback)
                .actions(qr.actions())
                .response(qr.response())
                .results(results)
                .build();
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
