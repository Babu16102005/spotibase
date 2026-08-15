package com.spotibase.repository;

import com.spotibase.entity.RecentlyPlayed;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface RecentlyPlayedRepository extends JpaRepository<RecentlyPlayed, String> {

    List<RecentlyPlayed> findByUserIdOrderByPlayedAtDesc(String userId);

    List<RecentlyPlayed> findByUserIdAndPlayedAtAfterOrderByPlayedAtDesc(String userId, java.time.LocalDateTime cutoff);

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
