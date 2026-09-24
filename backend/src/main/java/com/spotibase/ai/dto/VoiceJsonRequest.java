package com.spotibase.ai.dto;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * JSON fallback for {@code POST /api/v1/ai/voice}.
 *
 * <p>Mobile clients that have no audio bytes (recording failed, simulator, or
 * transcript-only retry) POST {@code Content-Type: application/json} with a
 * transcript fallback plus optional context. Supports BOTH a nested
 * {@code context} object and flat fields ({@code currentSongId/currentArtist/playing});
 * flat fields win when present — same precedence as the multipart overload.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
public class VoiceJsonRequest {

    /** Transcript fallback. Accepts {@code transcriptFallback} or {@code transcript_fallback}. */
    @JsonAlias({"transcript_fallback", "transcript"})
    private String transcriptFallback;

    /** Nested context object (optional). */
    private AssistantContext context;

    /** Flat context fields (optional, override {@code context} when present). */
    private String currentSongId;

    private String currentArtist;

    private String currentAlbum;

    private String currentPlaylist;

    private Boolean playing;

    private Integer queueSize;

    private String lastMood;

    private String lastSearch;
}
