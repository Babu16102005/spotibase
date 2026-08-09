package com.spotibase.repository;

import com.spotibase.entity.Album;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.List;

@Repository
public interface AlbumRepository extends JpaRepository<Album, String> {

    List<Album> findByArtistId(String artistId);

    @Query("SELECT a FROM Album a WHERE a.archived = false AND a.featured = true ORDER BY a.releaseDate DESC")
    List<Album> findFeaturedAlbums(Pageable pageable);

    @Query("SELECT a FROM Album a WHERE a.archived = false AND a.releaseDate >= :since ORDER BY a.releaseDate DESC")
    List<Album> findNewReleases(@Param("since") LocalDate since, Pageable pageable);

    @Query("SELECT a FROM Album a WHERE a.archived = false ORDER BY a.createdAt DESC")
    List<Album> findAllActive(Pageable pageable);

    @Query("SELECT COUNT(a) FROM Album a WHERE a.archived = false")
    long countActiveAlbums();

    @Query(value = "SELECT CASE WHEN COUNT(*) > 0 THEN true ELSE false END FROM liked_albums WHERE user_id = :userId AND album_id = :albumId", nativeQuery = true)
    boolean existsByUserIdAndAlbumId(@Param("userId") String userId, @Param("albumId") String albumId);

    long countByArtistId(String artistId);
}
