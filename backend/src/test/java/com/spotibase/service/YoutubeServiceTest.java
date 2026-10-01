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
import static org.mockito.ArgumentMatchers.any;
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
        // The offline catalogue holds 19 entries (15 + 4 Tamil/Kollywood).
        assertThat(res.getCount()).isEqualTo(19);
        assertThat(res.getVideos()).hasSize(19);
    }

    @Test
    void trending_quotaExceeded_fallsBackToMock() {
        liveMode();
        when(youtubeClient.fetchTrendingPaged(anyString(), anyInt(), any(), anyString()))
                .thenThrow(new YoutubeQuotaExceededException("quota exceeded"));

        YoutubeTrendingResponse res = youtubeService.getTrending("US", 10);

        assertThat(res.getSource()).isEqualTo("MOCK");
        assertThat(res.getVideos()).hasSize(10);
    }

    @Test
    void trending_genericUpstreamFailure_fallsBackToMock() {
        liveMode();
        when(youtubeClient.fetchTrendingPaged(anyString(), anyInt(), any(), anyString()))
                .thenThrow(new RuntimeException("network down"));

        YoutubeTrendingResponse res = youtubeService.getTrending("US", 10);

        assertThat(res.getSource()).isEqualTo("MOCK");
        assertThat(res.getVideos()).isNotEmpty();
    }

    @Test
    void trending_emptyLiveResult_fallsBackToMock() {
        liveMode();
        when(youtubeClient.fetchTrendingPaged(anyString(), anyInt(), any(), anyString()))
                .thenReturn(new YoutubeClient.YoutubePage(List.of(), null));

        YoutubeTrendingResponse res = youtubeService.getTrending("US", 10);

        assertThat(res.getSource()).isEqualTo("MOCK");
        assertThat(res.getVideos()).isNotEmpty();
    }

    @Test
    void trending_liveSuccess_returnsLiveCappedToLimit() {
        liveMode();
        when(youtubeClient.fetchTrendingPaged(anyString(), anyInt(), any(), anyString()))
                .thenReturn(new YoutubeClient.YoutubePage(List.of(
                        liveVideo("live0000001", "Live One"),
                        liveVideo("live0000002", "Live Two"),
                        liveVideo("live0000003", "Live Three")), null));

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
    void search_mockMode_unknownQuery_returnsEmpty() {
        mockMode();

        YoutubeSearchResponse res = youtubeService.search("zzz-no-such-video-xyz", 10);

        assertThat(res.getSource()).isEqualTo("MOCK");
        assertThat(res.getVideos()).isEmpty();
        assertThat(res.getCount()).isZero();
    }

    @Test
    void search_quotaExceeded_fallsBackToMock() {
        liveMode();
        when(youtubeClient.searchPaged(anyString(), anyString(), anyString(), anyString(), anyInt(), any(), anyString()))
                .thenThrow(new YoutubeQuotaExceededException("quota exceeded"));

        YoutubeSearchResponse res = youtubeService.search("lo-fi", 5);

        assertThat(res.getSource()).isEqualTo("MOCK");
        assertThat(res.getVideos()).isNotEmpty();
    }

    @Test
    void search_liveSuccess_returnsLiveCappedToLimit() {
        liveMode();
        when(youtubeClient.searchPaged(anyString(), anyString(), anyString(), anyString(), anyInt(), any(), anyString()))
                .thenReturn(new YoutubeClient.YoutubePage(List.of(
                        liveVideo("live0000001", "Queen Live"),
                        liveVideo("live0000002", "Queen Cover")), null));

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
        // Issue #153 canonical embed: www host (NOT nocookie) + enablejsapi for
        // IFrame origin checks; clients append &origin= themselves.
        assertThat(res.getEmbedUrl())
                .isEqualTo("https://www.youtube.com/embed/" + KNOWN_ID + "?enablejsapi=1&rel=0");
        assertThat(res.getVideo().getVideoId()).isEqualTo(KNOWN_ID);
        assertThat(res.getVideo().getSource()).isEqualTo("MOCK");
        verifyNoInteractions(youtubeClient);
    }

    @Test
    void resolve_lookupIsCaseSensitiveExactMatch() {
        mockMode();

        // Exact mixed-case id resolves (YouTube ids are case-sensitive).
        YoutubeResolveResponse res = youtubeService.resolve(KNOWN_ID);
        assertThat(res.getVideo().getVideoId()).isEqualTo(KNOWN_ID);

        // Same letters, wrong case must 404 — lower/upper variants are
        // distinct ids and must not hit the lowercased cache key.
        assertThatThrownBy(() -> youtubeService.resolve(KNOWN_ID.toLowerCase()))
                .isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> youtubeService.resolve(KNOWN_ID.toUpperCase()))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void resolve_lookupTrimsWhitespaceButPreservesCase() {
        mockMode();

        YoutubeResolveResponse res = youtubeService.resolve("  " + KNOWN_ID + "  ");

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

    // --- issue #153: playback-safety filtering --------------------------------

    private YoutubeVideoResponse flaggedVideo(String id, Boolean embeddable,
                                              String privacyStatus,
                                              java.util.List<String> allowed,
                                              java.util.List<String> blocked,
                                              Boolean ageRestricted) {
        return YoutubeVideoResponse.builder()
                .videoId(id)
                .title("Flagged " + id)
                .channelId("UClive")
                .channelTitle("Live Channel")
                .thumbnailUrl("https://i.ytimg.com/vi/" + id + "/hqdefault.jpg")
                .duration("PT4M13S")
                .viewCount(1_000L)
                .embeddable(embeddable)
                .privacyStatus(privacyStatus)
                .allowedRegions(allowed)
                .blockedRegions(blocked)
                .ageRestricted(ageRestricted)
                .source("LIVE")
                .build();
    }

    @Test
    void canonicalEmbedUrl_usesWwwHostWithEnablejsapiAndRel() {
        String url = YoutubeService.canonicalEmbedUrl(KNOWN_ID);

        assertThat(url).isEqualTo("https://www.youtube.com/embed/" + KNOWN_ID + "?enablejsapi=1&rel=0");
        assertThat(url).contains("enablejsapi=1");
        assertThat(url).contains("rel=0");
        assertThat(url).startsWith("https://www.youtube.com/embed/");
        assertThat(url).doesNotContain("nocookie");
    }

    @Test
    void filterPlayable_dropsPrivateUnembeddableAndRegionBlocked() {
        YoutubeVideoResponse playable = flaggedVideo("playable001", true, "public", null, null, false);
        YoutubeVideoResponse privateVideo = flaggedVideo("private0001", true, "private", null, null, false);
        YoutubeVideoResponse privateCase = flaggedVideo("private0002", true, " Private ", null, null, false);
        YoutubeVideoResponse unembeddable = flaggedVideo("unembedd001", false, "public", null, null, false);
        YoutubeVideoResponse blocked = flaggedVideo("BLOCKED0001", true, "public", null,
                java.util.List.of("US"), false);
        YoutubeVideoResponse notAllowed = flaggedVideo("notallowed1", true, "public",
                java.util.List.of("IN", "GB"), null, false);
        // Fail-open: sparse rows with unknown flags are kept.
        YoutubeVideoResponse sparse = liveVideo("live0000001", "Sparse");
        // Age-restricted rows are kept but flagged — clients decide.
        YoutubeVideoResponse ageRestricted = flaggedVideo("AGEREST0001", true, "public", null, null, true);

        java.util.List<YoutubeVideoResponse> out = YoutubeService.filterPlayable(
                java.util.Arrays.asList(playable, privateVideo, privateCase, unembeddable,
                        blocked, notAllowed, sparse, ageRestricted, null),
                "US");

        assertThat(out).extracting(YoutubeVideoResponse::getVideoId)
                .containsExactly("playable001", "live0000001", "AGEREST0001");
    }

    @Test
    void filterPlayable_regionMatchingIsCaseInsensitiveAndAllowlistHitKeeps() {
        YoutubeVideoResponse blockedLower = flaggedVideo("BLOCKED0002", true, "public", null,
                java.util.List.of("us"), false);
        YoutubeVideoResponse allowedHit = flaggedVideo("ALLOWED0001", true, "public",
                java.util.List.of("us", "IN"), null, false);
        YoutubeVideoResponse unlisted = flaggedVideo("UNLISTED001", true, "unlisted", null, null, false);

        java.util.List<YoutubeVideoResponse> out = YoutubeService.filterPlayable(
                java.util.List.of(blockedLower, allowedHit, unlisted), "us");

        // blocked (any case) is dropped; allowlist hit + unlisted are kept.
        assertThat(out).extracting(YoutubeVideoResponse::getVideoId)
                .containsExactly("ALLOWED0001", "UNLISTED001");
    }

    @Test
    void isBlockedInRegion_nullOrBlankRegionNeverBlocks() {
        YoutubeVideoResponse blocked = flaggedVideo("BLOCKED0003", true, "public", null,
                java.util.List.of("US"), false);

        assertThat(YoutubeService.isBlockedInRegion(blocked, null)).isFalse();
        assertThat(YoutubeService.isBlockedInRegion(blocked, "   ")).isFalse();
        assertThat(YoutubeService.isBlockedInRegion(liveVideo("live0000001", "Sparse"), "US")).isFalse();
    }

    @Test
    void isEmbeddable_nullCountsAsPlayableFailOpen() {
        assertThat(YoutubeService.isEmbeddable(liveVideo("live0000001", "Sparse"))).isTrue();
        assertThat(YoutubeService.isEmbeddable(flaggedVideo("e1", true, "public", null, null, null))).isTrue();
        assertThat(YoutubeService.isEmbeddable(flaggedVideo("e2", false, "public", null, null, null))).isFalse();
    }

    @Test
    void trending_allLiveFiltered_fallsBackToMock() {
        liveMode();
        when(youtubeClient.fetchTrendingPaged(anyString(), anyInt(), any(), anyString()))
                .thenReturn(new YoutubeClient.YoutubePage(java.util.List.of(
                        flaggedVideo("private0001", true, "private", null, null, false),
                        flaggedVideo("unembedd001", false, "public", null, null, false)), null));

        YoutubeTrendingResponse res = youtubeService.getTrending("US", 5);

        assertThat(res.getSource()).isEqualTo("MOCK");
        assertThat(res.getVideos()).isNotEmpty();
    }

    @Test
    void trending_partiallyFiltered_returnsOnlyPlayableLive() {
        liveMode();
        when(youtubeClient.fetchTrendingPaged(anyString(), anyInt(), any(), anyString()))
                .thenReturn(new YoutubeClient.YoutubePage(java.util.List.of(
                        flaggedVideo("playable001", true, "public", null, null, false),
                        flaggedVideo("private0001", true, "private", null, null, false),
                        flaggedVideo("unembedd001", false, "public", null, null, false)), null));

        YoutubeTrendingResponse res = youtubeService.getTrending("US", 5);

        assertThat(res.getSource()).isEqualTo("LIVE");
        assertThat(res.getVideos()).extracting(YoutubeVideoResponse::getVideoId)
                .containsExactly("playable001");
    }

    @Test
    void search_allLiveFiltered_fallsBackToMock() {
        liveMode();
        when(youtubeClient.searchPaged(anyString(), anyString(), anyString(), anyString(), anyInt(), any(), anyString()))
                .thenReturn(new YoutubeClient.YoutubePage(java.util.List.of(
                        flaggedVideo("BLOCKED0001", true, "public", null, java.util.List.of("US"), false)), null));

        YoutubeSearchResponse res = youtubeService.search("queen", 5);

        assertThat(res.getSource()).isEqualTo("MOCK");
    }

    @Test
    void resolve_livePrivateVideo_surfaces404() {
        liveMode();
        when(youtubeClient.resolve(KNOWN_ID, "test-key")).thenReturn(Optional.of(
                flaggedVideo(KNOWN_ID, true, "private", null, null, false)));

        assertThatThrownBy(() -> youtubeService.resolve(KNOWN_ID))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void resolve_liveUnembeddable_returnsLiveFlaggedWithCanonicalEmbed() {
        liveMode();
        String id = "unembedd001";
        when(youtubeClient.resolve(id, "test-key")).thenReturn(Optional.of(
                flaggedVideo(id, false, "public", null, null, false)));

        YoutubeResolveResponse res = youtubeService.resolve(id);

        // Flagged, NOT 404: clients prefer watchUrl / show a notice.
        assertThat(res.getSource()).isEqualTo("LIVE");
        assertThat(res.getVideo().getEmbeddable()).isFalse();
        assertThat(res.getEmbedUrl()).isEqualTo(YoutubeService.canonicalEmbedUrl(id));
        assertThat(res.getWatchUrl()).isEqualTo("https://www.youtube.com/watch?v=" + id);
    }

    @Test
    void resolve_liveRegionBlocked_returnsLiveFlaggedNot404() {
        liveMode();
        String id = "BLOCKED0001";
        when(youtubeClient.resolve(id, "test-key")).thenReturn(Optional.of(
                flaggedVideo(id, true, "public", null, java.util.List.of("US"), false)));

        YoutubeResolveResponse res = youtubeService.resolve(id);

        assertThat(res.getSource()).isEqualTo("LIVE");
        assertThat(res.getEmbedUrl()).contains("enablejsapi=1");
    }

    @Test
    void resolve_liveAgeRestricted_returnsLiveFlaggedNot404() {
        liveMode();
        String id = "AGEREST0001";
        when(youtubeClient.resolve(id, "test-key")).thenReturn(Optional.of(
                flaggedVideo(id, true, "public", null, null, true)));

        YoutubeResolveResponse res = youtubeService.resolve(id);

        assertThat(res.getSource()).isEqualTo("LIVE");
        assertThat(res.getVideo().getAgeRestricted()).isTrue();
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

    // --- TestAgent: IN/ta echo + unified cache key ---------------------------

    @Test
    void search_fullLocale_echoesResolvedRegionLangHl() {
        mockMode();

        YoutubeSearchResponse res = youtubeService.search("lo-fi", "IN", "ta", "ta", 10);

        assertThat(res.getQuery()).isEqualTo("lo-fi");
        assertThat(res.getRegionCode()).isEqualTo("IN");
        assertThat(res.getRelevanceLanguage()).isEqualTo("ta");
        assertThat(res.getHl()).isEqualTo("ta");
        assertThat(res.getMaxResults()).isEqualTo(10);
    }

    @Test
    void search_regionLangOverload_defaultsHlToRelevanceLanguage() {
        mockMode();

        YoutubeSearchResponse res = youtubeService.search("lo-fi", "IN", "ta", 10);

        assertThat(res.getRegionCode()).isEqualTo("IN");
        assertThat(res.getRelevanceLanguage()).isEqualTo("ta");
        assertThat(res.getHl()).isEqualTo("ta");
    }

    @Test
    void search_caseAndWhitespaceNormalizedInEcho() {
        mockMode();

        YoutubeSearchResponse res = youtubeService.search("  lo-fi  ", "in", "TA", "TA", 10);

        assertThat(res.getQuery()).isEqualTo("lo-fi");
        assertThat(res.getRegionCode()).isEqualTo("IN");
        assertThat(res.getRelevanceLanguage()).isEqualTo("ta");
        assertThat(res.getHl()).isEqualTo("ta");
    }

    @Test
    void trending_echoesNormalizedRegion() {
        mockMode();

        YoutubeTrendingResponse res = youtubeService.getTrending("in", 5);

        assertThat(res.getRegionCode()).isEqualTo("IN");
        assertThat(res.getMaxResults()).isEqualTo(5);
    }

    @Test
    void searchCache_unifiedKeyIncludesHl() throws Exception {
        // Single canonical cache entry: only the full
        // (query, region, lang, hl, limit, pageToken) overload is @Cacheable, so every
        // locale combination shares one key shape query:region:lang:hl:limit:token.
        long cacheableSearchOverloads = java.util.Arrays.stream(YoutubeService.class.getMethods())
                .filter(m -> m.getName().equals("search") && m.isAnnotationPresent(
                        org.springframework.cache.annotation.Cacheable.class))
                .count();
        assertThat(cacheableSearchOverloads).isEqualTo(1);
        java.lang.reflect.Method cached = java.util.Arrays.stream(YoutubeService.class.getMethods())
                .filter(m -> m.getName().equals("search") && m.isAnnotationPresent(
                        org.springframework.cache.annotation.Cacheable.class))
                .findFirst().orElseThrow();
        assertThat(cached.getParameterTypes()).hasSize(6);
        String key = cached.getAnnotation(
                org.springframework.cache.annotation.Cacheable.class).key();
        assertThat(key).contains("#hl");
        assertThat(key).contains("#query");
        assertThat(key).contains("#regionCode");
        assertThat(key).contains("#relevanceLanguage");
        assertThat(key).contains("#pageToken");
        String unless = cached.getAnnotation(
                org.springframework.cache.annotation.Cacheable.class).unless();
        assertThat(unless).contains("count == 0");
    }

    // --- TestAgent: Bs/Bh budget + timeout->MOCK fast -------------------------

    @Test
    void search_timeoutUpstream_fallsBackToMockFast() {
        liveMode();
        when(youtubeClient.searchPaged(anyString(), anyString(), anyString(), anyString(), anyInt(), any(), anyString()))
                .thenThrow(new com.spotibase.exception.YoutubeUpstreamException(
                        "YouTube search timed out after 3s"));

        long start = System.nanoTime();
        YoutubeSearchResponse res = youtubeService.search("queen", 5);
        long elapsedMs = (System.nanoTime() - start) / 1_000_000L;

        assertThat(res.getSource()).isEqualTo("MOCK");
        assertThat(res.getVideos()).isNotEmpty();
        // Fail-open must not block on the upstream budget: mock fallback is immediate.
        assertThat(elapsedMs).isLessThan(2000L);
    }

    @Test
    void trending_timeoutUpstream_fallsBackToMockFast() {
        liveMode();
        when(youtubeClient.fetchTrendingPaged(anyString(), anyInt(), any(), anyString()))
                .thenThrow(new com.spotibase.exception.YoutubeUpstreamException(
                        "YouTube trending timed out after 5s"));

        long start = System.nanoTime();
        YoutubeTrendingResponse res = youtubeService.getTrending("US", 5);
        long elapsedMs = (System.nanoTime() - start) / 1_000_000L;

        assertThat(res.getSource()).isEqualTo("MOCK");
        assertThat(res.getVideos()).isNotEmpty();
        assertThat(elapsedMs).isLessThan(2000L);
    }

    @Test
    void trendingCache_unlessEmptyPreventsCaching() throws Exception {
        long cacheableTrending = java.util.Arrays.stream(YoutubeService.class.getMethods())
                .filter(m -> m.getName().equals("getTrending") && m.isAnnotationPresent(
                        org.springframework.cache.annotation.Cacheable.class))
                .count();
        assertThat(cacheableTrending).isEqualTo(1);
        java.lang.reflect.Method cached = java.util.Arrays.stream(YoutubeService.class.getMethods())
                .filter(m -> m.getName().equals("getTrending") && m.isAnnotationPresent(
                        org.springframework.cache.annotation.Cacheable.class))
                .findFirst().orElseThrow();
        String unless = cached.getAnnotation(
                org.springframework.cache.annotation.Cacheable.class).unless();
        assertThat(unless).contains("count == 0");
    }
}
