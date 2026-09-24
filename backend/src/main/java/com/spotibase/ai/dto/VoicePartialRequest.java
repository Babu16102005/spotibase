package com.spotibase.ai.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Realtime-partial request for {@code POST /api/v1/ai/voice-partial}.
 *
 * <p>Carries the device-side partial transcript (text only, no audio bytes)
 * plus optional assistant context. Read-only preview: the service layer never
 * queues, likes, or edits playlists for this path — the full
 * {@code POST /api/v1/ai/voice} (3s) executes the real actions.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class VoicePartialRequest {
    @NotBlank(message = "Text is required")
    @Size(max = 2000, message = "Text must be at most 2000 characters")
    private String text;

    private AssistantContext context;
}
