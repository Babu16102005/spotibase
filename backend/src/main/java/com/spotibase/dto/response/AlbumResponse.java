package com.spotibase.dto.response;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AlbumResponse {
    private String id;
    private String name;
    private String description;
    private String artistId;
    private String artistName;
    private String genreId;
    private String genreName;
    private String coverUrl;
    private LocalDate releaseDate;
    private int songCount;
    private long totalDurationMs;
    private String type;
    private boolean archived;
    private boolean featured;
    private boolean liked;
    private List<SongResponse> songs;
    private LocalDateTime createdAt;
}
