package com.spotibase.service;

import com.spotibase.config.YoutubeConfig;
import com.spotibase.dto.response.YoutubeResolveResponse;
import com.spotibase.dto.response.YoutubeSearchResponse;
import com.spotibase.dto.response.YoutubeTrendingResponse;
import com.spotibase.dto.response.YoutubeVideoResponse;
import com.spotibase.exception.ResourceNotFoundException;
import com.spotibase.exception.YoutubeQuotaExceededException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;

/**
 * YouTube proxy business logic.
 *
 * <ul>
 *   <li>Live YouTube Data API v3 via {@link YoutubeClient} when
 *       {@code YOUTUBE_API_KEY} is configured ({@code youtube.api-key}).</li>
 *   <li>Built-in 15-entry mock catalogue otherwise — deterministic, offline,
 *       and also the fail-open fallback.</li>
 *   <li>Redis caching: trending/search 5 min ({@code youtube-trending},
 *       {@code youtube-search}), resolve 30 min ({@code youtube-resolve}).
 *       TTLs live in {@code RedisCacheConfig}; Redis outages fall back to
 *       source via {@code CacheResilienceConfig}.</li>
 *   <li>Quota (HTTP 429 / quotaExceeded) and any upstream failure fail open
 *       to mock data instead of 500ing.</li>
 * </ul>
 *
 * <p>Security: the API key is passed straight from {@link YoutubeConfig} to
 * the client and is never logged (only presence/absence and short failure
 * reasons appear in logs).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class YoutubeService {

    private static final String SOURCE_MOCK = "MOCK";
    private static final String SOURCE_LIVE = "LIVE";

    private static final int DEFAULT_MAX = 15;
    private static final int MAX_LIMIT = 50;

    private final YoutubeClient youtubeClient;
    private final YoutubeConfig youtubeConfig;

    /** Trending feed: live mostPopular (music) or mock, cached 5 min. */
    @Cacheable(value = "youtube-trending",
            key = "((#regionCode == null ? '' : #regionCode.trim().toUpperCase()) + ':' + #maxResults)")
    public YoutubeTrendingResponse getTrending(String regionCode, int maxResults) {
        String region = (regionCode == null || regionCode.isBlank())
                ? youtubeConfig.getRegionCode()
                : regionCode.trim().toUpperCase(Locale.ROOT);
        int limit = clamp(maxResults);
        if (youtubeConfig.isLiveEnabled()) {
            try {
                List<YoutubeVideoResponse> videos =
                        youtubeClient.fetchTrending(region, limit, youtubeConfig.getApiKey());
                if (videos != null && !videos.isEmpty()) {
                    List<YoutubeVideoResponse> capped = cap(videos, limit);
                    log.info("YouTube trending live: region={} count={}", region, capped.size());
                    return YoutubeTrendingResponse.builder()
                            .regionCode(region)
                            .maxResults(limit)
                            .count(capped.size())
                            .source(SOURCE_LIVE)
                            .videos(capped)
                            .build();
                }
                log.warn("YouTube trending live returned no items, serving mock: region={}", region);
            } catch (YoutubeQuotaExceededException ex) {
                log.warn("YouTube trending quota exceeded, serving mock: region={}", region);
            } catch (Exception ex) {
                log.warn("YouTube trending live failed ({}), serving mock: region={}",
                        ex.getClass().getSimpleName(), region);
            }
        }
        List<YoutubeVideoResponse> mock = cap(MOCK_CATALOGUE, limit);
        return YoutubeTrendingResponse.builder()
                .regionCode(region)
                .maxResults(limit)
                .count(mock.size())
                .source(SOURCE_MOCK)
                .videos(mock)
                .build();
    }

    /** Keyword search: live search.list or filtered mock, cached 5 min. */
    @Cacheable(value = "youtube-search",
            key = "((#query == null ? '' : #query.trim().toLowerCase()) + ':' + #maxResults)")
    public YoutubeSearchResponse search(String query, int maxResults) {
        int limit = clamp(maxResults);
        String q = query == null ? "" : query.trim();
        if (youtubeConfig.isLiveEnabled()) {
            try {
                List<YoutubeVideoResponse> videos =
                        youtubeClient.search(q, limit, youtubeConfig.getApiKey());
                if (videos != null && !videos.isEmpty()) {
                    List<YoutubeVideoResponse> capped = cap(videos, limit);
                    log.info("YouTube search live: count={}", capped.size());
                    return YoutubeSearchResponse.builder()
                            .query(q)
                            .maxResults(limit)
                            .count(capped.size())
                            .source(SOURCE_LIVE)
                            .videos(capped)
                            .build();
                }
                log.warn("YouTube search live returned no items, serving mock");
            } catch (YoutubeQuotaExceededException ex) {
                log.warn("YouTube search quota exceeded, serving mock");
            } catch (Exception ex) {
                log.warn("YouTube search live failed ({}), serving mock",
                        ex.getClass().getSimpleName());
            }
        }
        List<YoutubeVideoResponse> mock = cap(filterMock(q), limit);
        return YoutubeSearchResponse.builder()
                .query(q)
                .maxResults(limit)
                .count(mock.size())
                .source(SOURCE_MOCK)
                .videos(mock)
                .build();
    }

    /** Single-video resolve: live videos.list or mock, cached 30 min. */
    @Cacheable(value = "youtube-resolve",
            key = "(#videoId == null ? '' : #videoId.trim().toLowerCase())")
    public YoutubeResolveResponse resolve(String videoId) {
        String id = videoId == null ? "" : videoId.trim();
        if (youtubeConfig.isLiveEnabled()) {
            try {
                Optional<YoutubeVideoResponse> live =
                        youtubeClient.resolve(id, youtubeConfig.getApiKey());
                if (live.isPresent()) {
                    YoutubeVideoResponse video = live.get();
                    log.info("YouTube resolve live: videoId={}", id);
                    return toResolveResponse(video, SOURCE_LIVE);
                }
                // Live says "no such video": still check the mock catalogue so
                // offline-known ids resolve, otherwise surface a 404.
                Optional<YoutubeVideoResponse> mock = findMock(id);
                if (mock.isPresent()) {
                    return toResolveResponse(withSource(mock.get(), SOURCE_MOCK), SOURCE_MOCK);
                }
                throw new ResourceNotFoundException("YouTube video", id);
            } catch (ResourceNotFoundException ex) {
                throw ex;
            } catch (YoutubeQuotaExceededException ex) {
                log.warn("YouTube resolve quota exceeded, serving mock: videoId={}", id);
            } catch (Exception ex) {
                log.warn("YouTube resolve live failed ({}), serving mock: videoId={}",
                        ex.getClass().getSimpleName(), id);
            }
        }
        YoutubeVideoResponse mock = findMock(id)
                .orElseThrow(() -> new ResourceNotFoundException("YouTube video", id));
        return toResolveResponse(withSource(mock, SOURCE_MOCK), SOURCE_MOCK);
    }

    private YoutubeResolveResponse toResolveResponse(YoutubeVideoResponse video, String source) {
        YoutubeVideoResponse stamped = withSource(video, source);
        return YoutubeResolveResponse.builder()
                .source(source)
                .watchUrl("https://www.youtube.com/watch?v=" + stamped.getVideoId())
                // Privacy-enhanced embed host; clients must allowlist this
                // host (plus www.youtube.com) before rendering iframes.
                .embedUrl("https://www.youtube-nocookie.com/embed/" + stamped.getVideoId())
                .video(stamped)
                .build();
    }

    private YoutubeVideoResponse withSource(YoutubeVideoResponse video, String source) {
        if (source.equals(video.getSource())) {
            return video;
        }
        return YoutubeVideoResponse.builder()
                .videoId(video.getVideoId())
                .title(video.getTitle())
                .channelId(video.getChannelId())
                .channelTitle(video.getChannelTitle())
                .description(video.getDescription())
                .thumbnailUrl(video.getThumbnailUrl())
                .publishedAt(video.getPublishedAt())
                .duration(video.getDuration())
                .viewCount(video.getViewCount())
                .source(source)
                .build();
    }

    static int clamp(int maxResults) {
        if (maxResults <= 0) {
            return DEFAULT_MAX;
        }
        return Math.min(maxResults, MAX_LIMIT);
    }

    private List<YoutubeVideoResponse> cap(List<YoutubeVideoResponse> videos, int limit) {
        if (videos.size() <= limit) {
            return new ArrayList<>(videos);
        }
        return new ArrayList<>(videos.subList(0, limit));
    }

    private List<YoutubeVideoResponse> filterMock(String query) {
        if (query.isBlank()) {
            return new ArrayList<>(MOCK_CATALOGUE);
        }
        String q = query.toLowerCase(Locale.ROOT);
        List<YoutubeVideoResponse> matched = new ArrayList<>();
        for (YoutubeVideoResponse video : MOCK_CATALOGUE) {
            String title = video.getTitle() == null ? "" : video.getTitle().toLowerCase(Locale.ROOT);
            String channel = video.getChannelTitle() == null ? "" : video.getChannelTitle().toLowerCase(Locale.ROOT);
            if (title.contains(q) || channel.contains(q)) {
                matched.add(video);
            }
        }
        return matched.isEmpty() ? new ArrayList<>(MOCK_CATALOGUE) : matched;
    }

    private Optional<YoutubeVideoResponse> findMock(String videoId) {
        return MOCK_CATALOGUE.stream()
                .filter(v -> v.getVideoId().equalsIgnoreCase(videoId))
                .findFirst();
    }

    /**
     * Deterministic 15-entry offline catalogue (11-char video ids). Used when
     * no API key is configured and as the quota/network fail-open fallback.
     */
    private static final List<YoutubeVideoResponse> MOCK_CATALOGUE = List.of(
            mock("dQw4w9WgXcQ", "Lo-Fi Beats to Focus — 3 Hour Mix", "UCmockLoFi01", "Chill Lab",
                    "A long lo-fi hip hop mix for studying and relaxing.", "PT3H2M", 48_200_000L),
            mock("9bZkp7q19f0", "Top Pop Hits 2024 — Party Playlist", "UCmockPopHits", "Pop Central",
                    "The biggest pop anthems in one non-stop playlist.", "PT1H18M", 31_700_000L),
            mock("RgKAFK5djSk", "Acoustic Morning — Indie Folk Essentials", "UCmockFolk22", "Folk & Pine",
                    "Warm acoustic guitars and soft harmonies for slow mornings.", "PT58M", 8_400_000L),
            mock("eY52Zsg-KVI", "Deep House Summer Mix 2024", "UCmockHouse3", "Sunset Grooves",
                    "Feel-good deep house from Ibiza to Miami.", "PT1H5M", 12_900_000L),
            mock("hTWKbfoikeg", "Classical Focus — Mozart & Bach for Work", "UCmockClassic", "Hall of Classics",
                    "Timeless orchestral pieces to concentrate and unwind.", "PT2H11M", 6_100_000L),
            mock("2g811Eo7K8E", "Workout Energy — 140 BPM Pump Mix", "UCmockGymFuel", "Gym Fuel",
                    "High-BPM EDM and hip-hop to power your training.", "PT47M", 15_300_000L),
            mock("60ItHLz5WEA", "Alan Walker Style — EDM Anthems Hour", "UCmockEDMWave", "EDM Wave",
                    "Melodic festival EDM in the style of Alan Walker.", "PT1H1M", 27_800_000L),
            mock("JGwWNGJdvx8", "Ed Sheeran Style — Acoustic Love Songs", "UCmockAcoustic", "Shape of Acoustic",
                    "Heartfelt acoustic ballads for quiet evenings.", "PT52M", 19_600_000L),
            mock("kJQP7kiw5Fk", "Latin Fiesta — Reggaeton & Pop Mix", "UCmockLatina9", "Fiesta Latina",
                    "Reggaeton, latin pop and dancehall to move your feet.", "PT1H9M", 44_100_000L),
            mock("fJ9rUzIMcZQ", "Queen Style — Classic Rock Legends", "UCmockRockLeg", "Rock Legends",
                    "Stadium rock anthems from Queen to the Stones.", "PT1H22M", 22_500_000L),
            mock("CevxZvSJLk8", "K-Pop Party — Dance Hits Non-Stop", "UCmockKpopNow", "K-Pop Now",
                    "The catchiest K-pop choruses back to back.", "PT55M", 18_200_000L),
            mock("OPf0YbXqDm0", "Jazz & Coffee — Smooth Morning Blend", "UCmockBlueNote", "Blue Note Cafe",
                    "Mellow jazz, bossa and soul for your first coffee.", "PT1H3M", 5_700_000L),
            mock("pRpeEdMmmQ0", "Shakira Style — Global Pop Workout", "UCmockGlobalPop", "Global Pop",
                    "Global pop smashes with Latin and Afrobeat grooves.", "PT49M", 16_900_000L),
            mock("09m0B8NeEMQ", "90s Throwback — Melody Essentials", "UCmockNineties", "Nineties Melodies",
                    "Unforgettable 90s melodies and soft-rock classics.", "PT1H14M", 9_800_000L),
            mock("3JZ_D3ELwOQ", "Night Drive — Synthwave & Chill Mix", "UCmockNeonDri", "Neon Drive",
                    "Retro synthwave for late-night city drives.", "PT1H7M", 7_300_000L));
    private static YoutubeVideoResponse mock(
            String videoId, String title, String channelId, String channelTitle,
            String description, String duration, long viewCount) {
        return YoutubeVideoResponse.builder()
                .videoId(videoId)
                .title(title)
                .channelId(channelId)
                .channelTitle(channelTitle)
                .description(description)
                .thumbnailUrl("https://i.ytimg.com/vi/" + videoId + "/hqdefault.jpg")
                .publishedAt(null)
                .duration(duration)
                .viewCount(viewCount)
                .source(SOURCE_MOCK)
                .build();
    }
}
