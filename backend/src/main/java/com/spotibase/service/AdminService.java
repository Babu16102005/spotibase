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

        return AdminDashboardResponse.builder()
                .totalUsers(totalUsers)
                .activeUsers(activeUsers)
                .totalSongs(totalSongs)
                .totalAlbums(totalAlbums)
                .totalArtists(totalArtists)
                .totalPlaylists(totalPlaylists)
                .totalListeningHours(totalListeningHours)
                .totalDownloads(totalDownloads)
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

        Query deleteLiked = entityManager.createNativeQuery(
                "DELETE FROM liked_songs WHERE song_id = :songId");
        deleteLiked.setParameter("songId", songId);
        deleteLiked.executeUpdate();

        Query deleteHistory = entityManager.createNativeQuery(
                "DELETE FROM listening_history WHERE song_id = :songId");
        deleteHistory.setParameter("songId", songId);
        deleteHistory.executeUpdate();

        Query deleteQueue = entityManager.createNativeQuery(
                "DELETE FROM queues WHERE song_id = :songId");
        deleteQueue.setParameter("songId", songId);
        deleteQueue.executeUpdate();

        Query deletePlaylistSongs = entityManager.createNativeQuery(
                "DELETE FROM playlist_songs WHERE song_id = :songId");
        deletePlaylistSongs.setParameter("songId", songId);
        deletePlaylistSongs.executeUpdate();

        Query deleteDownloads = entityManager.createNativeQuery(
                "DELETE FROM downloads WHERE song_id = :songId");
        deleteDownloads.setParameter("songId", songId);
        deleteDownloads.executeUpdate();

        songRepository.delete(song);
        log.info("Song {} force deleted by admin", songId);
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
