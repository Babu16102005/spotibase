package com.spotibase.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.spotibase.config.YoutubeConfig;
import com.spotibase.dto.response.YoutubeVideoResponse;
import com.spotibase.exception.ResourceNotFoundException;
import com.spotibase.exception.YoutubeQuotaExceededException;
import com.spotibase.exception.YoutubeUpstreamException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpStatusCode;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import reactor.core.publisher.Mono;

/**
 * Thin HTTP client over YouTube Data API v3.
 *
 * <p>Base URL {@code https://www.googleapis.com/youtube/v3} with a 5s
 * timeout comes from the {@code youtubeWebClient} bean. The API key is only
 * ever sent as the {@code key} query parameter — it is never logged.
 *
 * <p>Issue #153: every {@code videos.list} call requests
 * {@code part=snippet,status,contentDetails,statistics} so callers can surface
 * {@code status.embeddable}, {@code status.privacyStatus},
 * {@code contentDetails.regionRestriction} and age-restriction
 * ({@code contentDetails.contentRating.ytRating}). {@code search.list} is
 * issued with {@code videoEmbeddable=true}, {@code safeSearch=moderate} and
 * {@code regionCode} to pre-filter unplayable rows, then hydrated via
 * {@code videos.list} so the DTO flags are populated even for search results.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class YoutubeClient {

    private static final String SOURCE_LIVE = "LIVE";

    /** Requested on every videos.list call so embeddability flags are available. */
    private static final String VIDEOS_PART = "snippet,status,contentDetails,statistics";

    /**
     * One live page: hydrated video rows plus the upstream
     * {@code nextPageToken} ({@code null} when YouTube reports no further
     * pages). Callers forward the token verbatim as {@code ?pageToken=} for
     * unlimited scroll.
     */
    public record YoutubePage(List<YoutubeVideoResponse> videos, String nextPageToken) {
        public YoutubePage {
            videos = videos == null ? List.of() : List.copyOf(videos);
        }
    }

    @Qualifier("youtubeWebClient")
    private final WebClient youtubeWebClient;

    private final YoutubeConfig youtubeConfig;

    /**
     * Clamped outbound budget (1..30s, default 5s). Single choke point so a
     * misconfigured {@code YOUTUBE_TIMEOUT_SECONDS} can never produce a zero
     * block window (instant {@code IllegalStateException}) or hang threads.
     */
    private int effectiveTimeoutSeconds() {
        return youtubeConfig.getEffectiveTimeoutSeconds();
    }

    /**
     * Split {@code search.list} budget Bs (default {@code total - 2}, min 1).
     * Falls back to the legacy total derivation when the config bean
     * misbehaves (e.g. unit-test mocks without the new getters).
     */
    private int effectiveSearchTimeoutSeconds() {
        try {
            return youtubeConfig.getEffectiveSearchTimeoutSeconds();
        } catch (Exception ignored) {
            // Fall through to total-derived default.
        }
        return Math.max(1, effectiveTimeoutSeconds() - 2);
    }

    /**
     * Split hydration budget Bh (default {@code total - search}, min 1).
     * Falls back to the leftover of the total budget.
     */
    private int effectiveHydrationTimeoutSeconds() {
        try {
            return youtubeConfig.getEffectiveHydrationTimeoutSeconds();
        } catch (Exception ignored) {
            // Fall through to total-derived default.
        }
        return Math.max(1, effectiveTimeoutSeconds() - effectiveSearchTimeoutSeconds());
    }

    /** Hydration batch cap (default 20, clamped 1..25). */
    private int effectiveHydrationMaxIds() {
        try {
            return youtubeConfig.getEffectiveHydrationMaxIds();
        } catch (Exception ignored) {
            // Fall through to default.
        }
        try {
            return Math.min(25, Math.max(1, youtubeConfig.getHydrationMaxIds()));
        } catch (Exception ignored) {
            return 20;
        }
    }

    /**
     * True for Reactor's {@code block(Duration)} timeout signal
     * ({@code IllegalStateException: Timeout on blocking read ...}). Walks the
     * cause chain so wrapped timeouts are also recognised. Used to turn an
     * opaque {@code IllegalStateException} into a distinguishable
     * {@link YoutubeUpstreamException} timeout (service still fails open to
     * mock, but logs say "timed out" instead of just the class name).
     */
    static boolean isBlockTimeout(Throwable ex) {
        for (Throwable cur = ex; cur != null; cur = cur.getCause()) {
            String msg = cur.getMessage();
            if (cur instanceof IllegalStateException
                    && msg != null && msg.contains("Timeout on blocking read")) {
                return true;
            }
            if (cur instanceof java.util.concurrent.TimeoutException) {
                return true;
            }
            if (msg != null
                    && (msg.contains("responseTimeout")
                            || msg.contains("ReadTimeout"))) {
                return true;
            }
        }
        return false;
    }

    /**
     * Blocking subscribe with an explicit timeout translation. Quota /
     * not-found / upstream signals pass through untouched; a Reactor block
     * timeout becomes {@link YoutubeUpstreamException} with the operation name
     * and budget so callers can log it as a timeout. Never logs the API key.
     */
    private <T> T blockWithTimeout(Mono<T> mono, String operation, int timeoutSeconds) {
        try {
            return mono.block(Duration.ofSeconds(timeoutSeconds));
        } catch (IllegalStateException ex) {
            if (isBlockTimeout(ex)) {
                throw new YoutubeUpstreamException(
                        operation + " timed out after " + timeoutSeconds + "s", ex);
            }
            throw ex;
        }
    }

    /**
     * Fail-fast guard: never send an empty {@code key} param upstream (Google
     * would answer 400, surfacing as an opaque failure). Throws a
     * distinguishable {@link YoutubeUpstreamException} so the service fails
     * open to mock with a clear log line. The key value is never logged.
     */
    private String requireApiKey(String apiKey, String operation) {
        if (apiKey == null || apiKey.isBlank()) {
            throw new YoutubeUpstreamException(operation + " API key not configured");
        }
        return apiKey;
    }

    /**
     * {@code videos.list} with {@code chart=mostPopular} (music-flavoured via
     * {@code videoCategoryId=10}).
     *
     * <p>Backward-compat: first page only (no {@code pageToken}).
     */
    public List<YoutubeVideoResponse> fetchTrending(String regionCode, int maxResults, String apiKey) {
        return fetchTrendingPaged(regionCode, maxResults, null, apiKey).videos();
    }

    /**
     * Paged {@code videos.list} {@code chart=mostPopular}: forwards
     * {@code pageToken} upstream (blank/null = first page) and returns the
     * upstream {@code nextPageToken} alongside the rows so callers can scroll.
     */
    public YoutubePage fetchTrendingPaged(
            String regionCode, int maxResults, String pageToken, String apiKey) {
        String key = requireApiKey(apiKey, "YouTube trending");
        int timeout = effectiveTimeoutSeconds();
        String token = pageToken == null || pageToken.isBlank() ? null : pageToken.trim();
        JsonNode body = blockWithTimeout(youtubeWebClient.get()
                .uri(uri -> {
                    var builder = uri.path("/videos")
                            .queryParam("part", VIDEOS_PART)
                            .queryParam("chart", "mostPopular")
                            .queryParam("videoCategoryId", "10")
                            .queryParam("regionCode", regionCode)
                            .queryParam("maxResults", maxResults);
                    if (token != null) {
                        builder.queryParam("pageToken", token);
                    }
                    return builder.queryParam("key", key).build();
                })
                .retrieve()
                // defaultIfEmpty: an empty error body must still map to a
                // YoutubeUpstreamException — otherwise the onStatus Mono is
                // empty and the failure surfaces as an opaque
                // IllegalStateException instead of a diagnosable upstream error.
                .onStatus(HttpStatusCode::isError, resp -> resp.bodyToMono(String.class)
                        .defaultIfEmpty("")
                        .map(err -> mapError(resp.statusCode(), err)))
                .bodyToMono(JsonNode.class),
                "YouTube trending", timeout);
        return new YoutubePage(parseVideosList(body), parseNextPageToken(body));
    }

    /**
     * {@code search.list} restricted to videos, pre-filtered with
     * {@code videoEmbeddable=true}, {@code safeSearch=moderate} and
     * {@code regionCode}, then hydrated via {@code videos.list} so every row
     * carries {@code status}/{@code contentDetails} flags.
     *
     * <p>Backward-compat overload: region/language/hl fall back to the
     * configured India+Tamil defaults ({@code IN}/{@code ta}).
     */
    public List<YoutubeVideoResponse> search(String query, int maxResults, String apiKey) {
        return search(query, defaultRegion(), defaultLanguage(), defaultLanguage(), maxResults, apiKey);
    }

    /**
     * Region-aware search; see {@link #search(String, int, String)}.
     *
     * <p>Backward-compat overload: language/hl fall back to the configured
     * {@code relevance-language} (default {@code ta}).
     */
    public List<YoutubeVideoResponse> search(String query, String regionCode, int maxResults, String apiKey) {
        return search(query, regionCode, defaultLanguage(), defaultLanguage(), maxResults, apiKey);
    }

    /**
     * Region+language-aware search; {@code hl} defaults to
     * {@code relevanceLanguage}. Sends {@code regionCode},
     * {@code relevanceLanguage} and {@code hl} upstream so India/Tamil
     * content ranks without callers passing locale params.
     */
    public List<YoutubeVideoResponse> search(
            String query, String regionCode, String relevanceLanguage, int maxResults, String apiKey) {
        String hl = relevanceLanguage == null || relevanceLanguage.isBlank()
                ? defaultLanguage() : relevanceLanguage.trim();
        return search(query, regionCode, relevanceLanguage, hl, maxResults, apiKey);
    }

    /**
     * Full locale-aware search sending {@code regionCode} +
     * {@code relevanceLanguage} + {@code hl} to {@code search.list}.
     *
     * <p>Backward-compat: first page only (no {@code pageToken}).
     */
    public List<YoutubeVideoResponse> search(
            String query, String regionCode, String relevanceLanguage, String hl,
            int maxResults, String apiKey) {
        return searchPaged(query, regionCode, relevanceLanguage, hl, maxResults, null, apiKey).videos();
    }

    /**
     * Paged locale-aware search: forwards {@code pageToken} to
     * {@code search.list} (blank/null = first page) and returns the upstream
     * {@code nextPageToken} alongside the hydrated rows. Hydration failures
     * still return the sparse rows fail-open with the same token.
     */
    public YoutubePage searchPaged(
            String query, String regionCode, String relevanceLanguage, String hl,
            int maxResults, String pageToken, String apiKey) {
        String key = requireApiKey(apiKey, "YouTube search");
        int total = effectiveTimeoutSeconds();
        int searchTimeout = effectiveSearchTimeoutSeconds();
        int hydrationTimeout = effectiveHydrationTimeoutSeconds();
        if (searchTimeout + hydrationTimeout > total) {
            hydrationTimeout = Math.max(1, total - searchTimeout);
        }
        if (searchTimeout + hydrationTimeout > total) {
            searchTimeout = Math.max(1, total - 1);
            hydrationTimeout = Math.max(1, total - searchTimeout);
        }
        int hydrationMaxIds = effectiveHydrationMaxIds();
        String region = regionCode == null || regionCode.isBlank()
                ? defaultRegion() : regionCode.trim().toUpperCase(java.util.Locale.ROOT);
        String lang = relevanceLanguage == null || relevanceLanguage.isBlank()
                ? defaultLanguage() : relevanceLanguage.trim().toLowerCase(java.util.Locale.ROOT);
        String interfaceLang = hl == null || hl.isBlank()
                ? lang : hl.trim().toLowerCase(java.util.Locale.ROOT);
        String token = pageToken == null || pageToken.isBlank() ? null : pageToken.trim();
        JsonNode body = blockWithTimeout(youtubeWebClient.get()
                .uri(uri -> {
                    var builder = uri.path("/search")
                            .queryParam("part", "snippet")
                            .queryParam("q", query)
                            .queryParam("type", "video")
                            .queryParam("videoEmbeddable", "true")
                            .queryParam("safeSearch", "moderate")
                            .queryParam("regionCode", region)
                            .queryParam("relevanceLanguage", lang)
                            .queryParam("hl", interfaceLang)
                            .queryParam("maxResults", maxResults);
                    if (token != null) {
                        builder.queryParam("pageToken", token);
                    }
                    return builder.queryParam("key", key).build();
                })
                .retrieve()
                // defaultIfEmpty: see fetchTrending — empty error bodies must
                // still produce a mapped exception, never an empty Mono.
                .onStatus(HttpStatusCode::isError, resp -> resp.bodyToMono(String.class)
                        .defaultIfEmpty("")
                        .map(err -> mapError(resp.statusCode(), err)))
                .bodyToMono(JsonNode.class),
                "YouTube search", searchTimeout);
        String nextPageToken = parseNextPageToken(body);
        List<YoutubeVideoResponse> sparse = parseSearchList(body);
        if (sparse.isEmpty()) {
            return new YoutubePage(sparse, nextPageToken);
        }
        // Hydrate ids so embeddable/privacyStatus/regionRestriction/ageRestricted
        // are populated; on hydration failure return the sparse rows (fail-open).
        // Hydration is capped to hydration-max-ids and runs on its own Bh
        // budget so Bs + Bh never exceeds the total outbound budget.
        try {
            List<String> ids = sparse.stream()
                    .map(YoutubeVideoResponse::getVideoId)
                    .filter(id -> id != null && !id.isBlank())
                    .distinct()
                    .limit(hydrationMaxIds)
                    .collect(Collectors.toList());
            if (ids.isEmpty()) {
                return new YoutubePage(sparse, nextPageToken);
            }
            List<YoutubeVideoResponse> hydrated = fetchDetails(ids, key, hydrationTimeout);
            if (hydrated == null || hydrated.isEmpty()) {
                return new YoutubePage(sparse, nextPageToken);
            }
            Map<String, YoutubeVideoResponse> byId = new LinkedHashMap<>();
            for (YoutubeVideoResponse v : hydrated) {
                byId.put(v.getVideoId(), v);
            }
            List<YoutubeVideoResponse> merged = new ArrayList<>();
            for (YoutubeVideoResponse s : sparse) {
                merged.add(byId.getOrDefault(s.getVideoId(), s));
            }
            return new YoutubePage(merged, nextPageToken);
        } catch (ResourceNotFoundException ex) {
            throw ex;
        } catch (Exception ex) {
            if (isBlockTimeout(ex)
                    || (ex.getMessage() != null && ex.getMessage().contains("timed out"))) {
                log.warn("YouTube search hydration timed out ({}: {}), returning sparse rows",
                        ex.getClass().getSimpleName(), ex.getMessage());
            } else {
                log.warn("YouTube search hydration failed ({}: {}), returning sparse rows",
                        ex.getClass().getSimpleName(), ex.getMessage());
            }
            log.debug("YouTube search hydration failure detail", ex);
            return new YoutubePage(sparse, nextPageToken);
        }
    }

    /**
     * {@code videos.list} for a batch of ids (capped to hydration-max-ids,
     * default 20, per API limits of 50). Used to hydrate {@code search.list}
     * rows with {@code status}/{@code contentDetails}. Runs on the hydration
     * (Bh) budget.
     */
    public List<YoutubeVideoResponse> fetchDetails(List<String> videoIds, String apiKey) {
        return fetchDetails(videoIds, apiKey, effectiveHydrationTimeoutSeconds());
    }

    /**
     * Budget-explicit overload so {@link #searchPaged} can pass its Bh slice
     * (Bs + Bh stays within the total). Backward-compat callers use the
     * two-arg overload, which derives Bh from config.
     */
    public List<YoutubeVideoResponse> fetchDetails(List<String> videoIds, String apiKey, int timeoutSeconds) {
        if (videoIds == null || videoIds.isEmpty()) {
            return List.of();
        }
        String key = requireApiKey(apiKey, "YouTube hydration");
        int timeout = timeoutSeconds < 1 ? effectiveHydrationTimeoutSeconds() : timeoutSeconds;
        int cap = effectiveHydrationMaxIds();
        List<String> ids = videoIds.stream()
                .filter(id -> id != null && !id.isBlank())
                .distinct()
                .limit(cap)
                .collect(Collectors.toList());
        if (ids.isEmpty()) {
            return List.of();
        }
        JsonNode body = blockWithTimeout(youtubeWebClient.get()
                .uri(uri -> uri.path("/videos")
                        .queryParam("part", VIDEOS_PART)
                        .queryParam("id", String.join(",", ids))
                        .queryParam("key", key)
                        .build())
                .retrieve()
                // defaultIfEmpty: see fetchTrending — empty error bodies must
                // still produce a mapped exception, never an empty Mono.
                .onStatus(HttpStatusCode::isError, resp -> resp.bodyToMono(String.class)
                        .defaultIfEmpty("")
                        .map(err -> mapError(resp.statusCode(), err)))
                .bodyToMono(JsonNode.class),
                "YouTube hydration", timeout);
        return parseVideosList(body);
    }

    /** {@code videos.list} for one id; empty when YouTube reports no such video. */
    public Optional<YoutubeVideoResponse> resolve(String videoId, String apiKey) {
        String key = requireApiKey(apiKey, "YouTube resolve");
        int timeout = effectiveTimeoutSeconds();
        JsonNode body = blockWithTimeout(youtubeWebClient.get()
                .uri(uri -> uri.path("/videos")
                        .queryParam("part", VIDEOS_PART)
                        .queryParam("id", videoId)
                        .queryParam("key", key)
                        .build())
                .retrieve()
                // defaultIfEmpty: see fetchTrending — empty error bodies must
                // still produce a mapped exception, never an empty Mono.
                .onStatus(HttpStatusCode::isError, resp -> resp.bodyToMono(String.class)
                        .defaultIfEmpty("")
                        .map(err -> mapError(resp.statusCode(), err)))
                .bodyToMono(JsonNode.class),
                "YouTube resolve", timeout);
        List<YoutubeVideoResponse> parsed = parseVideosList(body);
        return parsed.isEmpty() ? Optional.empty() : Optional.of(parsed.get(0));
    }

    /**
     * Maps upstream error payloads to exceptions. The response body may
     * contain quota/account details but never the key, so a short reason is
     * safe to log; 429/quotaExceeded becomes fail-open instead of a 500.
     *
     * <p>resourceNotFound handling (issue #153): HTTP 404 — and 403/400
     * payloads whose {@code reason} is {@code videoNotFound},
     * {@code videoNotFoundForbidden}, {@code notFound} or
     * {@code forbidden} for a videos.list id lookup — surface as
     * {@link ResourceNotFoundException} so the service can answer 404
     * instead of failing open to mock data for genuinely missing videos.
     */
    private RuntimeException mapError(HttpStatusCode status, String body) {
        String reason = body != null && body.length() > 300 ? body.substring(0, 300) : String.valueOf(body);
        String lowered = reason == null ? "" : reason.toLowerCase();
        if (status.value() == 429 || lowered.contains("quotaexceeded")
                || lowered.contains("rateLimitexceeded") || lowered.contains("dailyLimitexceeded")) {
            return new YoutubeQuotaExceededException("YouTube Data API quota exceeded (status " + status.value() + ")");
        }
        boolean notFoundReason = lowered.contains("videonotfound")
                || lowered.contains("videonotfoundforbidden")
                || lowered.contains("notfound");
        if (status.value() == 404 || ((status.value() == 403 || status.value() == 400) && notFoundReason)) {
            return new ResourceNotFoundException("YouTube video not found");
        }
        if (status.value() == 400) {
            // Upstream rejected the request (invalid params/quota shape):
            // surface as 502 via YoutubeUpstreamException so the service
            // fails open to mock and the safety-net handler answers 502
            // instead of leaking a 500.
            return new YoutubeUpstreamException(
                    "YouTube Data API rejected the request (status 400)");
        }
        return new WebClientResponseException(
                status.value(), "YouTube Data API error (status " + status.value() + ")", null, null, null);
    }

    private List<YoutubeVideoResponse> parseVideosList(JsonNode body) {
        List<YoutubeVideoResponse> out = new ArrayList<>();
        JsonNode items = body != null ? body.path("items") : null;
        if (items == null || !items.isArray()) {
            return out;
        }
        for (JsonNode item : items) {
            String id = item.path("id").isTextual() ? item.path("id").asText() : item.path("id").path("videoId").asText(null);
            if (id == null || id.isBlank()) {
                continue;
            }
            out.add(fromVideoItem(id, item.path("snippet"), item.path("status"),
                    item.path("contentDetails"), item.path("statistics")));
        }
        return out;
    }

    private List<YoutubeVideoResponse> parseSearchList(JsonNode body) {
        List<YoutubeVideoResponse> out = new ArrayList<>();
        JsonNode items = body != null ? body.path("items") : null;
        if (items == null || !items.isArray()) {
            return out;
        }
        for (JsonNode item : items) {
            String id = item.path("id").path("videoId").asText(null);
            if (id == null || id.isBlank()) {
                continue;
            }
            out.add(fromVideoItem(id, item.path("snippet"), null, null, null));
        }
        return out;
    }

    /**
     * Extracts {@code nextPageToken} from a {@code search.list} /
     * {@code videos.list} payload. Blank/missing means the last page
     * ({@code null} so Jackson omits/echoes null and clients stop scrolling).
     */
    static String parseNextPageToken(JsonNode body) {
        if (body == null || body.isMissingNode()) {
            return null;
        }
        JsonNode token = body.path("nextPageToken");
        if (!token.isTextual()) {
            return null;
        }
        String raw = token.asText();
        return raw == null || raw.isBlank() ? null : raw.trim();
    }

    private YoutubeVideoResponse fromVideoItem(
            String id, JsonNode snippet, JsonNode status, JsonNode contentDetails, JsonNode statistics) {
        return YoutubeVideoResponse.builder()
                .videoId(id)
                .title(text(snippet, "title"))
                .channelId(text(snippet, "channelId"))
                .channelTitle(text(snippet, "channelTitle"))
                .description(text(snippet, "description"))
                .thumbnailUrl(bestThumbnail(snippet.path("thumbnails")))
                .publishedAt(text(snippet, "publishedAt"))
                .duration(contentDetails != null && !contentDetails.isMissingNode()
                        ? text(contentDetails, "duration") : null)
                .viewCount(statistics != null && !statistics.isMissingNode() ? longOrZero(statistics, "viewCount") : 0L)
                .embeddable(status != null && !status.isMissingNode() ? booleanOrNull(status, "embeddable") : null)
                .privacyStatus(status != null && !status.isMissingNode() ? text(status, "privacyStatus") : null)
                .allowedRegions(stringList(contentDetails, "regionRestriction", "allowed"))
                .blockedRegions(stringList(contentDetails, "regionRestriction", "blocked"))
                .ageRestricted(ageRestricted(contentDetails))
                .source(SOURCE_LIVE)
                .build();
    }

    private String bestThumbnail(JsonNode thumbnails) {
        for (String quality : new String[]{"high", "medium", "default"}) {
            JsonNode node = thumbnails.path(quality).path("url");
            if (node.isTextual() && !node.asText().isBlank()) {
                return node.asText();
            }
        }
        return null;
    }

    private String text(JsonNode node, String field) {
        if (node == null || node.isMissingNode()) {
            return null;
        }
        JsonNode value = node.path(field);
        return value.isTextual() ? value.asText() : null;
    }

    private Boolean booleanOrNull(JsonNode node, String field) {
        if (node == null || node.isMissingNode()) {
            return null;
        }
        JsonNode value = node.path(field);
        if (value.isBoolean()) {
            return value.booleanValue();
        }
        return null;
    }

    private List<String> stringList(JsonNode parent, String objectField, String arrayField) {
        if (parent == null || parent.isMissingNode()) {
            return null;
        }
        JsonNode obj = parent.path(objectField);
        if (obj == null || obj.isMissingNode()) {
            return null;
        }
        JsonNode arr = obj.path(arrayField);
        if (arr == null || !arr.isArray() || arr.isEmpty()) {
            return null;
        }
        List<String> out = new ArrayList<>();
        for (JsonNode el : arr) {
            if (el.isTextual() && !el.asText().isBlank()) {
                out.add(el.asText());
            }
        }
        return out.isEmpty() ? null : out;
    }

    /**
     * True when {@code contentDetails.contentRating.ytRating=ytAgeRestricted}.
     * Null when the payload carries no rating info (unknown, fail-open).
     */
    private Boolean ageRestricted(JsonNode contentDetails) {
        if (contentDetails == null || contentDetails.isMissingNode()) {
            return null;
        }
        JsonNode rating = contentDetails.path("contentRating");
        if (rating == null || rating.isMissingNode()) {
            return null;
        }
        JsonNode ytRating = rating.path("ytRating");
        if (!ytRating.isTextual() || ytRating.asText().isBlank()) {
            return null;
        }
        return "ytAgeRestricted".equalsIgnoreCase(ytRating.asText());
    }

    private long longOrZero(JsonNode node, String field) {
        try {
            String raw = node.path(field).asText(null);
            return raw == null ? 0L : Long.parseLong(raw);
        } catch (NumberFormatException ex) {
            return 0L;
        }
    }

    private String defaultRegion() {
        String configured = youtubeConfig.getRegionCode();
        if (configured == null || configured.isBlank()) {
            return "IN";
        }
        return configured.trim().toUpperCase(java.util.Locale.ROOT);
    }

    private String defaultLanguage() {
        String configured = youtubeConfig.getRelevanceLanguage();
        if (configured == null || configured.isBlank()) {
            return "ta";
        }
        return configured.trim().toLowerCase(java.util.Locale.ROOT);
    }
}
