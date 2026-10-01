package com.spotibase.controller;

import com.spotibase.config.YoutubeConfig;
import com.spotibase.dto.response.YoutubeResolveResponse;
import com.spotibase.dto.response.YoutubeSearchResponse;
import com.spotibase.dto.response.YoutubeTrendingResponse;
import com.spotibase.dto.response.YoutubeVideoResponse;
import com.spotibase.exception.ResourceNotFoundException;
import com.spotibase.service.YoutubeService;
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
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Web slice tests for {@link YoutubeController}.
 *
 * <p>Covers the YouTube simulation surface:
 * {@code GET /api/v1/youtube/trending|search|resolve} with the mock
 * catalogue (no API key), 400 validation for bad query/id input, 401 for
 * unauthenticated callers, and 404 forwarding from the service layer.
 * Quota-fallback behaviour itself is covered in {@code YoutubeServiceTest};
 * here the service is mocked and only the HTTP contract is asserted.
 */
@WebMvcTest(YoutubeController.class)
@Import(TestSecurityConfig.class)
class YoutubeControllerTest extends BaseWebMvcTest {

    private static final String KNOWN_ID = "dQw4w9WgXcQ";

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private YoutubeService youtubeService;

    @MockBean
    private YoutubeConfig youtubeConfig;

    private YoutubeVideoResponse mockVideo() {
        return YoutubeVideoResponse.builder()
                .videoId(KNOWN_ID)
                .title("Lo-Fi Beats to Focus — 3 Hour Mix")
                .channelId("UCmockLoFi01")
                .channelTitle("Chill Lab")
                .thumbnailUrl("https://i.ytimg.com/vi/" + KNOWN_ID + "/hqdefault.jpg")
                .duration("PT3H2M")
                .viewCount(48_200_000L)
                .source("MOCK")
                .build();
    }

    // --- trending ----------------------------------------------------------

    @Test
    void trending_authenticated_returns200WithMockSource() throws Exception {
        when(youtubeService.getTrending("IN", 15, null)).thenReturn(YoutubeTrendingResponse.builder()
                .regionCode("IN")
                .maxResults(15)
                .count(1)
                .source("MOCK")
                .videos(List.of(mockVideo()))
                .build());

        mockMvc.perform(get("/api/v1/youtube/trending")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.regionCode").value("IN"))
                .andExpect(jsonPath("$.source").value("MOCK"))
                .andExpect(jsonPath("$.videos[0].videoId").value(KNOWN_ID));

        verify(youtubeService).getTrending("IN", 15, null);
    }

    @Test
    void trending_customRegionAndLimit_forwardedUppercase() throws Exception {
        when(youtubeService.getTrending("IN", 5, null)).thenReturn(YoutubeTrendingResponse.builder()
                .regionCode("IN")
                .maxResults(5)
                .count(1)
                .source("MOCK")
                .videos(List.of(mockVideo()))
                .build());

        mockMvc.perform(get("/api/v1/youtube/trending")
                        .param("regionCode", "in")
                        .param("maxResults", "5")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.regionCode").value("IN"));

        verify(youtubeService).getTrending("IN", 5, null);
    }

    @Test
    void trending_oversizedLimit_returns400() throws Exception {
        mockMvc.perform(get("/api/v1/youtube/trending")
                        .param("maxResults", "500")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isBadRequest());

        verifyNoInteractions(youtubeService);
    }

    @Test
    void trending_zeroLimit_returns400() throws Exception {
        mockMvc.perform(get("/api/v1/youtube/trending")
                        .param("maxResults", "0")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isBadRequest());

        verifyNoInteractions(youtubeService);
    }

    @Test
    void trending_nonNumericLimit_returns400() throws Exception {
        mockMvc.perform(get("/api/v1/youtube/trending")
                        .param("maxResults", "abc")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isBadRequest());

        verifyNoInteractions(youtubeService);
    }

    @Test
    void trending_threeLetterRegion_returns400() throws Exception {
        mockMvc.perform(get("/api/v1/youtube/trending")
                        .param("regionCode", "USA")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isBadRequest());

        verifyNoInteractions(youtubeService);
    }

    @Test
    void trending_singleCharRegion_returns400() throws Exception {
        mockMvc.perform(get("/api/v1/youtube/trending")
                        .param("regionCode", "U")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isBadRequest());

        verifyNoInteractions(youtubeService);
    }

    @Test
    void trending_unauthenticated_returns401() throws Exception {
        mockMvc.perform(get("/api/v1/youtube/trending"))
                .andExpect(status().isUnauthorized());

        verifyNoInteractions(youtubeService);
    }

    // --- search ------------------------------------------------------------

    @Test
    void search_authenticated_returns200() throws Exception {
        when(youtubeService.search("lofi", "IN", "ta", "ta", 15, null)).thenReturn(YoutubeSearchResponse.builder()
                .query("lofi")
                .maxResults(15)
                .count(1)
                .source("MOCK")
                .videos(List.of(mockVideo()))
                .build());

        mockMvc.perform(get("/api/v1/youtube/search")
                        .param("q", "lofi")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.query").value("lofi"))
                .andExpect(jsonPath("$.source").value("MOCK"))
                .andExpect(jsonPath("$.videos[0].videoId").value(KNOWN_ID));

        verify(youtubeService).search("lofi", "IN", "ta", "ta", 15, null);
    }

    @Test
    void search_missingQuery_returns400() throws Exception {
        mockMvc.perform(get("/api/v1/youtube/search")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isBadRequest());

        verifyNoInteractions(youtubeService);
    }

    @Test
    void search_blankQuery_returns400() throws Exception {
        mockMvc.perform(get("/api/v1/youtube/search")
                        .param("q", "   ")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isBadRequest());

        verifyNoInteractions(youtubeService);
    }

    @Test
    void search_overlongQuery_returns400() throws Exception {
        mockMvc.perform(get("/api/v1/youtube/search")
                        .param("q", "a".repeat(201))
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isBadRequest());

        verifyNoInteractions(youtubeService);
    }

    @Test
    void search_unauthenticated_returns401() throws Exception {
        mockMvc.perform(get("/api/v1/youtube/search")
                        .param("q", "lofi"))
                .andExpect(status().isUnauthorized());

        verifyNoInteractions(youtubeService);
    }

    // --- resolve -----------------------------------------------------------

    @Test
    void resolve_authenticated_returns200WithUrls() throws Exception {
        when(youtubeService.resolve(KNOWN_ID)).thenReturn(YoutubeResolveResponse.builder()
                .source("MOCK")
                .watchUrl("https://www.youtube.com/watch?v=" + KNOWN_ID)
                .embedUrl("https://www.youtube.com/embed/" + KNOWN_ID)
                .video(mockVideo())
                .build());

        mockMvc.perform(get("/api/v1/youtube/resolve")
                        .param("id", KNOWN_ID)
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.source").value("MOCK"))
                .andExpect(jsonPath("$.watchUrl").value("https://www.youtube.com/watch?v=" + KNOWN_ID))
                .andExpect(jsonPath("$.embedUrl").value("https://www.youtube.com/embed/" + KNOWN_ID))
                .andExpect(jsonPath("$.video.videoId").value(KNOWN_ID));

        verify(youtubeService).resolve(KNOWN_ID);
    }

    @Test
    void resolve_missingId_returns400() throws Exception {
        mockMvc.perform(get("/api/v1/youtube/resolve")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isBadRequest());

        verifyNoInteractions(youtubeService);
    }

    @Test
    void resolve_malformedId_returns400() throws Exception {
        mockMvc.perform(get("/api/v1/youtube/resolve")
                        .param("id", "short")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isBadRequest());

        verifyNoInteractions(youtubeService);
    }

    @Test
    void resolve_idWithIllegalChars_returns400() throws Exception {
        mockMvc.perform(get("/api/v1/youtube/resolve")
                        .param("id", "bad id !!12")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isBadRequest());

        verifyNoInteractions(youtubeService);
    }

    @Test
    void resolve_unknownVideo_forwards404FromService() throws Exception {
        when(youtubeService.resolve("AAAAAAAAAAA"))
                .thenThrow(new ResourceNotFoundException("YouTube video", "AAAAAAAAAAA"));

        mockMvc.perform(get("/api/v1/youtube/resolve")
                        .param("id", "AAAAAAAAAAA")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isNotFound());
    }

    @Test
    void resolve_unauthenticated_returns401() throws Exception {
        mockMvc.perform(get("/api/v1/youtube/resolve")
                        .param("id", KNOWN_ID))
                .andExpect(status().isUnauthorized());

        verifyNoInteractions(youtubeService);
    }
}
