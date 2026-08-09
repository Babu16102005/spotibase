package com.spotibase.repository;

import com.spotibase.entity.ListeningHistory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;

@Repository
public interface ListeningHistoryRepository extends JpaRepository<ListeningHistory, String> {

    List<ListeningHistory> findByUserIdOrderByPlayedAtDesc(String userId, Pageable pageable);

    @Query("SELECT lh FROM ListeningHistory lh WHERE lh.user.id = :userId ORDER BY lh.playedAt DESC")
    List<ListeningHistory> findRecentByUserId(@Param("userId") String userId, Pageable pageable);

    @Query("SELECT lh.songId, COUNT(lh) as playCount FROM ListeningHistory lh " +
           "WHERE lh.user.id = :userId AND lh.skipped = false " +
           "GROUP BY lh.songId ORDER BY playCount DESC")
    List<Object[]> findMostPlayedSongIds(@Param("userId") String userId, Pageable pageable);

    @Query("SELECT lh.songId FROM ListeningHistory lh WHERE lh.user.id = :userId " +
           "AND lh.playedAt >= :since GROUP BY lh.songId ORDER BY COUNT(lh) DESC")
    List<String> findRecentFrequentSongIds(@Param("userId") String userId,
                                           @Param("since") LocalDateTime since,
                                           Pageable pageable);

    @Query("SELECT COALESCE(SUM(lh.durationPlayedMs), 0) FROM ListeningHistory lh " +
           "WHERE lh.user.id = :userId")
    long totalListeningTimeByUser(@Param("userId") String userId);

    @Query("SELECT COALESCE(SUM(lh.durationPlayedMs), 0) FROM ListeningHistory lh " +
           "WHERE lh.playedAt >= :since")
    long totalListeningTimeSince(@Param("since") LocalDateTime since);

    Page<ListeningHistory> findByUserId(String userId, Pageable pageable);

    @Query("SELECT COUNT(DISTINCT lh.user.id) FROM ListeningHistory lh " +
           "WHERE lh.playedAt >= :since")
    long countActiveUsersSince(@Param("since") LocalDateTime since);
}
