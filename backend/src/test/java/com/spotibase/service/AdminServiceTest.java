package com.spotibase.service;
import org.springframework.test.util.ReflectionTestUtils;

import com.spotibase.dto.response.AdminDashboardResponse;
import com.spotibase.dto.response.PagedResponse;
import com.spotibase.dto.response.UserResponse;
import com.spotibase.entity.Artist;
import com.spotibase.entity.Playlist;
import com.spotibase.entity.Role;
import com.spotibase.entity.Song;
import com.spotibase.entity.User;
import com.spotibase.exception.ResourceNotFoundException;
import com.spotibase.repository.*;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import jakarta.persistence.TypedQuery;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageRequest;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/**
 * Unit tests for {@link AdminService}.
 *
 * <p>EntityManager/Query/TypedQuery are mocked; repository delegations are
 * stubbed directly. Only pure logic paths are exercised.
 */
@ExtendWith(MockitoExtension.class)
class AdminServiceTest {

    @Mock
    private UserRepository userRepository;
    @Mock
    private SongRepository songRepository;
    @Mock
    private AlbumRepository albumRepository;
    @Mock
    private ArtistRepository artistRepository;
    @Mock
    private PlaylistRepository playlistRepository;
    @Mock
    private ListeningHistoryRepository listeningHistoryRepository;
    @Mock
    private DownloadRepository downloadRepository;
    @Mock
    private UserService userService;
    @Mock
    private StorageService storageService;
    @Mock
    private EntityManager entityManager;

    @InjectMocks
    private AdminService adminService;

    private Query query;

    @BeforeEach
    void setUp() {
        query = mock(Query.class);
        lenient().when(entityManager.createNativeQuery(anyString())).thenReturn(query);
        lenient().when(query.setParameter(anyString(), any())).thenReturn(query);
        ReflectionTestUtils.setField(adminService, "entityManager", entityManager);
    }

    private User buildUser(String id, Role role) {
        return User.builder().id(id).email(id + "@example.com").username(id).role(role).active(true).build();
    }

    private Song buildSong(String id) {
        Artist artist = Artist.builder().id("artist-1").name("The Band").build();
        return Song.builder()
                .id(id)
                .name("Song " + id)
                .artist(artist)
                .durationMs(1000)
                .releaseDate(LocalDate.of(2024, 1, 1))
                .build();
    }

    // ---------- dashboard ----------

    @Test
    @SuppressWarnings("unchecked")
    void getDashboard_aggregatesCountsAndAnalytics() {
        when(userRepository.count()).thenReturn(100L);
        when(listeningHistoryRepository.countActiveUsersSince(any(LocalDateTime.class))).thenReturn(40L);
        when(songRepository.countActiveSongs()).thenReturn(500L);
        when(albumRepository.countActiveAlbums()).thenReturn(60L);
        when(artistRepository.countArtists()).thenReturn(30L);
        when(playlistRepository.countPlaylists()).thenReturn(200L);
        when(listeningHistoryRepository.totalListeningTimeSince(any(LocalDateTime.class)))
                .thenReturn(7_200_000L); // 2 hours
        when(downloadRepository.count()).thenReturn(10L);
        when(storageService.getLiveStorageStats())
                .thenReturn(new R2StorageService.R2StorageStats(1_000_000_000L, 500, true, "spotibase-songs"));

        when(query.getResultList()).thenReturn(List.of()); // top songs / top genres / user growth
        when(artistRepository.findTopArtists(PageRequest.of(0, 10))).thenReturn(List.of());

        TypedQuery<User> recentUsers = mock(TypedQuery.class);
        when(recentUsers.getResultList()).thenReturn(List.of());
        when(entityManager.createQuery(anyString(), eq(User.class))).thenReturn(recentUsers);

        AdminDashboardResponse response = adminService.getDashboard();

        assertThat(response.getTotalUsers()).isEqualTo(100);
        assertThat(response.getActiveUsers()).isEqualTo(40);
        assertThat(response.getTotalSongs()).isEqualTo(500);
        assertThat(response.getTotalAlbums()).isEqualTo(60);
        assertThat(response.getTotalArtists()).isEqualTo(30);
        assertThat(response.getTotalPlaylists()).isEqualTo(200);
        assertThat(response.getTotalListeningHours()).isEqualTo(2);
        assertThat(response.getTotalDownloads()).isEqualTo(10);
        assertThat(response.getTopSongs()).isEmpty();
        assertThat(response.getTopArtists()).isEmpty();
        assertThat(response.getTopGenres()).isEmpty();
        assertThat(response.getUserGrowth()).isEmpty();
        assertThat(response.getRecentUsers()).isEmpty();
    }

    // ---------- getAllUsers ----------

    @Test
    void getAllUsers_mapsActiveUsersToPage() {
        User user = buildUser("user-1", Role.USER);
        TypedQuery<User> listQuery = mock(TypedQuery.class);
        TypedQuery<Long> countQuery = mock(TypedQuery.class);
        when(entityManager.createQuery(anyString(), eq(User.class))).thenReturn(listQuery);
        when(entityManager.createQuery(anyString(), eq(Long.class))).thenReturn(countQuery);
        when(listQuery.getResultList()).thenReturn(List.of(user));
        when(countQuery.getSingleResult()).thenReturn(1L);

        PagedResponse<UserResponse> response = adminService.getAllUsers(0, 20);

        assertThat(response.getContent()).hasSize(1);
        assertThat(response.getContent().get(0).getId()).isEqualTo("user-1");
        assertThat(response.getContent().get(0).getRole()).isEqualTo("USER");
        assertThat(response.getTotalElements()).isEqualTo(1);
        assertThat(response.getPage()).isZero();
    }

    // ---------- updateUserRole ----------

    @Test
    void updateUserRole_validRole_updatesAndSaves() {
        User user = buildUser("user-1", Role.USER);
        when(userRepository.findById("user-1")).thenReturn(Optional.of(user));
        UserResponse userResponse = UserResponse.builder().id("user-1").role("ADMIN").build();
        when(userService.toUserResponse(user)).thenReturn(userResponse);

        UserResponse response = adminService.updateUserRole("user-1", "admin");

        assertThat(response.getRole()).isEqualTo("ADMIN");
        assertThat(user.getRole()).isEqualTo(Role.ADMIN);
        verify(userRepository).save(user);
    }

    @Test
    void updateUserRole_userNotFound_throwsResourceNotFoundException() {
        when(userRepository.findById("ghost")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> adminService.updateUserRole("ghost", "ADMIN"))
                .isInstanceOf(ResourceNotFoundException.class);
        verify(userRepository, never()).save(any(User.class));
    }

    @Test
    void updateUserRole_invalidRole_throwsIllegalArgumentException() {
        User user = buildUser("user-1", Role.USER);
        when(userRepository.findById("user-1")).thenReturn(Optional.of(user));

        assertThatThrownBy(() -> adminService.updateUserRole("user-1", "SUPERUSER"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Invalid role");

        verify(userRepository, never()).save(any(User.class));
    }

    // ---------- forceDeleteSong ----------

    @Test
    void forceDeleteSong_deletesRelatedRowsAndSong() {
        Song song = buildSong("song-1");
        when(songRepository.findById("song-1")).thenReturn(Optional.of(song));

        adminService.forceDeleteSong("song-1");

        verify(query, atLeast(5)).executeUpdate();
        verify(query, atLeast(5)).setParameter(eq("songId"), eq("song-1"));
        verify(songRepository).delete(song);
    }

    @Test
    void forceDeleteSong_notFound_throwsResourceNotFoundException() {
        when(songRepository.findById("ghost")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> adminService.forceDeleteSong("ghost"))
                .isInstanceOf(ResourceNotFoundException.class);
        verify(songRepository, never()).delete(any(Song.class));
    }

    // ---------- feature toggles ----------

    @Test
    void featureSong_togglesFeaturedFlag() {
        Song song = buildSong("song-1");
        when(songRepository.findById("song-1")).thenReturn(Optional.of(song));

        adminService.featureSong("song-1");

        assertThat(song.isFeatured()).isTrue();
        verify(songRepository).save(song);
    }

    @Test
    void featureSong_notFound_throwsResourceNotFoundException() {
        when(songRepository.findById("ghost")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> adminService.featureSong("ghost"))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void featurePlaylist_togglesFeaturedFlag() {
        Playlist playlist = Playlist.builder().id("pl-1").name("P").user(buildUser("owner", Role.USER)).build();
        when(playlistRepository.findById("pl-1")).thenReturn(Optional.of(playlist));

        adminService.featurePlaylist("pl-1");

        assertThat(playlist.isFeatured()).isTrue();
        verify(playlistRepository).save(playlist);
    }

    @Test
    void featurePlaylist_notFound_throwsResourceNotFoundException() {
        when(playlistRepository.findById("ghost")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> adminService.featurePlaylist("ghost"))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    // ---------- analytics ----------

    @Test
    void getUserGrowth_mapsRowsToEntries() {
        when(query.getResultList()).thenReturn(List.of(
                new Object[]{"2026-08-01", 5L},
                new Object[]{"2026-07-01", 3L}));

        List<Map<String, Object>> growth = adminService.getUserGrowth("monthly");

        assertThat(growth).hasSize(2);
        assertThat(growth.get(0)).containsEntry("period", "2026-08-01").containsEntry("count", 5L);
        verify(query).setParameter("trunc", "month");
    }

    @Test
    void getUserGrowth_dailyAndWeeklyMapToTruncValues() {
        when(query.getResultList()).thenReturn(List.of());

        adminService.getUserGrowth("daily");
        verify(query).setParameter("trunc", "day");

        adminService.getUserGrowth("weekly");
        verify(query, times(2)).setParameter(eq("trunc"), anyString());
    }

    @Test
    void getTopSongs_mapsRowsToSongEntries() {
        when(query.getResultList()).thenReturn(List.of(new Object[][]{
                new Object[]{"song-1", "Hit", "The Band", 10L, 5000L}}));

        List<Map<String, Object>> topSongs = adminService.getTopSongs(10);

        assertThat(topSongs).hasSize(1);
        Map<String, Object> entry = topSongs.get(0);
        assertThat(entry).containsEntry("id", "song-1")
                .containsEntry("name", "Hit")
                .containsEntry("artistName", "The Band")
                .containsEntry("playCount", 10L)
                .containsEntry("totalListeningMs", 5000L);
        verify(query).setParameter("limit", 10);
    }

    @Test
    void getTopGenres_mapsRowsToGenreEntries() {
        when(query.getResultList()).thenReturn(List.of(new Object[][]{
                new Object[]{"genre-1", "Rock", 20L, 5L}}));

        List<Map<String, Object>> topGenres = adminService.getTopGenres(10);

        assertThat(topGenres).hasSize(1);
        assertThat(topGenres.get(0))
                .containsEntry("id", "genre-1")
                .containsEntry("name", "Rock")
                .containsEntry("songCount", 20L)
                .containsEntry("artistCount", 5L);
    }

    @Test
    void getTopArtists_mapsArtistsToEntries() {
        Artist artist = Artist.builder()
                .id("artist-1")
                .name("The Band")
                .monthlyListeners(1000)
                .followerCount(50)
                .verified(true)
                .build();
        when(artistRepository.findTopArtists(PageRequest.of(0, 10))).thenReturn(List.of(artist));

        List<Map<String, Object>> topArtists = adminService.getTopArtists(10);

        assertThat(topArtists).hasSize(1);
        assertThat(topArtists.get(0))
                .containsEntry("id", "artist-1")
                .containsEntry("name", "The Band")
                .containsEntry("monthlyListeners", 1000L)
                .containsEntry("followerCount", 50L)
                .containsEntry("verified", true)
                .containsEntry("albumCount", 0)
                .containsEntry("songCount", 0);
    }

    @Test
    @SuppressWarnings("unchecked")
    void clearAllSongsAndStorage_clearsStorageAndDeletesAllSongs() {
        when(userRepository.count()).thenReturn(0L);
        when(query.getResultList()).thenReturn(List.of());
        when(artistRepository.findTopArtists(any())).thenReturn(List.of());
        TypedQuery<User> recentUsers = mock(TypedQuery.class);
        when(recentUsers.getResultList()).thenReturn(List.of());
        when(entityManager.createQuery(anyString(), eq(User.class))).thenReturn(recentUsers);

        AdminDashboardResponse res = adminService.clearAllSongsAndStorage();

        verify(storageService).clearAllR2Storage();
        verify(songRepository).deleteAll();
        verify(storageService).invalidateStorageCache();
        assertThat(res).isNotNull();
    }
}
