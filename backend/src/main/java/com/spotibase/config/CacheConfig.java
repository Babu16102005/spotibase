package com.spotibase.config;

import com.github.benmanes.caffeine.cache.Caffeine;
import org.springframework.cache.CacheManager;
import org.springframework.cache.caffeine.CaffeineCacheManager;
import org.springframework.cache.support.CompositeCacheManager;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.data.redis.cache.RedisCacheManager;

import java.util.concurrent.TimeUnit;

/**
 * L1 (Caffeine, in-process) chained before L2 (Redis) for Spotify-fast loads.
 *
 * <p>The {@code @Primary} {@link CacheManager} is a
 * {@link CompositeCacheManager} ordered {@code [caffeine, redis]}: reads hit
 * L1 first and fall through to Redis, while puts/evicts propagate to both, so
 * the existing {@code @Cacheable}/{@code @CacheEvict} annotations and the
 * fail-open {@link CacheResilienceConfig} handler keep working unchanged.
 *
 * <p>L1 TTLs (short, hot-read focused):
 * <ul>
 *   <li>{@code home} / {@code library} — 30s (personalized assemblies)</li>
 *   <li>{@code home-critical} — 45s, {@code home-secondary} — 5m,
 *       {@code home-heavy} — 15m (ordered home tiers)</li>
 *   <li>{@code songs} / {@code search} — 60s (catalog rows, suggestions)</li>
 *   <li>albums / artists / playlists / recommendations / youtube-* — mirror the
 *       Redis TTLs in {@link RedisCacheConfig} so L1 never outlives L2.</li>
 * </ul>
 *
 * <p>L1 stores object references (no serialization); callers already
 * defensive-copy cached DTOs before overlaying per-user state
 * (see {@code SongService.copySongResponse},
 * {@code AlbumService.copyAlbumResponse}), so sharing references is safe.
 */
@Configuration
public class CacheConfig {

    @Bean
    public CaffeineCacheManager caffeineCacheManager() {
        CaffeineCacheManager manager = new CaffeineCacheManager();
        // Default for any cache not registered below (never outlives L2 default 2m).
        manager.setCaffeine(Caffeine.newBuilder()
                .expireAfterWrite(60, TimeUnit.SECONDS)
                .maximumSize(2000)
                .recordStats());
        manager.registerCustomCache("home", l1(30, 500));
        manager.registerCustomCache("home-critical", l1(45, 500));
        manager.registerCustomCache("home-secondary", l1(300, 500));
        manager.registerCustomCache("home-heavy", l1(900, 500));
        manager.registerCustomCache("library", l1(30, 1000));
        manager.registerCustomCache("songs", l1(60, 5000));
        manager.registerCustomCache("search", l1(60, 1000));
        manager.registerCustomCache("albums", l1(300, 2000));
        manager.registerCustomCache("artists", l1(600, 2000));
        manager.registerCustomCache("playlists", l1(120, 1000));
        manager.registerCustomCache("recommendations", l1(120, 1000));
        manager.registerCustomCache("youtube-trending", l1(300, 200));
        manager.registerCustomCache("youtube-search", l1(300, 500));
        manager.registerCustomCache("youtube-resolve", l1(1800, 2000));
        return manager;
    }

    /**
     * Native Caffeine cache (not Spring's {@code CaffeineCache} wrapper):
     * {@code CaffeineCacheManager#registerCustomCache} only accepts the native
     * {@code Cache} / {@code AsyncCache} types and adapts them itself.
     */
    private static com.github.benmanes.caffeine.cache.Cache<Object, Object> l1(long ttlSeconds, long maxSize) {
        return Caffeine.newBuilder()
                .expireAfterWrite(ttlSeconds, TimeUnit.SECONDS)
                .maximumSize(maxSize)
                .recordStats()
                .build();
    }

    /**
     * Primary cache manager: L1 Caffeine first, Redis second. Marked
     * {@code @Primary} so the single-manager resolution used by
     * {@code @Cacheable} picks the chain instead of failing on ambiguity
     * between the two underlying managers.
     */
    @Bean
    @Primary
    public CacheManager cacheManager(CaffeineCacheManager caffeineCacheManager,
                                     RedisCacheManager redisCacheManager) {
        CompositeCacheManager composite =
                new CompositeCacheManager(caffeineCacheManager, redisCacheManager);
        composite.setFallbackToNoOpCache(false);
        return composite;
    }
}
