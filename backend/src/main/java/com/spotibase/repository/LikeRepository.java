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

    @Query(value = "SELECT CASE WHEN COUNT(*) > 0 THEN true ELSE false END FROM liked_albums WHERE user_id = :userId AND album_id = :albumId", nativeQuery = true)
    boolean existsByUserIdAndAlbumId(@Param("userId") String userId, @Param("albumId") String albumId);

    @Query(value = "SELECT CASE WHEN COUNT(*) > 0 THEN true ELSE false END FROM liked_artists WHERE user_id = :userId AND artist_id = :artistId", nativeQuery = true)
    boolean existsByUserIdAndArtistId(@Param("userId") String userId, @Param("artistId") String artistId);

    @Query(value = "SELECT song_id FROM liked_songs WHERE user_id = :userId ORDER BY liked_at DESC", nativeQuery = true)
    List<Object[]> findLikedSongIds(@Param("userId") String userId);

    @Query(value = "SELECT album_id FROM liked_albums WHERE user_id = :userId ORDER BY liked_at DESC", nativeQuery = true)
    List<Object[]> findLikedAlbumIds(@Param("userId") String userId);

    @Query(value = "SELECT artist_id FROM liked_artists WHERE user_id = :userId ORDER BY liked_at DESC", nativeQuery = true)
    List<Object[]> findLikedArtistIds(@Param("userId") String userId);
}
