package com.spotibase.dto.response;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PlaylistResponse {
    private String id;
    private String name;
    private String description;
    private String userId;
    private String username;
    private String coverUrl;
    private boolean isPublic;
    private boolean isCollaborative;
    private int songCount;
    private long totalDurationMs;
    private String type;
    private boolean archived;
    private boolean featured;
    private long likeCount;
    private boolean liked;
    private List<SongResponse> songs;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
