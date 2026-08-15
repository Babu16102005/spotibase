package com.spotibase.dto.request;

import com.spotibase.entity.ContributionRole;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;
import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CreateSongRequest {

    @NotBlank(message = "Song title is required")
    private String title;

    // OPTIONAL: Primary artist - if not provided, will create/find "Unknown Artist"
    private String artistId;

    // OPTIONAL: Artist by name (bulk upload) - resolved or auto-created when artistId is absent
    private String artistName;

    // OPTIONAL: Album by name (bulk upload) - resolved or auto-created when albumId is absent
    private String albumName;

    // OPTIONAL: Genre by name (bulk upload) - resolved or auto-created when genreId is absent
    private String genreName;

    // OPTIONAL: Album artist (for compilations, various artists albums)
    private String albumArtistId;

    // OPTIONAL: Album
    private String albumId;

    // OPTIONAL: Genre
    private String genreId;

    // OPTIONAL: Contributing artists (featuring, remixers, producers, etc.)
    private List<ContributingArtistRequest> contributingArtists;

    // Other optional metadata
    private String language;
    private String composer;
    private String lyrics;

    @NotNull(message = "Release date is required")
    private LocalDate releaseDate;

    private int trackNumber = 1;
    private int discNumber = 1;
    private boolean explicit = false;
    private String fileFormat;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ContributingArtistRequest {

        @NotBlank(message = "Artist ID is required for contributing artist")
        private String artistId;

        @NotNull(message = "Role is required for contributing artist")
        private ContributionRole role;

        private int position = 0;
    }
}