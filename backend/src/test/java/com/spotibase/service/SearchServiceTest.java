package com.spotibase.service;

import com.spotibase.dto.response.AlbumResponse;
import com.spotibase.dto.response.ArtistResponse;
import com.spotibase.dto.response.PlaylistResponse;
import com.spotibase.dto.response.SearchResponse;
import com.spotibase.dto.response.SongResponse;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * Unit tests for {@link SearchService}.
 *
 * <p>Native-query paths are exercised by mocking {@link EntityManager}/{@link Query};
 * the pure delegation logic of {@link SearchService#search} is the focus.
 */
@ExtendWith(MockitoExtension.class)
class SearchServiceTest {

    @Mock
    private EntityManager entityManager;
    @Mock
    private SongService songService;
    @Mock
    private AlbumService albumService;
    @Mock
    private ArtistService artistService;
    @Mock
    private PlaylistService playlistService;

    @InjectMocks
    private SearchService searchService;

    private Query query;

    @BeforeEach
    void setUp() {
        query = mock(Query.class);
        lenient().when(entityManager.createNativeQuery(anyString())).thenReturn(query);
    }

    private SongResponse songResponse(String id) {
        return SongResponse.builder().id(id).title("Song " + id).build();
    }

    // ---------- search ----------

    @Test
    void search_songTypeOnly_delegatesToSongService() {
        when(query.getResultList()).thenReturn(List.of(new Object[]{"song-1"}, new Object[]{"song-2"}));
        when(songService.getSongsByIds(List.of("song-1", "song-2"), "user-1"))
                .thenReturn(List.of(songResponse("song-1"), songResponse("song-2")));

        SearchResponse response = searchService.search(
                "hello", List.of("song"), 0, 20, null, null, null, "relevance", "user-1");

        assertThat(response.getQuery()).isEqualTo("hello");
        assertThat(response.getPage()).isZero();
        assertThat(response.getSize()).isEqualTo(20);
        assertThat(response.getSongs()).hasSize(2);
        assertThat(response.getAlbums()).isNull();
        assertThat(response.getArtists()).isNull();
        assertThat(response.getPlaylists()).isNull();
        verify(query).setFirstResult(0);
        verify(query).setMaxResults(20);
        verify(songService).getSongsByIds(List.of("song-1", "song-2"), "user-1");
    }

    @Test
    void search_allTypes_delegatesToAllServices() {
        when(query.getResultList()).thenReturn(List.of());
        lenient().when(songService.getSongsByIds(List.of(), "user-1")).thenReturn(List.of());
        lenient().when(albumService.getAlbumById(anyString(), anyString()))
                .thenThrow(new RuntimeException("not found"));
        lenient().when(artistService.getArtistById(anyString(), anyString()))
                .thenThrow(new RuntimeException("not found"));
        when(playlistService.searchPlaylists(anyString(), any()))
                .thenReturn(List.of(PlaylistResponse.builder().id("pl-1").build()));

        SearchResponse response = searchService.search(
                "rock", List.of("song", "album", "artist", "playlist"), 1, 10,
                "EN", 2024, "Rock", "relevance", "user-1");

        assertThat(response.getSongs()).isEmpty();
        assertThat(response.getAlbums()).isEmpty();
        assertThat(response.getArtists()).isEmpty();
        assertThat(response.getPlaylists()).hasSize(1);
    }

    @Test
    void search_albumServiceFailure_isFilteredOut() {
        when(query.getResultList()).thenReturn(List.of("album-1", "album-2"));
        when(albumService.getAlbumById("album-1", "user-1"))
                .thenReturn(AlbumResponse.builder().id("album-1").build());
        when(albumService.getAlbumById("album-2", "user-1"))
                .thenThrow(new RuntimeException("album gone"));

        SearchResponse response = searchService.search(
                "rock", List.of("album"), 0, 20, null, null, null, "relevance", "user-1");

        assertThat(response.getAlbums()).hasSize(1);
        assertThat(response.getAlbums().get(0).getId()).isEqualTo("album-1");
    }

    @Test
    void search_artistServiceFailure_isFilteredOut() {
        when(query.getResultList()).thenReturn(List.of("artist-1"));
        when(artistService.getArtistById("artist-1", "user-1"))
                .thenThrow(new RuntimeException("artist gone"));

        SearchResponse response = searchService.search(
                "rock", List.of("artist"), 0, 20, null, null, null, "relevance", "user-1");

        assertThat(response.getArtists()).isEmpty();
    }

    @Test
    void search_emptyQuery_returnsEmptySections() {
        when(query.getResultList()).thenReturn(List.of());
        when(songService.getSongsByIds(List.of(), "user-1")).thenReturn(List.of());

        SearchResponse response = searchService.search(
                "", List.of("song"), 0, 20, null, null, null, "relevance", "user-1");

        assertThat(response.getQuery()).isEmpty();
        assertThat(response.getSongs()).isEmpty();
    }

    @Test
    void search_noMatchingTypes_returnsBareResponse() {
        SearchResponse response = searchService.search(
                "x", List.of(), 0, 20, null, null, null, "relevance", "user-1");

        assertThat(response.getSongs()).isNull();
        assertThat(response.getAlbums()).isNull();
        assertThat(response.getArtists()).isNull();
        assertThat(response.getPlaylists()).isNull();
        verify(entityManager, never()).createNativeQuery(anyString());
    }

    // ---------- suggestions ----------

    @Test
    void getSuggestions_formatsNameAndTypeFromRows() {
        when(query.getResultList()).thenReturn(List.of(
                new Object[]{"Song Name", "song"},
                new Object[]{"Artist Name", "artist"}));

        List<String> suggestions = searchService.getSuggestions("nam", 10);

        assertThat(suggestions).containsExactly("Song Name (song)", "Artist Name (artist)");
        verify(query).setParameter("query", "nam");
        verify(query).setParameter("limit", 10);
    }

    @Test
    void getSuggestions_emptyResults_returnsEmptyList() {
        when(query.getResultList()).thenReturn(List.of());

        List<String> suggestions = searchService.getSuggestions("zzz", 10);

        assertThat(suggestions).isEmpty();
    }

    // ---------- trending ----------

    @Test
    void getTrendingSearches_returnsStaticList() {
        List<String> trending = searchService.getTrendingSearches(10);

        assertThat(trending).isNotEmpty();
        assertThat(trending).contains("top hits 2024");
    }
}
