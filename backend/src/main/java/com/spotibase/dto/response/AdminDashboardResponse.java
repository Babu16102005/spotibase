package com.spotibase.dto.response;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AdminDashboardResponse {
    private long totalUsers;
    private long activeUsers;
    private long totalSongs;
    private long totalAlbums;
    private long totalArtists;
    private long totalPlaylists;
    private long totalListeningHours;
    private long totalDownloads;

    private long totalStorageUsedBytes;
    private long maxStorageLimitBytes;
    private long maxStorageThresholdBytes;
    private boolean storageLimitReached;
    private long r2ObjectCount;
    private String storageProvider;

    private List<Map<String, Object>> topSongs;
    private List<Map<String, Object>> topArtists;
    private List<Map<String, Object>> topGenres;
    private List<Map<String, Object>> userGrowth;
    private List<Map<String, Object>> recentUsers;
}
