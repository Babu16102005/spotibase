package com.spotibase.controller;

import com.spotibase.dto.response.HomeResponse;
import com.spotibase.service.HomeTier;
import com.spotibase.service.RecommendationService;
import com.spotibase.support.BaseWebMvcTest;
import com.spotibase.support.TestSecurityConfig;
import com.spotibase.support.TestUsers;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Arrays;
import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Web slice tests for {@link HomeController} tier dispatch.
 *
 * <p>Covers the {@code ?tier=} contract: each tier returns exactly its own
 * section ids, {@code all} preserves the legacy 10-section feed, unknown
 * values fail open to {@code all} (never 400), and a slow heavy section that
 * times out is omitted while the response stays 200.
 */
@WebMvcTest(HomeController.class)
@Import(TestSecurityConfig.class)
class HomeControllerTest extends BaseWebMvcTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private RecommendationService recommendationService;

    @BeforeEach
    void stubGreeting() {
        when(recommendationService.currentGreeting()).thenReturn("Good Morning");
    }

    private static HomeResponse.Section section(String id) {
        return HomeResponse.Section.builder()
                .id(id)
                .title(id)
                .type("SONG")
                .subtitle("")
                .items(List.of(Map.of("id", id + "-item")))
                .build();
    }

    private static HomeResponse home(String... ids) {
        return HomeResponse.builder()
                .greeting("Good Morning")
                .sections(Arrays.stream(ids).map(HomeControllerTest::section).toList())
                .build();
    }

    @Test
    void criticalTier_returnsExactlyRecentlyPlayedAndTrending() throws Exception {
        when(recommendationService.getHomeSections("user-1", HomeTier.CRITICAL))
                .thenReturn(home("recently-played", "trending"));

        mockMvc.perform(get("/api/v1/home").param("tier", "critical")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sections.length()").value(2))
                .andExpect(jsonPath("$.sections[0].id").value("recently-played"))
                .andExpect(jsonPath("$.sections[1].id").value("trending"))
                .andExpect(header().string("Cache-Control", Matchers.containsString("max-age=30")))
                .andExpect(header().string("Cache-Control", Matchers.containsString("private")));

        verify(recommendationService).getHomeSections(eq("user-1"), eq(HomeTier.CRITICAL));
    }

    @Test
    void secondaryTier_returnsExactlySixCatalogSections() throws Exception {
        when(recommendationService.getHomeSections("user-1", HomeTier.SECONDARY))
                .thenReturn(home("your-playlists", "new-releases", "featured-albums",
                        "featured-artists", "featured-playlists", "popular-genres"));

        mockMvc.perform(get("/api/v1/home").param("tier", "secondary")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sections.length()").value(6))
                .andExpect(jsonPath("$.sections[0].id").value("your-playlists"))
                .andExpect(jsonPath("$.sections[1].id").value("new-releases"))
                .andExpect(jsonPath("$.sections[2].id").value("featured-albums"))
                .andExpect(jsonPath("$.sections[3].id").value("featured-artists"))
                .andExpect(jsonPath("$.sections[4].id").value("featured-playlists"))
                .andExpect(jsonPath("$.sections[5].id").value("popular-genres"))
                .andExpect(header().string("Cache-Control", Matchers.containsString("max-age=120")))
                .andExpect(header().string("Cache-Control", Matchers.containsString("private")));

        verify(recommendationService).getHomeSections(eq("user-1"), eq(HomeTier.SECONDARY));
    }

    @Test
    void heavyTier_returnsExactlyMadeForYouAndDailyMixes() throws Exception {
        when(recommendationService.getHomeSections("user-1", HomeTier.HEAVY))
                .thenReturn(home("made-for-you", "daily-mixes"));

        mockMvc.perform(get("/api/v1/home").param("tier", "heavy")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sections.length()").value(2))
                .andExpect(jsonPath("$.sections[0].id").value("made-for-you"))
                .andExpect(jsonPath("$.sections[1].id").value("daily-mixes"))
                .andExpect(header().string("Cache-Control", Matchers.containsString("max-age=300")))
                .andExpect(header().string("Cache-Control", Matchers.containsString("private")));

        verify(recommendationService).getHomeSections(eq("user-1"), eq(HomeTier.HEAVY));
    }

    @Test
    void allTier_returnsLegacyTenSectionFeed() throws Exception {
        when(recommendationService.getHomeSections("user-1", HomeTier.ALL))
                .thenReturn(home("recently-played", "your-playlists", "trending", "new-releases",
                        "featured-albums", "featured-artists", "featured-playlists",
                        "made-for-you", "daily-mixes", "popular-genres"));

        mockMvc.perform(get("/api/v1/home").param("tier", "all")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sections.length()").value(10))
                .andExpect(jsonPath("$.sections[0].id").value("recently-played"))
                .andExpect(jsonPath("$.sections[9].id").value("popular-genres"));

        verify(recommendationService).getHomeSections(eq("user-1"), eq(HomeTier.ALL));
    }

    @Test
    void invalidTier_failsOpenToAll() throws Exception {
        when(recommendationService.getHomeSections("user-1", HomeTier.ALL))
                .thenReturn(home("recently-played", "your-playlists", "trending", "new-releases",
                        "featured-albums", "featured-artists", "featured-playlists",
                        "made-for-you", "daily-mixes", "popular-genres"));

        mockMvc.perform(get("/api/v1/home").param("tier", "bogus")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sections.length()").value(10));

        verify(recommendationService).getHomeSections(eq("user-1"), eq(HomeTier.ALL));
    }

    @Test
    void heavySlowSectionOmitted_stillReturns200WithPartialFeed() throws Exception {
        // Simulates the fail-open timeout: daily-mixes was slow and omitted,
        // the tier still returns 200 with the section it did build.
        when(recommendationService.getHomeSections("user-1", HomeTier.HEAVY))
                .thenReturn(home("made-for-you"));

        mockMvc.perform(get("/api/v1/home").param("tier", "heavy")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sections.length()").value(1))
                .andExpect(jsonPath("$.sections[0].id").value("made-for-you"));

        verify(recommendationService).getHomeSections(eq("user-1"), eq(HomeTier.HEAVY));
    }
}
