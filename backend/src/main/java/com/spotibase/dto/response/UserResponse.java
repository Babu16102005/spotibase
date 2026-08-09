package com.spotibase.dto.response;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.Set;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UserResponse {
    private String id;
    private String email;
    private String username;
    private String avatarUrl;
    private String coverUrl;
    private String bio;
    private String country;
    private Set<String> favoriteGenres;
    private String role;
    private boolean emailVerified;
    private long totalListeningTimeMs;
    private int followerCount;
    private int followingCount;
    private LocalDateTime createdAt;
}
