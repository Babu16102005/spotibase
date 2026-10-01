package com.spotibase.controller;

import com.spotibase.dto.response.SearchResponse;
import com.spotibase.exception.UnauthorizedException;
import com.spotibase.security.CurrentUser;
import com.spotibase.security.CustomUserDetails;
import com.spotibase.service.SearchService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.concurrent.TimeUnit;

@RestController
@RequestMapping("/api/v1/search")
@RequiredArgsConstructor
@Slf4j
public class SearchController {

    private final SearchService searchService;

    /**
     * Full-text + trigram search. Page size is clamped to 20 (fast list
     * rendering; the service additionally guards at 50). Personalized via
     * per-user liked flags, so responses stay {@code private, max-age=30}.
     */
    @GetMapping
    public ResponseEntity<SearchResponse> search(
            @RequestParam String query,
            @RequestParam(defaultValue = "song,album,artist,playlist") List<String> types,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String language,
            @RequestParam(required = false) Integer year,
            @RequestParam(required = false) String genre,
            @RequestParam(defaultValue = "relevance") String sortBy,
            @CurrentUser CustomUserDetails user) {
        if (user == null || user.getId() == null) {
            throw new UnauthorizedException("Authentication required");
        }
        int safePage = Math.max(0, page);
        int safeSize = size <= 0 ? 20 : Math.min(size, 20);
        log.info("Search query: {}, types: {}, page: {}, size: {} (requested page={}, size={})",
                query, types, safePage, safeSize, page, size);
        SearchResponse result = searchService.search(
                query, types, safePage, safeSize, language, year, genre, sortBy, user.getId());
        return ResponseEntity.ok()
                .cacheControl(CacheControl.maxAge(30, TimeUnit.SECONDS).cachePrivate())
                .body(result);
    }

    @GetMapping("/suggestions")
    public ResponseEntity<List<String>> getSuggestions(@RequestParam String query,
                                                         @RequestParam(defaultValue = "10") int limit) {
        int safeLimit = limit <= 0 ? 10 : Math.min(limit, 20);
        log.info("Get suggestions for query: {}, limit: {} (requested {})", query, safeLimit, limit);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.maxAge(60, TimeUnit.SECONDS).cachePublic())
                .body(searchService.getSuggestions(query, safeLimit));
    }

    @GetMapping("/trending")
    public ResponseEntity<List<String>> getTrendingSearches(@RequestParam(defaultValue = "10") int limit) {
        int safeLimit = limit <= 0 ? 10 : Math.min(limit, 20);
        log.info("Get trending searches, limit: {} (requested {})", safeLimit, limit);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.maxAge(60, TimeUnit.SECONDS).cachePublic())
                .body(searchService.getTrendingSearches(safeLimit));
    }
}