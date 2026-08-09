package com.spotibase.repository;

import com.spotibase.entity.Queue;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface QueueRepository extends JpaRepository<Queue, String> {

    List<Queue> findByUserIdOrderByPositionAsc(String userId);

    @Query("SELECT MAX(q.position) FROM Queue q WHERE q.user.id = :userId")
    Integer findMaxPositionByUserId(@Param("userId") String userId);

    @Modifying
    @Query("DELETE FROM Queue q WHERE q.user.id = :userId")
    void deleteAllByUserId(@Param("userId") String userId);
}
