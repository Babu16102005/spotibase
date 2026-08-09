package com.spotibase.dto.request;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UpdatePlaylistRequest {

    private String name;
    private String description;
    private String coverUrl;
    private Boolean isPublic;
    private Boolean isCollaborative;
    private Boolean archived;
    private String type;
}
