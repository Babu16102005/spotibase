package com.spotibase.ai.controller;

import com.spotibase.ai.dto.AssistantContext;
import com.spotibase.ai.dto.AssistantRequest;
import com.spotibase.ai.dto.AssistantResponse;
import com.spotibase.ai.service.AssistantService;
import com.spotibase.security.CurrentUser;
import com.spotibase.security.CustomUserDetails;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/v1/ai")
@RequiredArgsConstructor
@Slf4j
public class AssistantController {

    private final AssistantService assistantService;

    @PostMapping("/text")
    public ResponseEntity<AssistantResponse> handleText(
            @CurrentUser CustomUserDetails user,
            @Valid @RequestBody AssistantRequest request) {
        String userId = user != null ? user.getId() : "anonymous";
        log.info("AI text from {}: {}", userId, request.getText());
        AssistantResponse resp = assistantService.handleText(userId, request.getText(), request.getContext());
        return ResponseEntity.ok(resp);
    }

    @PostMapping(value = "/voice", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<AssistantResponse> handleVoice(
            @CurrentUser CustomUserDetails user,
            @RequestParam("audio") MultipartFile audio,
            @RequestParam(value = "transcript_fallback", required = false) String transcriptFallback,
            @RequestParam(value = "currentSongId", required = false) String currentSongId,
            @RequestParam(value = "currentArtist", required = false) String currentArtist,
            @RequestParam(value = "playing", required = false, defaultValue = "false") boolean playing) {
        try {
            String userId = user != null ? user.getId() : "anonymous";
            byte[] bytes = audio.getBytes();
            String filename = audio.getOriginalFilename();
            log.info("AI voice from {} file={} size={} fallback='{}'", userId, filename, bytes.length, transcriptFallback);

            if (bytes.length > 15 * 1024 * 1024) {
                return ResponseEntity.badRequest().body(AssistantResponse.builder()
                        .clarificationNeeded(true)
                        .clarificationQuestion("Audio too large (max 15MB)")
                        .build());
            }

            AssistantContext ctx = AssistantContext.builder()
                    .currentSongId(currentSongId)
                    .currentArtist(currentArtist)
                    .playing(playing)
                    .build();

            AssistantResponse resp = assistantService.handleVoice(userId, bytes, filename, transcriptFallback, ctx);
            return ResponseEntity.ok(resp);
        } catch (Exception e) {
            log.error("AI voice failed", e);
            return ResponseEntity.internalServerError().body(AssistantResponse.builder()
                    .clarificationNeeded(true)
                    .clarificationQuestion("Voice processing failed: " + e.getMessage())
                    .build());
        }
    }

    @GetMapping("/health")
    public ResponseEntity<?> health() {
        return ResponseEntity.ok(java.util.Map.of("status", "ok", "service", "spotibase-ai-orchestrator"));
    }
}
