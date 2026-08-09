package com.spotibase.controller;

import com.spotibase.dto.response.SearchResponse;
import com.spotibase.service.SearchService;
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
 * Web slice tests for {@link SearchController}.
 *
 * <p>{@code /api/v1/search} (main search) requires authentication, while
 * {@code /suggestions} and {@code /trending} are public.
 */
@WebMvcTest(SearchController.class)
@Import(TestSecurityConfig.class)
class SearchControllerTest extends BaseWebMvcTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private SearchService searchService;

    @Test
    void search_authenticated_returns200() throws Exception {
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
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.query").value("queen"))
                .andExpect(jsonPath("$.page").value(0));
    }

    @Test
    void search_withAllFilters_passesThemThrough() throws Exception {
        when(searchService.search("queen", List.of("song"), 2, 5, "en", 1980, "rock", "newest", "user-1"))
                .thenReturn(SearchResponse.builder().query("queen").build());

        mockMvc.perform(get("/api/v1/search")
                        .param("query", "queen")
                        .param("types", "song")
                        .param("page", "2")
                        .param("size", "5")
                        .param("language", "en")
                        .param("year", "1980")
                        .param("genre", "rock")
                        .param("sortBy", "newest")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isOk());

        verify(searchService).search("queen", List.of("song"), 2, 5, "en", 1980, "rock", "newest", "user-1");
    }

    @Test
    void search_unauthenticated_isRejected() throws Exception {
        mockMvc.perform(get("/api/v1/search")
                        .param("query", "queen"))
                .andExpect(status().isForbidden());
    }

    @Test
    void search_missingQueryParam_returns400() throws Exception {
        mockMvc.perform(get("/api/v1/search")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isBadRequest());
    }

    @Test
    void search_emptyQueryPassesThrough_noValidationInController() throws Exception {
        // Production behavior: the controller does not validate that query is non-blank;
        // an empty string is forwarded to the service unchanged.
        when(searchService.search("", List.of("song", "album", "artist", "playlist"),
                0, 20, null, null, null, "relevance", "user-1"))
                .thenReturn(SearchResponse.builder().query("").build());

        mockMvc.perform(get("/api/v1/search")
                        .param("query", "")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isOk());
    }

    @Test
    void getSuggestions_isPublic_returns200() throws Exception {
        when(searchService.getSuggestions("qu", 10)).thenReturn(List.of("queen (artist)"));

        mockMvc.perform(get("/api/v1/search/suggestions")
                        .param("query", "qu"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0]").value("queen (artist)"));

        verify(searchService).getSuggestions("qu", 10);
    }

    @Test
    void getTrendingSearches_isPublic_returns200() throws Exception {
        when(searchService.getTrendingSearches(10)).thenReturn(List.of("top hits 2024"));

        mockMvc.perform(get("/api/v1/search/trending"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0]").value("top hits 2024"));

        verify(searchService).getTrendingSearches(10);
    }
}
