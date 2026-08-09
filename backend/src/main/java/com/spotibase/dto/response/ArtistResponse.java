package com.spotibase.dto.response;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ArtistResponse {
    private String id;
    private String name;
    private String bio;
    private String imageUrl;
    private String coverUrl;
    private long monthlyListeners;
    private long followerCount;
    private boolean verified;
    private boolean followed;
    private int albumCount;
    private int songCount;
    private LocalDateTime createdAt;
}
