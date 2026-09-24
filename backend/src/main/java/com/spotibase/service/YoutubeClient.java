package com.spotibase.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.spotibase.config.YoutubeConfig;
import com.spotibase.dto.response.YoutubeVideoResponse;
import com.spotibase.exception.ResourceNotFoundException;
import com.spotibase.exception.YoutubeQuotaExceededException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpStatusCode;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;

/**
 * Thin HTTP client over YouTube Data API v3.
 *
 * <p>Base URL {@code https://www.googleapis.com/youtube/v3} with a 5s
 * timeout comes from the {@code youtubeWebClient} bean. The API key is only
 * ever sent as the {@code key} query parameter — it is never logged.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class YoutubeClient {

    private static final String SOURCE_LIVE = "LIVE";

    @Qualifier("youtubeWebClient")
    private final WebClient youtubeWebClient;

    private final YoutubeConfig youtubeConfig;

    /**
     * {@code videos.list} with {@code chart=mostPopular} (music-flavoured via
     * {@code videoCategoryId=10}).
     */
    public List<YoutubeVideoResponse> fetchTrending(String regionCode, int maxResults, String apiKey) {
        JsonNode body = youtubeWebClient.get()
                .uri(uri -> uri.path("/videos")
                        .queryParam("part", "snippet,contentDetails,statistics")
                        .queryParam("chart", "mostPopular")
                        .queryParam("videoCategoryId", "10")
                        .queryParam("regionCode", regionCode)
                        .queryParam("maxResults", maxResults)
                        .queryParam("key", apiKey)
                        .build())
                .retrieve()
                .onStatus(HttpStatusCode::isError, resp -> resp.bodyToMono(String.class)
                        .map(err -> mapError(resp.statusCode(), err)))
                .bodyToMono(JsonNode.class)
                .block(Duration.ofSeconds(Math.max(1, youtubeConfig.getTimeoutSeconds())));
        return parseVideosList(body);
    }

    /** {@code search.list} restricted to videos. */
    public List<YoutubeVideoResponse> search(String query, int maxResults, String apiKey) {
        JsonNode body = youtubeWebClient.get()
                .uri(uri -> uri.path("/search")
                        .queryParam("part", "snippet")
                        .queryParam("q", query)
                        .queryParam("type", "video")
                        .queryParam("maxResults", maxResults)
                        .queryParam("key", apiKey)
                        .build())
                .retrieve()
                .onStatus(HttpStatusCode::isError, resp -> resp.bodyToMono(String.class)
                        .map(err -> mapError(resp.statusCode(), err)))
                .bodyToMono(JsonNode.class)
                .block(Duration.ofSeconds(Math.max(1, youtubeConfig.getTimeoutSeconds())));
        return parseSearchList(body);
    }

    /** {@code videos.list} for one id; empty when YouTube reports no such video. */
    public Optional<YoutubeVideoResponse> resolve(String videoId, String apiKey) {
        JsonNode body = youtubeWebClient.get()
                .uri(uri -> uri.path("/videos")
                        .queryParam("part", "snippet,contentDetails,statistics")
                        .queryParam("id", videoId)
                        .queryParam("key", apiKey)
                        .build())
                .retrieve()
                .onStatus(HttpStatusCode::isError, resp -> resp.bodyToMono(String.class)
                        .map(err -> mapError(resp.statusCode(), err)))
                .bodyToMono(JsonNode.class)
                .block(Duration.ofSeconds(Math.max(1, youtubeConfig.getTimeoutSeconds())));
        List<YoutubeVideoResponse> parsed = parseVideosList(body);
        return parsed.isEmpty() ? Optional.empty() : Optional.of(parsed.get(0));
    }

    /**
     * Maps upstream error payloads to exceptions. The response body may
     * contain quota/account details but never the key, so a short reason is
     * safe to log; 429/quotaExceeded becomes fail-open instead of a 500.
     */
    private RuntimeException mapError(HttpStatusCode status, String body) {
        String reason = body != null && body.length() > 300 ? body.substring(0, 300) : String.valueOf(body);
        if (status.value() == 429 || (reason != null && reason.contains("quotaExceeded"))) {
            return new YoutubeQuotaExceededException("YouTube Data API quota exceeded (status " + status.value() + ")");
        }
        if (status.value() == 404) {
            return new ResourceNotFoundException("YouTube video not found");
        }
        if (status.value() == 400) {
            return new WebClientResponseException(
                    status.value(), "YouTube Data API rejected the request", null, null, null);
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
            out.add(fromVideoItem(id, item.path("snippet"), item.path("contentDetails"), item.path("statistics")));
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
            out.add(fromVideoItem(id, item.path("snippet"), null, null));
        }
        return out;
    }

    private YoutubeVideoResponse fromVideoItem(String id, JsonNode snippet, JsonNode contentDetails, JsonNode statistics) {
        return YoutubeVideoResponse.builder()
                .videoId(id)
                .title(text(snippet, "title"))
                .channelId(text(snippet, "channelId"))
                .channelTitle(text(snippet, "channelTitle"))
                .description(text(snippet, "description"))
                .thumbnailUrl(bestThumbnail(snippet.path("thumbnails")))
                .publishedAt(text(snippet, "publishedAt"))
                .duration(contentDetails != null ? text(contentDetails, "duration") : null)
                .viewCount(statistics != null ? longOrZero(statistics, "viewCount") : 0L)
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

    private long longOrZero(JsonNode node, String field) {
        try {
            String raw = node.path(field).asText(null);
            return raw == null ? 0L : Long.parseLong(raw);
        } catch (NumberFormatException ex) {
            return 0L;
        }
    }
}
