package com.spotibase.service;

import com.spotibase.dto.response.*;
import com.spotibase.repository.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

@Service
@Slf4j
@RequiredArgsConstructor
public class SearchService {

    private static final int MAX_PAGE_SIZE = 50;

    private final EntityManager entityManager;
    private final SongService songService;
    private final AlbumService albumService;
    private final ArtistService artistService;
    private final PlaylistService playlistService;

    static String escapeLike(String input) {
        if (input == null) return "";
        return input.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }

    public SearchResponse search(String query, List<String> types, int page, int size,
                                  String language, Integer year, String genre, String sortBy, String userId) {
        int safePage = Math.max(0, page);
        int safeSize = Math.min(Math.max(1, size), MAX_PAGE_SIZE);
        SearchResponse.SearchResponseBuilder builder = SearchResponse.builder()
                .query(query)
                .page(safePage)
                .size(safeSize);

        if (types.contains("song")) {
            List<SongResponse> songs = searchSongs(query, language, year, genre, sortBy, safePage, safeSize, userId);
            builder.songs(songs);
        }
        if (types.contains("album")) {
            List<AlbumResponse> albums = searchAlbums(query, safePage, safeSize, userId);
            builder.albums(albums);
        }
        if (types.contains("artist")) {
            List<ArtistResponse> artists = searchArtists(query, safePage, safeSize, userId);
            builder.artists(artists);
        }
        if (types.contains("playlist")) {
            List<PlaylistResponse> playlists = searchPlaylists(query, safePage, safeSize);
            builder.playlists(playlists);
        }

        return builder.build();
    }

    /**
     * Typeahead suggestions, cached 60s in {@code search} (see
     * {@code RedisCacheConfig} + L1 {@code CacheConfig}): identical prefixes
     * re-hit without touching the trigram scan on every keystroke.
     */
    @Cacheable(value = "search", key = "'sug:' + #query + ':' + #limit")
    public List<String> getSuggestions(String query, int limit) {
        int safeLimit = Math.min(Math.max(1, limit), MAX_PAGE_SIZE);
        if (query == null || query.isBlank()) return List.of();
        String trimmed = query.trim();
        if (trimmed.length() > 100) trimmed = trimmed.substring(0, 100);
        String escaped = escapeLike(trimmed);
        // Prefix-first (no leading wildcard): lower(col) LIKE lower(:prefix)
        // hits the V24 btree prefix indexes; the trigram similarity fallback
        // (lower(col) % lower(:query)) uses the GIN trigram indexes for fuzzy
        // voice typos. The old "%pattern%" ILIKE scanned all rows and could
        // not use any index. Small LIMIT keeps suggestion latency <150ms.
        String sql = """
            SELECT name, type FROM (
                SELECT s.name, 'song' as type, s.play_count as rank FROM songs s
                WHERE s.archived = false
                AND (lower(s.name) LIKE lower(:prefix) ESCAPE '\\' OR lower(s.name) % lower(:query))
                UNION ALL
                SELECT a.name, 'artist' as type, a.monthly_listeners as rank FROM artists a
                WHERE (lower(a.name) LIKE lower(:prefix) ESCAPE '\\' OR lower(a.name) % lower(:query))
                UNION ALL
                SELECT al.name, 'album' as type, al.song_count as rank FROM albums al
                WHERE al.archived = false
                AND (lower(al.name) LIKE lower(:prefix) ESCAPE '\\' OR lower(al.name) % lower(:query))
            ) combined ORDER BY rank DESC LIMIT :limit
        """;

        Query q = entityManager.createNativeQuery(sql);
        q.setParameter("prefix", escaped + "%");
        q.setParameter("query", trimmed);
        q.setParameter("limit", safeLimit);

        List<String> results = new ArrayList<>();
        List<Object[]> rows = q.getResultList();
        for (Object[] row : rows) {
            results.add(row[0] + " (" + row[1] + ")");
        }
        return results;
    }

    public List<String> getTrendingSearches(int limit) {
        return List.of("top hits 2024", "lofi beats", "workout", "chill vibes", "rock classics");
    }

    private List<SongResponse> searchSongs(String query, String language, Integer year,
                                            String genre, String sortBy, int page, int size, String userId) {
        if (query == null || query.isBlank()) return List.of();
        String trimmed = query.trim();
        String escaped = escapeLike(trimmed);
        // Union ranking: FTS ts_rank + pg_trgm similarity() + exact artist boost + ILIKE fallback.
        // Uses V22/V23/V24 indexes: idx_songs_fts (GIN fts_vector),
        // lower() GIN trigram (idx_songs_*_lower_trgm) for case-insensitive
        // fuzzy voice (lower(col) % lower(:query)), and btree prefix
        // indexes (idx_songs_*_prefix / *_lower_prefix) via LIKE :prefix%.
        // Exact primary_artist_name match gets +2.0 so "play <artist>"
        // surfaces that artist's songs first. Small LIMIT + index-only
        // id scan keeps voice (limit 5) <150ms.
        StringBuilder fullSql = new StringBuilder("""
            SELECT s.id,
                   GREATEST(
                     CASE WHEN s.fts_vector @@ plainto_tsquery('english', :query)
                          THEN ts_rank(s.fts_vector, plainto_tsquery('english', :query))
                          ELSE 0 END,
                     COALESCE(similarity(lower(s.name), lower(:query)), 0),
                     COALESCE(similarity(lower(COALESCE(s.primary_artist_name, '')), lower(:query)), 0),
                     COALESCE(similarity(lower(COALESCE(s.album_name, '')), lower(:query)), 0),
                     CASE WHEN lower(COALESCE(s.primary_artist_name, '')) = lower(:query)
                          THEN 2.0 ELSE 0 END,
                     CASE WHEN s.name ILIKE :pattern ESCAPE '\\'
                               OR COALESCE(s.primary_artist_name, '') ILIKE :pattern ESCAPE '\\'
                               OR COALESCE(s.album_name, '') ILIKE :pattern ESCAPE '\\'
                               OR a.name ILIKE :pattern ESCAPE '\\'
                          THEN 0.1 ELSE 0 END
                   ) as rank
            FROM songs s
            LEFT JOIN artists a ON s.artist_id = a.id
            LEFT JOIN genres g ON s.genre_id = g.id
            WHERE s.archived = false
            AND (
                s.fts_vector @@ plainto_tsquery('english', :query)
                OR lower(s.name) % lower(:query)
                OR lower(COALESCE(s.primary_artist_name, '')) % lower(:query)
                OR lower(COALESCE(s.album_name, '')) % lower(:query)
                OR s.name ILIKE :pattern ESCAPE '\\'
                OR COALESCE(s.primary_artist_name, '') ILIKE :pattern ESCAPE '\\'
                OR COALESCE(s.album_name, '') ILIKE :pattern ESCAPE '\\'
                OR a.name ILIKE :pattern ESCAPE '\\'
                OR lower(s.name) LIKE lower(:prefix) ESCAPE '\\'
                OR lower(COALESCE(s.primary_artist_name, '')) LIKE lower(:prefix) ESCAPE '\\'
                OR lower(COALESCE(s.album_name, '')) LIKE lower(:prefix) ESCAPE '\\'
            )
        """);
        if (language != null && !language.isBlank()) {
            fullSql.append(" AND s.language ILIKE :language");
        }
        if (genre != null && !genre.isBlank()) {
            fullSql.append(" AND (g.name ILIKE :genre OR CAST(s.genre_id AS TEXT) = :genreId)");
        }
        if (year != null) {
            fullSql.append(" AND EXTRACT(YEAR FROM s.release_date) = :year");
        }
        if ("newest".equalsIgnoreCase(sortBy)) {
            fullSql.append(" ORDER BY s.created_at DESC, rank DESC");
        } else if ("popular".equalsIgnoreCase(sortBy)) {
            fullSql.append(" ORDER BY s.play_count DESC, rank DESC");
        } else {
            fullSql.append(" ORDER BY rank DESC, s.play_count DESC, s.created_at DESC");
        }

        Query q = entityManager.createNativeQuery(fullSql.toString());
        q.setParameter("query", trimmed);
        q.setParameter("pattern", "%" + escaped + "%");
        q.setParameter("prefix", escaped + "%");
        if (language != null && !language.isBlank()) q.setParameter("language", language);
        if (genre != null && !genre.isBlank()) {
            q.setParameter("genre", genre);
            q.setParameter("genreId", genre);
        }
        if (year != null) q.setParameter("year", year);
        q.setFirstResult(page * size);
        q.setMaxResults(size);

        List<String> ids = new ArrayList<>();
        List<Object[]> rows = q.getResultList();
        for (Object[] row : rows) {
            ids.add((String) row[0]);
        }

        return songService.getSongsByIds(ids, userId);
    }

    /**
     * Fast voice path: top-5 union (FTS + trigram + ILIKE) search for
     * assistant dispatch. Small LIMIT + GIN indexes target &lt;150ms.
     * Read-only: never writes, never queues. Blank queries return empty
     * (no full-catalog scan) so realtime-partial callers stay fast.
     */
    public List<SongResponse> searchSongsForVoice(String query, String userId) {
        if (query == null || query.isBlank()) return List.of();
        return searchSongs(query, null, null, null, "relevance", 0, 5, userId);
    }

    /**
     * Human-like lyric identification (a): local {@code songs.lyrics} match
     * for a full lyric line. Tries the pg_trgm similarity union first
     * (V22 enables {@code pg_trgm}); any failure (extension missing, NULL
     * lyrics, slow seq-scan) falls open to a plain {@code ILIKE %line%}
     * lookup. Limit 5, read-only, blank-safe. Most catalogs have sparse
     * lyrics (audio-tag parsed), so empty here is normal — callers continue
     * the chain (title match -&gt; YouTube identify -&gt; rematch).
     */
    public List<SongResponse> searchSongsByLyrics(String line, String userId) {
        if (line == null || line.isBlank()) return List.of();
        String trimmed = line.trim();
        if (trimmed.length() > 500) trimmed = trimmed.substring(0, 500);
        String escaped = escapeLike(trimmed);
        // (a1) trigram similarity + ILIKE union, best match first.
        try {
            String sql = """
                SELECT s.id FROM songs s
                WHERE s.archived = false
                AND s.lyrics IS NOT NULL
                AND (s.lyrics ILIKE :pattern ESCAPE '\\'
                     OR lower(s.lyrics) % lower(:query))
                ORDER BY GREATEST(
                             COALESCE(similarity(lower(s.lyrics), lower(:query)), 0),
                             CASE WHEN s.lyrics ILIKE :pattern ESCAPE '\\' THEN 0.5 ELSE 0 END
                         ) DESC,
                         s.play_count DESC
                LIMIT 5
            """;
            Query q = entityManager.createNativeQuery(sql);
            q.setParameter("pattern", "%" + escaped + "%");
            q.setParameter("query", trimmed);
            List<String> ids = q.getResultList();
            if (ids != null && !ids.isEmpty()) {
                return songService.getSongsByIds(ids, userId);
            }
            return List.of();
        } catch (Exception e) {
            log.warn("Lyrics trigram search failed for '{}...', falling back to ILIKE: {}",
                    trimmed.length() > 30 ? trimmed.substring(0, 30) : trimmed, e.getMessage());
        }
        // (a2) pure ILIKE fallback (no pg_trgm dependency).
        try {
            String sql = """
                SELECT s.id FROM songs s
                WHERE s.archived = false
                AND s.lyrics ILIKE :pattern ESCAPE '\\'
                ORDER BY s.play_count DESC
                LIMIT 5
            """;
            Query q = entityManager.createNativeQuery(sql);
            q.setParameter("pattern", "%" + escapeLike(trimmed) + "%");
            List<String> ids = q.getResultList();
            if (ids == null || ids.isEmpty()) return List.of();
            return songService.getSongsByIds(ids, userId);
        } catch (Exception e) {
            log.warn("Lyrics ILIKE search failed: {}", e.getMessage());
            return List.of();
        }
    }

    /**
     * Fast suggestions for the realtime voice-partial preview: top-5 prefix /
     * substring hints served by the V24 trigram + prefix indexes. Blank
     * queries return empty (no full scan). Small LIMIT keeps it &lt;150ms.
     */
    public List<String> getSuggestionsForVoice(String query) {
        if (query == null || query.isBlank()) return List.of();
        return getSuggestions(query, 5);
    }

    private List<AlbumResponse> searchAlbums(String query, int page, int size, String userId) {
        if (query == null || query.isBlank()) return List.of();
        String escaped = escapeLike(query.trim());
        String sql = """
            SELECT a.id FROM albums a
            WHERE a.archived = false
            AND (a.name ILIKE :pattern ESCAPE '\\' OR lower(a.name) LIKE lower(:prefix) ESCAPE '\\')
            ORDER BY a.song_count DESC
        """;

        Query q = entityManager.createNativeQuery(sql);
        q.setParameter("pattern", "%" + escaped + "%");
        q.setParameter("prefix", escaped + "%");
        q.setFirstResult(page * size);
        q.setMaxResults(size);

        List<String> ids = q.getResultList();
        if (ids == null || ids.isEmpty()) return List.of();
        // Batched hydration: one album fetch + 1 liked IN query (summary
        // shape, no per-album song loads) instead of N getAlbumById calls
        // each fanning out to song + liked queries.
        try {
            return albumService.getAlbumsByIds(ids, userId);
        } catch (Exception e) {
            log.warn("Batch album hydration failed for {} ids", ids.size(), e);
            return List.of();
        }
    }

    private List<ArtistResponse> searchArtists(String query, int page, int size, String userId) {
        if (query == null || query.isBlank()) return List.of();
        String escaped = escapeLike(query.trim());
        String sql = """
            SELECT a.id FROM artists a
            WHERE (a.name ILIKE :pattern ESCAPE '\\' OR lower(a.name) LIKE lower(:prefix) ESCAPE '\\')
            ORDER BY a.monthly_listeners DESC
        """;

        Query q = entityManager.createNativeQuery(sql);
        q.setParameter("pattern", "%" + escaped + "%");
        q.setParameter("prefix", escaped + "%");
        q.setFirstResult(page * size);
        q.setMaxResults(size);

        List<String> ids = q.getResultList();
        if (ids == null || ids.isEmpty()) return List.of();
        // Batched hydration: 2 GROUP BY counts + 1 liked IN query instead of
        // N getArtistById calls (3 queries each).
        try {
            return artistService.getArtistsByIds(ids, userId);
        } catch (Exception e) {
            log.warn("Batch artist hydration failed for {} ids", ids.size(), e);
            return List.of();
        }
    }

    private List<PlaylistResponse> searchPlaylists(String query, int page, int size) {
        return playlistService.searchPlaylists(query, PageRequest.of(page, size));
    }
}