package com.spotibase.config;

import lombok.extern.slf4j.Slf4j;
import org.springframework.cache.Cache;
import org.springframework.cache.annotation.CachingConfigurer;
import org.springframework.context.annotation.Configuration;

/**
 * Cache is best-effort: if Redis is down, requests fall back to the database
 * instead of failing with 500 (e.g. RedisConnectionFailureException).
 * A short log line is emitted so outages stay visible in monitoring.
 */
@Slf4j
@Configuration
public class CacheResilienceConfig implements CachingConfigurer {

    @Override
    public org.springframework.cache.interceptor.CacheErrorHandler errorHandler() {
        return new org.springframework.cache.interceptor.CacheErrorHandler() {
            @Override
            public void handleCacheGetError(RuntimeException exception, Cache cache, Object key) {
                log.warn("Cache GET failed on '{}', serving from source: {}",
                        cache.getName(), exception.getMessage());
            }

            @Override
            public void handleCachePutError(RuntimeException exception, Cache cache, Object key, Object value) {
                log.warn("Cache PUT failed on '{}', continuing uncached: {}",
                        cache.getName(), exception.getMessage());
            }

            @Override
            public void handleCacheEvictError(RuntimeException exception, Cache cache, Object key) {
                log.warn("Cache EVICT failed on '{}': {}", cache.getName(), exception.getMessage());
            }

            @Override
            public void handleCacheClearError(RuntimeException exception, Cache cache) {
                log.warn("Cache CLEAR failed on '{}': {}", cache.getName(), exception.getMessage());
            }
        };
    }
}
