package com.spotibase.repository;

import com.spotibase.entity.Playlist;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface PlaylistRepository extends JpaRepository<Playlist, String> {

    // Owner fetch-joined: toPlaylistResponse reads playlist.user per row.
    @EntityGraph(attributePaths = {"user"})
    List<Playlist> findByUserId(String userId);

    List<Playlist> findByUserIdAndIsPublicTrue(String userId);

    @EntityGraph(attributePaths = {"user"})
    @Query("SELECT p FROM Playlist p JOIN p.user u WHERE p.isPublic = true AND p.archived = false AND u.active = true ORDER BY p.likeCount DESC")
    List<Playlist> findFeaturedPlaylists(Pageable pageable);

    @EntityGraph(attributePaths = {"user"})
    @Query("SELECT p FROM Playlist p WHERE p.isPublic = true AND p.archived = false ORDER BY p.updatedAt DESC")
    List<Playlist> findRecentPublicPlaylists(Pageable pageable);

    @EntityGraph(attributePaths = {"user"})
    @Query("SELECT p FROM Playlist p WHERE p.name LIKE %:query% AND p.isPublic = true")
    List<Playlist> searchPublicPlaylists(@Param("query") String query, Pageable pageable);

    /**
     * Batched id hydration with the owner fetch-joined (replaces N lazy
     * {@code playlist.user} loads in per-id loops such as getPlaylistsByIds).
     */
    @EntityGraph(attributePaths = {"user"})
    @Query("SELECT p FROM Playlist p LEFT JOIN FETCH p.user WHERE p.id IN :ids")
    List<Playlist> findAllByIdsWithUser(@Param("ids") List<String> ids);

    @Query("SELECT COUNT(p) > 0 FROM Playlist p JOIN p.likedBy u WHERE p.id = :playlistId AND u.id = :userId")
    boolean isLikedByUser(@Param("playlistId") String playlistId, @Param("userId") String userId);

    @Query("SELECT COUNT(p) FROM Playlist p")
    long countPlaylists();
}
