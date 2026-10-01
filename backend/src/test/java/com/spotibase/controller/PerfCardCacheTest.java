package com.spotibase.controller;

import com.spotibase.dto.response.PagedResponse;
import com.spotibase.dto.response.SearchResponse;
import com.spotibase.dto.response.SongResponse;
import com.spotibase.service.LikeService;
import com.spotibase.service.R2StorageService;
import com.spotibase.service.SearchService;
import com.spotibase.service.SongService;
import com.spotibase.service.StorageService;
import com.spotibase.support.BaseWebMvcTest;
import com.spotibase.support.TestSecurityConfig;
import com.spotibase.support.TestUsers;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Minimal perf-project tests: {@code ?fields=card} shape + clamps and
 * {@code Cache-Control} on the song catalog and search endpoints.
 */
@WebMvcTest({SongController.class, SearchController.class})
@Import(TestSecurityConfig.class)
class PerfCardCacheTest extends BaseWebMvcTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private SongService songService;

    @MockBean
    private LikeService likeService;

    @MockBean
    private StorageService storageService;

    @MockBean
    private R2StorageService r2StorageService;

    @MockBean
    private SearchService searchService;

    private SongResponse cardSong() {
        return SongResponse.builder()
                .id("song-1")
                .title("Hit Song")
                .artistName("The Band")
                .coverUrl("https://cdn.example.com/art/song-1.jpg")
                .durationMs(180000)
                .playCount(42)
                .build();
    }

    private PagedResponse<SongResponse> oneSongPage(int page, int size) {
        return PagedResponse.<SongResponse>builder()
                .content(List.of(cardSong()))
                .page(page)
                .size(size)
                .totalElements(1)
                .totalPages(1)
                .first(true)
                .last(true)
                .build();
    }

    @Test
    void songs_card_returnsSlimShape_clampedTo30_withPrivateCacheControl() throws Exception {
        when(songService.getAllSongs(0, 30, "user-1")).thenReturn(oneSongPage(0, 30));

        mockMvc.perform(get("/api/v1/songs")
                        .param("fields", "card")
                        .param("size", "100")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isOk())
                // Card shape: exactly the tile fields, playCount aliased as likeCount.
                .andExpect(jsonPath("$.content[0].id").value("song-1"))
                .andExpect(jsonPath("$.content[0].title").value("Hit Song"))
                .andExpect(jsonPath("$.content[0].artistName").value("The Band"))
                .andExpect(jsonPath("$.content[0].coverUrl").value("https://cdn.example.com/art/song-1.jpg"))
                .andExpect(jsonPath("$.content[0].durationMs").value(180000))
                .andExpect(jsonPath("$.content[0].likeCount").value(42))
                // Full-only payload must not leak into cards.
                .andExpect(jsonPath("$.content[0].lyrics").doesNotExist())
                .andExpect(jsonPath("$.content[0].fileUrl").doesNotExist())
                // Authenticated catalog overlay: private, 30s.
                .andExpect(header().string("Cache-Control", org.hamcrest.Matchers.containsString("max-age=30")))
                .andExpect(header().string("Cache-Control", org.hamcrest.Matchers.containsString("private")));

        verify(songService).getAllSongs(0, 30, "user-1");
    }

    @Test
    void songs_full_defaultCap_is50_withCacheControl() throws Exception {
        when(songService.getAllSongs(0, 50, "user-1")).thenReturn(oneSongPage(0, 50));

        mockMvc.perform(get("/api/v1/songs")
                        .param("size", "200")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].id").value("song-1"))
                .andExpect(header().exists("Cache-Control"));

        verify(songService).getAllSongs(0, 50, "user-1");
    }

    @Test
    void songs_cursor_card_clampedTo30_withCacheControl() throws Exception {
        when(songService.getSongsAfterCursor(null, 30, "user-1")).thenReturn(List.of(cardSong()));

        mockMvc.perform(get("/api/v1/songs/cursor")
                        .param("fields", "card")
                        .param("size", "99")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value("song-1"))
                .andExpect(jsonPath("$[0].likeCount").value(42))
                .andExpect(jsonPath("$[0].lyrics").doesNotExist())
                .andExpect(header().exists("Cache-Control"));

        verify(songService).getSongsAfterCursor(null, 30, "user-1");
    }

    @Test
    void search_clampsSizeTo20_withPrivateCacheControl() throws Exception {
        SearchResponse response = SearchResponse.builder()
                .query("queen")
                .totalResults(0)
                .page(0)
                .size(20)
                .hasMore(false)
                .build();
        when(searchService.search("queen", List.of("song", "album", "artist", "playlist"),
                0, 20, null, null, null, "relevance", "user-1")).thenReturn(response);

        mockMvc.perform(get("/api/v1/search")
                        .param("query", "queen")
                        .param("size", "100")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.query").value("queen"))
                .andExpect(header().string("Cache-Control", org.hamcrest.Matchers.containsString("max-age=30")))
                .andExpect(header().string("Cache-Control", org.hamcrest.Matchers.containsString("private")));

        verify(searchService).search("queen", List.of("song", "album", "artist", "playlist"),
                0, 20, null, null, null, "relevance", "user-1");
    }

    @Test
    void search_suggestions_public_clampsLimitTo20_withPublicCacheControl() throws Exception {
        when(searchService.getSuggestions("qu", 20)).thenReturn(List.of("queen (artist)"));

        mockMvc.perform(get("/api/v1/search/suggestions")
                        .param("query", "qu")
                        .param("limit", "100"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0]").value("queen (artist)"))
                .andExpect(header().string("Cache-Control", org.hamcrest.Matchers.containsString("max-age=60")))
                .andExpect(header().string("Cache-Control", org.hamcrest.Matchers.containsString("public")));

        verify(searchService).getSuggestions("qu", 20);
    }
}
