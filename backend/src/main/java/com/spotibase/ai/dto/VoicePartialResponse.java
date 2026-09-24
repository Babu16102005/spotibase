package com.spotibase.ai.dto;

import com.spotibase.dto.response.SongResponse;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Realtime-partial response for {@code POST /api/v1/ai/voice-partial}.
 *
 * <p>Read-only preview contract: {@code actions_preview} carries only
 * SEARCH allow-listed actions ({@code SEARCH_SONG / SEARCH_ARTIST /
 * SEARCH_ALBUM}); {@code songs} are the top-5 fast voice-search hits
 * (never queued); {@code suggestions} are fast autocomplete hints.
 * Every failure answers 200 with {@code clarificationNeeded=true}
 * (never 500 generic) so the mobile client can keep rendering partials.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class VoicePartialResponse {
    private String transcript;

    private List<AssistantCommand> actionsPreview;

    private List<String> suggestions;

    private List<SongResponse> songs;

    private String searchQuery;

    private String displayText;

    private boolean clarificationNeeded;

    private String clarificationQuestion;
}
