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

    public record QwenResponse(List<AssistantCommand> actions, String response, boolean clarificationNeeded, String clarificationQuestion) {}

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
                    .block();

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
            MultipartBodyBuilder builder = new MultipartBodyBuilder();
            builder.part("audio", new ByteArrayResource(audio) {
                @Override public String getFilename() { return filename != null ? filename : "audio.webm"; }
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
                    .block();

            if (resp == null) return Optional.empty();
            return Optional.of(mapToQwenResponse(resp));
        } catch (Exception e) {
            log.warn("Qwen voice understand failed: {}", e.getMessage());
            return Optional.empty();
        }
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
}
