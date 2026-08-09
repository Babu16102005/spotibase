package com.spotibase.dto.request;

import jakarta.validation.constraints.NotEmpty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AddSongsToPlaylistRequest {

    @NotEmpty(message = "Song IDs are required")
    private List<String> songIds;

    private Integer position; // null = append to end
}
