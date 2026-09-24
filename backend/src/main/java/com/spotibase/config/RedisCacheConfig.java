package com.spotibase.config;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.cache.RedisCacheConfiguration;
import org.springframework.data.redis.cache.RedisCacheManager;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.serializer.GenericJackson2JsonRedisSerializer;
import org.springframework.data.redis.serializer.RedisSerializationContext.SerializationPair;
import org.springframework.data.redis.serializer.StringRedisSerializer;

import java.time.Duration;
import java.util.HashMap;
import java.util.Map;

/**
 * Per-cache TTLs so catalog rows stay hot (Spotify-like repeat visits) while
 * the assembled home feed refreshes often enough to pick up new plays.
 *
 * <p>Keys are prefixed with {@code spotibase:v2:} for namespace isolation on the
 * shared Redis server. The {@code v2} prefix invalidates pre-fix entries
 * written without Jackson type info (plain JSON without {@code @class}),
 * which deserialized as {@code LinkedHashMap} and broke cached
 * {@code List<SongResponse>} reads. Values use JSON so entries stay inspectable and
 * language-agnostic; cache keys stay plain strings.
 *
 * <p>Fail-open behavior lives in {@link CacheResilienceConfig}: Redis outages
 * fall back to the database instead of 500ing.
 */
@Configuration
public class RedisCacheConfig {

    // v2: bumped after the serializer lost @class type info (LinkedHashMap
    // ClassCast on songs/home reads). Forces a miss on stale keys. If Redis
    // still holds bad rows, `redis-cli DEL spotibase::*` or FLUSHDB also works.
    private static final String KEY_PREFIX = "spotibase:v2:";

    @Bean
    public RedisCacheManager redisCacheManager(RedisConnectionFactory connectionFactory) {
        // Java 8 date/time support: LocalDateTime/LocalDate serialize as ISO-8601
        // strings (not timestamps/arrays), and unknown JSON fields are ignored
        // so cache entries survive additive DTO changes.
        // Default typing (NON_FINAL) preserves @class type info so cached
        // List<SongResponse> etc. deserialize to real DTOs, not LinkedHashMap
        // (stock GenericJackson2JsonRedisSerializer includes this; a bare
        // ObjectMapper + JavaTimeModule alone loses it and breaks cache reads).
        // NOTE: auth-users / CustomUserDetails cache stays REMOVED (previous
        // fix) — do not re-add it here.
        ObjectMapper objectMapper = new ObjectMapper();
        objectMapper.registerModule(new JavaTimeModule());
        objectMapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        objectMapper.disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
        objectMapper.activateDefaultTyping(
                objectMapper.getPolymorphicTypeValidator(),
                ObjectMapper.DefaultTyping.NON_FINAL);
        GenericJackson2JsonRedisSerializer valueSerializer =
                new GenericJackson2JsonRedisSerializer(objectMapper);
        RedisCacheConfiguration defaults = RedisCacheConfiguration.defaultCacheConfig()
                .entryTtl(Duration.ofMinutes(2))
                .disableCachingNullValues()
                .serializeKeysWith(SerializationPair.fromSerializer(new StringRedisSerializer()))
                .serializeValuesWith(
                        SerializationPair.fromSerializer(valueSerializer))
                .prefixCacheNameWith(KEY_PREFIX);

        Map<String, RedisCacheConfiguration> perCache = new HashMap<>();
        perCache.put("home", defaults.entryTtl(Duration.ofSeconds(45)));
        perCache.put("songs", defaults.entryTtl(Duration.ofMinutes(5)));
        perCache.put("albums", defaults.entryTtl(Duration.ofMinutes(5)));
        perCache.put("artists", defaults.entryTtl(Duration.ofMinutes(10)));
        perCache.put("playlists", defaults.entryTtl(Duration.ofMinutes(2)));
        perCache.put("recommendations", defaults.entryTtl(Duration.ofMinutes(2)));
        // YouTube proxy: list feeds refresh every 5 min, single-video
        // resolves stay hot for 30 min (fail-open mock on quota/429).
        perCache.put("youtube-trending", defaults.entryTtl(Duration.ofMinutes(5)));
        perCache.put("youtube-search", defaults.entryTtl(Duration.ofMinutes(5)));
        perCache.put("youtube-resolve", defaults.entryTtl(Duration.ofMinutes(30)));

        return RedisCacheManager.builder(connectionFactory)
                .cacheDefaults(defaults)
                .withInitialCacheConfigurations(perCache)
                // transactionAware intentionally disabled: cache writes commit
                // immediately for lower latency; fail-open handler covers errors.
                .build();
    }
}
