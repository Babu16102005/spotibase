package com.spotibase.config;

import io.netty.channel.ChannelOption;
import java.time.Duration;
import lombok.Getter;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.netty.http.client.HttpClient;

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
@Configuration
public class YoutubeConfig {

    @Value("${youtube.api-key:}")
    private String apiKey;

    @Value("${youtube.enabled:true}")
    private boolean enabled;

    @Value("${youtube.base-url:https://www.googleapis.com/youtube/v3}")
    private String baseUrl;

    @Value("${youtube.region-code:US}")
    private String regionCode;

    /** Outbound budget for every YouTube Data API call. */
    @Value("${youtube.timeout-seconds:5}")
    private int timeoutSeconds;

    /** Live calls only happen when the proxy is enabled and a key is configured. */
    public boolean hasApiKey() {
        return apiKey != null && !apiKey.isBlank();
    }

    public boolean isLiveEnabled() {
        return enabled && hasApiKey();
    }

    /**
     * Shared WebClient for the YouTube Data API: 5s connect + 5s response
     * budget so a hung Google peer can never exhaust request threads.
     */
    @Bean("youtubeWebClient")
    public WebClient youtubeWebClient() {
        int timeout = Math.max(1, timeoutSeconds);
        HttpClient httpClient = HttpClient.create()
                .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, timeout * 1000)
                .responseTimeout(Duration.ofSeconds(timeout));
        return WebClient.builder()
                .baseUrl(baseUrl)
                .clientConnector(new ReactorClientHttpConnector(httpClient))
                .codecs(c -> c.defaultCodecs().maxInMemorySize(2 * 1024 * 1024))
                .build();
    }
}
