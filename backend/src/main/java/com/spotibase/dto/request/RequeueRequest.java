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
public class RequeueRequest {

    @NotBlank(message = "Song ID is required")
    private String songId;

    @NotBlank(message = "Source is required")
    private String source; // SONG, ALBUM, PLAYLIST, SEARCH, QUEUE
}
