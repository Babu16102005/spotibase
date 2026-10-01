package com.spotibase.repository;

import com.spotibase.entity.Song;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface LikeRepository extends JpaRepository<Song, String> {

    @Query(value = "SELECT CASE WHEN COUNT(*) > 0 THEN true ELSE false END FROM liked_songs WHERE user_id = :userId AND song_id = :songId", nativeQuery = true)
    boolean existsByUserIdAndSongId(@Param("userId") String userId, @Param("songId") String songId);

    @Query(value = "SELECT song_id FROM liked_songs WHERE user_id = :userId AND song_id IN :songIds", nativeQuery = true)
    List<String> findLikedSongIds(@Param("userId") String userId, @Param("songIds") List<String> songIds);

    @Query(value = "SELECT CASE WHEN COUNT(*) > 0 THEN true ELSE false END FROM liked_albums WHERE user_id = :userId AND album_id = :albumId", nativeQuery = true)
    boolean existsByUserIdAndAlbumId(@Param("userId") String userId, @Param("albumId") String albumId);

    @Query(value = "SELECT CASE WHEN COUNT(*) > 0 THEN true ELSE false END FROM liked_artists WHERE user_id = :userId AND artist_id = :artistId", nativeQuery = true)
    boolean existsByUserIdAndArtistId(@Param("userId") String userId, @Param("artistId") String artistId);

    @Query(value = "SELECT song_id FROM liked_songs WHERE user_id = :userId ORDER BY liked_at DESC", nativeQuery = true)
    List<String> findAllLikedSongIds(@Param("userId") String userId);

    @Query(value = "SELECT album_id FROM liked_albums WHERE user_id = :userId ORDER BY liked_at DESC", nativeQuery = true)
    List<String> findAllLikedAlbumIds(@Param("userId") String userId);

    @Query(value = "SELECT artist_id FROM liked_artists WHERE user_id = :userId ORDER BY liked_at DESC", nativeQuery = true)
    List<String> findAllLikedArtistIds(@Param("userId") String userId);

    /**
     * Batched liked overlays for list responses: single IN query per page
     * instead of N per-row EXISTS queries. Callers must guard empty lists
     * (IN () is invalid on Postgres).
     */
    @Query(value = "SELECT album_id FROM liked_albums WHERE user_id = :userId AND album_id IN :albumIds", nativeQuery = true)
    List<String> findLikedAlbumIds(@Param("userId") String userId, @Param("albumIds") List<String> albumIds);

    @Query(value = "SELECT artist_id FROM liked_artists WHERE user_id = :userId AND artist_id IN :artistIds", nativeQuery = true)
    List<String> findLikedArtistIds(@Param("userId") String userId, @Param("artistIds") List<String> artistIds);
}
