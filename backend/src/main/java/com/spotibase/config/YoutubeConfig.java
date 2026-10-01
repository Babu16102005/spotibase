package com.spotibase.config;

import io.netty.channel.ChannelOption;
import java.time.Duration;
import lombok.Getter;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.netty.http.client.HttpClient;
import reactor.netty.resources.ConnectionProvider;

/**
 * YouTube Data API v3 proxy settings, bound from the {@code youtube} block in
 * {@code application.yml} (env: {@code YOUTUBE_*}).
 *
 * <p>Security: the API key is held only in memory and passed as a query
 * parameter by {@code YoutubeClient}. It is never logged, never returned by
 * any endpoint, and has no {@code toString} exposure (no Lombok
 * {@code @ToString} on purpose).
 */
@Getter
@Slf4j
@Configuration
public class YoutubeConfig {

    /** Fallback when {@code youtube.base-url} is blank — never empty. */
    public static final String DEFAULT_BASE_URL = "https://www.googleapis.com/youtube/v3";

    /** Outbound budget bounds: clamps misconfigured {@code timeout-seconds}. */
    public static final int MIN_TIMEOUT_SECONDS = 1;
    public static final int MAX_TIMEOUT_SECONDS = 30;
    public static final int DEFAULT_TIMEOUT_SECONDS = 5;

    @Value("${youtube.api-key:}")
    private String apiKey;

    @Value("${youtube.enabled:true}")
    private boolean enabled;

    @Value("${youtube.base-url:https://www.googleapis.com/youtube/v3}")
    private String baseUrl;

    @Value("${youtube.region-code:IN}")
    private String regionCode;

    @Value("${youtube.relevance-language:ta}")
    private String relevanceLanguage;

    /** Outbound budget for every YouTube Data API call. */
    @Value("${youtube.timeout-seconds:5}")
    private int timeoutSeconds;

    /**
     * Split budget for {@code search.list}. {@code -1} (unset) auto-derives to
     * {@code max(1, total - 2)} so search + hydration stays within the total.
     */
    @Value("${youtube.search-timeout-seconds:-1}")
    private int searchTimeoutSeconds;

    /**
     * Split budget for {@code videos.list} hydration. {@code -1} (unset)
     * auto-derives to {@code max(1, total - search)}.
     */
    @Value("${youtube.hydration-timeout-seconds:-1}")
    private int hydrationTimeoutSeconds;

    /** Max ids per {@code videos.list} hydration call, clamped to 1..25. */
    @Value("${youtube.hydration-max-ids:20}")
    private int hydrationMaxIds;

    /** Live calls only happen when the proxy is enabled and a key is configured. */
    public boolean hasApiKey() {
        return apiKey != null && !apiKey.isBlank();
    }

    public boolean isLiveEnabled() {
        return enabled && hasApiKey();
    }

    /**
     * Effective outbound budget, clamped to [{@code 1}, {@code 30}]s so a
     * misconfigured {@code YOUTUBE_TIMEOUT_SECONDS} (0/negative/huge) can
     * never hang request threads or spin a zero timeout. Never logs the key.
     */
    public int getEffectiveTimeoutSeconds() {
        if (timeoutSeconds < MIN_TIMEOUT_SECONDS || timeoutSeconds > MAX_TIMEOUT_SECONDS) {
            log.warn("YouTube timeout-seconds invalid ({}), clamping to 1..30s",
                    timeoutSeconds);
            return Math.min(MAX_TIMEOUT_SECONDS, Math.max(MIN_TIMEOUT_SECONDS, timeoutSeconds));
        }
        return timeoutSeconds;
    }

    /**
     * Effective {@code search.list} budget (Bs). Unset ({@code -1}) defaults
     * to {@code max(1, total - 2)}; explicit values are clamped to 1..30s and
     * then normalised so {@code search + hydration <= total}.
     */
    public int getEffectiveSearchTimeoutSeconds() {
        return effectiveSearchHydration()[0];
    }

    /**
     * Effective {@code videos.list} hydration budget (Bh). Unset
     * ({@code -1}) defaults to {@code max(1, total - search)}; explicit
     * values are clamped to 1..30s and then normalised so
     * {@code search + hydration <= total}.
     */
    public int getEffectiveHydrationTimeoutSeconds() {
        return effectiveSearchHydration()[1];
    }

    /**
     * Effective hydration batch size, clamped to {@code [1, 25]} (YouTube
     * allows up to 50 ids, but we cap lower to keep the hydration call fast).
     */
    public int getEffectiveHydrationMaxIds() {
        if (hydrationMaxIds < 1 || hydrationMaxIds > 25) {
            log.warn("YouTube hydration-max-ids invalid ({}), clamping to 1..25",
                    hydrationMaxIds);
            return Math.min(25, Math.max(1, hydrationMaxIds));
        }
        return hydrationMaxIds;
    }

    /**
     * Single choke point for the split budgets so both getters always agree
     * and {@code Bs + Bh <= total}. Returns {@code [search, hydration]}.
     */
    private int[] effectiveSearchHydration() {
        int total = getEffectiveTimeoutSeconds();
        int rawSearch = searchTimeoutSeconds < 0
                ? Math.max(MIN_TIMEOUT_SECONDS, total - 2)
                : clampTimeout(searchTimeoutSeconds, "search-timeout-seconds");
        int rawHydration = hydrationTimeoutSeconds < 0
                ? Math.max(MIN_TIMEOUT_SECONDS, total - rawSearch)
                : clampTimeout(hydrationTimeoutSeconds, "hydration-timeout-seconds");
        if (rawSearch + rawHydration > total) {
            rawHydration = Math.max(MIN_TIMEOUT_SECONDS, total - rawSearch);
        }
        if (rawSearch + rawHydration > total) {
            rawSearch = Math.max(MIN_TIMEOUT_SECONDS, total - 1);
            rawHydration = Math.max(MIN_TIMEOUT_SECONDS, total - rawSearch);
        }
        return new int[]{rawSearch, rawHydration};
    }

    private int clampTimeout(int value, String prop) {
        if (value < MIN_TIMEOUT_SECONDS || value > MAX_TIMEOUT_SECONDS) {
            log.warn("YouTube {} invalid ({}), clamping to 1..30s", prop, value);
            return Math.min(MAX_TIMEOUT_SECONDS, Math.max(MIN_TIMEOUT_SECONDS, value));
        }
        return value;
    }

    /**
     * Effective base URL — falls back to the Google default when blank so the
     * WebClient never starts with an empty baseUrl (which would fail every
     * live call with an opaque IllegalStateException).
     */
    public String getEffectiveBaseUrl() {
        if (baseUrl == null || baseUrl.isBlank()) {
            log.warn("YouTube base-url blank, falling back to {}", DEFAULT_BASE_URL);
            return DEFAULT_BASE_URL;
        }
        return baseUrl.trim();
    }

    /**
     * Shared pooled WebClient for the YouTube Data API: fixed 2s connect
     * budget + response budget set to the search timeout (Bs) so a hung
     * Google peer can never exhaust request threads. Pool: max 50
     * connections, 2s pending-acquire, 30s idle. Base URL falls back to the
     * Google default when blank; 2MB in-memory codec cap.
     */
    @Bean("youtubeWebClient")
    public WebClient youtubeWebClient() {
        int searchTimeout = getEffectiveSearchTimeoutSeconds();
        String url = getEffectiveBaseUrl();
        ConnectionProvider provider = ConnectionProvider.builder("youtube")
                .maxConnections(50)
                .pendingAcquireTimeout(Duration.ofSeconds(2))
                .maxIdleTime(Duration.ofSeconds(30))
                .build();
        HttpClient httpClient = HttpClient.create(provider)
                .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, 2000)
                .responseTimeout(Duration.ofSeconds(searchTimeout));
        return WebClient.builder()
                .baseUrl(url)
                .clientConnector(new ReactorClientHttpConnector(httpClient))
                .codecs(c -> c.defaultCodecs().maxInMemorySize(2 * 1024 * 1024))
                .build();
    }
}
