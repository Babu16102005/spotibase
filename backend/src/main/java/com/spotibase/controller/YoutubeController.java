package com.spotibase.controller;

import com.spotibase.dto.response.YoutubeResolveResponse;
import com.spotibase.dto.response.YoutubeSearchResponse;
import com.spotibase.dto.response.YoutubeTrendingResponse;
import com.spotibase.exception.BadRequestException;
import com.spotibase.security.CurrentUser;
import com.spotibase.security.CustomUserDetails;
import com.spotibase.service.YoutubeService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * YouTube proxy: trending / search / resolve over YouTube Data API v3 with a
 * mock fallback when no key is configured or quota is exhausted.
 *
 * <p>All endpoints require authentication (default {@code anyRequest}
 * rule in {@code SecurityConfig}); the user principal is logged for audit.
 * Limits are clamped to {@code 1..50}; missing/blank {@code q} and
 * malformed video ids are rejected with 400 via {@code BadRequestException}.
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/youtube")
@RequiredArgsConstructor
public class YoutubeController {

    private static final int MAX_LIMIT = 50;
    private static final int DEFAULT_LIMIT = 15;

    private final YoutubeService youtubeService;

    @GetMapping("/trending")
    public ResponseEntity<YoutubeTrendingResponse> trending(
            @RequestParam(required = false, defaultValue = "US") String regionCode,
            @RequestParam(required = false) String maxResults,
            @RequestParam(required = false) String limit,
            @RequestParam(required = false) String pageToken,
            @CurrentUser CustomUserDetails user) {
        String region = regionCode == null || regionCode.isBlank() ? "US" : regionCode.trim();
        if (!region.matches("(?i)[A-Z]{2}")) {
            throw new BadRequestException("regionCode must be a 2-letter ISO region code");
        }
        // Canonical: maxResults. Legacy mobile alias: limit. pageToken is
        // accepted (no-op) so paginating clients don't 400.
        int limitVal = parseLimit(firstNonBlank(maxResults, limit), "maxResults");
        log.info("YouTube trending: region={} limit={} user={}", region, limitVal, userId(user));
        return ResponseEntity.ok(youtubeService.getTrending(region.toUpperCase(), limitVal));
    }

    @GetMapping("/search")
    public ResponseEntity<YoutubeSearchResponse> search(
            @RequestParam(required = false) String q,
            @RequestParam(required = false) String query,
            @RequestParam(required = false) String maxResults,
            @RequestParam(required = false) String limit,
            @RequestParam(required = false) String pageToken,
            @CurrentUser CustomUserDetails user) {
        // Canonical: q. Legacy mobile alias: query. pageToken accepted
        // (forward-compat pagination; currently no-op on mock/live lists).
        String effective = firstNonBlank(q, query);
        if (effective == null || effective.isBlank()) {
            throw new BadRequestException("Query parameter 'q' is required");
        }
        if (effective.trim().length() > 200) {
            throw new BadRequestException("Query parameter 'q' must be at most 200 characters");
        }
        int limitVal = parseLimit(firstNonBlank(maxResults, limit), "maxResults");
        log.info("YouTube search: q='{}' limit={} user={}", effective.trim(), limitVal, userId(user));
        return ResponseEntity.ok(youtubeService.search(effective.trim(), limitVal));
    }

    @GetMapping("/resolve")
    public ResponseEntity<YoutubeResolveResponse> resolve(
            @RequestParam(required = false) String id,
            @RequestParam(required = false, name = "videoId") String videoIdAlias,
            @CurrentUser CustomUserDetails user) {
        // Canonical: id. Legacy mobile alias: videoId.
        String effective = firstNonBlank(id, videoIdAlias);
        if (effective == null || effective.isBlank()) {
            throw new BadRequestException("Query parameter 'id' (YouTube video id) is required");
        }
        String videoId = effective.trim();
        if (!videoId.matches("[A-Za-z0-9_-]{11}")) {
            throw new BadRequestException("Query parameter 'id' must be a valid 11-character YouTube video id");
        }
        log.info("YouTube resolve: id={} user={}", videoId, userId(user));
        return ResponseEntity.ok(youtubeService.resolve(videoId));
    }

    private String firstNonBlank(String... values) {
        if (values == null) {
            return null;
        }
        for (String v : values) {
            if (v != null && !v.isBlank()) {
                return v;
            }
        }
        return null;
    }

    private int parseLimit(String raw, String paramName) {
        if (raw == null || raw.isBlank()) {
            return DEFAULT_LIMIT;
        }
        final int parsed;
        try {
            parsed = Integer.parseInt(raw.trim());
        } catch (NumberFormatException ex) {
            throw new BadRequestException(
                    "Query parameter '" + paramName + "' must be an integer between 1 and " + MAX_LIMIT);
        }
        return clamp(parsed);
    }

    private int clamp(int maxResults) {
        if (maxResults <= 0) {
            return DEFAULT_LIMIT;
        }
        return Math.min(maxResults, MAX_LIMIT);
    }

    private String userId(CustomUserDetails user) {
        return user != null ? user.getId() : "anonymous";
    }
}
