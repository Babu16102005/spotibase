package com.spotibase.service;

import com.spotibase.dto.response.AdminDashboardResponse;
import com.spotibase.dto.response.PagedResponse;
import com.spotibase.dto.response.UserResponse;
import com.spotibase.entity.Artist;
import com.spotibase.entity.Playlist;
import com.spotibase.entity.Role;
import com.spotibase.entity.Song;
import com.spotibase.entity.User;
import com.spotibase.exception.ResourceNotFoundException;
import com.spotibase.repository.AlbumRepository;
import com.spotibase.repository.ArtistRepository;
import com.spotibase.repository.DownloadRepository;
import com.spotibase.repository.ListeningHistoryRepository;
import com.spotibase.repository.PlaylistRepository;
import com.spotibase.repository.SongRepository;
import com.spotibase.repository.UserRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.persistence.Query;
import jakarta.persistence.TypedQuery;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
@Transactional
public class AdminService {

    private final UserRepository userRepository;
    private final SongRepository songRepository;
    private final AlbumRepository albumRepository;
    private final ArtistRepository artistRepository;
    private final PlaylistRepository playlistRepository;
    private final ListeningHistoryRepository listeningHistoryRepository;
    private final DownloadRepository downloadRepository;
    private final UserService userService;
    private final StorageService storageService;

    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private OrphanStorageCleanupScheduler orphanStorageCleanupScheduler;

    @PersistenceContext
    private EntityManager entityManager;

    @Transactional(readOnly = true)
    public AdminDashboardResponse getDashboard() {
        LocalDateTime thirtyDaysAgo = LocalDateTime.now().minusDays(30);

        long totalUsers = userRepository.count();
        long activeUsers = listeningHistoryRepository.countActiveUsersSince(thirtyDaysAgo);
        long totalSongs = songRepository.countActiveSongs();
        long totalAlbums = albumRepository.countActiveAlbums();
        long totalArtists = artistRepository.countArtists();
        long totalPlaylists = playlistRepository.countPlaylists();
        long totalListeningMs = listeningHistoryRepository.totalListeningTimeSince(thirtyDaysAgo);
        long totalListeningHours = totalListeningMs / 3600000;
        long totalDownloads = downloadRepository.count();

        long totalStorageUsedBytes = 0L;
        long r2ObjectCount = 0L;
        String storageProvider = "Cloudflare R2 (Live Connected)";
        if (storageService != null) {
            try {
                var stats = storageService.getLiveStorageStats();
                totalStorageUsedBytes = stats.totalBytes();
                r2ObjectCount = stats.objectCount();
                storageProvider = stats.connected() ? "Cloudflare R2 (Live Connected)" : "Database Estimate";
            } catch (Exception e) {
                log.warn("Could not retrieve live total storage used bytes: {}", e.getMessage());
            }
        }
        long maxStorageLimitBytes = 10L * 1024 * 1024 * 1024; // 10 GB
        long maxStorageThresholdBytes = (long) (9.5 * 1024 * 1024 * 1024); // 9.5 GB
        boolean storageLimitReached = totalStorageUsedBytes >= maxStorageThresholdBytes;

        return AdminDashboardResponse.builder()
                .totalUsers(totalUsers)
                .activeUsers(activeUsers)
                .totalSongs(totalSongs)
                .totalAlbums(totalAlbums)
                .totalArtists(totalArtists)
                .totalPlaylists(totalPlaylists)
                .totalListeningHours(totalListeningHours)
                .totalDownloads(totalDownloads)
                .totalStorageUsedBytes(totalStorageUsedBytes)
                .maxStorageLimitBytes(maxStorageLimitBytes)
                .maxStorageThresholdBytes(maxStorageThresholdBytes)
                .storageLimitReached(storageLimitReached)
                .r2ObjectCount(r2ObjectCount)
                .storageProvider(storageProvider)
                .topSongs(getTopSongs(10))
                .topArtists(getTopArtists(10))
                .topGenres(getTopGenres(10))
                .userGrowth(getUserGrowth("monthly"))
                .recentUsers(getRecentUsers(10))
                .build();
    }

    @Transactional(readOnly = true)
    public PagedResponse<UserResponse> getAllUsers(int page, int size) {
        TypedQuery<User> query = entityManager.createQuery(
                "SELECT u FROM User u WHERE u.active = true ORDER BY u.createdAt DESC", User.class);
        query.setFirstResult(page * size);
        query.setMaxResults(size);

        TypedQuery<Long> countQuery = entityManager.createQuery(
                "SELECT COUNT(u) FROM User u WHERE u.active = true", Long.class);

        List<User> users = query.getResultList();
        long total = countQuery.getSingleResult();

        List<UserResponse> content = users.stream()
                .map(this::toUserResponse)
                .collect(Collectors.toList());

        int totalPages = (int) Math.ceil((double) total / size);

        return PagedResponse.<UserResponse>builder()
                .content(content)
                .page(page)
                .size(size)
                .totalElements(total)
                .totalPages(totalPages)
                .first(page == 0)
                .last(page >= totalPages - 1)
                .build();
    }

    public UserResponse updateUserRole(String userId, String role) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User", userId));
        try {
            user.setRole(Role.valueOf(role.toUpperCase()));
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("Invalid role: " + role);
        }
        userRepository.save(user);
        log.info("User {} role updated to {}", userId, role);
        return userService.toUserResponse(user);
    }

    public void forceDeleteSong(String songId) {
        Song song = songRepository.findById(songId)
                .orElseThrow(() -> new ResourceNotFoundException("Song", songId));

        // Delete audio and cover files from live Cloudflare R2 / Supabase storage
        if (storageService != null) {
            if (song.getFileUrl() != null && !song.getFileUrl().isBlank()) {
                try {
                    storageService.deleteFileByUrl(song.getFileUrl());
                } catch (Exception e) {
                    log.warn("Failed to delete audio file {}: {}", song.getFileUrl(), e.getMessage());
                }
            }
            if (song.getCoverUrl() != null && !song.getCoverUrl().isBlank()) {
                try {
                    storageService.deleteFileByUrl(song.getCoverUrl());
                } catch (Exception e) {
                    log.warn("Failed to delete cover file {}: {}", song.getCoverUrl(), e.getMessage());
                }
            }
            storageService.invalidateStorageCache();
        }

        try {
            Query q1 = entityManager.createNativeQuery("DELETE FROM liked_songs WHERE song_id = :songId");
            q1.setParameter("songId", songId);
            q1.executeUpdate();

            Query q2 = entityManager.createNativeQuery("DELETE FROM listening_history WHERE song_id = :songId");
            q2.setParameter("songId", songId);
            q2.executeUpdate();

            Query q3 = entityManager.createNativeQuery("DELETE FROM queues WHERE song_id = :songId");
            q3.setParameter("songId", songId);
            q3.executeUpdate();

            Query q4 = entityManager.createNativeQuery("DELETE FROM playlist_songs WHERE song_id = :songId");
            q4.setParameter("songId", songId);
            q4.executeUpdate();

            Query q5 = entityManager.createNativeQuery("DELETE FROM downloads WHERE song_id = :songId");
            q5.setParameter("songId", songId);
            q5.executeUpdate();

            Query q6 = entityManager.createNativeQuery("DELETE FROM song_contributing_artists WHERE song_id = :songId");
            q6.setParameter("songId", songId);
            q6.executeUpdate();

            Query q7 = entityManager.createNativeQuery("DELETE FROM recently_played WHERE item_id = :songId AND item_type = 'SONG'");
            q7.setParameter("songId", songId);
            q7.executeUpdate();

            if (song.getAlbum() != null) {
                Query q8 = entityManager.createNativeQuery("UPDATE albums SET song_count = GREATEST(song_count - 1, 0) WHERE id = :albumId");
                q8.setParameter("albumId", song.getAlbum().getId());
                q8.executeUpdate();
            }
        } catch (Exception e) {
            log.warn("Error cleaning up relations for song {}: {}", songId, e.getMessage());
        }

        songRepository.delete(song);
        log.info("Song {} force deleted by admin (storage files deleted & cache invalidated)", songId);
    }

    public AdminDashboardResponse syncStorage() {
        if (orphanStorageCleanupScheduler != null) {
            try {
                orphanStorageCleanupScheduler.purgeOrphanedStorageObjects(true);
            } catch (Exception e) {
                log.warn("Could not purge orphaned storage objects during sync: {}", e.getMessage());
            }
        }
        if (storageService != null) {
            storageService.invalidateStorageCache();
        }
        return getDashboard();
    }

    @Transactional
    public AdminDashboardResponse clearAllSongsAndStorage() {
        // 1. Purge all physical objects from Cloudflare R2 / storage
        try {
            if (storageService != null) {
                storageService.clearAllR2Storage();
            }
        } catch (Exception e) {
            log.error("Error clearing R2 storage: {}", e.getMessage(), e);
        }

        // 2. Clear all relational database records referencing songs
        try {
            entityManager.createNativeQuery("DELETE FROM liked_songs").executeUpdate();
            entityManager.createNativeQuery("DELETE FROM listening_history").executeUpdate();
            entityManager.createNativeQuery("DELETE FROM queues").executeUpdate();
            entityManager.createNativeQuery("DELETE FROM playlist_songs").executeUpdate();
            entityManager.createNativeQuery("DELETE FROM downloads").executeUpdate();
            entityManager.createNativeQuery("DELETE FROM song_contributing_artists").executeUpdate();
            entityManager.createNativeQuery("DELETE FROM recently_played WHERE item_type = 'SONG'").executeUpdate();
            entityManager.createNativeQuery("UPDATE albums SET song_count = 0, total_duration_ms = 0").executeUpdate();
        } catch (Exception e) {
            log.warn("Warning during table cleanup: {}", e.getMessage());
        }

        // 3. Delete all song entities
        songRepository.deleteAll();

        if (storageService != null) {
            storageService.invalidateStorageCache();
        }

        log.info("ALL songs and Cloudflare R2 storage cleared to 0 MB");
        return getDashboard();
    }

    public void forceDeletePlaylist(String playlistId) {
        Playlist playlist = playlistRepository.findById(playlistId)
                .orElseThrow(() -> new ResourceNotFoundException("Playlist", playlistId));

        Query deletePlaylistSongs = entityManager.createNativeQuery(
                "DELETE FROM playlist_songs WHERE playlist_id = :playlistId");
        deletePlaylistSongs.setParameter("playlistId", playlistId);
        deletePlaylistSongs.executeUpdate();

        Query deleteLikedPlaylists = entityManager.createNativeQuery(
                "DELETE FROM liked_playlists WHERE playlist_id = :playlistId");
        deleteLikedPlaylists.setParameter("playlistId", playlistId);
        deleteLikedPlaylists.executeUpdate();

        playlistRepository.delete(playlist);
        log.info("Playlist {} force deleted by admin", playlistId);
    }

    public void forceDeleteAlbum(String albumId) {
        com.spotibase.entity.Album album = albumRepository.findById(albumId)
                .orElseThrow(() -> new ResourceNotFoundException("Album", albumId));

        Query updateSongs = entityManager.createNativeQuery(
                "UPDATE songs SET album_id = NULL WHERE album_id = :albumId");
        updateSongs.setParameter("albumId", albumId);
        updateSongs.executeUpdate();

        Query deleteLikedAlbums = entityManager.createNativeQuery(
                "DELETE FROM liked_albums WHERE album_id = :albumId");
        deleteLikedAlbums.setParameter("albumId", albumId);
        deleteLikedAlbums.executeUpdate();

        albumRepository.delete(album);
        log.info("Album {} force deleted by admin", albumId);
    }

    public void forceDeleteArtist(String artistId) {
        Artist artist = artistRepository.findById(artistId)
                .orElseThrow(() -> new ResourceNotFoundException("Artist", artistId));

        Query deleteFollowedArtists = entityManager.createNativeQuery(
                "DELETE FROM followed_artists WHERE artist_id = :artistId");
        deleteFollowedArtists.setParameter("artistId", artistId);
        deleteFollowedArtists.executeUpdate();

        artistRepository.delete(artist);
        log.info("Artist {} force deleted by admin", artistId);
    }

    public void forceDeleteUser(String userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User", userId));
        user.setActive(false);
        userRepository.save(user);
        log.info("User {} deleted (deactivated) by admin", userId);
    }

    public void featureSong(String songId) {
        Song song = songRepository.findById(songId)
                .orElseThrow(() -> new ResourceNotFoundException("Song", songId));
        song.setFeatured(!song.isFeatured());
        songRepository.save(song);
        log.info("Song {} featured set to {}", songId, song.isFeatured());
    }

    public void featurePlaylist(String playlistId) {
        Playlist playlist = playlistRepository.findById(playlistId)
                .orElseThrow(() -> new ResourceNotFoundException("Playlist", playlistId));
        playlist.setFeatured(!playlist.isFeatured());
        playlistRepository.save(playlist);
        log.info("Playlist {} featured set to {}", playlistId, playlist.isFeatured());
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> getUserGrowth(String period) {
        String trunc;
        switch (period.toLowerCase()) {
            case "daily":
                trunc = "day";
                break;
            case "weekly":
                trunc = "week";
                break;
            case "monthly":
            default:
                trunc = "month";
                break;
        }

        Query query = entityManager.createNativeQuery(
                "SELECT DATE_TRUNC(:trunc, created_at) AS period, COUNT(*) AS count " +
                "FROM users WHERE active = true " +
                "GROUP BY period ORDER BY period DESC");
        query.setParameter("trunc", trunc);
        List<Object[]> rows = query.getResultList();

        List<Map<String, Object>> result = new ArrayList<>();
        for (Object[] row : rows) {
            Map<String, Object> entry = new HashMap<>();
            entry.put("period", row[0] != null ? row[0].toString() : null);
            entry.put("count", row[1] != null ? ((Number) row[1]).longValue() : 0);
            result.add(entry);
        }
        return result;
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> getTopSongs(int limit) {
        Query query = entityManager.createNativeQuery(
                "SELECT s.id, s.name, a.name AS artist_name, " +
                "COALESCE(COUNT(lh.id), 0) AS play_count, " +
                "COALESCE(SUM(lh.duration_played_ms), 0) AS total_listening_ms " +
                "FROM songs s " +
                "JOIN artists a ON a.id = s.artist_id " +
                "LEFT JOIN listening_history lh ON lh.song_id = s.id " +
                "WHERE s.archived = false " +
                "GROUP BY s.id, s.name, a.name " +
                "ORDER BY play_count DESC LIMIT :limit");
        query.setParameter("limit", limit);
        List<Object[]> rows = query.getResultList();

        List<Map<String, Object>> result = new ArrayList<>();
        for (Object[] row : rows) {
            Map<String, Object> entry = new HashMap<>();
            entry.put("id", row[0]);
            entry.put("name", row[1]);
            entry.put("artistName", row[2]);
            entry.put("playCount", row[3] != null ? ((Number) row[3]).longValue() : 0);
            entry.put("totalListeningMs", row[4] != null ? ((Number) row[4]).longValue() : 0);
            result.add(entry);
        }
        return result;
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> getTopGenres(int limit) {
        Query query = entityManager.createNativeQuery(
                "SELECT g.id, g.name, COUNT(DISTINCT s.id) AS song_count, " +
                "COUNT(DISTINCT s.artist_id) AS artist_count " +
                "FROM genres g " +
                "JOIN songs s ON s.genre_id = g.id " +
                "WHERE s.archived = false " +
                "GROUP BY g.id, g.name " +
                "ORDER BY song_count DESC LIMIT :limit");
        query.setParameter("limit", limit);
        List<Object[]> rows = query.getResultList();

        List<Map<String, Object>> result = new ArrayList<>();
        for (Object[] row : rows) {
            Map<String, Object> entry = new HashMap<>();
            entry.put("id", row[0]);
            entry.put("name", row[1]);
            entry.put("songCount", row[2] != null ? ((Number) row[2]).longValue() : 0);
            entry.put("artistCount", row[3] != null ? ((Number) row[3]).longValue() : 0);
            result.add(entry);
        }
        return result;
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> getTopArtists(int limit) {
        List<Artist> artists = artistRepository.findTopArtists(PageRequest.of(0, limit));
        List<Map<String, Object>> result = new ArrayList<>();
        for (Artist artist : artists) {
            Map<String, Object> entry = new HashMap<>();
            entry.put("id", artist.getId());
            entry.put("name", artist.getName());
            entry.put("monthlyListeners", artist.getMonthlyListeners());
            entry.put("followerCount", artist.getFollowerCount());
            entry.put("verified", artist.isVerified());
            entry.put("albumCount", artist.getAlbums().size());
            entry.put("songCount", artist.getSongs().size());
            result.add(entry);
        }
        return result;
    }

    private List<Map<String, Object>> getRecentUsers(int limit) {
        TypedQuery<User> query = entityManager.createQuery(
                "SELECT u FROM User u WHERE u.active = true ORDER BY u.createdAt DESC", User.class);
        query.setMaxResults(limit);
        List<User> users = query.getResultList();

        List<Map<String, Object>> result = new ArrayList<>();
        for (User user : users) {
            Map<String, Object> entry = new HashMap<>();
            entry.put("id", user.getId());
            entry.put("email", user.getEmail());
            entry.put("username", user.getUsername());
            entry.put("role", user.getRole().name());
            entry.put("createdAt", user.getCreatedAt() != null ? user.getCreatedAt().toString() : null);
            result.add(entry);
        }
        return result;
    }

    private UserResponse toUserResponse(User user) {
        return UserResponse.builder()
                .id(user.getId())
                .email(user.getEmail())
                .username(user.getUsername())
                .avatarUrl(user.getAvatarUrl())
                .coverUrl(user.getCoverUrl())
                .bio(user.getBio())
                .country(user.getCountry())
                .favoriteGenres(user.getFavoriteGenres())
                .role(user.getRole().name())
                .emailVerified(user.isEmailVerified())
                .totalListeningTimeMs(user.getTotalListeningTimeMs())
                .followerCount(0)
                .followingCount(0)
                .createdAt(user.getCreatedAt())
                .build();
    }
}
