package com.spotibase.dto.response;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class QueueResponse {
    private List<SongResponse> songs;
    private SongResponse currentSong;
    private int currentPosition;
    private int totalSongs;
    private long totalDurationMs;
}
