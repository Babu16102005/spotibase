package com.spotibase.repository;

import com.spotibase.entity.Artist;
import com.spotibase.entity.User;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface ArtistRepository extends JpaRepository<Artist, String> {

    Optional<Artist> findByName(String name);

    Page<Artist> findByNameContainingIgnoreCase(String name, Pageable pageable);

    @Query("SELECT a FROM Artist a ORDER BY a.monthlyListeners DESC")
    List<Artist> findTopArtists(Pageable pageable);

    @Query("SELECT a FROM Artist a WHERE a.verified = true ORDER BY a.monthlyListeners DESC")
    List<Artist> findFeaturedArtists(Pageable pageable);

    @Query("SELECT a FROM Artist a WHERE a.userId = :userId")
    Optional<Artist> findByUserId(@Param("userId") String userId);

    @Query("SELECT COUNT(a) FROM Artist a")
    long countArtists();

    @Query(value = "SELECT CASE WHEN COUNT(*) > 0 THEN true ELSE false END FROM liked_artists WHERE user_id = :userId AND artist_id = :artistId", nativeQuery = true)
    boolean existsByUserIdAndArtistId(@Param("userId") String userId, @Param("artistId") String artistId);

    @Query("SELECT u FROM Artist a JOIN a.likedBy u WHERE a.id = :artistId")
    Page<User> findFollowersByArtistId(@Param("artistId") String artistId, Pageable pageable);

    @Modifying
    @Query(value = "INSERT INTO liked_artists (artist_id, user_id) VALUES (:artistId, :userId) ON CONFLICT DO NOTHING", nativeQuery = true)
    int insertFollower(@Param("artistId") String artistId, @Param("userId") String userId);

    @Modifying
    @Query(value = "DELETE FROM liked_artists WHERE artist_id = :artistId AND user_id = :userId", nativeQuery = true)
    int deleteFollower(@Param("artistId") String artistId, @Param("userId") String userId);

    long countByUserId(String userId);
}
