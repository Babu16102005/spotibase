package com.spotibase.repository;

import com.spotibase.entity.Song;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.List;

@Repository
public interface SongRepository extends JpaRepository<Song, String> {

    // ============================================
    // Basic queries (existing)
    // ============================================
    Page<Song> findByNameContainingIgnoreCase(String name, Pageable pageable);

    Page<Song> findByArtistId(String artistId, Pageable pageable);

    Page<Song> findByAlbumId(String albumId, Pageable pageable);

    Page<Song> findByGenreId(String genreId, Pageable pageable);

    List<Song> findByLanguage(String language, Pageable pageable);

    List<Song> findByReleaseDateAfter(LocalDate date, Pageable pageable);

    @Query("SELECT s FROM Song s WHERE s.archived = false ORDER BY s.playCount DESC")
    List<Song> findTopSongs(Pageable pageable);

    @Query("SELECT s FROM Song s WHERE s.releaseDate >= :since AND s.archived = false ORDER BY s.releaseDate DESC")
    List<Song> findNewReleases(@Param("since") LocalDate since, Pageable pageable);

    @Query("SELECT s FROM Song s WHERE s.featured = true AND s.archived = false")
    List<Song> findFeaturedSongs(Pageable pageable);

    @Query("SELECT s FROM Song s WHERE s.archived = false ORDER BY s.createdAt DESC")
    Page<Song> findAllActive(Pageable pageable);

    @Query("SELECT s FROM Song s WHERE s.album.id = :albumId ORDER BY s.trackNumber ASC")
    List<Song> findByAlbumIdOrderByTrackNumber(@Param("albumId") String albumId);

    @Query("SELECT s FROM Song s WHERE s.id IN :ids")
    List<Song> findByIds(@Param("ids") List<String> ids);

    @Query("SELECT COUNT(s) FROM Song s WHERE s.archived = false")
    long countActiveSongs();

    @Query("SELECT COALESCE(SUM(s.playCount), 0) FROM Song s")
    long totalPlayCount();

    long countByArtistId(String artistId);

    @Query(value = "SELECT CASE WHEN COUNT(*) > 0 THEN true ELSE false END FROM liked_songs WHERE user_id = :userId AND song_id = :songId", nativeQuery = true)
    boolean existsByUserIdAndSongId(@Param("userId") String userId, @Param("songId") String songId);

    // ============================================
    // NEW: Optimized queries with EntityGraph for fast fetching
    // ============================================

    // Home feed: featured first, then newest - with all relations pre-fetched
    @EntityGraph(attributePaths = {"artist", "album", "genre", "albumArtist", "contributingArtists"})
    @Query("""
        SELECT s FROM Song s 
        LEFT JOIN FETCH s.artist a
        LEFT JOIN FETCH s.album al
        LEFT JOIN FETCH s.genre g
        LEFT JOIN FETCH s.albumArtist aa
        LEFT JOIN FETCH s.contributingArtists ca
        LEFT JOIN FETCH ca.artist caa
        WHERE s.archived = false
        ORDER BY s.featured DESC, s.releaseDate DESC
    """)
    Page<Song> findHomeFeed(Pageable pageable);

    // Artist page: songs by artist with album info
    @EntityGraph(attributePaths = {"album", "genre"})
    Page<Song> findByArtistIdAndArchivedFalseOrderByReleaseDateDesc(String artistId, Pageable pageable);

    // Album artist page: songs where artist is album artist
    @EntityGraph(attributePaths = {"artist", "album", "genre"})
    Page<Song> findByAlbumArtistIdAndArchivedFalseOrderByReleaseDateDesc(String albumArtistId, Pageable pageable);

    // Album page: ordered by disc/track
    @EntityGraph(attributePaths = {"artist", "genre", "albumArtist"})
    List<Song> findByAlbumIdAndArchivedFalseOrderByDiscNumberAscTrackNumberAsc(String albumId);

    // Genre page
    @EntityGraph(attributePaths = {"artist", "album"})
    Page<Song> findByGenreIdAndArchivedFalseOrderByReleaseDateDesc(String genreId, Pageable pageable);

    // Batch fetch by IDs with all details (for playlists, library, history)
    @EntityGraph(attributePaths = {"artist", "album", "genre", "albumArtist", "contributingArtists"})
    @Query("""
        SELECT s FROM Song s 
        LEFT JOIN FETCH s.artist a
        LEFT JOIN FETCH s.album al
        LEFT JOIN FETCH s.genre g
        LEFT JOIN FETCH s.albumArtist aa
        LEFT JOIN FETCH s.contributingArtists ca
        LEFT JOIN FETCH ca.artist caa
        WHERE s.id IN :ids
    """)
    List<Song> findByIdInWithDetails(@Param("ids") List<String> ids);

    // Single song with all details
    @EntityGraph(attributePaths = {"artist", "album", "genre", "albumArtist", "contributingArtists"})
    @Query("""
        SELECT s FROM Song s 
        LEFT JOIN FETCH s.artist a
        LEFT JOIN FETCH s.album al
        LEFT JOIN FETCH s.genre g
        LEFT JOIN FETCH s.albumArtist aa
        LEFT JOIN FETCH s.contributingArtists ca
        LEFT JOIN FETCH ca.artist caa
        WHERE s.id = :id
    """)
    java.util.Optional<Song> findByIdWithDetails(@Param("id") String id);

    // ============================================
    // NEW: Fast search using pg_trgm (trigram similarity)
    // ============================================
    @Query(value = """
        SELECT * FROM songs 
        WHERE archived = false 
        AND (
            name % :query 
            OR primary_artist_name % :query 
            OR album_name % :query
        )
        ORDER BY 
            GREATEST(
                similarity(name, :query),
                similarity(primary_artist_name, :query),
                similarity(album_name, :query)
            ) DESC
    """, nativeQuery = true)
    Page<Song> searchSongs(@Param("query") String query, Pageable pageable);

    // ============================================
    // NEW: Cursor-based pagination for infinite scroll
    // ============================================
    @EntityGraph(attributePaths = {"artist", "album"})
    @Query("""
        SELECT s FROM Song s 
        WHERE s.archived = false 
        AND s.id > :cursorId
        ORDER BY s.id ASC
    """)
    List<Song> findAfterCursor(@Param("cursorId") String cursorId, Pageable pageable);

    @EntityGraph(attributePaths = {"artist", "album"})
    @Query("""
        SELECT s FROM Song s 
        WHERE s.archived = false 
        AND s.artist.id = :artistId
        AND s.id > :cursorId
        ORDER BY s.id ASC
    """)
    List<Song> findByArtistAfterCursor(@Param("artistId") String artistId, @Param("cursorId") String cursorId, Pageable pageable);
}