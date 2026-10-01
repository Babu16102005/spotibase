package com.spotibase.controller;

import com.spotibase.config.YoutubeConfig;
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
 * <p>India-first defaults: trending {@code regionCode} defaults to the
 * configured {@code youtube.region-code} ({@code IN}); search additionally
 * defaults {@code regionCode}, {@code relevanceLanguage} and {@code hl} to
 * the configured {@code youtube.region-code} /
 * {@code youtube.relevance-language} ({@code IN}/{@code ta}, with
 * {@code hl} falling back to {@code relevanceLanguage}) so Tamil content
 * ranks without callers passing locale params.
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
    private final YoutubeConfig youtubeConfig;

    @GetMapping("/trending")
    public ResponseEntity<YoutubeTrendingResponse> trending(
            @RequestParam(required = false) String regionCode,
            @RequestParam(required = false) String maxResults,
            @RequestParam(required = false) String limit,
            @RequestParam(required = false) String pageToken,
            @CurrentUser CustomUserDetails user) {
        String region = regionCode == null || regionCode.isBlank() ? defaultRegion() : regionCode.trim();
        if (!region.matches("(?i)[A-Z]{2}")) {
            throw new BadRequestException("regionCode must be a 2-letter ISO region code");
        }
        // Canonical: maxResults. Legacy mobile alias: limit. pageToken is an
        // opaque scroll cursor (live nextPageToken or mock offset); blank/null
        // means the first page so old clients keep working.
        int limitVal = parseLimit(firstNonBlank(maxResults, limit), "maxResults");
        String token = pageToken == null || pageToken.isBlank() ? null : pageToken.trim();
        log.info("YouTube trending: region={} limit={} pageToken={} user={}",
                region, limitVal, token != null ? "present" : "none", userId(user));
        return ResponseEntity.ok(youtubeService.getTrending(region.toUpperCase(), limitVal, token));
    }

    @GetMapping("/search")
    public ResponseEntity<YoutubeSearchResponse> search(
            @RequestParam(required = false) String q,
            @RequestParam(required = false) String query,
            @RequestParam(required = false) String regionCode,
            @RequestParam(required = false) String relevanceLanguage,
            @RequestParam(required = false) String hl,
            @RequestParam(required = false) String maxResults,
            @RequestParam(required = false) String limit,
            @RequestParam(required = false) String pageToken,
            @CurrentUser CustomUserDetails user) {
        // Canonical: q. Legacy mobile alias: query. pageToken is an opaque
        // scroll cursor (live nextPageToken or mock offset); blank/null means
        // the first page so old clients keep working.
        String effective = firstNonBlank(q, query);
        if (effective == null || effective.isBlank()) {
            throw new BadRequestException("Query parameter 'q' is required");
        }
        if (effective.trim().length() > 200) {
            throw new BadRequestException("Query parameter 'q' must be at most 200 characters");
        }
        String region = regionCode == null || regionCode.isBlank() ? defaultRegion() : regionCode.trim();
        if (!region.matches("(?i)[A-Z]{2}")) {
            throw new BadRequestException("regionCode must be a 2-letter ISO region code");
        }
        String lang = relevanceLanguage == null || relevanceLanguage.isBlank()
                ? defaultLanguage() : relevanceLanguage.trim();
        if (!lang.matches("(?i)[A-Z]{2}")) {
            throw new BadRequestException("relevanceLanguage must be a 2-letter language code");
        }
        // hl defaults to the resolved relevanceLanguage (mirrors the service),
        // so ?relevanceLanguage=fr without hl searches with hl=fr.
        String interfaceLang = hl == null || hl.isBlank() ? lang : hl.trim();
        if (!interfaceLang.matches("(?i)[A-Z]{2}")) {
            throw new BadRequestException("hl must be a 2-letter language code");
        }
        int limitVal = parseLimit(firstNonBlank(maxResults, limit), "maxResults");
        String regionUpper = region.toUpperCase();
        String langLower = lang.toLowerCase();
        String hlLower = interfaceLang.toLowerCase();
        String token = pageToken == null || pageToken.isBlank() ? null : pageToken.trim();
        log.info("YouTube search: q='{}' region={} lang={} hl={} limit={} pageToken={} user={}",
                effective.trim(), regionUpper, langLower, hlLower, limitVal,
                token != null ? "present" : "none", userId(user));
        return ResponseEntity.ok(
                youtubeService.search(effective.trim(), regionUpper, langLower, hlLower, limitVal, token));
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
        if (maxResults < 1 || maxResults > MAX_LIMIT) {
            throw new BadRequestException(
                    "Query parameter 'maxResults' must be an integer between 1 and " + MAX_LIMIT);
        }
        return maxResults;
    }

    private String userId(CustomUserDetails user) {
        return user != null ? user.getId() : "anonymous";
    }

    /**
     * Config-bound defaults for missing/blank locale params. {@code YoutubeConfig}
     * already defaults these via {@code @Value} ({@code IN}/{@code ta}); the
     * literals below are a last-resort safety net for a blank misconfiguration
     * so callers still get India/Tamil ranking instead of a 400.
     */
    private String defaultRegion() {
        String configured = youtubeConfig.getRegionCode();
        return configured == null || configured.isBlank() ? "IN" : configured.trim();
    }

    private String defaultLanguage() {
        String configured = youtubeConfig.getRelevanceLanguage();
        return configured == null || configured.isBlank() ? "ta" : configured.trim();
    }
}
