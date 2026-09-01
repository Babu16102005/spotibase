package com.spotibase.ai.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AssistantContext {
    private String currentSongId;
    private String currentArtist;
    private String currentAlbum;
    private String currentPlaylist;
    private boolean playing;
    private int queueSize;
    private String lastMood;
    private String lastSearch;
}
