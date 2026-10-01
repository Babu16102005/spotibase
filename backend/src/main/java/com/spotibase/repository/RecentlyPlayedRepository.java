package com.spotibase.repository;

import com.spotibase.entity.RecentlyPlayed;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Pageable;

@Repository
public interface RecentlyPlayedRepository extends JpaRepository<RecentlyPlayed, String> {

    List<RecentlyPlayed> findByUserIdOrderByPlayedAtDesc(String userId);

    List<RecentlyPlayed> findByUserIdAndPlayedAtAfterOrderByPlayedAtDesc(String userId, java.time.LocalDateTime cutoff);

    /**
     * Bounded variants for hot paths: the unbounded overloads above pull the
     * full per-user history (unbounded result set). List endpoints must use
     * these with PageRequest.of(0, N) so the DB applies LIMIT/OFFSET.
     */
    List<RecentlyPlayed> findByUserIdOrderByPlayedAtDesc(String userId, Pageable pageable);

    List<RecentlyPlayed> findByUserIdAndPlayedAtAfterOrderByPlayedAtDesc(String userId,
            java.time.LocalDateTime cutoff, Pageable pageable);

    Optional<RecentlyPlayed> findByUserIdAndItemTypeAndItemId(String userId, String itemType, String itemId);

    @Modifying
    @Query("DELETE FROM RecentlyPlayed rp WHERE rp.user.id = :userId AND rp.itemType = :itemType AND rp.itemId = :itemId")
    void deleteByUserIdAndItemTypeAndItemId(@Param("userId") String userId,
                                           @Param("itemType") String itemType,
                                           @Param("itemId") String itemId);

    @Modifying
    @Query("DELETE FROM RecentlyPlayed rp WHERE rp.playedAt < :cutoff")
    int deleteOlderThan(@Param("cutoff") java.time.LocalDateTime cutoff);
}
