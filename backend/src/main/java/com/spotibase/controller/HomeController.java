package com.spotibase.controller;

import com.spotibase.dto.response.HomeResponse;
import com.spotibase.dto.response.SongCardResponse;
import com.spotibase.security.CurrentUser;
import com.spotibase.security.CustomUserDetails;
import com.spotibase.service.HomeTier;
import com.spotibase.service.RecommendationService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.concurrent.TimeUnit;

@RestController
@RequestMapping("/api/v1/home")
@RequiredArgsConstructor
@Slf4j
public class HomeController {

    private final RecommendationService recommendationService;

    /**
     * Home feed.
     *
     * @param fields {@code card} projects song items in every section to the
     *               slim card shape (id/title/artistName/coverUrl/durationMs/
     *               likeCount); missing/blank/anything else means {@code full}
     *               (backward-compat default).
     * @param tier   ordered tier: {@code critical} (recently-played, trending),
     *               {@code secondary} (browse/catalog), {@code heavy}
     *               (made-for-you, daily-mixes), or {@code all} (legacy full
     *               feed, backward-compat default). Unknown values fail open
     *               to {@code all}.
     */
    @GetMapping
    public ResponseEntity<HomeResponse> getHomeSections(
            @CurrentUser CustomUserDetails user,
            @RequestParam(defaultValue = "full") String fields,
            @RequestParam(defaultValue = "all") String tier) {
        String userId = user != null ? user.getId() : null;
        HomeTier homeTier = HomeTier.fromString(tier);
        log.info("Get home sections for user: {} tier: {}",
                userId != null ? userId : "guest", homeTier);
        HomeResponse home = recommendationService.getHomeSections(userId, homeTier);
        home.setGreeting(recommendationService.currentGreeting());
        if (SongCardResponse.isCardView(fields) && home.getSections() != null) {
            home.getSections().forEach(
                    section -> section.setItems(SongCardResponse.projectItems(section.getItems())));
        }
        return ResponseEntity.ok().cacheControl(resolveCacheControl(userId, homeTier)).body(home);
    }

    private CacheControl resolveCacheControl(String userId, HomeTier tier) {
        boolean authed = userId != null;
        return switch (tier != null ? tier : HomeTier.ALL) {
            case CRITICAL -> authed
                    ? CacheControl.maxAge(30, TimeUnit.SECONDS).cachePrivate()
                    : CacheControl.maxAge(45, TimeUnit.SECONDS).cachePublic();
            case SECONDARY -> authed
                    ? CacheControl.maxAge(120, TimeUnit.SECONDS).cachePrivate()
                    : CacheControl.maxAge(300, TimeUnit.SECONDS).cachePublic();
            case HEAVY -> authed
                    ? CacheControl.maxAge(300, TimeUnit.SECONDS).cachePrivate()
                    : CacheControl.maxAge(600, TimeUnit.SECONDS).cachePublic();
            case ALL -> authed
                    // Personalized feed: private 30s. Guest feed is shared: public 60s.
                    ? CacheControl.maxAge(30, TimeUnit.SECONDS).cachePrivate()
                    : CacheControl.maxAge(60, TimeUnit.SECONDS).cachePublic();
        };
    }
}
