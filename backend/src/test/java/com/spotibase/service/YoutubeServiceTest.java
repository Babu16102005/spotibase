package com.spotibase.service;

import com.spotibase.config.YoutubeConfig;
import com.spotibase.dto.response.YoutubeResolveResponse;
import com.spotibase.dto.response.YoutubeSearchResponse;
import com.spotibase.dto.response.YoutubeTrendingResponse;
import com.spotibase.dto.response.YoutubeVideoResponse;
import com.spotibase.exception.ResourceNotFoundException;
import com.spotibase.exception.YoutubeQuotaExceededException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link YoutubeService} (plain Mockito, no Spring context —
 * {@code @Cacheable} is inert here so every call exercises the logic).
 *
 * <p>Covers the YouTube simulation contract:
 * <ul>
 *   <li>mock catalogue when no API key is configured ({@code isLiveEnabled=false});</li>
 *   <li>fail-open mock fallback on quota exhaustion, empty live results, and
 *       generic upstream failures;</li>
 *   <li>live passthrough when the Data API answers;</li>
 *   <li>404 for unknown video ids, limit clamping, region normalisation.</li>
 * </ul>
 */
class YoutubeServiceTest {

    private static final String KNOWN_ID = "dQw4w9WgXcQ";
    private static final String UNKNOWN_ID = "AAAAAAAAAAA";

    private YoutubeClient youtubeClient;
    private YoutubeConfig youtubeConfig;
    private YoutubeService youtubeService;

    @BeforeEach
    void setUp() {
        youtubeClient = mock(YoutubeClient.class);
        youtubeConfig = mock(YoutubeConfig.class);
        when(youtubeConfig.getRegionCode()).thenReturn("US");
        when(youtubeConfig.getApiKey()).thenReturn("test-key");
        youtubeService = new YoutubeService(youtubeClient, youtubeConfig);
    }

    private void mockMode() {
        when(youtubeConfig.isLiveEnabled()).thenReturn(false);
    }

    private void liveMode() {
        when(youtubeConfig.isLiveEnabled()).thenReturn(true);
    }

    private YoutubeVideoResponse liveVideo(String id, String title) {
        return YoutubeVideoResponse.builder()
                .videoId(id)
                .title(title)
                .channelId("UClive")
                .channelTitle("Live Channel")
                .thumbnailUrl("https://i.ytimg.com/vi/" + id + "/hqdefault.jpg")
                .duration("PT4M13S")
                .viewCount(1_000L)
                .source("LIVE")
                .build();
    }

    // --- trending ----------------------------------------------------------

    @Test
    void trending_mockMode_returnsCatalogueAsMockWithoutTouchingClient() {
        mockMode();

        YoutubeTrendingResponse res = youtubeService.getTrending("US", 10);

        assertThat(res.getSource()).isEqualTo("MOCK");
        assertThat(res.getRegionCode()).isEqualTo("US");
        assertThat(res.getMaxResults()).isEqualTo(10);
        assertThat(res.getVideos()).hasSize(10);
        verifyNoInteractions(youtubeClient);
    }

    @Test
    void trending_blankRegion_fallsBackToConfiguredDefault() {
        mockMode();

        YoutubeTrendingResponse res = youtubeService.getTrending("   ", 5);

        assertThat(res.getRegionCode()).isEqualTo("US");
        assertThat(res.getSource()).isEqualTo("MOCK");
    }

    @Test
    void trending_lowercaseRegion_normalizedToUppercase() {
        mockMode();

        YoutubeTrendingResponse res = youtubeService.getTrending("in", 5);

        assertThat(res.getRegionCode()).isEqualTo("IN");
    }

    @Test
    void trending_zeroLimit_defaultsTo15() {
        mockMode();

        YoutubeTrendingResponse res = youtubeService.getTrending("US", 0);

        assertThat(res.getMaxResults()).isEqualTo(15);
        assertThat(res.getVideos()).hasSize(15);
    }

    @Test
    void trending_hugeLimit_cappedAt50WithCatalogueSizeCount() {
        mockMode();

        YoutubeTrendingResponse res = youtubeService.getTrending("US", 500);

        assertThat(res.getMaxResults()).isEqualTo(50);
        // The offline catalogue only holds 15 entries.
        assertThat(res.getCount()).isEqualTo(15);
        assertThat(res.getVideos()).hasSize(15);
    }

    @Test
    void trending_quotaExceeded_fallsBackToMock() {
        liveMode();
        when(youtubeClient.fetchTrending(anyString(), anyInt(), anyString()))
                .thenThrow(new YoutubeQuotaExceededException("quota exceeded"));

        YoutubeTrendingResponse res = youtubeService.getTrending("US", 10);

        assertThat(res.getSource()).isEqualTo("MOCK");
        assertThat(res.getVideos()).hasSize(10);
    }

    @Test
    void trending_genericUpstreamFailure_fallsBackToMock() {
        liveMode();
        when(youtubeClient.fetchTrending(anyString(), anyInt(), anyString()))
                .thenThrow(new RuntimeException("network down"));

        YoutubeTrendingResponse res = youtubeService.getTrending("US", 10);

        assertThat(res.getSource()).isEqualTo("MOCK");
        assertThat(res.getVideos()).isNotEmpty();
    }

    @Test
    void trending_emptyLiveResult_fallsBackToMock() {
        liveMode();
        when(youtubeClient.fetchTrending(anyString(), anyInt(), anyString()))
                .thenReturn(List.of());

        YoutubeTrendingResponse res = youtubeService.getTrending("US", 10);

        assertThat(res.getSource()).isEqualTo("MOCK");
        assertThat(res.getVideos()).isNotEmpty();
    }

    @Test
    void trending_liveSuccess_returnsLiveCappedToLimit() {
        liveMode();
        when(youtubeClient.fetchTrending("US", 2, "test-key")).thenReturn(List.of(
                liveVideo("live0000001", "Live One"),
                liveVideo("live0000002", "Live Two"),
                liveVideo("live0000003", "Live Three")));

        YoutubeTrendingResponse res = youtubeService.getTrending("US", 2);

        assertThat(res.getSource()).isEqualTo("LIVE");
        assertThat(res.getCount()).isEqualTo(2);
        assertThat(res.getVideos()).extracting(YoutubeVideoResponse::getVideoId)
                .containsExactly("live0000001", "live0000002");
    }

    // --- search ------------------------------------------------------------

    @Test
    void search_mockMode_filtersCatalogueCaseInsensitively() {
        mockMode();

        YoutubeSearchResponse res = youtubeService.search("lo-fi", 10);

        assertThat(res.getSource()).isEqualTo("MOCK");
        assertThat(res.getQuery()).isEqualTo("lo-fi");
        assertThat(res.getVideos()).isNotEmpty();
        assertThat(res.getVideos()).allMatch(v ->
                v.getTitle().toLowerCase().contains("lo-fi")
                        || (v.getChannelTitle() != null && v.getChannelTitle().toLowerCase().contains("lo-fi")));
    }

    @Test
    void search_mockMode_unknownQuery_returnsFullCatalogue() {
        mockMode();

        YoutubeSearchResponse res = youtubeService.search("zzz-no-such-video-xyz", 10);

        assertThat(res.getSource()).isEqualTo("MOCK");
        assertThat(res.getVideos()).hasSize(10);
    }

    @Test
    void search_quotaExceeded_fallsBackToMock() {
        liveMode();
        when(youtubeClient.search(anyString(), anyInt(), anyString()))
                .thenThrow(new YoutubeQuotaExceededException("quota exceeded"));

        YoutubeSearchResponse res = youtubeService.search("lofi", 5);

        assertThat(res.getSource()).isEqualTo("MOCK");
        assertThat(res.getVideos()).isNotEmpty();
    }

    @Test
    void search_liveSuccess_returnsLiveCappedToLimit() {
        liveMode();
        when(youtubeClient.search("queen", 1, "test-key")).thenReturn(List.of(
                liveVideo("live0000001", "Queen Live"),
                liveVideo("live0000002", "Queen Cover")));

        YoutubeSearchResponse res = youtubeService.search("queen", 1);

        assertThat(res.getSource()).isEqualTo("LIVE");
        assertThat(res.getCount()).isEqualTo(1);
        assertThat(res.getVideos().get(0).getVideoId()).isEqualTo("live0000001");
    }

    // --- resolve -----------------------------------------------------------

    @Test
    void resolve_mockMode_knownId_returnsMockWithDerivedUrls() {
        mockMode();

        YoutubeResolveResponse res = youtubeService.resolve(KNOWN_ID);

        assertThat(res.getSource()).isEqualTo("MOCK");
        assertThat(res.getWatchUrl()).isEqualTo("https://www.youtube.com/watch?v=" + KNOWN_ID);
        assertThat(res.getEmbedUrl()).isEqualTo("https://www.youtube-nocookie.com/embed/" + KNOWN_ID);
        assertThat(res.getVideo().getVideoId()).isEqualTo(KNOWN_ID);
        assertThat(res.getVideo().getSource()).isEqualTo("MOCK");
        verifyNoInteractions(youtubeClient);
    }

    @Test
    void resolve_lookupIsCaseInsensitive() {
        mockMode();

        YoutubeResolveResponse res = youtubeService.resolve(KNOWN_ID.toLowerCase());

        assertThat(res.getVideo().getVideoId()).isEqualTo(KNOWN_ID);
    }

    @Test
    void resolve_mockMode_unknownId_throws404() {
        mockMode();

        assertThatThrownBy(() -> youtubeService.resolve(UNKNOWN_ID))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void resolve_liveSuccess_returnsLiveWithDerivedUrls() {
        liveMode();
        when(youtubeClient.resolve(KNOWN_ID, "test-key"))
                .thenReturn(Optional.of(liveVideo(KNOWN_ID, "Live Title")));

        YoutubeResolveResponse res = youtubeService.resolve(KNOWN_ID);

        assertThat(res.getSource()).isEqualTo("LIVE");
        assertThat(res.getVideo().getVideoId()).isEqualTo(KNOWN_ID);
        assertThat(res.getVideo().getSource()).isEqualTo("LIVE");
        assertThat(res.getEmbedUrl()).contains(KNOWN_ID);
        assertThat(res.getWatchUrl()).contains(KNOWN_ID);
    }

    @Test
    void resolve_liveEmpty_knownMockId_returnsMock() {
        liveMode();
        when(youtubeClient.resolve(KNOWN_ID, "test-key")).thenReturn(Optional.empty());

        YoutubeResolveResponse res = youtubeService.resolve(KNOWN_ID);

        assertThat(res.getSource()).isEqualTo("MOCK");
        assertThat(res.getVideo().getVideoId()).isEqualTo(KNOWN_ID);
    }

    @Test
    void resolve_liveEmpty_unknownId_throws404() {
        liveMode();
        when(youtubeClient.resolve(UNKNOWN_ID, "test-key")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> youtubeService.resolve(UNKNOWN_ID))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void resolve_quotaExceeded_knownId_fallsBackToMock() {
        liveMode();
        when(youtubeClient.resolve(KNOWN_ID, "test-key"))
                .thenThrow(new YoutubeQuotaExceededException("quota exceeded"));

        YoutubeResolveResponse res = youtubeService.resolve(KNOWN_ID);

        assertThat(res.getSource()).isEqualTo("MOCK");
        assertThat(res.getVideo().getVideoId()).isEqualTo(KNOWN_ID);
    }

    @Test
    void resolve_genericFailure_unknownId_throws404() {
        liveMode();
        when(youtubeClient.resolve(UNKNOWN_ID, "test-key"))
                .thenThrow(new RuntimeException("connection reset"));

        assertThatThrownBy(() -> youtubeService.resolve(UNKNOWN_ID))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    // --- clamp edges -------------------------------------------------------

    @Test
    void clamp_nonPositiveDefaultsTo15AndCapsAt50() {
        assertThat(YoutubeService.clamp(0)).isEqualTo(15);
        assertThat(YoutubeService.clamp(-3)).isEqualTo(15);
        assertThat(YoutubeService.clamp(7)).isEqualTo(7);
        assertThat(YoutubeService.clamp(50)).isEqualTo(50);
        assertThat(YoutubeService.clamp(500)).isEqualTo(50);
    }
}
