package com.spotibase.controller;

import com.spotibase.dto.response.SearchResponse;
import com.spotibase.security.CurrentUser;
import com.spotibase.security.CustomUserDetails;
import com.spotibase.service.SearchService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/v1/search")
@RequiredArgsConstructor
@Slf4j
public class SearchController {

    private final SearchService searchService;

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
        log.info("Search query: {}, types: {}, page: {}, size: {}", query, types, page, size);
        return ResponseEntity.ok(searchService.search(query, types, page, size, language, year, genre, sortBy, user.getId()));
    }

    @GetMapping("/suggestions")
    public ResponseEntity<List<String>> getSuggestions(@RequestParam String query,
                                                         @RequestParam(defaultValue = "10") int limit) {
        log.info("Get suggestions for query: {}, limit: {}", query, limit);
        return ResponseEntity.ok(searchService.getSuggestions(query, limit));
    }

    @GetMapping("/trending")
    public ResponseEntity<List<String>> getTrendingSearches(@RequestParam(defaultValue = "10") int limit) {
        log.info("Get trending searches, limit: {}", limit);
        return ResponseEntity.ok(searchService.getTrendingSearches(limit));
    }
}