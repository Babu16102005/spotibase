package com.spotibase.service;
import org.springframework.test.util.ReflectionTestUtils;

import com.spotibase.dto.response.AlbumResponse;
import com.spotibase.dto.response.ArtistResponse;
import com.spotibase.dto.response.PagedResponse;
import com.spotibase.dto.response.SongResponse;
import com.spotibase.entity.*;
import com.spotibase.exception.ResourceNotFoundException;
import com.spotibase.repository.*;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageRequest;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/**
 * Unit tests for {@link LikeService}.
 */
@ExtendWith(MockitoExtension.class)
class LikeServiceTest {

    @Mock
    private SongRepository songRepository;
    @Mock
    private AlbumRepository albumRepository;
    @Mock
    private ArtistRepository artistRepository;
    @Mock
    private PlaylistRepository playlistRepository;
    @Mock
    private UserRepository userRepository;
    @Mock
    private EntityManager entityManager;

    @InjectMocks
    private LikeService likeService;

    private Query query;

    @BeforeEach
    void setUp() {
        query = mock(Query.class);
        lenient().when(entityManager.createNativeQuery(anyString())).thenReturn(query);
        ReflectionTestUtils.setField(likeService, "entityManager", entityManager);
    }

    private User buildUser(String id) {
        return User.builder().id(id).email(id + "@example.com").username("user-" + id).build();
    }

    private Playlist buildPlaylist(String id) {
        return Playlist.builder().id(id).name("P").user(buildUser("owner")).build();
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

    // ---------- likeSong / unlikeSong ----------

    @Test
    void likeSong_success_executesNativeInsert() {
        when(userRepository.existsById("user-1")).thenReturn(true);
        when(songRepository.existsById("song-1")).thenReturn(true);
        when(query.executeUpdate()).thenReturn(1);

        likeService.likeSong("user-1", "song-1");

        verify(query).setParameter("userId", "user-1");
        verify(query).setParameter("songId", "song-1");
        verify(query).executeUpdate();
    }

    @Test
    void likeSong_userNotFound_throwsResourceNotFoundException() {
        when(userRepository.existsById("ghost")).thenReturn(false);

        assertThatThrownBy(() -> likeService.likeSong("ghost", "song-1"))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining("User");
        verify(query, never()).executeUpdate();
    }

    @Test
    void likeSong_songNotFound_throwsResourceNotFoundException() {
        when(userRepository.existsById("user-1")).thenReturn(true);
        when(songRepository.existsById("ghost-song")).thenReturn(false);

        assertThatThrownBy(() -> likeService.likeSong("user-1", "ghost-song"))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining("Song");
    }

    @Test
    void likeSong_alreadyLiked_conflictIgnoredIsIdempotent() {
        when(userRepository.existsById("user-1")).thenReturn(true);
        when(songRepository.existsById("song-1")).thenReturn(true);
        when(query.executeUpdate()).thenReturn(0); // ON CONFLICT DO NOTHING

        likeService.likeSong("user-1", "song-1"); // must not throw
    }

    @Test
    void unlikeSong_executesNativeDelete() {
        when(query.executeUpdate()).thenReturn(1);

        likeService.unlikeSong("user-1", "song-1");

        verify(query).setParameter("userId", "user-1");
        verify(query).setParameter("songId", "song-1");
        verify(query).executeUpdate();
    }

    @Test
    void unlikeSong_notLiked_isSilentNoOp() {
        when(query.executeUpdate()).thenReturn(0);

        likeService.unlikeSong("user-1", "song-1"); // must not throw
    }

    // ---------- likeAlbum / likeArtist ----------

    @Test
    void likeAlbum_success_executesNativeInsert() {
        when(userRepository.existsById("user-1")).thenReturn(true);
        when(albumRepository.existsById("album-1")).thenReturn(true);
        when(query.executeUpdate()).thenReturn(1);

        likeService.likeAlbum("user-1", "album-1");

        verify(query).setParameter("albumId", "album-1");
    }

    @Test
    void likeAlbum_albumNotFound_throwsResourceNotFoundException() {
        when(userRepository.existsById("user-1")).thenReturn(true);
        when(albumRepository.existsById("ghost-album")).thenReturn(false);

        assertThatThrownBy(() -> likeService.likeAlbum("user-1", "ghost-album"))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining("Album");
    }

    @Test
    void unlikeAlbum_executesNativeDelete() {
        when(query.executeUpdate()).thenReturn(1);

        likeService.unlikeAlbum("user-1", "album-1");

        verify(query).executeUpdate();
    }

    @Test
    void likeArtist_success_executesNativeInsert() {
        when(userRepository.existsById("user-1")).thenReturn(true);
        when(artistRepository.existsById("artist-1")).thenReturn(true);
        when(query.executeUpdate()).thenReturn(1);

        likeService.likeArtist("user-1", "artist-1");

        verify(query).setParameter("artistId", "artist-1");
    }

    @Test
    void likeArtist_artistNotFound_throwsResourceNotFoundException() {
        when(userRepository.existsById("user-1")).thenReturn(true);
        when(artistRepository.existsById("ghost-artist")).thenReturn(false);

        assertThatThrownBy(() -> likeService.likeArtist("user-1", "ghost-artist"))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining("Artist");
    }

    @Test
    void unlikeArtist_executesNativeDelete() {
        when(query.executeUpdate()).thenReturn(1);

        likeService.unlikeArtist("user-1", "artist-1");

        verify(query).executeUpdate();
    }

    // ---------- likePlaylist / unlikePlaylist ----------

    @Test
    void likePlaylist_firstLike_addsUserAndIncrementsCount() {
        Playlist playlist = buildPlaylist("pl-1");
        User user = buildUser("user-1");
        when(playlistRepository.findById("pl-1")).thenReturn(Optional.of(playlist));
        when(userRepository.findById("user-1")).thenReturn(Optional.of(user));
        when(playlistRepository.isLikedByUser("pl-1", "user-1")).thenReturn(false);

        likeService.likePlaylist("user-1", "pl-1");

        assertThat(playlist.getLikedBy()).contains(user);
        assertThat(playlist.getLikeCount()).isEqualTo(1);
        verify(playlistRepository).save(playlist);
    }

    @Test
    void likePlaylist_alreadyLiked_isIdempotent() {
        Playlist playlist = buildPlaylist("pl-1");
        User user = buildUser("user-1");
        playlist.getLikedBy().add(user);
        when(playlistRepository.findById("pl-1")).thenReturn(Optional.of(playlist));
        when(userRepository.findById("user-1")).thenReturn(Optional.of(user));
        when(playlistRepository.isLikedByUser("pl-1", "user-1")).thenReturn(true);

        likeService.likePlaylist("user-1", "pl-1");

        verify(playlistRepository, never()).save(any(Playlist.class));
    }

    @Test
    void likePlaylist_missingPlaylist_throwsResourceNotFoundException() {
        when(playlistRepository.findById("missing")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> likeService.likePlaylist("user-1", "missing"))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void unlikePlaylist_removesUserAndDecrementsCount() {
        Playlist playlist = buildPlaylist("pl-1");
        User user = buildUser("user-1");
        playlist.getLikedBy().add(user);
        playlist.setLikeCount(1);
        when(playlistRepository.findById("pl-1")).thenReturn(Optional.of(playlist));
        when(userRepository.findById("user-1")).thenReturn(Optional.of(user));
        when(playlistRepository.isLikedByUser("pl-1", "user-1")).thenReturn(true);

        likeService.unlikePlaylist("user-1", "pl-1");

        assertThat(playlist.getLikedBy()).doesNotContain(user);
        assertThat(playlist.getLikeCount()).isZero();
        verify(playlistRepository).save(playlist);
    }

    @Test
    void unlikePlaylist_notLiked_isIdempotent() {
        Playlist playlist = buildPlaylist("pl-1");
        when(playlistRepository.findById("pl-1")).thenReturn(Optional.of(playlist));
        when(userRepository.findById("user-1")).thenReturn(Optional.of(buildUser("user-1")));
        when(playlistRepository.isLikedByUser("pl-1", "user-1")).thenReturn(false);

        likeService.unlikePlaylist("user-1", "pl-1");

        verify(playlistRepository, never()).save(any(Playlist.class));
    }

    // ---------- getLikedSongs ----------

    @Test
    void getLikedSongs_mapsIdsToSongResponses() {
        Query countQuery = mock(Query.class);
        Query listQuery = mock(Query.class);
        when(entityManager.createNativeQuery(anyString())).thenReturn(countQuery, listQuery);
        when(countQuery.getSingleResult()).thenReturn(1L);
        when(listQuery.getResultList()).thenReturn(List.of("song-1"));
        Song song = buildSong("song-1");
        when(songRepository.findByIds(List.of("song-1"))).thenReturn(List.of(song));

        PagedResponse<SongResponse> response = likeService.getLikedSongs("user-1", PageRequest.of(0, 20));

        assertThat(response.getContent()).hasSize(1);
        assertThat(response.getContent().get(0).getId()).isEqualTo("song-1");
        assertThat(response.getContent().get(0).isLiked()).isTrue();
        assertThat(response.getTotalElements()).isEqualTo(1);
        assertThat(response.getTotalPages()).isEqualTo(1);
        assertThat(response.isFirst()).isTrue();
        assertThat(response.isLast()).isTrue();
        verify(listQuery).setFirstResult(0);
        verify(listQuery).setMaxResults(20);
    }

    @Test
    void getLikedSongs_emptyLikes_returnsEmptyPage() {
        Query countQuery = mock(Query.class);
        Query listQuery = mock(Query.class);
        when(entityManager.createNativeQuery(anyString())).thenReturn(countQuery, listQuery);
        when(countQuery.getSingleResult()).thenReturn(0L);
        when(listQuery.getResultList()).thenReturn(List.of());

        PagedResponse<SongResponse> response = likeService.getLikedSongs("user-1", PageRequest.of(0, 20));

        assertThat(response.getContent()).isEmpty();
        assertThat(response.getTotalElements()).isZero();
    }

    // ---------- getLikedAlbums / getLikedArtists ----------

    @Test
    void getLikedAlbums_mapsIdsToAlbumResponses() {
        when(query.getResultList()).thenReturn(List.of("album-1"));
        Artist artist = Artist.builder().id("artist-1").name("The Band").build();
        Album album = Album.builder()
                .id("album-1")
                .name("Album One")
                .artist(artist)
                .releaseDate(LocalDate.of(2024, 1, 1))
                .build();
        when(albumRepository.findAllById(List.of("album-1"))).thenReturn(List.of(album));

        List<AlbumResponse> albums = likeService.getLikedAlbums("user-1");

        assertThat(albums).hasSize(1);
        assertThat(albums.get(0).getId()).isEqualTo("album-1");
        assertThat(albums.get(0).isLiked()).isTrue();
    }

    @Test
    void getLikedArtists_mapsIdsToArtistResponses() {
        when(query.getResultList()).thenReturn(List.of("artist-1"));
        Artist artist = Artist.builder().id("artist-1").name("The Band").build();
        when(artistRepository.findAllById(List.of("artist-1"))).thenReturn(List.of(artist));

        List<ArtistResponse> artists = likeService.getLikedArtists("user-1");

        assertThat(artists).hasSize(1);
        assertThat(artists.get(0).getId()).isEqualTo("artist-1");
        assertThat(artists.get(0).isFollowed()).isTrue();
    }
}
