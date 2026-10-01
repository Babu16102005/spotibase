package com.spotibase.ai.service;

import com.spotibase.ai.dto.AssistantCommand;
import com.spotibase.ai.dto.AssistantContext;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.MediaType;
import org.springframework.http.client.MultipartBodyBuilder;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;

import java.time.Duration;
import java.util.*;

@Service
@Slf4j
@RequiredArgsConstructor
public class QwenClient {

    private final WebClient aiWebClient;

    @Value("${ai.enabled:true}")
    private boolean aiEnabled;

    @Value("${ai.fallback-on-error:true}")
    private boolean fallbackOnError = true;

    /** Partial (fast) budget for voice STT; full understand budgets. */
    private static final Duration PARTIAL_TIMEOUT = Duration.ofMillis(800);
    /** Text understand budget (CF p50 ~1.6s, p95 ~3.2s — 3s keeps failures fast). */
    private static final Duration TEXT_TIMEOUT = Duration.ofSeconds(3);
    /**
     * Voice full budget: STT + CF understand (CF_TIMEOUT_S=4.0) + 1s retry +
     * mock fallback + understand cache. 9s covers the full chain so the
     * per-request timeout never fires before CF finishes.
     */
    private static final Duration VOICE_FULL_TIMEOUT = Duration.ofSeconds(9);

    public record QwenResponse(List<AssistantCommand> actions, String response, boolean clarificationNeeded, String clarificationQuestion) {}

    /**
     * Realtime-partial response from {@code POST /speech/partial}: SEARCH-only
     * preview plus the search query and suggestions for read-only rendering.
     */
    public record PartialQwenResponse(List<AssistantCommand> actionsPreview, String response,
                                      boolean clarificationNeeded, String clarificationQuestion,
                                      List<String> suggestions, String searchQuery) {}

    @SuppressWarnings("unchecked")
    public Optional<QwenResponse> understandText(String text, AssistantContext context) {
        if (!aiEnabled) {
            log.debug("AI disabled, skipping Qwen");
            return Optional.empty();
        }
        try {
            Map<String, Object> body = new HashMap<>();
            body.put("text", text);
            if (context != null) body.put("context", context);

            Map<String, Object> resp = aiWebClient.post()
                    .uri("/assistant/understand")
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(body)
                    .retrieve()
                    .bodyToMono(Map.class)
                    .timeout(TEXT_TIMEOUT)
                    .block(TEXT_TIMEOUT);

            if (resp == null) return Optional.empty();
            return Optional.of(mapToQwenResponse(resp));
        } catch (Exception e) {
            log.warn("Qwen text understand failed: {}", e.getMessage());
            return Optional.empty();
        }
    }

    @SuppressWarnings("unchecked")
    public Optional<QwenResponse> understandVoice(byte[] audio, String filename, String transcriptFallback, AssistantContext context) {
        if (!aiEnabled) return Optional.empty();
        try {
            String normalized = normalizeVoiceFilename(filename);
            MultipartBodyBuilder builder = new MultipartBodyBuilder();
            builder.part("audio", new ByteArrayResource(audio) {
                @Override public String getFilename() { return normalized; }
            });
            if (transcriptFallback != null) builder.part("transcript_fallback", transcriptFallback);
            if (context != null) {
                com.fasterxml.jackson.databind.ObjectMapper om = new com.fasterxml.jackson.databind.ObjectMapper();
                builder.part("context", om.writeValueAsString(context));
            }

            // Full 9s budget for STT+understand (AiConfig responseTimeout backs this;
            // per-request timeout below guarantees fallback even if connector config drifts).
            Map<String, Object> resp = aiWebClient.post()
                    .uri("/speech/voice")
                    .contentType(MediaType.MULTIPART_FORM_DATA)
                    .bodyValue(builder.build())
                    .retrieve()
                    .bodyToMono(Map.class)
                    .timeout(VOICE_FULL_TIMEOUT)
                    .block(VOICE_FULL_TIMEOUT);

            if (resp == null) return Optional.empty();
            return Optional.of(mapToQwenResponse(resp));
        } catch (Exception e) {
            log.warn("Qwen voice understand failed: {}", e.getMessage());
            return Optional.empty();
        }
    }

    /**
     * Partial-timeout variant for latency-sensitive voice callers: fails fast
     * after 800ms so the caller can render a partial state, then the full
     * {@link #understandVoice} path (9s) completes the result.
     */
    public Optional<QwenResponse> understandVoicePartial(byte[] audio, String filename,
                                                         String transcriptFallback, AssistantContext context) {
        if (!aiEnabled) return Optional.empty();
        try {
            String normalized = normalizeVoiceFilename(filename);
            MultipartBodyBuilder builder = new MultipartBodyBuilder();
            builder.part("audio", new ByteArrayResource(audio) {
                @Override public String getFilename() { return normalized; }
            });
            if (transcriptFallback != null) builder.part("transcript_fallback", transcriptFallback);
            if (context != null) {
                com.fasterxml.jackson.databind.ObjectMapper om = new com.fasterxml.jackson.databind.ObjectMapper();
                builder.part("context", om.writeValueAsString(context));
            }
            Map<String, Object> resp = aiWebClient.post()
                    .uri("/speech/voice")
                    .contentType(MediaType.MULTIPART_FORM_DATA)
                    .bodyValue(builder.build())
                    .retrieve()
                    .bodyToMono(Map.class)
                    .timeout(PARTIAL_TIMEOUT)
                    .block(PARTIAL_TIMEOUT);
            if (resp == null) return Optional.empty();
            return Optional.of(mapToQwenResponse(resp));
        } catch (Exception e) {
            log.debug("Qwen voice partial (800ms) timed out, caller should use full path: {}", e.getMessage());
            return Optional.empty();
        }
    }

    /**
     * Realtime text-partial: {@code {text, context}} JSON to FastAPI
     * {@code POST /speech/partial} with the 800ms partial budget. Returns the
     * SEARCH-only preview (suggestions + searchQuery included) or empty on
     * timeout/AI-disabled so the caller answers a 200 clarification.
     * Read-only by construction: the FastAPI partial path drops every
     * non-SEARCH action, and callers must never dispatch from this result.
     */
    @SuppressWarnings("unchecked")
    public Optional<PartialQwenResponse> understandVoicePartialText(String text, AssistantContext context) {
        if (!aiEnabled) return Optional.empty();
        if (text == null || text.isBlank()) return Optional.empty();
        try {
            Map<String, Object> body = new HashMap<>();
            body.put("text", text);
            if (context != null) body.put("context", context);

            Map<String, Object> resp = aiWebClient.post()
                    .uri("/speech/partial")
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(body)
                    .retrieve()
                    .bodyToMono(Map.class)
                    .timeout(PARTIAL_TIMEOUT)
                    .block(PARTIAL_TIMEOUT);

            if (resp == null) return Optional.empty();
            return Optional.of(mapToPartialResponse(resp));
        } catch (Exception e) {
            log.debug("Qwen voice partial-text (800ms) timed out for text='{}': {}",
                    text.length() > 40 ? text.substring(0, 40) : text, e.getMessage());
            return Optional.empty();
        }
    }

    /** Keep iOS audio.m4a vs Android/web audio.webm extensions intact for STT decoding. */
    private String normalizeVoiceFilename(String filename) {
        if (filename == null || filename.isBlank()) return "audio.webm";
        String lower = filename.toLowerCase();
        if (lower.endsWith(".m4a") || lower.endsWith(".mp4") || lower.endsWith(".aac")
                || lower.endsWith(".webm") || lower.endsWith(".ogg")
                || lower.endsWith(".wav") || lower.endsWith(".mp3")) {
            return filename;
        }
        return "audio.webm";
    }

    @SuppressWarnings("unchecked")
    private QwenResponse mapToQwenResponse(Map<String, Object> resp) {
        List<Map<String, Object>> rawActions = (List<Map<String, Object>>) resp.getOrDefault("actions", List.of());
        List<AssistantCommand> actions = new ArrayList<>();
        for (Map<String, Object> ra : rawActions) {
            try {
                String actStr = (String) ra.get("action");
                com.spotibase.ai.AssistantAction act = com.spotibase.ai.AssistantAction.valueOf(actStr);
                Map<String, Object> params = (Map<String, Object>) ra.getOrDefault("parameters", Map.of());
                actions.add(AssistantCommand.builder().action(act).parameters(params).build());
            } catch (Exception ex) {
                log.warn("Invalid action from Qwen: {}", ra);
            }
        }
        String response = (String) resp.getOrDefault("response", "");
        boolean clar = Boolean.TRUE.equals(resp.get("clarificationNeeded")) || Boolean.TRUE.equals(resp.get("clarification_needed"));
        String clarQ = (String) resp.getOrDefault("clarificationQuestion", resp.get("clarification_question"));
        return new QwenResponse(actions, response, clar, clarQ);
    }

    @SuppressWarnings("unchecked")
    private PartialQwenResponse mapToPartialResponse(Map<String, Object> resp) {
        List<Map<String, Object>> rawActions = (List<Map<String, Object>>) resp.getOrDefault("actions", List.of());
        List<AssistantCommand> actions = new ArrayList<>();
        for (Map<String, Object> ra : rawActions) {
            try {
                String actStr = (String) ra.get("action");
                com.spotibase.ai.AssistantAction act = com.spotibase.ai.AssistantAction.valueOf(actStr);
                Map<String, Object> params = (Map<String, Object>) ra.getOrDefault("parameters", Map.of());
                actions.add(AssistantCommand.builder().action(act).parameters(params).build());
            } catch (Exception ex) {
                log.warn("Invalid partial action from Qwen: {}", ra);
            }
        }
        String response = (String) resp.getOrDefault("response", "");
        boolean clar = Boolean.TRUE.equals(resp.get("clarificationNeeded")) || Boolean.TRUE.equals(resp.get("clarification_needed"));
        String clarQ = (String) resp.getOrDefault("clarificationQuestion", resp.get("clarification_question"));
        List<String> suggestions = new ArrayList<>();
        Object rawSug = resp.getOrDefault("suggestions", List.of());
        if (rawSug instanceof List<?> list) {
            for (Object o : list) {
                if (o != null) suggestions.add(String.valueOf(o));
            }
        }
        Object rawQuery = resp.getOrDefault("searchQuery", resp.get("search_query"));
        String searchQuery = rawQuery instanceof String s ? s : "";
        return new PartialQwenResponse(actions, response, clar, clarQ, suggestions, searchQuery);
    }
}
