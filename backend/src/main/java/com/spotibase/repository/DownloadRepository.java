package com.spotibase.repository;

import com.spotibase.entity.Download;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface DownloadRepository extends JpaRepository<Download, String> {

    List<Download> findByUserId(String userId);

    Optional<Download> findByUserIdAndSongId(String userId, String songId);

    List<Download> findByUserIdAndStatus(String userId, String status);

    long countByUserId(String userId);

    boolean existsByUserIdAndSongId(String userId, String songId);
}
