package com.spotibase.dto.response;

import com.spotibase.entity.ContributionRole;
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
public class SongResponse {
    private String id;
    private String title;  // renamed from name
    private String artistId;
    private String artistName;
    
    // NEW: Album artist (for compilations)
    private String albumArtistId;
    private String albumArtistName;
    
    private String albumId;
    private String albumName;
    private String genreId;
    private String genreName;
    private String language;
    private String composer;
    private String lyrics;
    private String duration;
    private long durationMs;
    private LocalDate releaseDate;
    private int trackNumber;
    private int discNumber;
    private String fileUrl;
    private String coverUrl;
    private String fileFormat;
    private long fileSize;
    private int bitrate;
    private int sampleRate;
    private boolean explicit;
    private boolean archived;
    private boolean featured;
    private long playCount;
    private boolean liked;
    private LocalDateTime createdAt;

    // NEW: Contributing artists for display
    private List<ContributingArtistDto> contributingArtists;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ContributingArtistDto {
        private String artistId;
        private String artistName;
        private ContributionRole role;    // FEATURING, REMIXER, PRODUCER, WRITER, etc.
        private int position;
    }
}