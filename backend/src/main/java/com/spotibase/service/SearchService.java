package com.spotibase.service;

import com.spotibase.dto.response.*;
import com.spotibase.repository.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
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

    private final EntityManager entityManager;
    private final SongService songService;
    private final AlbumService albumService;
    private final ArtistService artistService;
    private final PlaylistService playlistService;

    public SearchResponse search(String query, List<String> types, int page, int size,
                                  String language, Integer year, String genre, String sortBy, String userId) {
        SearchResponse.SearchResponseBuilder builder = SearchResponse.builder()
                .query(query)
                .page(page)
                .size(size);

        if (types.contains("song")) {
            List<SongResponse> songs = searchSongs(query, language, year, genre, sortBy, page, size, userId);
            builder.songs(songs);
        }
        if (types.contains("album")) {
            List<AlbumResponse> albums = searchAlbums(query, page, size, userId);
            builder.albums(albums);
        }
        if (types.contains("artist")) {
            List<ArtistResponse> artists = searchArtists(query, page, size, userId);
            builder.artists(artists);
        }
        if (types.contains("playlist")) {
            List<PlaylistResponse> playlists = searchPlaylists(query, page, size);
            builder.playlists(playlists);
        }

        return builder.build();
    }

    public List<String> getSuggestions(String query, int limit) {
        String sql = """
            SELECT name, type FROM (
                SELECT s.name, 'song' as type, s.play_count as rank FROM songs s WHERE s.name % :query AND s.archived = false
                UNION ALL
                SELECT a.name, 'artist' as type, a.monthly_listeners as rank FROM artists a WHERE a.name % :query
                UNION ALL
                SELECT al.name, 'album' as type, al.song_count as rank FROM albums al WHERE al.name % :query AND al.archived = false
            ) combined ORDER BY rank DESC LIMIT :limit
        """;

        Query q = entityManager.createNativeQuery(sql);
        q.setParameter("query", query);
        q.setParameter("limit", limit);

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
        String fullSql = """
            SELECT s.id,
                   CASE WHEN s.fts_vector @@ plainto_tsquery('english', :query)
                        THEN ts_rank(s.fts_vector, plainto_tsquery('english', :query))
                        ELSE 0.1 END as rank
            FROM songs s
            LEFT JOIN artists a ON s.artist_id = a.id
            WHERE s.archived = false
            AND (
                s.fts_vector @@ plainto_tsquery('english', :query)
                OR s.name ILIKE :pattern
                OR a.name ILIKE :pattern
            )
            ORDER BY rank DESC, s.created_at DESC
        """;

        Query q = entityManager.createNativeQuery(fullSql);
        q.setParameter("query", query);
        q.setParameter("pattern", "%" + query + "%");
        q.setFirstResult(page * size);
        q.setMaxResults(size);

        List<String> ids = new ArrayList<>();
        List<Object[]> rows = q.getResultList();
        for (Object[] row : rows) {
            ids.add((String) row[0]);
        }

        return songService.getSongsByIds(ids, userId);
    }

    private List<AlbumResponse> searchAlbums(String query, int page, int size, String userId) {
        String sql = """
            SELECT a.id FROM albums a
            WHERE a.archived = false
            AND a.name ILIKE :pattern
            ORDER BY a.song_count DESC
        """;

        Query q = entityManager.createNativeQuery(sql);
        q.setParameter("pattern", "%" + query + "%");
        q.setFirstResult(page * size);
        q.setMaxResults(size);

        List<String> ids = q.getResultList();
        return ids.stream().map(id -> {
            try {
                return albumService.getAlbumById(id, userId);
            } catch (Exception e) {
                log.warn("Album not found or error fetching: {}", id, e);
                return null;
            }
        }).filter(a -> a != null).collect(Collectors.toList());
    }

    private List<ArtistResponse> searchArtists(String query, int page, int size, String userId) {
        String sql = """
            SELECT a.id FROM artists a
            WHERE a.name ILIKE :pattern
            ORDER BY a.monthly_listeners DESC
        """;

        Query q = entityManager.createNativeQuery(sql);
        q.setParameter("pattern", "%" + query + "%");
        q.setFirstResult(page * size);
        q.setMaxResults(size);

        List<String> ids = q.getResultList();
        return ids.stream().map(id -> {
            try {
                return artistService.getArtistById(id, userId);
            } catch (Exception e) {
                log.warn("Artist not found or error fetching: {}", id, e);
                return null;
            }
        }).filter(a -> a != null).collect(Collectors.toList());
    }

    private List<PlaylistResponse> searchPlaylists(String query, int page, int size) {
        return playlistService.searchPlaylists(query, PageRequest.of(page, size));
    }
}