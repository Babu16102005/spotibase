package com.spotibase.config;

import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.filter.ShallowEtagHeaderFilter;

/**
 * ETag support for Spotify-fast repeat loads (React Query SWR + ETag-ready
 * client): conditional GETs with {@code If-None-Match} short-circuit to
 * {@code 304} without re-sending JSON.
 *
 * <p>Only exact, non-streaming GET list paths are registered. The byte-range
 * stream endpoint ({@code /api/v1/songs/{id}/stream}) is deliberately
 * <b>excluded</b>: it serves {@code StreamingResponseBody} with its own
 * R2-backed ETag/206 contract, and buffering it through
 * {@link ShallowEtagHeaderFilter} would add latency and break range semantics.
 * Likewise {@code /api/v1/songs/{id}} detail and all mutating endpoints are
 * untouched.
 */
@Configuration
public class EtagConfig {

    @Bean
    public FilterRegistrationBean<ShallowEtagHeaderFilter> shallowEtagFilter() {
        FilterRegistrationBean<ShallowEtagHeaderFilter> registration =
                new FilterRegistrationBean<>(new ShallowEtagHeaderFilter());
        registration.setName("shallowEtagHeaderFilter");
        // Exact paths only (no /* wildcards) so /songs/{id}/stream and
        // /songs/{id} detail never enter the filter.
        registration.addUrlPatterns(
                "/api/v1/home",
                "/api/v1/library",
                "/api/v1/library/playlists",
                "/api/v1/library/albums",
                "/api/v1/library/artists",
                "/api/v1/library/liked-songs",
                "/api/v1/library/recent",
                "/api/v1/library/history",
                "/api/v1/songs",
                "/api/v1/songs/cursor",
                "/api/v1/songs/home",
                "/api/v1/songs/search",
                "/api/v1/songs/trending",
                "/api/v1/songs/new-releases",
                "/api/v1/songs/featured",
                "/api/v1/search/suggestions",
                "/api/v1/search/trending");
        return registration;
    }
}
