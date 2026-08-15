package com.spotibase.service;

import com.spotibase.repository.RecentlyPlayedRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;

@Service
@Slf4j
@RequiredArgsConstructor
public class RecentlyPlayedCleanupScheduler {

    private final RecentlyPlayedRepository recentlyPlayedRepository;

    /**
     * Automatically prunes recently_played records older than 7 days daily at 3 AM.
     * Deletes expired history entries to free up database storage for next week's activity.
     */
    @Scheduled(cron = "0 0 3 * * ?")
    @Transactional
    public void cleanupOldRecentlyPlayed() {
        LocalDateTime cutoff = LocalDateTime.now().minusDays(7);
        int deleted = recentlyPlayedRepository.deleteOlderThan(cutoff);
        if (deleted > 0) {
            log.info("7-Day RecentlyPlayed Auto-Prune: Cleared {} entry(ies) older than 7 days (cutoff: {}) to free storage.", deleted, cutoff);
        }
    }
}
