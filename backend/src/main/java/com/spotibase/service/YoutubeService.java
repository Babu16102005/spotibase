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
 *   <li>Built-in 19-entry mock catalogue otherwise — deterministic, offline,
 *       and also the fail-open fallback (includes 4 Tamil/Kollywood entries
 *       for India-first {@code IN}/{@code ta} defaults).</li>
 *   <li>Redis caching: trending/search 5 min ({@code youtube-trending},
 *       {@code youtube-search}), resolve 30 min ({@code youtube-resolve}).
 *       TTLs live in {@code RedisCacheConfig}; Redis outages fall back to
 *       source via {@code CacheResilienceConfig}.</li>
 *   <li>Quota (HTTP 429 / quotaExceeded) and any upstream failure fail open
 *       to mock data instead of 500ing — except genuine
 *       resource-not-found (unknown/private video id), which surfaces 404.</li>
 *   <li>Issue #153 playback safety: live rows carry
 *       {@code embeddable}/{@code privacyStatus}/{@code allowedRegions}/
 *       {@code blockedRegions}/{@code ageRestricted} from
 *       {@code status}/{@code contentDetails}. Trending/search lists filter
 *       out unembeddable, private, or region-blocked entries; resolve flags
 *       them (private still 404s) so clients can fall back to
 *       {@code watchUrl}.</li>
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
    public YoutubeTrendingResponse getTrending(String regionCode, int maxResults) {
        return doGetTrending(regionCode, maxResults, null);
    }

    /**
     * Paged trending feed, cached 5 min per {@code region:limit:pageToken}.
     * Blank/null {@code pageToken} is the first page (backward-compat for old
     * clients); mock tokens are stringified catalogue offsets, live tokens are
     * forwarded verbatim to {@code videos.list mostPopular} and the upstream
     * {@code nextPageToken} is echoed for unlimited scroll.
     */
    @Cacheable(value = "youtube-trending",
            key = "((#regionCode == null ? '' : #regionCode.trim().toUpperCase()) + ':' + T(com.spotibase.service.YoutubeService).clamp(#maxResults) + ':' + (#pageToken == null ? '' : #pageToken.trim()))",
            unless = "#result == null || #result.count == 0")
    public YoutubeTrendingResponse getTrending(String regionCode, int maxResults, String pageToken) {
        return doGetTrending(regionCode, maxResults, pageToken);
    }

    private YoutubeTrendingResponse doGetTrending(String regionCode, int maxResults, String pageToken) {
        String region = (regionCode == null || regionCode.isBlank())
                ? youtubeConfig.getRegionCode()
                : regionCode.trim().toUpperCase(Locale.ROOT);
        int limit = clamp(maxResults);
        String token = normalizePageToken(pageToken);
        if (youtubeConfig.isLiveEnabled()) {
            try {
                YoutubeClient.YoutubePage page =
                        youtubeClient.fetchTrendingPaged(region, limit, token, youtubeConfig.getApiKey());
                List<YoutubeVideoResponse> videos = page == null || page.videos() == null
                        ? List.of() : page.videos();
                String nextToken = page == null ? null : page.nextPageToken();
                if (videos != null && !videos.isEmpty()) {
                    List<YoutubeVideoResponse> playable = filterPlayable(videos, region);
                    if (playable.isEmpty()) {
                        log.warn("YouTube trending live all {} items filtered (unembeddable/private/region-blocked),"
                                + " serving mock: region={}", videos.size(), region);
                    } else {
                        if (playable.size() < videos.size()) {
                            log.info("YouTube trending filtered {}/{} unplayable: region={}",
                                    videos.size() - playable.size(), videos.size(), region);
                        }
                        List<YoutubeVideoResponse> capped = cap(playable, limit);
                        log.info("YouTube trending live: region={} count={}", region, capped.size());
                        return YoutubeTrendingResponse.builder()
                                .regionCode(region)
                                .maxResults(limit)
                                .count(capped.size())
                                .source(SOURCE_LIVE)
                                .nextPageToken(nextToken)
                                .videos(capped)
                                .build();
                    }
                } else {
                    log.warn("YouTube trending live returned no items, serving mock: region={}", region);
                }
            } catch (YoutubeQuotaExceededException ex) {
                log.warn("YouTube trending quota exceeded ({}), serving mock: region={}",
                        safeMessage(ex), region);
            } catch (ResourceNotFoundException ex) {
                log.warn("YouTube trending not-found ({}), serving mock: region={}",
                        safeMessage(ex), region);
            } catch (Exception ex) {
                logLiveFailure("trending", ex,
                        "region=" + region + " timeout=" + effectiveTimeoutSeconds() + "s");
            }
        }
        List<YoutubeVideoResponse> full = new ArrayList<>(MOCK_CATALOGUE);
        int offset = parseMockOffset(token, full.size());
        List<YoutubeVideoResponse> mock = slice(full, offset, limit);
        return YoutubeTrendingResponse.builder()
                .regionCode(region)
                .maxResults(limit)
                .count(mock.size())
                .source(SOURCE_MOCK)
                .nextPageToken(mockNextToken(offset, mock.size(), full.size()))
                .videos(mock)
                .build();
    }

    /**
     * Keyword search: live search.list or filtered mock.
     *
     * <p>Uncached backward-compat delegate: region/language/hl fall back to the
     * configured India+Tamil defaults ({@code IN}/{@code ta}), first page.
     * Caching lives on the full locale+page overload below, whose key always
     * includes {@code hl} and {@code pageToken}, so all callers share one key
     * shape ({@code query:region:lang:hl:limit:token}).
     */
    public YoutubeSearchResponse search(String query, int maxResults) {
        return doSearch(query, defaultRegion(), defaultLanguage(), defaultLanguage(), maxResults, null);
    }

    /**
     * Region+language-aware search. Uncached delegate — {@code hl} defaults to
     * {@code relevanceLanguage} and caching happens on the full overload, whose
     * key always includes {@code hl} and {@code pageToken}. Sends
     * {@code regionCode}, {@code relevanceLanguage} and {@code hl} upstream so
     * India/Tamil content ranks. First page.
     */
    public YoutubeSearchResponse search(String query, String regionCode, String relevanceLanguage, int maxResults) {
        String hl = relevanceLanguage == null || relevanceLanguage.isBlank()
                ? defaultLanguage() : relevanceLanguage.trim();
        return doSearch(query, regionCode, relevanceLanguage, hl, maxResults, null);
    }

    /**
     * Full locale-aware search, first page. Uncached delegate to the paged
     * cached overload (via {@code doSearch}) so the single canonical key
     * {@code query:region:lang:hl:limit:token} always carries the token
     * (empty for page 1). This keeps the {@code (query, region, lang, hl,
     * limit)} call shape working for old callers.
     */
    public YoutubeSearchResponse search(
            String query, String regionCode, String relevanceLanguage, String hl, int maxResults) {
        return doSearch(query, regionCode, relevanceLanguage, hl, maxResults, null);
    }

    /**
     * Full locale-aware paged search, cached 5 min under the single canonical
     * key {@code query:region:lang:hl:limit:token}. This is the only cached
     * search entry point — the simpler overloads delegate via
     * {@code doSearch} without their own cache entries so {@code hl} and
     * {@code pageToken} are always part of the key. Blank/null
     * {@code pageToken} is the first page. Backward-compat convenience keeps
     * the {@code (query, limit, region, lang)} argument order working (first
     * page).
     */
    @Cacheable(value = "youtube-search",
            key = "((#query == null ? '' : #query.trim().toLowerCase()) + ':'"
                    + " + (#regionCode == null ? '' : #regionCode.trim().toUpperCase()) + ':'"
                    + " + (#relevanceLanguage == null ? '' : #relevanceLanguage.trim().toLowerCase()) + ':'"
                    + " + (#hl == null ? '' : #hl.trim().toLowerCase()) + ':'"
                    + " + T(com.spotibase.service.YoutubeService).clamp(#maxResults) + ':'"
                    + " + (#pageToken == null ? '' : #pageToken.trim()))",
            unless = "#result == null || #result.count == 0")
    public YoutubeSearchResponse search(
            String query, String regionCode, String relevanceLanguage, String hl,
            int maxResults, String pageToken) {
        return doSearch(query, regionCode, relevanceLanguage, hl, maxResults, pageToken);
    }

    /**
     * Backward-compat convenience with the legacy
     * {@code (query, limit, region, lang)} order; uncached delegate to the
     * canonical locale-aware search (first page). {@code hl} defaults to
     * {@code relevanceLanguage}.
     */
    public YoutubeSearchResponse search(
            String query, int maxResults, String regionCode, String relevanceLanguage) {
        String hl = relevanceLanguage == null || relevanceLanguage.isBlank()
                ? defaultLanguage() : relevanceLanguage.trim();
        return doSearch(query, regionCode, relevanceLanguage, hl, maxResults, null);
    }

    private YoutubeSearchResponse doSearch(
            String query, String regionCode, String relevanceLanguage, String hl,
            int maxResults, String pageToken) {
        int limit = clamp(maxResults);
        String q = query == null ? "" : query.trim();
        String region = regionCode == null || regionCode.isBlank()
                ? defaultRegion() : regionCode.trim().toUpperCase(Locale.ROOT);
        String lang = relevanceLanguage == null || relevanceLanguage.isBlank()
                ? defaultLanguage() : relevanceLanguage.trim().toLowerCase(Locale.ROOT);
        String interfaceLang = hl == null || hl.isBlank()
                ? lang : hl.trim().toLowerCase(Locale.ROOT);
        String token = normalizePageToken(pageToken);
        if (youtubeConfig.isLiveEnabled()) {
            try {
                // YoutubeClient applies videoEmbeddable=true, safeSearch=moderate,
                // regionCode + relevanceLanguage + hl upstream, then hydrates
                // status/contentDetails. pageToken is forwarded for scrolling.
                YoutubeClient.YoutubePage page = youtubeClient.searchPaged(
                        q, region, lang, interfaceLang, limit, token, youtubeConfig.getApiKey());
                List<YoutubeVideoResponse> videos = page == null || page.videos() == null
                        ? List.of() : page.videos();
                String nextToken = page == null ? null : page.nextPageToken();
                if (videos != null && !videos.isEmpty()) {
                    List<YoutubeVideoResponse> playable = filterPlayable(videos, region);
                    if (playable.isEmpty()) {
                        log.warn("YouTube search live all {} items filtered, serving mock", videos.size());
                    } else {
                        List<YoutubeVideoResponse> capped = cap(playable, limit);
                        log.info("YouTube search live: count={} region={} lang={} hl={}",
                                capped.size(), region, lang, interfaceLang);
                        return YoutubeSearchResponse.builder()
                                .query(q)
                                .regionCode(region)
                                .relevanceLanguage(lang)
                                .hl(interfaceLang)
                                .maxResults(limit)
                                .count(capped.size())
                                .source(SOURCE_LIVE)
                                .nextPageToken(nextToken)
                                .videos(capped)
                                .build();
                    }
                } else {
                    log.warn("YouTube search live returned no items, serving mock");
                }
            } catch (YoutubeQuotaExceededException ex) {
                log.warn("YouTube search quota exceeded ({}), serving mock", safeMessage(ex));
            } catch (ResourceNotFoundException ex) {
                log.warn("YouTube search not-found ({}), serving mock", safeMessage(ex));
            } catch (Exception ex) {
                logLiveFailure("search", ex,
                        "query=" + q + " region=" + region + " timeout=" + effectiveTimeoutSeconds() + "s");
            }
        }
        List<YoutubeVideoResponse> filtered = filterMock(q, lang);
        int offset = parseMockOffset(token, filtered.size());
        List<YoutubeVideoResponse> mock = slice(filtered, offset, limit);
        return YoutubeSearchResponse.builder()
                .query(q)
                .regionCode(region)
                .relevanceLanguage(lang)
                .hl(interfaceLang)
                .maxResults(limit)
                .count(mock.size())
                .source(SOURCE_MOCK)
                .nextPageToken(mockNextToken(offset, mock.size(), filtered.size()))
                .videos(mock)
                .build();
    }

    /**
     * Single-video resolve: live videos.list or mock, cached 30 min.
     *
     * <p>Genuinely missing ids (empty items, upstream 404/videoNotFound, or a
     * {@code private} privacyStatus) throw {@link ResourceNotFoundException}
     * (404). Unembeddable, region-blocked, or age-restricted videos are
     * returned flagged — clients must prefer {@code watchUrl} or show a
     * notice instead of rendering the iframe.
     */
    @Cacheable(value = "youtube-resolve",
            key = "(#videoId == null ? '' : #videoId.trim())")
    public YoutubeResolveResponse resolve(String videoId) {
        String id = videoId == null ? "" : videoId.trim();
        if (youtubeConfig.isLiveEnabled()) {
            try {
                Optional<YoutubeVideoResponse> live =
                        youtubeClient.resolve(id, youtubeConfig.getApiKey());
                if (live.isPresent()) {
                    YoutubeVideoResponse video = live.get();
                    if (isPrivate(video)) {
                        log.info("YouTube resolve live private video, surfacing 404: videoId={}", id);
                        throw new ResourceNotFoundException("YouTube video", id);
                    }
                    if (!isEmbeddable(video) || isBlockedInRegion(video, defaultRegion())
                            || Boolean.TRUE.equals(video.getAgeRestricted())) {
                        log.info("YouTube resolve live flagged (embeddable={} privacy={} ageRestricted={}): videoId={}",
                                video.getEmbeddable(), video.getPrivacyStatus(),
                                video.getAgeRestricted(), id);
                    }
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
                log.warn("YouTube resolve quota exceeded ({}), serving mock: videoId={}",
                        safeMessage(ex), id);
            } catch (Exception ex) {
                logLiveFailure("resolve", ex,
                        "videoId=" + id + " timeout=" + effectiveTimeoutSeconds() + "s");
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
                // Canonical embed URL for the IFrame Player API.
                // We use www.youtube.com (NOT youtube-nocookie.com) because
                // enablejsapi=1 + origin gating require the www host; clients
                // with strict-privacy needs can rewrite the host to
                // www.youtube-nocookie.com/embed/{id} (losing JS-API origin
                // checks). rel=0 keeps recommendations to the same channel.
                .embedUrl(canonicalEmbedUrl(stamped.getVideoId()))
                .video(stamped)
                .build();
    }

    /**
     * Canonical embed URL: {@code https://www.youtube.com/embed/{id}?enablejsapi=1&rel=0}.
     * {@code origin} is intentionally left for the client to append
     * ({@code &origin=https://...}) since the server does not know the
     * embedding origin; without it the IFrame API still loads but origin
     * checks are skipped. See {@link #toResolveResponse} for the
     * youtube-nocookie tradeoff.
     */
    static String canonicalEmbedUrl(String videoId) {
        return "https://www.youtube.com/embed/" + videoId + "?enablejsapi=1&rel=0";
    }

    private YoutubeVideoResponse withSource(YoutubeVideoResponse video, String source) {
        if (source.equals(video.getSource())
                && video.getEmbeddable() != null && video.getPrivacyStatus() != null) {
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
                .embeddable(video.getEmbeddable())
                .privacyStatus(video.getPrivacyStatus())
                .allowedRegions(video.getAllowedRegions() == null
                        ? null : new ArrayList<>(video.getAllowedRegions()))
                .blockedRegions(video.getBlockedRegions() == null
                        ? null : new ArrayList<>(video.getBlockedRegions()))
                .ageRestricted(video.getAgeRestricted())
                .source(source)
                .build();
    }

    static public int clamp(int maxResults) {
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

    /**
     * Normalises an incoming {@code pageToken}: blank/null becomes
     * {@code null} (first page). Mock tokens are stringified integer offsets;
     * live tokens are opaque and forwarded verbatim (trimmed). Never throws.
     */
    static String normalizePageToken(String pageToken) {
        if (pageToken == null || pageToken.isBlank()) {
            return null;
        }
        return pageToken.trim();
    }

    /**
     * Decodes a mock catalogue offset. Live opaque tokens never reach here in
     * mock mode — an unparseable token fails open to {@code 0} (first page)
     * instead of 400ing, so scroll state corruption self-heals. Clamped to
     * {@code [0, total]}.
     */
    static int parseMockOffset(String pageToken, int total) {
        if (pageToken == null || pageToken.isBlank()) {
            return 0;
        }
        try {
            int offset = Integer.parseInt(pageToken.trim());
            if (offset < 0) {
                return 0;
            }
            return Math.min(offset, Math.max(0, total));
        } catch (NumberFormatException ex) {
            return 0;
        }
    }

    /**
     * Deterministic slice of a mock list for unlimited scroll:
     * {@code [offset, offset+limit)}. Out-of-range offsets yield an empty page.
     */
    static List<YoutubeVideoResponse> slice(List<YoutubeVideoResponse> videos, int offset, int limit) {
        if (videos == null || videos.isEmpty()) {
            return List.of();
        }
        int from = Math.min(Math.max(0, offset), videos.size());
        int to = Math.min(from + Math.max(0, limit), videos.size());
        return new ArrayList<>(videos.subList(from, to));
    }

    /**
     * Mock {@code nextPageToken}: stringified offset of the next slice, or
     * {@code null} when this page exhausted the list.
     */
    static String mockNextToken(int offset, int pageSize, int total) {
        int next = offset + pageSize;
        return next < total ? String.valueOf(next) : null;
    }

    private String defaultRegion() {
        String configured = youtubeConfig.getRegionCode();
        if (configured == null || configured.isBlank()) {
            return "IN";
        }
        return configured.trim().toUpperCase(Locale.ROOT);
    }

    private String defaultLanguage() {
        String configured = youtubeConfig.getRelevanceLanguage();
        if (configured == null || configured.isBlank()) {
            return "ta";
        }
        return configured.trim().toLowerCase(Locale.ROOT);
    }

    /**
     * Effective outbound budget for log lines (1..30s, fallback 5s when the
     * config mock/bean misbehaves). Mirrors
     * {@link YoutubeConfig#getEffectiveTimeoutSeconds()} without failing.
     */
    private int effectiveTimeoutSeconds() {
        try {
            int t = youtubeConfig.getEffectiveTimeoutSeconds();
            if (t >= 1 && t <= 30) {
                return t;
            }
        } catch (Exception ignored) {
            // Fall through to the legacy getter / default.
        }
        try {
            int legacy = youtubeConfig.getTimeoutSeconds();
            return Math.min(30, Math.max(1, legacy));
        } catch (Exception ignored) {
            return 5;
        }
    }

    /**
     * True for Reactor block timeouts (direct {@code IllegalStateException:
     * Timeout on blocking read ...} via {@link YoutubeClient#isBlockTimeout}
     * or the translated {@code YoutubeUpstreamException "... timed out ..."}
     * from the client). Lets logs say "timed out" instead of an opaque class
     * name while still failing open to mock.
     */
    private static boolean isTimeoutFailure(Throwable ex) {
        if (ex == null) {
            return false;
        }
        if (YoutubeClient.isBlockTimeout(ex)) {
            return true;
        }
        String msg = ex.getMessage();
        if (msg != null && msg.contains("timed out")) {
            return true;
        }
        for (Throwable cur = ex.getCause(); cur != null; cur = cur.getCause()) {
            String m = cur.getMessage();
            if (m != null && m.contains("timed out")) {
                return true;
            }
        }
        return false;
    }

    /**
     * Short, key-safe failure detail: exception message with any
     * {@code key=...} query fragment redacted and capped at 300 chars. The
     * API key is passed only as a query param and must never appear in logs,
     * even if a WebClient message ever echoes the request URI.
     */
    private static String safeMessage(Throwable ex) {
        String raw = ex.getMessage();
        if (raw == null || raw.isBlank()) {
            return ex.getClass().getSimpleName();
        }
        String redacted = raw.replaceAll("(?i)(key=)[^&\\s\"]+", "$1REDACTED");
        return redacted.length() > 300 ? redacted.substring(0, 300) : redacted;
    }

    /**
     * Single choke point for live-failure logs: timeout vs generic failure is
     * distinguishable, the message is included (not just the class name), the
     * full stack goes to DEBUG, and the API key never appears. Fail-open to
     * mock is unchanged — this only improves diagnosability.
     */
    private static void logLiveFailure(String operation, Exception ex, String context) {
        String type = ex.getClass().getSimpleName();
        String detail = safeMessage(ex);
        if (isTimeoutFailure(ex)) {
            log.warn("YouTube {} live timed out ({}: {}), serving mock: {}",
                    operation, type, detail, context);
        } else {
            log.warn("YouTube {} live failed ({}: {}), serving mock: {}",
                    operation, type, detail, context);
        }
        log.debug("YouTube {} live failure detail: {}", operation, context, ex);
    }

    /**
     * Drops list entries that cannot play inline: explicitly non-embeddable
     * ({@code status.embeddable=false}), {@code private} privacyStatus, or
     * region-blocked for {@code region}. Null/unknown flags are kept
     * (fail-open: sparse search rows, older cache entries). Age-restricted
     * rows are kept but flagged — clients decide whether to show a warning.
     */
    static List<YoutubeVideoResponse> filterPlayable(List<YoutubeVideoResponse> videos, String region) {
        List<YoutubeVideoResponse> out = new ArrayList<>();
        for (YoutubeVideoResponse video : videos) {
            if (video == null) {
                continue;
            }
            if (isPrivate(video) || !isEmbeddable(video) || isBlockedInRegion(video, region)) {
                continue;
            }
            out.add(video);
        }
        return out;
    }

    static boolean isPrivate(YoutubeVideoResponse video) {
        return video.getPrivacyStatus() != null
                && "private".equalsIgnoreCase(video.getPrivacyStatus().trim());
    }

    /** Null (unknown) counts as embeddable — fail-open for sparse/legacy rows. */
    static boolean isEmbeddable(YoutubeVideoResponse video) {
        return !Boolean.FALSE.equals(video.getEmbeddable());
    }

    /**
     * True when {@code contentDetails.regionRestriction} blocks {@code region}:
     * explicitly listed in {@code blockedRegions}, or an allowlist exists that
     * does not contain the region. Null/empty restriction means playable.
     */
    static boolean isBlockedInRegion(YoutubeVideoResponse video, String region) {
        if (region == null || region.isBlank()) {
            return false;
        }
        String upper = region.trim().toUpperCase(Locale.ROOT);
        if (video.getBlockedRegions() != null) {
            for (String blocked : video.getBlockedRegions()) {
                if (blocked != null && upper.equals(blocked.trim().toUpperCase(Locale.ROOT))) {
                    return true;
                }
            }
        }
        if (video.getAllowedRegions() != null && !video.getAllowedRegions().isEmpty()) {
            for (String allowed : video.getAllowedRegions()) {
                if (allowed != null && upper.equals(allowed.trim().toUpperCase(Locale.ROOT))) {
                    return false;
                }
            }
            return true;
        }
        return false;
    }

    private List<YoutubeVideoResponse> filterMock(String query) {
        return filterMock(query, defaultLanguage());
    }

    /**
     * Mock-catalogue keyword filter with a Tamil boost: when
     * {@code relevanceLanguage} is {@code ta}, Tamil entries sort first
     * (stable) both for matches and for the blank-query catalogue view, so
     * India/Tamil callers see Kollywood content without passing extra params.
     * A non-blank query with zero matches returns an empty list (never the
     * full catalogue) so clients can show a proper "no results" state.
     */
    private List<YoutubeVideoResponse> filterMock(String query, String relevanceLanguage) {
        String raw = query == null ? "" : query.trim();
        if (raw.isBlank()) {
            return boostTamil(new ArrayList<>(MOCK_CATALOGUE), relevanceLanguage);
        }
        String q = raw.toLowerCase(Locale.ROOT);
        List<YoutubeVideoResponse> matched = new ArrayList<>();
        for (YoutubeVideoResponse video : MOCK_CATALOGUE) {
            String title = video.getTitle() == null ? "" : video.getTitle().toLowerCase(Locale.ROOT);
            String channel = video.getChannelTitle() == null ? "" : video.getChannelTitle().toLowerCase(Locale.ROOT);
            if (title.contains(q) || channel.contains(q)) {
                matched.add(video);
            }
        }
        if (matched.isEmpty()) {
            return List.of();
        }
        return boostTamil(matched, relevanceLanguage);
    }

    private List<YoutubeVideoResponse> boostTamil(List<YoutubeVideoResponse> videos, String relevanceLanguage) {
        if (!"ta".equalsIgnoreCase(relevanceLanguage == null ? "" : relevanceLanguage.trim())) {
            return videos;
        }
        List<YoutubeVideoResponse> tamil = new ArrayList<>();
        List<YoutubeVideoResponse> rest = new ArrayList<>();
        for (YoutubeVideoResponse video : videos) {
            if (isTamilEntry(video)) {
                tamil.add(video);
            } else {
                rest.add(video);
            }
        }
        if (tamil.isEmpty()) {
            return videos;
        }
        List<YoutubeVideoResponse> boosted = new ArrayList<>(tamil.size() + rest.size());
        boosted.addAll(tamil);
        boosted.addAll(rest);
        return boosted;
    }

    static boolean isTamilEntry(YoutubeVideoResponse video) {
        if (video == null) {
            return false;
        }
        String combined = ((video.getTitle() == null ? "" : video.getTitle()) + " "
                + (video.getChannelTitle() == null ? "" : video.getChannelTitle()) + " "
                + (video.getChannelId() == null ? "" : video.getChannelId()) + " "
                + (video.getDescription() == null ? "" : video.getDescription()))
                .toLowerCase(Locale.ROOT);
        if (combined.contains("tamil") || combined.contains("kollywood") || combined.contains("chennai")) {
            return true;
        }
        // Tamil Unicode block U+0B80–U+0BFF (e.g. தமிழ் titles/descriptions).
        for (int i = 0; i < combined.length(); i++) {
            char c = combined.charAt(i);
            if (c >= '\u0B80' && c <= '\u0BFF') {
                return true;
            }
        }
        return false;
    }

    private Optional<YoutubeVideoResponse> findMock(String videoId) {
        return MOCK_CATALOGUE.stream()
                .filter(v -> v.getVideoId() != null && v.getVideoId().equals(videoId))
                .findFirst();
    }

    /**
     * Deterministic 19-entry offline catalogue (11-char video ids). Used when
     * no API key is configured and as the quota/network fail-open fallback.
     * Includes 4 Tamil/Kollywood entries so India-first ({@code IN}/{@code ta})
     * callers get relevant mock results. All mock rows are public +
     * embeddable so they always pass {@link #filterPlayable}.
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
                    "Retro synthwave for late-night city drives.", "PT1H7M", 7_300_000L),
            mock("aTamilSong1", "Anirudh Tamil Hits — Kollywood Party Mix", "UCtamilAniru", "Anirudh Hits Tamil",
                    "Best of Anirudh Ravichander Tamil Kollywood party songs.", "PT1H2M", 25_400_000L),
            mock("bTamilHit22", "A.R. Rahman Tamil Melodies — Timeless Classics", "UCrahmanTamil", "Rahman Tamil Melodies",
                    "Soulful A.R. Rahman Tamil melodies and evergreen classics.", "PT1H15M", 18_700_000L),
            mock("cKollywood3", "Thalapathy Vijay Tamil Songs — Dance Special", "UCkollywoodVij", "Kollywood Beats Tamil",
                    "Thalapathy Vijay Tamil dance numbers and Kollywood celebrations.", "PT58M", 32_100_000L),
            mock("dAnirudhHit", "Tamil Lo-Fi Beats — Chennai Chill Mix", "UCchennaiLoFi", "Chennai Chill Tamil",
                    "Tamil lo-fi beats and chill Kollywood instrumentals from Chennai.", "PT1H8M", 6_900_000L));
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
                .embeddable(true)
                .privacyStatus("public")
                .allowedRegions(null)
                .blockedRegions(null)
                .ageRestricted(false)
                .source(SOURCE_MOCK)
                .build();
    }
}
