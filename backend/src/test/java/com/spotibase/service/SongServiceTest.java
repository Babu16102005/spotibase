package com.spotibase.service;

import com.spotibase.dto.request.CreateSongRequest;
import com.spotibase.dto.response.PagedResponse;
import com.spotibase.dto.response.SongResponse;
import com.spotibase.entity.*;
import com.spotibase.exception.BadRequestException;
import com.spotibase.exception.ResourceNotFoundException;
import com.spotibase.repository.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.mock.web.MockMultipartFile;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Unit tests for {@link SongService}.
 */
@ExtendWith(MockitoExtension.class)
class SongServiceTest {

    @Mock
    private SongRepository songRepository;
    @Mock
    private ArtistRepository artistRepository;
    @Mock
    private AlbumRepository albumRepository;
    @Mock
    private GenreRepository genreRepository;
    @Mock
    private LikeRepository likeRepository;
    @Mock
    private RecentlyPlayedRepository recentlyPlayedRepository;
    @Mock
    private ListeningHistoryRepository listeningHistoryRepository;
    @Mock
    private StorageService storageService;
    @Mock
    private SongContributingArtistRepository contributingArtistRepository;
    @Mock
    private UserRepository userRepository;

    @InjectMocks
    private SongService songService;

    private Artist buildArtist(String id, String name) {
        return Artist.builder().id(id).name(name).build();
    }

    private Album buildAlbum(String id, String name) {
        return Album.builder().id(id).name(name).coverUrl("album-cover").build();
    }

    private Genre buildGenre(String id, String name) {
        return Genre.builder().id(id).name(name).build();
    }

    private Song buildSong(String id, String name, Artist artist) {
        return Song.builder()
                .id(id)
                .name(name)
                .artist(artist)
                .durationMs(180000)
                .releaseDate(LocalDate.of(2024, 1, 1))
                .build();
    }

    // ---------- getSongById ----------

    @Test
    void getSongById_found_returnsSongResponseWithArtistData() {
        Artist artist = buildArtist("artist-1", "The Band");
        Song song = buildSong("song-1", "Hit Song", artist);
        when(songRepository.findByIdWithDetails("song-1")).thenReturn(Optional.of(song));

        SongResponse response = songService.getSongById("song-1", null);

        assertThat(response.getId()).isEqualTo("song-1");
        assertThat(response.getTitle()).isEqualTo("Hit Song");
        assertThat(response.getArtistId()).isEqualTo("artist-1");
        assertThat(response.getArtistName()).isEqualTo("The Band");
    }

    @Test
    void getSongById_found_setsLikedFlagWhenUserIdProvided() {
        Artist artist = buildArtist("artist-1", "The Band");
        Song song = buildSong("song-1", "Hit Song", artist);
        when(songRepository.findByIdWithDetails("song-1")).thenReturn(Optional.of(song));
        when(likeRepository.existsByUserIdAndSongId("user-1", "song-1")).thenReturn(true);

        SongResponse response = songService.getSongById("song-1", "user-1");

        assertThat(response.isLiked()).isTrue();
    }

    @Test
    void getSongById_notFound_throwsResourceNotFoundException() {
        when(songRepository.findByIdWithDetails("missing")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> songService.getSongById("missing", null))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining("Song");
    }

    @Test
    void getSongById_coverUrlFallsBackToAlbumCoverWhenSongHasNoCover() {
        Artist artist = buildArtist("artist-1", "The Band");
        Album album = buildAlbum("album-1", "Album One");
        Song song = buildSong("song-1", "Hit Song", artist);
        song.setAlbum(album);

        when(songRepository.findByIdWithDetails("song-1")).thenReturn(Optional.of(song));

        SongResponse response = songService.getSongById("song-1", null);

        assertThat(response.getCoverUrl()).isEqualTo("album-cover");
    }

    // ---------- getAllSongs ----------

    @Test
    void getAllSongs_mapsPageToPagedResponse() {
        Artist artist = buildArtist("artist-1", "The Band");
        Song song = buildSong("song-1", "Hit Song", artist);
        PageImpl<Song> page = new PageImpl<>(List.of(song), PageRequest.of(0, 20), 1);
        when(songRepository.findAllActive(any(Pageable.class))).thenReturn(page);

        PagedResponse<SongResponse> response = songService.getAllSongs(0, 20, null);

        assertThat(response.getContent()).hasSize(1);
        assertThat(response.getContent().get(0).getTitle()).isEqualTo("Hit Song");
        assertThat(response.getPage()).isZero();
        assertThat(response.getSize()).isEqualTo(20);
        assertThat(response.getTotalElements()).isEqualTo(1);
        assertThat(response.getTotalPages()).isEqualTo(1);
        assertThat(response.isFirst()).isTrue();
        assertThat(response.isLast()).isTrue();
    }

    // ---------- createSong ----------

    @Test
    void createSong_withoutFiles_createsSongAndSaves() {
        CreateSongRequest request = CreateSongRequest.builder()
                .title("New Song")
                .artistId("artist-1")
                .releaseDate(LocalDate.of(2025, 5, 1))
                .build();
        Artist artist = buildArtist("artist-1", "The Band");
        when(artistRepository.findById("artist-1")).thenReturn(Optional.of(artist));
        Song saved = buildSong("song-new", "New Song", artist);
        when(songRepository.save(any(Song.class))).thenReturn(saved);

        SongResponse response = songService.createSong(request, null, null);

        assertThat(response.getId()).isEqualTo("song-new");
        assertThat(response.getTitle()).isEqualTo("New Song");
        verify(songRepository).save(argThat(song -> song.getAlbum() == null && song.getGenre() == null));
        verify(storageService, never()).uploadSong(any(), anyString());
    }

    @Test
    void createSong_withAudioAndCover_uploadsFilesAndSetsMetadata() {
        CreateSongRequest request = CreateSongRequest.builder()
                .title("New Song")
                .artistId("artist-1")
                .releaseDate(LocalDate.of(2025, 5, 1))
                .build();
        Artist artist = buildArtist("artist-1", "The Band");
        MockMultipartFile audio = new MockMultipartFile("audioFile", "track.mp3", "audio/mpeg", new byte[]{1, 2, 3});
        MockMultipartFile cover = new MockMultipartFile("coverFile", "cover.jpg", "image/jpeg", new byte[]{4, 5});

        when(artistRepository.findById("artist-1")).thenReturn(Optional.of(artist));
        when(storageService.uploadSong(audio, "artist-1")).thenReturn("https://bucket/song.mp3");
        when(storageService.uploadCover(cover, "artist-1")).thenReturn("https://bucket/cover.jpg");
        Song saved = buildSong("song-new", "New Song", artist);
        when(songRepository.save(any(Song.class))).thenReturn(saved);

        songService.createSong(request, audio, cover);

        verify(songRepository).save(argThat(song ->
                "https://bucket/song.mp3".equals(song.getFileUrl())
                        && "MP3".equals(song.getFileFormat())
                        && 3 == song.getFileSize()
                        && "https://bucket/cover.jpg".equals(song.getCoverUrl())));
    }

    @Test
    void createSong_artistNotFound_throwsResourceNotFoundException() {
        CreateSongRequest request = CreateSongRequest.builder()
                .title("New Song")
                .artistId("missing-artist")
                .releaseDate(LocalDate.of(2025, 5, 1))
                .build();
        when(artistRepository.findById("missing-artist")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> songService.createSong(request, null, null))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining("Artist");

        verify(songRepository, never()).save(any(Song.class));
    }

    @Test
    void createSong_albumNotFound_throwsResourceNotFoundException() {
        CreateSongRequest request = CreateSongRequest.builder()
                .title("New Song")
                .artistId("artist-1")
                .albumId("missing-album")
                .releaseDate(LocalDate.of(2025, 5, 1))
                .build();
        Artist artist = buildArtist("artist-1", "The Band");
        when(artistRepository.findById("artist-1")).thenReturn(Optional.of(artist));
        when(albumRepository.findById("missing-album")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> songService.createSong(request, null, null))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining("Album");
    }

    @Test
    void createSong_withAlbumAndGenre_updatesAlbumStats() {
        CreateSongRequest request = CreateSongRequest.builder()
                .title("New Song")
                .artistId("artist-1")
                .albumId("album-1")
                .genreId("genre-1")
                .releaseDate(LocalDate.of(2025, 5, 1))
                .build();
        Artist artist = buildArtist("artist-1", "The Band");
        Album album = buildAlbum("album-1", "Album One");
        Genre genre = buildGenre("genre-1", "Rock");

        when(artistRepository.findById("artist-1")).thenReturn(Optional.of(artist));
        when(albumRepository.findById("album-1")).thenReturn(Optional.of(album));
        when(genreRepository.findById("genre-1")).thenReturn(Optional.of(genre));
        Song saved = buildSong("song-new", "New Song", artist);
        saved.setAlbum(album);
        saved.setGenre(genre);
        when(songRepository.save(any(Song.class))).thenReturn(saved);
        when(songRepository.findByAlbumIdAndArchivedFalseOrderByDiscNumberAscTrackNumberAsc("album-1"))
                .thenReturn(List.of(saved));

        SongResponse response = songService.createSong(request, null, null);

        assertThat(response.getAlbumId()).isEqualTo("album-1");
        assertThat(response.getGenreName()).isEqualTo("Rock");
        verify(albumRepository).save(album);
        assertThat(album.getSongCount()).isEqualTo(1);
        assertThat(album.getTotalDurationMs()).isEqualTo(180000);
    }

    @Test
    void createSong_missingReleaseDate_defaultsToToday() {
        CreateSongRequest request = CreateSongRequest.builder()
                .title("No Date")
                .artistId("artist-1")
                .build();
        Artist artist = buildArtist("artist-1", "The Band");
        when(artistRepository.findById("artist-1")).thenReturn(Optional.of(artist));
        when(songRepository.save(any(Song.class))).thenAnswer(inv -> inv.getArgument(0));

        songService.createSong(request, null, null);

        verify(songRepository).save(argThat(song -> song.getReleaseDate().equals(LocalDate.now())));
    }

    // ---------- updateSong / delete / restore ----------

    @Test
    void updateSong_existingSong_updatesFieldsAndSaves() {
        CreateSongRequest request = CreateSongRequest.builder()
                .title("Updated Name")
                .artistId("artist-1")
                .language("EN")
                .releaseDate(LocalDate.of(2025, 1, 1))
                .build();
        Artist artist = buildArtist("artist-1", "The Band");
        Song song = buildSong("song-1", "Old Name", artist);
        when(artistRepository.findById("artist-1")).thenReturn(Optional.of(artist));
        when(songRepository.findById("song-1")).thenReturn(Optional.of(song));
        when(songRepository.save(any(Song.class))).thenReturn(song);

        SongResponse response = songService.updateSong("song-1", request, null, null);

        assertThat(response.getTitle()).isEqualTo("Updated Name");
        verify(songRepository).save(song);
    }

    @Test
    void updateSong_notFound_throwsResourceNotFoundException() {
        CreateSongRequest request = CreateSongRequest.builder()
                .title("Whatever")
                .artistId("artist-1")
                .build();
        when(songRepository.findById("missing")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> songService.updateSong("missing", request, null, null))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void deleteSong_archivesInsteadOfHardDelete() {
        Artist artist = buildArtist("artist-1", "The Band");
        Song song = buildSong("song-1", "Hit", artist);
        when(songRepository.findById("song-1")).thenReturn(Optional.of(song));

        songService.deleteSong("song-1");

        assertThat(song.isArchived()).isTrue();
        verify(songRepository).save(song);
    }

    @Test
    void deleteSong_notFound_throwsResourceNotFoundException() {
        when(songRepository.findById("missing")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> songService.deleteSong("missing"))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void restoreSong_setsArchivedFalse() {
        Artist artist = buildArtist("artist-1", "The Band");
        Song song = buildSong("song-1", "Hit", artist);
        song.setArchived(true);
        when(songRepository.findById("song-1")).thenReturn(Optional.of(song));

        songService.restoreSong("song-1");

        assertThat(song.isArchived()).isFalse();
        verify(songRepository).save(song);
    }

    @Test
    void incrementPlayCount_existingSong_incrementsAndSaves() {
        Artist artist = buildArtist("artist-1", "The Band");
        Song song = buildSong("song-1", "Hit", artist);
        when(songRepository.findById("song-1")).thenReturn(Optional.of(song));

        songService.incrementPlayCount("song-1");

        assertThat(song.getPlayCount()).isEqualTo(1);
        verify(songRepository).save(song);
    }

    @Test
    void incrementPlayCount_missingSong_isSilentNoOp() {
        when(songRepository.findById("missing")).thenReturn(Optional.empty());

        songService.incrementPlayCount("missing");

        verify(songRepository, never()).save(any(Song.class));
    }

    // ---------- delegations ----------

    @Test
    void getTrendingSongs_delegatesToFindTopSongs() {
        Artist artist = buildArtist("artist-1", "The Band");
        Song song = buildSong("song-1", "Trending", artist);
        when(songRepository.findTopSongs(any(Pageable.class))).thenReturn(List.of(song));

        List<SongResponse> songs = songService.getTrendingSongs(null, 10);

        assertThat(songs).hasSize(1);
        assertThat(songs.get(0).getTitle()).isEqualTo("Trending");
        verify(songRepository).findTopSongs(argThat(pageable -> pageable.getPageSize() == 10));
    }

    @Test
    void getNewReleases_delegatesToFindNewReleases() {
        Artist artist = buildArtist("artist-1", "The Band");
        Song song = buildSong("song-1", "Fresh", artist);
        when(songRepository.findNewReleases(any(Pageable.class)))
                .thenReturn(List.of(song));

        List<SongResponse> songs = songService.getNewReleases(null, 5);

        assertThat(songs).hasSize(1);
        verify(songRepository).findNewReleases(argThat(p -> p.getPageSize() == 5));
    }

    @Test
    void getFeaturedSongs_delegatesToFindFeaturedSongs() {
        Artist artist = buildArtist("artist-1", "The Band");
        Song song = buildSong("song-1", "Featured", artist);
        song.setFeatured(true);
        when(songRepository.findFeaturedSongs(any(Pageable.class))).thenReturn(List.of(song));

        List<SongResponse> songs = songService.getFeaturedSongs(null, 3);

        assertThat(songs).hasSize(1);
        verify(songRepository).findFeaturedSongs(argThat(p -> p.getPageSize() == 3));
    }

    @Test
    void getSongsByAlbum_ordersByTrackNumberViaRepository() {
        Artist artist = buildArtist("artist-1", "The Band");
        Song song = buildSong("song-1", "Track One", artist);
        when(songRepository.findByAlbumIdAndArchivedFalseOrderByDiscNumberAscTrackNumberAsc("album-1"))
                .thenReturn(List.of(song));

        List<SongResponse> songs = songService.getSongsByAlbum("album-1", null);

        assertThat(songs).hasSize(1);
        verify(songRepository).findByAlbumIdAndArchivedFalseOrderByDiscNumberAscTrackNumberAsc("album-1");
    }

    // ---------- liked / recent / history ----------

    @Test
    void getLikedSongs_mapsLikedSongIdsToSongs() {
        Artist artist = buildArtist("artist-1", "The Band");
        Song song = buildSong("song-1", "Liked Song", artist);
        List<Object[]> likedRows = new java.util.ArrayList<>();
        likedRows.add(new Object[]{"song-1"});
        when(likeRepository.findLikedSongIds("user-1")).thenReturn(likedRows);
        when(songRepository.findByIdInWithDetails(List.of("song-1"))).thenReturn(List.of(song));

        List<SongResponse> songs = songService.getLikedSongs("user-1");

        assertThat(songs).hasSize(1);
        assertThat(songs.get(0).getId()).isEqualTo("song-1");
        verify(songRepository).findByIdInWithDetails(List.of("song-1"));
    }

    @Test
    void getRecentlyPlayed_filtersOnlySongItems() {
        Artist artist = buildArtist("artist-1", "The Band");
        Song song = buildSong("song-1", "Recent", artist);
        RecentlyPlayed songItem = RecentlyPlayed.builder().itemType("SONG").itemId("song-1").build();
        RecentlyPlayed albumItem = RecentlyPlayed.builder().itemType("ALBUM").itemId("album-1").build();
        when(recentlyPlayedRepository.findByUserIdOrderByPlayedAtDesc("user-1"))
                .thenReturn(List.of(albumItem, songItem));
        when(songRepository.findByIdInWithDetails(List.of("song-1"))).thenReturn(List.of(song));

        List<SongResponse> songs = songService.getRecentlyPlayed("user-1");

        assertThat(songs).hasSize(1);
        assertThat(songs.get(0).getId()).isEqualTo("song-1");
    }

    @Test
    void getListeningHistory_preservesOrderAndSkipsMissingSongs() {
        Artist artist = buildArtist("artist-1", "The Band");
        Song song = buildSong("song-1", "Historic", artist);
        ListeningHistory h1 = ListeningHistory.builder().songId("song-1").build();
        ListeningHistory h2 = ListeningHistory.builder().songId("missing-song").build();
        PageImpl<ListeningHistory> page = new PageImpl<>(List.of(h1, h2), PageRequest.of(0, 20), 2);
        when(listeningHistoryRepository.findByUserId("user-1", PageRequest.of(0, 20)))
                .thenReturn(page);
        when(songRepository.findByIdInWithDetails(List.of("song-1", "missing-song"))).thenReturn(List.of(song));

        PagedResponse<SongResponse> response = songService.getListeningHistory("user-1", PageRequest.of(0, 20));

        assertThat(response.getContent()).hasSize(1);
        assertThat(response.getContent().get(0).getId()).isEqualTo("song-1");
        assertThat(response.getTotalElements()).isEqualTo(2);
    }

    // ---------- updateAlbumStats ----------

    @Test
    void updateAlbumStats_missingAlbum_isNoOp() {
        when(albumRepository.findById("missing")).thenReturn(Optional.empty());

        songService.updateAlbumStats("missing");

        verify(songRepository, never()).findByAlbumIdOrderByTrackNumber(anyString());
        verify(albumRepository, never()).save(any(Album.class));
    }

    // ---------- createSongsBulk ----------

    @Test
    void createSongsBulk_withoutFiles_throwsBadRequest() {
        assertThatThrownBy(() -> songService.createSongsBulk(List.of(), List.of()))
                .isInstanceOf(BadRequestException.class)
                .hasMessageContaining("At least one audio file");
    }

    @Test
    void createSongsBulk_withClientMetadata_createsSongs() {
        Artist artist = buildArtist("artist-1", "Artist A");
        when(artistRepository.findByName("Artist A")).thenReturn(Optional.empty());
        when(artistRepository.save(any(Artist.class))).thenReturn(artist);
        when(storageService.uploadSong(any(), anyString())).thenReturn("https://r2/songs/artist-1/a.flac");
        when(songRepository.save(any(Song.class))).thenAnswer(inv -> {
            Song s = inv.getArgument(0);
            s.setId("song-new");
            return s;
        });

        CreateSongRequest req = CreateSongRequest.builder()
                .title("Track One")
                .artistName("Artist A")
                .releaseDate(LocalDate.of(2025, 1, 1))
                .build();
        MockMultipartFile file = new MockMultipartFile("files", "a.flac", "audio/flac", new byte[]{1, 2, 3});

        List<SongResponse> created = songService.createSongsBulk(List.of(file), List.of(req));

        assertThat(created).hasSize(1);
        assertThat(created.get(0).getTitle()).isEqualTo("Track One");
        assertThat(created.get(0).getArtistName()).isEqualTo("Artist A");
        verify(artistRepository).save(any(Artist.class));
        verify(storageService).uploadSong(any(), anyString());
    }

    @Test
    void createSongsBulk_emptyRequestList_fallsBackToFilenameTitle() {
        Artist artist = buildArtist("artist-1", "Unknown Artist");
        when(artistRepository.findByName("Unknown Artist")).thenReturn(Optional.empty());
        when(artistRepository.save(any(Artist.class))).thenReturn(artist);
        when(storageService.uploadSong(any(), anyString())).thenReturn("https://r2/songs/artist-1/a.flac");
        when(songRepository.save(any(Song.class))).thenAnswer(inv -> {
            Song s = inv.getArgument(0);
            s.setId("song-new");
            return s;
        });

        MockMultipartFile file = new MockMultipartFile("files", "My Track.flac", "audio/flac", new byte[]{1, 2, 3});

        List<SongResponse> created = songService.createSongsBulk(List.of(file), List.of());

        assertThat(created).hasSize(1);
        assertThat(created.get(0).getTitle()).isEqualTo("My Track");
    }

    @Test
    void createSongsBulk_parsesRealFlacTags_andKeepsPartReadable() throws Exception {
        // Regression: metadata parsing must NOT consume or move the multipart
        // part. The old implementation used transferTo(), which on a real
        // Tomcat server MOVES the disk-backed temp file - the subsequent
        // storage upload (file.getBytes()) then failed with NoSuchFileException.
        // MockMultipartFile copies, so this test additionally proves the tags
        // are actually parsed from a real FLAC (old code also fell back to the
        // filename because the temp file lost its .flac extension).
        Artist artist = buildArtist("artist-1", "Orchestrator Test");
        when(artistRepository.findByName("Orchestrator Test")).thenReturn(Optional.empty());
        when(artistRepository.save(any(Artist.class))).thenReturn(artist);
        when(albumRepository.findByArtistId("artist-1")).thenReturn(List.of());
        Album album = Album.builder().id("album-1").name("Verification EP").artist(artist).build();
        when(albumRepository.save(any(Album.class))).thenReturn(album);
        when(storageService.uploadSong(any(), anyString())).thenReturn("https://r2/songs/artist-1/test-tone.flac");
        when(songRepository.save(any(Song.class))).thenAnswer(inv -> {
            Song s = inv.getArgument(0);
            s.setId("song-new");
            return s;
        });

        byte[] flacBytes;
        try (java.io.InputStream in = getClass().getResourceAsStream("/test-tone.flac")) {
            assertThat(in).as("test-tone.flac fixture missing").isNotNull();
            flacBytes = in.readAllBytes();
        }
        MockMultipartFile file = new MockMultipartFile("files", "test-tone.flac", "audio/flac", flacBytes);

        List<SongResponse> created = songService.createSongsBulk(List.of(file), List.of());

        assertThat(created).hasSize(1);
        // Tags parsed from the real FLAC (title/artist/album/duration)
        assertThat(created.get(0).getTitle()).isEqualTo("Test Tone 440Hz");
        assertThat(created.get(0).getArtistName()).isEqualTo("Orchestrator Test");
        assertThat(created.get(0).getAlbumName()).isEqualTo("Verification EP");
        assertThat(created.get(0).getDurationMs()).isGreaterThan(0);
        // The part is still fully readable for the storage upload
        assertThat(file.getBytes()).hasSize(flacBytes.length);
    }

    // ---------- recordPlayback ----------

    @Test
    void recordPlayback_upsertsRecentlyPlayed_andRecordsHistory() {
        User user = User.builder().id("user-1").build();
        when(userRepository.getReferenceById("user-1")).thenReturn(user);
        when(listeningHistoryRepository.findFirstByUserIdAndSongIdOrderByPlayedAtDesc("user-1", "song-1"))
                .thenReturn(Optional.empty());

        songService.recordPlayback("user-1", "song-1", "STREAM");

        verify(recentlyPlayedRepository).deleteByUserIdAndItemTypeAndItemId("user-1", "SONG", "song-1");
        verify(recentlyPlayedRepository).save(any(RecentlyPlayed.class));
        verify(listeningHistoryRepository).save(any(ListeningHistory.class));
    }

    @Test
    void recordPlayback_skipsHistoryWhenRecentEntryExists() {
        User user = User.builder().id("user-1").build();
        when(userRepository.getReferenceById("user-1")).thenReturn(user);
        when(listeningHistoryRepository.findFirstByUserIdAndSongIdOrderByPlayedAtDesc("user-1", "song-1"))
                .thenReturn(Optional.of(ListeningHistory.builder().playedAt(java.time.LocalDateTime.now()).build()));

        songService.recordPlayback("user-1", "song-1", "STREAM");

        verify(recentlyPlayedRepository).save(any(RecentlyPlayed.class));
        verify(listeningHistoryRepository, never()).save(any(ListeningHistory.class));
    }

    @Test
    void recordPlayback_blankUser_isNoOp() {
        songService.recordPlayback("", "song-1", "STREAM");

        verifyNoInteractions(recentlyPlayedRepository);
        verifyNoInteractions(listeningHistoryRepository);
    }
}
