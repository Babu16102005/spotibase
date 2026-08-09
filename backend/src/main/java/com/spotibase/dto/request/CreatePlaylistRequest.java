package com.spotibase.dto.request;

import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CreatePlaylistRequest {

    @NotBlank(message = "Playlist name is required")
    private String name;

    private String description;
    @Builder.Default
    private boolean isPublic = true;
    @Builder.Default
    private boolean isCollaborative = false;
}
