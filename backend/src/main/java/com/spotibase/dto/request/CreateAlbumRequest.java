package com.spotibase.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CreateAlbumRequest {

    @NotBlank(message = "Album name is required")
    private String name;

    private String description;

    @NotBlank(message = "Artist ID is required")
    private String artistId;

    private String genreId;

    @NotNull(message = "Release date is required")
    private LocalDate releaseDate;

    private String type; // ALBUM, SINGLE, EP, COMPILATION
}
